import { getYtDlpMetadata, downloadVideo, validateAndGetFinalArtifact, probeMediaFile } from '../backend/src/yt-dlp';
import path from 'path';
import fs from 'fs';

async function runTest() {
  console.log('=== Step 1: Testing Metadata Resolution & Estimation Separation ===');
  const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo"
  console.log(`Resolving metadata for ${testUrl}...`);
  const metadata = await getYtDlpMetadata(testUrl);

  console.log('Resolved Title:', metadata.title);
  console.log('Resolved Platform:', metadata.platform);
  console.log('Resolved Duration:', metadata.duration);
  console.log('Resolved Formats count:', metadata.formats.length);

  for (const f of metadata.formats) {
    console.log(`- Format [${f.id}] (${f.type}): ${f.quality} | Ext: ${f.ext} | Size: ${f.size} (estimated: ${f.isEstimated}) | Res: ${f.resolution || 'n/a'} | Codec: ${f.videoCodec || ''}/${f.audioCodec || ''}`);
    
    // Assert invariant: Pre-download size must have ~ prefix if estimated and never be 'Auto'
    if (f.size === 'Auto') {
      throw new Error(`Format ${f.id} has size 'Auto' instead of calculated size!`);
    }
    if (f.size !== 'Size unavailable' && !f.size.startsWith('~')) {
      throw new Error(`Format ${f.id} estimate does NOT have mandatory ~ prefix: ${f.size}`);
    }
  }

  console.log('\n=== Step 2: Testing Deterministic Download & Final Artifact Model ===');
  const tempDir = path.join(process.cwd(), 'temp', 'test-integrity-job');
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const chosenFormat = metadata.formats.find(f => f.type === 'video') || metadata.formats[0];
  console.log(`Selected format for download: ID=${chosenFormat.id} (${chosenFormat.quality})`);
  console.log(`Pre-download estimated size: ${chosenFormat.size}`);

  const intermediateFilename = `test_video.${chosenFormat.ext}`;
  const intermediatePath = path.join(tempDir, intermediateFilename);

  let lastProgress = 0;
  await downloadVideo(testUrl, chosenFormat.id, chosenFormat.type, intermediatePath, (pct, stage) => {
    if (pct - lastProgress >= 20 || pct >= 90) {
      console.log(`Progress: ${pct.toFixed(1)}% (Stage: ${stage || 'active'})`);
      lastProgress = pct;
    }
  });

  console.log('\n=== Step 3: Validating Final Artifact & FFprobe Inspection ===');
  const validated = await validateAndGetFinalArtifact(tempDir, intermediatePath, chosenFormat.type, chosenFormat.quality, chosenFormat.id);
  console.log('Validation & FFprobe Result:', JSON.stringify(validated, null, 2));

  // Assertions:
  // 1. File exists in final/ subfolder
  const expectedFinalPath = path.join(tempDir, 'final', validated.filename);
  if (!fs.existsSync(expectedFinalPath)) {
    throw new Error(`Final artifact missing at: ${expectedFinalPath}`);
  }

  // 2. Authoritative filesystem size
  const actualStat = fs.statSync(expectedFinalPath);
  if (actualStat.size !== validated.finalSizeBytes) {
    throw new Error(`Size mismatch: real filesystem ${actualStat.size} vs validated ${validated.finalSizeBytes}`);
  }

  // 3. Exact size string must NOT have ~ prefix
  if (validated.finalSize.startsWith('~')) {
    throw new Error(`Final exact size string has illegal ~ prefix: ${validated.finalSize}`);
  }

  // 4. FFprobe validation
  const probe = await probeMediaFile(expectedFinalPath);
  console.log('\nDirect FFprobe Verification:', probe);
  if (!probe.duration || probe.duration <= 0) {
    throw new Error('FFprobe failed to read stream duration!');
  }
  if (!probe.videoCodec && !probe.audioCodec) {
    throw new Error('FFprobe failed to identify video/audio stream codecs!');
  }

  console.log('Cleaning up test directory...');
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log('\n✅ ALL DOWNLOAD INTEGRITY & FINAL ARTIFACT TESTS PASSED!');
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
