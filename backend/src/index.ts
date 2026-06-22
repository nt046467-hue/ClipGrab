
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { downloadQueue, isRedis } from './queue';
import { getYtDlpMetadata, downloadVideo, findActualOutputFile, getYtDlpPath } from './yt-dlp';
import { startCleanupCron } from './cleanup';
import path from 'path';
import fs from 'fs';
import sanitize from 'sanitize-filename';
import { spawn } from 'child_process';

const app = express();
const port = Number(process.env.PORT) || 8080;

// Support initializing cookies from an environment variable (YTDLP_COOKIES_CONTENT)
// This ensures cookies persist across container restarts/redeploys on services like Render
const cookiesContent = process.env.YTDLP_COOKIES_CONTENT;
if (cookiesContent) {
  try {
    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    fs.writeFileSync(cookiesPath, cookiesContent, 'utf-8');
    console.log('[Cookies] Successfully initialized cookies.txt from YTDLP_COOKIES_CONTENT env var');
  } catch (err: any) {
    console.error('[Cookies] Failed to initialize cookies.txt from env var:', err?.message || err);
  }
}

app.use(cors());
app.use(express.json());

// In-memory job store for non-Redis mode
interface SimpleJob {
  id: string;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  progress: number;
  returnvalue: any;
  failedReason: string | null;
}
const inMemoryJobs = new Map<string, SimpleJob>();

// Rate limiting: 10 requests / 15 min on download
const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many download requests, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

// 1. POST /api/resolve
app.post('/api/resolve', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  console.log(`Resolving metadata for: ${url}`);
  try {
    const metadata = await getYtDlpMetadata(url);
    res.json(metadata);
  } catch (error: any) {
    console.error('Resolve Error:', error);
    res.status(500).json({ error: error.message || 'Failed to resolve metadata' });
  }
});

// 2. POST /api/download
app.post('/api/download', downloadLimiter, async (req, res) => {
  const { url, formatId, type, title, platform } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const jobId = uuidv4();

  if (isRedis) {
    // Use BullMQ queue
    await downloadQueue.add('download-job', { jobId, url, formatId, type, title, platform }, { jobId });
    res.json({ jobId });
  } else {
    // In-process download — no separate worker process needed
    const sanitizedTitle = sanitize(title || 'video')
      .replace(/\s+/g, '_')
      .replace(/[#%?&]/g, '');
    const ext = type === 'audio' ? 'mp3' : 'mp4';
    const filename = `${platform || 'Web'}_${sanitizedTitle}_${formatId || 'best'}.${ext}`;
    const TEMP_DIR = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
    const outputPath = path.join(TEMP_DIR, filename);

    const job: SimpleJob = {
      id: jobId,
      status: 'waiting',
      progress: 0,
      returnvalue: null,
      failedReason: null,
    };
    inMemoryJobs.set(jobId, job);

    // Run download in background (fire-and-forget), progress tracked in job store
    (async () => {
      job.status = 'active';
      try {
        await downloadVideo(url, formatId, type, outputPath, (pct) => {
          job.progress = pct;
        });
        // Resolve actual filename (yt-dlp may write a slightly different name)
        const actualFilename = findActualOutputFile(TEMP_DIR, outputPath);
        job.status = 'completed';
        job.returnvalue = { filename: actualFilename, downloadUrl: `/api/files/${encodeURIComponent(actualFilename)}` };
        console.log(`[Job ${jobId}] Download completed: ${actualFilename}`);
      } catch (err: any) {
        job.status = 'failed';
        job.failedReason = err.message || 'Download failed';
        console.error(`[Job ${jobId}] Download failed:`, err.message);
      }
    })();

    res.json({ jobId });
  }
});

// 3. GET /api/status/:jobId
app.get('/api/status/:jobId', async (req, res) => {
  const { jobId } = req.params;

  if (isRedis) {
    const job = await downloadQueue.getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const state = await job.getState();
    const progress = job.progress;
    return res.json({
      id: job.id,
      status: state,
      progress,
      result: state === 'completed' ? job.returnvalue : null,
      error: state === 'failed' ? job.failedReason : null,
    });
  } else {
    const job = inMemoryJobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    return res.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      result: job.status === 'completed' ? job.returnvalue : null,
      error: job.status === 'failed' ? job.failedReason : null,
    });
  }
});

