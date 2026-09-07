import express from 'express';
import path from 'path';
import fs from 'fs';

async function testHttpRange() {
  console.log('=== Testing HTTP Range & Content-Length Invariants with Final Artifact Model ===');
  const app = express();
  app.use(express.json());

  const TEMP_DIR = path.join(process.cwd(), 'temp');
  const jobId = 'test-final-range-job';
  const jobDir = path.join(TEMP_DIR, jobId);
  const finalDir = path.join(jobDir, 'final');
  if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true });
  fs.mkdirSync(finalDir, { recursive: true });

  const dummyContent = Buffer.alloc(204800, 'X'); // 200 KB exact
  const filename = 'MAYA-LE.mp4';
  const filePath = path.join(finalDir, filename);
  fs.writeFileSync(filePath, dummyContent);

  // Exact file route logic as in backend/src/index.ts
  app.get('/api/files/:jobId/:filename', (req, res) => {
    try {
      const { jobId: jId, filename: fName } = req.params;
      const jDir = path.join(TEMP_DIR, jId);
      let target = path.join(jDir, 'final', fName);
      if (!fs.existsSync(target)) target = path.join(jDir, fName);

      if (!target.startsWith(jDir) || !fs.existsSync(target)) {
        return res.status(404).send('File not found');
      }

      const stats = fs.statSync(target);
      const totalSize = stats.size;
      const isMp3 = fName.toLowerCase().endsWith('.mp3');
      const contentType = isMp3 ? 'audio/mpeg' : 'video/mp4';
      const disposition = `attachment; filename="${fName}"`;

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

        if (isNaN(start) || start >= totalSize || end >= totalSize || start > end) {
          return res.status(416).set('Content-Range', `bytes */${totalSize}`).send('Requested Range Not Satisfiable');
        }

        const chunkSize = (end - start) + 1;
        res.status(206);
        res.set({
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': contentType,
          'Content-Disposition': disposition,
        });
        fs.createReadStream(target, { start, end }).pipe(res);
      } else {
        res.status(200);
        res.set({
          'Content-Length': totalSize.toString(),
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType,
          'Content-Disposition': disposition,
        });
        fs.createReadStream(target).pipe(res);
      }
    } catch (e: any) {
      console.error('Server route error:', e);
      res.status(500).send(e.message);
    }
  });

  const server = app.listen(9001, '127.0.0.1');

  try {
    // 1. Standard GET
    console.log('Testing full file GET (200 OK)...');
    const res200 = await fetch('http://127.0.0.1:9001/api/files/test-final-range-job/MAYA-LE.mp4');
    if (res200.status !== 200) throw new Error(`Expected status 200, got ${res200.status}`);
    const cl = res200.headers.get('content-length');
    if (cl !== '204800') throw new Error(`Content-Length mismatch: expected 204800, got ${cl}`);
    const buf200 = await res200.arrayBuffer();
    if (buf200.byteLength !== 204800) throw new Error(`Downloaded buffer size mismatch: ${buf200.byteLength} vs 204800`);
    console.log('✓ 200 OK passed: Content-Length equals actual filesystem bytes exactly (204800 bytes)');

    // 2. Range GET (bytes=0-1023)
    console.log('\nTesting HTTP Range GET (206 Partial Content for bytes=0-1023)...');
    const res206 = await fetch('http://127.0.0.1:9001/api/files/test-final-range-job/MAYA-LE.mp4', {
      headers: { Range: 'bytes=0-1023' }
    });
    if (res206.status !== 206) throw new Error(`Expected status 206, got ${res206.status}`);
    const cr = res206.headers.get('content-range');
    if (cr !== 'bytes 0-1023/204800') throw new Error(`Content-Range mismatch: expected bytes 0-1023/204800, got ${cr}`);
    const cl206 = res206.headers.get('content-length');
    if (cl206 !== '1024') throw new Error(`Range Content-Length mismatch: expected 1024, got ${cl206}`);
    const buf206 = await res206.arrayBuffer();
    if (buf206.byteLength !== 1024) throw new Error(`Range buffer size mismatch: ${buf206.byteLength} vs 1024`);
    console.log('✓ 206 Partial Content passed: Content-Range and chunk Content-Length are exact');

    console.log('\n✅ ALL HTTP INVARIANT AND FINAL ARTIFACT SERVING TESTS PASSED!');
  } finally {
    server.close();
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

testHttpRange().catch(err => {
  console.error('❌ Range test failed:', err);
  process.exit(1);
});
