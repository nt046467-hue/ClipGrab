// usePlayerGestures.ts
// Handles mobile gestures: double-tap seek (left/right) with visual feedback & multi-tap accumulation,
// horizontal swipe seek, and single-tap controls toggle without browser conflicts

import { useState, useRef, useCallback, TouchEvent } from 'react';

export interface GestureFeedback {
  type: 'rewind' | 'forward' | null;
  amount: number;
  timestamp: number;
}

export interface UsePlayerGesturesProps {
  seekAmount: number;
  duration: number;
  currentTime: number;
  onSeek: (targetTime: number) => void;
  onSeekRelative?: (seconds: number) => void;
  onToggleControls: () => void;
  onTogglePlay?: () => void;
}

export function usePlayerGestures({
  seekAmount,
  duration,
  currentTime,
  onSeek,
  onSeekRelative,
  onToggleControls,
  onTogglePlay,
}: UsePlayerGesturesProps) {
  const [feedback, setFeedback] = useState<GestureFeedback>({
    type: null,
    amount: seekAmount,
    timestamp: 0,
  });

  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeSeekTime, setSwipeSeekTime] = useState<number | null>(null);

  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const touchStartRef = useRef<{ x: number; y: number; startTime: number; initialCurrentTime: number } | null>(null);
  const clearFeedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gestureDirectionRef = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const hasMovedRef = useRef<boolean>(false);

  // Multi-tap accumulation & debounce tracking
  const accumulatedSeekRef = useRef<number>(0);
  const lastDoubleTapTimeRef = useRef<number>(0);
  const lastDoubleTapTypeRef = useRef<'rewind' | 'forward' | null>(null);
  const lastTouchTimeRef = useRef<number>(0);

  const isRecentTouch = useCallback(() => {
    return Date.now() - lastTouchTimeRef.current < 650;
  }, []);

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

  const handleTouchStart = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      lastTouchTimeRef.current = Date.now();
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        startTime: Date.now(),
        initialCurrentTime: currentTime,
      };
      gestureDirectionRef.current = 'none';
      hasMovedRef.current = false;
      setIsSwiping(false);
      setSwipeSeekTime(null);
    },
    [currentTime]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      lastTouchTimeRef.current = Date.now();
      if (!touchStartRef.current || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absX > 10 || absY > 10) {
        hasMovedRef.current = true;
      }

      // Distinguish gesture direction past a reasonable threshold (Rule 8)
      if (gestureDirectionRef.current === 'none') {
        if (absX >= 16 || absY >= 16) {
          if (absY >= absX) {
            // User is scrolling vertically -> allow native vertical page scroll
            gestureDirectionRef.current = 'vertical';
          } else if (absX > absY * 1.5 && absX >= 20) {
            // Horizontal gesture dominates -> engage player seek
            gestureDirectionRef.current = 'horizontal';
            setIsSwiping(true);
          }
        }
      }

      if (gestureDirectionRef.current === 'horizontal' && duration > 0) {
        // Map 300px drag to 60 seconds (or proportionate to duration)
        const seekDelta = (deltaX / 300) * Math.min(120, Math.max(30, duration * 0.1));
        const target = Math.min(
          Math.max(0, touchStartRef.current.initialCurrentTime + seekDelta),
          duration
        );
        setSwipeSeekTime(target);
      }
    },
    [duration]
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      lastTouchTimeRef.current = Date.now();

      // If was swiping, commit seek and stop
      if (isSwiping && swipeSeekTime !== null) {
        onSeek(swipeSeekTime);
        setIsSwiping(false);
        setSwipeSeekTime(null);
        touchStartRef.current = null;
        gestureDirectionRef.current = 'none';
        hasMovedRef.current = false;
        return;
      }

      // If user moved to scroll vertically or dragged, do not fire tap / double-tap
      if (hasMovedRef.current || gestureDirectionRef.current === 'vertical') {
        touchStartRef.current = null;
        gestureDirectionRef.current = 'none';
        hasMovedRef.current = false;
        return;
      }

      if (!touchStartRef.current) return;
      const touch = e.changedTouches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = touch.clientX - rect.left;
      const width = rect.width;
      const now = Date.now();

      const lastTap = lastTapRef.current;
      const isDoubleTap =
        lastTap &&
        now - lastTap.time < 350 &&
        Math.abs(touch.clientX - lastTap.x) < 60 &&
        Math.abs(touch.clientY - lastTap.y) < 60;

      const leftZone = width * 0.38;
      const rightZone = width * 0.62;

      const isConsecutiveSeek =
        now - lastDoubleTapTimeRef.current < 650 &&
        ((clickX < leftZone && lastDoubleTapTypeRef.current === 'rewind') ||
         (clickX > rightZone && lastDoubleTapTypeRef.current === 'forward'));

      if (isDoubleTap || isConsecutiveSeek) {
        // Cancel single tap controls toggle
        if (tapTimeoutRef.current) {
          clearTimeout(tapTimeoutRef.current);
          tapTimeoutRef.current = null;
        }

        if (clickX < leftZone) {
          // Double tap (or 3rd/4th tap) left -> rewind by seekAmount
          const newAccumulated =
            isConsecutiveSeek && lastDoubleTapTypeRef.current === 'rewind'
              ? accumulatedSeekRef.current + seekAmount
              : seekAmount;

          accumulatedSeekRef.current = newAccumulated;
          lastDoubleTapTimeRef.current = now;
          lastDoubleTapTypeRef.current = 'rewind';

          if (onSeekRelative) {
            onSeekRelative(-seekAmount);
          } else {
            onSeek(Math.max(0, currentTime - seekAmount));
          }
          triggerFeedback('rewind', newAccumulated);
        } else if (clickX > rightZone) {
          // Double tap (or 3rd/4th tap) right -> forward by seekAmount
          const newAccumulated =
            isConsecutiveSeek && lastDoubleTapTypeRef.current === 'forward'
              ? accumulatedSeekRef.current + seekAmount
              : seekAmount;

          accumulatedSeekRef.current = newAccumulated;
          lastDoubleTapTimeRef.current = now;
          lastDoubleTapTypeRef.current = 'forward';

          if (onSeekRelative) {
            onSeekRelative(seekAmount);
          } else {
            onSeek(Math.min(duration || Infinity, currentTime + seekAmount));
          }
          triggerFeedback('forward', newAccumulated);
        } else {
          // Center double tap toggles play/pause
          if (onTogglePlay) {
            onTogglePlay();
          } else {
            onToggleControls();
          }
        }

        lastTapRef.current = null;
      } else {
        lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };

        // Schedule single tap after double tap window expires
        tapTimeoutRef.current = setTimeout(() => {
          onToggleControls();
          tapTimeoutRef.current = null;
          lastTapRef.current = null;
        }, 280);
      }

      touchStartRef.current = null;
    },
    [
      isSwiping,
      swipeSeekTime,
      currentTime,
      duration,
      seekAmount,
      onSeek,
      onSeekRelative,
      onToggleControls,
      onTogglePlay,
      triggerFeedback,
    ]
  );

  return {
    feedback,
    isSwiping,
    swipeSeekTime,
    triggerFeedback,
    isRecentTouch,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}