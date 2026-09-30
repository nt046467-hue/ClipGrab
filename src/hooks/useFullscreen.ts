// useFullscreen.ts
// Robust cross-browser Fullscreen Hook targeting the player wrapper with iOS fallback & orientation lock

import { useState, useEffect, useCallback, RefObject } from 'react';

export interface UseFullscreenResult {
  isFullscreen: boolean;
  isSupported: boolean;
  toggleFullscreen: () => Promise<void>;
  enterFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
}

export function useFullscreen(
  wrapperRef: RefObject<HTMLElement | null>,
  isVideoLandscape?: boolean,
  videoRef?: RefObject<HTMLVideoElement | null>
): UseFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const doc = document as any;
    const supported = !!(
      doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      doc.mozFullScreenEnabled ||
      doc.msFullscreenEnabled ||
      (videoRef?.current && (videoRef.current as any).webkitSupportsFullscreen)
    );
    setIsSupported(supported);
  }, [videoRef]);

  // Sync isFullscreen state strictly from browser fullscreen events
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleFullscreenChange = () => {
      const doc = document as any;
      const fullscreenElem =
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement;

      const wrapper = wrapperRef.current;
      const active = Boolean(fullscreenElem && (fullscreenElem === wrapper || (wrapper && wrapper.contains(fullscreenElem))));
      setIsFullscreen(active);

      // Unlock orientation on exiting fullscreen
      if (!active && typeof screen !== 'undefined' && screen.orientation && typeof (screen.orientation as any).unlock === 'function') {
        try {
          (screen.orientation as any).unlock();
        } catch {
          // ignore orientation unlock failures
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // iOS Safari native video fullscreen events
    const video = videoRef?.current as any;
    const handleVideoEnterFullscreen = () => setIsFullscreen(true);
    const handleVideoExitFullscreen = () => setIsFullscreen(false);

    if (video) {
      video.addEventListener('webkitbeginfullscreen', handleVideoEnterFullscreen);
      video.addEventListener('webkitendfullscreen', handleVideoExitFullscreen);
    }

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);

      if (video) {
        video.removeEventListener('webkitbeginfullscreen', handleVideoEnterFullscreen);
        video.removeEventListener('webkitendfullscreen', handleVideoExitFullscreen);
      }
    };
  }, [wrapperRef, videoRef]);

  const enterFullscreen = useCallback(async () => {
    const wrapper = wrapperRef.current as any;
    const video = videoRef?.current as any;

    try {
      if (wrapper) {
        if (wrapper.requestFullscreen) {
          await wrapper.requestFullscreen({ navigationUI: 'hide' });
        } else if (wrapper.webkitRequestFullscreen) {
          await wrapper.webkitRequestFullscreen();
        } else if (wrapper.mozRequestFullScreen) {
          await wrapper.mozRequestFullScreen();
        } else if (wrapper.msRequestFullscreen) {
          await wrapper.msRequestFullscreen();
        } else if (video && typeof video.webkitEnterFullscreen === 'function') {
          // iOS Safari fallback (wrapper fullscreen not supported on iPhone Safari)
          video.webkitEnterFullscreen();
        }
      } else if (video && typeof video.webkitEnterFullscreen === 'function') {
        video.webkitEnterFullscreen();
      }

      // Try orientation lock for landscape video on mobile if supported
      if (
        isVideoLandscape &&
        typeof screen !== 'undefined' &&
        screen.orientation &&
        typeof (screen.orientation as any).lock === 'function'
      ) {
        try {
          await (screen.orientation as any).lock('landscape').catch(() => {});
        } catch {
          // Ignore orientation lock restrictions
        }
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
      if (video && typeof video.webkitEnterFullscreen === 'function') {
        try {
          video.webkitEnterFullscreen();
        } catch {}
      }
    }
  }, [wrapperRef, videoRef, isVideoLandscape]);

  const exitFullscreen = useCallback(async () => {
    const doc = document as any;
    const video = videoRef?.current as any;

    try {
      if (doc.exitFullscreen) {
        await doc.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      } else if (doc.mozCancelFullScreen) {
        await doc.mozCancelFullScreen();
      } else if (doc.msExitFullscreen) {
        await doc.msExitFullscreen();
      } else if (video && typeof video.webkitExitFullscreen === 'function') {
        video.webkitExitFullscreen();
      }

      if (typeof screen !== 'undefined' && screen.orientation && typeof (screen.orientation as any).unlock === 'function') {
        try {
          (screen.orientation as any).unlock();
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.warn('Exit fullscreen failed:', err);
    }
  }, [videoRef]);

  const toggleFullscreen = useCallback(async () => {
    const doc = document as any;
    const isDocFs = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );

    if (isFullscreen || isDocFs) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  return {
    isFullscreen,
    isSupported,
    toggleFullscreen,
    enterFullscreen,
    exitFullscreen,
  };
}