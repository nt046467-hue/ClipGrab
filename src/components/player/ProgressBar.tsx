// ProgressBar.tsx
// High-performance YouTube-style seekbar with direct DOM ref updates (60fps),
// 40px+ touch target, compact tooltip bubble, and Pointer Events scrubbing

import React, { useState, useRef, useCallback, useEffect, PointerEvent } from 'react';
import { formatTime } from '@/lib/format-utils';

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onSeek: (time: number) => void;
  disabled?: boolean;
  onInteract?: () => void;
  /** Called when user starts dragging the scrubber (pins 'scrubbing') */
  onScrubStart?: () => void;
  /** Called when user finishes dragging the scrubber (unpins 'scrubbing') */
  onScrubEnd?: () => void;
}

export const ProgressBar: React.FC<ProgressBarProps> = React.memo(({
  currentTime,
  duration,
  bufferedEnd,
  videoRef,
  onSeek,
  disabled = false,
  onInteract,
  onScrubStart,
  onScrubEnd,
}) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const playedBarRef = useRef<HTMLDivElement | null>(null);
  const bufferBarRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0); // 0 to 1
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragProgressRef = useRef(0);

  const safeDuration = duration > 0 && isFinite(duration) ? duration : 1;

  // Direct DOM update helper for 60fps playback without React re-rendering
  const updateBarElements = useCallback((progress: number) => {
    const clamped = Math.max(0, Math.min(1, progress));
    const pct = `${clamped * 100}%`;
    if (playedBarRef.current) playedBarRef.current.style.width = pct;
    if (thumbRef.current) thumbRef.current.style.left = pct;
  }, []);

  const updateBufferElement = useCallback((progress: number) => {
    const clamped = Math.max(0, Math.min(1, progress));
    if (bufferBarRef.current) bufferBarRef.current.style.width = `${clamped * 100}%`;
  }, []);

  // RAF loop for smooth 60fps seekbar fill when video is playing
  useEffect(() => {
    let animId: number;

    const renderLoop = () => {
      const vid = videoRef?.current;
      if (vid && !isDraggingRef.current && safeDuration > 0) {
        const curProgress = vid.currentTime / safeDuration;
        updateBarElements(curProgress);

        if (vid.buffered.length > 0) {
          try {
            const bufEnd = vid.buffered.end(vid.buffered.length - 1);
            updateBufferElement(bufEnd / safeDuration);
          } catch {}
        }
      }
      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [videoRef, safeDuration, updateBarElements, updateBufferElement]);

  // Keep DOM elements in sync when currentTime / bufferedEnd change externally
  useEffect(() => {
    if (!isDragging) {
      updateBarElements(currentTime / safeDuration);
    }
  }, [currentTime, safeDuration, isDragging, updateBarElements]);

  useEffect(() => {
    updateBufferElement(bufferedEnd / safeDuration);
  }, [bufferedEnd, safeDuration, updateBufferElement]);

  const calculateProgressFromClientX = useCallback((clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    return Math.max(0, Math.min(1, clickX / rect.width));
  }, []);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    const progress = calculateProgressFromClientX(e.clientX);
    isDraggingRef.current = true;
    dragProgressRef.current = progress;
    setIsDragging(true);
    setDragProgress(progress);
    updateBarElements(progress);
    onSeek(progress * safeDuration);
    onScrubStart?.();
    onInteract?.();
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;

    if (isDraggingRef.current) {
      e.stopPropagation();
      const progress = calculateProgressFromClientX(e.clientX);
      dragProgressRef.current = progress;
      setDragProgress(progress);
      updateBarElements(progress);
      onSeek(progress * safeDuration);
      onInteract?.();
    } else if (e.pointerType === 'mouse') {
      const progress = calculateProgressFromClientX(e.clientX);
      setHoverPosition(progress);
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    e.stopPropagation();

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const progress = calculateProgressFromClientX(e.clientX);
    isDraggingRef.current = false;
    setIsDragging(false);
    updateBarElements(progress);
    onSeek(progress * safeDuration);
    onScrubEnd?.();
    onInteract?.();
  };

  const handlePointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    isDraggingRef.current = false;
    setIsDragging(false);
    onScrubEnd?.();
  };

  const handlePointerLeave = () => {
    setHoverPosition(null);
  };

  const effectiveProgress = isDragging ? dragProgress : Math.max(0, Math.min(1, currentTime / safeDuration));
  const scrubTimestamp = formatTime(
    (isDragging ? dragProgress : (hoverPosition ?? effectiveProgress)) * safeDuration
  );

  return (
    <div
      ref={barRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
      role="slider"
      aria-label="Video seek position"
      aria-valuemin={0}
      aria-valuemax={Math.round(safeDuration)}
      aria-valuenow={Math.round(effectiveProgress * safeDuration)}
      tabIndex={0}
      className={`relative w-full min-h-[40px] py-2 flex items-center cursor-pointer select-none group touch-none pointer-events-auto ${
        disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
      }`}
    >
      {/* Floating Scrub Time Popup — positioned cleanly above thumb without overlapping center buttons */}
      {(isDragging || hoverPosition !== null) && (
        <div
          ref={tooltipRef}
          className="absolute -top-7 px-2 py-0.5 rounded-md bg-black/90 border border-white/20 text-white font-mono font-bold text-xs tracking-tight -translate-x-1/2 pointer-events-none shadow-md backdrop-blur-md z-30 select-none will-change-transform"
          style={{
            left: `${(isDragging ? dragProgress : (hoverPosition || 0)) * 100}%`,
          }}
        >
          {scrubTimestamp}
        </div>
      )}

      {/* Main Track Container: 3px idle, expands to 6px on hover/drag */}
      <div
        className={`relative w-full rounded-full transition-all duration-150 bg-white/20 ${
          isDragging ? 'h-1.5' : 'h-[3px] group-hover:h-1.5'
        }`}
      >
        {/* Buffer Bar */}
        <div
          ref={bufferBarRef}
          className="absolute top-0 left-0 bottom-0 bg-white/35 rounded-full will-change-transform"
          style={{ width: `${Math.min(100, (bufferedEnd / safeDuration) * 100)}%` }}
        />

        {/* Hover Highlight Line */}
        {hoverPosition !== null && !isDragging && (
          <div
            className="absolute top-0 left-0 bottom-0 bg-white/40 rounded-full"
            style={{ width: `${hoverPosition * 100}%` }}
          />
        )}

        {/* Played Progress Bar */}
        <div
          ref={playedBarRef}
          className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-primary to-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.6)] will-change-transform"
          style={{ width: `${effectiveProgress * 100}%` }}
        />

        {/* Scrub Handle / Thumb circle */}
        <div
          ref={thumbRef}
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-xl border-2 border-primary will-change-transform transition-[width,height,transform] duration-100 ${
            isDragging
              ? 'w-4 h-4 scale-125 ring-4 ring-primary/40 opacity-100'
              : 'w-3 h-3 opacity-90 group-hover:w-3.5 group-hover:h-3.5 group-hover:scale-110'
          }`}
          style={{ left: `${effectiveProgress * 100}%` }}
        />
      </div>
    </div>
  );
});

ProgressBar.displayName = 'ProgressBar';