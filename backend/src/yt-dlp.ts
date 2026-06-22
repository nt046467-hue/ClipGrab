import { exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execPromise = util.promisify(exec);

// yt-dlp binary: use local .exe on Windows, system binary on Linux/Docker
export function getYtDlpPath(): string {
  if (process.platform === 'win32') {
    const localBinPath = path.join(process.cwd(), 'bin', 'yt-dlp.exe');
    if (fs.existsSync(localBinPath)) {
      return localBinPath;
    }
  }
  // On Linux/Mac (Docker/Render), use system-installed yt-dlp from Dockerfile
  return 'yt-dlp';
}

export function getFfmpegPath(): string {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch (e) { }
  return 'ffmpeg';
}

/**
 * Runs yt-dlp with -j and returns the parsed JSON metadata.
 * Uses spawn so we can handle large stdout without buffer issues.
 */
function runYtDlpJson(ytDlpPath: string, args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(ytDlpPath, args, { windowsHide: true });

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(Object.assign(new Error('Failed to parse yt-dlp JSON output'), { stderr }));
        }
      } else {
        reject(Object.assign(new Error(`yt-dlp exited with code ${code}`), { stderr }));
      }
    });

    child.on('error', (err) => {
      reject(Object.assign(err, { stderr }));
    });
  });
}

// Browsers to try for auto cookie extraction (in priority order)
const BROWSERS_TO_TRY = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi'];

function buildBaseArgs(url: string): string[] {
  // Try Deno first (recommended), then fall back to the absolute path of Node.
  // Use ios player_client to bypass YouTube bot detection on server IPs.
  return [
    '--no-playlist',
    '--js-runtimes', 'deno',
    '--js-runtimes', `node:${process.execPath}`,
    '--extractor-args', 'youtube:player_client=ios,web_embedded',
    '-j',
    url,
  ];
}

async function tryFetchMetadata(ytDlpPath: string, url: string, extraArgs: string[]): Promise<any> {
  const args = [...extraArgs, ...buildBaseArgs(url)];
  return runYtDlpJson(ytDlpPath, args);
}

