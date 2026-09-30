// DownloadedLibrary.tsx
// Local video library & Watch History — Native-quality responsive bottom sheet & desktop modal

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Play,
  Clock,
  Trash2,
  FolderOpen,
  Film,
  CheckCircle2,
  History,
  ListVideo,
  Download,
  ChevronUp,
} from 'lucide-react';
import {
  getWatchHistory,
  removeFromHistory,
  clearWatchHistory,
  WatchHistoryEntry,
  generateVideoId,
} from '@/lib/player-storage';
import { formatTime, formatRemainingTime } from '@/lib/format-utils';
import { VideoSource } from '@/hooks/useVideoPlayer';
import {
  registerActiveMedia,
  getSafeMediaUrl,
  testBlobUrl,
  removeMediaBlob,
} from '@/lib/indexed-media-store';

interface DownloadedLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  onPlayVideo: (source: VideoSource) => void;
}

type SnapState = 'expanded' | 'half' | 'collapsed';

export const DownloadedLibrary: React.FC<DownloadedLibraryProps> = ({
  isOpen,
  onClose,
  onPlayVideo,
}) => {
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);
  const [activeSnap, setActiveSnap] = useState<SnapState>('half');
  const [isClosing, setIsClosing] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);

  // Drag tracking refs
  const currentTranslateYRef = useRef<number>(0);
  const activeSnapRef = useRef<SnapState>('half');
  const touchStartYRef = useRef<number>(0);
  const touchStartTimeRef = useRef<number>(0);
  const startTranslateYRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const isDragHandleTargetRef = useRef<boolean>(false);
  const initialScrollTopRef = useRef<number>(0);

  const loadHistory = useCallback(() => {
    setHistory(getWatchHistory());
  }, []);

  // Compute snap translateY offsets based on current viewport
  const getSnapOffsets = useCallback(() => {
    if (typeof window === 'undefined') {
      return { expanded: 0, half: 300, collapsed: 500, closed: 800 };
    }
    const h = window.innerHeight;
    const sheetEl = sheetRef.current;
    const sheetHeight = sheetEl ? sheetEl.offsetHeight : Math.round(h * 0.92);

    // Expanded: top of sheet (~92dvh visible)
    const expanded = 0;
    // Half: ~55vh visible
    const half = Math.max(0, sheetHeight - Math.round(h * 0.55));
    // Collapsed: ~24vh visible (peek header)
    const collapsed = Math.max(0, sheetHeight - Math.max(160, Math.round(h * 0.24)));
    // Closed: totally off screen
    const closed = sheetHeight + 40;

    return { expanded, half, collapsed, closed, sheetHeight };
  }, []);

  // Update DOM position with zero-layout-reflow GPU transform
  const updatePosition = useCallback((translateY: number, animated: boolean = false, durationMs: number = 320) => {
    currentTranslateYRef.current = translateY;
    if (!sheetRef.current || !backdropRef.current) return;

    if (window.innerWidth >= 640) {
      // Desktop: reset any transform
      sheetRef.current.style.transform = '';
      sheetRef.current.style.transition = '';
      backdropRef.current.style.opacity = '1';
      return;
    }

    const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const actualDuration = isReducedMotion ? 0 : durationMs;

    if (animated && actualDuration > 0) {
      sheetRef.current.style.transition = `transform ${actualDuration}ms cubic-bezier(0.2, 0.9, 0.3, 1)`;
      backdropRef.current.style.transition = `opacity ${actualDuration}ms cubic-bezier(0.2, 0.9, 0.3, 1)`;
    } else {
      sheetRef.current.style.transition = 'none';
      backdropRef.current.style.transition = 'none';
    }

    sheetRef.current.style.transform = `translateY(${translateY}px)`;

    const snaps = getSnapOffsets();
    const sheetH = snaps.sheetHeight || window.innerHeight;
    const progress = Math.max(0, Math.min(1, 1 - (translateY / sheetH)));
    backdropRef.current.style.opacity = `${progress * 0.75}`;
  }, [getSnapOffsets]);

  // Snap to target state
  const snapTo = useCallback((target: SnapState, durationMs: number = 320) => {
    const snaps = getSnapOffsets();
    activeSnapRef.current = target;
    setActiveSnap(target);
    const targetY = snaps[target];
    updatePosition(targetY, true, durationMs);
  }, [getSnapOffsets, updatePosition]);

  // Smooth close with transition
  const handleClose = useCallback(() => {
    if (window.innerWidth < 640) {
      setIsClosing(true);
      const snaps = getSnapOffsets();
      updatePosition(snaps.closed, true, 260);
      setTimeout(() => {
        setIsClosing(false);
        onClose();
      }, 260);
    } else {
      onClose();
    }
  }, [getSnapOffsets, onClose, updatePosition]);

  // Robust Mobile Body Scroll Lock
  useEffect(() => {
    if (!isOpen) return;

    loadHistory();
    const scrollY = window.scrollY;
    const origPosition = document.body.style.position;
    const origTop = document.body.style.top;
    const origLeft = document.body.style.left;
    const origRight = document.body.style.right;
    const origWidth = document.body.style.width;
    const origOverflow = document.body.style.overflow;

    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.position = origPosition;
      document.body.style.top = origTop;
      document.body.style.left = origLeft;
      document.body.style.right = origRight;
      document.body.style.width = origWidth;
      document.body.style.overflow = origOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen, loadHistory]);

  // Initial entrance animation & viewport resize handler
  useEffect(() => {
    if (!isOpen) return;

    if (window.innerWidth < 640) {
      // Start slightly off screen then animate up to half
      const snaps = getSnapOffsets();
      updatePosition(snaps.closed, false);
      const rafId = requestAnimationFrame(() => {
        snapTo('half', 340);
      });
      return () => cancelAnimationFrame(rafId);
    } else {
      updatePosition(0, false);
    }
  }, [isOpen, getSnapOffsets, snapTo, updatePosition]);

  // Handle window and visualViewport resize (e.g. keyboard toggle, rotation)
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => {
      if (window.innerWidth >= 640) {
        if (sheetRef.current) sheetRef.current.style.transform = '';
        if (backdropRef.current) backdropRef.current.style.opacity = '1';
      } else {
        snapTo(activeSnapRef.current, 150);
      }
    };

    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, [isOpen, snapTo]);

  // Keyboard Escape listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Touch Drag Event Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.innerWidth >= 640) return;
    const touch = e.touches[0];
    touchStartYRef.current = touch.clientY;
    touchStartTimeRef.current = Date.now();
    startTranslateYRef.current = currentTranslateYRef.current;

    const target = e.target as HTMLElement;
    const isDragHandle = !!target.closest('[data-drag-handle]');
    isDragHandleTargetRef.current = isDragHandle;

    const scrollEl = scrollContentRef.current;
    initialScrollTopRef.current = scrollEl ? scrollEl.scrollTop : 0;
    isDraggingRef.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingRef.current || window.innerWidth >= 640) return;
    const touch = e.touches[0];
    const dy = touch.clientY - touchStartYRef.current;

    const isExpanded = activeSnapRef.current === 'expanded';
    const scrollEl = scrollContentRef.current;
    const currentScrollTop = scrollEl ? scrollEl.scrollTop : 0;

    // Internal scroll vs sheet movement logic:
    if (!isDragHandleTargetRef.current && isExpanded) {
      if (dy > 0 && currentScrollTop <= 0) {
        // At top of scroll content and pulling DOWN -> move sheet downward!
        if (e.cancelable) e.preventDefault();
        const newY = Math.max(0, startTranslateYRef.current + dy);
        updatePosition(newY, false);
      } else {
        // Normal content scroll inside list
        return;
      }
    } else {
      // Dragging handle or sheet is at half/collapsed
      if (e.cancelable) e.preventDefault();
      let newY = startTranslateYRef.current + dy;
      if (newY < 0) {
        // Rubber-band resistance above expanded
        newY = newY * 0.2;
      }
      updatePosition(newY, false);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isDraggingRef.current || window.innerWidth >= 640) return;
    isDraggingRef.current = false;

    const touch = e.changedTouches[0];
    const dy = touch.clientY - touchStartYRef.current;
    const dt = Math.max(1, Date.now() - touchStartTimeRef.current);
    const velocity = dy / dt; // px/ms

    const snaps = getSnapOffsets();
    const currentY = currentTranslateYRef.current;

    // High downward velocity
    if (velocity > 0.45) {
      if (activeSnapRef.current === 'expanded') {
        snapTo('half');
      } else if (activeSnapRef.current === 'half') {
        if (dy > 100 || velocity > 0.8) {
          handleClose();
        } else {
          snapTo('collapsed');
        }
      } else {
        handleClose();
      }
      return;
    }

    // High upward velocity
    if (velocity < -0.45) {
      if (activeSnapRef.current === 'collapsed') {
        snapTo('half');
      } else {
        snapTo('expanded');
      }
      return;
    }

    // Dragged below threshold to close
    if (currentY > snaps.collapsed + 70) {
      handleClose();
      return;
    }

    // Snap to nearest point
    const distToExpanded = Math.abs(currentY - snaps.expanded);
    const distToHalf = Math.abs(currentY - snaps.half);
    const distToCollapsed = Math.abs(currentY - snaps.collapsed);

    if (distToExpanded <= distToHalf && distToExpanded <= distToCollapsed) {
      snapTo('expanded');
    } else if (distToHalf <= distToCollapsed) {
      snapTo('half');
    } else {
      snapTo('collapsed');
    }
  };

  if (!isOpen && !isClosing) return null;

  const inProgress = history.filter((h) => h.completionPct > 5 && h.completionPct < 95);

  const handleOpenLocalFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const id = generateVideoId(file.name, file.size.toString());
    // Register into memory store (prevents Chrome GC) and persist to IndexedDB
    const safeObjectUrl = registerActiveMedia(id, file, file.name);
    onPlayVideo({
      id,
      url: safeObjectUrl,
      title: file.name.replace(/\.[^/.]+$/, ''),
      thumbnail: '',
      mimeType: file.type || 'video/mp4',
      fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
    });
    handleClose();
  };

  const handleResumeHistory = async (entry: WatchHistoryEntry) => {
    let playUrl = entry.fileUrl;

    // If it's a blob: URL, verify its validity and revive from IndexedDB if expired
    if (entry.fileUrl.startsWith('blob:')) {
      const safe = await getSafeMediaUrl(entry.id, entry.fileUrl);
      if (safe.isRevived) {
        playUrl = safe.url;
      } else {
        const isAlive = await testBlobUrl(entry.fileUrl);
        if (!isAlive) {
          // File was unmapped and not in IndexedDB — trigger file picker
          alert(`The local video file "${entry.title}" is no longer accessible. Please re-select the file to play.`);
          fileInputRef.current?.click();
          return;
        }
      }
    }

    onPlayVideo({
      id: entry.id,
      url: playUrl,
      title: entry.title,
      thumbnail: entry.thumbnail,
      duration: entry.duration,
      author: entry.author,
      mimeType: entry.mimeType,
      quality: entry.quality,
      fileSize: entry.fileSize,
      platform: entry.platform,
    });
    handleClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="My Library and Saved Videos"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center pointer-events-none"
    >
      {/* ── Backdrop ── */}
      <div
        ref={backdropRef}
        onClick={handleClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm pointer-events-auto transition-opacity"
        aria-hidden="true"
      />

      {/* ── Bottom Sheet (Mobile) / Centered Modal (Desktop) ── */}
      <div
        ref={sheetRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative pointer-events-auto w-full sm:max-w-2xl bg-[#0a0c12] sm:rounded-3xl rounded-t-[1.75rem] shadow-2xl flex flex-col max-h-[calc(100dvh-max(12px,env(safe-area-inset-top,0px)))] sm:max-h-[85dvh] border border-white/[0.08] overflow-hidden will-change-transform"
      >
        {/* Pull handle & drag region (Mobile only) */}
        <div
          data-drag-handle
          onClick={() => {
            if (activeSnap === 'collapsed') snapTo('half');
            else if (activeSnap === 'half') snapTo('expanded');
          }}
          className="sm:hidden flex flex-col items-center justify-center pt-2.5 pb-1.5 cursor-grab active:cursor-grabbing w-full touch-none select-none bg-[#0d0f18]"
          title="Drag to resize sheet"
        >
          <div className="w-12 h-1.5 rounded-full bg-white/25 active:bg-white/45 transition-colors" />
          {activeSnap === 'collapsed' && (
            <div className="flex items-center gap-1 text-[10px] text-primary/80 font-bold mt-1">
              <ChevronUp className="w-3 h-3 animate-bounce" />
              <span>Tap to expand</span>
            </div>
          )}
        </div>

        {/* Responsive Header */}
        <div
          data-drag-handle
          className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-white/[0.07] bg-[#0d0f18] shrink-0 select-none"
        >
          {/* Title and subtitle */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center text-primary shrink-0">
              <Film className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </div>

            <div className="flex flex-col min-w-0">
              <h2 className="font-headline font-black text-sm sm:text-lg text-white leading-tight tracking-tight truncate">
                My Library
              </h2>
              <p className="text-[10px] sm:text-xs text-white/40 leading-none mt-0.5 truncate">
                {history.length > 0
                  ? `${history.length} saved video${history.length !== 1 ? 's' : ''}`
                  : 'No saved videos yet'}
              </p>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*"
              onChange={handleOpenLocalFile}
              className="hidden"
            />
            {/* Open File Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Open downloaded video file"
              aria-label="Open a local downloaded file"
              className="h-8.5 sm:h-9 px-2.5 sm:px-3.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-primary/20 transition-all active:scale-95 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">Open File</span>
            </button>

            {/* Accessible Close Button (Min 44x44px touch target on mobile) */}
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close My Library"
              className="min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 h-8.5 w-8.5 sm:h-9 sm:w-9 rounded-xl text-white/40 hover:text-white hover:bg-white/10 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div
          ref={scrollContentRef}
          className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-6"
          style={{
            paddingBottom: 'max(4.5rem, calc(env(safe-area-inset-bottom, 0px) + 3rem))',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* Continue Watching Section */}
          {inProgress.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-primary" />
                <h3 className="font-bold text-xs sm:text-sm text-white">Continue Watching</h3>
                <span className="ml-1 bg-primary/15 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full border border-primary/20 leading-none">
                  {inProgress.length}
                </span>
              </div>

              <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-none snap-x snap-mandatory">
                {inProgress.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleResumeHistory(item)}
                    className="w-44 sm:w-52 shrink-0 snap-start rounded-2xl bg-[#111520] border border-white/[0.08] hover:border-primary/40 overflow-hidden group transition-all duration-200 active:scale-[0.97] text-left cursor-pointer"
                  >
                    <div className="relative aspect-video bg-[#0a0c14] overflow-hidden">
                      {item.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnail}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-[1.05] transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-6 h-6 text-white/20" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-9 h-9 rounded-full bg-primary shadow-lg shadow-primary/50 flex items-center justify-center">
                          <Play className="w-4 h-4 fill-white ml-0.5" />
                        </div>
                      </div>
                      <span className="absolute bottom-1.5 right-1.5 bg-black/90 text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded text-white/80 border border-white/[0.12]">
                        {formatRemainingTime(item.lastPosition, item.duration)} left
                      </span>
                      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10">
                        <div className="h-full bg-primary rounded-r-full" style={{ width: `${item.completionPct}%` }} />
                      </div>
                    </div>
                    <div className="px-2.5 py-2">
                      <p className="font-semibold text-[11px] text-white line-clamp-1 group-hover:text-primary transition-colors">
                        {item.title}
                      </p>
                      <p className="text-[10px] text-white/35 mt-0.5 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5 text-primary/70" />
                        Resume at {formatTime(item.lastPosition)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* All Watch History Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-xs sm:text-sm text-white flex items-center gap-2">
                <ListVideo className="w-3.5 h-3.5 text-white/40" />
                Watch History
              </h3>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => { clearWatchHistory(); loadHistory(); }}
                  className="text-[11px] text-red-400/70 hover:text-red-400 flex items-center gap-1 transition-colors cursor-pointer py-1 px-2 rounded-lg hover:bg-red-500/10 active:scale-95"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear all
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 sm:py-12 gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.01]">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary/50">
                  <Download className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="text-center px-4 sm:px-6 space-y-1">
                  <p className="font-bold text-xs sm:text-sm text-white/60">No videos yet</p>
                  <p className="text-[11px] text-white/35 leading-relaxed max-w-sm">
                    Download a video from ClipGrab and it will appear here automatically with saved resume progress.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-9 px-4 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer active:scale-95"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Open a local file
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 rounded-2xl bg-white/[0.03] border border-white/[0.07] hover:border-white/15 hover:bg-white/[0.05] transition-all group"
                  >
                    {/* Thumbnail with duration badge and progress */}
                    <button
                      type="button"
                      onClick={() => handleResumeHistory(item)}
                      aria-label={`Play ${item.title}`}
                      className="relative w-20 h-14 sm:w-24 sm:h-16 rounded-xl bg-black overflow-hidden shrink-0 group/th cursor-pointer"
                    >
                      {item.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnail}
                          alt=""
                          className="w-full h-full object-cover group-hover/th:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-white/[0.04]">
                          <Film className="w-4 h-4 text-white/25" />
                        </div>
                      )}
                      {/* Play overlay on hover */}
                      <div className="absolute inset-0 bg-black/45 opacity-0 group-hover/th:opacity-100 flex items-center justify-center transition-opacity">
                        <Play className="w-4 h-4 fill-white text-white" />
                      </div>
                      {/* Duration */}
                      {item.duration > 0 && (
                        <span className="absolute bottom-1 right-1 bg-black/90 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded text-white/80 border border-white/10">
                          {formatTime(item.duration)}
                        </span>
                      )}
                      {/* Progress bar */}
                      {item.completionPct > 2 && item.completionPct < 98 && (
                        <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-white/15">
                          <div className="h-full bg-primary" style={{ width: `${item.completionPct}%` }} />
                        </div>
                      )}
                    </button>

                    {/* Metadata & Title (Clamped to 2 lines max, no overflow with long titles) */}
                    <button
                      type="button"
                      onClick={() => handleResumeHistory(item)}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <p
                        className="font-semibold text-xs sm:text-[13px] text-white line-clamp-2 break-words leading-snug group-hover:text-primary transition-colors"
                        title={item.title}
                      >
                        {item.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {item.completionPct >= 95 ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 font-semibold">
                            <CheckCircle2 className="w-3 h-3" /> Watched
                          </span>
                        ) : (
                          <span className="text-[10px] text-white/40 font-medium">
                            {item.completionPct}% watched
                          </span>
                        )}
                        {item.quality && (
                          <span className="text-[8.5px] font-bold bg-white/[0.06] border border-white/10 text-white/50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                            {item.quality}
                          </span>
                        )}
                        {item.fileSize && (
                          <span className="text-[9.5px] text-white/30 font-mono">
                            {item.fileSize}
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Delete action with minimum 44px touch target */}
                    <button
                      type="button"
                      onClick={() => {
                        removeFromHistory(item.id);
                        removeMediaBlob(item.id);
                        loadHistory();
                      }}
                      title="Remove from history"
                      aria-label={`Remove ${item.title} from history`}
                      className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-white/30 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-all active:scale-90 shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Extra bottom spacer so final card is 100% visible and above gesture nav bar */}
            <div className="h-8 sm:h-4 w-full shrink-0" aria-hidden="true" />
          </section>
        </div>
      </div>
    </div>
  );
};