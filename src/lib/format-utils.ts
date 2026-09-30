// format-utils.ts
// Precision formatting utilities for video timestamps, duration, and file statistics

/**
 * Formats a time in seconds to mm:ss or hh:mm:ss string
 * e.g., 65 -> "1:05", 3665 -> "1:01:05"
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) {
    return '0:00';
  }

  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const paddedSecs = secs.toString().padStart(2, '0');

  if (hrs > 0) {
    const paddedMins = mins.toString().padStart(2, '0');
    return `${hrs}:${paddedMins}:${paddedSecs}`;
  }

  return `${mins}:${paddedSecs}`;
}

/**
 * Formats byte count to human-readable size string
 */
export function formatBytes(bytes?: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx++;
  }
  return `${size.toFixed(unitIdx === 0 ? 0 : 1)} ${units[unitIdx]}`;
}

/**
 * Calculates remaining time formatted string
 */
export function formatRemainingTime(currentSec: number, totalDuration: number): string {
  if (!isFinite(totalDuration) || totalDuration <= 0) return '';
  const remaining = Math.max(0, totalDuration - currentSec);
  return `${formatTime(remaining)} left`;
}