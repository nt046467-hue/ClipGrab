import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = path.join(process.cwd(), 'temp');

// Track active streams (jobId -> count)
const activeStreams = new Map<string, number>();

// Track active download tasks (jobId -> boolean)
const activeJobs = new Set<string>();

// Track known job durations in seconds (jobId -> duration in seconds)
const jobDurations = new Map<string, number>();

export function registerActiveStream(jobId: string): () => void {
  const current = activeStreams.get(jobId) || 0;
  activeStreams.set(jobId, current + 1);
  return () => {
    const count = activeStreams.get(jobId) || 1;
    if (count <= 1) {
      activeStreams.delete(jobId);
    } else {
      activeStreams.set(jobId, count - 1);
    }
  };
}

export function registerActiveJob(jobId: string, duration?: number): void {
  activeJobs.add(jobId);
  if (duration && duration > 0) {
    jobDurations.set(jobId, duration);
  }
}

export function unregisterActiveJob(jobId: string): void {
  activeJobs.delete(jobId);
}

export function setJobDuration(jobId: string, duration: number): void {
  if (duration && duration > 0) {
    jobDurations.set(jobId, duration);
  }
}

export function isStreamOrJobActive(jobId: string): boolean {
  if (activeJobs.has(jobId)) return true;
  if ((activeStreams.get(jobId) || 0) > 0) return true;
  return false;
}

/**
 * Recursively scans a directory for:
 * 1. The newest mtimeMs of any file inside it.
 * 2. Total file count.
 * 3. Whether there are any active partial files (.part, .ytdl, etc.) modified recently.
 */
function scanFolderFiles(dirPath: string): { newestMtimeMs: number; fileCount: number; hasActivePartial: boolean } {
  let newestMtimeMs = 0;
  let fileCount = 0;
  let hasActivePartial = false;
  const now = Date.now();

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = scanFolderFiles(fullPath);
          if (sub.newestMtimeMs > newestMtimeMs) newestMtimeMs = sub.newestMtimeMs;
          fileCount += sub.fileCount;
          if (sub.hasActivePartial) hasActivePartial = true;
        } else {
          fileCount++;
          const stats = fs.statSync(fullPath);
          if (stats.mtimeMs > newestMtimeMs) newestMtimeMs = stats.mtimeMs;

          const isPartial = entry.name.endsWith('.part') || entry.name.endsWith('.ytdl') || entry.name.endsWith('.temp');
          // If a partial file was updated within the last 5 minutes, download is still actively streaming
          if (isPartial && (now - stats.mtimeMs < 5 * 60 * 1000)) {
            hasActivePartial = true;
          }
        }
      } catch {}
    }
  } catch {}

  return { newestMtimeMs, fileCount, hasActivePartial };
}

/**
 * Retrieves the video duration for a job folder, inspecting:
 * 1. In-memory duration tracker
 * 2. job_meta.json inside folder if written
 */
function getJobDurationSeconds(entryPath: string, jobId: string): number {
  if (jobDurations.has(jobId)) {
    return jobDurations.get(jobId)!;
  }

  const metaPath = path.join(entryPath, 'job_meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (typeof data.duration === 'number') {
        return data.duration;
      }
    } catch {}
  }

  return 0;
}

export function startCleanupCron() {
  // Cron job runs every 5 minutes to clean up temp files and expired job folders
  cron.schedule('*/5 * * * *', () => {
    console.log('[Cleanup] Running temp directory cleanup...');
    if (!fs.existsSync(TEMP_DIR)) return;

    try {
      const entries = fs.readdirSync(TEMP_DIR);
      const now = Date.now();

      entries.forEach(entry => {
        const entryPath = path.join(TEMP_DIR, entry);
        try {
          const stats = fs.statSync(entryPath);

          if (stats.isDirectory()) {
            const jobId = entry;

            // 1. Skip folders with an active download stream or active job
            if (isStreamOrJobActive(jobId)) {
              console.log(`[Cleanup] Skipping active job folder: ${jobId}`);
              return;
            }

            // 2. Scan files inside folder: use newest mtime of files inside it, not folder mtime
            const scan = scanFolderFiles(entryPath);
            if (scan.hasActivePartial) {
              console.log(`[Cleanup] Skipping job folder with active streaming write: ${jobId}`);
              return;
            }

            // 3. Determine expiry: 60 min if duration > 30 min (1800s), else 15 min
            const durationSec = getJobDurationSeconds(entryPath, jobId);
            const isLongVideo = durationSec > 30 * 60;
            const expiry = isLongVideo ? (60 * 60 * 1000) : (15 * 60 * 1000);

            // If folder has files, base expiration on the newest file mtime inside it.
            // If folder is completely empty, use folder's own mtime.
            const effectiveMtime = scan.fileCount > 0 ? scan.newestMtimeMs : stats.mtimeMs;

            if (now - effectiveMtime > expiry) {
              console.log(`[Cleanup] Deleting expired job folder: ${entry} (expiry: ${isLongVideo ? '60m' : '15m'}, age: ${Math.round((now - effectiveMtime) / 60000)}m)`);
              fs.rmSync(entryPath, { recursive: true, force: true });
              activeJobs.delete(jobId);
              jobDurations.delete(jobId);
            }
          } else {
            // Flat file cleanup (older than 15 min)
            const expiry = 15 * 60 * 1000;
            if (now - stats.mtimeMs > expiry) {
              console.log(`[Cleanup] Deleting expired file: ${entry}`);
              fs.unlinkSync(entryPath);
            }
          }
        } catch (itemErr: any) {
          console.warn(`[Cleanup] Error processing ${entry}:`, itemErr.message);
        }
      });
    } catch (err: any) {
      console.warn('[Cleanup] Error reading temp directory:', err.message);
    }
  });
}
