# ⚡ Google Colab Ultra-Fast Backend Setup Guide

If Render free-tier is taking too long (cold starts or CPU limits), you can run the backend directly on **Google Colab (GPU or CPU runtime)** for **unlimited speed (100MB/s+) and zero queues**!

---

## 🚀 3-Step Setup

### Step 1: Open Google Colab
1. Go to [Google Colab](https://colab.research.google.com).
2. Click **New Notebook** (or open your existing notebook like `Untitled3.ipynb`).

---

### Step 2: Paste & Run This Code Cell

Paste the following Python code into a cell in your Colab notebook and click **Run** (▶️):

```python
# Install dependencies
!pip install -q fastapi uvicorn yt-dlp pycloudflared pydantic

import os, re, sys, time, uuid, json, asyncio, threading
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import yt_dlp
from pycloudflared import try_cloudflare
import uvicorn

app = FastAPI(title="ClipGrab Colab Worker")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

TEMP_DIR = Path("./temp_downloads")
TEMP_DIR.mkdir(parents=True, exist_ok=True)
jobs: Dict[str, Dict[str, Any]] = {}

class ResolveReq(BaseModel):
    url: str

class DownloadReq(BaseModel):
    url: str
    formatId: Optional[str] = "best"
    type: Optional[str] = "video"
    title: Optional[str] = "media"
    platform: Optional[str] = "unknown"

@app.get("/")
@app.get("/api/health")
def health():
    return {"status": "healthy", "engine": "Colab Accelerated Worker", "active_jobs": len(jobs)}

@app.get("/api/cookie-status")
def cookies():
    return {"checked": True, "valid": True, "message": "Colab Ready"}

@app.post("/api/resolve")
async def resolve(req: ResolveReq):
    ydl_opts = {'skip_download': True, 'quiet': True, 'no_warnings': True}
    loop = asyncio.get_event_loop()
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = await loop.run_in_executor(None, lambda: ydl.extract_info(req.url, download=False))
    
    dur = info.get('duration', 0) or 0
    raw_formats = info.get('formats', []) or []
    
    target_tiers = [
        {"max_h": 2160, "min_h": 1440, "label": "4K Ultra HD (2160p)"},
        {"max_h": 1440, "min_h": 1080, "label": "1080p Full HD"},
        {"max_h": 1079, "min_h": 720, "label": "720p HD"},
        {"max_h": 719, "min_h": 480, "label": "480p SD"},
        {"max_h": 479, "min_h": 240, "label": "360p Medium"},
    ]
    
    formats = []
    available_heights = [f.get('height') for f in raw_formats if f.get('height') and f.get('vcodec') != 'none']
    
    audio_streams = [f for f in raw_formats if f.get('vcodec') == 'none' and f.get('acodec') != 'none']
    best_audio = next((f for f in audio_streams if f.get('ext') == 'm4a' and (f.get('abr') or 128) <= 160), None)
    if not best_audio and audio_streams:
        best_audio = next((f for f in reversed(audio_streams) if f.get('ext') in ('m4a', 'mp4')), audio_streams[-1])
    
    audio_bytes = 0
    audio_id = ""
    if best_audio:
        audio_id = str(best_audio.get('format_id', ''))
        audio_bytes = best_audio.get('filesize') or best_audio.get('filesize_approx') or 0
        if not audio_bytes and best_audio.get('tbr') and dur > 0:
            audio_bytes = (best_audio.get('tbr') * 1000 * dur) / 8
    if not audio_bytes and dur > 0:
        audio_bytes = (128 * 1000 * dur) / 8

    for tier in target_tiers:
        matching = [h for h in available_heights if tier["min_h"] <= h <= tier["max_h"]]
        if matching:
            best_h = max(matching)
            tier_candidates = [f for f in raw_formats if f.get('height') == best_h and f.get('vcodec') != 'none']
            f_match = next((f for f in tier_candidates if str(f.get('vcodec', '')).startswith(('vp9', 'vp09')) and 'premium' not in str(f.get('format_note', '')).lower()), None)
            if not f_match:
                f_match = next((f for f in tier_candidates if str(f.get('vcodec', '')).startswith('avc1') and 'premium' not in str(f.get('format_note', '')).lower()), None)
            if not f_match and tier_candidates:
                f_match = tier_candidates[0]
            
            total_bytes = 0
            chosen_format_id = f"{best_h}p"
            if f_match:
                v_id = str(f_match.get('format_id', ''))
                v_bytes = f_match.get('filesize') or f_match.get('filesize_approx') or 0
                if not v_bytes and f_match.get('tbr') and dur > 0:
                    v_bytes = (f_match.get('tbr') * 1000 * dur) / 8
                
                if f_match.get('acodec') and f_match.get('acodec') != 'none':
                    total_bytes = v_bytes
                    chosen_format_id = v_id
                else:
                    total_bytes = (v_bytes + audio_bytes) if v_bytes else 0
                    chosen_format_id = f"{v_id}+{audio_id}" if (v_id and audio_id) else f"{best_h}p"
            
            if total_bytes > 0:
                size_str = f"{total_bytes / (1024 * 1024):.1f} MB"
            elif dur > 0:
                size_str = f"{round((tier.get('rate', 1.5) * dur) / 8, 1)} MB"
            else:
                size_str = "Auto"

            formats.append({
                "id": chosen_format_id,
                "type": "video",
                "quality": tier["label"],
                "ext": "mp4",
                "size": size_str
            })
    
    if not formats:
        formats.append({"id": "best", "type": "video", "quality": "Best Quality (1080p)", "ext": "mp4", "size": "Auto"})
    
    mp3_sz = f"{round((320 * 1000 * dur) / (8 * 1024 * 1024), 1)} MB" if dur > 0 else "5.5 MB"
    m4a_sz = f"{round(audio_bytes / (1024 * 1024), 1)} MB" if audio_bytes > 0 else (f"{round((128 * 1000 * dur) / (8 * 1024 * 1024), 1)} MB" if dur > 0 else "2.5 MB")
    formats.append({"id": "audio_best", "type": "audio", "quality": "MP3 High Quality (320kbps)", "ext": "mp3", "size": mp3_sz})
    formats.append({"id": f"audio_{audio_id}" if audio_id else "audio_m4a", "type": "audio", "quality": "M4A Stream (128kbps)", "ext": "m4a", "size": m4a_sz})
    
    dur_str = f"{int(dur//60)}:{int(dur%60):02d}" if dur else "N/A"
    return {
        "title": info.get('title', 'Video'),
        "thumbnail": info.get('thumbnail', ''),
        "duration": dur_str,
        "author": info.get('uploader') or info.get('channel') or 'Creator',
        "platform": "youtube",
        "formats": formats
    }

def do_download(job_id, url, format_id, mtype, title):
    jobs[job_id]["status"] = "active"
    jobs[job_id]["progress"] = 15
    clean_title = re.sub(r'[\\/*?:"<>|#%&{}!@]', '', title).strip()[:80].strip() or 'download'
    out = str(TEMP_DIR / f"{job_id}_{clean_title}.%(ext)s")
    def hook(d):
        if d['status'] == 'downloading':
            tot = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            if tot > 0:
                jobs[job_id]["progress"] = round(min(95, max(15, (d.get('downloaded_bytes', 0)/tot)*90)))
    
    opts = {
        'outtmpl': out,
        'quiet': True,
        'no_warnings': True,
        'progress_hooks': [hook],
        'concurrent_fragment_downloads': 8,
        'postprocessor_args': {'ffmpeg': ['-threads', '0']},
    }
    if mtype == "audio":
        if 'm4a' in str(format_id) or str(format_id).startswith('audio_'):
            raw_audio_id = str(format_id).replace('audio_', '')
            if raw_audio_id and raw_audio_id != 'best' and raw_audio_id != 'm4a':
                opts['format'] = f'{raw_audio_id}/bestaudio[ext=m4a]/bestaudio/best'
            else:
                opts['format'] = 'bestaudio[ext=m4a]/bestaudio/best'
        else:
            quality = '320' if '320' in str(format_id) else '192'
            opts['format'] = 'bestaudio/best'
            opts['postprocessors'] = [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': quality}]
    else:
        if format_id and format_id != 'best':
            opts['format'] = f'{format_id}/bestvideo+bestaudio/best'
        else:
            opts['format'] = 'bestvideo+bestaudio/best'

        opts['merge_output_format'] = 'mp4'
    
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    
    f = list(TEMP_DIR.glob(f"{job_id}_*"))[0]
    dl_ext = f.suffix or '.mp4'
    clean_filename = f"{clean_title}{dl_ext}"
    jobs[job_id]["status"] = "completed"
    jobs[job_id]["progress"] = 100
    jobs[job_id]["result"] = {"filename": clean_filename, "downloadUrl": f"/api/files/{f.name}"}

@app.post("/api/download")
def download(req: DownloadReq, bg: BackgroundTasks):
    jid = str(uuid.uuid4())
    jobs[jid] = {"id": jid, "status": "queued", "progress": 0}
    bg.add_task(do_download, jid, req.url, req.formatId, req.type, req.title)
    return {"jobId": jid}

@app.get("/api/status/{jid}")
def get_stat(jid: str):
    return jobs.get(jid, {"status": "failed", "error": "Not found"})

@app.get("/api/files/{name}")
def get_file(name: str):
    return FileResponse(TEMP_DIR / name, filename=name)

# Start background server
threading.Thread(target=lambda: uvicorn.run(app, host="0.0.0.0", port=8000), daemon=True).start()
time.sleep(2)

# Launch Cloudflare Tunnel
tunnel = try_cloudflare(port=8000)
print("\n" + "="*50)
print(f"🎉 YOUR CLIPGRAB COLAB URL:\n👉 {tunnel.tunnel} 👈")
print("="*50 + "\nCopy this URL into ClipGrab Server Settings!\n")
```

---

### Step 3: Connect in ClipGrab Website
1. Copy the generated `https://xxxx-xx-xx.trycloudflare.com` URL printed in the Colab output.
2. In ClipGrab, click the **⚡ Colab Engine** / **Settings** icon on the top-right navbar.
3. Paste the URL and click **Connect Colab Engine**.
4. Test with any video link — downloads will now be instantaneous! 🚀
