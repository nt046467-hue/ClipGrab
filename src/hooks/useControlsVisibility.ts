// useControlsVisibility.ts
// Single source of truth for ClipGrab player controls visibility & auto-hide state machine

import { useState, useRef, useCallback, useEffect } from 'react';
import { PlayerStatus } from './useVideoPlayer';

export interface UseControlsVisibilityOptions {
  status: PlayerStatus;
  sourceId?: string;
  autoHideDuration?: number; // default 3000ms
}

export interface UseControlsVisibilityResult {
  visible: boolean;
  visibleRef: React.MutableRefObject<boolean>;
  show: (autoHide?: boolean) => void;
  hide: () => void;
  toggle: () => void;
  keepAlive: () => void;
  pin: (reason: string) => void;
  unpin: (reason: string) => void;
  isPinned: boolean;
}

export function useControlsVisibility({
  status,
  sourceId,
  autoHideDuration = 3000,
}: UseControlsVisibilityOptions): UseControlsVisibilityResult {
  const [visible, setVisibleState] = useState<boolean>(true);
  const visibleRef = useRef<boolean>(true);
  const pinsRef = useRef<Set<string>>(new Set<string>());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronous ref updater to eliminate any stale closure issues
  const setVisibleSync = useCallback((next: boolean) => {
    visibleRef.current = next;
    setVisibleState(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(
    (duration = autoHideDuration) => {
      clearTimer();
      // Auto-hide ONLY when playing and completely unpinned
      if (status === 'playing' && pinsRef.current.size === 0) {
        timerRef.current = setTimeout(() => {
          setVisibleSync(false);
          timerRef.current = null;
        }, duration);
      }
    },
    [status, autoHideDuration, clearTimer, setVisibleSync]
  );

  const show = useCallback(
    (autoHide = true) => {
      setVisibleSync(true);
      if (autoHide && status === 'playing' && pinsRef.current.size === 0) {
        startTimer();
      } else {
        clearTimer();
      }
    },
    [status, startTimer, clearTimer, setVisibleSync]
  );

  const hide = useCallback(() => {
    clearTimer();
    setVisibleSync(false);
  }, [clearTimer, setVisibleSync]);

  const keepAlive = useCallback(() => {
    if (visibleRef.current && status === 'playing' && pinsRef.current.size === 0) {
      startTimer();
    }
  }, [status, startTimer]);

  const toggle = useCallback(() => {
    if (visibleRef.current) {
      hide();
    } else {
      show(true);
    }
  }, [hide, show]);

  const pin = useCallback(
    (reason: string) => {
      pinsRef.current.add(reason);
      clearTimer();
    },
    [clearTimer]
  );

  const unpin = useCallback(
    (reason: string) => {
      pinsRef.current.delete(reason);
      if (visibleRef.current && status === 'playing' && pinsRef.current.size === 0) {
        startTimer();
      }
    },
    [status, startTimer]
  );

  // React to status changes:
  // When status becomes paused/ended/buffering/error: show controls and cancel the timer.
  // When status returns to 'playing': start the 3s timer.
  useEffect(() => {
    if (
      status === 'paused' ||
      status === 'ended' ||
      status === 'buffering' ||
      status === 'error'
    ) {
      clearTimer();
      setVisibleSync(true);
    } else if (status === 'playing') {
      if (pinsRef.current.size === 0) {
        startTimer();
      }
    }
  }, [status, clearTimer, setVisibleSync, startTimer]);

  // Video source change: reset pins & timer, show controls
  useEffect(() => {
    clearTimer();
    pinsRef.current.clear();
    setVisibleSync(true);
  }, [sourceId, clearTimer, setVisibleSync]);

  // Tab refocus (visibilitychange): show controls for 3s when tab becomes visible again
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        show(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [show]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return {
    visible,
    visibleRef,
    show,
    hide,
    toggle,
    keepAlive,
    pin,
    unpin,
    isPinned: pinsRef.current.size > 0,
  };
}
