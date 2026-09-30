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
  Zap,
  AlertTriangle,
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
import { generateFileThumbnail } from '@/lib/media-utils';
import { getStoredApiUrl } from '@/lib/api-config';

interface DownloadedLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  onPlayVideo: (source: VideoSource) => void;
}

export const DownloadedLibrary: React.FC<DownloadedLibraryProps> = ({
  isOpen,
  onClose,
  onPlayVideo,
}) => {
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);
  const [isClosing, setIsClosing] = useState(false);
  // Inline warning for stale Colab entries (non-blocking, replaces native confirm())
  const [staleWarning, setStaleWarning] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);

  const loadHistory = useCallback(() => {
    setHistory(getWatchHistory());
  }, []);

  // Smooth close with transition — also signals Navbar to clear active state
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clipgrab_library_closed'));
      }
    }, 200);
  }, [onClose]);

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

  if (!isOpen && !isClosing) return null;

  const inProgress = history.filter((h) => h.completionPct > 5 && h.completionPct < 95);

  const handleOpenLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const id = generateVideoId(file.name, file.size.toString());
    // Register into memory store (prevents Chrome GC) and persist to IndexedDB
    const safeObjectUrl = registerActiveMedia(id, file, file.name);

    // Extract actual video frame thumbnail from file so it never looks blank or broken
    const thumb = await generateFileThumbnail(file).catch(() => '');

    onPlayVideo({
      id,
      url: safeObjectUrl,
      title: file.name.replace(/\.[^/.]+$/, ''),
      thumbnail: thumb,
      mimeType: file.type || 'video/mp4',
      fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
    });
    handleClose();
  };

  const handleResumeHistory = async (entry: WatchHistoryEntry) => {
    let playUrl = entry.fileUrl;
    setStaleWarning(null);

    // ── Blob URL: verify / revive from IndexedDB ──
    if (entry.fileUrl.startsWith('blob:')) {
      const safe = await getSafeMediaUrl(entry.id, entry.fileUrl);
      if (safe.isRevived) {
        playUrl = safe.url;
      } else {
        const isAlive = await testBlobUrl(entry.fileUrl);
        if (!isAlive) {
          setStaleWarning(`"${entry.title}" is a local file that's no longer accessible. Open it again using the folder button above.`);
          fileInputRef.current?.click();
          return;
        }
      }
    }

    // ── HTTP / Colab URL: try to rewrite with current API host if hostname differs ──
    if (entry.fileUrl.startsWith('http')) {
      const currentBase = getStoredApiUrl(); // e.g. https://new-colab.trycloudflare.com
      try {
        const storedUrl = new URL(entry.fileUrl);
        const currentUrl = new URL(currentBase);

        if (storedUrl.host !== currentUrl.host) {
          // Hosts differ — try rewriting path to current server
          const rewritten = `${currentBase}${storedUrl.pathname}${storedUrl.search}`;
          try {
            const check = await fetch(rewritten, {
              method: 'HEAD',
              signal: AbortSignal.timeout(3000),
            });
            if (check.ok) {
              // Current server has this file! Use the new URL.
              playUrl = rewritten;
            } else {
              throw new Error('Not found on new server');
            }
          } catch {
            // Rewrite failed — also check if original is alive
            try {
              const ping = await fetch(entry.fileUrl, {
                method: 'HEAD',
                signal: AbortSignal.timeout(2000),
              });
              if (!ping.ok) throw new Error('Original also dead');
              // Original URL still works, use it
              playUrl = entry.fileUrl;
            } catch {
              // Both old and rewritten URL are dead
              setStaleWarning(
                `"${entry.title}" was streamed from a different Colab session that has ended. ` +
                `If you downloaded the file, tap the folder button above to open it locally.`
              );
              return;
            }
          }
        } else {
          // Same host — quick reachability ping
          try {
            await fetch(entry.fileUrl, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
          } catch {
            setStaleWarning(
              `"${entry.title}" cannot be reached. The server may be offline or restarting.`
            );
            return;
          }
        }
      } catch {
        // URL parse failed — play as-is and let the player show error if needed
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
      className="fixed inset-0 z-[60] flex items-center justify-center"
    >
      {/* ── Backdrop (Desktop & Mobile) ── */}
      <div
        onClick={handleClose}
        className={`fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity duration-200 ${
          isClosing ? 'opacity-0' : 'opacity-100'
        }`}
        aria-hidden="true"
      />

      {/* ── True Full-Screen Mobile Panel (<640px) / Centered Modal (>=640px) ── */}
      <div
        className={`relative z-10 w-full h-[100dvh] sm:h-auto sm:max-h-[85dvh] sm:max-w-2xl bg-[#080a11] sm:rounded-3xl border-0 sm:border sm:border-white/[0.08] shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${
          isClosing ? 'opacity-0 translate-y-4 sm:scale-95' : 'opacity-100 translate-y-0 sm:scale-100'
        }`}
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
      >
        {/* Sticky Mobile Header / Modal Header */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-white/[0.08] bg-[#0c0f18]/95 backdrop-blur-xl shrink-0 select-none"
        >
          {/* Title and item counter — full width, never truncated */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center text-primary shrink-0">
              <Film className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>

            <div className="flex flex-col min-w-0">
              <h2 className="font-headline font-black text-base sm:text-lg text-white leading-tight tracking-tight">
                My Library
              </h2>
              <p className="text-[11px] sm:text-xs text-white/45 leading-none mt-0.5">
                {history.length > 0
                  ? `${history.length} saved video${history.length !== 1 ? 's' : ''}`
                  : 'No saved videos yet'}
              </p>
            </div>
          </div>

          {/* Action buttons — identical 40×40 icon-only style, 8px gap */}
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*"
              onChange={handleOpenLocalFile}
              className="hidden"
            />
            {/* Open File — icon-only, same style as close */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Open a local downloaded file"
              aria-label="Open a local downloaded file"
              style={{ minWidth: 44, minHeight: 44 }}
              className="w-10 h-10 rounded-full bg-white/[0.05] hover:bg-white/10 border border-white/[0.08] text-white/70 hover:text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <FolderOpen className="w-[18px] h-[18px] shrink-0" />
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close My Library"
              style={{ minWidth: 44, minHeight: 44 }}
              className="w-10 h-10 rounded-full bg-white/[0.05] hover:bg-white/10 border border-white/[0.08] text-white/70 hover:text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body with Smooth Momentum Scrolling */}
        <div
          ref={scrollContentRef}
          className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-6"
          style={{
            paddingBottom: 'max(3rem, calc(env(safe-area-inset-bottom, 0px) + 2rem))',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* Stale Colab / Offline Warning Alert Banner */}
          {staleWarning && (
            <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3 animate-in fade-in-50 duration-200">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-amber-200/90 leading-relaxed font-medium">
                  {staleWarning}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStaleWarning(null)}
                aria-label="Dismiss warning"
                className="p-1 rounded-lg text-amber-400/60 hover:text-amber-300 hover:bg-amber-500/10 transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Continue Watching Section */}
          {inProgress.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
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
                    className="w-48 sm:w-56 shrink-0 snap-start rounded-2xl bg-[#111420] border border-white/[0.08] hover:border-primary/40 overflow-hidden group transition-all duration-200 active:scale-[0.98] text-left cursor-pointer shadow-lg"
                  >
                    <div className="relative aspect-video bg-gradient-to-br from-[#12162a] via-[#0c0f1d] to-[#07090e] overflow-hidden flex items-center justify-center">
                      {item.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnail}
                          alt=""
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300 absolute inset-0 z-10"
                        />
                      ) : null}
                      <div className="flex flex-col items-center justify-center p-2 text-center select-none">
                        <div className="w-8 h-8 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary mb-1">
                          <Film className="w-4 h-4" />
                        </div>
                        <span className="text-[9px] font-bold text-white/50 uppercase tracking-wider">
                          Video
                        </span>
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10 pointer-events-none" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        <div className="w-10 h-10 rounded-full bg-primary shadow-lg shadow-primary/50 flex items-center justify-center">
                          <Play className="w-4 h-4 fill-white ml-0.5" />
                        </div>
                      </div>
                      <span className="absolute bottom-1.5 right-1.5 bg-black/90 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded text-white/90 border border-white/[0.12] z-20">
                        {formatRemainingTime(item.lastPosition, item.duration)} left
                      </span>
                      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 z-20">
                        <div className="h-full bg-primary rounded-r-full" style={{ width: `${item.completionPct}%` }} />
                      </div>
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="font-semibold text-xs text-white line-clamp-1 group-hover:text-primary transition-colors">
                        {item.title}
                      </p>
                      <p className="text-[10px] text-white/40 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-primary/80" />
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-xs sm:text-sm text-white flex items-center gap-2">
                <ListVideo className="w-4 h-4 text-white/40" />
                Watch History &amp; Saved Videos
              </h3>
              <div className="flex items-center gap-2">
                {history.some((h) => h.fileUrl.includes('trycloudflare.com')) && (
                  <button
                    type="button"
                    onClick={() => {
                      const colabItems = history.filter((h) => h.fileUrl.includes('trycloudflare.com'));
                      if (
                        confirm(
                          `Remove ${colabItems.length} temporary Colab session link${
                            colabItems.length > 1 ? 's' : ''
                          }? (Your actual downloaded video files on your phone/PC will remain safe in Downloads)`
                        )
                      ) {
                        colabItems.forEach((h) => {
                          removeFromHistory(h.id);
                          removeMediaBlob(h.id);
                        });
                        loadHistory();
                      }
                    }}
                    className="min-h-[36px] text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors cursor-pointer py-1 px-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 active:scale-95"
                    title="Clean temporary Colab links"
                  >
                    <Zap className="w-3.5 h-3.5 fill-amber-400" />
                    <span>Clean Colab ({history.filter((h) => h.fileUrl.includes('trycloudflare.com')).length})</span>
                  </button>
                )}
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { clearWatchHistory(); loadHistory(); }}
                    className="min-h-[36px] text-[11px] text-red-400/80 hover:text-red-400 flex items-center gap-1.5 transition-colors cursor-pointer py-1 px-2.5 rounded-lg hover:bg-red-500/10 active:scale-95"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 sm:py-16 gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.01]">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary/60">
                  <Download className="w-6 h-6 sm:w-7 sm:h-7" />
                </div>
                <div className="text-center px-4 sm:px-6 space-y-1.5">
                  <p className="font-bold text-sm sm:text-base text-white/70">No videos in your library</p>
                  <p className="text-xs text-white/40 leading-relaxed max-w-sm">
                    Downloads from ClipGrab appear here automatically with saved resume progress, or pick any local file on your phone.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[48px] h-12 sm:h-10 px-6 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-primary/25 transition-all cursor-pointer active:scale-95"
                >
                  <FolderOpen className="w-4 h-4" />
                  Open a local file
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-2.5 sm:p-3 rounded-2xl bg-white/[0.03] border border-white/[0.07] hover:border-white/15 hover:bg-white/[0.05] transition-all group"
                  >
                    {/* Thumbnail with duration badge and progress bar */}
                    <button
                      type="button"
                      onClick={() => handleResumeHistory(item)}
                      aria-label={`Play ${item.title}`}
                      className="relative w-24 h-16 sm:w-28 sm:h-18 rounded-xl bg-gradient-to-br from-[#12162a] via-[#0c0f1d] to-[#07090e] overflow-hidden shrink-0 group/th cursor-pointer border border-white/10 flex items-center justify-center"
                    >
                      {item.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnail}
                          alt=""
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          className="w-full h-full object-cover group-hover/th:scale-105 transition-transform absolute inset-0 z-10"
                        />
                      ) : null}
                      <div className="flex flex-col items-center justify-center p-1 text-center select-none">
                        <Film className="w-5 h-5 text-primary/70 mb-0.5" />
                        <span className="text-[8px] font-bold text-white/40 uppercase">Video</span>
                      </div>
                      {/* Play overlay */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/th:opacity-100 flex items-center justify-center transition-opacity z-20">
                        <Play className="w-5 h-5 fill-white text-white" />
                      </div>
                      {/* Duration */}
                      {item.duration > 0 && (
                        <span className="absolute bottom-1 right-1 bg-black/90 text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded text-white/90 border border-white/10 z-20">
                          {formatTime(item.duration)}
                        </span>
                      )}
                      {/* Progress bar */}
                      {item.completionPct > 2 && item.completionPct < 98 && (
                        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/15 z-20">
                          <div className="h-full bg-primary" style={{ width: `${item.completionPct}%` }} />
                        </div>
                      )}
                    </button>

                    {/* Metadata & Title (Clean 2-line wrap, no horizontal overflow) */}
                    <button
                      type="button"
                      onClick={() => handleResumeHistory(item)}
                      className="flex-1 min-w-0 text-left cursor-pointer py-0.5"
                    >
                      <p
                        className="font-semibold text-xs sm:text-[13px] text-white line-clamp-2 break-words leading-snug group-hover:text-primary transition-colors"
                        title={item.title}
                      >
                        {item.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {item.completionPct >= 95 ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                            <CheckCircle2 className="w-3 h-3" /> Watched
                          </span>
                        ) : (
                          <span className="text-[10px] text-white/45 font-medium">
                            {item.completionPct}% watched
                          </span>
                        )}
                        {item.quality && (
                          <span className="text-[9px] font-bold bg-white/[0.06] border border-white/10 text-white/60 px-1.5 py-0.5 rounded uppercase tracking-wider">
                            {item.quality}
                          </span>
                        )}
                        {item.fileSize && (
                          <span className="text-[9.5px] text-white/35 font-mono">
                            {item.fileSize}
                          </span>
                        )}
                        {item.fileUrl.includes('trycloudflare.com') && (
                          <span className="text-[9px] font-bold bg-amber-500/10 border border-amber-500/25 text-amber-300 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5 fill-amber-300" /> Colab
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
                      className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-white/35 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-all active:scale-90 shrink-0 cursor-pointer"
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