
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

// Trust the reverse proxy (e.g. Render, Railway, Heroku, Nginx) so that
// express-rate-limit can correctly identify clients via X-Forwarded-For headers.
app.set('trust proxy', 1);

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

// 1b. GET /api/cookie-status — quick health check to detect when YouTube cookies have died
app.get('/api/cookie-status', async (req, res) => {
  const TEST_VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo" - first YouTube video ever, always available
  try {
    await getYtDlpMetadata(TEST_VIDEO);
    res.json({ valid: true, message: 'YouTube cookies are working.' });
  } catch (error: any) {
    const msg = error?.message || '';
    const isCookieIssue = /sign in to confirm|cookies are no longer valid|not a bot/i.test(msg);
    res.json({
      valid: false,
      message: isCookieIssue
        ? 'YouTube cookies have expired or been rotated. Export a fresh cookies.txt and update YTDLP_COOKIES_CONTENT.'
        : 'YouTube check failed for a non-cookie reason — check server logs.',
      raw: msg.slice(0, 300),
    });
  }
});

// 1c. GET /api/thumbnail — proxy thumbnail images server-side to dodge hotlink/referer blocks (Instagram especially)
app.get('/api/thumbnail', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('url is required');
  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
      },
    });
    if (!upstream.ok) return res.status(upstream.status).send('Failed to fetch thumbnail');
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err: any) {
    console.error('[Thumbnail Proxy] Error:', err.message);
    res.status(500).send('Failed to proxy thumbnail');
  }
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
  console.log(`[Download API] New download job: ${jobId} - URL: ${url}, Format: ${formatId}, Type: ${type}`);

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
    console.log(`[Download API] Job ${jobId} stored in memory, starting download in background`);

    // Run download in background (fire-and-forget), progress tracked in job store
    (async () => {
      job.status = 'active';
      console.log(`[Download API] Job ${jobId} status changed to active`);
      try {
        await downloadVideo(url, formatId, type, outputPath, (pct) => {
          job.progress = pct;
          console.log(`[Download API] Job ${jobId} progress: ${pct}%`);
        });
        // Resolve actual filename (yt-dlp may write a slightly different name)
        const actualFilename = findActualOutputFile(TEMP_DIR, outputPath);
        job.status = 'completed';
        job.returnvalue = { filename: actualFilename, downloadUrl: `/api/files/${encodeURIComponent(actualFilename)}` };
        console.log(`[Download API] Job ${jobId} completed: ${actualFilename}`);
      } catch (err: any) {
        job.status = 'failed';
        job.failedReason = err.message || 'Download failed';
        console.error(`[Download API] Job ${jobId} failed:`, err.message);
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
// In Redis/worker mode the file lives on the worker container's disk, not here.
// We proxy it internally so the browser only ever talks to this API URL.
// Set WORKER_BASE_URL on the API service to the worker's Render URL,
// e.g. https://clipgrab-worker.onrender.com
app.get('/api/files/:filename', async (req, res) => {
  const filename = req.params.filename;
  const inline = req.query.inline === 'true';

  // --- Redis/worker mode: proxy from worker container ---
  const workerBase = (process.env.WORKER_BASE_URL || '').replace(/\/$/, '');
  if (isRedis && workerBase) {
    const workerFileUrl = `${workerBase}/files/${encodeURIComponent(filename)}${inline ? '?inline=true' : ''}`;
    try {
      console.log(`[API] Proxying file from worker: ${workerFileUrl}`);
      const upstream = await fetch(workerFileUrl);
      if (!upstream.ok) {
        console.error(`[API] Worker returned ${upstream.status} for file: ${filename}`);
        return res.status(upstream.status).send('File expired or not found');
      }
      const contentType = filename.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4';
      res.set('Content-Type', contentType);
      res.set('Content-Disposition', inline ? 'inline' : `attachment; filename="${filename}"`);
      if (upstream.headers.get('content-length')) {
        res.set('Content-Length', upstream.headers.get('content-length')!);
      }
      // Stream the response body directly to the client
      const reader = upstream.body as any;
      if (reader && reader.pipe) {
        reader.pipe(res);
      } else {
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.send(buffer);
      }
      return;
    } catch (err: any) {
      console.error('[API] Failed to proxy file from worker:', err.message);
      return res.status(502).send('Worker unavailable — file may still be processing');
    }
  }

  // --- Local/in-memory mode: serve from this container's disk ---
  const filePath = path.join(process.cwd(), 'temp', filename);
  if (fs.existsSync(filePath)) {
    if (inline) {
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
  // Auto-reconnect when YouTube throttles below 100K
  args.push('--throttled-rate', '100K');
  args.push('--retries', '5');
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

// Helper function to call fetch with exponential backoff and jitter for retriable statuses (429, 500, 502, 503, 504)
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxAttempts = 4,
  initialDelayMs = 1000
): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const response = await fetch(url, options);
      
      const retriableStatuses = [429, 500, 502, 503, 504];
      if (response.ok || !retriableStatuses.includes(response.status) || attempt >= maxAttempts) {
        return response;
      }
      
      const delay = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      console.warn(`[Gemini API] Request failed with status ${response.status}. Retrying attempt ${attempt}/${maxAttempts} in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (error: any) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      const delay = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      console.warn(`[Gemini API] Network error: ${error.message || error}. Retrying attempt ${attempt}/${maxAttempts} in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// 8. POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ reply: "Ask me a question." });

  let geminiError: any = null;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured in backend env");
    }

    const result = await fetchWithRetry(
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
      if (result.status === 503) {
        throw new Error("The AI service is currently experiencing high demand. Please try again in a moment.");
      }
      if (result.status === 429) {
        throw new Error("The AI service rate limit has been exceeded. Please try again in a moment.");
      }
      throw new Error(`Gemini API error status: ${result.status}`);
    }

    const data = await result.json() as any;
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!replyText) {
      throw new Error("Empty candidate parts response from Gemini API");
    }

    return res.json({ reply: replyText });
  } catch (err: any) {
    geminiError = err;
    console.error('[Chat Assistant Engine Error]:', err?.message || err);
    console.warn('[Fallback] Gemini API failed. Checking for Groq fallback...');
  }

  // Fallback to Groq if Gemini failed and GROQ_API_KEY is configured
  const groqApiKey = process.env.GROQ_API_KEY;
  if (groqApiKey) {
    try {
      console.log('[Fallback] Calling Groq API...');
      const groqResponse = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              {
                role: 'user',
                content: `You are ClipGrab's support engine. Answer briefly and in plain language about downloading from YouTube, TikTok, Instagram, Facebook, or Twitter/X. Keep replies under 3 sentences. User question: ${message}`
              }
            ],
            max_tokens: 150,
          })
        }
      );

      if (!groqResponse.ok) {
        const groqErrText = await groqResponse.text();
        console.error('[Groq API response error]', groqErrText);
        throw new Error(`Groq API error status: ${groqResponse.status}`);
      }

      const groqData = await groqResponse.json() as any;
      const groqReplyText = groqData.choices?.[0]?.message?.content;
      if (!groqReplyText) {
        throw new Error("Empty choices response from Groq API");
      }

      console.log('[Fallback] Successfully resolved chat using Groq');
      return res.json({ reply: groqReplyText });
    } catch (groqErr: any) {
      console.error('[Fallback] Groq API fallback also failed:', groqErr?.message || groqErr);
    }
  }

  const userFriendlyMessage = geminiError?.message && (
    geminiError.message.includes("high demand") || 
    geminiError.message.includes("rate limit") || 
    geminiError.message.includes("configured")
  ) ? geminiError.message : "Connection to the assistant engine failed — try again in a moment.";
  
  res.status(500).json({ reply: userFriendlyMessage });
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

// Render's free tier spins this service down after 15 minutes of no inbound traffic,
// causing the frontend's health-check badge to show "reconnecting" and a ~50s cold start
// on the next real request. Self-ping our own public URL every 10 minutes to stay warm.
// RENDER_EXTERNAL_URL is auto-injected by Render; this is a no-op locally where it's unset.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    fetch(`${SELF_URL}/api/health`)
      .then(() => console.log('[Backend] Self-ping OK, staying warm'))
      .catch((err) => console.error('[Backend] Self-ping failed:', err.message));
  }, 10 * 60 * 1000); // every 10 minutes
}
