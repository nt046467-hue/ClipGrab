FROM node:20-slim

# Install system dependencies (ffmpeg, python3 for yt-dlp)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp via pip with [default] extra — includes EJS scripts needed for JS runtimes
RUN python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir "yt-dlp[default]" \
    && ln -sf /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp

# Install Deno (officially recommended JS runtime for yt-dlp YouTube extraction)
RUN curl -fsSL https://deno.land/install.sh | sh \
    && mv $HOME/.deno/bin/deno /usr/local/bin/deno

WORKDIR /app

# Copy root package files and install ALL dependencies
COPY package*.json ./
RUN npm install

# Copy the full project source
COPY . .

# Ensure temp directory exists and is writable
RUN mkdir -p /app/temp && chmod 777 /app/temp

EXPOSE 8080

# Start only the backend server
CMD ["npx", "tsx", "backend/src/index.ts"]
