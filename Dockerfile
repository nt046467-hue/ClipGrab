
# Use a Node.js base image with a lean footprint
FROM node:20-slim

# Install system dependencies for yt-dlp and ffmpeg
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp with optional dependencies (including EJS scripts for JS runtimes) via Python venv
RUN python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir "yt-dlp[default]" \
    && ln -sf /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp

# Install Deno (the officially recommended JS runtime for yt-dlp)
RUN curl -fsSL https://deno.land/install.sh | sh \
    && mv $HOME/.deno/bin/deno /usr/local/bin/deno

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy application code
COPY . .

# Global install of tsx for running TS files in production directly
RUN npm install -g tsx

# Expose the API port
EXPOSE 8080

# Environment variables
ENV PORT=8080
ENV NODE_ENV=production

# Start both the API server and the BullMQ worker
# In a large production setup, these would be separate services, 
# but for Cloud Run this 'sidecar' approach works well for small apps.
CMD ["sh", "-c", "tsx backend/src/index.ts & tsx backend/src/worker.ts"]
