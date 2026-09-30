// media-utils.ts
// Format checking, codec validation, WebVTT subtitle conversions, and thumbnail capture

export interface MediaSupportResult {
  supported: boolean;
  canPlay: 'probably' | 'maybe' | 'no';
  mimeType: string;
  reason?: string;
}

/**
 * Accurately determines if the current browser environment can decode a given format
 */
export function checkMediaSupport(filenameOrUrl: string, explicitMime?: string): MediaSupportResult {
  if (typeof window === 'undefined') {
    return { supported: true, canPlay: 'maybe', mimeType: explicitMime || 'video/mp4' };
  }

  const dummyVideo = document.createElement('video');

  // Blob URLs (local file picks from gallery) and data: URLs are always locally available — pass through
  if (filenameOrUrl.startsWith('blob:') || filenameOrUrl.startsWith('data:')) {
    return { supported: true, canPlay: 'probably', mimeType: explicitMime || 'video/mp4' };
  }

  const ext = filenameOrUrl.split('?')[0].split('.').pop()?.toLowerCase() || '';

  let mime = explicitMime || '';
  if (!mime) {
    switch (ext) {
      case 'mp4':
      case 'm4v':
        mime = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        break;
      case 'webm':
        mime = 'video/webm; codecs="vp8, vorbis"';
        break;
      case 'mkv':
        mime = 'video/x-matroska';
        break;
      case 'mp3':
        mime = 'audio/mpeg';
        break;
      case 'm4a':
      case 'aac':
        mime = 'audio/mp4; codecs="mp4a.40.2"';
        break;
      case 'ogg':
      case 'oga':
        mime = 'audio/ogg; codecs="vorbis"';
        break;
      case 'wav':
        mime = 'audio/wav';
        break;
      default:
        // No known extension (e.g. /api/download/:id) — assume browser-compatible MP4
        mime = 'video/mp4';
    }
  }

  // Test with canPlayType
  const canPlay = dummyVideo.canPlayType(mime);

  if (canPlay === 'probably' || canPlay === 'maybe') {
    return {
      supported: true,
      canPlay,
      mimeType: mime,
    };
  }

  // Handle common known incompatibilities
  if (ext === 'mkv' || mime.includes('matroska')) {
    return {
      supported: false,
      canPlay: 'no',
      mimeType: mime,
      reason: 'MKV containers are not natively supported by your mobile or web browser. Please download in MP4 format for seamless in-browser playback.',
    };
  }

  if (ext === 'avi') {
    return {
      supported: false,
      canPlay: 'no',
      mimeType: mime,
      reason: 'AVI video container is not supported in modern web browsers. Convert to MP4 (H.264).',
    };
  }

  return {
    supported: false,
    canPlay: 'no',
    mimeType: mime,
    reason: `Your browser does not natively support decoding ${ext.toUpperCase() || 'this format'}.`,
  };
}

/**
 * Converts SRT subtitle text to WebVTT format so it can be ingested natively by HTML5 <track>
 */
export function srtToWebVtt(srtText: string): string {
  let vtt = 'WEBVTT\n\n';
  // Normalize line endings
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Replace SRT comma timestamp with WebVTT dot timestamp: 00:01:20,000 --> 00:01:20.000
  const transformed = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  vtt += transformed;
  return vtt;
}

/**
 * Creates a Blob URL from subtitle text (either SRT or WebVTT)
 */
export function createSubtitleBlobUrl(content: string, isSrt = false): string {
  const vttText = isSrt ? srtToWebVtt(content) : (content.startsWith('WEBVTT') ? content : `WEBVTT\n\n${content}`);
  const blob = new Blob([vttText], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
}

/**
 * Generates and caches a preview frame from a video element
 */
const thumbnailCache = new Map<string, string>();

export async function captureVideoThumbnail(videoElement: HTMLVideoElement, cacheKey: string): Promise<string | null> {
  if (thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey)!;
  }

  try {
    if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.min(640, videoElement.videoWidth);
    canvas.height = Math.round((canvas.width / videoElement.videoWidth) * videoElement.videoHeight);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

    // Limit cache size
    if (thumbnailCache.size > 50) {
      const firstKey = thumbnailCache.keys().next().value;
      if (firstKey) thumbnailCache.delete(firstKey);
    }

    thumbnailCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Automatically extracts a clean, high-resolution thumbnail from a local video File
 */
export async function generateFileThumbnail(file: File): Promise<string> {
  if (typeof window === 'undefined' || !file.type.startsWith('video/')) {
    return '';
  }

  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;

      let resolved = false;
      const finish = (result: string) => {
        if (resolved) return;
        resolved = true;
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        resolve(result);
      };

      video.onloadeddata = () => {
        video.currentTime = Math.min(1.0, video.duration ? video.duration / 2 : 0.5);
      };

      video.onseeked = () => {
        try {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            const canvas = document.createElement('canvas');
            const targetWidth = Math.min(480, video.videoWidth);
            const targetHeight = Math.round((targetWidth / video.videoWidth) * video.videoHeight);
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
              finish(dataUrl);
              return;
            }
          }
        } catch {
          // Canvas capture failed
        }
        finish('');
      };

      video.onerror = () => finish('');

      // Fallback safety timeout
      setTimeout(() => finish(''), 3000);
    } catch {
      resolve('');
    }
  });
}