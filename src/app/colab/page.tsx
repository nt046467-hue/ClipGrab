"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Navbar } from "@/components/Navbar"
import { Footer } from "@/components/Footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  getStoredApiUrl,
  setCustomApiUrl,
  resetToDefaultApiUrl,
  isCustomApiUrlActive,
  testApiHealth
} from "@/lib/api-config"
import { getQrCodeApiUrl, copyToClipboard, shareEngineUrl } from "@/lib/qr-generator"
import { QrCodeShareModal } from "@/components/QrCodeShareModal"
import {
  Zap,
  Server,
  Cloud,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Terminal,
  QrCode,
  Share2,
  Smartphone,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  HardDrive,
  Cpu,
  DownloadCloud,
  HelpCircle,
  CheckCheck
} from "lucide-react"

const FULL_COLAB_SCRIPT = `!pip install -q fastapi uvicorn yt-dlp pycloudflared pydantic

import os, re, sys, time, uuid, json, asyncio, threading, subprocess, urllib.parse
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
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

@app.get("/")
@app.get("/api/health")
def health():
    return {"status": "healthy", "engine": "Colab Accelerated Worker", "active_jobs": len(jobs)}

@app.get("/api/cookie-status")
def cookies():
    cf = Path("./cookies.txt")
    has_c = cf.exists() and cf.stat().st_size > 0
    return {"checked": True, "valid": has_c, "message": "Colab Cookies Active" if has_c else "Colab Ready"}

@app.post("/api/upload-cookies")
def upload_cookies(req: CookieReq):
    if not req.cookies: raise HTTPException(status_code=400, detail="Cookies required")
    Path("./cookies.txt").write_text(req.cookies, encoding="utf-8")
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
    ydl_opts = {'skip_download': True, 'quiet': True, 'no_warnings': True}
    cf = Path("./cookies.txt")
    if cf.exists() and cf.stat().st_size > 0: ydl_opts['cookiefile'] = str(cf)
    loop = asyncio.get_event_loop()
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = await loop.run_in_executor(None, lambda: ydl.extract_info(req.url, download=False))

    dur = info.get('duration', 0) or 0
    raw_formats = info.get('formats', [])

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
        "author": info.get('uploader') or info.get('channel') or info.get('creator') or 'Creator',
        "platform": detect_platform(req.url),
        "formats": formats,
        "directUrl": d_url
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

    opts = {'outtmpl': out, 'quiet': True, 'no_warnings': True, 'progress_hooks': [hook], 'format_sort': ['vcodec:h264', 'acodec:m4a', 'ext:mp4', 'res', 'br']}
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
                target_h = int(m.group(1)) if m else 1080
                opts['format'] = f"bestvideo[height<={target_h}]+bestaudio/best[height<={target_h}]/best"
        else:
            opts['format'] = 'bestvideo[vcodec^=avc1]+bestaudio/bestvideo+bestaudio/best[vcodec^=avc1]/best'
        opts['merge_output_format'] = 'mp4'
        opts['postprocessor_args'] = {'ffmpeg': ['-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']}

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
    f_path = TEMP_DIR / name
    clean_name = re.sub(r'^[0-9a-fA-F-]{36}_', '', f_path.name)
    asc_name = re.sub(r'[^\x20-\x7E]', '_', clean_name) or 'media.mp4'
    enc_name = urllib.parse.quote(clean_name)
    return FileResponse(f_path, headers={"Content-Disposition": f'attachment; filename="{asc_name}"; filename*=UTF-8\'\'{enc_name}'})

@app.get("/api/preview")
async def preview_video(url: str = Query(...)):
    if not url: raise HTTPException(status_code=400, detail="URL required")
    try:
        opts = {'skip_download': True, 'quiet': True, 'no_warnings': True}
        cf = Path("./cookies.txt")
        if cf.exists() and cf.stat().st_size > 0: opts['cookiefile'] = str(cf)
        loop = asyncio.get_event_loop()
        info = await loop.run_in_executor(None, lambda: yt_dlp.YoutubeDL(opts).extract_info(url, download=False))
        if info:
            d_url = None
            if info.get('url') and (info.get('ext') == 'mp4' or 'pinimg.com' in str(info.get('url')) or 'twimg.com' in str(info.get('url'))):
                d_url = info['url']
            if d_url and ('pinimg.com' in d_url or 'twimg.com' in d_url):
                return RedirectResponse(url=d_url, status_code=307)
        args = ['yt-dlp', '-f', 'best[height<=480][ext=mp4]/best[height<=480]/best', '-o', '-', '--no-playlist', '--quiet']
        if cf.exists() and cf.stat().st_size > 0: args.extend(['--cookies', str(cf)])
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
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
            return StreamingResponse(iter([data]), media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to proxy thumbnail")

# Clean up any existing background processes on port 8000 or cloudflared
os.system("fuser -k 8000/tcp > /dev/null 2>&1 || true")
os.system("pkill -9 -f cloudflared > /dev/null 2>&1 || true")
time.sleep(1)

# Run server + tunnel
threading.Thread(target=lambda: uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning"), daemon=True).start()
time.sleep(2)
tunnel = try_cloudflare(port=8000)
print("\\n" + "="*50)
print(f"🎉 YOUR CLIPGRAB COLAB URL:\\n👉 {tunnel.tunnel} 👈")
print("="*50 + "\\nCopy this URL into ClipGrab Server Settings!\\n")
`

