import 'dotenv/config';
import { Worker, Job, connection } from './queue';
import { downloadVideo, findActualOutputFile } from './yt-dlp';
import path from 'path';
import fs from 'fs';
import http from 'http';
import sanitize from 'sanitize-filename';

// Support initializing cookies from an environment variable (YTDLP_COOKIES_CONTENT).
// The worker runs as its own separate service with its own filesystem now (split from
// the API for memory isolation), so it needs to write its own cookies.txt independently —
// it can no longer rely on index.ts having already written one to a shared disk.
const cookiesContent = process.env.YTDLP_COOKIES_CONTENT;
if (cookiesContent) {
  try {
    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    fs.writeFileSync(cookiesPath, cookiesContent, 'utf-8');
    console.log('[Worker][Cookies] Successfully initialized cookies.txt from YTDLP_COOKIES_CONTENT env var');
  } catch (err: any) {
    console.error('[Worker][Cookies] Failed to initialize cookies.txt from env var:', err?.message || err);
  }
}

// Render's free tier only allows "Web Service" type, which requires binding to a port
// and responding to health checks — Background Worker service type is paid-only.
// This server also serves completed files directly, since they physically live on this
// worker's own disk (the API service, on its own separate container, can't see them).
const PORT = process.env.PORT || 3001;
const WORKER_TEMP_DIR = path.join(process.cwd(), 'temp');

http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost`);

  if (url.pathname.startsWith('/files/')) {
    const filename = decodeURIComponent(url.pathname.replace('/files/', ''));
    const filePath = path.join(WORKER_TEMP_DIR, filename);
    // Guard against path traversal — resolved path must stay inside WORKER_TEMP_DIR
    if (!filePath.startsWith(WORKER_TEMP_DIR) || !fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('File expired or not found');
    }
    res.writeHead(200, {
      'Content-Type': filename.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4',
      'Content-Disposition': url.searchParams.get('inline') === 'true'
        ? 'inline'
        : `attachment; filename="${filename}"`,
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('worker ok');
}).listen(PORT, () => {
  console.log(`[Worker] HTTP server (health check + file serving) listening on port ${PORT}`);
});

// Render's free tier spins this down after 15 minutes with no inbound traffic — and it
// has no idea the worker is busy processing a real download, so it can kill mid-job.
// Self-ping our own public URL every 10 minutes to keep it warm. RENDER_EXTERNAL_URL is
// auto-injected by Render on every service; this is a no-op locally where it's unset.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL)
      .then(() => console.log('[Worker] Self-ping OK, staying warm'))
      .catch((err) => console.error('[Worker] Self-ping failed:', err.message));
  }, 10 * 60 * 1000); // every 10 minutes
}

const TEMP_DIR = path.join(process.cwd(), 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const worker = new Worker('downloads', async (job: Job) => {
  const { url, formatId, type, title, platform } = job.data;
  console.log(`[Worker] Processing job ${job.id}: Platform=${platform}, Format=${formatId}, Type=${type}`);

  const sanitizedTitle = sanitize(title || 'video')
    .replace(/\s+/g, '_')
    .replace(/[#%?&]/g, '');
  const ext      = type === 'audio' ? 'mp3' : 'mp4';
  const filename = `${platform || 'Web'}_${sanitizedTitle}_${formatId || 'best'}.${ext}`;
  const outputPath = path.join(TEMP_DIR, filename);

  await downloadVideo(url, formatId, type, outputPath, (pct) => {
    job.updateProgress(pct);
  });

  const actualFilename = findActualOutputFile(TEMP_DIR, outputPath);
  console.log(`[Worker] Job ${job.id} completed: ${actualFilename}`);

  // The worker runs in its own container — its files are NOT accessible via the
  // API service URL. Return an absolute URL pointing to THIS worker's own HTTP
  // server so the frontend downloads directly from the correct container.
  // Set WORKER_EXTERNAL_URL in Render to the worker's public URL, e.g.:
  //   https://clipgrab-worker.onrender.com
  const workerBaseUrl = (process.env.WORKER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  const fileUrl = workerBaseUrl
    ? `${workerBaseUrl}/files/${encodeURIComponent(actualFilename)}`
    : `/api/files/${encodeURIComponent(actualFilename)}`;

  return { filename: actualFilename, downloadUrl: fileUrl };
}, { connection });

worker.on('completed', (job: any) => {
  console.log(`[Worker] Job ${job.id} finished successfully.`);
});

worker.on('failed', (job: any, err: any) => {
  console.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
});