// 4. Serve downloaded files
app.get('/api/files/:filename', (req, res) => {
  const filePath = path.join(process.cwd(), 'temp', req.params.filename);
  if (fs.existsSync(filePath)) {
    if (req.query.inline === 'true') {
      res.sendFile(filePath);
    } else {
      res.download(filePath);
    }
  } else {
    res.status(404).send('File expired or not found');
  }
});

// 5. POST /api/upload-cookies
app.post('/api/upload-cookies', async (req, res) => {
  const { cookies } = req.body;
  if (!cookies) return res.status(400).json({ error: 'Cookies content is required' });

  try {
    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    fs.writeFileSync(cookiesPath, cookies, 'utf-8');
    console.log(`[Cookies] Saved cookies.txt successfully`);
    res.json({ success: true, message: 'Cookies updated successfully!' });
  } catch (error: any) {
    console.error('Upload cookies error:', error);
    res.status(500).json({ error: error.message || 'Failed to save cookies' });
  }
});

// 6. GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    redis: isRedis ? 'active' : 'inactive',
  });
});

// 7. GET /api/preview
app.get('/api/preview', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL is required');

  console.log(`[Preview] Starting stream proxy for: ${url}`);
  const ytDlpPath = getYtDlpPath();

  const args = [
    '-f', 'best[height<=480]/best',
    '-o', '-',
    '--no-playlist',
  ];

  // Include cookies if present
  const defaultCookiesPath = path.join(process.cwd(), 'cookies.txt');
  const cookiesFile = process.env.YTDLP_COOKIES || (fs.existsSync(defaultCookiesPath) ? defaultCookiesPath : undefined);
  if (cookiesFile && fs.existsSync(cookiesFile)) {
    args.push('--cookies', cookiesFile);
  }
  args.push('--extractor-args', 'youtube:player_client=ios,web_embedded');
  args.push(url as string);

  const proc = spawn(ytDlpPath, args, { windowsHide: true });

  res.setHeader('Content-Type', 'video/mp4');

  proc.stdout.pipe(res);

  proc.stderr.on('data', (data) => {
    console.error(`[Preview stderr] ${data.toString().trim()}`);
  });

  proc.on('error', (err) => {
    console.error('[Preview error]', err);
    if (!res.headersSent) {
      res.status(500).end();
    }
  });

  req.on('close', () => {
    console.log(`[Preview] Connection closed by client, killing process`);
    proc.kill('SIGINT');
  });
});

// 8. POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ reply: "Ask me a question." });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured in backend env");
    }

    const result = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are ClipGrab's support engine. Answer briefly and in plain language about downloading from YouTube, TikTok, Instagram, Facebook, or Twitter/X. Keep replies under 3 sentences. User question: ${message}`
            }]
          }]
        })
      }
    );

    if (!result.ok) {
      const errText = await result.text();
      console.error('[Gemini API response error]', errText);
      throw new Error(`Gemini API error status: ${result.status}`);
    }

    const data = await result.json() as any;
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!replyText) {
      throw new Error("Empty candidate parts response from Gemini API");
    }

    res.json({ reply: replyText });
  } catch (err: any) {
    console.error('[Chat Assistant Engine Error]:', err?.message || err);
    res.status(500).json({ reply: "Connection to the assistant engine failed — try again in a moment." });
  }
});

// If Redis is available, load separate worker process
if (isRedis) {
  console.log('[Backend] Redis is active. Worker runs as separate process.');
}

startCleanupCron();

app.listen(port, '0.0.0.0', () => {
  console.log(`Backend listening at http://0.0.0.0:${port}`);
  console.log(`[Backend] Queue mode: ${isRedis ? 'Redis/BullMQ' : 'In-Process'}`);
});
