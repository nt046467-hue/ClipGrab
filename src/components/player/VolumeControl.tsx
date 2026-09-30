// VolumeControl.tsx
// Responsive volume control with dynamic SVG volume icons and desktop-only slider (hidden on touch devices)

import React from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';

interface VolumeControlProps {
  volume: number;
  muted: boolean;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onInteract?: () => void;
}

export const VolumeControl: React.FC<VolumeControlProps> = ({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
  onInteract,
}) => {
  const currentLevel = muted ? 0 : volume;

  const renderIcon = () => {
    if (muted || currentLevel === 0) {
      return <VolumeX className="w-5 h-5 text-red-400" />;
    }
    if (currentLevel < 0.5) {
      return <Volume1 className="w-5 h-5 text-white/90" />;
    }
    return <Volume2 className="w-5 h-5 text-white/90" />;
  };

  return (
    <div className="flex items-center gap-1.5 group/vol pointer-events-auto">
      <button
        type="button"
        onClick={() => {
          onToggleMute();
          onInteract?.();
        }}
        aria-label={muted ? 'Unmute' : 'Mute'}
        className="p-1.5 sm:p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
      >
        {renderIcon()}
      </button>

      {/* Expandable slider only on desktop devices with hover capability; hidden on touch devices */}
      <div className="hidden [@media(hover:hover)_and_(pointer:fine)]:flex w-0 group-hover/vol:w-16 sm:group-hover/vol:w-20 transition-all duration-300 overflow-hidden items-center">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={currentLevel}
          onChange={(e) => {
            onVolumeChange(parseFloat(e.target.value));
            onInteract?.();
          }}
          aria-label="Volume slider"
          className="w-16 sm:w-20 h-1 bg-white/25 rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none"
        />
      </div>
    </div>
  );
};