// usePictureInPicture.ts
// Picture-in-Picture management with automatic browser capability detection

import { useState, useEffect, useCallback, RefObject } from 'react';

export interface UsePictureInPictureResult {
  isPiP: boolean;
  isSupported: boolean;
  togglePiP: () => Promise<void>;
  enterPiP: () => Promise<void>;
  exitPiP: () => Promise<void>;
}

export function usePictureInPicture(videoRef: RefObject<HTMLVideoElement | null>): UsePictureInPictureResult {
  const [isPiP, setIsPiP] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const doc = document as any;
    const supported =
      !!doc.pictureInPictureEnabled ||
      (videoRef.current && (videoRef.current as any).webkitSupportsPresentationMode);
    setIsSupported(!!supported);
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnterPiP = () => setIsPiP(true);
    const handleLeavePiP = () => setIsPiP(false);

    video.addEventListener('enterpictureinpicture', handleEnterPiP);
    video.addEventListener('leavepictureinpicture', handleLeavePiP);

    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnterPiP);
      video.removeEventListener('leavepictureinpicture', handleLeavePiP);
    };
  }, [videoRef]);

  const enterPiP = useCallback(async () => {
    const video = videoRef.current as any;
    if (!video) return;

    try {
      if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      } else if (
        video.webkitSupportsPresentationMode &&
        typeof video.webkitSetPresentationMode === 'function'
      ) {
        video.webkitSetPresentationMode('picture-in-picture');
      }
    } catch (err) {
      console.warn('PiP request failed:', err);
    }
  }, [videoRef]);

  const exitPiP = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        const video = videoRef.current as any;
        if (
          video &&
          video.webkitSupportsPresentationMode &&
          typeof video.webkitSetPresentationMode === 'function'
        ) {
          video.webkitSetPresentationMode('inline');
        }
      }
    } catch (err) {
      console.warn('PiP exit failed:', err);
    }
  }, [videoRef]);

  const togglePiP = useCallback(async () => {
    if (isPiP) {
      await exitPiP();
    } else {
      await enterPiP();
    }
  }, [isPiP, enterPiP, exitPiP]);

  return {
    isPiP,
    isSupported,
    togglePiP,
    enterPiP,
    exitPiP,
  };
}