export default function ColabGuidePage() {
  const [activeUrl, setActiveUrl] = useState("")
  const [isColab, setIsColab] = useState(false)
  const [inputUrl, setInputUrl] = useState("")
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; latency: number; message: string } | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const current = getStoredApiUrl()
    const custom = isCustomApiUrlActive()
    setActiveUrl(current)
    setIsColab(custom)
    setInputUrl(custom ? current : "")
  }, [])

  const handleTest = async () => {
    if (!inputUrl) return
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await testApiHealth(inputUrl)
      setTestResult(res)
      if (res.success) {
        toast({
          title: "Connected Successfully! ⚡",
          description: `Latency: ${res.latency}ms. Engine is healthy.`
        })
      } else {
        toast({
          variant: "destructive",
          title: "Connection Failed",
          description: res.message
        })
      }
    } finally {
      setIsTesting(false)
    }
  }

  const handleSave = () => {
    if (!inputUrl.trim()) return
    let clean = inputUrl.trim().replace(/\/+$/, "")
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = `https://${clean}`
    }
    setCustomApiUrl(clean)
    setActiveUrl(clean)
    setIsColab(true)
    toast({
      title: "Colab Engine Activated! 🚀",
      description: `Active backend: ${clean}`
    })
    handleTest()
  }

  const handleReset = () => {
    resetToDefaultApiUrl()
    const def = getStoredApiUrl()
    setActiveUrl(def)
    setIsColab(false)
    setInputUrl("")
    setTestResult(null)
    toast({
      title: "Reset to Default Cloud Engine",
      description: "Default server restored."
    })
  }

  const copyScript = async () => {
    const success = await copyToClipboard(FULL_COLAB_SCRIPT)
    if (success) {
      setCopiedCode(true)
      toast({
        title: "Copied Python Script! 📋",
        description: "Paste into a Google Colab cell and press Run."
      })
      setTimeout(() => setCopiedCode(false), 2500)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground relative overflow-hidden selection:bg-amber-500 selection:text-black">
      {/* Background glow effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-amber-500/10 blur-[180px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[180px] pointer-events-none" />

      <Navbar />

      <main className="flex-grow pt-28 sm:pt-36 pb-20 px-4 sm:px-6 relative z-10 max-w-5xl mx-auto w-full space-y-12">
        
        {/* Navigation & Breadcrumb */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="sm:hidden shrink-0 text-brand-text-muted hover:text-white rounded-xl hover:bg-white/5"
          >
            <Link href="/">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            className="hidden sm:inline-flex w-auto justify-start text-xs font-bold text-brand-text-muted hover:text-white rounded-xl gap-2 hover:bg-white/5"
          >
            <Link href="/">
              <ArrowLeft className="w-4 h-4 shrink-0" /> Back to Media Downloader
            </Link>
          </Button>

          <Button
            onClick={() => setQrModalOpen(true)}
            variant="outline"
            className="w-full sm:w-auto justify-center text-xs font-bold border-amber-500/30 text-amber-300 hover:bg-amber-500/10 rounded-xl gap-2"
          >
            <QrCode className="w-4 h-4 text-amber-400 shrink-0" /> Share Engine (QR Code)
          </Button>
        </div>

        {/* Hero Banner */}
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold uppercase tracking-wider">
            <Zap className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span>High-Speed Accelerated Worker Guide</span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-headline font-black text-white leading-tight">
            Run Unlimited Downloads <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-400 via-orange-400 to-primary">
              With Google Colab.
            </span>
          </h1>

          <p className="text-brand-text-muted text-sm sm:text-base leading-relaxed">
            Bypass free-tier Render delays, queue waits, and YouTube IP rate-limits by spinning up your own free backend engine on Google Colab in under 30 seconds.
          </p>
        </div>

        {/* Live Active Server Box */}
        <Card className="bg-brand-surface/70 border border-brand-border backdrop-blur-xl rounded-2xl shadow-xl overflow-hidden">
          <CardContent className="p-6 sm:p-8 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                  <Server className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-white flex flex-wrap items-center gap-2">
                    Active Backend Status
                    <Badge
                      className={`text-[10px] font-bold shrink-0 ${
                        isColab ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-primary/20 text-primary border-primary/30"
                      }`}
                    >
                      {isColab ? "⚡ Colab Active" : "☁️ Default Cloud"}
                    </Badge>
                  </h3>
                  <p className="font-mono text-xs text-brand-text-muted truncate max-w-full sm:max-w-md mt-0.5">
                    {activeUrl}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => setQrModalOpen(true)}
                  variant="outline"
                  className="h-11 px-4 text-xs font-bold border-white/10 rounded-xl hover:bg-white/5 gap-1.5"
                >
                  <QrCode className="w-4 h-4 text-amber-400" />
                  QR Code
                </Button>

                <Button
                  onClick={handleReset}
                  variant="ghost"
                  className="h-11 text-xs text-brand-text-muted hover:text-white rounded-xl"
                >
                  Reset Default
                </Button>
              </div>
            </div>

            {/* Quick URL Input Bar */}
            <div className="pt-2 border-t border-white/[0.06] space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-brand-text-muted">
                Paste Colab / Tunnel URL
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <Input
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="https://xxxx.trycloudflare.com"
                  className="bg-black/50 border-white/10 text-xs sm:text-sm h-11 sm:h-12 rounded-xl font-mono text-white placeholder:text-white/20 flex-1 focus-visible:ring-amber-400"
                />
                <div className="flex flex-col xs:flex-row gap-2">
                  <Button
                    onClick={handleTest}
                    disabled={isTesting || !inputUrl}
                    variant="outline"
                    className="w-full sm:w-auto h-11 sm:h-12 px-4 sm:px-5 rounded-xl text-xs font-bold border-white/10 hover:bg-white/5 gap-1.5"
                  >
                    {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Test Ping
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={!inputUrl.trim()}
                    className="w-full sm:w-auto h-11 sm:h-12 px-5 sm:px-6 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-black gap-1.5 shadow-lg shadow-amber-500/20"
                  >
                    <Zap className="w-4 h-4 fill-black" />
                    Save & Activate
                  </Button>
                </div>
              </div>
            </div>

            {/* Ping result */}
            {testResult && (
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between text-xs animate-in fade-in ${
                  testResult.success
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-red-500/10 border-red-500/30 text-red-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
                {testResult.success && (
                  <Badge className="bg-emerald-500/20 text-emerald-200 border-0 font-mono text-[10px]">
                    {testResult.latency}ms
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3 Step Interactive Visual Guide */}
        <div className="space-y-6">
          <div className="text-center sm:text-left space-y-1">
            <h2 className="text-2xl font-headline font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400 fill-amber-400" /> 3-Step Setup Instructions
            </h2>
            <p className="text-xs text-brand-text-muted">
              Follow these simple steps on any PC, Mac, or phone browser:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* Step 1 */}
            <Card className="bg-brand-surface/40 border border-brand-border rounded-2xl overflow-hidden hover:border-amber-500/30 transition-all">
              <CardContent className="p-6 space-y-3">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 font-bold text-sm flex items-center justify-center">
                  1
                </div>
                <h3 className="text-base font-bold text-white">Open Google Colab</h3>
                <p className="text-xs text-brand-text-muted leading-relaxed">
                  Go to <a href="https://colab.research.google.com" target="_blank" rel="noopener noreferrer" className="text-primary underline font-bold inline-flex items-center gap-0.5">colab.research.google.com <ExternalLink className="w-3 h-3" /></a> and create a New Notebook (or open your existing notebook).
                </p>
                <div className="pt-2">
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="w-full text-xs font-bold border-white/10 rounded-xl gap-1.5"
                  >
                    <a href="https://colab.research.google.com" target="_blank" rel="noopener noreferrer">
                      Open Colab <ExternalLink className="w-3 h-3" />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Step 2 */}
            <Card className="bg-brand-surface/40 border border-brand-border rounded-2xl overflow-hidden hover:border-amber-500/30 transition-all">
              <CardContent className="p-6 space-y-3">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 font-bold text-sm flex items-center justify-center">
                  2
                </div>
                <h3 className="text-base font-bold text-white">Paste & Run Code</h3>
                <p className="text-xs text-brand-text-muted leading-relaxed">
                  Click the <strong>Copy Python Code</strong> button below, paste it into the Colab cell, and click the <strong>▶️ Play button</strong> to start the worker.
                </p>
                <div className="pt-2">
                  <Button
                    onClick={copyScript}
                    size="sm"
                    className="w-full text-xs font-bold bg-amber-500 hover:bg-amber-600 text-black rounded-xl gap-1.5"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCode ? "Copied to Clipboard!" : "Copy Python Code"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Step 3 */}
            <Card className="bg-brand-surface/40 border border-brand-border rounded-2xl overflow-hidden hover:border-amber-500/30 transition-all">
              <CardContent className="p-6 space-y-3">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 font-bold text-sm flex items-center justify-center">
                  3
                </div>
                <h3 className="text-base font-bold text-white">Connect & Share</h3>
                <p className="text-xs text-brand-text-muted leading-relaxed">
                  Copy the generated <code className="text-amber-300 font-mono">trycloudflare.com</code> URL printed in Colab, paste it here, and scan the QR code to use on your phone!
                </p>
                <div className="pt-2">
                  <Button
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    size="sm"
                    variant="secondary"
                    className="w-full text-xs font-bold rounded-xl gap-1.5"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    Enter URL Above
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Python Code Snippet Box */}
        <Card className="bg-black/60 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-4 sm:p-5 bg-white/[0.02] border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-amber-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Colab Backend Script (Python + FastAPI)</h3>
                <p className="text-[11px] text-brand-text-muted">Includes automatic Cloudflare Tunnel for HTTPS public URL</p>
              </div>
            </div>

            <Button
              onClick={copyScript}
              className="h-10 px-5 bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs rounded-xl gap-1.5 shadow-lg shadow-amber-500/20 shrink-0"
            >
              {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedCode ? "Copied to Clipboard!" : "Copy Python Code"}
            </Button>
          </div>

          <div className="p-4 sm:p-6">
            <pre className="text-xs font-mono text-white/80 max-h-96 overflow-y-auto leading-relaxed select-all whitespace-pre bg-black/40 p-4 rounded-xl border border-white/[0.04]">
              {FULL_COLAB_SCRIPT}
            </pre>
          </div>
        </Card>

        {/* FAQ & Pro Tips */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-brand-surface/30 border border-brand-border rounded-2xl p-6 space-y-2.5">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Cpu className="w-4 h-4 text-primary" /> Do I need a GPU on Google Colab?
            </h4>
            <p className="text-xs text-brand-text-muted leading-relaxed">
              No! A standard free <strong>CPU runtime</strong> on Google Colab is more than enough and provides lightning fast 1 Gbps download speeds and instant FFmpeg audio/video transmuxing.
            </p>
          </Card>

          <Card className="bg-brand-surface/30 border border-brand-border rounded-2xl p-6 space-y-2.5">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-emerald-400" /> How do I use it on my Phone?
            </h4>
            <p className="text-xs text-brand-text-muted leading-relaxed">
              Click <strong>Share Engine (QR Code)</strong> button at the top, and scan the QR code with your iPhone or Android camera! It will auto-connect your phone to your Colab worker instantly.
            </p>
          </Card>
        </div>

      </main>

      {/* QR Code Share Modal */}
      <QrCodeShareModal
        open={qrModalOpen}
        onOpenChange={setQrModalOpen}
        engineUrl={activeUrl}
        isColab={isColab}
      />

      <Footer />
    </div>
  )
}
