// SubtitleMenu.tsx
// Subtitle selection, local VTT/SRT file upload, and caption font size configuration

import React, { useRef } from 'react';
import { X, Subtitles, Upload, Check, Type } from 'lucide-react';
import { createSubtitleBlobUrl } from '@/lib/media-utils';

export interface SubtitleTrack {
  id: string;
  label: string;
  src: string;
  lang: string;
}

interface SubtitleMenuProps {
  isOpen: boolean;
  onClose: () => void;
  tracks: SubtitleTrack[];
  activeTrackId: string | null;
  onSelectTrack: (trackId: string | null) => void;
  onAddTrack: (track: SubtitleTrack) => void;
  subtitleSize: 'sm' | 'md' | 'lg';
  onChangeSize: (size: 'sm' | 'md' | 'lg') => void;
}

export const SubtitleMenu: React.FC<SubtitleMenuProps> = ({
  isOpen,
  onClose,
  tracks,
  activeTrackId,
  onSelectTrack,
  onAddTrack,
  subtitleSize,
  onChangeSize,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const isSrt = file.name.endsWith('.srt');
      const blobUrl = createSubtitleBlobUrl(text, isSrt);

      const newTrack: SubtitleTrack = {
        id: `track_${Date.now()}`,
        label: file.name.replace(/\.(vtt|srt)$/i, ''),
        src: blobUrl,
        lang: 'custom',
      };

      onAddTrack(newTrack);
      onSelectTrack(newTrack.id);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 w-full sm:max-w-md bg-[#0e1118] border border-white/10 rounded-t-[2rem] sm:rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[85dvh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Subtitles className="w-5 h-5 text-primary" />
            <h3 className="font-headline font-bold text-base sm:text-lg text-white">
              Subtitles & Captions
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

        {/* Font Size Selector */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center gap-2.5 text-xs text-white/80">
            <Type className="w-4 h-4 text-primary" />
            <span>Caption Size</span>
          </div>
          <div className="flex rounded-lg bg-black/40 border border-white/10 p-0.5 text-xs">
            {(['sm', 'md', 'lg'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChangeSize(s)}
                className={`px-2.5 py-1 rounded-md transition-all uppercase ${
                  subtitleSize === s
                    ? 'bg-primary text-white font-bold'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Tracks List */}
        <div className="space-y-1">
          <div className="text-[11px] font-bold text-white/40 uppercase tracking-wider px-2">
            Tracks
          </div>

          {/* Off option */}
          <button
            type="button"
            onClick={() => onSelectTrack(null)}
            className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${
              activeTrackId === null
                ? 'bg-primary/20 text-primary font-bold'
                : 'hover:bg-white/5 text-white/80 hover:text-white'
            }`}
          >
            <span>Off</span>
            {activeTrackId === null && <Check className="w-4 h-4" />}
          </button>

          {/* User/provided tracks */}
          {tracks.map((track) => (
            <button
              key={track.id}
              type="button"
              onClick={() => onSelectTrack(track.id)}
              className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${
                activeTrackId === track.id
                  ? 'bg-primary/20 text-primary font-bold'
                  : 'hover:bg-white/5 text-white/80 hover:text-white'
              }`}
            >
              <span className="truncate pr-2">{track.label}</span>
              {activeTrackId === track.id && <Check className="w-4 h-4 shrink-0" />}
            </button>
          ))}
        </div>

        {/* Upload Subtitle File (.vtt / .srt) */}
        <div className="pt-2 border-t border-white/10">
          <input
            ref={fileInputRef}
            type="file"
            accept=".vtt,.srt"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/10 text-white font-medium text-xs transition-all active:scale-[0.99]"
          >
            <Upload className="w-4 h-4 text-primary" />
            <span>Load Local Subtitle (.srt / .vtt)</span>
          </button>
        </div>
      </div>
    </div>
  );
};