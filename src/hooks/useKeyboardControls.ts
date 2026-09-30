// useKeyboardControls.ts
// Desktop keyboard hotkeys with input-field protection & YouTube keybind parity

import { useEffect, useRef } from 'react';

export interface KeyboardControlHandlers {
  onTogglePlay: () => void;
  onSeekRelative: (seconds: number) => void;
  onSeekToPercent: (pct: number) => void;
  onSeekToStart: () => void;
  onSeekToEnd: () => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onTogglePiP: () => void;
  onToggleCaptions: () => void;
  onStepSpeed: (direction: -1 | 1) => void;
  onCloseSettings?: () => void;
  onActivity?: () => void;
}

export function useKeyboardControls(handlers: KeyboardControlHandlers, enabled = true) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input or editable element
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const h = handlersRef.current;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          h.onActivity?.();
          h.onTogglePlay();
          break;

        case 'j':
        case 'J':
          e.preventDefault();
          h.onActivity?.();
          h.onSeekRelative(-10);
          break;

        case 'l':
        case 'L':
          e.preventDefault();
          h.onActivity?.();
          h.onSeekRelative(10);
          break;

        case 'ArrowLeft':
          e.preventDefault();
          h.onActivity?.();
          h.onSeekRelative(-5);
          break;

        case 'ArrowRight':
          e.preventDefault();
          h.onActivity?.();
          h.onSeekRelative(5);
          break;

        case 'ArrowUp':
          e.preventDefault();
          h.onActivity?.();
          h.onVolumeUp();
          break;

        case 'ArrowDown':
          e.preventDefault();
          h.onActivity?.();
          h.onVolumeDown();
          break;

        case 'm':
        case 'M':
          e.preventDefault();
          h.onActivity?.();
          h.onToggleMute();
          break;

        case 'f':
        case 'F':
          e.preventDefault();
          h.onActivity?.();
          h.onToggleFullscreen();
          break;

        case 'p':
        case 'P':
          e.preventDefault();
          h.onActivity?.();
          h.onTogglePiP();
          break;

        case 'c':
        case 'C':
          e.preventDefault();
          h.onActivity?.();
          h.onToggleCaptions();
          break;

        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9': {
          e.preventDefault();
          h.onActivity?.();
          const pct = parseInt(e.key, 10) * 0.1;
          h.onSeekToPercent(pct);
          break;
        }

        case '<':
        case ',':
          e.preventDefault();
          h.onActivity?.();
          h.onStepSpeed(-1);
          break;

        case '>':
        case '.':
          e.preventDefault();
          h.onActivity?.();
          h.onStepSpeed(1);
          break;

        case 'Home':
          e.preventDefault();
          h.onActivity?.();
          h.onSeekToStart();
          break;

        case 'End':
          e.preventDefault();
          h.onActivity?.();
          h.onSeekToEnd();
          break;

        case 'Escape':
          if (h.onCloseSettings) {
            h.onCloseSettings();
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}