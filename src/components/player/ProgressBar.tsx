// ProgressBar.tsx
// High-precision YouTube-style seekbar with buffered indicator, smooth touch scrubbing, and timestamp bubble

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { formatTime } from '@/lib/format-utils';

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  onSeek: (time: number) => void;
  disabled?: boolean;
  /** Called when user starts dragging the scrubber (hold controls visible) */
  onScrubStart?: () => void;
  /** Called when user finishes dragging the scrubber (restart auto-hide timer) */
  onScrubEnd?: () => void;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  currentTime,
  duration,
  bufferedEnd,
  onSeek,
  disabled = false,
  onScrubStart,
  onScrubEnd,
}) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0); // 0 to 1
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);

  const safeDuration = duration > 0 && isFinite(duration) ? duration : 1;
  const currentProgress = Math.max(0, Math.min(1, currentTime / safeDuration));
  const bufferProgress = Math.max(0, Math.min(1, bufferedEnd / safeDuration));

  const effectiveProgress = isDragging ? dragProgress : currentProgress;

  const calculateProgressFromEvent = useCallback(
    (clientX: number) => {
      if (!barRef.current) return 0;
      const rect = barRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left;
      return Math.max(0, Math.min(1, clickX / rect.width));
    },
    []
  );

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    const progress = calculateProgressFromEvent(e.clientX);
    setIsDragging(true);
    setDragProgress(progress);
    onSeek(progress * safeDuration);
    onScrubStart?.();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const progress = calculateProgressFromEvent(e.clientX);
    setHoverPosition(progress);
  };

  const handleMouseLeave = () => {
    setHoverPosition(null);
  };

  // Touch handlers for mobile
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || e.touches.length !== 1) return;
    e.stopPropagation(); // prevent gesture recognizer from treating this as a player tap
    const progress = calculateProgressFromEvent(e.touches[0].clientX);
    setIsDragging(true);
    setDragProgress(progress);
    onScrubStart?.();
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging || e.touches.length !== 1) return;
    const progress = calculateProgressFromEvent(e.touches[0].clientX);
    setDragProgress(progress);
  };

  const handleTouchEnd = () => {
    if (isDragging) {
      onSeek(dragProgress * safeDuration);
      setIsDragging(false);
      onScrubEnd?.();
    }
  };

  // Global window listeners for drag end
  useEffect(() => {
    if (!isDragging) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const progress = calculateProgressFromEvent(e.clientX);
      setDragProgress(progress);
    };

    const handleWindowMouseUp = (e: MouseEvent) => {
      const progress = calculateProgressFromEvent(e.clientX);
      onSeek(progress * safeDuration);
      setIsDragging(false);
      onScrubEnd?.();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDragging, calculateProgressFromEvent, safeDuration, onSeek]);

  const scrubTimestamp = formatTime(
    (isDragging ? dragProgress : (hoverPosition ?? currentProgress)) * safeDuration
  );

  return (
    <div
      ref={barRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      role="slider"
      aria-label="Video seek position"
      aria-valuemin={0}
      aria-valuemax={Math.round(safeDuration)}
      aria-valuenow={Math.round(effectiveProgress * safeDuration)}
      tabIndex={0}
      className={`relative w-full py-3 cursor-pointer select-none group touch-none ${
        disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
      }`}
    >
      {/* Floating Scrub Time Popup */}
      {(isDragging || hoverPosition !== null) && (
        <div
          className="absolute -top-10 px-2.5 py-1 rounded-lg bg-black/90 border border-white/20 text-white font-mono font-bold text-xs sm:text-sm tracking-tight -translate-x-1/2 pointer-events-none shadow-2xl backdrop-blur-md z-30 transition-transform duration-75"
          style={{
            left: `${(isDragging ? dragProgress : (hoverPosition || 0)) * 100}%`,
          }}
        >
          {scrubTimestamp}
        </div>
      )}

      {/* Main Track Container */}
      <div className="relative w-full h-1 sm:h-1.5 bg-white/20 rounded-full transition-all duration-200 group-hover:h-2">
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

        {/* Scrub Handle / Thumb */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-xl border-2 border-primary transition-all duration-150 ${
            isDragging
              ? 'w-5 h-5 scale-125 ring-4 ring-primary/40'
              : 'w-3.5 h-3.5 opacity-90 group-hover:w-4 group-hover:h-4 group-hover:scale-110'
          }`}
          style={{ left: `${effectiveProgress * 100}%` }}
        />
      </div>
    </div>
  );
};