export async function getYtDlpMetadata(url: string) {
  const ytDlpPath = getYtDlpPath();
  console.log(`[Metadata Resolver] Using yt-dlp at: ${ytDlpPath}`);

  // Strategy 1: manual cookie file via env var or default cookies.txt in current working directory
  const defaultCookiesPath = path.join(process.cwd(), 'cookies.txt');
  const cookiesFile = process.env.YTDLP_COOKIES || (fs.existsSync(defaultCookiesPath) ? defaultCookiesPath : undefined);
  const cookieFileArgs = (cookiesFile && fs.existsSync(cookiesFile))
    ? ['--cookies', cookiesFile]
    : [];

  const hasCookieFile = !!(cookiesFile && fs.existsSync(cookiesFile));

  // Build ordered list of strategies to try
  // Each entry is a label + extra args prepended to the command
  const strategies: Array<{ label: string; extraArgs: string[] }> = [
    // First try with manual cookie file (or no cookies if not set)
    { label: 'default', extraArgs: cookieFileArgs },
  ];

  // Only fall back to browser cookies when NO cookies.txt is present.
  // If we already have a cookies file, don't try browser profiles —
  // it causes noisy errors for every browser that isn't installed (e.g. Vivaldi).
  if (!hasCookieFile && process.platform !== 'linux') {
    BROWSERS_TO_TRY.forEach(b => {
      strategies.push({
        label: `cookies-from-browser:${b}`,
        extraArgs: ['--cookies-from-browser', b],
      });
    });
  }

  let lastError: any = null;

  for (const strategy of strategies) {
    try {
      console.log(`[Metadata Resolver] Trying strategy: ${strategy.label}`);
      const data = await tryFetchMetadata(ytDlpPath, url, strategy.extraArgs);

      const heights: number[] = (data.formats || [])
        .filter((f: any) => f.height && typeof f.height === 'number')
        .map((f: any) => f.height as number);
      const maxHeight = heights.length > 0 ? Math.max(...heights) : 0;

      // Determine if source is purely audio
      const isAudioOnly = ['soundcloud', 'audiomack'].includes(detectPlatform(url));
      
      const hasVideo = !isAudioOnly && (
        (data.vcodec && data.vcodec !== 'none') ||
        (data.formats && data.formats.some((f: any) => f.vcodec && f.vcodec !== 'none')) ||
        true // Safe default for video platforms like Instagram, TikTok, YouTube, etc.
      );

      const formats: any[] = [];
      if (hasVideo) {
        if (maxHeight >= 1080) formats.push({ id: 'mp4-1080p', type: 'video', quality: '1080p (Full HD)', ext: 'mp4', size: 'Auto' });
        if (maxHeight >= 720) formats.push({ id: 'mp4-720p', type: 'video', quality: '720p (HD)', ext: 'mp4', size: 'Auto' });
        
        if (maxHeight > 0) {
          formats.push({ id: 'mp4-360p', type: 'video', quality: '360p (SD)', ext: 'mp4', size: 'Auto' });
        } else {
          formats.push({ id: 'best', type: 'video', quality: 'Best Quality', ext: 'mp4', size: 'Auto' });
        }
      }
      formats.push({ id: 'mp3-320k', type: 'audio', quality: '320 kbps (High)', ext: 'mp3', size: 'Auto' });
      formats.push({ id: 'mp3-192k', type: 'audio', quality: '192 kbps (Medium)', ext: 'mp3', size: 'Auto' });
      formats.push({ id: 'mp3-128k', type: 'audio', quality: '128 kbps (Standard)', ext: 'mp3', size: 'Auto' });

      console.log(`[Metadata Resolver] Success with strategy: ${strategy.label}`);
      return {
        title: data.title,
        author: data.uploader || data.channel || 'Unknown',
        duration: formatDuration(data.duration),
        thumbnail: data.thumbnail,
        platform: detectPlatform(url),
        formats: formats.length > 0
          ? formats
          : [{ id: 'best', type: 'video', quality: 'Best Available', ext: 'mp4', size: 'Auto' }],
      };
    } catch (err: any) {
      const errText = (err?.stderr || err?.message || '').toString();
      const is429 = errText.includes('HTTP Error 429') || errText.includes('Too Many Requests');
      console.warn(`[Metadata Resolver] Strategy "${strategy.label}" failed:`, errText.slice(0, 200));
      lastError = err;
      // On 429, no point trying more browsers — just bail
      if (is429) break;
      // Otherwise try next strategy
    }
  }

  // All strategies failed
  const errText = (lastError?.stderr || lastError?.message || '').toString();
  const is429 = errText.includes('HTTP Error 429') || errText.includes('Too Many Requests');

  if (is429) {
    throw new Error('YouTube is rate-limiting requests (HTTP 429). Wait a few minutes and try again.');
  }

  throw new Error(
    errText
      ? `yt-dlp failed: ${errText.slice(0, 300)}`
      : 'Failed to fetch video metadata. Make sure the URL is valid and accessible.'
  );
}

