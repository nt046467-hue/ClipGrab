// EndScreen.tsx
// Cinematic end-of-video overlay with Replay, Next Video, and Back actions

import React from 'react';
import { RotateCcw, SkipForward, ArrowLeft, Film } from 'lucide-react';
import { VideoSource } from '@/hooks/useVideoPlayer';
import { QueueItem } from '@/lib/player-storage';
import { formatTime } from '@/lib/format-utils';

interface EndScreenProps {
  source: VideoSource;
  nextItem?: QueueItem | null;
  onReplay: () => void;
  onPlayNext?: () => void;
  onBack: () => void;
}

export const EndScreen: React.FC<EndScreenProps> = ({
  source,
  nextItem,
  onReplay,
  onPlayNext,
  onBack,
}) => {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Media Thumbnail Poster preview */}
        <div className="relative w-40 sm:w-48 aspect-video mx-auto rounded-2xl overflow-hidden border border-white/15 shadow-2xl bg-black">
          {source.thumbnail ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={source.thumbnail}
              alt={source.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30">
              <Film className="w-8 h-8" />
            </div>
          )}
          {source.duration && source.duration > 0 && (
            <span className="absolute bottom-2 right-2 bg-black/80 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded text-white border border-white/10">
              {formatTime(source.duration)}
            </span>
          )}
        </div>

        {/* Title */}
        <div className="space-y-1">
          <h3 className="font-headline font-bold text-lg sm:text-xl text-white line-clamp-2 px-2">
            {source.title}
          </h3>
          <p className="text-xs text-white/50">
            {source.author || 'Downloaded via ClipGrab'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onReplay}
            className="w-full sm:w-auto h-12 px-6 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-primary/25 active:scale-95 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Watch Again</span>
          </button>

          {nextItem && onPlayNext && (
            <button
              type="button"
              onClick={onPlayNext}
              className="w-full sm:w-auto h-12 px-6 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-sm flex items-center justify-center gap-2 border border-white/10 active:scale-95 transition-all"
            >
              <SkipForward className="w-4 h-4" />
              <span>Next Video</span>
            </button>
          )}

          <button
            type="button"
            onClick={onBack}
            className="w-full sm:w-auto h-12 px-5 rounded-xl bg-transparent hover:bg-white/5 text-white/70 hover:text-white font-medium text-sm flex items-center justify-center gap-1.5 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Close Player</span>
          </button>
        </div>
      </div>
    </div>
  );
};