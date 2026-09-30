# ⚡ Google Colab Ultra-Fast Backend Setup Guide

If Render free-tier is taking too long (cold starts or CPU limits), you can run the backend directly on **Google Colab (GPU or CPU runtime)** for **unlimited speed (100MB/s+) and zero queues**!

---

## 🚀 3-Step Setup

### Step 1: Open Google Colab
1. Go to [Google Colab](https://colab.research.google.com).
2. Click **New Notebook** (or open your existing notebook like `Untitled3.ipynb`).

---

### Step 2: Paste & Run This Code Cell

#### Option A: 1-Click 3-Line Runner (Recommended)
Paste this into a cell in your Colab notebook and click **Run** (▶️):

```python
!pip install -q -U "yt-dlp[default]" fastapi uvicorn pycloudflared pydantic
!wget -q -O colab_worker.py https://<SITE_ORIGIN>/colab_worker.py
%run colab_worker.py
```
*(Replace `<SITE_ORIGIN>` with your ClipGrab site URL, or copy directly from the `/colab` page where it is prefilled!)*

---

#### Option B: Standalone Python Script
Alternatively, you can paste the full script directly:

```python
!pip install -q -U "yt-dlp[default]" fastapi uvicorn pycloudflared pydantic

import os, re, time, uuid, asyncio, threading, subprocess, shutil, urllib.parse, urllib.request
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel
import yt_dlp
from pycloudflared import try_cloudflare
import uvicorn

app = FastAPI(title="ClipGrab Colab Engine")

# Fully permissive CORS for all web origins (Vercel, Localhost, Mobile)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Length", "Content-Range", "Accept-Ranges"],
)

@app.middleware("http")
async def add_cors_headers(request: Request, call_next):
    if request.method == "OPTIONS":
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response

TEMP_DIR = Path("./temp_downloads")
COOKIE_FILE = Path("./cookies.txt")
FILE_TTL = 3 * 3600          # delete finished files after 3h (long videos need time to download)
MIN_FREE_GB = 2              # refuse new jobs below this much free disk

# start clean (a re-run of the cell would otherwise leave old GBs behind)
shutil.rmtree(TEMP_DIR, ignore_errors=True)
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

class CookieReq(BaseModel):
    cookies: str

def has_cookies() -> bool:
    return COOKIE_FILE.exists() and COOKIE_FILE.stat().st_size > 0

def free_gb() -> float:
    return round(shutil.disk_usage(str(TEMP_DIR)).free / 1073741824, 1)

def base_opts() -> Dict[str, Any]:
    """Options shared by resolve + download (cookies, no playlists, retries, JS runtime)."""
    o: Dict[str, Any] = {
        'quiet': True, 'no_warnings': True, 'noplaylist': True,
        'retries': 10, 'fragment_retries': 10, 'socket_timeout': 30,
    }
    if has_cookies():
        o['cookiefile'] = str(COOKIE_FILE)
    # yt-dlp needs a JS runtime for YouTube challenges; Colab ships with node
    if shutil.which('deno'):
        o['js_runtimes'] = {'deno': {}}
    elif shutil.which('node'):
        o['js_runtimes'] = {'node': {}}
    return o

def js_cli_args():
    if shutil.which('deno'):
        return []
    if shutil.which('node'):
        return ['--js-runtimes', 'node']
    return []

@app.get("/")
@app.get("/api/health")
def health():
    return {"status": "healthy", "engine": "Colab Accelerated Worker", "active_jobs": len([j for j in jobs.values() if j.get("status") in ("queued", "active")]), "free_gb": free_gb()}

@app.get("/api/cookie-status")
def cookies():
    has_c = has_cookies()
    return {"checked": True, "valid": has_c, "message": "Colab Cookies Active" if has_c else "Colab Ready"}

@app.post("/api/upload-cookies")
def upload_cookies(req: CookieReq):
    if not req.cookies: raise HTTPException(status_code=400, detail="Cookies required")
    COOKIE_FILE.write_text(req.cookies, encoding="utf-8")
    return {"status": "success", "message": "Cookies saved to Colab worker"}

def fmt_bytes(b, approx=True):
    if not b or b <= 0: return "Size unavailable"
    p = "~" if approx else ""
    if b >= 1073741824: return f"{p}{b/1073741824:.2f} GB"
    if b >= 1048576: return f"{p}{b/1048576:.1f} MB"
    if b >= 1024: return f"{p}{b/1024:.1f} KB"
    return f"{p}{int(b)} B"

def detect_platform(url: str) -> str:
    u = (url or "").lower()
    if "tiktok.com" in u: return "tiktok"
    if "instagram.com" in u: return "instagram"
    if "pinterest.com" in u or "pin.it" in u: return "pinterest"
    if "facebook.com" in u or "fb.watch" in u: return "facebook"
    if "twitter.com" in u or "x.com" in u: return "twitter"
    if "soundcloud.com" in u: return "soundcloud"
    return "youtube"

@app.post("/api/resolve")
async def resolve(req: ResolveReq):
    ydl_opts = base_opts()
    ydl_opts.update({'skip_download': True})
    loop = asyncio.get_running_loop()
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = await loop.run_in_executor(None, lambda: ydl.extract_info(req.url, download=False))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:400])
    if not info:
        raise HTTPException(status_code=404, detail="Could not read this link")

    dur = info.get('duration', 0) or 0
    raw_formats = info.get('formats', []) or []

    target_tiers = [
        {"max_h": 2160, "min_h": 1441, "label": "4K Ultra HD (2160p)", "height": 2160, "target_br": 8500, "max_br": 15000},
        {"max_h": 1440, "min_h": 1081, "label": "2K QHD (1440p)", "height": 1440, "target_br": 4500, "max_br": 8000},
        {"max_h": 1080, "min_h": 721, "label": "1080p Full HD", "height": 1080, "target_br": 1800, "max_br": 3500},
        {"max_h": 720, "min_h": 481, "label": "720p HD", "height": 720, "target_br": 500, "max_br": 1200},
        {"max_h": 480, "min_h": 361, "label": "480p SD", "height": 480, "target_br": 300, "max_br": 700},
        {"max_h": 360, "min_h": 241, "label": "360p Medium", "height": 360, "target_br": 200, "max_br": 450},
        {"max_h": 240, "min_h": 144, "label": "240p Mobile", "height": 240, "target_br": 120, "max_br": 250},
    ]

    formats = []
    audio_streams = [f for f in raw_formats if f.get('vcodec') == 'none' and f.get('acodec') and f.get('acodec') != 'none' and '-drc' not in str(f.get('format_id', ''))]
    best_audio = None
    for a in audio_streams:
        if a.get('ext') in ('m4a', 'mp4') or 'mp4a' in str(a.get('acodec', '')):
            if (a.get('abr') or a.get('tbr') or 128) <= 160:
                best_audio = a
                break
    if not best_audio and audio_streams: best_audio = audio_streams[0]

    audio_bytes = 0
    if best_audio:
        audio_bytes = best_audio.get('filesize') or best_audio.get('filesize_approx') or 0
        if not audio_bytes and (best_audio.get('abr') or best_audio.get('tbr')) and dur > 0:
            audio_bytes = round(((best_audio.get('abr') or best_audio.get('tbr')) * 1000 * dur) / 8)
    if not audio_bytes and dur > 0: audio_bytes = round((128 * 1000 * dur) / 8)

    video_streams = [f for f in raw_formats if f.get('vcodec') and f.get('vcodec') != 'none']

    for tier in target_tiers:
        candidates = [f for f in video_streams if tier["min_h"] <= (f.get('height') or 0) <= tier["max_h"]]
        if candidates:
            has_std_fps = any((f.get('fps') or 30) <= 30 for f in candidates)
            scored = []
            for c in candidates:
                score = 0.0
                if 'premium' in str(c.get('format_note', '')).lower(): score += 5000.0
                fps = c.get('fps') or 30
                if has_std_fps and fps > 30: score += 200.0
                actual_sz = c.get('filesize') or c.get('filesize_approx') or 0
                br = c.get('vbr') or c.get('tbr') or ((actual_sz * 8) / (dur * 1000) if actual_sz and dur > 0 else tier["target_br"])
                vcodec = str(c.get('vcodec', ''))
                if re.search(r'^(avc1|h264)', vcodec, re.I): score += 0.0
                elif re.search(r'^(vp9|vp09)', vcodec, re.I): score += 10.0
                elif re.search(r'^(av01)', vcodec, re.I): score += 25.0
                else: score += 50.0
                score += (br / tier["target_br"]) * 5.0
                h = c.get('height') or tier["height"]
                score += abs(h - tier["height"]) * 2.0
                scored.append((score, c, br))
            scored.sort(key=lambda x: x[0])
            match = scored[0][1]
            v_id = str(match.get('format_id', ''))
            has_audio_track = match.get('acodec') and match.get('acodec') != 'none'
            chosen_id = v_id if (has_audio_track or not best_audio) else f"{v_id}+{best_audio.get('format_id')}"
            v_bytes = match.get('filesize') or match.get('filesize_approx') or 0
            if not v_bytes and (match.get('vbr') or match.get('tbr')) and dur > 0:
                v_bytes = round(((match.get('vbr') or match.get('tbr')) * 1000 * dur) / 8)
            elif not v_bytes and dur > 0: v_bytes = round((tier["target_br"] * 1000 * dur) / 8)
            if v_bytes > 0 and dur > 0 and (v_bytes * 8) / (dur * 1000) > tier["max_br"]:
                v_bytes = round((tier["target_br"] * 1000 * dur) / 8)
            est_bytes = v_bytes if has_audio_track else (v_bytes + audio_bytes if v_bytes > 0 else (round((tier["target_br"] * 1000 * dur) / 8) if dur > 0 else 0))
            size_str = fmt_bytes(est_bytes, True) if est_bytes > 0 else "Size unavailable"
            formats.append({"id": chosen_id, "type": "video", "quality": tier["label"], "ext": "mp4", "size": size_str})

    if not formats:
        est_sz = fmt_bytes(round((dur * 1800 * 1000 / 8) + audio_bytes), True) if dur > 0 else "25.0 MB"
        formats.append({"id": "1080p", "type": "video", "quality": "1080p Full HD", "ext": "mp4", "size": est_sz})
        formats.append({"id": "720p", "type": "video", "quality": "720p HD", "ext": "mp4", "size": fmt_bytes(round((dur * 900 * 1000 / 8) + audio_bytes), True) if dur > 0 else "15.0 MB"})

    mp3_sz = fmt_bytes(round((320 * 1000 * dur) / 8), True) if dur > 0 else "5.5 MB"
    formats.append({"id": "mp3-320k", "type": "audio", "quality": "MP3 High Quality (320kbps)", "ext": "mp3", "size": mp3_sz})

    dur_str = f"{int(dur//60)}:{int(dur%60):02d}" if dur else "N/A"
    d_url = None
    if info.get('url') and (info.get('ext') == 'mp4' or 'pinimg.com' in str(info.get('url')) or 'twimg.com' in str(info.get('url'))):
        d_url = info['url']
    elif info.get('formats'):
        mp4s = [f for f in info['formats'] if f.get('ext') == 'mp4' and f.get('url') and not str(f.get('protocol', '')).startswith('m3u8')]
        if mp4s: d_url = mp4s[0].get('url')
    return {
        "title": info.get('title', 'Video'),
        "thumbnail": info.get('thumbnail', ''),
        "duration": dur_str,
        "durationSeconds": int(dur),
        "author": info.get('uploader') or info.get('channel') or info.get('creator') or 'Creator',
        "platform": detect_platform(req.url),
        "formats": formats,
        "directUrl": d_url
    }

def do_download(job_id, url, format_id, mtype, title):
    job = jobs[job_id]
    try:
        job["status"] = "active"
        job["progress"] = 5
        clean_title = re.sub(r'[\\/*?:"<>|#%&{}!@]', '', title or 'media').strip()[:80].strip() or 'download'
        out = str(TEMP_DIR / f"{job_id}_{clean_title}.%(ext)s")

        seen: Dict[str, Any] = {}   # per-stream (downloaded, total) so video+audio progress adds up
        def hook(d):
            if d['status'] not in ('downloading', 'finished'):
                return
            fn = d.get('filename') or ''
            tot = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            dl = d.get('downloaded_bytes') or 0
            if d['status'] == 'finished':
                tot = dl = (d.get('total_bytes') or dl)
            seen[fn] = (dl, tot)
            T = sum(t for _, t in seen.values())
            D = sum(x for x, _ in seen.values())
            if T > 0:
                job["progress"] = max(job["progress"], min(92, round(5 + 87 * D / T)))

        def pp_hook(d):
            if d.get('status') == 'started':
                job["progress"] = max(job["progress"], 94)

        opts = base_opts()
        opts.update({
            'outtmpl': out,
            'progress_hooks': [hook],
            'postprocessor_hooks': [pp_hook],
            'concurrent_fragment_downloads': 4,
        })

        if mtype == "audio":
            q = "320" if format_id == "mp3-320k" else "192"
            opts['format'] = 'bestaudio/best'
            opts['postprocessors'] = [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': q}]
        else:
            if format_id and format_id != "best":
                if "+" in format_id or format_id.isdigit():
                    opts['format'] = format_id
                else:
                    m = re.search(r'(\d+)', str(format_id))
                    h = int(m.group(1)) if m else 1080
                    opts['format'] = (f"bv*[height<={h}][vcodec^=avc1]+ba[ext=m4a]/"
                                      f"bv*[height<={h}]+ba/b[height<={h}]/b")
            else:
                opts['format'] = 'bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b'
            # STREAM COPY: no re-encode (that was the 3-hour-video killer)
            opts['merge_output_format'] = 'mp4'

        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        files = [p for p in TEMP_DIR.glob(f"{job_id}_*") if p.suffix not in ('.part', '.ytdl', '.temp')]
        if not files:
            raise RuntimeError("Download finished but output file was not found")
        f = max(files, key=lambda p: p.stat().st_size)
        dl_ext = f.suffix or '.mp4'
        job["result"] = {"filename": f"{clean_title}{dl_ext}", "downloadUrl": f"/api/files/{f.name}", "size": f.stat().st_size}
        job["progress"] = 100
        job["status"] = "completed"
    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)[:400]
        for p in TEMP_DIR.glob(f"{job_id}_*"):   # don't leave partial GBs behind
            try: p.unlink()
            except Exception: pass

@app.post("/api/download")
def download(req: DownloadReq, bg: BackgroundTasks):
    if free_gb() < MIN_FREE_GB:
        raise HTTPException(status_code=503, detail="Server busy: low disk space")
    jid = str(uuid.uuid4())
    jobs[jid] = {"id": jid, "status": "queued", "progress": 0, "created": time.time()}
    bg.add_task(do_download, jid, req.url, req.formatId, req.type, req.title)
    return {"jobId": jid}

@app.get("/api/status/{jid}")
def get_stat(jid: str):
    return jobs.get(jid, {"status": "failed", "error": "Not found"})

@app.get("/api/files/{name}")
def get_file(name: str):
    f_path = (TEMP_DIR / name).resolve()
    if f_path.parent != TEMP_DIR.resolve() or not f_path.is_file():
        raise HTTPException(status_code=404, detail="File not found or expired")
    clean_name = re.sub(r'^[0-9a-fA-F-]{36}_', '', f_path.name)
    asc_name = (re.sub(r'[^ -~]', '_', clean_name).replace('"', '')) or 'media.mp4'
    enc_name = urllib.parse.quote(clean_name)
    disposition = 'attachment; filename="' + asc_name + "\"; filename*=UTF-8''" + enc_name
    return FileResponse(f_path, headers={"Content-Disposition": disposition})

def stream_ytdlp(url: str):
    args = ['yt-dlp', '-f', 'best[height<=480][ext=mp4]/best[height<=480]/best', '-o', '-', '--no-playlist', '--quiet'] + js_cli_args()
    if has_cookies(): args.extend(['--cookies', str(COOKIE_FILE)])
    args.append(url)
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    def gen():
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk: break
                yield chunk
        finally:
            if proc.poll() is None:
                proc.kill()   # client left: stop the yt-dlp process
    return StreamingResponse(gen(), media_type="video/mp4")

@app.get("/api/preview")
async def preview_video(url: str = Query(...)):
    if not url: raise HTTPException(status_code=400, detail="URL required")
    try:
        opts = base_opts()
        opts.update({'skip_download': True})
        loop = asyncio.get_running_loop()
        info = await loop.run_in_executor(None, lambda: yt_dlp.YoutubeDL(opts).extract_info(url, download=False))
        if info:
            d_url = info.get('url')
            if d_url and (info.get('ext') == 'mp4' or 'pinimg.com' in str(d_url) or 'twimg.com' in str(d_url)):
                if 'pinimg.com' in d_url or 'twimg.com' in d_url:
                    return RedirectResponse(url=d_url, status_code=307)
    except Exception:
        pass
    return stream_ytdlp(url)

@app.get("/api/thumbnail")
async def proxy_thumbnail(url: str = Query(...)):
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid URL")
    try:
        r = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(r, timeout=15) as resp:
            data = resp.read()
            return StreamingResponse(iter([data]), media_type=resp.headers.get_content_type() or "image/jpeg")
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to proxy thumbnail")

def janitor():
    """Every 10 min: delete old files + forget old jobs so Colab disk never fills."""
    while True:
        try:
            now = time.time()
            for p in TEMP_DIR.iterdir():
                try:
                    if now - p.stat().st_mtime > FILE_TTL:
                        if p.is_file(): p.unlink()
                        else: shutil.rmtree(p, ignore_errors=True)
                except Exception:
                    pass
            for jid, j in list(jobs.items()):
                if now - j.get("created", now) > FILE_TTL * 2:
                    jobs.pop(jid, None)
        except Exception:
            pass
        time.sleep(600)

# Clean up any existing background processes on port 8000 or cloudflared
os.system("fuser -k 8000/tcp > /dev/null 2>&1 || true")
os.system("pkill -9 -f cloudflared > /dev/null 2>&1 || true")
time.sleep(1)

# Run janitor + server + tunnel
threading.Thread(target=janitor, daemon=True).start()
threading.Thread(target=lambda: uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning"), daemon=True).start()
time.sleep(2)
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
