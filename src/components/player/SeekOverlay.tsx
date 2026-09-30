// SeekOverlay.tsx
// Sleek YouTube-style visual feedback ripple for double-tap seek (left/right)

import React from 'react';
import { GestureFeedback } from '@/hooks/usePlayerGestures';

interface SeekOverlayProps {
  feedback: GestureFeedback;
}

export const SeekOverlay: React.FC<SeekOverlayProps> = ({ feedback }) => {
  if (!feedback.type) return null;

  const isRewind = feedback.type === 'rewind';

  return (
    <div
      key={`${feedback.type}-${feedback.timestamp}`}
      className={`absolute inset-y-0 pointer-events-none z-40 flex items-center justify-center overflow-hidden transition-all duration-300 animate-in fade-in ${
        isRewind
          ? 'left-0 w-2/5 sm:w-1/3 bg-gradient-to-r from-primary/35 via-primary/10 to-transparent rounded-r-[120px]'
          : 'right-0 w-2/5 sm:w-1/3 bg-gradient-to-l from-primary/35 via-primary/10 to-transparent rounded-l-[120px]'
      }`}
    >
      <div className="flex flex-col items-center gap-2 p-4 sm:p-5 rounded-3xl bg-black/75 backdrop-blur-xl border border-white/15 shadow-[0_12px_40px_rgba(0,0,0,0.7)] text-white animate-in zoom-in-90 duration-200">
        {/* Animated Chevrons */}
        <div className={`flex items-center gap-1 ${isRewind ? 'flex-row-reverse' : 'flex-row'}`}>
          <svg
            className="w-5 h-5 text-primary/70 animate-pulse"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <polygon points={isRewind ? '16,5 7,12 16,19' : '8,5 17,12 8,19'} />
          </svg>
          <svg
            className="w-6 h-6 text-primary animate-pulse [animation-delay:150ms]"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <polygon points={isRewind ? '16,5 7,12 16,19' : '8,5 17,12 8,19'} />
          </svg>
          <svg
            className="w-7 h-7 text-white animate-pulse [animation-delay:300ms]"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <polygon points={isRewind ? '16,5 7,12 16,19' : '8,5 17,12 8,19'} />
          </svg>
        </div>

        {/* Seconds text */}
        <span className="font-mono font-bold text-xs sm:text-sm tracking-wide text-white drop-shadow">
          {isRewind ? `-${feedback.amount}s` : `+${feedback.amount}s`}
        </span>
      </div>
    </div>
  );
};