"use client"

import { useState, useEffect } from "react"
import { Navbar } from "@/components/Navbar"
import { Footer } from "@/components/Footer"
import { PlatformIcon, Platform } from "@/components/PlatformIcon"
import { detectPlatform } from "@/lib/platform-detect"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Loader2, Download, Music, ShieldCheck, Zap, X,
  ClipboardPaste, ArrowRight, Activity, AlertTriangle,
  UploadCloud, CheckCircle2, RotateCcw, HelpCircle, FileVideo,
  ExternalLink
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { ChatAssistant } from "@/components/ChatAssistant"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080"

interface VideoFormat {
  id: string
  type: "video" | "audio"
  quality: string
  ext: string
  size: string
}

interface VideoMetadata {
  title: string
  thumbnail: string
  duration: string
  author: string
  platform: Platform
  formats: VideoFormat[]
}

export default function Home() {
  const [url, setUrl] = useState("")
  const [platform, setPlatform] = useState<Platform>("unknown")
  const [isLoading, setIsLoading] = useState(false)
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [downloadingJob, setDownloadingJob] = useState<{ id: string, progress: number, status: string, result?: { filename: string, downloadUrl: string }, error?: string } | null>(null)
  const [hasThumbnailError, setHasThumbnailError] = useState(false)
  const [showCookieAuth, setShowCookieAuth] = useState(false)
  const [cookieText, setCookieText] = useState("")
  const [isSavingCookies, setIsSavingCookies] = useState(false)
  const [previewBuffering, setPreviewBuffering] = useState(true)
  const [cookieStatus, setCookieStatus] = useState<{ checked: boolean, valid: boolean, message?: string }>({ checked: false, valid: true })
  const { toast } = useToast()

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
    }
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/api/cookie-status`)
      .then(res => res.json())
      .then(data => setCookieStatus({ checked: true, valid: data.valid, message: data.message }))
      .catch(() => setCookieStatus({ checked: true, valid: true })) // fail silent — don't block UI if the check itself errors
  }, [])

  useEffect(() => {
    setPlatform(detectPlatform(url))
  }, [url])

  const handleResolve = async (customUrl?: string) => {
    const targetUrl = customUrl || url
    if (!targetUrl) return
    setIsLoading(true)
    setMetadata(null)
    setHasThumbnailError(false)
    setShowCookieAuth(false)

    try {
      const response = await fetch(`${API_URL}/api/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        // If it's a rate-limiting, IP block, or bot check error, reveal the cookie upload panel
        const errMessage = data.error || 'Failed to resolve URL'
        const lowerMsg = errMessage.toLowerCase()
        if (
          lowerMsg.includes("429") ||
          lowerMsg.includes("rate-limiting") ||
          lowerMsg.includes("rate limit") ||
          lowerMsg.includes("sign in") ||
          lowerMsg.includes("bot") ||
          lowerMsg.includes("blocked") ||
          lowerMsg.includes("ip address") ||
          lowerMsg.includes("forbidden") ||
          lowerMsg.includes("403")
        ) {
          setShowCookieAuth(true)
        }
        throw new Error(errMessage);
      }

      setMetadata(data)
    } catch (err: any) {
      console.error("Resolve error:", err);
      toast({
        variant: "destructive",
        title: "Resolution Failed",
        description: err.message || "Failed to retrieve video metadata"
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownload = async (format: VideoFormat) => {
    if (!metadata) return

    try {
      const response = await fetch(`${API_URL}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          formatId: format.id,
          type: format.type,
          title: metadata.title,
          platform: metadata.platform
        })
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || errData.message || 'Download task initialization failed')
      }

      const { jobId } = await response.json()
      setDownloadingJob({ id: jobId, progress: 0, status: 'queued' })
      startPolling(jobId)
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Download Task Failed",
        description: err.message
      })
    }
  }

  const startPolling = (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/api/status/${jobId}`)
        if (!response.ok) {
          throw new Error("Failed to poll server status")
        }
        const data = await response.json()

        setDownloadingJob(prev => {
          if (!prev) return null
          return {
            ...prev,
            progress: data.progress || 0,
            status: data.status,
            result: data.result,
            error: data.error
          }
        })

        if (data.status === 'completed') {
          clearInterval(interval)

          // Auto trigger file save using iframe or hidden anchor (non-blocking)
          try {
            const rawUrl = data.result.downloadUrl
            const downloadLink = rawUrl.startsWith('http') ? rawUrl : `${API_URL}${rawUrl}`
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
            const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

            if (isIOS || isSafari) {
              window.open(downloadLink, '_blank');
            } else {
              const tempAnchor = document.createElement('a')
              tempAnchor.href = downloadLink
              tempAnchor.setAttribute('download', data.result.filename || '')
              document.body.appendChild(tempAnchor)
              tempAnchor.click()
              document.body.removeChild(tempAnchor)
            }
          } catch (e) {
            console.error("Auto trigger failed, user can click manual button", e)
          }

          toast({
            title: "Success",
            description: "Download initiated!"
          })
        } else if (data.status === 'failed') {
          clearInterval(interval)
          toast({
            variant: "destructive",
            title: "Archiving Failed",
            description: data.error || "The background conversion engine encountered an error."
          })
        }
      } catch (e) {
        clearInterval(interval)
        setDownloadingJob(prev => prev ? { ...prev, status: 'failed', error: 'Lost connection to archiving server' } : null)
      }
    }, 1000)
  }

  const handleSaveCookies = async () => {
    if (!cookieText) return
    setIsSavingCookies(true)
    try {
      const response = await fetch(`${API_URL}/api/upload-cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookieText })
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save cookie file')
      }

      toast({
        title: "Authenticated",
        description: "YouTube cookies updated. Retrying your video resolution..."
      })
      setCookieText("")
      setShowCookieAuth(false)
      // Retry resolution
      handleResolve()
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Authentication Failed",
        description: err.message
      })
    } finally {
      setIsSavingCookies(false)
    }
  }

  const loadDemoUrl = (demoPlatform: string) => {
    let demoUrl = ""
    if (demoPlatform === 'youtube') {
      demoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    } else if (demoPlatform === 'tiktok') {
      demoUrl = "https://www.tiktok.com/@scout2015/video/6986134372998368518"
    } else if (demoPlatform === 'instagram') {
      demoUrl = "https://www.instagram.com/p/CG43_25j2fX/"
    }
    setUrl(demoUrl)
    setPlatform(detectPlatform(demoUrl))
    handleResolve(demoUrl)
  }

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      setUrl(text)
      const detected = detectPlatform(text)
      setPlatform(detected)
      toast({
        title: "Pasted link",
        description: `Loaded from clipboard (${detected})`
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Clipboard Access Blocked",
        description: "Please manually paste the link into the search input."
      })
    }
  }

  const clearInput = () => {
    setUrl("")
    setMetadata(null)
    setPlatform("unknown")
    setDownloadingJob(null)
    setShowCookieAuth(false)
  }

  // Filter video vs audio formats
  const videoFormats = metadata?.formats.filter(f => f.type === 'video') || []
  const audioFormats = metadata?.formats.filter(f => f.type === 'audio') || []

  // Instagram's CDN blocks hotlinked images without the right Referer header,
  // so route those through our own backend proxy instead of loading directly.
  const getThumbnailSrc = (thumbnail: string, platform: Platform) => {
    if (platform === 'instagram') {
      return `${API_URL}/api/thumbnail?url=${encodeURIComponent(thumbnail)}`
    }
    return thumbnail
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground relative overflow-hidden">
      {/* Decorative gradient glow elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[60%] rounded-full bg-primary/10 blur-[160px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[60%] rounded-full bg-accent/15 blur-[160px] pointer-events-none" />

      <Navbar />

      {cookieStatus.checked && !cookieStatus.valid && (
        <div className="relative z-20 mx-4 sm:mx-auto mt-24 sm:mt-32 max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-start gap-3 text-sm text-amber-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>YouTube cookies have expired — re-export a fresh cookies.txt and update <code className="text-amber-100">YTDLP_COOKIES_CONTENT</code> on Render. Other platforms (TikTok, Instagram) aren't affected.</span>
        </div>
      )}

      <main className={`flex-grow pt-28 sm:pt-36 px-4 sm:px-6 relative z-10 transition-all duration-300 ${metadata && !downloadingJob ? 'pb-28 sm:pb-20' : 'pb-20'}`}>
        <div className="max-w-5xl mx-auto space-y-12 sm:space-y-16 animate-entrance opacity-0">

          {/* Hero Section */}
          <div className="text-center space-y-5 sm:space-y-7">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.05] text-[10px] sm:text-xs font-semibold text-brand-text-muted tracking-wide uppercase">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-brand-signal animate-pulse" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" x2="12" y1="3" y2="15"/>
              </svg>
              <span>Convert video and audio instantly</span>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-headline font-black tracking-tight text-white leading-[1.05]">
              Archive Content <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-indigo-400 to-accent">
                Without Limits.
              </span>
            </h1>

            <p className="text-brand-text-muted text-sm sm:text-base md:text-lg max-w-xl mx-auto leading-relaxed">
              Save files from your favorite platforms directly. No subscriptions, zero watermarks, and high speed merging.
            </p>

            {/* System Status Metrics */}
            <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2.5 pt-2 text-[10px] sm:text-xs font-black uppercase tracking-wider text-brand-text-muted/50">
              <span className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-brand-signal" /> Node Speed: <span className="font-mono text-white text-xs">10Gbps</span>
              </span>
              <span className="h-1 w-1 rounded-full bg-white/10" />
              <span className="flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-brand-processing" /> Conversion: <span className="font-mono text-white text-xs">~2.1s</span>
              </span>
              <span className="h-1 w-1 rounded-full bg-white/10" />
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" /> Encryption: <span className="font-mono text-white text-xs">SSL Verified</span>
              </span>
            </div>
          </div>

          {/* Core URL input container */}
          <div className="max-w-3xl mx-auto">
            <div className="relative group">
              {/* Outer soft glowing border effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 blur-2xl rounded-[2.5rem] opacity-30 group-focus-within:opacity-80 transition-opacity duration-300" />

              <div className="relative bg-brand-surface/70 backdrop-blur-2xl border border-brand-border rounded-[1.5rem] sm:rounded-[2.2rem] p-2.5 shadow-2xl transition-all group-focus-within:border-primary/40 group-focus-within:ring-4 group-focus-within:ring-primary/5">
                <div className="flex flex-col sm:flex-row items-stretch gap-3">
                  <div className="flex-1 flex items-center min-w-0 px-3 sm:px-4">
                    <PlatformIcon platform={platform} className="w-6 h-6 mr-3 opacity-90 shrink-0" />
                    <Input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && url && !isLoading && handleResolve()}
                      placeholder="Paste link (YouTube, Instagram, TikTok, Twitter...)"
                      className="border-0 bg-transparent focus-visible:ring-0 text-base sm:text-lg h-12 sm:h-14 placeholder:text-white/20 text-white flex-1 min-w-0 px-0 focus:outline-none"
                    />
                    {url && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={clearInput}
                        className="h-10 w-10 shrink-0 text-brand-text-muted hover:text-white hover:bg-white/5 rounded-full focus:ring-2 focus:ring-accent"
                      >
                        <X className="w-4.5 h-4.5" />
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-2 pb-2 sm:px-0 sm:pb-0 sm:pr-1.5 w-full sm:w-auto">
                    <Button
                      onClick={pasteFromClipboard}
                      variant="ghost"
                      type="button"
                      className="flex-1 sm:flex-none h-12 sm:h-14 px-4 sm:px-5 gap-2 font-bold rounded-xl sm:rounded-2xl hover:bg-white/5 text-brand-text-muted hover:text-white transition-all text-sm border border-white/[0.03] focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <ClipboardPaste className="w-4 h-4 sm:w-4.5 h-4.5" />
                      <span>Paste</span>
                    </Button>

                    <Button
                      onClick={() => handleResolve()}
                      disabled={!url || isLoading}
                      type="button"
                      className="w-full sm:w-auto h-12 sm:h-14 px-6 sm:px-8 font-bold rounded-xl sm:rounded-[1.3rem] shadow-xl shadow-primary/25 active:scale-[0.98] transition-all bg-primary hover:bg-primary/95 text-white gap-2 text-base focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          Convert
                          <ArrowRight className="w-4.5 h-4.5" />
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Demo Demos */}
            <div className="mt-5 flex flex-wrap justify-center items-center gap-2 sm:gap-3 text-xs">
              <span className="text-brand-text-muted/40 font-bold uppercase tracking-wider text-[10px]">Try Quick Test:</span>
              <button
                onClick={() => loadDemoUrl('youtube')}
                className="px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/5 hover:text-red-400 font-semibold text-brand-text-muted transition-all duration-200 focus:ring-2 focus:ring-accent focus:outline-none"
              >
                YouTube HD
              </button>
              <button
                onClick={() => loadDemoUrl('instagram')}
                className="px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/5 hover:text-pink-400 font-semibold text-brand-text-muted transition-all duration-200 focus:ring-2 focus:ring-accent focus:outline-none"
              >
                Instagram Reel
              </button>
              <button
                onClick={() => loadDemoUrl('tiktok')}
                className="px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/5 hover:text-cyan-400 font-semibold text-brand-text-muted transition-all duration-200 focus:ring-2 focus:ring-accent focus:outline-none"
              >
                TikTok Video
              </button>
            </div>
          </div>

          {/* YouTube Rate Limit / Cookies Upload Dialog Panel */}
          {showCookieAuth && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">
              <Card className="bg-amber-500/5 border border-amber-500/20 shadow-xl rounded-2xl overflow-hidden">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-amber-500/10 rounded-xl shrink-0 mt-0.5">
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-bold text-white text-base">YouTube Verification Required</h4>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        YouTube has requested a bot verification check (HTTP 429). To bypass this and download videos immediately, upload your YouTube session cookies below:
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 bg-black/20 p-4 rounded-xl border border-white/[0.03]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">How to get your cookies:</span>
                    <ol className="text-xs text-muted-foreground/80 list-decimal list-inside space-y-1.5">
                      <li>Install the chrome extension <span className="text-white font-semibold">Get cookies.txt LOCALLY</span> (or similar cookie extractor).</li>
                      <li>Open YouTube, click the extension icon, and select <span className="text-white font-semibold">Export / Copy All</span> cookies.</li>
                      <li>Paste the Netscape format cookie text content in the field below:</li>
                    </ol>
                  </div>

                  <div className="space-y-2.5">
                    <textarea
                      value={cookieText}
                      onChange={(e) => setCookieText(e.target.value)}
                      placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	1791240000	__Secure-3PSID	..."
                      rows={5}
                      className="w-full bg-secondary/35 border border-white/[0.08] rounded-xl p-3 text-xs font-mono placeholder:text-muted-foreground/30 text-white focus:outline-none focus:border-primary/50"
                    />
                    <div className="flex justify-end gap-2.5">
                      <Button
                        onClick={() => setShowCookieAuth(false)}
                        variant="ghost"
                        className="rounded-xl text-xs"
                      >
                        Ignore
                      </Button>
                      <Button
                        onClick={handleSaveCookies}
                        disabled={isSavingCookies || !cookieText}
                        className="bg-primary hover:bg-primary/90 text-white text-xs rounded-xl font-bold gap-2 px-5"
                      >
                        {isSavingCookies ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                        Apply Credentials
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Skeleton shimmer state during loading */}
          {isLoading && (
            <div className="animate-in fade-in duration-300 max-w-5xl mx-auto">
              <Card className="bg-brand-surface/40 border border-brand-border rounded-[1.8rem] sm:rounded-[2.5rem] overflow-hidden shadow-2xl">
                <CardContent className="p-0">
                  <div className="flex flex-col lg:flex-row">
                    <div className="w-full lg:w-96 aspect-video lg:h-full min-h-[220px] lg:min-h-[380px] bg-white/[0.02] border-b lg:border-b-0 lg:border-r border-brand-border flex items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent -translate-x-full animate-pulse" />
                      <Loader2 className="w-8 h-8 text-brand-text-muted/20 animate-spin" />
                    </div>
                    <div className="flex-1 p-6 sm:p-8 lg:p-10 space-y-6 sm:space-y-8">
                      <div className="space-y-3">
                        <div className="h-3 w-20 bg-white/[0.04] rounded animate-pulse" />
                        <div className="h-6 w-3/4 bg-white/[0.04] rounded animate-pulse" />
                        <div className="h-3 w-1/3 bg-white/[0.04] rounded animate-pulse" />
                      </div>
                      <div className="space-y-4">
                        <div className="h-8 w-32 bg-white/[0.04] rounded-xl animate-pulse" />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="h-12 bg-white/[0.02] border border-brand-border rounded-xl animate-pulse" />
                          <div className="h-12 bg-white/[0.02] border border-brand-border rounded-xl animate-pulse" />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Results Video Metadata details section */}
          {metadata && !downloadingJob && (
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
              <Card className="bg-brand-surface/40 border border-brand-border overflow-hidden shadow-2xl backdrop-blur-md rounded-[1.8rem] sm:rounded-[2.5rem]">
                <CardContent className="p-0">
                  <div className="flex flex-col lg:flex-row">

                    {/* Monitor Video Preview */}
                    <div className="relative w-full lg:w-96 bg-black shrink-0 flex items-center justify-center overflow-hidden border-b lg:border-b-0 lg:border-r border-brand-border group/monitor scanlines">
                      <div className="relative w-full aspect-video lg:h-full min-h-[220px] lg:min-h-[380px] overflow-hidden flex items-center justify-center bg-black/60">
                        <video
                          controls
                          playsInline
                          preload="metadata"
                          poster={getThumbnailSrc(metadata.thumbnail, metadata.platform)}
                          className="relative w-full h-full object-contain z-10 max-h-[380px]"
                          onLoadStart={() => setPreviewBuffering(true)}
                          onCanPlay={() => setPreviewBuffering(false)}
                          onPlaying={() => setPreviewBuffering(false)}
                          onPause={() => setPreviewBuffering(false)}
                          src={`${API_URL}/api/preview?url=${encodeURIComponent(url)}`}
                        />

                        {previewBuffering && (
                          <div className="absolute inset-0 bg-brand-bg/85 backdrop-blur-sm z-20 flex flex-col items-center justify-center p-4">
                            <div className="w-2/3 max-w-[200px] space-y-2">
                              <div className="h-1 bg-white/5 rounded-full overflow-hidden relative">
                                <div className="absolute top-0 bottom-0 left-0 w-1/3 bg-brand-processing rounded-full" style={{
                                  animation: 'engineering-buffer 1.5s ease-in-out infinite'
                                }} />
                              </div>
                              <p className="text-center font-mono text-[9px] text-brand-processing uppercase tracking-widest animate-pulse">
                                Buffering preview...
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Duration badge */}
                      <Badge className="absolute bottom-4 right-4 bg-black/75 backdrop-blur-md border border-white/[0.1] px-2.5 py-1 font-mono text-xs text-white z-20">
                        {metadata.duration}
                      </Badge>
                    </div>

                    {/* Formats Tabs & Information */}
                    <div className="flex-1 p-6 sm:p-8 lg:p-10 space-y-6 sm:space-y-8 min-w-0">

                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2">
                          <PlatformIcon platform={metadata.platform} className="w-4 h-4" />
                          <span className="text-[10px] font-black text-primary uppercase tracking-widest">{metadata.platform} source</span>
                        </div>
                        <h3 className="text-xl sm:text-2xl font-headline font-bold leading-snug text-white line-clamp-2" title={metadata.title}>
                          {metadata.title}
                        </h3>
                        <p className="text-muted-foreground font-semibold text-xs sm:text-sm">By {metadata.author}</p>
                      </div>

                      {/* Formatting Selector Tabs */}
                      <Tabs defaultValue="video" className="w-full space-y-5">
                        <TabsList className="bg-black/30 border border-white/[0.06] p-1 rounded-xl w-full sm:w-auto grid grid-cols-2">
                          <TabsTrigger value="video" className="rounded-lg font-bold text-xs py-2 gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-white">
                            <FileVideo className="w-3.5 h-3.5" /> Video formats
                          </TabsTrigger>
                          <TabsTrigger value="audio" className="rounded-lg font-bold text-xs py-2 gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-white">
                            <Music className="w-3.5 h-3.5" /> Audio Only
                          </TabsTrigger>
                        </TabsList>

                        {/* Video Formats list */}
                        <TabsContent value="video" className="space-y-2 focus-visible:ring-0">
                          {videoFormats.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              {videoFormats.map((format, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => handleDownload(format)}
                                  className="flex items-center justify-between text-left border border-white/[0.06] hover:bg-white/[0.03] hover:border-primary/40 p-3.5 rounded-xl transition-all duration-150 group h-14 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
                                      <Download className="w-4.5 h-4.5" />
                                    </div>
                                    <div className="flex flex-col leading-tight">
                                      <span className="font-bold text-sm text-white">{format.quality}</span>
                                      <span className="text-[10px] font-bold text-brand-text-muted/60 uppercase mt-0.5">{format.ext} format</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {format.size && format.size !== 'Auto' && (
                                      <span className="text-[10px] font-mono font-bold text-brand-text-muted/40 bg-white/[0.02] border border-white/[0.04] px-1.5 py-0.5 rounded">{format.size}</span>
                                    )}
                                    <span className="text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-xs font-bold uppercase shrink-0">Get</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="py-8 text-center text-brand-text-muted text-xs">No video formats detected for this URL.</div>
                          )}
                        </TabsContent>

                        {/* Audio Formats list */}
                        <TabsContent value="audio" className="space-y-2 focus-visible:ring-0">
                          {audioFormats.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              {audioFormats.map((format, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => handleDownload(format)}
                                  className="flex items-center justify-between text-left border border-white/[0.06] hover:bg-white/[0.03] hover:border-accent/40 p-3.5 rounded-xl transition-all duration-150 group h-14 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 text-accent">
                                      <Music className="w-4.5 h-4.5" />
                                    </div>
                                    <div className="flex flex-col leading-tight">
                                      <span className="font-bold text-sm text-white">{format.quality}</span>
                                      <span className="text-[10px] font-bold text-brand-text-muted/60 uppercase mt-0.5">{format.ext} format</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {format.size && format.size !== 'Auto' && (
                                      <span className="text-[10px] font-mono font-bold text-brand-text-muted/40 bg-white/[0.02] border border-white/[0.04] px-1.5 py-0.5 rounded">{format.size}</span>
                                    )}
                                    <span className="text-accent opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-xs font-bold uppercase shrink-0">Get</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="py-8 text-center text-brand-text-muted text-xs">No audio formats detected for this URL.</div>
                          )}
                        </TabsContent>
                      </Tabs>

                      {/* Note info */}
                      <div className="flex items-center gap-2 text-[10px] font-bold text-brand-text-muted/40 uppercase">
                        <ShieldCheck className="w-4.5 h-4.5 text-emerald-500/60" />
                        <span>Instant file packing & validation complete</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Active download process & completed states */}
          {downloadingJob && (
            <div className="animate-in zoom-in-[0.98] fade-in duration-500 max-w-xl mx-auto">
              <Card className="bg-brand-surface/40 border border-brand-border shadow-[0_0_80px_-20px_rgba(99,102,241,0.15)] overflow-hidden rounded-[2.2rem]">
                <CardContent className="p-8 sm:p-12 space-y-8 text-center relative">

                  {/* Status header */}
                  <div className="space-y-2">
                    {downloadingJob.status === 'completed' ? (
                      <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 animate-bounce">
                        <CheckCircle2 className="w-8 h-8" />
                      </div>
                    ) : downloadingJob.status === 'failed' ? (
                      <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-4">
                        <AlertTriangle className="w-8 h-8" />
                      </div>
                    ) : (
                      <div className="mx-auto w-12 h-12 flex items-center justify-center mb-4">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                      </div>
                    )}

                    <h4 className="font-headline font-black text-2xl sm:text-3xl text-white">
                      {downloadingJob.status === 'completed' && 'Download Ready!'}
                      {downloadingJob.status === 'failed' && 'Job Interrupted'}
                      {downloadingJob.status === 'queued' && 'Task Queued'}
                      {downloadingJob.status === 'active' && 'Processing Media...'}
                    </h4>
                    <p className="text-brand-text-muted text-xs sm:text-sm">
                      {downloadingJob.status === 'completed' && 'Your file has been assembled successfully.'}
                      {downloadingJob.status === 'failed' && (downloadingJob.error || 'Conversion failed. Please try again.')}
                      {downloadingJob.status === 'queued' && 'Waiting for conversion thread assignment...'}
                      {downloadingJob.status === 'active' && 'Executing extraction. Demuxing stream audio/video.'}
                    </p>
                  </div>

                  {/* Progress Indicator */}
                  {downloadingJob.status !== 'completed' && downloadingJob.status !== 'failed' && (
                    <div className="space-y-4">
                      <div className="relative py-1">
                        <Progress value={downloadingJob.progress} className="h-2.5 bg-white/5 rounded-full" />
                        <div className="absolute inset-0 bg-primary/20 blur-2xl -z-10 opacity-30" />
                      </div>
                      <span className="font-mono text-primary text-4xl sm:text-5xl font-black tabular-nums">{Math.round(downloadingJob.progress)}%</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col gap-3 pt-2">
                    {downloadingJob.status === 'completed' && downloadingJob.result && (
                      <>
                        <Button
                          asChild
                          className="w-full h-14 bg-gradient-to-r from-primary to-accent hover:from-primary/95 hover:to-accent/95 text-white font-bold rounded-2xl shadow-xl shadow-primary/20 gap-2 text-base active:scale-[0.99] transition-transform focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <a
                            href={downloadingJob.result.downloadUrl.startsWith('http') ? downloadingJob.result.downloadUrl : `${API_URL}${downloadingJob.result.downloadUrl}`}
                            download={downloadingJob.result.filename}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Download className="w-5 h-5" />
                            Save File to Device
                          </a>
                        </Button>
                        <p className="text-[10px] text-brand-text-muted/50 font-mono">
                          If your download did not start automatically, tap the button above to manually download.
                        </p>
                      </>
                    )}

                    <div className="flex gap-3 justify-center mt-2">
                      <Button
                        onClick={clearInput}
                        variant="secondary"
                        className="rounded-xl font-bold text-xs gap-1.5 hover:bg-white/5 px-6 h-11 border border-white/[0.04] focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Convert another
                      </Button>

                      {downloadingJob.status === 'completed' && downloadingJob.result && (
                        <Button
                          asChild
                          variant="ghost"
                          className="rounded-xl font-bold text-xs gap-1.5 hover:bg-white/5 px-4 h-11 focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <a
                            href={(() => { const u = downloadingJob.result.downloadUrl; const base = u.startsWith('http') ? u : `${API_URL}${u}`; return base.includes('?') ? `${base}&inline=true` : `${base}?inline=true`; })()}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open Link <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Trust Badge Footer */}
                  <div className="flex justify-center gap-6 text-[10px] font-black text-brand-text-muted/30 uppercase tracking-[0.2em] pt-4 border-t border-white/[0.04]">
                    <div className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-500/25" /> Scanned Clean</div>
                    <div className="flex items-center gap-1.5"><Zap className="w-4 h-4 text-brand-processing/25" /> Safe Codecs</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>

      {/* Sticky bottom CTA bar on mobile */}
      {metadata && !downloadingJob && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-brand-surface/90 backdrop-blur-xl border-t border-brand-border p-4 z-40 flex items-center justify-between animate-in slide-in-from-bottom-full duration-300">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={getThumbnailSrc(metadata.thumbnail, metadata.platform)} className="w-10 h-10 object-cover rounded-lg border border-white/10 shrink-0" alt="" referrerPolicy="no-referrer" />
            <div className="min-w-0 leading-tight">
              <p className="text-xs font-bold text-white truncate">{metadata.title}</p>
              <p className="text-[10px] text-brand-text-muted truncate">Format ready</p>
            </div>
          </div>
          <Button
            onClick={() => {
              const bestFormat = videoFormats[0] || audioFormats[0] || metadata.formats[0];
              if (bestFormat) {
                handleDownload(bestFormat);
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
              }
            }}
            className="bg-primary hover:bg-primary/95 text-white font-headline font-bold text-xs h-11 px-4 rounded-xl shrink-0"
          >
            Archive Best
          </Button>
        </div>
      )}

      <Footer />
      <ChatAssistant hasStickyBar={!!metadata && !downloadingJob} />
    </div>
  )
}
