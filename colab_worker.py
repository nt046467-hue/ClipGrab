"""
ClipGrab Google Colab Backend Worker
====================================
Run this in Google Colab (CPU or GPU runtime) to get unlimited, high-speed downloads
with no Render cold-starts or free-tier restrictions!

How to use in Colab:
1. Open Google Colab (https://colab.research.google.com)
2. Create a new notebook
3. Paste the following in a cell and click Run:

!pip install fastapi uvicorn yt-dlp pycloudflared pydantic
!wget -q https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/yt_dlp/__init__.py
# Paste this entire file code into Colab and run it!
"""

import os
import re
import sys
import time
import uuid
import json
import shutil
import asyncio
import subprocess
import urllib.parse
from pathlib import Path
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response, RedirectResponse
from pydantic import BaseModel
import yt_dlp

app = FastAPI(title="ClipGrab Colab High-Speed Worker")

# Enable CORS for all origins so the Next.js frontend (Vercel / Localhost) can talk to Colab
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
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
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# In-memory jobs tracking
jobs: Dict[str, Dict[str, Any]] = {}

class ResolveRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    formatId: Optional[str] = "best"
    type: Optional[str] = "video"
    title: Optional[str] = "media"
    platform: Optional[str] = "unknown"

def sanitize_name(name: str) -> str:
    cleaned = re.sub(r'[\\/*?:"<>|]', '', name)
    cleaned = re.sub(r'\s+', '_', cleaned)
    return cleaned[:100]

def format_duration(seconds: Optional[float]) -> str:
    if not seconds:
        return "N/A"
    seconds = int(seconds)
    mins, secs = divmod(seconds, 60)
    hours, mins = divmod(mins, 60)
    if hours > 0:
        return f"{hours}:{mins:02d}:{secs:02d}"
    return f"{mins}:{secs:02d}"

def detect_platform_py(url: str) -> str:
    u = url.lower()
    if "youtube.com" in u or "youtu.be" in u:
        return "youtube"
    if "tiktok.com" in u:
        return "tiktok"
    if "instagram.com" in u:
        return "instagram"
    if "facebook.com" in u or "fb.watch" in u:
        return "facebook"
    if "twitter.com" in u or "x.com" in u:
        return "twitter"
    if "pinterest.com" in u or "pin.it" in u:
        return "pinterest"
    return "unknown"

@app.get("/")
@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "engine": "Colab High-Speed Accelerated Worker",
        "platform": "Google Colab",
        "time": time.time(),
        "active_jobs": len(jobs)
    }

class CookieRequest(BaseModel):
    cookies: str

@app.get("/api/cookie-status")
def cookie_status():
    cookie_file = Path("./cookies.txt")
    has_cookies = cookie_file.exists() and cookie_file.stat().st_size > 0
    return {"checked": True, "valid": has_cookies, "message": "Colab cookies active" if has_cookies else "Colab environment ready"}

