import { spawn } from 'child_process';
import { getYtDlpPath } from '../backend/src/yt-dlp';

const ytDlp = getYtDlpPath();

async function testWithBrowser(b: string) {
  return new Promise<number>((resolve) => {
    const args = [
      'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      '-f', '18',
      '--cookies-from-browser', b,
      '-o', `temp/test_dl_${b}.mp4`,
      '--no-playlist',
    ];
    console.log(`\nTesting with browser cookies from: ${b}...`);
    const child = spawn(ytDlp, args);
    let out = '';
    let err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => {
      console.log(`Browser "${b}" finished with exit code: ${code}`);
      if (code !== 0) console.log('Err:', err.slice(0, 150));
      else console.log('Success! Output:', out.slice(0, 150));
      resolve(code || 0);
    });
  });
}

async function main() {
  for (const b of ['chrome', 'edge', 'firefox', 'brave', 'opera']) {
    const code = await testWithBrowser(b);
    if (code === 0) {
      console.log(`\n>>> SUCCESS WITH BROWSER: ${b} <<<`);
      break;
    }
  }
}

main();
