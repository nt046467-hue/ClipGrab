// PlayerControls.tsx
// YouTube-style controls overlay with pointer-events: none root,
// pointer-events: auto interactive controls, opacity/visibility fade, and auto-hide keepAlive

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

export interface PlayerControlsProps {
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
  onInteract: () => void;
  onPin?: (reason: string) => void;
  onUnpin?: (reason: string) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
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
  onInteract,
  onPin,
  onUnpin,
  onScrubStart,
  onScrubEnd,
}) => {
  const [isLocked, setIsLocked] = useState(false);

  const isPlaying = status === 'playing';
  const isEnded = status === 'ended';
  const isBuffering = status === 'buffering';

  // If locked, show only the unlock button
  if (isLocked) {
    return (
      <div
        className={`absolute inset-0 z-30 flex items-start justify-end p-4 transition-[opacity,visibility] duration-200 ease-out pointer-events-none ${
          visible ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
        style={{
          visibility: visible ? 'visible' : 'hidden',
          opacity: visible ? 1 : 0,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setIsLocked(false);
            onUnpin?.('locked');
            onInteract();
          }}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-black/80 border border-white/20 text-white font-bold text-xs backdrop-blur-md shadow-2xl active:scale-95 transition-all pointer-events-auto cursor-pointer`}
        >
          <Unlock className="w-4 h-4 text-amber-400" />
          <span>Unlock Screen</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`absolute inset-0 z-30 flex flex-col justify-between p-3 sm:p-5 transition-[opacity,visibility] duration-200 ease-out pointer-events-none ${
        visible ? 'opacity-100 visible' : 'opacity-0 invisible'
      }`}
      style={{
        visibility: visible ? 'visible' : 'hidden',
        opacity: visible ? 1 : 0,
        // YouTube-accurate gradient
        background:
          'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 18%, transparent 38%, transparent 62%, rgba(0,0,0,0.25) 82%, rgba(0,0,0,0.65) 100%)',
      }}
    >
      {/* ── Top Bar ── */}
      <div
        className={`flex items-center justify-between gap-3 text-white ${
          isFullscreen ? 'pt-safe' : 'pt-1 sm:pt-2'
        }`}
      >
        {/* Back / Minimize and Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              onInteract();
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
            className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all text-white/90 hover:text-white shrink-0 cursor-pointer pointer-events-auto"
          >
            {isFullscreen ? (
              <ChevronLeft className="w-6 h-6" />
            ) : (
              <ChevronDown className="w-6 h-6" />
            )}
          </button>
          <div className="min-w-0 flex-1 pointer-events-none">
            <h2 className="font-headline font-bold text-sm sm:text-base text-white truncate" title={title}>
              {title}
            </h2>
            {author && (
              <p className="text-[11px] text-white/50 truncate">{author}</p>
            )}
          </div>
        </div>

        {/* Top Right Actions */}
        <div className="flex items-center gap-1 shrink-0 pointer-events-auto">
          {/* Lock Screen */}
          <button
            type="button"
            onClick={() => {
              setIsLocked(true);
              onPin?.('locked');
              onInteract();
            }}
            aria-label="Lock controls"
            className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            title="Lock player controls"
          >
            <Lock className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Share */}
          <button
            type="button"
            onClick={() => {
              onShare();
              onInteract();
            }}
            aria-label="Share video"
            className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            title="Share video"
          >
            <Share2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Settings */}
          <button
            type="button"
            onClick={() => {
              onOpenSettings();
              onInteract();
            }}
            aria-label="Player settings"
            className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            title="Settings"
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </div>

      {/* ── Center Transport Controls ── */}
      <div className="flex items-center justify-center gap-6 sm:gap-10 text-white pointer-events-none">
        {/* Previous Video in Queue */}
        {hasPrevious && onPrevious && (
          <button
            type="button"
            onClick={() => {
              onPrevious();
              onInteract();
            }}
            aria-label="Previous video"
            className="p-2.5 rounded-full hover:bg-white/10 active:scale-90 transition-all text-white/80 hover:text-white pointer-events-auto cursor-pointer"
          >
            <SkipBack className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        {/* Rewind */}
        <button
          type="button"
          onClick={() => {
            onSeekRelative(-seekAmount);
            onInteract();
          }}
          aria-label={`Rewind ${seekAmount} seconds`}
          className="relative p-2.5 rounded-full hover:bg-white/10 active:scale-90 transition-all text-white/90 hover:text-white flex flex-col items-center group pointer-events-auto cursor-pointer"
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
          onClick={() => {
            if (!isBuffering) {
              if (isPlaying) onPause();
              else onPlay();
              onInteract();
            }
          }}
          aria-label={isBuffering ? 'Loading video' : isPlaying ? 'Pause' : 'Play'}
          disabled={isBuffering}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/90 hover:bg-primary text-white flex items-center justify-center shadow-[0_0_30px_rgba(99,102,241,0.6)] active:scale-95 hover:scale-105 transition-all border-2 border-white/20 disabled:opacity-85 pointer-events-auto cursor-pointer"
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
          onClick={() => {
            onSeekRelative(seekAmount);
            onInteract();
          }}
          aria-label={`Fast forward ${seekAmount} seconds`}
          className="relative p-2.5 rounded-full hover:bg-white/10 active:scale-90 transition-all text-white/90 hover:text-white flex flex-col items-center group pointer-events-auto cursor-pointer"
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
            onClick={() => {
              onNext();
              onInteract();
            }}
            aria-label="Next video"
            className="p-2.5 rounded-full hover:bg-white/10 active:scale-90 transition-all text-white/80 hover:text-white pointer-events-auto cursor-pointer"
          >
            <SkipForward className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}
      </div>

      {/* ── Bottom Bar: Scrubber & Secondary Controls ── */}
      <div className={`space-y-1.5 ${isFullscreen ? 'pb-safe' : 'pb-1'}`}>
        {/* Scrubber */}
        <ProgressBar
          currentTime={currentTime}
          duration={duration}
          bufferedEnd={bufferedEnd}
          onSeek={onSeek}
          onInteract={onInteract}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
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
              onInteract={onInteract}
            />

            <div className="font-mono text-xs text-white/80 tabular-nums select-none pointer-events-none">
              <span>{formatTime(currentTime)}</span>
              <span className="text-white/40 mx-1">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right: Subtitles, PiP, Fullscreen */}
          <div className="flex items-center gap-1 sm:gap-2 pointer-events-auto">
            {/* Captions Toggle */}
            {hasSubtitles && (
              <button
                type="button"
                onClick={() => {
                  onToggleCaptions();
                  onInteract();
                }}
                aria-label="Subtitles"
                className={`p-1.5 sm:p-2 rounded-xl active:scale-95 transition-all cursor-pointer ${
                  captionsActive
                    ? 'text-primary bg-primary/20'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                title="Toggle subtitles"
              >
                <Subtitles className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}

            {/* Picture-in-Picture */}
            {isPiPSupported && (
              <button
                type="button"
                onClick={() => {
                  onTogglePiP();
                  onInteract();
                }}
                aria-label="Picture in picture"
                className="p-1.5 sm:p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                title="Picture-in-Picture"
              >
                <PictureInPicture className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}

            {/* Fullscreen */}
            <button
              type="button"
              onClick={() => {
                onToggleFullscreen();
                onInteract();
              }}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              className="p-1.5 sm:p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
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