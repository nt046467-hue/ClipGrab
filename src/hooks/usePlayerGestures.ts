// usePlayerGestures.ts
// Production-grade YouTube mobile player gesture system with Pointer Events
// Supports: instant tap reveal / 250ms hide on visible, left/right double-tap seek,
// center double-tap play/pause, long-press 2x speed (applied directly on video element & guarded against ratechange),
// horizontal swipe seek, windowed follow-the-finger vertical swipe (minimize/fullscreen), and desktop mouse handling.

import { useState, useRef, useCallback, PointerEvent, MouseEvent, useEffect, RefObject } from 'react';
import { PlayerStatus } from './useVideoPlayer';

export interface GestureFeedback {
  type: 'rewind' | 'forward' | null;
  amount: number;
  timestamp: number;
}

export interface UsePlayerGesturesProps {
  seekAmount: number;
  duration: number;
  currentTime: number;
  isFullscreen: boolean;
  playerStatus: PlayerStatus;
  videoRef: RefObject<HTMLVideoElement | null>;
  onSeek: (targetTime: number) => void;
  onSeekRelative: (seconds: number) => void;
  onTogglePlay: () => void;
  onToggleFullscreen?: () => void;
  onMinimize?: () => void;
  controlsVisibleRef: React.MutableRefObject<boolean>;
  showControls: (autoHide?: boolean) => void;
  hideControls: () => void;
  keepAlive: () => void;
  pin: (reason: string) => void;
  unpin: (reason: string) => void;
}

