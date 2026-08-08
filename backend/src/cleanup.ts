
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = path.join(process.cwd(), 'temp');

export function startCleanupCron() {
  // 5. Cron job every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    console.log('Running temp file cleanup...');
    if (!fs.existsSync(TEMP_DIR)) return;

    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    const expiry = 15 * 60 * 1000; // 15 minutes

    files.forEach(file => {
      const filePath = path.join(TEMP_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtimeMs > expiry) {
        console.log(`Deleting expired file: ${file}`);
        fs.unlinkSync(filePath);
      }
    });
  });
}
