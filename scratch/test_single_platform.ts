import { getYtDlpPath } from '../backend/src/yt-dlp';
import { spawn } from 'child_process';

const ytDlp = getYtDlpPath();

async function inspect(url: string) {
  console.log(`Inspecting: ${url}`);
  const args = ['--no-playlist', '--js-runtimes', 'node', '-j', url];
  let stdout = '';
  let stderr = '';
  const child = spawn(ytDlp, args);
  child.stdout.on('data', d => stdout += d.toString());
  child.stderr.on('data', d => stderr += d.toString());
  child.on('close', code => {
    if (code === 0) {
      const data = JSON.parse(stdout);
      console.log(`Success! Title: "${data.title}" | Duration: ${data.duration} | Extractor: ${data.extractor_key}`);
      const formats = data.formats || [];
      console.log(`Formats (${formats.length}):`);
      formats.forEach((f: any) => {
        console.log(`  - ID: ${String(f.format_id).padEnd(16)} | Res: ${f.width || '?'}x${f.height || '?'} | FPS: ${f.fps || '?'} | VCodec: ${(f.vcodec || 'none').padEnd(12)} | ACodec: ${(f.acodec || 'none').padEnd(12)} | Protocol: ${f.protocol} | Filesize: ${f.filesize || f.filesize_approx || 'n/a'} | Bitrate: ${f.tbr || f.vbr || 'n/a'}kbps`);
      });
    } else {
      console.error(`Exit ${code}:`, stderr.slice(0, 300));
    }
  });
}

const target = process.argv[2] || 'https://twitter.com/SpaceX/status/1780447087094628795';
inspect(target);
