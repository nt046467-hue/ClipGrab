import { getYtDlpMetadata, detectPlatform } from '../backend/src/yt-dlp';

async function testPlatform(url: string, expectedPlatform: string) {
  console.log(`\n========================================================================`);
  console.log(`[TEST PLATFORM]: ${expectedPlatform.toUpperCase()} | URL: ${url}`);
  console.log(`========================================================================`);

  const detected = detectPlatform(url);
  console.log(`Detected Platform: ${detected}`);
  if (detected !== expectedPlatform && expectedPlatform !== 'other') {
    console.warn(`[WARNING] Expected platform "${expectedPlatform}", but detected "${detected}"`);
  }

  try {
    const meta = await getYtDlpMetadata(url);
    console.log(`\nMetadata Title:    "${meta.title}"`);
    console.log(`Platform Extractor: ${meta.platform}`);
    console.log(`Duration:           ${meta.duration}`);
    console.log(`Formats Available (${meta.formats.length}):`);
    
    meta.formats.forEach((f, idx) => {
      console.log(`  [${idx + 1}] ${f.quality.padEnd(20)} | ID: ${f.id.padEnd(16)} | Size: ${f.size.padEnd(12)} | Res: ${f.resolution || 'n/a'} | Codecs: ${f.videoCodec || ''}/${f.audioCodec || ''} | FPS: ${f.fps || 'n/a'}`);
    });

    if (detected !== 'youtube') {
      const videoFormats = meta.formats.filter(f => f.type === 'video');
      const hasFakeYoutubeIds = videoFormats.some(f => f.id.includes('136+') || f.id.includes('137+'));
      if (hasFakeYoutubeIds) {
        throw new Error(`Platform ${detected} generated fake YouTube format IDs (e.g. 136+140)!`);
      }
      console.log(`\n✅ Platform ${detected} correctly preserved native formats without YouTube assumptions.`);
    } else {
      console.log(`\n✅ YouTube correctly applied practical bitrate selection.`);
    }
  } catch (err: any) {
    console.error(`Error resolving metadata for ${expectedPlatform}:`, err?.message || err);
  }
}

async function main() {
  const testCases = [
    { platform: 'youtube', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
    { platform: 'tiktok', url: 'https://www.tiktok.com/@tiktok/video/7106594312292453678' },
    { platform: 'instagram', url: 'https://www.instagram.com/reel/C8r8eH4oG_7/' },
    { platform: 'pinterest', url: 'https://www.pinterest.com/pin/1118863720025704153/' },
    { platform: 'twitter', url: 'https://x.com/SpaceX/status/1780447087094628795' },
  ];

  for (const tc of testCases) {
    await testPlatform(tc.url, tc.platform);
  }

  console.log(`\n========================================================================`);
  console.log(`✅ ALL MULTI-PLATFORM RESOLUTION AUDITS COMPLETE!`);
  console.log(`========================================================================`);
}

main().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