export function usePlayerGestures({
  seekAmount,
  duration,
  currentTime,
  isFullscreen,
  playerStatus,
  videoRef,
  onSeek,
  onSeekRelative,
  onTogglePlay,
  onToggleFullscreen,
  onMinimize,
  controlsVisibleRef,
  showControls,
  hideControls,
  keepAlive,
  pin,
  unpin,
}: UsePlayerGesturesProps) {
  // Feedback ripple state for SeekOverlay
  const [feedback, setFeedback] = useState<GestureFeedback>({
    type: null,
    amount: seekAmount,
    timestamp: 0,
  });

  // Swipe seek state
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeSeekTime, setSwipeSeekTime] = useState<number | null>(null);

  // Long press 2x state
  const [isSpeeding, setIsSpeeding] = useState(false);
  const isSpeedingRef = useRef<boolean>(false);
  const savedPlaybackRateRef = useRef<number>(1);
  const longPressedRef = useRef<boolean>(false);

  // Windowed vertical drag translation (px) for follow-the-finger feedback
  const [dragTranslateY, setDragTranslateY] = useState<number>(0);

  // Center double-tap icon pop animation
  const [centerPop, setCenterPop] = useState<boolean>(false);

  // Internal refs
  const clearFeedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedSeekRef = useRef<number>(0);
  const lastDoubleTapTimeRef = useRef<number>(0);
  const lastDoubleTapTypeRef = useRef<'rewind' | 'forward' | null>(null);

  // Touch tap handling refs
  const lastTouchTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const touchTapTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Long press timer ref
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Desktop mouse click handling refs
  const lastMouseClickRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const mouseClickTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Center pop timer
  const centerPopTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Pointer down tracking
  const pointerDownStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    initialTime: number;
    controlsWereVisible: boolean;
  } | null>(null);

  const gestureModeRef = useRef<'none' | 'horizontal_swipe' | 'vertical_swipe'>('none');

  // Re-apply 2x speed on ratechange / play / seeked events while long-press is active
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const enforceSpeed = () => {
      if (isSpeedingRef.current && video.playbackRate !== 2) {
        video.playbackRate = 2;
      }
    };

    video.addEventListener('ratechange', enforceSpeed);
    video.addEventListener('play', enforceSpeed);
    video.addEventListener('seeked', enforceSpeed);

    return () => {
      video.removeEventListener('ratechange', enforceSpeed);
      video.removeEventListener('play', enforceSpeed);
      video.removeEventListener('seeked', enforceSpeed);
    };
  }, [videoRef]);

  // Trigger double-tap feedback ripple
  const triggerFeedback = useCallback((type: 'rewind' | 'forward', amount: number) => {
    setFeedback({
      type,
      amount,
      timestamp: Date.now(),
    });

    if (clearFeedbackTimeoutRef.current) {
      clearTimeout(clearFeedbackTimeoutRef.current);
    }

    clearFeedbackTimeoutRef.current = setTimeout(() => {
      setFeedback((prev) => ({ ...prev, type: null }));
      accumulatedSeekRef.current = 0;
      lastDoubleTapTypeRef.current = null;
    }, 750);
  }, []);

  const triggerCenterPop = useCallback(() => {
    setCenterPop(true);
    if (centerPopTimerRef.current) clearTimeout(centerPopTimerRef.current);
    centerPopTimerRef.current = setTimeout(() => {
      setCenterPop(false);
    }, 550);
  }, []);

  // ── POINTER DOWN ──
  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      // Ignore right clicks or auxiliary buttons
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      // Ignore if press started on a button, seek bar, or input
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, input, [role="slider"], a, label')) {
        return;
      }

      if (e.pointerType === 'mouse') {
        pointerDownStateRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          startTime: Date.now(),
          initialTime: currentTime,
          controlsWereVisible: controlsVisibleRef.current,
        };
        return;
      }

      // Touch / Pen interactions:
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}

      const controlsWereVisible = controlsVisibleRef.current;
      pointerDownStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startTime: Date.now(),
        initialTime: currentTime,
        controlsWereVisible,
      };
      gestureModeRef.current = 'none';

      // Setup Long-press (>=400ms, no movement) = 2x speed while held
      // Only triggered while playing
      if (playerStatus === 'playing') {
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
          if (gestureModeRef.current === 'none') {
            const video = videoRef.current;
            if (video) {
              savedPlaybackRateRef.current = video.playbackRate || 1;
              video.playbackRate = 2;
              isSpeedingRef.current = true;
              longPressedRef.current = true;
              setIsSpeeding(true);
              pin('pressing');
              if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try {
                  navigator.vibrate(10);
                } catch {}
              }
            }
          }
        }, 400);
      }
    },
    [currentTime, controlsVisibleRef, playerStatus, videoRef, pin]
  );

  // ── POINTER MOVE ──
  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse') {
        showControls(true);
        keepAlive();
        return;
      }

      const pd = pointerDownStateRef.current;
      if (!pd || pd.pointerId !== e.pointerId) return;

      const deltaX = e.clientX - pd.startX;
      const deltaY = e.clientY - pd.startY;
      const distance = Math.hypot(deltaX, deltaY);

      if (distance > 10 && longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      if (isSpeedingRef.current) {
        return; // finger is holding 2x speed
      }

      if (gestureModeRef.current === 'none' && distance > 10) {
        if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          gestureModeRef.current = 'horizontal_swipe';
          pin('swiping');
          setIsSwiping(true);
        } else if (!isFullscreen && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
          gestureModeRef.current = 'vertical_swipe';
        }
      }

      if (gestureModeRef.current === 'horizontal_swipe' && duration > 0) {
        const seekDelta = (deltaX / 250) * Math.min(120, Math.max(30, duration * 0.15));
        const target = Math.min(Math.max(0, pd.initialTime + seekDelta), duration);
        if (Math.abs(deltaX) <= 10) {
          setSwipeSeekTime(null);
        } else {
          setSwipeSeekTime(target);
        }
      } else if (gestureModeRef.current === 'vertical_swipe') {
        const clamped = Math.max(-100, Math.min(100, deltaY * 0.6));
        setDragTranslateY(clamped);
      }
    },
    [duration, isFullscreen, showControls, keepAlive, pin]
  );

  // ── POINTER UP ──
  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const pd = pointerDownStateRef.current;

      try {
        if (e.pointerType !== 'mouse') {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        }
      } catch {}

      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      // Handle desktop mouse click / double click
      if (e.pointerType === 'mouse') {
        if (!pd) return;
        const dist = Math.hypot(e.clientX - pd.startX, e.clientY - pd.startY);
        pointerDownStateRef.current = null;

        if (dist > 5) return; // was a drag/selection

        const now = Date.now();
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        const leftZone = width * 0.35;
        const rightZone = width * 0.65;

        if (lastMouseClickRef.current && now - lastMouseClickRef.current.time < 280) {
          // Double click
          if (mouseClickTimerRef.current) {
            clearTimeout(mouseClickTimerRef.current);
            mouseClickTimerRef.current = null;
          }
          lastMouseClickRef.current = null;

          if (clickX < leftZone) {
            onSeekRelative(-seekAmount);
            triggerFeedback('rewind', seekAmount);
          } else if (clickX > rightZone) {
            onSeekRelative(seekAmount);
            triggerFeedback('forward', seekAmount);
          } else {
            if (onToggleFullscreen) onToggleFullscreen();
          }
          keepAlive();
        } else {
          lastMouseClickRef.current = { time: now, x: e.clientX, y: e.clientY };
          mouseClickTimerRef.current = setTimeout(() => {
            onTogglePlay();
            keepAlive();
            mouseClickTimerRef.current = null;
            lastMouseClickRef.current = null;
          }, 220);
        }
        return;
      }

      // ── TOUCH / PEN UP ──
      if (!pd || pd.pointerId !== e.pointerId) return;

      // If long-press 2x was active, restore previous playbackRate and skip tap action
      if (isSpeedingRef.current) {
        const video = videoRef.current;
        if (video) {
          video.playbackRate = savedPlaybackRateRef.current;
        }
        isSpeedingRef.current = false;
        setIsSpeeding(false);
        unpin('pressing');
        // Prevent release from triggering tap toggle
        setTimeout(() => {
          longPressedRef.current = false;
        }, 100);
        pointerDownStateRef.current = null;
        gestureModeRef.current = 'none';
        return;
      }

      if (longPressedRef.current) {
        longPressedRef.current = false;
        pointerDownStateRef.current = null;
        gestureModeRef.current = 'none';
        return;
      }

      if (gestureModeRef.current === 'horizontal_swipe') {
        unpin('swiping');
        if (swipeSeekTime !== null) {
          onSeek(swipeSeekTime);
        }
        setIsSwiping(false);
        setSwipeSeekTime(null);
        pointerDownStateRef.current = null;
        gestureModeRef.current = 'none';
        return;
      }

      if (gestureModeRef.current === 'vertical_swipe') {
        const deltaY = e.clientY - pd.startY;
        setDragTranslateY(0);
        if (deltaY > 60) {
          onMinimize?.();
        } else if (deltaY < -60) {
          onToggleFullscreen?.();
        }
        pointerDownStateRef.current = null;
        gestureModeRef.current = 'none';
        return;
      }

      // ── CONFIRMED TAP (distance <= 10px and no mode) ──
      const now = Date.now();
      const rect = e.currentTarget.getBoundingClientRect();
      const tapX = e.clientX - rect.left;
      const width = rect.width;
      const leftZone = width * 0.35;
      const rightZone = width * 0.65;
      const isLeft = tapX < leftZone;
      const isRight = tapX > rightZone;

      const lastTap = lastTouchTapRef.current;
      const isDoubleTap =
        lastTap &&
        now - lastTap.time < 300 &&
        Math.abs(e.clientX - lastTap.x) < 50 &&
        Math.abs(e.clientY - lastTap.y) < 50;

      const isConsecutiveSeek =
        now - lastDoubleTapTimeRef.current < 650 &&
        ((isLeft && lastDoubleTapTypeRef.current === 'rewind') ||
          (isRight && lastDoubleTapTypeRef.current === 'forward'));

      if (isDoubleTap || isConsecutiveSeek) {
        if (touchTapTimerRef.current) {
          clearTimeout(touchTapTimerRef.current);
          touchTapTimerRef.current = null;
        }

        if (isLeft) {
          if (controlsVisibleRef.current) {
            hideControls();
          }
          const newAccum =
            isConsecutiveSeek && lastDoubleTapTypeRef.current === 'rewind'
              ? accumulatedSeekRef.current + seekAmount
              : seekAmount;
          accumulatedSeekRef.current = newAccum;
          lastDoubleTapTimeRef.current = now;
          lastDoubleTapTypeRef.current = 'rewind';
          onSeekRelative(-seekAmount);
          triggerFeedback('rewind', newAccum);
          lastTouchTapRef.current = null;
        } else if (isRight) {
          if (controlsVisibleRef.current) {
            hideControls();
          }
          const newAccum =
            isConsecutiveSeek && lastDoubleTapTypeRef.current === 'forward'
              ? accumulatedSeekRef.current + seekAmount
              : seekAmount;
          accumulatedSeekRef.current = newAccum;
          lastDoubleTapTimeRef.current = now;
          lastDoubleTapTypeRef.current = 'forward';
          onSeekRelative(seekAmount);
          triggerFeedback('forward', newAccum);
          lastTouchTapRef.current = null;
        } else {
          // Center double tap: toggle play/pause with pop
          onTogglePlay();
          triggerCenterPop();
          lastTouchTapRef.current = null;
        }
      } else {
        // First tap
        lastTouchTapRef.current = { time: now, x: e.clientX, y: e.clientY };

        if (!pd.controlsWereVisible) {
          // Tap when hidden -> reveal instantly
          showControls(true);
          touchTapTimerRef.current = setTimeout(() => {
            lastTouchTapRef.current = null;
            touchTapTimerRef.current = null;
          }, 250);
        } else {
          // Tap when visible -> wait for double-tap window, then hide
          touchTapTimerRef.current = setTimeout(() => {
            hideControls();
            lastTouchTapRef.current = null;
            touchTapTimerRef.current = null;
          }, 250);
        }
      }

      pointerDownStateRef.current = null;
      gestureModeRef.current = 'none';
    },
    [
      videoRef,
      unpin,
      swipeSeekTime,
      onSeek,
      onMinimize,
      onToggleFullscreen,
      seekAmount,
      onSeekRelative,
      triggerFeedback,
      onTogglePlay,
      triggerCenterPop,
      showControls,
      hideControls,
      controlsVisibleRef,
      keepAlive,
    ]
  );

  // ── POINTER CANCEL / LEAVE ──
  const handlePointerCancel = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      try {
        if (e.pointerType !== 'mouse') {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        }
      } catch {}

      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (isSpeedingRef.current) {
        const video = videoRef.current;
        if (video) {
          video.playbackRate = savedPlaybackRateRef.current;
        }
        isSpeedingRef.current = false;
        setIsSpeeding(false);
        unpin('pressing');
        setTimeout(() => {
          longPressedRef.current = false;
        }, 100);
      }
      if (gestureModeRef.current === 'horizontal_swipe') {
        unpin('swiping');
        setIsSwiping(false);
        setSwipeSeekTime(null);
      }
      if (gestureModeRef.current === 'vertical_swipe') {
        setDragTranslateY(0);
      }
      pointerDownStateRef.current = null;
      gestureModeRef.current = 'none';
    },
    [videoRef, unpin]
  );

  const handlePointerLeave = useCallback(() => {
    // Desktop mouse leave: retain 3s timer
    keepAlive();
    // Also cancel any long-press if pointer left
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (isSpeedingRef.current) {
      const video = videoRef.current;
      if (video) {
        video.playbackRate = savedPlaybackRateRef.current;
      }
      isSpeedingRef.current = false;
      setIsSpeeding(false);
      unpin('pressing');
      setTimeout(() => {
        longPressedRef.current = false;
      }, 100);
    }
  }, [keepAlive, videoRef, unpin]);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
  }, []);

  useEffect(() => {
    return () => {
      if (clearFeedbackTimeoutRef.current) clearTimeout(clearFeedbackTimeoutRef.current);
      if (touchTapTimerRef.current) clearTimeout(touchTapTimerRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (mouseClickTimerRef.current) clearTimeout(mouseClickTimerRef.current);
      if (centerPopTimerRef.current) clearTimeout(centerPopTimerRef.current);
    };
  }, []);

  return {
    feedback,
    isSwiping,
    swipeSeekTime,
    isSpeeding,
    isSpeedingRef,
    dragTranslateY,
    centerPop,
    triggerFeedback,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleContextMenu,
  };
}