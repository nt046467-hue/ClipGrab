import 'dotenv/config';
import { Worker, Job, connection } from './queue';
import { downloadVideo, findActualOutputFile } from './yt-dlp';
import path from 'path';
import fs from 'fs';
import sanitize from 'sanitize-filename';

const TEMP_DIR = path.join(process.cwd(), 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const worker = new Worker('downloads', async (job: Job) => {
  const { url, formatId, type, title, platform } = job.data;
  console.log(`[Worker] Processing job ${job.id}: Platform=${platform}, Format=${formatId}, Type=${type}`);

  const sanitizedTitle = sanitize(title || 'video')
    .replace(/\s+/g, '_')
    .replace(/[#%?&]/g, '');
  const ext      = type === 'audio' ? 'mp3' : 'mp4';
  const filename = `${platform || 'Web'}_${sanitizedTitle}_${formatId || 'best'}.${ext}`;
  const outputPath = path.join(TEMP_DIR, filename);

  await downloadVideo(url, formatId, type, outputPath, (pct) => {
    job.updateProgress(pct);
  });

  const actualFilename = findActualOutputFile(TEMP_DIR, outputPath);
  console.log(`[Worker] Job ${job.id} completed: ${actualFilename}`);
  return { filename: actualFilename, downloadUrl: `/api/files/${encodeURIComponent(actualFilename)}` };
}, { connection });

worker.on('completed', (job: any) => {
  console.log(`[Worker] Job ${job.id} finished successfully.`);
});

worker.on('failed', (job: any, err: any) => {
  console.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
});
