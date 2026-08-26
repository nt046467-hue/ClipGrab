import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = path.join(process.cwd(), 'temp');

export function startCleanupCron() {
  // Cron job runs every 5 minutes to clean up temp files and job folders older than 15 minutes
  cron.schedule('*/5 * * * *', () => {
    console.log('[Cleanup] Running temp directory cleanup...');
    if (!fs.existsSync(TEMP_DIR)) return;

    try {
      const entries = fs.readdirSync(TEMP_DIR);
      const now = Date.now();
      const expiry = 15 * 60 * 1000; // 15 minutes

      entries.forEach(entry => {
        const entryPath = path.join(TEMP_DIR, entry);
        try {
          const stats = fs.statSync(entryPath);
          if (now - stats.mtimeMs > expiry) {
            if (stats.isDirectory()) {
              console.log(`[Cleanup] Deleting expired job folder: ${entry}`);
              fs.rmSync(entryPath, { recursive: true, force: true });
            } else {
              console.log(`[Cleanup] Deleting expired file: ${entry}`);
              fs.unlinkSync(entryPath);
            }
          }
        } catch (itemErr: any) {
          console.warn(`[Cleanup] Error processing ${entry}:`, itemErr.message);
        }
      });
    } catch (err: any) {
      console.warn('[Cleanup] Error reading temp directory:', err.message);
    }
  });
}
