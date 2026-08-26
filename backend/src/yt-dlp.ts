import { exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execPromise = util.promisify(exec);

// yt-dlp binary: use local .exe on Windows, system binary on Linux/Docker
// __dirname is backend/src/, so project root is two levels up
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export function getYtDlpPath(): string {
  if (process.platform === 'win32') {
    // 1. Check project root bin/ (most common: project-root/bin/yt-dlp.exe)
    const rootBinPath = path.join(PROJECT_ROOT, 'bin', 'yt-dlp.exe');
    if (fs.existsSync(rootBinPath)) {
      return rootBinPath;
    }
    // 2. Fallback: check cwd/bin/ (in case cwd IS the project root)
    const cwdBinPath = path.join(process.cwd(), 'bin', 'yt-dlp.exe');
    if (fs.existsSync(cwdBinPath)) {
      return cwdBinPath;
    }
  }
  // On Linux/Mac (Docker/Render), use system-installed yt-dlp from Dockerfile
  return 'yt-dlp';
}

export function getFfmpegPath(): string {
  // In production / Linux Docker environment, prioritize system-installed ffmpeg
  // as ffmpeg-static binaries can crash with Segmentation Fault (SIGSEGV, code -11) on Render.
  if (process.env.NODE_ENV === 'production' || process.platform === 'linux') {
    return 'ffmpeg';
  }

  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch (e) { }
  return 'ffmpeg';
}

export function getFfprobePath(): string {
  if (process.env.NODE_ENV === 'production' || process.platform === 'linux') {
    return 'ffprobe';
  }

  try {
    const ffprobeStatic = require('ffprobe-static');
    if (ffprobeStatic && ffprobeStatic.path && fs.existsSync(ffprobeStatic.path)) {
      return ffprobeStatic.path;
    }
  } catch (e) { }
  return 'ffprobe';
}

export interface ProbeResult {
  duration?: number;
  sizeBytes?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  bitRate?: number;
  formatName?: string;
}

/**
 * Runs FFprobe to inspect and verify the container, streams, resolution, and codecs of the output file.
 */
export async function probeMediaFile(filePath: string): Promise<ProbeResult> {
  const ffprobePath = getFfprobePath();
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(ffprobePath, args, { windowsHide: true });

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code === 0 && stdout) {
        try {
          const parsed = JSON.parse(stdout);
          const format = parsed.format || {};
          const streams = parsed.streams || [];
          const videoStream = streams.find((s: any) => s.codec_type === 'video');
          const audioStream = streams.find((s: any) => s.codec_type === 'audio');

          const res: ProbeResult = {
            duration: format.duration ? parseFloat(format.duration) : undefined,
            sizeBytes: format.size ? parseInt(format.size, 10) : undefined,
            width: videoStream?.width ? parseInt(videoStream.width, 10) : undefined,
            height: videoStream?.height ? parseInt(videoStream.height, 10) : undefined,
            videoCodec: videoStream?.codec_name,
            audioCodec: audioStream?.codec_name,
            bitRate: format.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
            formatName: format.format_name,
          };
          resolve(res);
          return;
        } catch (e) {
          console.warn('[FFprobe] JSON parse warning:', e);
        }
      }
      // Fallback stats
      const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      resolve({
        sizeBytes: stats ? stats.size : undefined,
      });
    });

    child.on('error', (err) => {
      console.warn('[FFprobe] Process execution warning:', err?.message || err);
      const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      resolve({
        sizeBytes: stats ? stats.size : undefined,
      });
    });
  });
}

/**
 * Formats a byte number into a clean human-readable size string.
 * Uses ~ prefix if isApprox is true.
 */
export function formatBytes(bytes: number, isApprox = false): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return 'Size unavailable';
  const prefix = isApprox ? '~' : '';
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  const kb = 1024;

  if (bytes >= gb) {
    return `${prefix}${(bytes / gb).toFixed(2)} GB`;
  }
  if (bytes >= mb) {
    return `${prefix}${(bytes / mb).toFixed(1)} MB`;
  }
  if (bytes >= kb) {
    return `${prefix}${(bytes / kb).toFixed(1)} KB`;
  }
  return `${prefix}${bytes} B`;
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
  const isTikTok = /tiktok\.com/i.test(url);
  const args = [
    '--no-playlist',
    '--js-runtimes', 'node',
    '-j',
  ];

  if (isTikTok) {
    args.push('--extractor-args', 'tiktok:api_hostname=api22-core-c-useast1a.tiktokv.com;app_info=7355628005410784005');
  }

  args.push(url);
  return args;
}

async function tryFetchMetadata(ytDlpPath: string, url: string, extraArgs: string[]): Promise<any> {
  const args = [...extraArgs, ...buildBaseArgs(url)];
  return runYtDlpJson(ytDlpPath, args);
}

