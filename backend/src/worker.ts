import 'dotenv/config';
import { Worker, Job, connection } from './queue';
import { downloadVideo, findActualOutputFile, validateDownloadedFile, validateAndGetOutputFile } from './yt-dlp';
import path from 'path';
import fs from 'fs';
import http from 'http';
import sanitize from 'sanitize-filename';

// Support initializing cookies from an environment variable (YTDLP_COOKIES_CONTENT).
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

const PORT = process.env.PORT || 3001;
const WORKER_TEMP_DIR = path.join(process.cwd(), 'temp');
if (!fs.existsSync(WORKER_TEMP_DIR)) fs.mkdirSync(WORKER_TEMP_DIR, { recursive: true });

http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost`);

    if (url.pathname.startsWith('/files/')) {
      const parts = url.pathname.replace(/^\/files\//, '').split('/').filter(Boolean);
      
      let filePath = '';
      let filename = '';

      if (parts.length >= 2) {
        // Job-scoped path: /files/:jobId/:filename
        const [jobId, rawFilename] = parts;
        try {
          filename = decodeURIComponent(rawFilename);
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          return res.end('Malformed URI');
        }

        const jobDir = path.join(WORKER_TEMP_DIR, jobId);
        
        // Prefer final artifact subfolder: temp/<jobId>/final/<filename>
        filePath = path.join(jobDir, 'final', filename);
        if (!fs.existsSync(filePath)) {
          filePath = path.join(jobDir, filename);
        }

        // Guard against path traversal — resolved path must stay inside jobDir
        if (!filePath.startsWith(jobDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('File expired or not found');
        }
      } else if (parts.length === 1) {
        // Flat legacy path: /files/:filename
        try {
          filename = decodeURIComponent(parts[0]);
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          return res.end('Malformed URI');
        }
        filePath = path.join(WORKER_TEMP_DIR, filename);
        if (!filePath.startsWith(WORKER_TEMP_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('File expired or not found');
        }
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Malformed URL');
      }

      const stats = fs.statSync(filePath);
      const totalSize = stats.size;
      const isMp3 = filename.toLowerCase().endsWith('.mp3');
      const contentType = isMp3 ? 'audio/mpeg' : 'video/mp4';
      const safeFilename = filename.replace(/[^\x20-\x7E]/g, '_');
      const disposition = url.searchParams.get('inline') === 'true'
        ? 'inline'
        : `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

      // HTTP Range handling
      const range = req.headers.range;
      if (range) {
        const rangeParts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(rangeParts[0], 10);
        const end = rangeParts[1] ? parseInt(rangeParts[1], 10) : totalSize - 1;

        if (isNaN(start) || start >= totalSize || end >= totalSize || start > end) {
          res.writeHead(416, {
            'Content-Type': 'text/plain',
            'Content-Range': `bytes */${totalSize}`,
          });
          return res.end('Requested Range Not Satisfiable');
        }

        const chunkSize = (end - start) + 1;
        res.writeHead(206, {
          'Content-Type': contentType,
          'Content-Disposition': disposition,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
        });
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Content-Length': totalSize.toString(),
        'Accept-Ranges': 'bytes',
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    if (req.method === 'POST' && url.pathname === '/upload-cookies') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { cookies } = JSON.parse(body);
          if (cookies) {
            const cookiesPath = path.join(process.cwd(), 'cookies.txt');
            fs.writeFileSync(cookiesPath, cookies, 'utf-8');
            console.log('[Worker][Cookies] Saved cookies.txt synchronized from API successfully');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Cookies content required');
          }
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid JSON body');
        }
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('worker ok');
  } catch (err: any) {
    console.error('[Worker HTTP Server] Uncaught error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
}).listen(PORT, () => {
  console.log(`[Worker] HTTP server (health check + file serving) listening on port ${PORT}`);
});

// Self-ping to stay warm on Render
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL)
      .then(() => console.log('[Worker] Self-ping OK, staying warm'))
      .catch((err) => console.error('[Worker] Self-ping failed:', err.message));
  }, 10 * 60 * 1000);
}

const worker = new Worker('downloads', async (job: Job) => {
  const { jobId, url, formatId, type, title, platform } = job.data;
  const currentJobId = String(jobId || job.id);
  console.log(`[Worker] Processing job ${currentJobId}: Platform=${platform}, Format=${formatId}, Type=${type}`);

  const sanitizedTitle = (sanitize(title || 'video')
    .replace(/\s+/g, '_')
    .replace(/[#%?&]/g, '')
    .slice(0, 80) || 'video');
  const ext = type === 'audio' ? 'mp3' : 'mp4';
  const filename = `${platform || 'Web'}_${sanitizedTitle}_${formatId || 'best'}.${ext}`;

  // Isolated per-job directory
  const jobDir = path.join(WORKER_TEMP_DIR, currentJobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });
  const outputPath = path.join(jobDir, filename);

  await downloadVideo(url, formatId, type, outputPath, (pct) => {
    job.updateProgress(pct);
  });

  // Validate output file, run FFprobe verification, and establish final artifact
  const validated = await validateAndGetOutputFile(jobDir, outputPath, type);

  console.log(`[Worker] Job ${currentJobId} completed: ${validated.filename} (${validated.finalSizeBytes} bytes, ${validated.finalSize})`);

  const workerBaseUrl = (process.env.WORKER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  console.log(`[Worker] File URL check — resolved base: ${workerBaseUrl || 'EMPTY'}`);
  const fileUrl = workerBaseUrl
    ? `${workerBaseUrl}/files/${encodeURIComponent(currentJobId)}/${encodeURIComponent(validated.filename)}`
    : `/api/files/${encodeURIComponent(currentJobId)}/${encodeURIComponent(validated.filename)}`;

  return {
    filename: validated.filename,
    downloadUrl: fileUrl,
    finalSizeBytes: validated.finalSizeBytes,
    finalSize: validated.finalSize,
    sizeBytes: validated.sizeBytes,
    size: validated.size,
    mimeType: validated.mimeType,
    width: validated.width,
    height: validated.height,
    duration: validated.duration,
    videoCodec: validated.videoCodec,
    audioCodec: validated.audioCodec,
  };
}, { connection });

worker.on('completed', (job: any) => {
  console.log(`[Worker] Job ${job.id} finished successfully.`);
});

worker.on('failed', (job: any, err: any) => {
  console.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
});