@app.post("/api/upload-cookies")
def upload_cookies(req: CookieRequest):
    if not req.cookies:
        raise HTTPException(status_code=400, detail="Cookies content is required")
    try:
        cookie_path = Path("./cookies.txt")
        cookie_path.write_text(req.cookies, encoding="utf-8")
        return {"status": "success", "message": "Cookies saved successfully to Colab worker"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save cookies: {e}")

def format_bytes_py(bytes_num: float, is_approx: bool = True) -> str:
    if not bytes_num or bytes_num <= 0:
        return "Size unavailable"
    prefix = "~" if is_approx else ""
    gb = 1024 * 1024 * 1024
    mb = 1024 * 1024
    kb = 1024
    if bytes_num >= gb:
        return f"{prefix}{bytes_num / gb:.2f} GB"
    if bytes_num >= mb:
        return f"{prefix}{bytes_num / mb:.1f} MB"
    if bytes_num >= kb:
        return f"{prefix}{bytes_num / kb:.1f} KB"
    return f"{prefix}{int(bytes_num)} B"

@app.post("/api/resolve")
async def resolve_media(req: ResolveRequest):
    if not req.url:
        raise HTTPException(status_code=400, detail="URL is required")

    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
    }

    cookie_file = Path("./cookies.txt")
    if cookie_file.exists() and cookie_file.stat().st_size > 0:
        ydl_opts['cookiefile'] = str(cookie_file)

    try:
        loop = asyncio.get_event_loop()
        def extract():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(req.url, download=False)

        info = await loop.run_in_executor(None, extract)
        if not info:
            raise HTTPException(status_code=404, detail="Failed to retrieve video metadata")

        dur = info.get('duration', 0) or 0
        raw_formats = info.get('formats', [])
        platform = detect_platform_py(req.url)

        target_tiers = [
            {"max_h": 2160, "min_h": 1441, "label": "4K Ultra HD (2160p)", "height": 2160, "target_br": 8500, "max_br": 15000},
            {"max_h": 1440, "min_h": 1081, "label": "2K QHD (1440p)", "height": 1440, "target_br": 4500, "max_br": 8000},
            {"max_h": 1080, "min_h": 721, "label": "1080p Full HD", "height": 1080, "target_br": 1800, "max_br": 3500},
            {"max_h": 720, "min_h": 481, "label": "720p HD", "height": 720, "target_br": 500, "max_br": 1200},
            {"max_h": 480, "min_h": 361, "label": "480p SD", "height": 480, "target_br": 300, "max_br": 700},
            {"max_h": 360, "min_h": 241, "label": "360p Medium", "height": 360, "target_br": 200, "max_br": 450},
            {"max_h": 240, "min_h": 144, "label": "240p Mobile", "height": 240, "target_br": 120, "max_br": 250},
        ]

        formats_list = []

        audio_streams = [f for f in raw_formats if f.get('vcodec') == 'none' and f.get('acodec') and f.get('acodec') != 'none' and '-drc' not in str(f.get('format_id', ''))]
        best_audio = None
        for a in audio_streams:
            if a.get('ext') in ('m4a', 'mp4') or 'mp4a' in str(a.get('acodec', '')):
                if (a.get('abr') or a.get('tbr') or 128) <= 160:
                    best_audio = a
                    break
        if not best_audio and audio_streams:
            best_audio = audio_streams[0]

        audio_bytes = 0
        if best_audio:
            audio_bytes = best_audio.get('filesize') or best_audio.get('filesize_approx') or 0
            if not audio_bytes and (best_audio.get('abr') or best_audio.get('tbr')) and dur > 0:
                audio_bytes = round(((best_audio.get('abr') or best_audio.get('tbr')) * 1000 * dur) / 8)
        if not audio_bytes and dur > 0:
            audio_bytes = round((128 * 1000 * dur) / 8)

        video_streams = [f for f in raw_formats if f.get('vcodec') and f.get('vcodec') != 'none']

        if platform == 'youtube':
            for tier in target_tiers:
                candidates = [f for f in video_streams if tier["min_h"] <= (f.get('height') or 0) <= tier["max_h"]]
                if candidates:
                    has_std_fps = any((f.get('fps') or 30) <= 30 for f in candidates)
                    scored = []
                    for c in candidates:
                        score = 0.0
                        if 'premium' in str(c.get('format_note', '')).lower():
                            score += 5000.0
                        fps = c.get('fps') or 30
                        if has_std_fps and fps > 30:
                            score += 200.0
                        actual_sz = c.get('filesize') or c.get('filesize_approx') or 0
                        br = c.get('vbr') or c.get('tbr') or ((actual_sz * 8) / (dur * 1000) if actual_sz and dur > 0 else tier["target_br"])
                        vcodec = str(c.get('vcodec', ''))
                        if re.search(r'^(avc1|h264)', vcodec, re.I):
                            score += 0.0
                        elif re.search(r'^(vp9|vp09)', vcodec, re.I):
                            score += 10.0
                        elif re.search(r'^(av01)', vcodec, re.I):
                            score += 25.0
                        else:
                            score += 50.0
                        score += (br / tier["target_br"]) * 5.0
                        h = c.get('height') or tier["height"]
                        score += abs(h - tier["height"]) * 2.0
                        scored.append((score, c, br))

                    scored.sort(key=lambda x: x[0])
                    best_choice = scored[0]
                    match = best_choice[1]
                    v_id = str(match.get('format_id', ''))
                    has_audio_track = match.get('acodec') and match.get('acodec') != 'none'

                    chosen_id = v_id
                    a_id = None
                    if not has_audio_track and best_audio:
                        a_id = str(best_audio.get('format_id', ''))
                        chosen_id = f"{v_id}+{a_id}"

                    video_bytes = match.get('filesize') or match.get('filesize_approx') or 0
                    if not video_bytes and (match.get('vbr') or match.get('tbr')) and dur > 0:
                        video_bytes = round(((match.get('vbr') or match.get('tbr')) * 1000 * dur) / 8)
                    elif not video_bytes and dur > 0:
                        video_bytes = round((tier["target_br"] * 1000 * dur) / 8)

                    if video_bytes > 0 and dur > 0:
                        implied_br = (video_bytes * 8) / (dur * 1000)
                        if implied_br > tier["max_reasonable"]:
                            video_bytes = round((tier["target_br"] * 1000 * dur) / 8)

                    v_src_bytes = video_bytes if video_bytes > 0 else None
                    a_src_bytes = 0 if has_audio_track else (audio_bytes if audio_bytes > 0 else None)
                    est_bytes = video_bytes if has_audio_track else (video_bytes + audio_bytes if video_bytes > 0 else (round((tier["target_br"] * 1000 * dur) / 8) if dur > 0 else 0))

                    size_str = format_bytes_py(est_bytes, True) if est_bytes > 0 else "Size unavailable"
                    w = match.get('width') or (round(match.get('height', tier["height"]) * (16 / 9)) if match.get('height') else None)
                    h = match.get('height') or tier["height"]
                    res_str = f"{w}x{h}" if w and h else f"{h}p"

                    formats_list.append({
                        "id": chosen_id,
                        "type": "video",
                        "quality": tier["label"],
                        "ext": "mp4",
                        "resolution": res_str,
                        "videoFormatId": v_id,
                        "audioFormatId": a_id,
                        "videoSourceBytes": v_src_bytes,
                        "audioSourceBytes": a_src_bytes,
                        "estimatedBytes": est_bytes if est_bytes > 0 else None,
                        "filesize": match.get('filesize'),
                        "filesizeApprox": est_bytes if est_bytes > 0 else None,
                        "size": size_str,
                        "isEstimated": True,
                        "fps": match.get('fps'),
                        "videoCodec": match.get('vcodec'),
                        "audioCodec": match.get('acodec') if has_audio_track else (best_audio.get('acodec') if best_audio else 'aac')
                    })
        else:
            progressive_formats = [f for f in video_streams if (f.get('acodec') and f.get('acodec') != 'none') or not audio_streams]
            candidate_list = progressive_formats if progressive_formats else video_streams

            resolution_groups = {}
            for cand in candidate_list:
                h = cand.get('height') or 0
                w = cand.get('width') or 0
                min_dim = min(h, w) if (h > 0 and w > 0) else (h or w or 720)
                if min_dim >= 1000:
                    t_label = "1080p Full HD"
                elif min_dim >= 700:
                    t_label = "720p HD"
                elif min_dim >= 450:
                    t_label = "480p SD"
                elif min_dim >= 320:
                    t_label = "360p SD"
                elif min_dim > 0:
                    t_label = f"{min_dim}p"
                else:
                    t_label = "Original Quality"
                if t_label not in resolution_groups:
                    resolution_groups[t_label] = []
                resolution_groups[t_label].append(cand)

            for t_label, group in resolution_groups.items():
                def sort_key(f):
                    vcodec = str(f.get('vcodec', '')).lower()
                    is_h264 = 1 if re.search(r'^(avc1|h264)', vcodec, re.I) else (0 if re.search(r'^(hevc|hvc1|bytevc1)', vcodec, re.I) else 0.5)
                    is_mp4 = 1 if f.get('ext') == 'mp4' else 0
                    br = f.get('tbr') or f.get('vbr') or 0
                    sz = f.get('filesize') or f.get('filesize_approx') or 0
                    return (is_h264, is_mp4, br, sz)
                group.sort(key=sort_key, reverse=True)
                match = group[0]
                v_id = str(match.get('format_id', ''))
                has_audio_track = match.get('acodec') and match.get('acodec') != 'none'

                chosen_id = v_id
                a_id = None
                if not has_audio_track and best_audio:
                    a_id = str(best_audio.get('format_id', ''))
                    chosen_id = f"{v_id}+{a_id}"

                video_bytes = match.get('filesize') or match.get('filesize_approx') or 0
                if not video_bytes and (match.get('vbr') or match.get('tbr')) and dur > 0:
                    video_bytes = round(((match.get('vbr') or match.get('tbr')) * 1000 * dur) / 8)

                est_bytes = video_bytes if has_audio_track else (video_bytes + audio_bytes if video_bytes > 0 else 0)
                size_str = format_bytes_py(est_bytes, True) if est_bytes > 0 else "Size unavailable"
                w = match.get('width')
                h = match.get('height')
                res_str = f"{w}x{h}" if (w and h) else (f"{h}p" if h else t_label)

                formats_list.append({
                    "id": chosen_id,
                    "type": "video",
                    "quality": t_label,
                    "ext": "webm" if match.get('ext') == 'webm' else "mp4",
                    "resolution": res_str,
                    "videoFormatId": v_id,
                    "audioFormatId": a_id,
                    "videoSourceBytes": video_bytes if video_bytes > 0 else None,
                    "audioSourceBytes": 0 if has_audio_track else (audio_bytes if audio_bytes > 0 else None),
                    "estimatedBytes": est_bytes if est_bytes > 0 else None,
                    "filesize": match.get('filesize'),
                    "filesizeApprox": est_bytes if est_bytes > 0 else None,
                    "size": size_str,
                    "isEstimated": True,
                    "fps": match.get('fps'),
                    "videoCodec": match.get('vcodec'),
                    "audioCodec": match.get('acodec') if has_audio_track else (best_audio.get('acodec') if best_audio else 'aac')
                })

        # Default fallback formats if none parsed cleanly
        if not formats_list:
            est_sz = format_bytes_py(round((dur * 1800 * 1000 / 8) + audio_bytes), True) if dur > 0 else "25.0 MB"
            formats_list.append({"id": "1080p", "type": "video", "quality": "1080p Full HD", "ext": "mp4", "size": est_sz})
            formats_list.append({"id": "720p", "type": "video", "quality": "720p HD", "ext": "mp4", "size": format_bytes_py(round((dur * 900 * 1000 / 8) + audio_bytes), True) if dur > 0 else "15.0 MB"})

        # Audio formats (MP3 / M4A) with exact byte calculations
        mp3_sz = format_bytes_py(round((320 * 1000 * dur) / 8), True) if dur > 0 else "5.5 MB"
        m4a_sz = format_bytes_py(round((128 * 1000 * dur) / 8), True) if dur > 0 else "2.5 MB"
        formats_list.append({"id": "mp3-320k", "type": "audio", "quality": "MP3 High Quality (320kbps)", "ext": "mp3", "size": mp3_sz})
        formats_list.append({"id": "mp3-128k", "type": "audio", "quality": "MP3 Standard (128kbps)", "ext": "mp3", "size": m4a_sz})

        direct_preview_url = None
        if info.get('url') and (info.get('ext') == 'mp4' or 'pinimg.com' in str(info.get('url')) or 'twimg.com' in str(info.get('url'))):
            direct_preview_url = info['url']
        elif info.get('formats'):
            mp4_formats = [f for f in info['formats'] if f.get('ext') == 'mp4' and f.get('url') and not str(f.get('protocol', '')).startswith('m3u8')]
            if mp4_formats:
                direct_preview_url = mp4_formats[0].get('url')

        return {
            "title": info.get('title', 'Video Download'),
            "thumbnail": info.get('thumbnail', ''),
            "duration": format_duration(info.get('duration')),
            "author": info.get('uploader') or info.get('channel') or info.get('creator') or 'Creator',
            "platform": platform,
            "formats": formats_list,
            "directUrl": direct_preview_url
        }

    except Exception as e:
        print(f"Resolve error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def download_task(job_id: str, url: str, format_id: str, media_type: str, title: str, platform: str):
    job = jobs[job_id]
    job["status"] = "active"
    job["progress"] = 5

    clean_t = sanitize_name(title)
    ext = "mp3" if media_type == "audio" else "mp4"
    out_template = str(TEMP_DIR / f"{job_id}_{clean_t}.%(ext)s")

    def progress_hook(d):
        if d['status'] == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            downloaded = d.get('downloaded_bytes', 0)
            if total > 0:
                percent = (downloaded / total) * 90
                job["progress"] = round(max(5, min(92, percent)))
        elif d['status'] == 'finished':
            job["progress"] = 96

    ydl_opts = {
        'outtmpl': out_template,
        'quiet': True,
        'no_warnings': True,
        'progress_hooks': [progress_hook],
        'format_sort': ['vcodec:h264', 'acodec:m4a', 'ext:mp4', 'res', 'br'],
    }

    cookie_file = Path("./cookies.txt")
    if cookie_file.exists() and cookie_file.stat().st_size > 0:
        ydl_opts['cookiefile'] = str(cookie_file)

    if media_type == "audio":
        quality = "192"
        if format_id == "mp3-320k":
            quality = "320"
        elif format_id == "mp3-128k":
            quality = "128"
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': quality,
            }],
        })
    else:
        if format_id and format_id != "best":
            if "+" in format_id or format_id.isdigit():
                ydl_opts['format'] = format_id
            else:
                m = re.search(r'(\d+)', str(format_id))
                target_h = int(m.group(1)) if m else 1080
                ydl_opts['format'] = f"bestvideo[height<={target_h}]+bestaudio/best[height<={target_h}]/best"
        else:
            ydl_opts['format'] = 'bestvideo[vcodec^=avc1]+bestaudio/bestvideo+bestaudio/best[vcodec^=avc1]/best'
        ydl_opts['merge_output_format'] = 'mp4'
        ydl_opts['postprocessor_args'] = {
            'ffmpeg': ['-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
        }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        # Find the produced output file
        matches = list(TEMP_DIR.glob(f"{job_id}_*"))
        if not matches:
            raise Exception("Output file was not generated")

        final_file = matches[0]
        # Use clean video title as the download filename (not the UUID)
        dl_ext = final_file.suffix or '.mp4'
        clean_filename = f"{clean_t}{dl_ext}"
        job["status"] = "completed"
        job["progress"] = 100
        job["result"] = {
            "filename": clean_filename,
            "downloadUrl": f"/api/files/{final_file.name}"
        }
    except Exception as e:
        print(f"Download failed: {e}")
        job["status"] = "failed"
        job["error"] = str(e)

@app.post("/api/download")
async def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    if not req.url:
        raise HTTPException(status_code=400, detail="URL is required")

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "result": None,
        "error": None,
        "created_at": time.time()
    }

    background_tasks.add_task(
        download_task,
        job_id,
        req.url,
        req.formatId or "best",
        req.type or "video",
        req.title or "video",
        req.platform or "unknown"
    )

    return {"jobId": job_id}

