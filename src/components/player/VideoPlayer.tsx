// VideoPlayer.tsx
// Master production-grade ClipGrab video player component for mobile & desktop
// Supports 4 distinct modes: Desktop Windowed, Desktop Fullscreen, Mobile Windowed, Mobile Fullscreen

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  useVideoPlayer,
  VideoSource,
} from '@/hooks/useVideoPlayer';
import { useFullscreen } from '@/hooks/useFullscreen';
import { usePictureInPicture } from '@/hooks/usePictureInPicture';
import { useMediaSession } from '@/hooks/useMediaSession';
import { usePlayerGestures } from '@/hooks/usePlayerGestures';
import { useKeyboardControls } from '@/hooks/useKeyboardControls';
import { PlayerControls } from './PlayerControls';
import { SeekOverlay } from './SeekOverlay';
import { SettingsMenu } from './SettingsMenu';
import { SubtitleMenu, SubtitleTrack } from './SubtitleMenu';
import { EndScreen } from './EndScreen';
import {
  QueueItem,
  getWatchHistory,
  WatchHistoryEntry,
  removeFromHistory,
} from '@/lib/player-storage';
import { formatTime } from '@/lib/format-utils';
import {
  AlertCircle,
  RotateCcw,
  ArrowLeft,
  Play,
  Loader2,
  ChevronLeft,
  Share2,
  Minimize2,
  Film,
  Download,
  Maximize,
  CheckCircle2,
  PictureInPicture,
  User,
  X,
  FolderOpen,
} from 'lucide-react';
import { registerActiveMedia } from '@/lib/indexed-media-store';
import { generateVideoId } from '@/lib/player-storage';
import { PlatformIcon } from '@/components/PlatformIcon';

export interface VideoPlayerProps {
  source: VideoSource;
  onClose: () => void;
  onMinimize?: () => void;
  nextItem?: QueueItem | null;
  previousItem?: QueueItem | null;
  onPlayNext?: () => void;
  onPlayPrevious?: () => void;
  qualities?: string[];
  activeQuality?: string;
  onSelectQuality?: (q: string) => void;
  onSwitchVideo?: (source: VideoSource) => void;
  /** When true, hides all UI but keeps the <video> alive for background audio & PiP */
  isMiniMode?: boolean;
  /** Called whenever mini-mode play status changes so MiniPlayer can show correct icon */
  onMiniStatusChange?: (isPlaying: boolean) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  source,
  onClose,
  onMinimize,
  nextItem,
  previousItem,
  onPlayNext,
  onPlayPrevious,
  qualities,
  activeQuality,
  onSelectQuality,
  onSwitchVideo,
  isMiniMode = false,
  onMiniStatusChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Ref for the info section — used to scroll to it when title is clicked
  const infoSectionRef = useRef<HTMLElement | null>(null);

  // Auto-hide controls state
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track if user is scrubbing — freeze hide timer during scrub
  const isScrubbingRef = useRef(false);

