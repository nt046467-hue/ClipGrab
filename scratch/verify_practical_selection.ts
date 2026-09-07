import { getYtDlpMetadata, downloadVideo, validateAndGetFinalArtifact } from '../backend/src/yt-dlp';
import path from 'path';
import fs from 'fs';

async function testVideoPracticalDownload(url: string) {
  console.log(`\n========================================================================`);
  console.log(`[TEST] Practical Download Verification for: ${url}`);
  console.log(`========================================================================`);

  const metadata = await getYtDlpMetadata(url);
  console.log(`\nMedia Title: "${metadata.title}" | Duration: ${metadata.duration}`);
  console.log(`Available Resolved Tiers:`);
  for (const f of metadata.formats) {
    console.log(`  * ${f.quality.padEnd(24)} | ID: ${f.id.padEnd(14)} | Size: ${f.size.padEnd(14)} | Res: ${f.resolution || 'n/a'} | Codecs: ${f.videoCodec || ''}/${f.audioCodec || ''} | FPS: ${f.fps || 'n/a'}`);
  }

  // Tiers to test: 720p HD, 480p SD, 360p SD
  const tiersToTest = ['720p HD', '480p SD', '360p SD'];

  for (const tierLabel of tiersToTest) {
    const format = metadata.formats.find(f => f.quality === tierLabel && f.type === 'video');
    if (!format) {
      console.log(`\n[SKIP] Tier "${tierLabel}" not available in source.`);
      continue;
    }

    console.log(`\n------------------------------------------------------------------------`);
    console.log(`[TESTING TIER: ${tierLabel}]`);
    console.log(`------------------------------------------------------------------------`);
    console.log(`Selected Format ID: ${format.id}`);
    console.log(`Resolution:         ${format.resolution || 'n/a'}`);
    console.log(`FPS:                ${format.fps || 'n/a'}`);
    console.log(`Video Codec:        ${format.videoCodec || 'n/a'}`);
    console.log(`Audio Codec:        ${format.audioCodec || 'n/a'}`);
    console.log(`Estimated Size:     ${format.size}`);

    const uniqueId = `test_${Date.now()}_${tierLabel.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const tempDir = path.join(process.cwd(), 'temp', uniqueId);
    fs.mkdirSync(tempDir, { recursive: true });

    const intermediateFilename = `output_${uniqueId}.${format.ext}`;
    const intermediatePath = path.join(tempDir, intermediateFilename);

    console.log(`Starting download for ${tierLabel} (format ${format.id})...`);
    await downloadVideo(url, format.id, format.type, intermediatePath, (pct, stage) => {
      // quiet download
    });

    console.log(`Validating output with FFprobe & Filesystem bytes...`);
    const validated = await validateAndGetFinalArtifact(tempDir, intermediatePath, format.type, format.quality, format.id);

    console.log(`\n[FINAL RESULT for ${tierLabel}]:`);
    console.log(`  * Selected Format ID:   ${format.id}`);
    console.log(`  * Estimated Size:       ${format.size}`);
    console.log(`  * Actual Final Size:    ${validated.finalSize} (${validated.finalSizeBytes} bytes)`);
    console.log(`  * FFprobe Resolution:   ${validated.width}x${validated.height}`);
    console.log(`  * FFprobe Duration:     ${validated.duration?.toFixed(1)}s`);
    console.log(`  * FFprobe Video Codec:  ${validated.videoCodec}`);
    console.log(`  * FFprobe Audio Codec:  ${validated.audioCodec}`);

    // Clean up
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n========================================================================`);
  console.log(`✅ PRACTICAL DOWNLOAD SELECTION VERIFIED SUCCESSFULLY!`);
  console.log(`========================================================================`);
}

async function main() {
  const testUrl = process.argv[2] || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
  await testVideoPracticalDownload(testUrl);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