export interface ResolvedFormat {
  id: string;
  type: 'video' | 'audio';
  quality: string;
  ext: string;
  resolution?: string;
  videoFormatId?: string;
  audioFormatId?: string;
  videoSourceBytes?: number;
  audioSourceBytes?: number;
  estimatedBytes?: number;
  filesize?: number;
  filesizeApprox?: number;
  size: string; // Always includes ~ prefix for pre-download estimates
  isEstimated: boolean;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
}

export interface ResolvedMetadata {
  title: string;
  author: string;
  duration: string;
  thumbnail: string;
  platform: string;
  formats: ResolvedFormat[];
}

export async function getYtDlpMetadata(url: string): Promise<ResolvedMetadata> {
  const ytDlpPath = getYtDlpPath();
  console.log(`[Metadata Resolver] Using yt-dlp at: ${ytDlpPath}`);

  const defaultCookiesPath = path.join(process.cwd(), 'cookies.txt');
  const cookiesFile = process.env.YTDLP_COOKIES || (fs.existsSync(defaultCookiesPath) ? defaultCookiesPath : undefined);
  const cookieFileArgs = (cookiesFile && fs.existsSync(cookiesFile))
    ? ['--cookies', cookiesFile]
    : [];

  const hasCookieFile = !!(cookiesFile && fs.existsSync(cookiesFile));
  console.log(`[Metadata Resolver] Cookie file check — path: ${cookiesFile || 'none'}, exists: ${hasCookieFile}, size: ${hasCookieFile ? fs.statSync(cookiesFile!).size + ' bytes' : 'n/a'}`);

  const strategies: Array<{ label: string; extraArgs: string[] }> = [
    { label: 'default', extraArgs: cookieFileArgs },
  ];

  if (!hasCookieFile && process.platform !== 'linux') {
    BROWSERS_TO_TRY.forEach(b => {
      strategies.push({
        label: `cookies-from-browser:${b}`,
        extraArgs: ['--cookies-from-browser', b],
      });
    });
  }

  let lastError: any = null;
  let firstRealError: any = null;

  for (const strategy of strategies) {
    try {
      console.log(`[Metadata Resolver] Trying strategy: ${strategy.label}`);
      const data = await tryFetchMetadata(ytDlpPath, url, strategy.extraArgs);

      const rawFormats: any[] = (data.formats || []).filter((f: any) => {
        // Ignore storyboard / preview formats
        if (f.protocol === 'mhtml') return false;
        if (String(f.format_note || '').toLowerCase().includes('storyboard')) return false;
        if (String(f.format_id || '').toLowerCase().includes('sb')) return false;
        return true;
      });

      const dur: number = data.duration || 0;
      const platform = detectPlatform(url);

      // 1. Inspect audio streams: prefer standard stereo AAC / m4a (~128kbps - 160kbps, e.g. format 140)
      // Avoid multi-channel / 384kbps surround audio streams (e.g. format 258) and -drc suffixed audio tracks
      const audioStreams = rawFormats.filter((f: any) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none' && !String(f.format_id || '').includes('-drc'));

      const standardM4aAudio = audioStreams
        .filter((f: any) => (f.ext === 'm4a' || String(f.acodec || '').includes('mp4a')) && (f.abr || f.tbr || 128) <= 160)
        .sort((a: any, b: any) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];

      const anyM4aAudio = audioStreams
        .filter((f: any) => f.ext === 'm4a' || String(f.acodec || '').includes('mp4a'))
        .sort((a: any, b: any) => Math.abs((a.abr || a.tbr || 128) - 128) - Math.abs((b.abr || b.tbr || 128) - 128))[0];

      const bestOverallAudio = audioStreams
        .slice()
        .sort((a: any, b: any) => Math.abs((a.abr || a.tbr || 128) - 128) - Math.abs((b.abr || b.tbr || 128) - 128))[0];

      const bestAudio = standardM4aAudio || anyM4aAudio || bestOverallAudio || null;

      let audioBytes = 0;
      if (bestAudio) {
        if (bestAudio.filesize && bestAudio.filesize > 0) {
          audioBytes = bestAudio.filesize;
        } else if (bestAudio.filesize_approx && bestAudio.filesize_approx > 0) {
          audioBytes = bestAudio.filesize_approx;
        } else if ((bestAudio.abr || bestAudio.tbr) && dur > 0) {
          audioBytes = Math.round(((bestAudio.abr || bestAudio.tbr) * 1000 * dur) / 8);
        }
      }
      if (!audioBytes && dur > 0) {
        audioBytes = Math.round((128 * 1000 * dur) / 8); // fallback ~128kbps
      }

      // 2. Identify video candidates
      const isAudioOnly = ['soundcloud', 'audiomack'].includes(platform);
      const videoStreams = rawFormats.filter((f: any) => f.vcodec && f.vcodec !== 'none');
      const hasVideo = !isAudioOnly && (
        (data.vcodec && data.vcodec !== 'none') ||
        videoStreams.length > 0 ||
        true
      );

      const formats: ResolvedFormat[] = [];

      // Log all raw candidates for transparency
      console.log(`\n[Platform Format Candidates Inspection: ${platform}] (Total: ${rawFormats.length})`);
      rawFormats.forEach((c: any) => {
        const br = c.tbr || c.vbr || (c.filesize && dur > 0 ? Math.round((c.filesize * 8) / (dur * 1000)) : undefined);
        console.log(
          `  - formatId=${String(c.format_id).padEnd(12)} | ${c.width || '?'}x${c.height || '?'} @ ${c.fps || '?'}fps | vcodec=${(c.vcodec || 'none').padEnd(14)} | acodec=${(c.acodec || 'none').padEnd(14)} | bitrate=${br ? br + 'kbps' : 'n/a'} | filesize=${c.filesize || c.filesize_approx || 'n/a'} | protocol=${c.protocol || 'https'} | note=${c.format_note || ''}`
        );
      });

      if (hasVideo && videoStreams.length > 0) {
        if (platform === 'youtube') {
          // =========================================================================
          // YOUTUBE STRATEGY: Practical Bitrate Candidate Selection
          // =========================================================================
          const targetTiers = [
            { maxH: 2160, minH: 1441, label: '4K Ultra HD (2160p)', height: 2160, targetBitrate: 8500, maxReasonable: 15000, fallbackBitrate: 8500 },
            { maxH: 1440, minH: 1081, label: '2K QHD (1440p)', height: 1440, targetBitrate: 4500, maxReasonable: 8000, fallbackBitrate: 4500 },
            { maxH: 1080, minH: 721, label: '1080p Full HD', height: 1080, targetBitrate: 1800, maxReasonable: 3500, fallbackBitrate: 1800 },
            { maxH: 720, minH: 481, label: '720p HD', height: 720, targetBitrate: 500, maxReasonable: 1200, fallbackBitrate: 500 },
            { maxH: 480, minH: 361, label: '480p SD', height: 480, targetBitrate: 300, maxReasonable: 700, fallbackBitrate: 300 },
            { maxH: 360, minH: 241, label: '360p SD', height: 360, targetBitrate: 200, maxReasonable: 450, fallbackBitrate: 200 },
            { maxH: 240, minH: 144, label: '240p Mobile', height: 240, targetBitrate: 120, maxReasonable: 250, fallbackBitrate: 120 },
          ];

          for (const tier of targetTiers) {
            const candidates = videoStreams.filter((f: any) => {
              const h = f.height || 0;
              return h >= tier.minH && h <= tier.maxH;
            });

            if (candidates.length > 0) {
              const hasStandardFps = candidates.some((c: any) => !c.fps || c.fps <= 30);

              const scoredCandidates = candidates.map((c: any) => {
                let score = 0;
                // 1. Avoid premium bitrate lock
                const isPremium = String(c.format_note || '').toLowerCase().includes('premium');
                if (isPremium) score += 5000;

                // 2. Frame rate: prefer standard <=30fps rather than unnecessarily choosing 60fps
                const fps = c.fps || 30;
                if (hasStandardFps && fps > 30) {
                  score += 200;
                }

                // 3. Bitrate evaluation
                const actualFilesize = c.filesize || c.filesize_approx || 0;
                const br = c.vbr || c.tbr || (actualFilesize && dur > 0 ? (actualFilesize * 8) / (dur * 1000) : tier.targetBitrate);
                if (br > tier.maxReasonable) {
                  score += (br - tier.maxReasonable) * 0.5;
                } else {
                  score += Math.abs(br - tier.targetBitrate) * 0.1;
                }

                // 4. Codec evaluation (AV1 & VP9 preferred for smallest file size at same resolution)
                const isAv1 = String(c.vcodec || '').match(/^(av01)/i);
                const isVp9 = String(c.vcodec || '').match(/^(vp9|vp09)/i);
                const isAvc = String(c.vcodec || '').match(/^(avc1|h264)/i);
                if (isAv1) score += 0;
                else if (isVp9) score += 5;
                else if (isAvc) score += 30;
                else score += 50;

                score += (br / tier.targetBitrate) * 5;

                // 5. Height fitness within tier
                const h = c.height || tier.height;
                score += Math.abs(h - tier.height) * 2;

                return { candidate: c, score, calculatedBitrate: br };
              });

              scoredCandidates.sort((a, b) => a.score - b.score);
              const bestChoice = scoredCandidates[0];
              const match = bestChoice.candidate;
              const vId = String(match.format_id || '');
              const hasAudioTrack = match.acodec && match.acodec !== 'none';

              let chosenId = vId;
              let aId: string | undefined = undefined;
              if (!hasAudioTrack && bestAudio) {
                aId = String(bestAudio.format_id || '');
                chosenId = `${vId}+${aId}`;
              }

              let videoBytes = 0;
              if (match.filesize && match.filesize > 0) {
                videoBytes = match.filesize;
              } else if (match.filesize_approx && match.filesize_approx > 0) {
                videoBytes = match.filesize_approx;
              } else if ((match.vbr || match.tbr) && dur > 0) {
                videoBytes = Math.round(((match.vbr || match.tbr) * 1000 * dur) / 8);
              } else if (dur > 0) {
                videoBytes = Math.round((tier.fallbackBitrate * 1000 * dur) / 8);
              }

              // Sanity check: if the reported filesize implies a bitrate far above the tier's
              // maxReasonable, use the practical target bitrate for the display estimate.
              // This prevents showing e.g. ~205 MB for 720p when the practical download is ~35-45 MB.
              // The actual download will still use the correct format ID — this only affects the UI estimate.
              if (videoBytes > 0 && dur > 0) {
                const impliedBitrateKbps = (videoBytes * 8) / (dur * 1000);
                if (impliedBitrateKbps > tier.maxReasonable) {
                  console.log(`[Size Sanity] Reported filesize implies ${Math.round(impliedBitrateKbps)} kbps, exceeds maxReasonable ${tier.maxReasonable} kbps for ${tier.label}. Using target bitrate ${tier.targetBitrate} kbps for estimate.`);
                  videoBytes = Math.round((tier.targetBitrate * 1000 * dur) / 8);
                }
              }

              const videoSourceBytes = videoBytes > 0 ? videoBytes : undefined;
              const audioSourceBytes = hasAudioTrack ? 0 : (audioBytes > 0 ? audioBytes : undefined);
              const estimatedBytes = hasAudioTrack
                ? videoBytes
                : (videoBytes > 0 ? videoBytes + audioBytes : (dur > 0 ? Math.round((tier.fallbackBitrate * 1000 * dur) / 8) : 0));

              const sizeStr = estimatedBytes > 0
                ? formatBytes(estimatedBytes, true)
                : 'Size unavailable';

              const width = match.width || (match.height ? Math.round(match.height * (16 / 9)) : undefined);
              const height = match.height || tier.height;
              const resolution = width && height ? `${width}x${height}` : `${height}p`;
              const selectedReason = `YouTube practical candidate scoring (score: ${bestChoice.score.toFixed(1)}, target: ${tier.targetBitrate}kbps)`;

              console.log(`[Selected Format for ${tier.label} on ${platform}]:
  platform:        ${platform}
  formatId:        ${chosenId}
  resolution:      ${resolution}
  fps:             ${match.fps || '?'}
  vcodec:          ${match.vcodec}
  acodec:          ${hasAudioTrack ? match.acodec : (bestAudio?.acodec || 'aac')}
  bitrate:         ${Math.round(bestChoice.calculatedBitrate)} kbps
  filesize:        ${sizeStr}
  protocol:        ${match.protocol || 'https'}
  selected reason: ${selectedReason}`);

              formats.push({
                id: chosenId,
                type: 'video',
                quality: tier.label,
                ext: 'mp4',
                resolution,
                videoFormatId: vId,
                audioFormatId: aId,
                videoSourceBytes,
                audioSourceBytes,
                estimatedBytes: estimatedBytes > 0 ? estimatedBytes : undefined,
                filesize: match.filesize || undefined,
                filesizeApprox: estimatedBytes > 0 ? estimatedBytes : undefined,
                size: sizeStr,
                isEstimated: true,
                fps: match.fps,
                videoCodec: match.vcodec,
                audioCodec: hasAudioTrack ? match.acodec : (bestAudio?.acodec || 'aac'),
              });
            }
          }
        } else {
          // =========================================================================
          // NON-YOUTUBE PLATFORMS (Instagram, TikTok, Pinterest, X/Twitter, etc.):
          // Native Representation Preservation Strategy
          // =========================================================================
          
          // 1. Look for Progressive formats (single file with video + audio)
          const progressiveFormats = videoStreams.filter((f: any) => {
            const hasA = f.acodec && f.acodec !== 'none';
            return hasA || !audioStreams.length;
          });

          const candidateList = progressiveFormats.length > 0 ? progressiveFormats : videoStreams;

          // Group candidates by distinct resolution (min height or dimension)
          const resolutionGroups = new Map<string, any[]>();
          for (const cand of candidateList) {
            const h = cand.height || 0;
            const w = cand.width || 0;
            const minDim = (h > 0 && w > 0) ? Math.min(h, w) : (h || w || 720);
            
            // Normalize key into standard tiers (e.g. 1080p, 720p, 480p, 360p, or exact dimension)
            let tierKey = 'Original Quality';
            if (minDim >= 1000) tierKey = '1080p Full HD';
            else if (minDim >= 700) tierKey = '720p HD';
            else if (minDim >= 450) tierKey = '480p SD';
            else if (minDim >= 320) tierKey = '360p SD';
            else if (minDim > 0) tierKey = `${minDim}p`;

            if (!resolutionGroups.has(tierKey)) {
              resolutionGroups.set(tierKey, []);
            }
            resolutionGroups.get(tierKey)!.push(cand);
          }

          // For each native resolution group, pick the highest quality native representation
          for (const [tierLabel, groupCandidates] of resolutionGroups.entries()) {
            // Sort by: universal H.264 preference (over HEVC/bytevc1), MP4 container, highest bitrate, and largest filesize
            groupCandidates.sort((a, b) => {
              const aVcodec = String(a.vcodec || '').toLowerCase();
              const bVcodec = String(b.vcodec || '').toLowerCase();
              const aIsH264 = /^(avc1|h264)/i.test(aVcodec) ? 1 : (/^(hevc|hvc1|bytevc1)/i.test(aVcodec) ? 0 : 0.5);
              const bIsH264 = /^(avc1|h264)/i.test(bVcodec) ? 1 : (/^(hevc|hvc1|bytevc1)/i.test(bVcodec) ? 0 : 0.5);

              const aBr = a.tbr || a.vbr || 0;
              const bBr = b.tbr || b.vbr || 0;
              const aSize = a.filesize || a.filesize_approx || 0;
              const bSize = b.filesize || b.filesize_approx || 0;
              const aIsMp4 = a.ext === 'mp4' ? 1 : 0;
              const bIsMp4 = b.ext === 'mp4' ? 1 : 0;
              return (bIsH264 - aIsH264) || (bIsMp4 - aIsMp4) || (bBr - aBr) || (bSize - aSize);
            });

            const match = groupCandidates[0];
            const vId = String(match.format_id || '');
            const hasAudioTrack = match.acodec && match.acodec !== 'none';

            let chosenId = vId;
            let aId: string | undefined = undefined;
            if (!hasAudioTrack && bestAudio) {
              aId = String(bestAudio.format_id || '');
              chosenId = `${vId}+${aId}`;
            }

            let videoBytes = 0;
            if (match.filesize && match.filesize > 0) {
              videoBytes = match.filesize;
            } else if (match.filesize_approx && match.filesize_approx > 0) {
              videoBytes = match.filesize_approx;
            } else if ((match.vbr || match.tbr) && dur > 0) {
              videoBytes = Math.round(((match.vbr || match.tbr) * 1000 * dur) / 8);
            }

            const videoSourceBytes = videoBytes > 0 ? videoBytes : undefined;
            const audioSourceBytes = hasAudioTrack ? 0 : (audioBytes > 0 ? audioBytes : undefined);
            const estimatedBytes = hasAudioTrack
              ? videoBytes
              : (videoBytes > 0 ? videoBytes + audioBytes : 0);

            const sizeStr = estimatedBytes > 0
              ? formatBytes(estimatedBytes, true)
              : 'Size unavailable';

            const width = match.width;
            const height = match.height;
            const resolution = width && height ? `${width}x${height}` : (height ? `${height}p` : tierLabel);
            const calculatedBr = match.tbr || match.vbr || (videoBytes > 0 && dur > 0 ? Math.round((videoBytes * 8) / (dur * 1000)) : undefined);
            const selectedReason = hasAudioTrack
              ? `Native progressive media representation (${match.width || '?'}x${match.height || '?'}) on ${platform}`
              : `Highest quality native stream on ${platform}`;

            console.log(`[Selected Format for ${tierLabel} on ${platform}]:
  platform:        ${platform}
  formatId:        ${chosenId}
  resolution:      ${resolution}
  fps:             ${match.fps || '?'}
  vcodec:          ${match.vcodec || 'none'}
  acodec:          ${hasAudioTrack ? match.acodec : (bestAudio?.acodec || 'none')}
  bitrate:         ${calculatedBr ? calculatedBr + ' kbps' : 'n/a'}
  filesize:        ${sizeStr}
  protocol:        ${match.protocol || 'https'}
  selected reason: ${selectedReason}`);

            formats.push({
              id: chosenId,
              type: 'video',
              quality: tierLabel,
              ext: match.ext === 'webm' ? 'webm' : 'mp4',
              resolution,
              videoFormatId: vId,
              audioFormatId: aId,
              videoSourceBytes,
              audioSourceBytes,
              estimatedBytes: estimatedBytes > 0 ? estimatedBytes : undefined,
              filesize: match.filesize || undefined,
              filesizeApprox: estimatedBytes > 0 ? estimatedBytes : undefined,
              size: sizeStr,
              isEstimated: true,
              fps: match.fps,
              videoCodec: match.vcodec,
              audioCodec: hasAudioTrack ? match.acodec : (bestAudio?.acodec || 'aac'),
            });
          }
        }

      }

      if (hasVideo && formats.length === 0) {
        const directSize = data.filesize || data.filesize_approx;
        formats.push({
          id: 'best',
          type: 'video',
          quality: 'Original Quality',
          ext: 'mp4',
          size: directSize ? formatBytes(directSize, true) : 'Size unavailable',
          isEstimated: true,
          videoCodec: data.vcodec || undefined,
          audioCodec: data.acodec || undefined,
          fps: data.fps || undefined,
        });
      }

      // 3. Add audio options with exact byte calculations
      const mp3Tiers = [
        { id: 'mp3-320k', quality: '320 kbps (High)', kbps: 320 },
        { id: 'mp3-192k', quality: '192 kbps (Medium)', kbps: 192 },
        { id: 'mp3-128k', quality: '128 kbps (Standard)', kbps: 128 },
      ];

      for (const audioTier of mp3Tiers) {
        const audioEstBytes = dur > 0 ? Math.round((audioTier.kbps * 1000 * dur) / 8) : 0;
        formats.push({
          id: audioTier.id,
          type: 'audio',
          quality: audioTier.quality,
          ext: 'mp3',
          audioSourceBytes: audioEstBytes > 0 ? audioEstBytes : undefined,
          estimatedBytes: audioEstBytes > 0 ? audioEstBytes : undefined,
          filesizeApprox: audioEstBytes > 0 ? audioEstBytes : undefined,
          size: audioEstBytes > 0 ? formatBytes(audioEstBytes, true) : 'Size unavailable',
          isEstimated: true,
          audioFormatId: bestAudio ? String(bestAudio.format_id) : undefined,
          audioCodec: 'mp3',
        });
      }

      console.log(`[Format Resolve]
  URL: ${url}
  Title: "${data.title}"
  Duration: ${dur}s
  Platform: ${platform}
  Available tiers: ${formats.map(f => `${f.quality} [${f.id}] (${f.size})`).join(', ')}
`);

      return {
        title: data.title || 'Untitled Media',
        author: data.uploader || data.channel || data.artist || 'Unknown Creator',
        duration: formatDuration(data.duration),
        thumbnail: data.thumbnail || '',
        platform,
        formats,
      };
    } catch (err: any) {
      const errText = (err?.stderr || err?.message || '').toString();
      const lowerErrText = errText.toLowerCase();
      const is429 = lowerErrText.includes('http error 429') || lowerErrText.includes('too many requests');
      const isUnsupported = lowerErrText.includes('unsupported url') || lowerErrText.includes('not a valid url') || lowerErrText.includes('is not a valid url');
      const isBlocked = lowerErrText.includes('blocked') || lowerErrText.includes('forbidden') || lowerErrText.includes('403') || lowerErrText.includes('ip address');
      console.warn(`[Metadata Resolver] Strategy "${strategy.label}" failed:`, errText.slice(0, 200));

      const isMissingBrowser = errText.includes('could not find') && errText.includes('cookies database');
      if (!isMissingBrowser && !firstRealError) {
        firstRealError = err;
      }

      lastError = err;
      if (is429 || isUnsupported || isBlocked) break;
    }
  }

  const finalError = firstRealError || lastError;
  const errText = (finalError?.stderr || finalError?.message || '').toString();
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
  onProgress: (pct: number, stage?: string) => void
): Promise<void> {
  const ytDlpPath = getYtDlpPath();
  const ffmpegPath = getFfmpegPath();

  console.log(`[Download] Starting download:
    URL: ${url}
    Format ID: ${formatId} (${type})
    yt-dlp path: ${ytDlpPath}
    ffmpeg path: ${ffmpegPath}
    Output: ${outputPath}`);

  // Format selection args:
  // Strictly pass the exact resolved format selector (e.g. -f "137+140" or specific audio extraction)
  // NEVER use --format-sort with size/br which causes yt-dlp to silently pick lower quality streams.
  const formatArgs: string[] = [];
  if (type === 'audio') {
    let quality = '192k';
    if (formatId === 'mp3-320k') quality = '320k';
    else if (formatId === 'mp3-128k') quality = '128k';
    formatArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', quality);
  } else {
    // Pass strictly the exact deterministic formatId without broad fallbacks
    const selector = (formatId && formatId !== 'best') ? formatId : 'bestvideo+bestaudio/best';
    formatArgs.push('-f', selector, '--merge-output-format', 'mp4');
  }

  const defaultCookiesPath = path.join(process.cwd(), 'cookies.txt');
  const cookiesFile = process.env.YTDLP_COOKIES || (fs.existsSync(defaultCookiesPath) ? defaultCookiesPath : undefined);
  const cookieStrategies: string[][] = (cookiesFile && fs.existsSync(cookiesFile))
    ? [['--cookies', cookiesFile]]
    : (process.platform !== 'linux'
        ? [[], ...BROWSERS_TO_TRY.map(b => ['--cookies-from-browser', b])]
        : [[]]);

  let lastErr: any;
  let firstRealError: any = null;
  for (const cookieArgs of cookieStrategies) {
    const isTikTok = /tiktok\.com/i.test(url);
    const args: string[] = [
      url,
      '--no-playlist',
      '-N', '4',
      '--buffer-size', '64k',
      '--js-runtimes', 'node',
      ...(ffmpegPath !== 'ffmpeg' ? ['--ffmpeg-location', ffmpegPath] : []),
      '--postprocessor-args', 'ffmpeg:-c:v libx264 -c:a aac -pix_fmt yuv420p -movflags +faststart',
      '--newline',
      '--retries', '10',
      '--fragment-retries', '10',
      '-o', outputPath,
      ...(isTikTok ? ['--extractor-args', 'tiktok:api_hostname=api22-core-c-useast1a.tiktokv.com;app_info=7355628005410784005'] : []),
      ...cookieArgs,
      ...formatArgs,
    ];

    try {
      console.log(`[Download] Running download with exact format: ${formatId}`);
      await spawnDownload(ytDlpPath, args, onProgress);
      console.log(`[Download] Download process exited with code 0`);
      return;
    } catch (err: any) {
      const errText = (err?.message || err?.stderr || '').toString();
      const isBotCheck = errText.includes('Sign in to confirm') || errText.includes('bot');
      const is429 = errText.includes('429');

      const isMissingBrowser = errText.includes('could not find') && errText.includes('cookies database');
      if (!isMissingBrowser && !firstRealError) {
        firstRealError = err;
      }

      lastErr = err;
      if (!isBotCheck && !is429) {
        throw (firstRealError || err);
      }
      console.warn(`[Download] Strategy failed, cleaning temp file and trying next...`);
      if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch {}
      }
    }
  }
  throw (firstRealError || lastErr || new Error('Download failed with all available cookie strategies'));
}

