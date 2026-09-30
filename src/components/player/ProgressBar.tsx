// ProgressBar.tsx
// High-precision YouTube-style seekbar with Pointer Events scrubbing,
// 44px+ touch target, 3px -> 6px visual expansion, thumb circle, and timestamp bubble

import React, { useState, useRef, useCallback, PointerEvent } from 'react';
import { formatTime } from '@/lib/format-utils';

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  onSeek: (time: number) => void;
  disabled?: boolean;
  onInteract?: () => void;
  /** Called when user starts dragging the scrubber (pins 'scrubbing') */
  onScrubStart?: () => void;
  /** Called when user finishes dragging the scrubber (unpins 'scrubbing') */
  onScrubEnd?: () => void;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  currentTime,
  duration,
  bufferedEnd,
  onSeek,
  disabled = false,
  onInteract,
  onScrubStart,
  onScrubEnd,
}) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0); // 0 to 1
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);

  const safeDuration = duration > 0 && isFinite(duration) ? duration : 1;
  const currentProgress = Math.max(0, Math.min(1, currentTime / safeDuration));
  const bufferProgress = Math.max(0, Math.min(1, bufferedEnd / safeDuration));

  const effectiveProgress = isDragging ? dragProgress : currentProgress;

  const calculateProgressFromClientX = useCallback((clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    return Math.max(0, Math.min(1, clickX / rect.width));
  }, []);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
      activePointerIdRef.current = e.pointerId;
    } catch {}

    const progress = calculateProgressFromClientX(e.clientX);
    setIsDragging(true);
    setDragProgress(progress);
    onSeek(progress * safeDuration);
    onScrubStart?.();
    onInteract?.();
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;

    if (isDragging) {
      const progress = calculateProgressFromClientX(e.clientX);
      setDragProgress(progress);
      onSeek(progress * safeDuration);
      onInteract?.();
    } else if (e.pointerType === 'mouse') {
      const progress = calculateProgressFromClientX(e.clientX);
      setHoverPosition(progress);
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    activePointerIdRef.current = null;

    const progress = calculateProgressFromClientX(e.clientX);
    onSeek(progress * safeDuration);
    setIsDragging(false);
    onScrubEnd?.();
    onInteract?.();
  };

  const handlePointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    activePointerIdRef.current = null;

    setIsDragging(false);
    onScrubEnd?.();
  };

  const handlePointerLeave = () => {
    setHoverPosition(null);
  };

  const scrubTimestamp = formatTime(
    (isDragging ? dragProgress : (hoverPosition ?? currentProgress)) * safeDuration
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
      className={`relative w-full min-h-[44px] py-4 flex items-center cursor-pointer select-none group touch-none pointer-events-auto ${
        disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
      }`}
    >
      {/* Floating Scrub Time Popup */}
      {(isDragging || hoverPosition !== null) && (
        <div
          className="absolute -top-6 px-2.5 py-1 rounded-lg bg-black/90 border border-white/20 text-white font-mono font-bold text-xs sm:text-sm tracking-tight -translate-x-1/2 pointer-events-none shadow-2xl backdrop-blur-md z-30 transition-transform duration-75"
          style={{
            left: `${(isDragging ? dragProgress : (hoverPosition || 0)) * 100}%`,
          }}
        >
          {scrubTimestamp}
        </div>
      )}

      {/* Main Track Container: 3px idle, expands to 6px on hover or drag */}
      <div
        className={`relative w-full rounded-full transition-all duration-200 bg-white/20 ${
          isDragging ? 'h-1.5' : 'h-[3px] group-hover:h-1.5'
        }`}
      >
        {/* Buffer Bar */}
        <div
          className="absolute top-0 left-0 bottom-0 bg-white/35 rounded-full transition-all duration-150"
          style={{ width: `${bufferProgress * 100}%` }}
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
          className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-primary to-indigo-500 rounded-full shadow-[0_0_12px_rgba(99,102,241,0.7)]"
          style={{ width: `${effectiveProgress * 100}%` }}
        />

        {/* Scrub Handle / Thumb: circle grows when dragging or hovered */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-xl border-2 border-primary transition-all duration-150 ${
            isDragging
              ? 'w-4 h-4 scale-125 ring-4 ring-primary/40 opacity-100'
              : 'w-3 h-3 opacity-90 group-hover:w-3.5 group-hover:h-3.5 group-hover:scale-110'
          }`}
          style={{ left: `${effectiveProgress * 100}%` }}
        />
      </div>
    </div>
  );
};