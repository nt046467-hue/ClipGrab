import { getYtDlpMetadata } from '../backend/src/yt-dlp';

async function testSelection(url: string) {
  console.log(`\n======================================================`);
  console.log(`Testing Practical Selection for: ${url}`);
  console.log(`======================================================`);

  const metadata = await getYtDlpMetadata(url);
  console.log(`Title: "${metadata.title}" | Duration: ${metadata.duration}`);
  console.log(`Resolved tiers count: ${metadata.formats.length}`);

  for (const f of metadata.formats) {
    console.log(`- Tier: ${f.quality.padEnd(24)} | ID: ${f.id.padEnd(10)} | Size: ${f.size.padEnd(14)} | Res: ${f.resolution || 'n/a'} | Codec: ${f.videoCodec || ''}/${f.audioCodec || ''}`);
  }
}

async function main() {
  // 1. "Never Gonna Give You Up" (standard music video with 4K, 1080p, 720p, 480p, 360p)
  await testSelection('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  // 2. Short video "Me at the zoo"
  await testSelection('https://www.youtube.com/watch?v=jNQXAC9IVRw');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