function spawnDownload(ytDlpPath: string, args: string[], onProgress: (pct: number, stage?: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[Download] Running: ${ytDlpPath}`, args.slice(0, 6).join(' '), '...');
    const child = spawn(ytDlpPath, args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });
    let stderr = '';

    const parseProgress = (chunk: string) => {
      const text = chunk.toString();

      if (text.includes('[Merger]') || text.includes('[ffmpeg] Merging') || text.includes('Merging formats into')) {
        console.log('[Download] Stage: Merging streams');
        onProgress(94, 'merging');
        return;
      }

      if (text.includes('[ExtractAudio]') || (text.includes('Destination:') && text.includes('.mp3'))) {
        console.log('[Download] Stage: Extracting / Converting Audio');
        onProgress(95, 'processing');
        return;
      }

      const matches = [...text.matchAll(/\[download\]\s+(\d+\.?\d*)%/g)];
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const pct = parseFloat(lastMatch[1]);
        const scaledPct = Math.min(90, Math.max(1, pct * 0.9));
        onProgress(scaledPct, 'downloading');
      }
    };

    child.stdout.on('data', (d) => {
      parseProgress(d.toString());
    });

    child.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      parseProgress(chunk);
      const lines = chunk.trim().split('\n');
      if (lines[0]) {
        console.log(`[Download stderr] ${lines[0]}`);
      }
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`yt-dlp exited with code ${code}`), { stderr }));
    });

    child.on('error', reject);
  });
}

export interface ValidatedOutput {
  filePath: string;
  filename: string;
  finalSizeBytes: number;
  finalSize: string; // Exact size formatted without ~ prefix
  sizeBytes: number;
  size: string;
  mimeType: string;
  width?: number;
  height?: number;
  duration?: number;
  videoCodec?: string;
  audioCodec?: string;
}

/**
 * Validates the final output file after yt-dlp execution and establishes the Final Artifact model.
 * 1. Isolates the final file into `temp/<jobId>/final/<filename>`.
 * 2. Runs filesystem validation and FFprobe stream verification.
 * 3. Enforces that Content-Length and byte counts refer to this exact final artifact.
 */
export async function validateAndGetFinalArtifact(
  jobDir: string,
  intermediatePath: string,
  type: 'video' | 'audio',
  requestedQuality?: string,
  requestedFormatId?: string
): Promise<ValidatedOutput> {
  if (!fs.existsSync(jobDir)) {
    throw new Error('Job directory does not exist on disk.');
  }

  // 1. Locate completed output file
  let targetPath = intermediatePath;
  if (!fs.existsSync(targetPath)) {
    const resolvedName = findActualOutputFile(jobDir, intermediatePath);
    targetPath = path.join(jobDir, resolvedName);
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error('Download completed but the output file was not found on disk.');
  }

  // Guard against path traversal
  const normalizedJobDir = path.resolve(jobDir);
  const normalizedTargetPath = path.resolve(targetPath);
  if (!normalizedTargetPath.startsWith(normalizedJobDir)) {
    throw new Error('Security check failed: Output file path is outside job directory.');
  }

  const rawStats = fs.statSync(targetPath);
  if (!rawStats.isFile()) {
    throw new Error('Output path is not a valid regular file.');
  }

  const minBytes = type === 'audio' ? 20 * 1024 : 50 * 1024;
  if (rawStats.size < minBytes) {
    try { fs.unlinkSync(targetPath); } catch {}
    throw new Error(
      `Downloaded file failed validation: size is only ${(rawStats.size / 1024).toFixed(1)} KB (minimum expected is ${minBytes / 1024} KB). File rejected.`
    );
  }

  // 2. Establish isolated final directory: `temp/<jobId>/final/`
  const finalDir = path.join(jobDir, 'final');
  if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

  const rawFilename = path.basename(targetPath);
  const finalFilePath = path.join(finalDir, rawFilename);

  if (targetPath !== finalFilePath) {
    fs.copyFileSync(targetPath, finalFilePath);
    try { fs.unlinkSync(targetPath); } catch {}
  }

  // Clean up any remaining non-final intermediate artifacts (.part, .ytdl, etc.)
  try {
    const rootFiles = fs.readdirSync(jobDir);
    for (const f of rootFiles) {
      if (f !== 'final') {
        const itemP = path.join(jobDir, f);
        try {
          if (fs.statSync(itemP).isDirectory()) {
            fs.rmSync(itemP, { recursive: true, force: true });
          } else {
            fs.unlinkSync(itemP);
          }
        } catch {}
      }
    }
  } catch {}

  // 3. Authoritative filesystem size
  const finalStats = fs.statSync(finalFilePath);
  const actualBytes = finalStats.size;

  // 4. Run FFprobe verification
  const probe = await probeMediaFile(finalFilePath);
  const exactSizeStr = formatBytes(actualBytes, false); // EXACT string without ~ prefix

  console.log(`[Validation & FFprobe]
  Final artifact: ${finalFilePath}
  Final size: ${exactSizeStr} (${actualBytes} bytes)
  Probe duration: ${probe.duration || 'n/a'}s
  Probe resolution: ${probe.width ? `${probe.width}x${probe.height}` : 'n/a'}
  Probe codecs: video=${probe.videoCodec || 'none'}, audio=${probe.audioCodec || 'none'}`);

  const isMp3 = rawFilename.toLowerCase().endsWith('.mp3');
  const mimeType = isMp3 ? 'audio/mpeg' : 'video/mp4';

  return {
    filePath: finalFilePath,
    filename: rawFilename,
    finalSizeBytes: actualBytes,
    finalSize: exactSizeStr,
    sizeBytes: actualBytes,
    size: exactSizeStr,
    mimeType,
    width: probe.width,
    height: probe.height,
    duration: probe.duration,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
  };
}

/**
 * Legacy compatibility alias
 */
export async function validateAndGetOutputFile(jobDir: string, expectedPath: string, type: 'video' | 'audio'): Promise<ValidatedOutput> {
  return validateAndGetFinalArtifact(jobDir, expectedPath, type);
}

export function validateDownloadedFile(filePath: string, type: 'video' | 'audio'): void {
  if (!fs.existsSync(filePath)) {
    throw new Error('Download completed but the output file was not found on disk.');
  }
  const stats = fs.statSync(filePath);
  const minBytes = type === 'audio' ? 20 * 1024 : 50 * 1024;
  if (stats.size < minBytes) {
    try { fs.unlinkSync(filePath); } catch {}
    throw new Error(
      `Downloaded file failed validation: size is only ${(stats.size / 1024).toFixed(1)} KB (minimum expected is ${minBytes / 1024} KB).`
    );
  }
}

export function findActualOutputFile(jobDir: string, expectedPath: string): string {
  if (fs.existsSync(expectedPath)) return path.basename(expectedPath);

  try {
    if (!fs.existsSync(jobDir)) return path.basename(expectedPath);

    const files = fs.readdirSync(jobDir);
    if (files.length === 0) return path.basename(expectedPath);

    const validFiles = files
      .filter(f => f !== 'final' && !f.endsWith('.part') && !f.endsWith('.ytdl') && !f.endsWith('.temp'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(jobDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (validFiles.length > 0) {
      console.log(`[yt-dlp] Using validated output file in job folder: "${validFiles[0].name}"`);
      return validFiles[0].name;
    }
  } catch (e) {
    console.warn('[yt-dlp] findActualOutputFile scan failed:', e);
  }

  return path.basename(expectedPath);
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function detectPlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('facebook.com') || u.includes('fb.watch') || u.includes('fb.com')) return 'facebook';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('pinterest.com') || u.includes('pin.it')) return 'pinterest';
  if (u.includes('reddit.com') || u.includes('redd.it')) return 'reddit';
  if (u.includes('vimeo.com')) return 'vimeo';
  if (u.includes('soundcloud.com')) return 'soundcloud';
  if (u.includes('audiomack.com')) return 'audiomack';
  return 'web';
}
