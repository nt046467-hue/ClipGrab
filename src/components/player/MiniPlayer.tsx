// MiniPlayer.tsx
// Compact floating mini-player for mobile and desktop when navigating the app

import React from 'react';
import { Play, Pause, X, Maximize2 } from 'lucide-react';
import { VideoSource } from '@/hooks/useVideoPlayer';

interface MiniPlayerProps {
  source: VideoSource;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onExpand: () => void;
  onClose: () => void;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  source,
  isPlaying,
  onTogglePlay,
  onExpand,
  onClose,
}) => {
  return (
    <div
      className="fixed right-4 sm:right-6 z-40 max-w-[340px] w-[calc(100vw-2rem)] sm:w-80 bg-[#0d1017]/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden p-2.5 animate-in slide-in-from-bottom-5 duration-300"
      style={{ bottom: 'max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))' }}
    >
      <div className="flex items-center gap-3">
        {/* Clickable thumbnail to reopen full player */}
        <div
          onClick={onExpand}
          className="relative w-16 h-11 rounded-lg overflow-hidden bg-black shrink-0 cursor-pointer group border border-white/10"
        >
          {source.thumbnail ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={source.thumbnail}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            />
          ) : (
            <div className="w-full h-full bg-primary/20 flex items-center justify-center">
              <Play className="w-4 h-4 text-primary" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 flex items-center justify-center transition-colors">
            <Maximize2 className="w-3.5 h-3.5 text-white/80 group-hover:text-white" />
          </div>
        </div>

        {/* Title & Info */}
        <div onClick={onExpand} className="flex-1 min-w-0 cursor-pointer">
          <p className="font-headline font-bold text-xs text-white truncate" title={source.title}>
            {source.title}
          </p>
          <p className="text-[10px] text-white/50 truncate">
            {source.author || 'Playing in background'}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="p-2 rounded-full bg-primary hover:bg-primary/90 text-white shadow-md active:scale-95 transition-all"
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5 fill-white" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close mini player"
            className="p-1.5 rounded-full text-white/50 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};