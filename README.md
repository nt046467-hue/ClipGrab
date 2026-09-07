
# ClipGrab — Professional Multi-Platform Downloader

This is a modern full-stack video and audio downloader.

## Prerequisites

- **Node.js** (v18+)
- **Redis**: Required for the download queue.
- **yt-dlp**: Needs to be in your system PATH for local development.

## Setup & Running

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Everything**:
   ```bash
   npm run dev
   ```
   This command uses `concurrently` to launch:
   - Next.js Frontend (Port 9002)
   - Express Backend (Port 8080)
   - BullMQ Worker

## Environment Variables

- `NEXT_PUBLIC_API_URL`: Points to your backend (default: http://localhost:8080)
- `REDIS_URL`: Connection string for Redis (default: redis://localhost:6379)