  // Desktop single-click: track pending single-click to distinguish from double-click
  const singleClickTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Settings & Subtitles modal states
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subtitlesOpen, setSubtitlesOpen] = useState(false);

  // Watch history for the "Up Next / Saved Downloads" shelf
  const [recentVideos, setRecentVideos] = useState<WatchHistoryEntry[]>([]);

  // Subtitle tracks
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [activeSubtitleTrackId, setActiveSubtitleTrackId] = useState<string | null>(null);
  const [subtitleSize, setSubtitleSize] = useState<'sm' | 'md' | 'lg'>('md');

  // Video controller
  const player = useVideoPlayer({
    source,
    onEnded: () => {
      if (player.settings.autoplayNext && nextItem && onPlayNext) {
        onPlayNext();
      }
    },
  });

  // Fullscreen controller attached to the .player-shell
  const fullscreen = useFullscreen(containerRef, player.isVideoLandscape);

  // PiP controller
  const pip = usePictureInPicture(player.videoRef);

  // Load other saved videos for queue/shelf below player
  useEffect(() => {
    try {
      const history = getWatchHistory();
      setRecentVideos(history.filter((h) => h.id !== source.id));
    } catch {
      // ignore storage errors
    }
  }, [source.id]);

  // ── Auto-hide logic (YouTube mobile: 3 seconds, never while paused or scrubbing) ──
  const resetHideTimer = useCallback((customDuration?: number) => {
    setControlsVisible(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    // Only auto-hide if actively playing AND user isn't scrubbing AND no modal open
    if (player.status === 'playing' && !isScrubbingRef.current && !settingsOpen && !subtitlesOpen) {
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, customDuration ?? 3000); // YouTube uses ~3s on mobile
    }
  }, [player.status, settingsOpen, subtitlesOpen]);

  // Called by ProgressBar when user touches the seekbar
  const handleScrubStart = useCallback(() => {
    isScrubbingRef.current = true;
    // Keep controls visible while scrubbing — cancel any pending hide
    setControlsVisible(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // Called by ProgressBar when user lifts finger off seekbar
  const handleScrubEnd = useCallback(() => {
    isScrubbingRef.current = false;
    // Resume 3s timer after scrubbing ends (if still playing)
    resetHideTimer(3000);
  }, [resetHideTimer]);

  useEffect(() => {
    if (player.status === 'paused' || player.status === 'ended') {
      // YouTube behavior: when paused/ended, controls stay visible permanently
      setControlsVisible(true);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    } else if (player.status === 'playing') {
      // Only start auto-hide if not already scrubbing
      if (!isScrubbingRef.current) {
        resetHideTimer(3000);
      }
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [player.status, resetHideTimer]);

  // Gestures (double-tap seek left/right, horizontal swipe, single tap) — mobile & touch
  const gestures = usePlayerGestures({
    seekAmount: player.settings.seekAmount,
    duration: player.duration,
    currentTime: player.currentTime,
    onSeek: player.seek,
    onSeekRelative: player.seekRelative,
    // ── Fires INSTANTLY on any tap — shows controls with zero delay (YouTube behavior) ──
    // The 280ms window is still used to detect double-taps, but we don't wait for it
    // to show the controls. onToggleControls fires 280ms later to handle the timer.
    onFirstTap: () => {
      if (player.status === 'playing') {
        // Show controls immediately; the 3s timer starts from this moment
        setControlsVisible(true);
        // Cancel any pending hide, then start fresh 3s countdown
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        if (!isScrubbingRef.current && !settingsOpen && !subtitlesOpen) {
          hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
        }
      }
      // When paused: controls stay visible, no timer needed — onToggleControls handles it
    },
    onToggleControls: () => {
      // Called 280ms after tap (double-tap window expired)
      // By now controls are already visible (from onFirstTap), just ensure timer is correct
      if (player.status === 'playing') {
        resetHideTimer(3000);
      }
      // When paused: controls always stay visible, nothing to do
    },
    onTogglePlay: () => {
      player.togglePlay();
      // After tapping play/pause, show controls briefly then auto-hide in 3s
      resetHideTimer(3000);
    },
  });

  // Desktop double-click: left zone rewinds by seekAmount, right zone forwards by seekAmount, center toggles play/pause
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // If recent touch (mobile tap), ignore synthetic dblclick
    if (gestures.isRecentTouch()) return;
    if (player.status === 'error' || player.status === 'ended') return;

    if (singleClickTimerRef.current) {
      clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = null;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const leftZone = width * 0.38;
    const rightZone = width * 0.62;

    if (clickX < leftZone) {
      // Double click left -> rewind by seekAmount
      player.seekRelative(-player.settings.seekAmount);
      gestures.triggerFeedback('rewind', player.settings.seekAmount);
    } else if (clickX > rightZone) {
      // Double click right -> forward by seekAmount
      player.seekRelative(player.settings.seekAmount);
      gestures.triggerFeedback('forward', player.settings.seekAmount);
    } else {
      // Center double click -> toggle play/pause (suppressed if buffering)
      if (player.status !== 'buffering') {
        if (player.status === 'playing') {
          player.pause();
        } else {
          player.play();
        }
      }
    }
    resetHideTimer();
  }, [player, gestures, resetHideTimer]);

  // Desktop: single click → toggle play/pause (suppressed if recent touch or buffering)
  const handleSingleClick = useCallback(() => {
    if (gestures.isRecentTouch()) return;
    if (player.status === 'error' || player.status === 'ended') return;

    if (singleClickTimerRef.current) {
      clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = null;
    }
    // Small delay to distinguish from double-click
    singleClickTimerRef.current = setTimeout(() => {
      if (player.status !== 'buffering') {
        if (player.status === 'playing') {
          player.pause();
        } else {
          player.play();
        }
      }
      resetHideTimer(3000);
      singleClickTimerRef.current = null;
    }, 220);
  }, [gestures, player, resetHideTimer]);

  // Native Media Session integration (lock screen controls)
  useMediaSession({
    title: source.title,
    artist: source.author || 'ClipGrab Player',
    thumbnail: source.thumbnail,
    isPlaying: player.status === 'playing',
    duration: player.duration,
    currentTime: player.currentTime,
    playbackRate: player.settings.playbackRate,
    seekAmount: player.settings.seekAmount,
    onPlay: player.play,
    onPause: player.pause,
    onSeekBackward: () => player.seekRelative(-player.settings.seekAmount),
    onSeekForward: () => player.seekRelative(player.settings.seekAmount),
    onPrevious: onPlayPrevious,
    onNext: onPlayNext,
  });

  // ── Fix: browsers (Chrome/Firefox/Edge desktop) pause <video> when toggling fullscreen ──
  // Track playing state before toggle and automatically resume playback across fullscreen transitions.
  const wasPlayingAtFullscreenRef = useRef(false);

  const handleToggleFullscreen = useCallback(async () => {
    const isPlaying =
      player.status === 'playing' ||
      player.status === 'buffering' ||
      (!!player.videoRef.current && !player.videoRef.current.paused && player.status !== 'ended');
    if (isPlaying) {
      wasPlayingAtFullscreenRef.current = true;
    }
    await fullscreen.toggleFullscreen();
  }, [player.status, player.videoRef, fullscreen]);

  // Desktop keyboard hotkeys with input-field protection
  useKeyboardControls(
    {
      onTogglePlay: player.togglePlay,
      onSeekBackward: () => player.seekRelative(-player.settings.seekAmount),
      onSeekForward: () => player.seekRelative(player.settings.seekAmount),
      onVolumeUp: () => player.setVolume(Math.min(1, player.settings.volume + 0.05)),
      onVolumeDown: () => player.setVolume(Math.max(0, player.settings.volume - 0.05)),
      onToggleMute: player.toggleMute,
      onToggleFullscreen: handleToggleFullscreen,
      onTogglePiP: pip.togglePiP,
      onToggleCaptions: () => {
        if (subtitleTracks.length > 0) {
          setActiveSubtitleTrackId((prev) => (prev ? null : subtitleTracks[0].id));
        } else {
          setSubtitlesOpen(true);
        }
      },
      onCloseSettings: () => {
        if (settingsOpen) setSettingsOpen(false);
        else if (subtitlesOpen) setSubtitlesOpen(false);
        else if (fullscreen.isFullscreen) fullscreen.exitFullscreen();
        else onClose();
      },
    },
    !settingsOpen && !subtitlesOpen
  );

  // Web Share API handler
  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: source.title,
          text: `Watch ${source.title} on ClipGrab Player`,
          url: source.url.startsWith('http') ? source.url : window.location.href,
        });
      } catch {
        // user dismissed share dialog
      }
    } else {
      try {
        await navigator.clipboard.writeText(source.url);
        alert('Video stream link copied to clipboard!');
      } catch {
        // clipboard access restricted
      }
    }
  };

  // Subtitle track change effect on HTML5 video element
  useEffect(() => {
    const video = player.videoRef.current;
    if (!video) return;

    for (let i = 0; i < video.textTracks.length; i++) {
      const tt = video.textTracks[i];
      if (activeSubtitleTrackId && tt.label === subtitleTracks.find((t) => t.id === activeSubtitleTrackId)?.label) {
        tt.mode = 'showing';
      } else {
        tt.mode = 'hidden';
      }
    }
  }, [activeSubtitleTrackId, subtitleTracks, player.videoRef]);

  // Compute aspect ratio styles for windowed player shell
  const isLandscape = player.isVideoLandscape;
  const aspectRatioValue = player.aspectRatio || (isLandscape ? 16 / 9 : 9 / 16);

  // Resume playback if video was active before entering or exiting fullscreen
  useEffect(() => {
    if (wasPlayingAtFullscreenRef.current) {
      const vid = player.videoRef.current;
      const attemptResume = () => {
        if (vid && vid.paused && player.status !== 'error' && player.status !== 'ended') {
          vid.play().catch(() => {});
        }
      };
      const t1 = setTimeout(attemptResume, 60);
      const t2 = setTimeout(attemptResume, 180);
      const t3 = setTimeout(() => {
        attemptResume();
        wasPlayingAtFullscreenRef.current = false;
      }, 350);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [fullscreen.isFullscreen, player.status, player.videoRef]);

  // Title expand state for long titles
  const [titleExpanded, setTitleExpanded] = useState(false);

  // Notify parent of play status changes (used by MiniPlayer)
  useEffect(() => {
    if (onMiniStatusChange) {
      onMiniStatusChange(player.status === 'playing');
    }
  }, [player.status, onMiniStatusChange]);

  // Listen for MiniPlayer play/pause toggle events (fired when VideoPlayer is in mini-mode)
  useEffect(() => {
    const handler = () => player.togglePlay();
    window.addEventListener('clipgrab_mini_toggle_play', handler);
    return () => window.removeEventListener('clipgrab_mini_toggle_play', handler);
  }, [player.togglePlay]);

  // Use display:none when in mini mode — keeps the entire DOM tree (incl. <video>) mounted
  // so currentTime, buffered data, and PiP all persist seamlessly
  return (
    <div
      className={
        fullscreen.isFullscreen
          ? "fixed inset-0 z-50 bg-black overflow-hidden select-none w-screen h-[100dvh]"
          : "fixed inset-0 z-50 bg-[#07080d] overflow-y-auto overscroll-contain select-none flex flex-col"
      }
      style={{
        paddingTop: fullscreen.isFullscreen ? undefined : 'max(0.5rem, env(safe-area-inset-top, 0px))',
        paddingBottom: fullscreen.isFullscreen ? undefined : 'max(2.5rem, calc(env(safe-area-inset-bottom, 0px) + 1.5rem))',
        touchAction: fullscreen.isFullscreen ? 'none' : 'pan-y',
        // Hide full player UI when minimised but keep all elements mounted (preserves video currentTime)
        display: isMiniMode ? 'none' : undefined,
      }}
    >
      {/* ── Top Bar in Windowed Mode ── */}
      {!fullscreen.isFullscreen && (
        <header className="w-full max-w-6xl mx-auto px-3 sm:px-6 pt-2 pb-3 sm:py-4 flex items-center justify-between gap-3 shrink-0">
          {/* Back button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            title="Close video and go back"
            className="flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/10 text-white/80 hover:text-white border border-white/5 active:scale-95 transition-all text-xs font-semibold cursor-pointer min-h-[40px]"
          >
            <ChevronLeft className="w-4 h-4 text-primary" />
            <span>Back</span>
          </button>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                title="Minimize to Mini Player"
                aria-label="Minimize player"
                className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/10 text-white/70 hover:text-white border border-white/5 active:scale-95 transition-all flex items-center gap-1.5 text-xs font-medium cursor-pointer min-h-[40px]"
              >
                <Minimize2 className="w-4 h-4 text-primary" />
                <span className="hidden sm:inline">Mini Player</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleShare}
              title="Share video"
              aria-label="Share video link"
              className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/10 text-white/70 hover:text-white border border-white/5 active:scale-95 transition-all flex items-center gap-1.5 text-xs font-medium cursor-pointer min-h-[40px]"
            >
              <Share2 className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Share</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('clipgrab_open_library'));
                }
              }}
              title="Open My Library"
              aria-label="Open downloaded library"
              className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary border border-primary/25 active:scale-95 transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer min-h-[40px]"
            >
              <Film className="w-4 h-4" />
              <span className="hidden sm:inline">My Library</span>
            </button>
          </div>
        </header>
      )}

      {/* ── Main Content Area ── */}
      <main className={fullscreen.isFullscreen ? "w-full h-full" : "w-full max-w-6xl mx-auto px-2 sm:px-6 space-y-5 sm:space-y-6 flex-1"}>

        {/* ── THE PLAYER CONTAINER (.player-shell) ── */}
        <div
          ref={containerRef}
          onMouseMove={() => resetHideTimer()}
          onMouseLeave={() => {
            if (player.status === 'playing') setControlsVisible(false);
          }}
          onWheel={(e) => {
            // Scroll up/down on player (windowed) = volume up/down
            if (fullscreen.isFullscreen) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.05 : -0.05;
            const newVol = Math.min(1, Math.max(0, player.settings.volume + delta));
            player.setVolume(newVol);
          }}
          className={
            fullscreen.isFullscreen
              ? "fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden w-screen h-[100dvh] max-w-none max-h-none rounded-none border-none"
              : "player-shell relative w-full bg-black rounded-2xl sm:rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.85)] border border-white/[0.08] mx-auto flex items-center justify-center transition-all duration-200"
          }
          style={{
            aspectRatio: fullscreen.isFullscreen
              ? 'auto'
              : isLandscape
                ? `${aspectRatioValue}`
                : `${aspectRatioValue}`,
            maxHeight: fullscreen.isFullscreen
              ? 'none'
              : isLandscape
                ? 'min(72vh, 640px)'
                : 'min(75vh, 680px)',
            maxWidth: fullscreen.isFullscreen
              ? 'none'
              : !isLandscape
                ? 'min(100%, 420px)'
                : '100%',
            // Isolate touch events to prevent scroll bleed
            touchAction: fullscreen.isFullscreen ? 'none' : 'none',
          }}
        >
          {/* Main Video Layer — handles touch gestures (mobile) and mouse clicks (desktop) */}
          <div
            className="relative w-full h-full flex items-center justify-center overflow-hidden bg-black"
            onTouchStart={gestures.handleTouchStart}
            onTouchMove={gestures.handleTouchMove}
            onTouchEnd={gestures.handleTouchEnd}
            onClick={(e) => {
              // Only fire for REAL mouse clicks — never for touch-synthesized click events.
              // Touch is handled exclusively by the gesture hook above.
              // This prevents: tap controls area (which stops touch propagation) → synthetic
              // click leaks through → handleSingleClick fires → video pauses unexpectedly.
              if ((e.nativeEvent as PointerEvent).pointerType !== 'mouse') return;
              handleSingleClick();
            }}
            onDoubleClick={(e) => {
              if ((e.nativeEvent as PointerEvent).pointerType !== 'mouse') return;
              handleDoubleClick(e);
            }}
          >
            <video
              ref={player.videoRef}
              src={source.url}
              poster={source.thumbnail || undefined}
              playsInline
              className={`w-full h-full transition-all duration-300 ${player.settings.fitMode === 'cover' ? 'object-cover' : 'object-contain'
                }`}
            >
              {subtitleTracks.map((track) => (
                <track
                  key={track.id}
                  label={track.label}
                  src={track.src}
                  srcLang={track.lang}
                  default={track.id === activeSubtitleTrackId}
                />
              ))}
            </video>

            {/* Swipe Seek Indicator */}
            {gestures.isSwiping && gestures.swipeSeekTime !== null && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 px-5 py-3 rounded-2xl bg-black/85 border border-white/20 text-white font-mono font-bold text-base sm:text-lg backdrop-blur-md shadow-2xl flex items-center gap-2">
                <span className="text-primary font-bold">Seek:</span>
                <span>{Math.round(gestures.swipeSeekTime)}s</span>
              </div>
            )}

            {/* Double-tap Seek Feedback Ripple (mobile) */}
            <SeekOverlay feedback={gestures.feedback} />

            {/* Buffering Indicator — shown when controls are hidden */}
            {player.status === 'buffering' && !controlsVisible && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
                <div className="p-4 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-2xl">
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                </div>
              </div>
            )}

            {/* Resume Prompt Banner — z-40 so it always sits above the controls overlay (z-30) */}
            {player.resumePrompt && (
              <div
                className="absolute top-16 left-4 right-4 sm:left-auto sm:right-6 sm:w-80 z-40 p-4 rounded-2xl bg-[#0d1017]/98 border border-white/20 shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-4 duration-300 pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs sm:text-sm font-bold text-white">
                    Resume Playback?
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      player.setResumePrompt(null);
                    }}
                    aria-label="Dismiss resume prompt"
                    className="p-1 -mr-1 rounded-lg text-white/50 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-white/60 mb-3">
                  You previously stopped at <span className="text-primary font-mono font-bold">{player.resumePrompt.formatted}</span>.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); player.resume(); }}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-primary/25 transition-all active:scale-95 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Resume</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); player.restart(); }}
                    className="py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium text-xs flex items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Start Over</span>
                  </button>
                </div>
              </div>
            )}

            {/* Error Recovery Screen */}
            {player.status === 'error' && (() => {
              const errMsg = player.errorMessage || '';
              const isNetworkErr = errMsg.includes('Network') || errMsg.includes('network') || errMsg.includes('connection');
              const isOffline = !navigator.onLine;
              const isBlobUrl = source.url.startsWith('blob:');
              const isColabTunnel = source.url.includes('trycloudflare.com');
              const isServerUrl = source.url.startsWith('http') && !isBlobUrl;
              const showDownloadFallback = (isNetworkErr || isOffline) && isServerUrl && !isColabTunnel;

              return (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-black/90 backdrop-blur-md text-center">
                  <div className="max-w-md space-y-4">
                    <div className={`w-14 h-14 mx-auto rounded-2xl ${isBlobUrl || isColabTunnel
                        ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                        : showDownloadFallback
                          ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                          : 'bg-red-500/10 border border-red-500/30 text-red-400'
                      } flex items-center justify-center`}>
                      {isBlobUrl || isColabTunnel ? <FolderOpen className="w-7 h-7" /> : <AlertCircle className="w-7 h-7" />}
                    </div>

                    <h3 className="font-headline font-bold text-lg text-white">
                      {isColabTunnel
                        ? 'Colab Session Expired'
                        : isBlobUrl
                          ? 'Local Video Session Ended'
                          : showDownloadFallback
                            ? 'Server Offline or Network Issue'
                            : 'Unable to play video'}
                    </h3>

                    <p className="text-xs sm:text-sm text-white/60 leading-relaxed">
                      {isColabTunnel
                        ? 'This streaming link expired because your temporary Colab notebook stopped. Since this video was already saved to your device, select the file from your Downloads folder to play it offline!'
                        : isBlobUrl
                          ? 'The browser released the temporary file handle. You can re-select your video file to continue watching right where you left off.'
                          : showDownloadFallback
                            ? 'The backend server is not reachable right now. You can try again when online, or download the file directly to watch offline.'
                            : (errMsg || "This video format or codec isn't supported by this browser.")}
                    </p>

                    <div className="flex flex-wrap justify-center gap-3 pt-2">
                      {/* Hidden re-link file input for local files or expired Colab links */}
                      <input
                        type="file"
                        id="cg-relink-file-input"
                        accept="video/*,audio/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const newId = generateVideoId(file.name, file.size.toString());
                            const freshUrl = registerActiveMedia(newId, file, file.name);
                            if (onSwitchVideo) {
                              onSwitchVideo({
                                ...source,
                                id: newId,
                                url: freshUrl,
                                title: file.name.replace(/\.[^/.]+$/, ''),
                              });
                            } else {
                              player.videoRef.current!.src = freshUrl;
                              player.videoRef.current!.load();
                              player.videoRef.current!.play().catch(() => { });
                            }
                          }
                        }}
                      />

                      {isColabTunnel || isBlobUrl ? (
                        <>
                          <button
                            type="button"
                            onClick={() => document.getElementById('cg-relink-file-input')?.click()}
                            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/25 transition-all cursor-pointer active:scale-95"
                          >
                            <FolderOpen className="w-4 h-4" />
                            <span>Select from Downloads</span>
                          </button>

                          {isColabTunnel && (
                            <button
                              type="button"
                              onClick={() => {
                                removeFromHistory(source.id);
                                onClose();
                              }}
                              className="px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 font-medium text-xs flex items-center gap-1.5 transition-all cursor-pointer border border-red-500/20 active:scale-95"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Remove from Library</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={player.retry}
                          className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-primary/25 transition-all cursor-pointer"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Retry</span>
                        </button>
                      )}

                      {showDownloadFallback && (
                        <a
                          href={source.url}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-5 py-2.5 rounded-xl bg-emerald-500/90 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                        >
                          <Download className="w-4 h-4" />
                          <span>Download File</span>
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* End of Video Screen */}
            {player.status === 'ended' && (
              <EndScreen
                source={source}
                nextItem={nextItem}
                onReplay={player.restart}
                onPlayNext={onPlayNext}
                onBack={onClose}
              />
            )}

            {/* Controls Overlay (position: absolute relative to .player-shell) */}
            {player.status !== 'error' && player.status !== 'ended' && (
              <PlayerControls
                visible={controlsVisible}
                status={player.status}
                title={source.title}
                author={source.author}
                currentTime={player.currentTime}
                duration={player.duration}
                bufferedEnd={player.bufferedEnd}
                volume={player.settings.volume}
                muted={player.settings.muted}
                isFullscreen={fullscreen.isFullscreen}
                isPiPSupported={pip.isSupported}
                hasSubtitles={subtitleTracks.length > 0}
                captionsActive={activeSubtitleTrackId !== null}
                seekAmount={player.settings.seekAmount}
                hasPrevious={!!previousItem}
                hasNext={!!nextItem}
                onPlay={player.play}
                onPause={player.pause}
                onSeek={player.seek}
                onSeekRelative={player.seekRelative}
                onVolumeChange={player.setVolume}
                onToggleMute={player.toggleMute}
                onToggleFullscreen={handleToggleFullscreen}
                onTogglePiP={pip.togglePiP}
                onToggleCaptions={() => {
                  if (subtitleTracks.length > 0) {
                    setActiveSubtitleTrackId((prev) => (prev ? null : subtitleTracks[0].id));
                  } else {
                    setSubtitlesOpen(true);
                  }
                }}
                onOpenSettings={() => setSettingsOpen(true)}
                onShare={handleShare}
                onClose={onClose}
                onMinimize={onMinimize}
                onPrevious={onPlayPrevious}
                onNext={onPlayNext}
                onDismiss={() => {
                  // Tapping the empty area while playing = hide controls
                  if (player.status === 'playing') setControlsVisible(false);
                }}
                onUserInteraction={() => resetHideTimer(3000)}
                onScrubStart={handleScrubStart}
                onScrubEnd={handleScrubEnd}
              />
            )}

            {/* ── Always-visible YouTube-style thin progress bar at bottom ──
                Visible even when controls are hidden (just like YouTube's red bar) */}
            {player.status !== 'error' && player.duration > 0 && (
              <div
                className={`absolute bottom-0 left-0 right-0 h-[3px] z-20 pointer-events-none transition-opacity duration-200 ${
                  controlsVisible ? 'opacity-0' : 'opacity-100'
                }`}
                aria-hidden="true"
              >
                {/* Buffer */}
                <div
                  className="absolute top-0 left-0 h-full bg-white/25"
                  style={{ width: `${Math.min(100, (player.bufferedEnd / player.duration) * 100)}%` }}
                />
                {/* Progress */}
                <div
                  className="absolute top-0 left-0 h-full bg-primary"
                  style={{ width: `${Math.min(100, (player.currentTime / player.duration) * 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── VIDEO INFORMATION SECTION (Windowed Mode Only) ── */}
        {!fullscreen.isFullscreen && (
          <section
            ref={infoSectionRef}
            className="space-y-4 sm:space-y-5 max-w-5xl lg:max-w-6xl mx-auto"
          >
            {/* Title & Channel */}
            <div className="p-4 sm:p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] backdrop-blur-sm space-y-3 sm:space-y-4">
              <div className="space-y-1.5">
                {/* Clicking the title scrolls back to it (useful on long info pages) */}
                <h1
                  className="font-headline font-bold text-base sm:text-xl lg:text-2xl text-white leading-snug line-clamp-2 break-words cursor-pointer hover:text-primary transition-colors"
                  title={source.title}
                  onClick={() => {
                    infoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {source.title}
                </h1>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-white/50">
                  {source.author && (
                    <span className="font-semibold text-white/80 flex items-center gap-1.5">
                      {source.platform && source.platform !== 'unknown'
                        ? <PlatformIcon platform={source.platform as import('@/components/PlatformIcon').Platform} className="w-3.5 h-3.5" />
                        : <User className="w-3.5 h-3.5 text-primary" />
                      }
                      {source.author}
                    </span>
                  )}
                  {player.duration > 0 && (
                    <span>• {formatTime(player.duration)}</span>
                  )}
                  {(source.quality || activeQuality) && (
                    <span className="bg-white/10 px-2 py-0.5 rounded-md font-mono text-[10px] text-white/70 uppercase">
                      {source.quality || activeQuality}
                    </span>
                  )}
                  {source.fileSize && (
                    <span className="bg-white/5 px-2 py-0.5 rounded-md font-mono text-[10px] text-white/60">
                      {source.fileSize}
                    </span>
                  )}
                  {source.platform && (
                    <span className="text-[11px] text-primary/80 capitalize">
                      {source.platform}
                    </span>
                  )}
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.05]">
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/80 hover:text-white border border-white/5 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Share Link</span>
                </button>

                <button
                  type="button"
                  onClick={fullscreen.toggleFullscreen}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/80 hover:text-white border border-white/5 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  <Maximize className="w-3.5 h-3.5 text-primary" />
                  <span>Fullscreen (F)</span>
                </button>

                {pip.isSupported && (
                  <button
                    type="button"
                    onClick={pip.togglePiP}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${pip.isPiP
                        ? 'bg-primary/20 border-primary/40 text-primary'
                        : 'bg-white/[0.04] hover:bg-white/[0.08] text-white/80 hover:text-white border-white/5'
                      }`}
                  >
                    <PictureInPicture className="w-3.5 h-3.5" />
                    <span>{pip.isPiP ? 'Exit PiP' : 'Picture-in-Picture (P)'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* ── UP NEXT / SAVED DOWNLOADS SHELF ── */}
            {recentVideos.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline font-bold text-sm sm:text-base text-white flex items-center gap-2">
                    <Film className="w-4 h-4 text-primary" />
                    <span>Up Next in Library</span>
                  </h3>
                  <span className="text-xs text-white/40 font-mono">
                    {recentVideos.length} saved
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {recentVideos.slice(0, 6).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (onSwitchVideo) {
                          onSwitchVideo({
                            id: item.id,
                            url: item.fileUrl,
                            title: item.title,
                            thumbnail: item.thumbnail,
                            duration: item.duration,
                            author: item.author,
                            mimeType: item.mimeType,
                            quality: item.quality,
                            fileSize: item.fileSize,
                            platform: item.platform,
                          });
                        }
                      }}
                      className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-primary/40 hover:bg-white/[0.05] transition-all group text-left cursor-pointer active:scale-[0.98]"
                    >
                      <div className="relative w-20 h-14 rounded-xl bg-black overflow-hidden shrink-0">
                        {item.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnail}
                            alt=""
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-white/[0.04]">
                            <Film className="w-4 h-4 text-white/25" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Play className="w-4 h-4 fill-white text-white" />
                        </div>
                        {item.duration > 0 && (
                          <span className="absolute bottom-1 right-1 bg-black/90 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded text-white/80">
                            {formatTime(item.duration)}
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs text-white line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                          {item.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-white/40">
                          {item.completionPct >= 95 ? (
                            <span className="text-emerald-400 flex items-center gap-0.5">
                              <CheckCircle2 className="w-2.5 h-2.5" /> Watched
                            </span>
                          ) : (
                            <span>{item.completionPct}% watched</span>
                          )}
                          {item.fileSize && <span>{item.fileSize}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Settings Bottom Sheet / Popover */}
      <SettingsMenu
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={player.settings}
        onUpdateRate={player.setPlaybackRate}
        onUpdateFitMode={player.setFitMode}
        onToggleLoop={player.toggleLoop}
        onToggleAutoplayNext={() => player.setAutoplayNext(!player.settings.autoplayNext)}
        onUpdateSeekAmount={player.setSeekAmount}
        onOpenSubtitles={() => setSubtitlesOpen(true)}
        qualities={qualities}
        activeQuality={activeQuality}
        onSelectQuality={onSelectQuality}
      />

      {/* Subtitles Drawer */}
      <SubtitleMenu
        isOpen={subtitlesOpen}
        onClose={() => setSubtitlesOpen(false)}
        tracks={subtitleTracks}
        activeTrackId={activeSubtitleTrackId}
        onSelectTrack={setActiveSubtitleTrackId}
        onAddTrack={(track) => setSubtitleTracks((prev) => [...prev, track])}
        subtitleSize={subtitleSize}
        onChangeSize={setSubtitleSize}
      />
    </div>
  );
};