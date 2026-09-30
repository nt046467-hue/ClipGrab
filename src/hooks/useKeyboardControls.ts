// useKeyboardControls.ts
// Desktop keyboard hotkeys with input-field protection

import { useEffect } from 'react';

export interface KeyboardControlHandlers {
  onTogglePlay: () => void;
  onSeekBackward: () => void;
  onSeekForward: () => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onTogglePiP: () => void;
  onToggleCaptions: () => void;
  onCloseSettings?: () => void;
}

export function useKeyboardControls(handlers: KeyboardControlHandlers, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently interacting with an input or editable field
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          handlers.onTogglePlay();
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          e.preventDefault();
          handlers.onSeekBackward();
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          e.preventDefault();
          handlers.onSeekForward();
          break;
        case 'ArrowUp':
          e.preventDefault();
          handlers.onVolumeUp();
          break;
        case 'ArrowDown':
          e.preventDefault();
          handlers.onVolumeDown();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          handlers.onToggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          handlers.onToggleFullscreen();
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          handlers.onTogglePiP();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          handlers.onToggleCaptions();
          break;
        case 'Escape':
          if (handlers.onCloseSettings) {
            handlers.onCloseSettings();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers, enabled]);
}