@app.get("/api/status/{job_id}")
def get_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]

@app.get("/api/files/{filename:path}")
def serve_file(filename: str):
    file_path = TEMP_DIR / filename
    if not file_path.exists():
        matches = list(TEMP_DIR.glob(f"*{filename}*"))
        if matches:
            file_path = matches[0]
        else:
            raise HTTPException(status_code=404, detail="File not found or expired")
    
    clean_display_name = re.sub(r'^[0-9a-fA-F-]{36}_', '', file_path.name)
    ascii_name = re.sub(r'[^\x20-\x7E]', '_', clean_display_name) or 'media_file.mp4'
    encoded_name = urllib.parse.quote(clean_display_name)
    media_type = "audio/mpeg" if file_path.name.endswith(".mp3") else "video/mp4"
    return FileResponse(
        path=file_path,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{encoded_name}'}
    )

@app.get("/api/preview")
async def preview_video(url: str = Query(...)):
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    try:
        ydl_opts = {'skip_download': True, 'quiet': True, 'no_warnings': True}
        cookie_file = Path("./cookies.txt")
        if cookie_file.exists() and cookie_file.stat().st_size > 0:
            ydl_opts['cookiefile'] = str(cookie_file)
        loop = asyncio.get_event_loop()
        def extract():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=False)
        info = await loop.run_in_executor(None, extract)
        if info:
            direct_url = None
            if info.get('url') and (info.get('ext') == 'mp4' or 'pinimg.com' in str(info.get('url')) or 'twimg.com' in str(info.get('url'))):
                direct_url = info['url']
            elif info.get('formats'):
                mp4_formats = [f for f in info['formats'] if f.get('ext') == 'mp4' and f.get('url') and not f.get('protocol', '').startswith('m3u8')]
                if mp4_formats:
                    direct_url = mp4_formats[0].get('url')
            
            if direct_url and ('pinimg.com' in direct_url or 'twimg.com' in direct_url):
                return RedirectResponse(url=direct_url, status_code=307)

        args = ['yt-dlp', '-f', 'best[height<=480][ext=mp4]/best[height<=480]/best', '-o', '-', '--no-playlist', '--quiet']
        if cookie_file.exists() and cookie_file.stat().st_size > 0:
            args.extend(['--cookies', str(cookie_file)])
        args.append(url)
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return StreamingResponse(proc.stdout, media_type="video/mp4")
    except Exception as e:
        args = ['yt-dlp', '-f', 'best[height<=480][ext=mp4]/best[height<=480]/best', '-o', '-', '--no-playlist', '--quiet', url]
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return StreamingResponse(proc.stdout, media_type="video/mp4")