export async function downloadVideo(
  url: string,
  formatId: string,
  type: 'video' | 'audio',
  outputPath: string,
  onProgress: (pct: number) => void
): Promise<void> {
  const ytDlpPath = getYtDlpPath();
  const ffmpegPath = getFfmpegPath();
  const nodePath = process.execPath;

  // Format selection args
  const formatArgs: string[] = [];
  if (type === 'audio') {
    let quality = '192k';
    if (formatId === 'mp3-320k') quality = '320k';
    else if (formatId === 'mp3-128k') quality = '128k';
    formatArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', quality);
  } else {
    let filter = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    if (formatId === 'mp4-1080p') filter = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best';
    else if (formatId === 'mp4-720p') filter = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best';
    else if (formatId === 'mp4-360p') filter = 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best';
    formatArgs.push('-f', filter, '--merge-output-format', 'mp4');
  }

  // Determine cookie strategies
  const defaultCookiesPath = path.join(process.cwd(), 'cookies.txt');
  const cookiesFile = process.env.YTDLP_COOKIES || (fs.existsSync(defaultCookiesPath) ? defaultCookiesPath : undefined);
  // On Linux/Docker there are no browsers installed — skip browser cookie strategies.
  const cookieStrategies: string[][] = (cookiesFile && fs.existsSync(cookiesFile))
    ? [['--cookies', cookiesFile]]
    : (process.platform !== 'linux'
        ? [[], ...BROWSERS_TO_TRY.map(b => ['--cookies-from-browser', b])]
        : [[]]);

  let lastErr: any;
  for (const cookieArgs of cookieStrategies) {
    const args: string[] = [
      url,
      '--no-playlist',
      '--js-runtimes', 'deno',
      '--js-runtimes', `node:${nodePath}`,
      '--extractor-args', 'youtube:player_client=ios,web_embedded',
      '--ffmpeg-location', ffmpegPath,
      '--newline',
      '-o', outputPath,
      ...cookieArgs,
      ...formatArgs,
    ];

    try {
      await spawnDownload(ytDlpPath, args, onProgress);
      return; // success
    } catch (err: any) {
      lastErr = err;
      const errText = (err?.message || '').toString();
      const isBotCheck = errText.includes('Sign in to confirm') || errText.includes('bot');
      const is429 = errText.includes('429');
      if (!isBotCheck && !is429) throw err; // non-auth error, don't retry
      console.warn(`[Download] Cookie strategy failed, trying next...`);
      // Clean up partial file before retry
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
  }
  throw lastErr || new Error('Download failed with all cookie strategies');
}

function spawnDownload(ytDlpPath: string, args: string[], onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[Download] Running: ${ytDlpPath}`, args.slice(0, 6).join(' '), '...');
    const child = spawn(ytDlpPath, args, { windowsHide: true });
    let stderr = '';

    child.stdout.on('data', (d) => {
      const line = d.toString();
      const match = line.match(/(\d+\.?\d*)%/);
      if (match) onProgress(parseFloat(match[1]));
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
      console.error(`[Download stderr] ${d.toString().trim()}`);
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`yt-dlp exited with code ${code}`), { stderr }));
    });

    child.on('error', reject);
  });
}

/**
 * After yt-dlp finishes, find the actual file it wrote.
 * yt-dlp may add a format suffix (e.g. .f137.mp4) before merging, and in rare
 * cases the final merged name differs from what we asked for.
 * Strategy: exact match first, then newest file in the temp dir.
 */
export function findActualOutputFile(tempDir: string, expectedPath: string): string {
  // 1. Exact file exists — happy path
  if (fs.existsSync(expectedPath)) return path.basename(expectedPath);

  // 2. Scan temp dir for the most recently modified file
  try {
    const files = fs.readdirSync(tempDir);
    if (files.length === 0) return path.basename(expectedPath);

    const sorted = files
      .map(f => ({ name: f, mtime: fs.statSync(path.join(tempDir, f)).mtimeMs }))
      .filter(f => !f.name.endsWith('.part') && !f.name.endsWith('.ytdl'))
      .sort((a, b) => b.mtime - a.mtime);

    if (sorted.length > 0) {
      console.log(`[yt-dlp] Expected "${path.basename(expectedPath)}" not found; using most recent file: "${sorted[0].name}"`);
      return sorted[0].name;
    }
  } catch (e) {
    console.warn('[yt-dlp] findActualOutputFile scan failed:', e);
  }

  return path.basename(expectedPath);
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function detectPlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('facebook.com')) return 'facebook';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  return 'web';
}
