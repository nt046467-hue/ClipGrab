"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  getStoredApiUrl,
  setCustomApiUrl,
  resetToDefaultApiUrl,
  isCustomApiUrlActive,
  getDefaultApiUrl,
  testApiHealth
} from "@/lib/api-config"
import { copyToClipboard, getQrCodeApiUrl, shareEngineUrl } from "@/lib/qr-generator"
import Link from "next/link"
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
  QrCode,
  Share2,
  Terminal,
  Play,
  Cpu,
  Layers,
  Wifi,
  ShieldCheck,
  ArrowRight
} from "lucide-react"

interface ServerSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

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

export function ServerSettingsModal({ open, onOpenChange }: ServerSettingsModalProps) {
  const [customUrlInput, setCustomUrlInput] = useState("")
  const [activeUrl, setActiveUrl] = useState("")
  const [isCustom, setIsCustom] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; latency: number; message: string } | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedShareLink, setCopiedShareLink] = useState(false)
  const [shareUrl, setShareUrl] = useState("")
  const { toast } = useToast()

  useEffect(() => {
    if (open) {
      const current = getStoredApiUrl()
      const customActive = isCustomApiUrlActive()
      setActiveUrl(current)
      setIsCustom(customActive)
      setCustomUrlInput(customActive ? current : "")
      setTestResult(null)

      if (typeof window !== "undefined") {
        const origin = window.location.origin
        const directShare = customActive
          ? `${origin}/?engine=${encodeURIComponent(current)}`
          : origin
        setShareUrl(directShare)
      }
    }
  }, [open])

  const handleTestConnection = async (urlToTest?: string) => {
    const target = urlToTest || customUrlInput || activeUrl
    if (!target) {
      toast({
        variant: "destructive",
        title: "No URL provided",
        description: "Please enter a backend server URL to test."
      })
      return
    }

    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await testApiHealth(target)
      setTestResult(res)
      if (res.success) {
        toast({
          title: "Engine Online & Healthy! ⚡",
          description: `Backend responded in ${res.latency}ms.`
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

  const handleApplyCustomUrl = async () => {
    if (!customUrlInput.trim()) {
      toast({
        variant: "destructive",
        title: "URL is empty",
        description: "Please enter a valid URL or reset to default."
      })
      return
    }

    let urlToSave = customUrlInput.trim().replace(/\/+$/, "")
    if (!urlToSave.startsWith("http://") && !urlToSave.startsWith("https://")) {
      urlToSave = `https://${urlToSave}`
    }

    setCustomApiUrl(urlToSave)
    setActiveUrl(urlToSave)
    setIsCustom(true)

    if (typeof window !== "undefined") {
      setShareUrl(`${window.location.origin}/?engine=${encodeURIComponent(urlToSave)}`)
    }

    toast({
      title: "Colab Fast Engine Connected! ⚡",
      description: `All media conversions are now routed through: ${urlToSave}`
    })

    handleTestConnection(urlToSave)
  }

  const handleResetDefault = () => {
    resetToDefaultApiUrl()
    const def = getDefaultApiUrl()
    setActiveUrl(def)
    setIsCustom(false)
    setCustomUrlInput("")
    setTestResult(null)
    if (typeof window !== "undefined") {
      setShareUrl(window.location.origin)
    }
    toast({
      title: "Reset to Default Cloud",
      description: `Using primary cloud engine: ${def}`
    })
  }

  const copyColabCode = async () => {
    const success = await copyToClipboard(FULL_COLAB_SCRIPT)
    if (success) {
      setCopiedCode(true)
      toast({
        title: "Copied 1-Click Python Code! 📋",
        description: "Paste into your Google Colab cell and press Play."
      })
      setTimeout(() => setCopiedCode(false), 3000)
    }
  }

  const handleCopyShareLink = async () => {
    const success = await copyToClipboard(shareUrl)
    if (success) {
      setCopiedShareLink(true)
      toast({
        title: "Share Link Copied! 🔗",
        description: "Open this link on any phone or browser to auto-connect."
      })
      setTimeout(() => setCopiedShareLink(false), 3000)
    }
  }

  const handleNativeShare = async () => {
    const res = await shareEngineUrl("ClipGrab Engine Sync", shareUrl)
    if (res === "copied") {
      setCopiedShareLink(true)
      toast({
        title: "Link Copied to Clipboard!",
        description: shareUrl
      })
      setTimeout(() => setCopiedShareLink(false), 3000)
    }
  }

  const qrImageUrl = shareUrl ? getQrCodeApiUrl(shareUrl, 260) : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:w-[90vw] md:w-full md:max-w-3xl max-h-[88vh] sm:max-h-[90vh] overflow-y-auto overflow-x-hidden bg-brand-surface/95 backdrop-blur-2xl border border-white/10 text-white shadow-2xl p-0 rounded-2xl sm:rounded-[2rem] min-w-0 box-border">
        
        {/* Modal Header */}
        <div className="px-4 py-4 sm:px-7 sm:pt-6 sm:pb-4 border-b border-white/[0.06] bg-gradient-to-r from-primary/10 via-transparent to-amber-500/10 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 min-w-0">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl border flex items-center justify-center shrink-0 ${
                isCustom 
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]" 
                  : "bg-primary/20 border-primary/40 text-primary"
              }`}>
                {isCustom ? <Zap className="w-4 h-4 sm:w-5 sm:h-5 fill-amber-400 text-amber-400" /> : <Cloud className="w-4 h-4 sm:w-5 sm:h-5" />}
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-sm sm:text-lg font-headline font-black text-white flex items-center gap-1.5 sm:gap-2 truncate">
                  <span>Backend Engine & Colab Center</span>
                </DialogTitle>
                <DialogDescription className="text-[11px] sm:text-xs text-brand-text-muted truncate">
                  Accelerate downloads up to 100MB/s with free Google Colab or use Default Cloud
                </DialogDescription>
              </div>
            </div>

            <Badge
              variant="outline"
              className={`text-[11px] sm:text-xs px-2.5 sm:px-3 py-0.5 sm:py-1 font-bold w-fit shrink-0 ${
                isCustom
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                  : "bg-primary/15 text-primary border-primary/30"
              }`}
            >
              {isCustom ? "⚡ Colab Fast Engine" : "☁️ Default Cloud"}
            </Badge>
          </div>
        </div>

        {/* Modal Tabs */}
        <Tabs defaultValue="colab" className="w-full min-w-0 overflow-hidden">
          <div className="px-3.5 sm:px-7 pt-3 sm:pt-4 min-w-0">
            <TabsList className="bg-black/40 border border-white/[0.08] p-1 rounded-xl w-full grid grid-cols-3 gap-1 min-w-0">
              <TabsTrigger
                value="colab"
                className="rounded-lg text-[10px] xs:text-[11px] sm:text-xs font-bold py-1.5 sm:py-2 data-[state=active]:bg-amber-500 data-[state=active]:text-black gap-1 sm:gap-1.5 transition-all truncate min-w-0"
              >
                <Zap className="w-3 sm:w-3.5 h-3 sm:h-3.5 fill-current shrink-0" />
                <span className="truncate">Colab<span className="hidden xs:inline"> Fast</span></span>
              </TabsTrigger>
              <TabsTrigger
                value="connect"
                className="rounded-lg text-[10px] xs:text-[11px] sm:text-xs font-bold py-1.5 sm:py-2 data-[state=active]:bg-primary data-[state=active]:text-white gap-1 sm:gap-1.5 transition-all truncate min-w-0"
              >
                <Server className="w-3 sm:w-3.5 h-3 sm:h-3.5 shrink-0" />
                <span className="truncate">URL<span className="hidden xs:inline"> & Status</span></span>
              </TabsTrigger>
              <TabsTrigger
                value="qr"
                className="rounded-lg text-[10px] xs:text-[11px] sm:text-xs font-bold py-1.5 sm:py-2 data-[state=active]:bg-indigo-600 data-[state=active]:text-white gap-1 sm:gap-1.5 transition-all truncate min-w-0"
              >
                <QrCode className="w-3 sm:w-3.5 h-3 sm:h-3.5 shrink-0" />
                <span className="truncate">Device<span className="hidden xs:inline"> Sync</span></span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* TAB 1: 1-CLICK COLAB ENGINE & FULL STEP GUIDE */}
          <TabsContent value="colab" className="p-3.5 sm:p-7 space-y-4 sm:space-y-5 focus-visible:outline-none">
            
            {/* Quick 3-Step Action Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
              
              {/* Step 1 */}
              <div className="bg-white/[0.02] border border-white/[0.08] hover:border-amber-500/30 p-3 sm:p-3.5 rounded-2xl space-y-2 transition-all flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-amber-500/20 text-amber-300 font-black text-[11px] sm:text-xs flex items-center justify-center">
                      1
                    </span>
                    <Badge variant="outline" className="text-[9px] sm:text-[10px] text-brand-text-muted border-white/10 px-1.5 py-0">Free & Fast</Badge>
                  </div>
                  <h5 className="text-xs font-bold text-white">Open Google Colab</h5>
                  <p className="text-[10.5px] sm:text-[11px] text-brand-text-muted leading-relaxed">
                    Open a new Python notebook in Google Colab (free).
                  </p>
                </div>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="w-full h-9 sm:h-8 text-[11px] sm:text-xs font-bold border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 text-amber-300 rounded-xl gap-1.5 mt-2"
                >
                  <a href="https://colab.research.google.com" target="_blank" rel="noopener noreferrer">
                    Open Colab <ExternalLink className="w-3 h-3" />
                  </a>
                </Button>
              </div>

              {/* Step 2 */}
              <div className="bg-white/[0.02] border border-white/[0.08] hover:border-amber-500/30 p-3 sm:p-3.5 rounded-2xl space-y-2 transition-all flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-amber-500/20 text-amber-300 font-black text-[11px] sm:text-xs flex items-center justify-center">
                      2
                    </span>
                    <Badge variant="outline" className="text-[9px] sm:text-[10px] text-emerald-400/80 border-emerald-500/20 px-1.5 py-0">1-Click Script</Badge>
                  </div>
                  <h5 className="text-xs font-bold text-white">Copy & Run Script</h5>
                  <p className="text-[10.5px] sm:text-[11px] text-brand-text-muted leading-relaxed">
                    Paste code into notebook and click <strong>Play</strong>.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={copyColabCode}
                  className="w-full h-9 sm:h-8 text-[11px] sm:text-xs font-bold bg-amber-500 hover:bg-amber-600 text-black rounded-xl gap-1.5 mt-2"
                >
                  {copiedCode ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedCode ? "Copied!" : "Copy Python Code"}
                </Button>
              </div>

              {/* Step 3 */}
              <div className="bg-white/[0.02] border border-white/[0.08] hover:border-amber-500/30 p-3 sm:p-3.5 rounded-2xl space-y-2 transition-all flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-amber-500/20 text-amber-300 font-black text-[11px] sm:text-xs flex items-center justify-center">
                      3
                    </span>
                    <Badge variant="outline" className="text-[9px] sm:text-[10px] text-cyan-400/80 border-cyan-500/20 px-1.5 py-0">Instant URL</Badge>
                  </div>
                  <h5 className="text-xs font-bold text-white">Paste URL Below</h5>
                  <p className="text-[10.5px] sm:text-[11px] text-brand-text-muted leading-relaxed">
                    Copy the <code className="text-amber-300">trycloudflare.com</code> URL and Connect.
                  </p>
                </div>
                <div className="text-[10.5px] font-mono text-emerald-400/90 bg-black/40 px-2 py-1.5 rounded border border-white/5 text-center mt-2 truncate">
                  👉 trycloudflare.com
                </div>
              </div>

            </div>

            {/* Code Snippet Box */}
            <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-3 sm:p-3.5 space-y-2 overflow-hidden">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.06] text-xs">
                <span className="font-mono text-[10.5px] sm:text-[11px] text-brand-text-muted flex items-center gap-1.5 truncate">
                  <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">colab_worker.py<span className="hidden sm:inline"> (FastAPI + yt-dlp)</span></span>
                </span>
                <Button
                  onClick={copyColabCode}
                  size="sm"
                  variant="ghost"
                  className="h-8 sm:h-7 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold bg-white/5 hover:bg-white/10 text-white rounded-lg gap-1.5 shrink-0"
                >
                  {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCode ? "Copied!" : "Copy Code"}</span>
                </Button>
              </div>

              <pre className="text-[10px] sm:text-[10.5px] font-mono text-white/80 max-h-28 sm:max-h-40 overflow-y-auto overflow-x-auto leading-relaxed whitespace-pre-wrap break-all select-all p-2 bg-black/40 rounded-lg border border-white/[0.03]">
                {FULL_COLAB_SCRIPT}
              </pre>
            </div>

            {/* Direct Connect Quick Input on Colab Tab */}
            <div className="space-y-2 pt-1">
              <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-brand-text-muted flex flex-col sm:flex-row sm:items-center justify-between gap-0.5">
                <span>Enter Your Colab Cloudflare URL:</span>
                <span className="text-[10px] text-amber-400 font-mono">e.g. https://xxx.trycloudflare.com</span>
              </label>
              <div className="flex flex-col gap-2">
                <Input
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  placeholder="https://xxx.trycloudflare.com"
                  className="bg-black/40 border-white/10 text-xs sm:text-sm h-12 rounded-xl placeholder:text-white/20 font-mono text-white w-full focus-visible:ring-1 focus-visible:ring-amber-400"
                />
                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  <Button
                    type="button"
                    onClick={() => handleTestConnection(customUrlInput)}
                    disabled={isTesting || !customUrlInput}
                    variant="outline"
                    className="h-11 sm:h-12 rounded-xl border-white/10 text-xs font-bold hover:bg-white/5 gap-1.5 flex-1 active:scale-[0.98] transition-transform"
                  >
                    {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Test Ping
                  </Button>
                  <Button
                    type="button"
                    onClick={handleApplyCustomUrl}
                    disabled={!customUrlInput.trim()}
                    className="h-11 sm:h-12 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-xl text-xs gap-1.5 flex-1 active:scale-[0.98] transition-transform shadow-lg shadow-amber-500/20"
                  >
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    Connect Colab Fast Engine
                  </Button>
                </div>
              </div>

              {/* Live Connection Feedback on Tab 1 */}
              {isTesting && (
                <div className="p-3 rounded-xl border bg-amber-500/10 border-amber-500/30 text-amber-300 flex items-center gap-2.5 text-xs animate-pulse">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                  <span>Connecting to Colab worker & testing health endpoint...</span>
                </div>
              )}

              {!isTesting && testResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs animate-in fade-in duration-300 ${
                    testResult.success
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-red-500/15 border-red-500/40 text-red-300"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {testResult.success ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs">
                          {testResult.success ? "🎉 Colab Engine Connected & Online!" : "⚠️ Connection Failed"}
                        </span>
                        {testResult.success && (
                          <Badge className="bg-emerald-500/25 text-emerald-200 border-0 font-mono text-[10px]">
                            {testResult.latency}ms
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed opacity-90 break-words">
                        {testResult.message}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Colab Info Footer */}
            <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-center justify-between text-xs">
              <span className="text-amber-300/90 font-medium">⚡ Colab provides unlimited downloads with no Render cold-starts</span>
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 gap-1"
              >
                <Link href="/colab">
                  Full Guide <ArrowRight className="w-3 h-3" />
                </Link>
              </Button>
            </div>

          </TabsContent>

          {/* TAB 2: MANUAL URL & ADVANCED STATUS */}
          <TabsContent value="connect" className="p-3.5 sm:p-7 space-y-4 sm:space-y-5 focus-visible:outline-none">
            
            {/* Active Status Card */}
            <div className="bg-black/40 border border-white/[0.08] p-3.5 sm:p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-brand-text-muted">Active Engine Route</span>
                <Badge
                  className={`text-[10px] font-bold ${
                    isCustom 
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/30" 
                      : "bg-primary/20 text-primary border-primary/30"
                  }`}
                >
                  {isCustom ? "Accelerated Custom Node" : "Default Render Cloud"}
                </Badge>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 sm:p-3 bg-black/60 rounded-xl border border-white/[0.04]">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isCustom ? "bg-amber-400 shadow-[0_0_8px_#f59e0b]" : "bg-emerald-400 shadow-[0_0_8px_#10b981]"}`} />
                  <span className="font-mono text-xs text-white truncate">{activeUrl}</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleTestConnection(activeUrl)}
                  disabled={isTesting}
                  className="h-8 px-3 text-xs font-bold hover:bg-white/10 rounded-lg gap-1.5 text-brand-text-muted hover:text-white shrink-0 w-full sm:w-auto"
                >
                  {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Ping Engine
                </Button>
              </div>
            </div>

            {/* URL Input & Test */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-brand-text-muted flex flex-col sm:flex-row sm:items-center justify-between gap-0.5">
                <span>Configure Custom Backend URL</span>
                <span className="text-[10px] text-brand-text-muted/60">Cloudflare / Ngrok / Localhost</span>
              </label>
              <div className="flex flex-col gap-2">
                <Input
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  placeholder="https://xxx.trycloudflare.com"
                  className="bg-black/40 border-white/10 text-xs sm:text-sm h-12 rounded-xl placeholder:text-white/20 font-mono text-white w-full focus-visible:ring-1 focus-visible:ring-primary"
                />
                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  <Button
                    type="button"
                    onClick={() => handleTestConnection(customUrlInput)}
                    disabled={isTesting || !customUrlInput}
                    variant="outline"
                    className="h-11 sm:h-12 rounded-xl border-white/10 text-xs font-bold hover:bg-white/5 gap-1.5 flex-1 active:scale-[0.98] transition-transform"
                  >
                    {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Test Ping
                  </Button>
                  <Button
                    type="button"
                    onClick={handleApplyCustomUrl}
                    disabled={!customUrlInput.trim()}
                    className="h-11 sm:h-12 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl text-xs gap-1.5 flex-1 active:scale-[0.98] transition-transform"
                  >
                    Save & Use
                  </Button>
                </div>
              </div>
            </div>

            {/* Test Result Message */}
            {testResult && (
              <div
                className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center gap-2 text-xs animate-in fade-in duration-300 ${
                  testResult.success
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-red-500/10 border-red-500/30 text-red-300"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <span className="leading-snug break-words">{testResult.message}</span>
                </div>
                {testResult.success && (
                  <Badge className="bg-emerald-500/20 text-emerald-200 border-0 font-mono text-[10px] shrink-0 w-fit">
                    {testResult.latency}ms
                  </Badge>
                )}
              </div>
            )}

            {/* Reset to Default Button */}
            <div className="pt-2 flex flex-col-reverse sm:flex-row justify-between items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleResetDefault}
                className="text-xs text-brand-text-muted hover:text-white rounded-xl h-10 hover:bg-white/5 w-full sm:w-auto"
              >
                Reset to Default Cloud
              </Button>

              <div className="flex items-center gap-2 text-[11px] text-brand-text-muted/60">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Encrypted HTTPS</span>
              </div>
            </div>

          </TabsContent>

          {/* TAB 3: MULTI-DEVICE QR SYNC */}
          <TabsContent value="qr" className="p-3.5 sm:p-7 space-y-4 sm:space-y-5 focus-visible:outline-none overflow-x-hidden">
            
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 bg-black/40 border border-white/[0.08] p-3.5 sm:p-5 rounded-2xl">
              
              {/* QR Image Box */}
              <div className="bg-white p-3 sm:p-3.5 rounded-2xl shadow-xl flex items-center justify-center shrink-0 w-44 h-44 sm:w-48 sm:h-48 border-2 border-white/20">
                {qrImageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={qrImageUrl}
                    alt="Engine QR Code"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  </div>
                )}
              </div>

              {/* Instructions & Share Actions */}
              <div className="space-y-3 flex-1 text-center sm:text-left min-w-0 w-full">
                <div className="space-y-1">
                  <h4 className="text-sm sm:text-base font-bold text-white flex items-center justify-center sm:justify-start gap-1.5">
                    <QrCode className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Scan with Phone Camera</span>
                  </h4>
                  <p className="text-xs text-brand-text-muted leading-relaxed">
                    Point your iPhone or Android camera at the QR code to open ClipGrab with your active backend engine auto-connected!
                  </p>
                </div>

                <div className="bg-black/30 p-2.5 rounded-xl border border-white/[0.04] text-[10.5px] sm:text-[11px] font-mono text-white/90 break-all w-full max-w-full overflow-hidden select-all leading-relaxed">
                  {shareUrl}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1 w-full">
                  <Button
                    type="button"
                    onClick={handleCopyShareLink}
                    variant="outline"
                    className="w-full sm:flex-1 h-11 sm:h-10 text-xs font-bold border-white/10 hover:bg-white/10 text-white rounded-xl gap-1.5 active:scale-[0.98] transition-transform"
                  >
                    {copiedShareLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedShareLink ? "Link Copied!" : "Copy Share URL"}</span>
                  </Button>

                  <Button
                    type="button"
                    onClick={handleNativeShare}
                    className="w-full sm:flex-1 h-11 sm:h-10 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl gap-1.5 shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-transform"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share Sheet</span>
                  </Button>
                </div>
              </div>

            </div>

            <div className="flex items-center gap-2 text-xs text-brand-text-muted/70 justify-center text-center px-2">
              <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Works seamlessly across iPhone, Android, iPad, Mac, and Windows</span>
            </div>

          </TabsContent>
        </Tabs>

      </DialogContent>
    </Dialog>
  )
}
