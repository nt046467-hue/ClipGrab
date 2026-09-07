import { getYtDlpPath } from '../backend/src/yt-dlp';
import { spawn } from 'child_process';

function inspectUrl(url: string) {
  const ytDlp = getYtDlpPath();
  const child = spawn(ytDlp, ['-j', '--no-playlist', url]);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => stdout += d.toString());
  child.stderr.on('data', d => stderr += d.toString());
  child.on('close', code => {
    if (code !== 0) {
      console.error('yt-dlp error:', stderr);
      return;
    }
    const info = JSON.parse(stdout);
    console.log(`\n========================================`);
    console.log(`Video: "${info.title}" | Duration: ${info.duration}s (${Math.floor(info.duration/60)}:${info.duration%60})`);
    console.log(`========================================`);

    const formats = info.formats || [];
    console.log(`Total formats: ${formats.length}\n`);

    const videoFormats = formats.filter((f: any) => f.vcodec && f.vcodec !== 'none');
    console.log(`Video formats (${videoFormats.length}):`);
    for (const f of videoFormats) {
      console.log(`ID: ${f.format_id.padEnd(6)} | ${f.width}x${f.height} @ ${f.fps || '?'}fps | vcodec: ${(f.vcodec || '').slice(0, 15).padEnd(15)} | acodec: ${(f.acodec || 'none').slice(0, 10).padEnd(10)} | tbr: ${String(f.tbr || '?').padStart(6)} | vbr: ${String(f.vbr || '?').padStart(6)} | size: ${f.filesize ? (f.filesize/1024/1024).toFixed(1)+'MB' : (f.filesize_approx ? '~'+(f.filesize_approx/1024/1024).toFixed(1)+'MB' : 'n/a')} | note: ${f.format_note || ''}`);
    }

    const audioFormats = formats.filter((f: any) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none');
    console.log(`\nAudio formats (${audioFormats.length}):`);
    for (const f of audioFormats) {
      console.log(`ID: ${f.format_id.padEnd(6)} | ext: ${f.ext} | acodec: ${(f.acodec || '').padEnd(15)} | abr: ${String(f.abr || f.tbr || '?').padStart(6)} | size: ${f.filesize ? (f.filesize/1024/1024).toFixed(1)+'MB' : (f.filesize_approx ? '~'+(f.filesize_approx/1024/1024).toFixed(1)+'MB' : 'n/a')}`);
    }
  });
}

// Test with YouTube videos
const testUrl = process.argv[2] || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; // ~4 min video
inspectUrl(testUrl);
