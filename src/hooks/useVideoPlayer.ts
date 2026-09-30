// useVideoPlayer.ts
// Comprehensive video playback controller and state machine

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getPlayerSettings,
  savePlayerSettings,
  getWatchPosition,
  saveWatchPosition,
  upsertWatchHistory,
  WatchHistoryEntry,
  PlayerSettings,
} from '@/lib/player-storage';
import { formatTime } from '@/lib/format-utils';
import { checkMediaSupport } from '@/lib/media-utils';
import { getSafeMediaUrl } from '@/lib/indexed-media-store';

export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'seeking'
  | 'ended'
  | 'error';

export interface VideoSource {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  duration?: number;
  author?: string;
  mimeType?: string;
  quality?: string;
  fileSize?: string;
  platform?: string;
}

export interface UseVideoPlayerProps {
  source: VideoSource | null;
  onEnded?: () => void;
  autoPlay?: boolean;
}

export function useVideoPlayer({ source, onEnded, autoPlay = true }: UseVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Core state
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(source?.duration || 0);
  const [bufferedEnd, setBufferedEnd] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVideoLandscape, setIsVideoLandscape] = useState<boolean>(true);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [videoWidth, setVideoWidth] = useState<number>(1920);
  const [videoHeight, setVideoHeight] = useState<number>(1080);

  // Resume notification state
  const [resumePrompt, setResumePrompt] = useState<{
    position: number;
    formatted: string;
  } | null>(null);

  // Settings loaded from local storage
  const [settings, setSettings] = useState<PlayerSettings>(() => getPlayerSettings());

  // Throttled timeupdate ref
  const lastTimeUpdateRef = useRef<number>(0);
  const saveHistoryIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Initial Format Support Check
  useEffect(() => {
    if (!source || !source.url) {
      setStatus('idle');
      return;
    }

    const check = checkMediaSupport(source.url, source.mimeType);
    if (!check.supported && check.reason) {
      setStatus('error');
      setErrorMessage(check.reason);
      return;
    }

    setErrorMessage(null);
    setStatus('loading');

    // Check for saved watch position
    const savedPos = getWatchPosition(source.id);
    const knownDuration = source.duration || 0;
    const isNearlyComplete = knownDuration > 0 && (savedPos / knownDuration) >= 0.95;

    if (savedPos > 10 && !isNearlyComplete) {
      setResumePrompt({
        position: savedPos,
        formatted: formatTime(savedPos),
      });
    } else {
      setResumePrompt(null);
    }
  }, [source?.id, source?.url, source?.mimeType, source?.duration]);

  // 2. Attach Video Event Listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;

    let isCancelled = false;

    // Check if blob: URL needs revival from IndexedDB
    if (source.url.startsWith('blob:')) {
      getSafeMediaUrl(source.id, source.url).then((resolved) => {
        if (!isCancelled && resolved.isRevived && video && video.src !== resolved.url) {
          video.src = resolved.url;
        }
      }).catch(() => {});
    }

    // Apply stored volume & playback settings
    video.volume = settings.muted ? 0 : settings.volume;
    video.muted = settings.muted;
    video.playbackRate = settings.playbackRate;
    video.loop = settings.loop;

    const handleLoadedMetadata = () => {
      const dur = video.duration || source.duration || 0;
      setDuration(dur);
      setStatus('ready');

      // Aspect ratio
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoWidth(video.videoWidth);
        setVideoHeight(video.videoHeight);
        setAspectRatio(video.videoWidth / video.videoHeight);
        setIsVideoLandscape(video.videoWidth >= video.videoHeight);
      }

      if (autoPlay) {
        video.play().catch(() => {
          // Autoplay blocked by browser policy; user will tap play
          setStatus('paused');
        });
      }
    };

    const handlePlay = () => setStatus('playing');
    const handlePause = () => {
      if (video.ended) {
        setStatus('ended');
      } else {
        setStatus('paused');
      }
    };
    const handleWaiting = () => setStatus('buffering');
    const handlePlaying = () => setStatus('playing');
    const handleSeeking = () => setStatus('seeking');
    const handleSeeked = () => {
      if (video.paused) {
        setStatus('paused');
      } else {
        setStatus('playing');
      }
    };

    const handleTimeUpdate = () => {
      const now = performance.now();
      // Throttle React state updates to ~10 times per second for maximum performance
      if (now - lastTimeUpdateRef.current > 100 || video.paused) {
        lastTimeUpdateRef.current = now;
        setCurrentTime(video.currentTime);
      }

      // Update buffer range
      if (video.buffered.length > 0) {
        try {
          const end = video.buffered.end(video.buffered.length - 1);
          setBufferedEnd(end);
        } catch {
          // ignore
        }
      }
    };

    const handleEnded = () => {
      setStatus('ended');
      // Save 100% completion
      if (source) {
        saveWatchPosition(source.id, 0);
        upsertWatchHistory({
          id: source.id,
          title: source.title,
          thumbnail: source.thumbnail,
          duration: video.duration || source.duration || 0,
          lastPosition: 0,
          lastWatched: Date.now(),
          completionPct: 100,
          fileUrl: source.url,
          fileSize: source.fileSize,
          quality: source.quality,
          mimeType: source.mimeType,
          author: source.author,
          platform: source.platform,
        });
      }
      if (onEnded) onEnded();
    };

    const handleError = async () => {
      // Automatic recovery for blob: URLs (e.g. Chrome unmapped file or refreshed session)
      if (source && source.url.startsWith('blob:') && video) {
        try {
          const resolved = await getSafeMediaUrl(source.id, source.url);
          if (resolved.isRevived && resolved.url !== video.src) {
            video.src = resolved.url;
            video.load();
            video.play().catch(() => {});
            return;
          }
        } catch {
          // ignore recovery error
        }
      }

      setStatus('error');
      const err = video?.error;
      let msg = 'Failed to load video.';
      if (source?.url.startsWith('blob:')) {
        msg = "The local video file is no longer accessible. Please re-open the file using 'Open File' in My Library.";
      } else if (err) {
        if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          msg = "This video format or codec isn't supported by this browser.";
        } else if (err.code === MediaError.MEDIA_ERR_NETWORK) {
          msg = 'Network connection interrupted while streaming media.';
        } else if (err.code === MediaError.MEDIA_ERR_DECODE) {
          msg = 'Video playback corrupted or codec incompatible.';
        }
      }
      setErrorMessage(msg);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('seeking', handleSeeking);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      isCancelled = true;
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('seeking', handleSeeking);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [source, autoPlay, onEnded, settings]);

  // 3. Periodic Watch Position & History Saving
  useEffect(() => {
    if (!source) return;

    saveHistoryIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && video.currentTime > 2) {
        const cur = video.currentTime;
        const dur = video.duration || source.duration || 1;
        const pct = Math.min(100, Math.round((cur / dur) * 100));

        saveWatchPosition(source.id, cur);
        upsertWatchHistory({
          id: source.id,
          title: source.title,
          thumbnail: source.thumbnail,
          duration: dur,
          lastPosition: cur,
          lastWatched: Date.now(),
          completionPct: pct,
          fileUrl: source.url,
          fileSize: source.fileSize,
          quality: source.quality,
          mimeType: source.mimeType,
          author: source.author,
          platform: source.platform,
        });
      }
    }, 4000);

    return () => {
      if (saveHistoryIntervalRef.current) {
        clearInterval(saveHistoryIntervalRef.current);
      }
    };
  }, [source]);

  // 4. Playback Controls
  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
    } catch (e) {
      console.warn('Playback play request was prevented:', e);
    }
  }, []);

  const pause = useCallback(() => {
    const video = videoRef.current;
    if (video) video.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      play();
    } else {
      pause();
    }
  }, [play, pause]);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(time, video.duration || Infinity));
    video.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const seekRelative = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    seek(video.currentTime + seconds);
  }, [seek]);

  const setVolume = useCallback((val: number) => {
    const video = videoRef.current;
    const clamped = Math.max(0, Math.min(1, val));
    if (video) {
      video.volume = clamped;
      video.muted = clamped === 0;
    }
    const updated = { volume: clamped, muted: clamped === 0 };
    setSettings((prev) => ({ ...prev, ...updated }));
    savePlayerSettings(updated);
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    if (!nextMuted && video.volume === 0) {
      video.volume = 0.5;
    }
    const updated = { muted: nextMuted, volume: video.volume };
    setSettings((prev) => ({ ...prev, ...updated }));
    savePlayerSettings(updated);
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
    setSettings((prev) => ({ ...prev, playbackRate: rate }));
    savePlayerSettings({ playbackRate: rate });
  }, []);

  const toggleLoop = useCallback(() => {
    const video = videoRef.current;
    const nextLoop = !settings.loop;
    if (video) video.loop = nextLoop;
    setSettings((prev) => ({ ...prev, loop: nextLoop }));
    savePlayerSettings({ loop: nextLoop });
  }, [settings.loop]);

  const setFitMode = useCallback((mode: 'contain' | 'cover') => {
    setSettings((prev) => ({ ...prev, fitMode: mode }));
    savePlayerSettings({ fitMode: mode });
  }, []);

  const setSeekAmount = useCallback((amount: 5 | 10 | 15 | 30) => {
    setSettings((prev) => ({ ...prev, seekAmount: amount }));
    savePlayerSettings({ seekAmount: amount });
  }, []);

  const setAutoplayNext = useCallback((val: boolean) => {
    setSettings((prev) => ({ ...prev, autoplayNext: val }));
    savePlayerSettings({ autoplayNext: val });
  }, []);

  const resume = useCallback(() => {
    if (resumePrompt) {
      seek(resumePrompt.position);
      setResumePrompt(null);
      play();
    }
  }, [resumePrompt, seek, play]);

  const restart = useCallback(() => {
    seek(0);
    setResumePrompt(null);
    play();
  }, [seek, play]);

  const retry = useCallback(() => {
    const video = videoRef.current;
    if (video && source) {
      setErrorMessage(null);
      setStatus('loading');
      video.load();
      video.play().catch(() => {});
    }
  }, [source]);

  return {
    videoRef,
    status,
    currentTime,
    duration,
    bufferedEnd,
    errorMessage,
    isVideoLandscape,
    aspectRatio,
    videoWidth,
    videoHeight,
    resumePrompt,
    settings,
    play,
    pause,
    togglePlay,
    seek,
    seekRelative,
    setVolume,
    toggleMute,
    setPlaybackRate,
    toggleLoop,
    setFitMode,
    setSeekAmount,
    setAutoplayNext,
    resume,
    restart,
    retry,
    setResumePrompt,
  };
}