// PlayerControls.tsx
// Comprehensive custom player overlay with auto-hide, top bar, center transport, and bottom scrubber

import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Settings,
  Share2,
  Maximize,
  Minimize,
  PictureInPicture,
  Subtitles,
  Lock,
  Unlock,
  ChevronLeft,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { ProgressBar } from './ProgressBar';
import { VolumeControl } from './VolumeControl';
import { formatTime } from '@/lib/format-utils';
import { PlayerStatus } from '@/hooks/useVideoPlayer';

interface PlayerControlsProps {
  visible: boolean;
  status: PlayerStatus;
  title: string;
  author?: string;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  volume: number;
  muted: boolean;
  isFullscreen: boolean;
  isPiPSupported: boolean;
  hasSubtitles: boolean;
  captionsActive: boolean;
  seekAmount: number;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onSeekRelative: (seconds: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onTogglePiP: () => void;
  onToggleCaptions: () => void;
  onOpenSettings: () => void;
  onShare: () => void;
  onClose: () => void;
  onMinimize?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onDismiss?: () => void;
  onUserInteraction?: () => void;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  visible,
  status,
  title,
  author,
  currentTime,
  duration,
  bufferedEnd,
  volume,
  muted,
  isFullscreen,
  isPiPSupported,
  hasSubtitles,
  captionsActive,
  seekAmount,
  hasPrevious,
  hasNext,
  onPlay,
  onPause,
  onSeek,
  onSeekRelative,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  onTogglePiP,
  onToggleCaptions,
  onOpenSettings,
  onShare,
  onClose,
  onMinimize,
  onPrevious,
  onNext,
  onDismiss,
  onUserInteraction,
}) => {
  const [isLocked, setIsLocked] = useState(false);

  const isPlaying = status === 'playing';
  const isEnded = status === 'ended';
  const isBuffering = status === 'buffering';

  // If locked, show only the unlock button
  if (isLocked) {
    return (
      <div
        className={`absolute inset-0 z-30 flex items-start justify-end p-4 transition-opacity duration-300 pointer-events-none ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          type="button"
          onClick={() => setIsLocked(false)}
          className={`flex items-center gap-2 px-3 py-2 rounded-2xl bg-black/80 border border-white/20 text-white font-bold text-xs backdrop-blur-md shadow-2xl active:scale-95 transition-all ${
            visible ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          <Unlock className="w-4 h-4 text-amber-400" />
          <span>Unlock Screen</span>
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && onDismiss) {
          onDismiss();
        }
      }}
      onTouchStart={(e) => {
        // Prevent touch from bubbling down to video gesture recognizer
        e.stopPropagation();
        onUserInteraction?.();
      }}
      onTouchEnd={(e) => {
        // Prevent touch from bubbling down to video gesture recognizer
        e.stopPropagation();
        if (e.target === e.currentTarget && onDismiss) {
          onDismiss();
        }
      }}
      className={`absolute inset-0 z-30 flex flex-col justify-between p-3 sm:p-5 bg-gradient-to-t from-black/90 via-black/25 to-black/80 transition-opacity duration-300 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* ── Top Bar ── */}
      <div className={`flex items-center justify-between gap-3 text-white ${visible ? 'pointer-events-auto' : 'pointer-events-none'} ${isFullscreen ? 'pt-safe' : 'pt-1 sm:pt-2'}`}>
        {/* Back / Minimize and Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              if (isFullscreen) {
                onToggleFullscreen();
              } else if (onMinimize) {
                onMinimize();
              } else {
                onClose();
              }
            }}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Minimize player'}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Minimize to Mini Player'}
            className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all text-white/90 hover:text-white shrink-0 cursor-pointer"
          >
            {isFullscreen ? (
              <ChevronLeft className="w-6 h-6" />
            ) : (
              <ChevronDown className="w-6 h-6" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="font-headline font-bold text-sm sm:text-base text-white truncate" title={title}>
              {title}
            </h2>
            {author && (
              <p className="text-[11px] text-white/50 truncate">{author}</p>
            )}
          </div>
        </div>

        {/* Top Right Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Lock Screen */}
          <button
            type="button"
            onClick={() => setIsLocked(true)}
            aria-label="Lock controls"
            className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
            title="Lock player controls"
          >
            <Lock className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Share */}
          <button
            type="button"
            onClick={onShare}
            aria-label="Share video"
            className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
            title="Share video"
          >
            <Share2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Settings */}
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Player settings"
            className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
            title="Settings"
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </div>

      {/* ── Center Transport Controls ── */}
      <div className={`flex items-center justify-center gap-6 sm:gap-10 text-white ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        {/* Previous Video in Queue */}
        {hasPrevious && onPrevious && (
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Previous video"
            className="p-2.5 rounded-full hover:bg-white/10 active:scale-90 transition-all text-white/80 hover:text-white"
          >
            <SkipBack className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        {/* Rewind */}
        <button
          type="button"
          onClick={() => onSeekRelative(-seekAmount)}
          aria-label={`Rewind ${seekAmount} seconds`}
          className="relative p-2.5 rounded-full hover:bg-white/10 active:scale-90 transition-all text-white/90 hover:text-white flex flex-col items-center group"
        >
          <svg
            className="w-7 h-7 sm:w-9 sm:h-9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 17l-5-5 5-5" />
            <path d="M18 17l-5-5 5-5" />
          </svg>
          <span className="text-[9px] font-mono font-bold text-white/70 -mt-1">{seekAmount}</span>
        </button>

        {/* Primary Play/Pause / Buffering Button */}
        <button
          type="button"
          onClick={isBuffering ? undefined : (isPlaying ? onPause : onPlay)}
          aria-label={isBuffering ? 'Loading video' : isPlaying ? 'Pause' : 'Play'}
          disabled={isBuffering}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/90 hover:bg-primary text-white flex items-center justify-center shadow-[0_0_30px_rgba(99,102,241,0.6)] active:scale-95 hover:scale-105 transition-all border-2 border-white/20 disabled:opacity-85 cursor-pointer"
        >
          {isBuffering ? (
            <Loader2 className="w-7 h-7 sm:w-9 sm:h-9 text-white animate-spin" />
          ) : isEnded ? (
            <RotateCcw className="w-7 h-7 sm:w-9 sm:h-9" />
          ) : isPlaying ? (
            <Pause className="w-7 h-7 sm:w-9 sm:h-9 fill-white" />
          ) : (
            <Play className="w-7 h-7 sm:w-9 sm:h-9 fill-white ml-1" />
          )}
        </button>

        {/* Forward */}
        <button
          type="button"
          onClick={() => onSeekRelative(seekAmount)}
          aria-label={`Fast forward ${seekAmount} seconds`}
          className="relative p-2.5 rounded-full hover:bg-white/10 active:scale-90 transition-all text-white/90 hover:text-white flex flex-col items-center group"
        >
          <svg
            className="w-7 h-7 sm:w-9 sm:h-9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M13 17l5-5-5-5" />
            <path d="M6 17l5-5-5-5" />
          </svg>
          <span className="text-[9px] font-mono font-bold text-white/70 -mt-1">{seekAmount}</span>
        </button>

        {/* Next Video in Queue */}
        {hasNext && onNext && (
          <button
            type="button"
            onClick={onNext}
            aria-label="Next video"
            className="p-2.5 rounded-full hover:bg-white/10 active:scale-90 transition-all text-white/80 hover:text-white"
          >
            <SkipForward className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}
      </div>

      {/* ── Bottom Bar: Scrubber & Secondary Controls ── */}
      <div className={`space-y-1.5 ${visible ? 'pointer-events-auto' : 'pointer-events-none'} ${isFullscreen ? 'pb-safe' : 'pb-1'}`}>
        {/* Scrubber */}
        <ProgressBar
          currentTime={currentTime}
          duration={duration}
          bufferedEnd={bufferedEnd}
          onSeek={onSeek}
        />

        {/* Controls Row */}
        <div className="flex items-center justify-between text-white text-xs sm:text-sm">
          {/* Left: Time & Volume */}
          <div className="flex items-center gap-2 sm:gap-3">
            <VolumeControl
              volume={volume}
              muted={muted}
              onVolumeChange={onVolumeChange}
              onToggleMute={onToggleMute}
            />

            <div className="font-mono text-xs text-white/80 tabular-nums">
              <span>{formatTime(currentTime)}</span>
              <span className="text-white/40 mx-1">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right: Subtitles, PiP, Fullscreen */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Captions Toggle */}
            {hasSubtitles && (
              <button
                type="button"
                onClick={onToggleCaptions}
                aria-label="Subtitles"
                className={`p-1.5 sm:p-2 rounded-xl active:scale-95 transition-all ${
                  captionsActive
                    ? 'text-primary bg-primary/20'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                title="Toggle subtitles"
              >
                <Subtitles className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}

            {/* Picture-in-Picture (only if browser supports it) */}
            {isPiPSupported && (
              <button
                type="button"
                onClick={onTogglePiP}
                aria-label="Picture in picture"
                className="p-1.5 sm:p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
                title="Picture-in-Picture"
              >
                <PictureInPicture className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}

            {/* Fullscreen */}
            <button
              type="button"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              className="p-1.5 sm:p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
              title="Fullscreen"
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4 sm:w-5 sm:h-5" />
              ) : (
                <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};