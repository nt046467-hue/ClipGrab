// useMediaSession.ts
// Native lock-screen and hardware media control integration via Media Session API

import { useEffect } from 'react';

export interface MediaSessionProps {
  title?: string;
  artist?: string;
  thumbnail?: string;
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  playbackRate: number;
  seekAmount?: number;
  onPlay: () => void;
  onPause: () => void;
  onSeekBackward: () => void;
  onSeekForward: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSeekTo?: (details: { seekTime?: number; fastSeek?: boolean }) => void;
}

export function useMediaSession({
  title,
  artist,
  thumbnail,
  isPlaying,
  duration,
  currentTime,
  playbackRate,
  seekAmount = 10,
  onPlay,
  onPause,
  onSeekBackward,
  onSeekForward,
  onNext,
  onPrevious,
  onSeekTo,
}: MediaSessionProps): void {
  // Update Metadata
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;

    try {
      const artwork = thumbnail
        ? [
            {
              src: thumbnail,
              sizes: '512x512',
              type: thumbnail.endsWith('.png') ? 'image/png' : 'image/jpeg',
            },
          ]
        : [];

      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'ClipGrab Video',
        artist: artist || 'ClipGrab Media Player',
        album: 'ClipGrab Downloads',
        artwork,
      });
    } catch {
      // MediaMetadata creation might fail in certain webviews
    }
  }, [title, artist, thumbnail]);

  // Update Playback State & Position State
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

      if (duration > 0 && isFinite(duration) && isFinite(currentTime)) {
        if ('setPositionState' in navigator.mediaSession) {
          navigator.mediaSession.setPositionState({
            duration: Math.max(0, duration),
            playbackRate: playbackRate > 0 ? playbackRate : 1,
            position: Math.min(Math.max(0, currentTime), duration),
          });
        }
      }
    } catch {
      // ignore
    }
  }, [isPlaying, duration, currentTime, playbackRate]);

  // Register Action Handlers
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;

    const actionMap: Record<string, MediaSessionActionHandler | null> = {
      play: () => onPlay(),
      pause: () => onPause(),
      seekbackward: () => onSeekBackward(),
      seekforward: () => onSeekForward(),
      previoustrack: onPrevious ? () => onPrevious() : null,
      nexttrack: onNext ? () => onNext() : null,
      seekto: onSeekTo ? (details) => onSeekTo(details) : null,
    };

    Object.entries(actionMap).forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        // unsupported action in this browser
      }
    });

    return () => {
      Object.keys(actionMap).forEach((action) => {
        try {
          navigator.mediaSession.setActionHandler(action as MediaSessionAction, null);
        } catch {
          // ignore
        }
      });
    };
  }, [onPlay, onPause, onSeekBackward, onSeekForward, onNext, onPrevious, onSeekTo, seekAmount]);
}