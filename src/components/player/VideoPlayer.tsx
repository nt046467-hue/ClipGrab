// VideoPlayer.tsx
// Master production-grade ClipGrab video player component for mobile & desktop
// Features: real Fullscreen API wrapper, 2x long-press with ratechange protection,
// seekbar above buttons, 40px+ touch targets, 60fps RAF progress bar, and 3s auto-hide

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
import { useControlsVisibility } from '@/hooks/useControlsVisibility';
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
  Pause,
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

const SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

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
  const infoSectionRef = useRef<HTMLElement | null>(null);

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

  // Real Fullscreen controller attached to the .player-shell wrapper
  const fullscreen = useFullscreen(containerRef, player.isVideoLandscape, player.videoRef);

  // PiP controller
  const pip = usePictureInPicture(player.videoRef);

  // ── Unified Controls Visibility Hook ──
  const controls = useControlsVisibility({
    status: player.status,
    sourceId: source.id,
    autoHideDuration: 3000,
  });

  // Pin controls while settings or subtitles modal is open
  useEffect(() => {
    if (settingsOpen || subtitlesOpen) {
      controls.pin('menu');
    } else {
      controls.unpin('menu');
    }
  }, [settingsOpen, subtitlesOpen, controls]);

  // Load other saved videos for queue/shelf below player
  useEffect(() => {
    try {
      const history = getWatchHistory();
      setRecentVideos(history.filter((h) => h.id !== source.id));
    } catch {
      // ignore storage errors
    }
  }, [source.id]);

  // ── Screen Wake Lock API (keeps screen awake while playing) ──
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    const requestWakeLock = async () => {
      if (
        typeof navigator !== 'undefined' &&
        'wakeLock' in navigator &&
        (navigator as any).wakeLock
      ) {
        try {
          if (!wakeLockRef.current && player.status === 'playing') {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
            wakeLockRef.current.addEventListener('release', () => {
              wakeLockRef.current = null;
            });
          }
        } catch {
          // wake lock request may be denied on battery saver or tab blur
        }
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch {}
        wakeLockRef.current = null;
      }
    };

    if (player.status === 'playing') {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && player.status === 'playing') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [player.status]);

  // ── On-screen toast notifications (volume, speed, seek, mute) ──
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 1100);
  }, []);

  // ── Unified Gesture Recognizer with Direct Video 2x Speed ──
  const gestures = usePlayerGestures({
    seekAmount: player.settings.seekAmount,
    duration: player.duration,
    currentTime: player.currentTime,
    isFullscreen: fullscreen.isFullscreen,
    playerStatus: player.status,
    videoRef: player.videoRef,
    onSeek: player.seek,
    onSeekRelative: player.seekRelative,
    onTogglePlay: player.togglePlay,
    onToggleFullscreen: fullscreen.toggleFullscreen,
    onMinimize,
    controlsVisibleRef: controls.visibleRef,
    showControls: controls.show,
    hideControls: controls.hide,
    keepAlive: controls.keepAlive,
    pin: controls.pin,
    unpin: controls.unpin,
  });

  // ── Desktop Keyboard Hotkeys (F for Fullscreen, P for PiP, Space, K, J, L, etc.) ──
  useKeyboardControls(
    {
      onTogglePlay: () => {
        player.togglePlay();
        showToast(player.status === 'playing' ? 'Pause' : 'Play');
      },
      onSeekRelative: (seconds) => {
        player.seekRelative(seconds);
        const target = Math.max(0, Math.min(player.duration || Infinity, player.currentTime + seconds));
        showToast(`${seconds > 0 ? '+' : ''}${seconds}s (${formatTime(target)})`);
      },
      onSeekToPercent: (pct) => {
        if (player.duration > 0) {
          const target = pct * player.duration;
          player.seek(target);
          showToast(`${Math.round(pct * 100)}% (${formatTime(target)})`);
        }
      },
      onSeekToStart: () => {
        player.seek(0);
        showToast('00:00');
      },
      onSeekToEnd: () => {
        if (player.duration > 0) {
          player.seek(player.duration);
          showToast(formatTime(player.duration));
        }
      },
      onVolumeUp: () => {
        const next = Math.min(1, Math.round((player.settings.volume + 0.05) * 100) / 100);
        player.setVolume(next);
        showToast(`Volume ${Math.round(next * 100)}%`);
      },
      onVolumeDown: () => {
        const next = Math.max(0, Math.round((player.settings.volume - 0.05) * 100) / 100);
        player.setVolume(next);
        showToast(`Volume ${Math.round(next * 100)}%`);
      },
      onToggleMute: () => {
        player.toggleMute();
        showToast(!player.settings.muted ? 'Muted' : 'Unmuted');
      },
      onToggleFullscreen: fullscreen.toggleFullscreen,
      onTogglePiP: pip.togglePiP,
      onToggleCaptions: () => {
        if (subtitleTracks.length > 0) {
          setActiveSubtitleTrackId((prev) => {
            const next = prev ? null : subtitleTracks[0].id;
            showToast(next ? 'Subtitles On' : 'Subtitles Off');
            return next;
          });
        } else {
          setSubtitlesOpen(true);
        }
      },
      onStepSpeed: (direction) => {
        const current = player.settings.playbackRate;
        let idx = SPEED_STEPS.findIndex((s) => s === current);
        if (idx === -1) idx = SPEED_STEPS.findIndex((s) => s >= current);
        const nextIdx = Math.max(0, Math.min(SPEED_STEPS.length - 1, (idx === -1 ? 3 : idx) + direction));
        const nextSpeed = SPEED_STEPS[nextIdx];
        player.setPlaybackRate(nextSpeed);
        showToast(`Speed ${nextSpeed}x`);
      },
      onCloseSettings: () => {
        if (settingsOpen) setSettingsOpen(false);
        else if (subtitlesOpen) setSubtitlesOpen(false);
        else if (fullscreen.isFullscreen) fullscreen.exitFullscreen();
        else onClose();
      },
      onActivity: () => {
        controls.show(true);
        controls.keepAlive();
      },
    },
    !settingsOpen && !subtitlesOpen
  );

  // Native Media Session integration
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
        showToast('Stream link copied to clipboard!');
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
          onWheel={(e) => {
            if (fullscreen.isFullscreen) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.05 : -0.05;
            const newVol = Math.min(1, Math.max(0, Math.round((player.settings.volume + delta) * 100) / 100));
            player.setVolume(newVol);
            showToast(`Volume ${Math.round(newVol * 100)}%`);
            controls.show(true);
            controls.keepAlive();
          }}
          className={
            fullscreen.isFullscreen
              ? "fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden w-screen h-[100dvh] max-w-none max-h-none rounded-none border-none"
              : "player-shell relative w-full bg-black rounded-2xl sm:rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.85)] border border-white/[0.08] mx-auto flex items-center justify-center"
          }
          style={{
            aspectRatio: fullscreen.isFullscreen ? 'auto' : `${aspectRatioValue}`,
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
            touchAction: fullscreen.isFullscreen ? 'none' : 'pan-y',
            WebkitTapHighlightColor: 'transparent',
            cursor: fullscreen.isFullscreen && !controls.visible ? 'none' : 'default',
            transform:
              !fullscreen.isFullscreen && gestures.dragTranslateY !== 0
                ? `translateY(${gestures.dragTranslateY}px)`
                : undefined,
            transition: gestures.dragTranslateY !== 0 ? 'none' : 'transform 200ms ease-out',
          }}
        >
          {/* Main Gesture & Video Layer — covers the whole player at all times */}
          <div
            className="relative w-full h-full flex items-center justify-center overflow-hidden bg-black select-none touch-manipulation"
            onPointerDown={gestures.handlePointerDown}
            onPointerMove={gestures.handlePointerMove}
            onPointerUp={gestures.handlePointerUp}
            onPointerCancel={gestures.handlePointerCancel}
            onPointerLeave={gestures.handlePointerLeave}
            onContextMenu={gestures.handleContextMenu}
            style={{
              touchAction: 'manipulation',
              WebkitTouchCallout: 'none',
              userSelect: 'none',
            }}
          >
            <video
              ref={player.videoRef}
              src={source.url}
              poster={source.thumbnail || undefined}
              playsInline
              className={`w-full h-full transition-all duration-300 pointer-events-none ${
                player.settings.fitMode === 'cover' ? 'object-cover' : 'object-contain'
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
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 px-5 py-3 rounded-2xl bg-black/85 border border-white/20 text-white font-mono font-bold text-base sm:text-lg backdrop-blur-md shadow-2xl flex items-center gap-2 pointer-events-none select-none">
                <span className="text-primary font-bold">Seek:</span>
                <span>{formatTime(gestures.swipeSeekTime)}</span>
              </div>
            )}

            {/* Double-tap Seek Feedback Ripple (mobile) */}
            <SeekOverlay feedback={gestures.feedback} />

            {/* Double-tap Center Play/Pause Pop Icon */}
            {gestures.centerPop && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none animate-in zoom-in-75 fade-in duration-150">
                <div className="w-16 h-16 rounded-full bg-black/70 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-2xl text-white">
                  {player.status === 'playing' ? (
                    <Play className="w-8 h-8 fill-white ml-1" />
                  ) : (
                    <Pause className="w-8 h-8 fill-white" />
                  )}
                </div>
              </div>
            )}

            {/* Long-press 2x Speed Pill (YouTube style) */}
            {gestures.isSpeeding && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-black/85 backdrop-blur-md border border-white/20 text-white flex items-center gap-2 text-xs font-bold tracking-wide shadow-2xl animate-in fade-in zoom-in-95 pointer-events-none select-none">
                <span>2x</span>
                <span className="text-primary flex items-center">▶▶</span>
              </div>
            )}

            {/* Keyboard & Action On-Screen Toast */}
            {toastMessage && (
              <div className="absolute top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-black/85 backdrop-blur-md border border-white/20 text-white font-mono text-xs sm:text-sm font-bold shadow-2xl pointer-events-none animate-in fade-in zoom-in-95 duration-100 select-none">
                {toastMessage}
              </div>
            )}

            {/* Buffering Indicator — shown when controls are hidden */}
            {player.status === 'buffering' && !controls.visible && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
                <div className="p-4 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-2xl">
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                </div>
              </div>
            )}

            {/* Resume Prompt Banner */}
            {player.resumePrompt && (
              <div
                className="absolute top-16 left-4 right-4 sm:left-auto sm:right-6 sm:w-80 z-40 p-4 rounded-2xl bg-[#0d1017]/98 border border-white/20 shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-4 duration-300 pointer-events-auto"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs sm:text-sm font-bold text-white">
                    Resume Playback?
                  </div>
                  <button
                    type="button"
                    onClick={() => player.setResumePrompt(null)}
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
                    onClick={player.resume}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-primary/25 transition-all active:scale-95 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Resume</span>
                  </button>
                  <button
                    type="button"
                    onClick={player.restart}
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
              const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
              const isBlobUrl = source.url.startsWith('blob:');
              const isColabTunnel = source.url.includes('trycloudflare.com');
              const isServerUrl = source.url.startsWith('http') && !isBlobUrl;
              const showDownloadFallback = (isNetworkErr || isOffline) && isServerUrl && !isColabTunnel;

              return (
                <div className="absolute inset-0 z-40 flex flex-col items-center justify-center p-6 bg-black/90 backdrop-blur-md text-center pointer-events-auto">
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
                              player.videoRef.current!.play().catch(() => {});
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
              <div className="absolute inset-0 z-40 pointer-events-auto">
                <EndScreen
                  source={source}
                  nextItem={nextItem}
                  onReplay={player.restart}
                  onPlayNext={onPlayNext}
                  onBack={onClose}
                />
              </div>
            )}

            {/* Controls Overlay */}
            {player.status !== 'error' && player.status !== 'ended' && (
              <PlayerControls
                visible={controls.visible}
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
                videoRef={player.videoRef}
                hasPrevious={!!previousItem}
                hasNext={!!nextItem}
                onPlay={player.play}
                onPause={player.pause}
                onSeek={player.seek}
                onSeekRelative={player.seekRelative}
                onVolumeChange={player.setVolume}
                onToggleMute={player.toggleMute}
                onToggleFullscreen={fullscreen.toggleFullscreen}
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
                onInteract={() => controls.keepAlive(3000)}
                onPin={controls.pin}
                onUnpin={controls.unpin}
                onScrubStart={() => controls.pin('scrubbing')}
                onScrubEnd={() => controls.unpin('scrubbing')}
              />
            )}

            {/* Always-visible thin progress bar at bottom when controls are hidden */}
            {player.status !== 'error' && player.duration > 0 && (
              <div
                className={`absolute left-0 right-0 h-[3px] z-20 pointer-events-none transition-opacity duration-200 ${
                  controls.visible ? 'opacity-0' : 'opacity-100'
                }`}
                style={{
                  bottom: fullscreen.isFullscreen ? 'env(safe-area-inset-bottom, 0px)' : '0px',
                }}
                aria-hidden="true"
              >
                <div
                  className="absolute top-0 left-0 h-full bg-white/25"
                  style={{ width: `${Math.min(100, (player.bufferedEnd / player.duration) * 100)}%` }}
                />
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
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
                      pip.isPiP
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