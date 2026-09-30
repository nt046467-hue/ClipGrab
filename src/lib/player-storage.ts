// player-storage.ts
// Manages all local player state: history, positions, queue, settings
// Uses localStorage only for metadata/state -- never for video blobs

export const STORAGE_KEYS = {
  WATCH_HISTORY: 'cg_watch_history',
  WATCH_POSITIONS: 'cg_watch_positions',
  PLAYER_SETTINGS: 'cg_player_settings',
  PLAY_QUEUE: 'cg_play_queue',
} as const;

export interface WatchHistoryEntry {
  id: string;
  title: string;
  thumbnail: string;
  duration: number; // in seconds
  lastPosition: number; // in seconds
  lastWatched: number; // unix ms
  completionPct: number; // 0-100
  fileUrl: string;
  fileSize?: string;
  quality?: string;
  mimeType?: string;
  author?: string;
  platform?: string;
}

export interface PlayerSettings {
  volume: number;
  muted: boolean;
  playbackRate: number;
  fitMode: 'contain' | 'cover';
  loop: boolean;
  autoplayNext: boolean;
  seekAmount: 5 | 10 | 15 | 30;
  subtitleSize: 'sm' | 'md' | 'lg';
  captionsEnabled: boolean;
}

export interface QueueItem {
  id: string;
  title: string;
  thumbnail: string;
  fileUrl: string;
  duration?: number;
  mimeType?: string;
  quality?: string;
  author?: string;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  volume: 1,
  muted: false,
  playbackRate: 1,
  fitMode: 'contain',
  loop: false,
  autoplayNext: false,
  seekAmount: 10,
  subtitleSize: 'md',
  captionsEnabled: false,
};

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or privacy mode
  }
}

export function getWatchHistory(): WatchHistoryEntry[] {
  return safeRead<WatchHistoryEntry[]>(STORAGE_KEYS.WATCH_HISTORY, []);
}

export function upsertWatchHistory(entry: WatchHistoryEntry): void {
  const history = getWatchHistory();
  const idx = history.findIndex((h) => h.id === entry.id);
  if (idx >= 0) {
    history[idx] = { ...history[idx], ...entry };
  } else {
    history.unshift(entry);
  }
  safeWrite(STORAGE_KEYS.WATCH_HISTORY, history.slice(0, 100));
}

export function removeFromHistory(id: string): void {
  const filtered = getWatchHistory().filter((h) => h.id !== id);
  safeWrite(STORAGE_KEYS.WATCH_HISTORY, filtered);
}

export function clearWatchHistory(): void {
  safeWrite(STORAGE_KEYS.WATCH_HISTORY, []);
}

export function getWatchPosition(id: string): number {
  const positions = safeRead<Record<string, number>>(STORAGE_KEYS.WATCH_POSITIONS, {});
  return positions[id] ?? 0;
}

export function saveWatchPosition(id: string, position: number): void {
  const positions = safeRead<Record<string, number>>(STORAGE_KEYS.WATCH_POSITIONS, {});
  positions[id] = position;
  const keys = Object.keys(positions);
  if (keys.length > 500) {
    delete positions[keys[0]];
  }
  safeWrite(STORAGE_KEYS.WATCH_POSITIONS, positions);
}

export function clearWatchPosition(id: string): void {
  const positions = safeRead<Record<string, number>>(STORAGE_KEYS.WATCH_POSITIONS, {});
  delete positions[id];
  safeWrite(STORAGE_KEYS.WATCH_POSITIONS, positions);
}

export function getPlayerSettings(): PlayerSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...safeRead<Partial<PlayerSettings>>(STORAGE_KEYS.PLAYER_SETTINGS, {}),
  };
}

export function savePlayerSettings(settings: Partial<PlayerSettings>): void {
  const current = getPlayerSettings();
  safeWrite(STORAGE_KEYS.PLAYER_SETTINGS, { ...current, ...settings });
}

export function getQueue(): QueueItem[] {
  return safeRead<QueueItem[]>(STORAGE_KEYS.PLAY_QUEUE, []);
}

export function saveQueue(queue: QueueItem[]): void {
  safeWrite(STORAGE_KEYS.PLAY_QUEUE, queue);
}

export function addToQueue(item: QueueItem): void {
  const queue = getQueue();
  if (!queue.find((q) => q.id === item.id)) {
    queue.push(item);
    saveQueue(queue);
  }
}

export function removeFromQueue(id: string): void {
  const filtered = getQueue().filter((q) => q.id !== id);
  saveQueue(filtered);
}

export function clearQueue(): void {
  safeWrite(STORAGE_KEYS.PLAY_QUEUE, []);
}

export function generateVideoId(url: string, title?: string): string {
  let hash = 0;
  const str = (url || '') + '::' + (title || '');
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return 'cg_vid_' + Math.abs(hash).toString(36);
}