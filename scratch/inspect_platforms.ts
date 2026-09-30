import { getYtDlpPath } from '../backend/src/yt-dlp';
import { spawn } from 'child_process';

const ytDlp = getYtDlpPath();

function getMetadataJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const args = ['--no-playlist', '--js-runtimes', 'node', '-j', url];
    let stdout = '';
    let stderr = '';
    const child = spawn(ytDlp, args);
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', code => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`yt-dlp code ${code}: ${stderr.slice(0, 300)}`));
      }
    });
  });
}

async function inspect(url: string, platformLabel: string) {
  console.log(`\n========================================================================`);
  console.log(`[INSPECTING PLATFORM]: ${platformLabel} | URL: ${url}`);
  console.log(`========================================================================`);
  try {
    const data = await getMetadataJson(url);
    console.log(`Title: "${data.title}" | Duration: ${data.duration}s | Extractor: ${data.extractor_key || data.extractor}`);
    const formats = data.formats || [];
    console.log(`Raw Formats count: ${formats.length}`);
    formats.forEach((f: any) => {
      console.log(`  - ID: ${f.format_id.padEnd(16)} | Res: ${f.width || '?'}x${f.height || '?'} | FPS: ${f.fps || '?'} | VCodec: ${(f.vcodec || 'none').padEnd(16)} | ACodec: ${(f.acodec || 'none').padEnd(16)} | Protocol: ${f.protocol || '?'} | Filesize: ${f.filesize || f.filesize_approx || 'n/a'} | Bitrate: ${f.tbr || f.vbr || 'n/a'}kbps | Note: ${f.format_note || ''}`);
    });
  } catch (err: any) {
    console.error(`Failed to inspect ${platformLabel}:`, err?.message || err);
  }
}

async function main() {
  const testUrls = [
    { label: 'YouTube', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
    { label: 'X / Twitter', url: 'https://x.com/X/status/1815858602693890333' },
    { label: 'TikTok', url: 'https://www.tiktok.com/@tiktok/video/7106594312292453678' },
    { label: 'Pinterest', url: 'https://www.pinterest.com/pin/1118863720025704153/' },
    { label: 'Instagram', url: 'https://www.instagram.com/reel/C8r8eH4oG_7/' },
  ];

  for (const item of testUrls) {
    await inspect(item.url, item.label);
  }
}

main();
