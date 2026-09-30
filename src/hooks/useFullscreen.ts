// useFullscreen.ts
// Robust cross-browser Fullscreen Hook with mobile landscape orientation handling

import { useState, useEffect, useCallback, RefObject } from 'react';

export interface UseFullscreenResult {
  isFullscreen: boolean;
  isSupported: boolean;
  toggleFullscreen: () => Promise<void>;
  enterFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
}

export function useFullscreen(
  targetRef: RefObject<HTMLElement | null>,
  isVideoLandscape?: boolean
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
      doc.msFullscreenEnabled
    );
    setIsSupported(supported);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleFullscreenChange = () => {
      const doc = document as any;
      const fullscreenElem =
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement;

      const active = !!fullscreenElem && fullscreenElem === targetRef.current;
      setIsFullscreen(active);

      // Unlock orientation if exiting fullscreen
      if (!active && screen && screen.orientation && (screen.orientation as any).unlock) {
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

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [targetRef]);

  const enterFullscreen = useCallback(async () => {
    const elem = targetRef.current as any;
    if (!elem) return;

    try {
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        await elem.webkitRequestFullscreen();
      } else if (elem.mozRequestFullScreen) {
        await elem.mozRequestFullScreen();
      } else if (elem.msRequestFullscreen) {
        await elem.msRequestFullscreen();
      }

      // Try orientation lock for landscape video on mobile if supported
      if (
        isVideoLandscape &&
        screen &&
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
    }
  }, [targetRef, isVideoLandscape]);

  const exitFullscreen = useCallback(async () => {
    const doc = document as any;
    try {
      if (doc.exitFullscreen) {
        await doc.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      } else if (doc.mozCancelFullScreen) {
        await doc.mozCancelFullScreen();
      } else if (doc.msExitFullscreen) {
        await doc.msExitFullscreen();
      }

      if (screen && screen.orientation && (screen.orientation as any).unlock) {
        try {
          (screen.orientation as any).unlock();
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.warn('Exit fullscreen failed:', err);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
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