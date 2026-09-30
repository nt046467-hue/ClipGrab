// usePlayerGestures.ts
// Production-grade YouTube mobile player gesture system with Pointer Events
// Supports: instant tap reveal / 250ms hide on visible, left/right double-tap seek,
// center double-tap play/pause, long-press 2x speed, horizontal swipe seek,
// windowed follow-the-finger vertical swipe (minimize/fullscreen), and desktop mouse handling.

import { useState, useRef, useCallback, PointerEvent, MouseEvent, useEffect } from 'react';

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
  onSeek: (targetTime: number) => void;
  onSeekRelative: (seconds: number) => void;
  onTogglePlay: () => void;
  onToggleFullscreen?: () => void;
  onMinimize?: () => void;
  onTemporarySpeedChange: (speed: number | null) => void;
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
  onSeek,
  onSeekRelative,
  onTogglePlay,
  onToggleFullscreen,
  onMinimize,
  onTemporarySpeedChange,
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
  const [isLongPressing, setIsLongPressing] = useState(false);

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
  const isLongPressingRef = useRef<boolean>(false);

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

      if (e.pointerType === 'mouse') {
        // Desktop mouse down: just track position
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

      // Setup Long-press (>=450ms, no movement) = 2x speed while held
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        if (gestureModeRef.current === 'none') {
          isLongPressingRef.current = true;
          setIsLongPressing(true);
          pin('pressing');
          onTemporarySpeedChange(2.0);
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
              navigator.vibrate(10);
            } catch {}
          }
        }
      }, 450);
    },
    [currentTime, controlsVisibleRef, pin, onTemporarySpeedChange]
  );

  // ── POINTER MOVE ──
  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse') {
        // Desktop mouse movement shows controls and starts 3s idle timer
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

      if (isLongPressingRef.current) {
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
        // Clamped follow-the-finger translate
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

        if (dist > 5) return; // was a drag/selection, ignore

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
            // center double click -> fullscreen
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

      if (isLongPressingRef.current) {
        onTemporarySpeedChange(null);
        isLongPressingRef.current = false;
        setIsLongPressing(false);
        unpin('pressing');
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
        // Cancel single tap timeout
        if (touchTapTimerRef.current) {
          clearTimeout(touchTapTimerRef.current);
          touchTapTimerRef.current = null;
        }

        if (isLeft) {
          // If controls were visible, hide them immediately so they don't flash during seek
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
          // Center double tap: toggle play/pause with brief center icon pop, controls state unchanged
          onTogglePlay();
          triggerCenterPop();
          lastTouchTapRef.current = null;
        }
      } else {
        // First tap!
        lastTouchTapRef.current = { time: now, x: e.clientX, y: e.clientY };

        if (!pd.controlsWereVisible) {
          // Tap when controls were HIDDEN:
          // Show immediately (no delay) and start 3s timer (if playing).
          // Do nothing more after the double-tap window.
          showControls(true);
          touchTapTimerRef.current = setTimeout(() => {
            lastTouchTapRef.current = null;
            touchTapTimerRef.current = null;
          }, 250);
        } else {
          // Tap when controls were VISIBLE:
          // Wait for double-tap window (~250ms); if no second tap arrives, hide controls.
          // (Works while playing AND while paused; while paused the video stays paused).
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
      onTemporarySpeedChange,
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

  // ── POINTER CANCEL ──
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
      if (isLongPressingRef.current) {
        onTemporarySpeedChange(null);
        isLongPressingRef.current = false;
        setIsLongPressing(false);
        unpin('pressing');
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
    [onTemporarySpeedChange, unpin]
  );

  // ── POINTER LEAVE (DESKTOP) ──
  const handlePointerLeave = useCallback(() => {
    // When desktop mouse leaves player: keep 3s timer running, do not hide instantly
    keepAlive();
  }, [keepAlive]);

  // Context menu prevention (for long-press)
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
  }, []);

  // Teardown timers on unmount
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
    isLongPressing,
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