@app.get("/api/thumbnail")
async def proxy_thumbnail(url: str = Query(...)):
    import urllib.request
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
            return StreamingResponse(iter([data]), media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to proxy thumbnail")

# Automatic launcher for Google Colab
def run_in_colab():
    import threading
    from pycloudflared import try_cloudflare
    import uvicorn

    print("\n" + "="*60)
    print("🚀 STARTING CLIPGRAB COLAB WORKER...")
    print("="*60)

    # Clean up any existing background processes on port 8000 or cloudflared
    os.system("fuser -k 8000/tcp > /dev/null 2>&1 || true")
    os.system("pkill -9 -f cloudflared > /dev/null 2>&1 || true")
    time.sleep(1)

    # Start FastAPI server in background thread on port 8000
    config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="warning")
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()
    time.sleep(2)

    # Launch Cloudflare tunnel for free public HTTPS URL
    try:
        tunnel = try_cloudflare(port=8000)
        public_url = getattr(tunnel, 'tunnel', getattr(tunnel, 'url', getattr(tunnel, 'tunnel_url', str(tunnel))))
        print("\n" + "✨"*30)
        print(f"🎉 YOUR CLIPGRAB COLAB BACKEND URL:")
        print(f"👉  {public_url}  👈")
        print("✨"*30)
        print("\nCopy the URL above and paste it into ClipGrab 'Server Settings / Colab' modal!")
        print("Keep this Colab tab open while downloading.\n")
    except Exception as e:
        print(f"Cloudflare tunnel launch note: {e}")
        print("If cloudflare fails, install and use ngrok: ngrok.connect(8000)")

    # Keep alive loop
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Server stopped.")

if __name__ == "__main__":
    if "google.colab" in sys.modules or os.environ.get("COLAB_GPU"):
        run_in_colab()
    else:
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8080)
