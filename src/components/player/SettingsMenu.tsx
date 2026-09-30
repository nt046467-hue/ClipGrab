// SettingsMenu.tsx
// Mobile bottom sheet / Desktop popover player settings with sub-menus

import React, { useState } from 'react';
import {
  X,
  Gauge,
  Maximize2,
  Repeat,
  FastForward,
  ChevronRight,
  ArrowLeft,
  Check,
  Subtitles,
  Sliders,
} from 'lucide-react';
import { PlayerSettings } from '@/lib/player-storage';

interface SettingsMenuProps {
  isOpen: boolean;
  onClose: () => void;
  settings: PlayerSettings;
  onUpdateRate: (rate: number) => void;
  onUpdateFitMode: (mode: 'contain' | 'cover') => void;
  onToggleLoop: () => void;
  onToggleAutoplayNext: () => void;
  onUpdateSeekAmount: (amount: 5 | 10 | 15 | 30) => void;
  onOpenSubtitles?: () => void;
  qualities?: string[];
  activeQuality?: string;
  onSelectQuality?: (q: string) => void;
}

type SubMenuView = 'main' | 'speed' | 'seekAmount' | 'quality';

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SEEK_OPTIONS: (5 | 10 | 15 | 30)[] = [5, 10, 15, 30];

export const SettingsMenu: React.FC<SettingsMenuProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateRate,
  onUpdateFitMode,
  onToggleLoop,
  onToggleAutoplayNext,
  onUpdateSeekAmount,
  onOpenSubtitles,
  qualities,
  activeQuality,
  onSelectQuality,
}) => {
  const [currentView, setCurrentView] = useState<SubMenuView>('main');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Backdrop tap to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Main Container */}
      <div className="relative z-10 w-full sm:max-w-md bg-[#0e1118] border border-white/10 rounded-t-[2rem] sm:rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[85dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            {currentView !== 'main' && (
              <button
                type="button"
                onClick={() => setCurrentView('main')}
                className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-all mr-1"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <Sliders className="w-4 h-4 text-primary" />
            <h3 className="font-headline font-bold text-base sm:text-lg text-white">
              {currentView === 'main' && 'Playback Settings'}
              {currentView === 'speed' && 'Playback Speed'}
              {currentView === 'seekAmount' && 'Double-tap Seek Step'}
              {currentView === 'quality' && 'Video Quality'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Views */}
        {currentView === 'main' && (
          <div className="space-y-1 text-sm font-medium">
            {/* Speed item */}
            <button
              type="button"
              onClick={() => setCurrentView('speed')}
              className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-all text-white/85 hover:text-white"
            >
              <div className="flex items-center gap-3">
                <Gauge className="w-4 h-4 text-primary" />
                <span>Speed</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-white/50 font-mono">
                <span>{settings.playbackRate === 1 ? 'Normal' : `${settings.playbackRate}x`}</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </button>

            {/* Seek Amount item */}
            <button
              type="button"
              onClick={() => setCurrentView('seekAmount')}
              className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-all text-white/85 hover:text-white"
            >
              <div className="flex items-center gap-3">
                <FastForward className="w-4 h-4 text-primary" />
                <span>Double-tap Seek</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-white/50 font-mono">
                <span>{settings.seekAmount}s</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </button>

            {/* Quality (only if qualities array exists) */}
            {qualities && qualities.length > 1 && (
              <button
                type="button"
                onClick={() => setCurrentView('quality')}
                className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-all text-white/85 hover:text-white"
              >
                <div className="flex items-center gap-3">
                  <Sliders className="w-4 h-4 text-primary" />
                  <span>Quality</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-white/50 font-mono">
                  <span>{activeQuality || 'Auto'}</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>
            )}

            {/* Subtitles Button */}
            {onOpenSubtitles && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSubtitles();
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-all text-white/85 hover:text-white"
              >
                <div className="flex items-center gap-3">
                  <Subtitles className="w-4 h-4 text-primary" />
                  <span>Subtitles & Captions</span>
                </div>
                <ChevronRight className="w-4 h-4 text-white/30" />
              </button>
            )}

            {/* Fit / Fill toggle */}
            <div className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-all">
              <div className="flex items-center gap-3 text-white/85">
                <Maximize2 className="w-4 h-4 text-primary" />
                <span>Screen Fit</span>
              </div>
              <div className="flex rounded-lg bg-black/40 border border-white/10 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => onUpdateFitMode('contain')}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    settings.fitMode === 'contain'
                      ? 'bg-primary text-white font-bold'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  Fit
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateFitMode('cover')}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    settings.fitMode === 'cover'
                      ? 'bg-primary text-white font-bold'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  Fill
                </button>
              </div>
            </div>

            {/* Loop video toggle */}
            <div className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-all">
              <div className="flex items-center gap-3 text-white/85">
                <Repeat className="w-4 h-4 text-primary" />
                <span>Loop Video</span>
              </div>
              <input
                type="checkbox"
                checked={settings.loop}
                onChange={onToggleLoop}
                aria-label="Loop video"
                className="w-4 h-4 rounded accent-primary cursor-pointer"
              />
            </div>

            {/* Autoplay Next */}
            <div className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-all">
              <div className="flex items-center gap-3 text-white/85">
                <FastForward className="w-4 h-4 text-primary" />
                <span>Autoplay Next in Queue</span>
              </div>
              <input
                type="checkbox"
                checked={settings.autoplayNext}
                onChange={onToggleAutoplayNext}
                aria-label="Autoplay next"
                className="w-4 h-4 rounded accent-primary cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* Speed Submenu */}
        {currentView === 'speed' && (
          <div className="space-y-1">
            {SPEED_OPTIONS.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => {
                  onUpdateRate(rate);
                  setCurrentView('main');
                }}
                className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${
                  settings.playbackRate === rate
                    ? 'bg-primary/20 text-primary font-bold'
                    : 'hover:bg-white/5 text-white/80 hover:text-white'
                }`}
              >
                <span>{rate === 1 ? '1x (Normal)' : `${rate}x`}</span>
                {settings.playbackRate === rate && <Check className="w-4 h-4" />}
              </button>
            ))}
          </div>
        )}

        {/* Seek Amount Submenu */}
        {currentView === 'seekAmount' && (
          <div className="space-y-1">
            {SEEK_OPTIONS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => {
                  onUpdateSeekAmount(amt);
                  setCurrentView('main');
                }}
                className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${
                  settings.seekAmount === amt
                    ? 'bg-primary/20 text-primary font-bold'
                    : 'hover:bg-white/5 text-white/80 hover:text-white'
                }`}
              >
                <span>{amt} seconds</span>
                {settings.seekAmount === amt && <Check className="w-4 h-4" />}
              </button>
            ))}
          </div>
        )}

        {/* Quality Submenu */}
        {currentView === 'quality' && qualities && (
          <div className="space-y-1">
            {qualities.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  if (onSelectQuality) onSelectQuality(q);
                  setCurrentView('main');
                }}
                className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${
                  activeQuality === q
                    ? 'bg-primary/20 text-primary font-bold'
                    : 'hover:bg-white/5 text-white/80 hover:text-white'
                }`}
              >
                <span>{q}</span>
                {activeQuality === q && <Check className="w-4 h-4" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};