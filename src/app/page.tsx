"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Navbar } from "@/components/Navbar"
import { Footer } from "@/components/Footer"
import { PlatformIcon, Platform } from "@/components/PlatformIcon"
import { detectPlatform } from "@/lib/platform-detect"
import { getStoredApiUrl, isCustomApiUrlActive, setCustomApiUrl } from "@/lib/api-config"
import { ServerSettingsModal } from "@/components/ServerSettingsModal"
import { QrCodeShareModal } from "@/components/QrCodeShareModal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Loader2,
  Download,
  Music,
  ShieldCheck,
  Zap,
  X,
  ClipboardPaste,
  ArrowRight,
  AlertTriangle,
  UploadCloud,
  CheckCircle2,
  RotateCcw,
  FileVideo,
  ExternalLink,
  Cloud,
  Play,
  Settings2,
  Clock,
  User,
  HardDrive,
  Film,
  QrCode,
  Share2,
  Key
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { ChatAssistant } from "@/components/ChatAssistant"

interface VideoFormat {
  id: string
  type: "video" | "audio"
  quality: string
  ext: string
  size: string
  resolution?: string
  videoFormatId?: string
  audioFormatId?: string
  filesize?: number
  filesizeApprox?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
}

interface VideoMetadata {
  title: string
  thumbnail: string
  duration: string
  author: string
  platform: Platform
  formats: VideoFormat[]
  directUrl?: string
}

function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/)
  return match ? match[1] : null
}

function formatQualityLabel(rawQuality: string): string {
  if (!rawQuality) return "High Quality"
  if (rawQuality.includes("2160p") || rawQuality.includes("4K")) return "4K Ultra HD"
  if (rawQuality.includes("1440p") || rawQuality.includes("2K")) return "2K QHD"
  if (rawQuality.includes("1080p")) return "1080p Full HD"
  if (rawQuality.includes("720p")) return "720p HD"
  if (rawQuality.includes("480p")) return "480p SD"
  if (rawQuality.includes("360p")) return "360p Medium"
  if (rawQuality.includes("240p")) return "240p Mobile"
  const match = rawQuality.match(/(\d+)p/i)
  if (!match) return rawQuality
  const h = parseInt(match[1])
  if (h >= 2160) return "4K Ultra HD"
  if (h >= 1440) return "2K QHD"
  if (h >= 1000) return "1080p Full HD"
  if (h >= 700) return "720p HD"
  if (h >= 480) return "480p SD"
  if (h >= 340) return "360p Medium"
  if (h >= 240) return "240p Mobile"
  return `${h}p Low Data`
}

export default function Home() {
  const [url, setUrl] = useState("")
  const [platform, setPlatform] = useState<Platform>("unknown")
  const [isLoading, setIsLoading] = useState(false)
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [isPlayingPreview, setIsPlayingPreview] = useState(false)
  const [downloadingJob, setDownloadingJob] = useState<{
    id: string
    progress: number
    status: string
    formatQuality?: string
    formatExt?: string
    result?: {
      filename: string
      downloadUrl: string
      size?: string
      sizeBytes?: number
      mimeType?: string
    }
    error?: string
  } | null>(null)

  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [showCookieAuth, setShowCookieAuth] = useState(false)
  const [cookieText, setCookieText] = useState("")
  const [isSavingCookies, setIsSavingCookies] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [activeApiUrl, setActiveApiUrl] = useState(getStoredApiUrl())
  const [isColab, setIsColab] = useState(isCustomApiUrlActive())
  const [previewError, setPreviewError] = useState(false)
  const [directUrlFailed, setDirectUrlFailed] = useState(false)
  const { toast } = useToast()

  // Auto-connect if loaded with ?engine=... URL parameter (from mobile QR scan or shared link)
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const params = new URLSearchParams(window.location.search)
      const engineParam = params.get("engine")
      if (engineParam && engineParam.trim().length > 0) {
        let cleanUrl = engineParam.trim().replace(/\/+$/, "")
        if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
          cleanUrl = `https://${cleanUrl}`
        }
        setCustomApiUrl(cleanUrl)
        setActiveApiUrl(cleanUrl)
        setIsColab(true)
        toast({
          title: "Colab Engine Connected! ⚡",
          description: `Auto-connected to backend: ${cleanUrl}`
        })
        // Clean URL query params without reloading
        const cleanLocation = window.location.pathname
        window.history.replaceState({}, document.title, cleanLocation)
      }
    } catch (e) {
      console.error("Failed to parse engine URL param", e)
    }
  }, [])

  // Reset playing preview when new URL is converted
  useEffect(() => {
    setIsPlayingPreview(false)
  }, [metadata])

  // Keep active API URL in sync with settings changes
  useEffect(() => {
    const handleUrlChange = () => {
      setActiveApiUrl(getStoredApiUrl())
      setIsColab(isCustomApiUrlActive())
    }
    window.addEventListener("clipgrab_api_url_changed", handleUrlChange)
    return () => window.removeEventListener("clipgrab_api_url_changed", handleUrlChange)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('Service Worker registration failed:', err)
      })
    }
  }, [])

  useEffect(() => {
    setPlatform(detectPlatform(url))
  }, [url])

  const handleResolve = async (customUrl?: string) => {
    const targetUrl = customUrl || url
    if (!targetUrl) return
    setIsLoading(true)
    setMetadata(null)
    setDirectUrlFailed(false)
    setShowCookieAuth(false)

    const apiUrl = getStoredApiUrl()

    try {
      const response = await fetch(`${apiUrl}/api/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errMessage = data.error || data.detail || 'Failed to resolve URL'
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
        throw new Error(errMessage)
      }

      setMetadata(data)
    } catch (err: any) {
      console.error("Resolve error:", err)
      toast({
        variant: "destructive",
        title: "Could not fetch media",
        description: err.message || "Failed to retrieve video stream details. Please check the URL."
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownload = async (format: VideoFormat) => {
    if (!metadata) return

    const apiUrl = getStoredApiUrl()

    try {
      const response = await fetch(`${apiUrl}/api/download`, {
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
        throw new Error(errData.error || errData.message || errData.detail || 'Download task initialization failed')
      }

      const { jobId } = await response.json()
      setDownloadingJob({
        id: jobId,
        progress: 5,
        status: 'queued',
        formatQuality: format.quality,
        formatExt: format.ext
      })
      startPolling(jobId, apiUrl)
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Download Initialization Failed",
        description: err.message
      })
    }
  }

  const startPolling = (jobId: string, serverUrl: string) => {
    let consecutiveErrors = 0
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${serverUrl}/api/status/${jobId}`)
        if (!response.ok) {
          throw new Error("Failed to poll server status")
        }
        const data = await response.json()
        consecutiveErrors = 0

        setDownloadingJob(prev => {
          if (!prev) return null
          return {
            ...prev,
            progress: data.progress || prev.progress,
            status: data.status,
            result: data.result,
            error: data.error || data.failedReason
          }
        })

        if (data.status === 'completed') {
          clearInterval(interval)

          // Auto trigger file save
          try {
            const rawUrl = data.result.downloadUrl
            const downloadLink = rawUrl.startsWith('http') ? rawUrl : `${serverUrl}${rawUrl}`
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
            const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)

            if (isIOS || isSafari) {
              window.open(downloadLink, '_blank')
            } else {
              const tempAnchor = document.createElement('a')
              tempAnchor.href = downloadLink
              tempAnchor.setAttribute('download', data.result.filename || '')
              document.body.appendChild(tempAnchor)
              tempAnchor.click()
              document.body.removeChild(tempAnchor)
            }
          } catch (e) {
            console.error("Auto trigger error:", e)
          }

          toast({
            title: "Download Ready! 🎉",
            description: "Your file is ready and downloading."
          })
        } else if (data.status === 'failed') {
          clearInterval(interval)
          toast({
            variant: "destructive",
            title: "Conversion Failed",
            description: data.error || data.failedReason || "The conversion engine encountered an issue."
          })
        }
      } catch (e) {
        consecutiveErrors++
        if (consecutiveErrors >= 10) {
          clearInterval(interval)
          setDownloadingJob(prev => prev ? { ...prev, status: 'failed', error: 'Lost connection to backend server' } : null)
        }
      }
    }, 1200)
  }

  const handleSaveCookies = async () => {
    if (!cookieText) return
    setIsSavingCookies(true)
    const apiUrl = getStoredApiUrl()
    try {
      const response = await fetch(`${apiUrl}/api/upload-cookies`, {
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
        description: "Credentials updated. Retrying your video resolution..."
      })
      setCookieText("")
      setShowCookieAuth(false)
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
    } else if (demoPlatform === 'pinterest') {
      demoUrl = "https://www.pinterest.com/pin/1149473628620800049/"
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
        title: "Link pasted",
        description: `Ready to convert (${detected})`
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Clipboard Access Blocked",
        description: "Please manually paste the link into the input box."
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

  const videoFormats = metadata?.formats.filter(f => f.type === 'video') || []
  const audioFormats = metadata?.formats.filter(f => f.type === 'audio') || []

  const getThumbnailSrc = (thumbnail: string, platform: Platform) => {
    const apiUrl = getStoredApiUrl()
    if (platform === 'instagram' && !thumbnail.startsWith('data:')) {
      return `${apiUrl}/api/thumbnail?url=${encodeURIComponent(thumbnail)}`
    }
    return thumbnail
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground relative overflow-hidden selection:bg-primary selection:text-white">
      {/* Dynamic ambient background glow */}
      <div className="absolute top-[-15%] left-[-10%] w-[55%] h-[60%] rounded-full bg-primary/15 blur-[160px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[60%] rounded-full bg-indigo-500/10 blur-[180px] pointer-events-none" />

      <Navbar />

      <main className={`flex-grow pt-24 sm:pt-36 px-3.5 sm:px-6 relative z-10 transition-all duration-300 ${metadata && !downloadingJob ? 'pb-28 sm:pb-20' : 'pb-20'}`}>
        <div className="max-w-5xl mx-auto space-y-8 sm:space-y-12">

          {/* Hero Section */}
          <div className="text-center space-y-4 sm:space-y-6">
            <h1 className="text-3xl xs:text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-headline font-black tracking-tight text-white leading-[1.1] sm:leading-[1.08]">
              High-Speed Media <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-indigo-300 to-accent">
                Downloader & Converter.
              </span>
            </h1>

            <p className="text-brand-text-muted text-xs sm:text-base md:text-lg max-w-xl mx-auto leading-relaxed px-2">
              Extract lossless 4K video, 1080p 60fps, and studio-quality MP3 audio from any platform without ads or watermarks.
            </p>

            {/* Supported Platform Badges */}
            <div className="flex flex-wrap justify-center items-center gap-1.5 sm:gap-2 pt-1 text-[11px] sm:text-xs font-bold text-brand-text-muted/70">
              <span className="px-2.5 sm:px-3 py-1 rounded-lg bg-white/[0.02] border border-white/[0.05] flex items-center gap-1.5 text-white/80">
                <PlatformIcon platform="youtube" className="w-3.5 h-3.5 shrink-0" /> YouTube 4K & MP3
              </span>
              <span className="px-2.5 sm:px-3 py-1 rounded-lg bg-white/[0.02] border border-white/[0.05] flex items-center gap-1.5 text-white/80">
                <PlatformIcon platform="instagram" className="w-3.5 h-3.5 shrink-0" /> Instagram Reels
              </span>
              <span className="px-2.5 sm:px-3 py-1 rounded-lg bg-white/[0.02] border border-white/[0.05] flex items-center gap-1.5 text-white/80">
                <PlatformIcon platform="tiktok" className="w-3.5 h-3.5 shrink-0" /> TikTok No-Watermark
              </span>
              <span className="px-2.5 sm:px-3 py-1 rounded-lg bg-white/[0.02] border border-white/[0.05] flex items-center gap-1.5 text-white/80">
                <PlatformIcon platform="pinterest" className="w-3.5 h-3.5 shrink-0" /> Pinterest Pins
              </span>
              <span className="px-2.5 sm:px-3 py-1 rounded-lg bg-white/[0.02] border border-white/[0.05] flex items-center gap-1.5 text-white/80">
                <PlatformIcon platform="twitter" className="w-3.5 h-3.5 shrink-0" /> X / Twitter
              </span>
            </div>
          </div>

          {/* Main URL Input Container */}
          <div className="max-w-3xl mx-auto">
            <div className={`relative transition-transform duration-300 ${isSearchFocused ? 'scale-[1.015]' : 'scale-100'}`}>
              
              {/* Background Radial Glows for Ambient Blue Lighting */}
              <div className={`absolute inset-0 bg-gradient-to-r from-blue-600/30 via-indigo-500/20 to-[#00e5ff]/30 blur-3xl rounded-[2.5rem] transition-opacity duration-500 pointer-events-none ${isSearchFocused ? 'opacity-100' : 'opacity-25'}`} />

              {/* Animated Glowing Meteor Tracing Border (Electric Blue / Cyber Neon) */}
              <div
                className={`absolute inset-[-1.5px] rounded-[1.6rem] sm:rounded-[2.3rem] pointer-events-none overflow-hidden glowing-border-mask z-10 transition-opacity duration-500 ${isSearchFocused ? 'opacity-100' : 'opacity-0'}`}
              >
                <div
                  className="animate-meteor"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 45%, rgba(30, 58, 138, 0.2) 65%, rgba(59, 130, 246, 0.85) 88%, #00e5ff 100%)',
                  }}
                />
              </div>

              {/* Main Solid Search Bar Container */}
              <div 
                className={`relative bg-[#08070d] backdrop-blur-2xl rounded-[1.5rem] sm:rounded-[2.2rem] p-2.5 shadow-2xl transition-all duration-300 z-10 ${isSearchFocused ? 'border-transparent shadow-[0_12px_45px_rgba(0,0,0,0.95)]' : 'border border-white/5 shadow-[0_8px_40px_rgba(0,0,0,0.8)]'}`}
              >
                <div className="flex flex-col sm:flex-row items-stretch gap-3">
                  <div className="flex-1 flex items-center min-w-0 px-3 sm:px-4">
                    <PlatformIcon platform={platform} className="w-6 h-6 mr-3 opacity-90 shrink-0" />
                    <Input
                      value={url}
                      onFocus={() => setIsSearchFocused(true)}
                      onBlur={() => setIsSearchFocused(false)}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && url && !isLoading && handleResolve()}
                      placeholder="Paste link here (YouTube, Reels, TikTok, Pinterest, X...)"
                      className="border-0 bg-transparent focus-visible:ring-0 text-base sm:text-lg h-12 sm:h-14 placeholder:text-white/25 text-white flex-1 min-w-0 px-0 focus:outline-none"
                    />
                    {url && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={clearInput}
                        className="h-9 w-9 shrink-0 text-brand-text-muted hover:text-white hover:bg-white/10 rounded-full"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-2 pb-2 sm:px-0 sm:pb-0 sm:pr-1.5 w-full sm:w-auto">
                    <Button
                      onClick={pasteFromClipboard}
                      variant="ghost"
                      type="button"
                      className="flex-1 sm:flex-none h-12 sm:h-14 px-4 sm:px-5 gap-2 font-bold rounded-xl sm:rounded-2xl hover:bg-white/5 text-brand-text-muted hover:text-white transition-all text-sm border border-white/[0.04]"
                    >
                      <ClipboardPaste className="w-4 h-4" />
                      <span>Paste</span>
                    </Button>

                    <Button
                      onClick={() => handleResolve()}
                      disabled={!url || isLoading}
                      type="button"
                      className="w-full sm:w-auto h-12 sm:h-14 px-6 sm:px-8 font-bold rounded-xl sm:rounded-[1.3rem] shadow-xl shadow-primary/30 active:scale-[0.98] transition-all bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/95 hover:to-indigo-500 text-white gap-2 text-base"
                    >
                      {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          Convert
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Test Demo Links */}
            <div className="mt-4 flex flex-wrap justify-center items-center gap-2 text-xs">
              <span className="text-brand-text-muted/50 font-bold uppercase tracking-wider text-[10px]">Try Quick Test:</span>
              <button
                onClick={() => loadDemoUrl('youtube')}
                className="px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/5 hover:text-red-400 font-semibold text-brand-text-muted transition-all duration-200"
              >
                YouTube HD
              </button>
              <button
                onClick={() => loadDemoUrl('pinterest')}
                className="px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/5 hover:text-red-500 font-semibold text-brand-text-muted transition-all duration-200"
              >
                Pinterest Pin
              </button>
              <button
                onClick={() => loadDemoUrl('instagram')}
                className="px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/5 hover:text-pink-400 font-semibold text-brand-text-muted transition-all duration-200"
              >
                Instagram Reel
              </button>
              <button
                onClick={() => loadDemoUrl('tiktok')}
                className="px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/5 hover:text-cyan-400 font-semibold text-brand-text-muted transition-all duration-200"
              >
                TikTok No-WM
              </button>
            </div>
          </div>

          {/* Cookie Authentication Drawer / Panel */}
          {showCookieAuth && (
            <div className="animate-in slide-in-from-top-4 duration-300 max-w-3xl mx-auto">
              <Card className="bg-brand-surface border border-brand-border rounded-2xl sm:rounded-3xl p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-brand-border pb-3">
                  <div className="flex items-center gap-2 text-white font-bold text-base sm:text-lg">
                    <Key className="w-5 h-5 text-amber-400" />
                    <span>Provide Session Cookies (Bypass Verification)</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCookieAuth(false)}
                    className="text-brand-text-muted hover:text-white rounded-lg h-8 w-8 p-0"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                
                <p className="text-xs sm:text-sm text-brand-text-muted leading-relaxed">
                  YouTube or Instagram may require verified browser cookies for private or rate-limited content. Export cookies in <strong className="text-white">Netscape format</strong> using the browser extension <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">Get cookies.txt LOCALLY</code> and paste below:
                </p>

                <textarea
                  value={cookieText}
                  onChange={(e) => setCookieText(e.target.value)}
                  placeholder="# Netscape HTTP Cookie File&#10;.youtube.com  TRUE  /  TRUE  1799999999  VISITOR_INFO1_LIVE  ..."
                  className="w-full h-28 bg-black/50 border border-brand-border rounded-xl p-3 text-xs font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-primary resize-none"
                />

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowCookieAuth(false)}
                    className="rounded-xl text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={!cookieText.trim() || isSavingCookies}
                    onClick={handleSaveCookies}
                    className="bg-primary hover:bg-primary/90 text-white font-bold rounded-xl text-xs gap-1.5"
                  >
                    {isSavingCookies ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Save & Apply Cookies
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* Skeleton Preloader State */}
          {isLoading && !metadata && (
            <div className="animate-in fade-in duration-300 max-w-5xl mx-auto">
              <Card className="bg-brand-surface/40 border border-brand-border/40 overflow-hidden shadow-2xl backdrop-blur-xl rounded-[1.8rem] sm:rounded-[2.5rem]">
                <CardContent className="p-0">
                  <div className="flex flex-col lg:flex-row">
                    <div className="w-full lg:w-[440px] aspect-video lg:h-auto min-h-[260px] lg:min-h-[420px] bg-white/[0.02] border-b lg:border-b-0 lg:border-r border-brand-border/40 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    </div>
                    <div className="flex-1 p-6 sm:p-8 lg:p-10 space-y-6">
                      <div className="space-y-3">
                        <div className="h-4 w-24 bg-white/[0.05] rounded-full animate-pulse" />
                        <div className="h-7 w-4/5 bg-white/[0.05] rounded animate-pulse" />
                        <div className="h-4 w-1/3 bg-white/[0.05] rounded animate-pulse" />
                      </div>
                      <div className="space-y-4 pt-4">
                        <div className="h-10 w-48 bg-white/[0.05] rounded-xl animate-pulse" />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="h-14 bg-white/[0.02] border border-brand-border rounded-xl animate-pulse" />
                          <div className="h-14 bg-white/[0.02] border border-brand-border rounded-xl animate-pulse" />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Authentic Media Studio Card (Results & Format Selection) with Continuous Tracing Meteor Border */}
          {metadata && !downloadingJob && (
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 max-w-5xl mx-auto relative group">
              {/* Continuous Ambient Glow around the Big Card */}
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-indigo-500/15 to-[#00e5ff]/20 blur-3xl rounded-[2.8rem] opacity-70 pointer-events-none" />

              {/* Continuous Animated Glowing Meteor Tracing Border (Electric Blue) */}
              <div className="absolute inset-[-1.5px] rounded-[2rem] sm:rounded-[2.7rem] pointer-events-none overflow-hidden glowing-border-mask z-20">
                <div
                  className="animate-meteor"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 45%, rgba(30, 58, 138, 0.2) 65%, rgba(59, 130, 246, 0.85) 88%, #00e5ff 100%)',
                  }}
                />
              </div>

              {/* Inner Media Studio Card Container */}
              <Card className="relative z-10 bg-[#08070d]/95 border border-white/[0.08] overflow-hidden shadow-[0_15px_50px_rgba(0,0,0,0.9)] backdrop-blur-2xl rounded-[1.8rem] sm:rounded-[2.5rem]">
                <CardContent className="p-0">
                  <div className="flex flex-col lg:flex-row">

                    {/* Media Preview Player / Thumbnail */}
                    <div className="relative w-full lg:w-[440px] bg-black shrink-0 flex items-center justify-center overflow-hidden border-b lg:border-b-0 lg:border-r border-brand-border group">
                      <div className="relative w-full aspect-video lg:h-full min-h-[260px] lg:min-h-[420px] overflow-hidden flex items-center justify-center bg-black">
                        
                        {/* Interactive Playable Video Embed vs Thumbnail Poster */}
                        {isPlayingPreview ? (
                          <div className="relative w-full h-full min-h-[260px] lg:min-h-[420px] bg-black flex items-center justify-center z-20">
                            {getYouTubeId(url) ? (
                              <iframe
                                src={`https://www.youtube-nocookie.com/embed/${getYouTubeId(url)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
                                title={metadata.title}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowFullScreen
                                className="w-full h-full min-h-[260px] lg:min-h-[420px] border-0"
                              />
                            ) : previewError ? (
                              <div className="p-6 text-center space-y-3 max-w-sm flex flex-col items-center">
                                <div className="w-12 h-12 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary shadow-lg shadow-primary/20">
                                  <Film className="w-6 h-6" />
                                </div>
                                <div className="space-y-1">
                                  <p className="text-xs sm:text-sm font-bold text-white">Direct Stream Ready</p>
                                  <p className="text-[11px] text-brand-text-muted leading-relaxed">
                                    Browser live streaming is protected by {metadata.platform} CDN. Use the format buttons to save in full HD.
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (videoFormats.length > 0) handleDownload(videoFormats[0])
                                  }}
                                  className="h-9 px-4 text-xs font-bold bg-primary hover:bg-primary/90 text-white rounded-xl gap-1.5 shadow-lg shadow-primary/25"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Download Highest Quality</span>
                                </Button>
                              </div>
                            ) : (
                              <video
                                controls
                                autoPlay
                                playsInline
                                poster={getThumbnailSrc(metadata.thumbnail, metadata.platform)}
                                className="w-full h-full object-contain max-h-[420px]"
                                src={
                                  metadata.directUrl && !directUrlFailed
                                    ? metadata.directUrl
                                    : `${getStoredApiUrl()}/api/preview?url=${encodeURIComponent(url)}`
                                }
                                onError={() => {
                                  if (metadata.directUrl && !directUrlFailed) {
                                    setDirectUrlFailed(true)
                                  } else {
                                    setPreviewError(true)
                                  }
                                }}
                              />
                            )}

                            {/* Close / Return to Poster Button — Icon-only on all devices */}
                            <button
                              onClick={() => {
                                setIsPlayingPreview(false)
                                setPreviewError(false)
                                setDirectUrlFailed(false)
                              }}
                              className="absolute top-3 right-3 bg-black/85 hover:bg-black text-white p-2 sm:p-2.5 rounded-full border border-white/20 backdrop-blur-md z-30 flex items-center justify-center shadow-2xl transition-all hover:scale-110 active:scale-95"
                              title="Close Video Preview"
                              aria-label="Close Video Preview"
                            >
                              <X className="w-4 h-4 text-white" />
                            </button>
                          </div>
                        ) : (
                          <>
                            {metadata.thumbnail ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={getThumbnailSrc(metadata.thumbnail, metadata.platform)}
                                alt=""
                                onError={(e) => { e.currentTarget.style.opacity = '0'; }}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center p-8 text-center space-y-2">
                                <Film className="w-12 h-12 text-white/30" />
                                <span className="text-xs text-brand-text-muted font-mono">Stream Ready</span>
                              </div>
                            )}

                            {/* Top Gradient Overlay */}
                            <div className="absolute inset-0 bg-gradient-to-t from-[#0b0d13]/90 via-black/25 to-black/40 pointer-events-none" />

                            {/* Interactive Play Button overlay */}
                            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 gap-2">
                              <button
                                onClick={() => setIsPlayingPreview(true)}
                                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary/90 hover:bg-primary text-white flex items-center justify-center shadow-[0_0_35px_rgba(99,102,241,0.65)] hover:scale-110 active:scale-95 transition-all duration-300 group/btn border-2 border-white/30"
                                title="Play Video Preview"
                              >
                                <Play className="w-6 h-6 fill-white text-white ml-1" />
                              </button>
                              <span className="text-[11px] font-bold text-white/90 bg-black/70 px-3 py-1 rounded-full border border-white/10 backdrop-blur-md shadow-lg">
                                Watch Preview
                              </span>
                            </div>

                            {/* Platform & HD Badge */}
                            <div className="absolute top-4 left-4 flex items-center gap-2 z-20">
                              <Badge className="bg-black/80 backdrop-blur-md border border-white/15 text-white font-bold text-[10px] uppercase tracking-wider px-2.5 py-1 flex items-center gap-1.5 shadow-lg">
                                <PlatformIcon platform={metadata.platform} className="w-3.5 h-3.5" />
                                <span>{metadata.platform}</span>
                              </Badge>
                              <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5">
                                HD Ready
                              </Badge>
                            </div>

                            {/* Duration Badge */}
                            {metadata.duration && metadata.duration !== "N/A" && (
                              <Badge className="absolute bottom-4 right-4 bg-black/90 backdrop-blur-md border border-white/15 px-2.5 py-1 font-mono text-xs text-white z-20 shadow-lg">
                                <Clock className="w-3 h-3 mr-1 text-primary" />
                                {metadata.duration}
                              </Badge>
                            )}
                          </>
                        )}

                      </div>
                    </div>

                    {/* Metadata & Format Selection Details */}
                    <div className="flex-1 p-5 sm:p-7 lg:p-8 space-y-5 sm:space-y-6 min-w-0 bg-gradient-to-b from-[#0f1119] via-[#0c0e15] to-[#090a10]">

                      {/* Title & Author */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-2.5 py-1">
                            <PlatformIcon platform={metadata.platform} className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
                              {metadata.platform} Verified
                            </span>
                          </div>
                        </div>
                        <h3 className="text-lg sm:text-xl lg:text-2xl font-headline font-bold leading-snug text-white/95 line-clamp-2 tracking-tight" title={metadata.title}>
                          {metadata.title}
                        </h3>
                        <p className="text-white/40 font-medium text-xs sm:text-sm flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-white/30" />
                          <span>{metadata.author || "Original Creator"}</span>
                        </p>
                      </div>

                      {/* Formatting Selector Tabs */}
                      <Tabs defaultValue="video" className="w-full space-y-4">
                        <div className="relative rounded-2xl bg-[#0a0c14] border border-white/[0.06] p-1 shadow-[inset_0_1px_3px_rgba(0,0,0,0.6),0_1px_0_rgba(255,255,255,0.03)]">
                          <TabsList className="bg-transparent p-0 rounded-[0.85rem] w-full grid grid-cols-2 gap-1 h-auto">
                            <TabsTrigger
                              value="video"
                              className="relative min-h-[42px] sm:min-h-[44px] rounded-xl font-semibold text-[13px] sm:text-sm py-2.5 px-3 sm:px-4 gap-2 text-white/50 hover:text-white/70 transition-all duration-200 whitespace-nowrap data-[state=active]:bg-gradient-to-b data-[state=active]:from-[#4f46e5] data-[state=active]:to-[#4338ca] data-[state=active]:text-white data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_4px_16px_rgba(79,70,229,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] data-[state=active]:font-bold"
                            >
                              <FileVideo className="w-4 h-4 sm:w-[18px] sm:h-[18px] shrink-0" aria-hidden="true" strokeWidth={2} />
                              <span>Video Formats ({videoFormats.length})</span>
                            </TabsTrigger>
                            <TabsTrigger
                              value="audio"
                              className="relative min-h-[42px] sm:min-h-[44px] rounded-xl font-semibold text-[13px] sm:text-sm py-2.5 px-3 sm:px-4 gap-2 text-white/50 hover:text-white/70 transition-all duration-200 whitespace-nowrap data-[state=active]:bg-gradient-to-b data-[state=active]:from-[#4f46e5] data-[state=active]:to-[#4338ca] data-[state=active]:text-white data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_4px_16px_rgba(79,70,229,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] data-[state=active]:font-bold"
                            >
                              <Music className="w-4 h-4 sm:w-[18px] sm:h-[18px] shrink-0" aria-hidden="true" strokeWidth={2} />
                              <span>Audio Extracts ({audioFormats.length})</span>
                            </TabsTrigger>
                          </TabsList>
                        </div>

                        {/* Video Formats List */}
                        <TabsContent value="video" className="space-y-2 focus-visible:ring-0 mt-1">
                          {videoFormats.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-0.5 scrollbar-thin">
                              {videoFormats.map((format, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => handleDownload(format)}
                                  className="flex items-center justify-between text-left bg-white/[0.03] border border-white/[0.06] hover:bg-primary/10 hover:border-primary/30 p-3 sm:p-3.5 rounded-xl transition-all duration-200 group min-h-[4rem] focus:outline-none focus:ring-2 focus:ring-primary/40 gap-2"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary group-hover:bg-primary group-hover:text-white group-hover:border-primary transition-all duration-200">
                                      <Download className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                                    </div>
                                    <div className="flex flex-col leading-tight min-w-0 flex-1">
                                      <span className="font-semibold text-[13px] sm:text-sm text-white/90 truncate">
                                        {formatQualityLabel(format.quality)}
                                      </span>
                                      <span className="text-[10px] sm:text-[11px] font-medium text-white/30 uppercase mt-0.5 tracking-wide">
                                        {format.ext.toUpperCase()} {format.resolution ? `· ${format.resolution}` : '· Direct MP4'}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {format.size && format.size !== 'Auto' && format.size !== 'Size unavailable' && (
                                      <span className="text-[10px] sm:text-[11px] font-mono font-semibold text-emerald-400/90 bg-emerald-500/8 border border-emerald-500/15 px-1.5 py-0.5 rounded-md">
                                        ~{format.size}
                                      </span>
                                    )}
                                    <span className="text-primary/80 group-hover:text-primary font-semibold text-xs group-hover:translate-x-0.5 transition-all flex items-center gap-0.5">
                                      Save <ArrowRight className="w-3 h-3" />
                                    </span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="py-10 text-center text-white/25 text-xs font-medium">No video streams detected for this URL.</div>
                          )}
                        </TabsContent>

                        {/* Audio Formats List */}
                        <TabsContent value="audio" className="space-y-2 focus-visible:ring-0 mt-1">
                          {audioFormats.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-0.5 scrollbar-thin">
                              {audioFormats.map((format, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => handleDownload(format)}
                                  className="flex items-center justify-between text-left bg-white/[0.03] border border-white/[0.06] hover:bg-indigo-500/10 hover:border-indigo-500/30 p-3 sm:p-3.5 rounded-xl transition-all duration-200 group min-h-[4rem] focus:outline-none focus:ring-2 focus:ring-indigo-500/40 gap-2"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-all duration-200">
                                      <Music className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                                    </div>
                                    <div className="flex flex-col leading-tight min-w-0 flex-1">
                                      <span className="font-semibold text-[13px] sm:text-sm text-white/90 truncate">
                                        {format.quality}
                                      </span>
                                      <span className="text-[10px] sm:text-[11px] font-medium text-white/30 uppercase mt-0.5 tracking-wide">
                                        {format.ext.toUpperCase()} Audio Extract
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {format.size && format.size !== 'Auto' && format.size !== 'Size unavailable' && (
                                      <span className="text-[10px] sm:text-[11px] font-mono font-semibold text-emerald-400/90 bg-emerald-500/8 border border-emerald-500/15 px-1.5 py-0.5 rounded-md">
                                        ~{format.size}
                                      </span>
                                    )}
                                    <span className="text-indigo-400/80 group-hover:text-indigo-400 font-semibold text-xs group-hover:translate-x-0.5 transition-all flex items-center gap-0.5">
                                      Save <ArrowRight className="w-3 h-3" />
                                    </span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="py-10 text-center text-white/25 text-xs font-medium">No audio streams detected for this URL.</div>
                          )}
                        </TabsContent>
                      </Tabs>

                      {/* Security & Speed Tag */}
                      <div className="flex items-center gap-3 pt-3 text-[10px] sm:text-[11px] font-medium text-white/25 border-t border-white/[0.04]">
                        <span className="flex items-center gap-1 text-emerald-500/60">
                          <ShieldCheck className="w-3.5 h-3.5" /> Lossless Direct Extraction
                        </span>
                        <span className="text-white/10">·</span>
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-3.5 h-3.5" /> Fast FFmpeg Stream Demuxing
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Real-time Conversion Progress & Download State with Continuous Glowing Meteor Border */}
          {downloadingJob && (
            <div className="animate-in zoom-in-[0.98] fade-in duration-500 max-w-xl mx-auto relative group">
              {/* Continuous Ambient Background Glow */}
              <div
                className={`absolute inset-0 blur-3xl rounded-[2.5rem] opacity-80 pointer-events-none transition-all duration-700 ${
                  downloadingJob.status === 'completed'
                    ? 'bg-gradient-to-r from-emerald-500/25 via-teal-500/20 to-[#00e5ff]/25'
                    : downloadingJob.status === 'failed'
                    ? 'bg-gradient-to-r from-red-500/25 via-rose-500/20 to-amber-500/25'
                    : 'bg-gradient-to-r from-[#e019ff]/25 via-[#8a2be2]/20 to-[#00e5ff]/25'
                }`}
              />

              {/* Continuous Animated Glowing Meteor Tracing Border */}
              <div className="absolute inset-[-1.5px] rounded-[2.3rem] pointer-events-none overflow-hidden glowing-border-mask z-20">
                <div
                  className="animate-meteor"
                  style={{
                    background:
                      downloadingJob.status === 'completed'
                        ? 'conic-gradient(from 0deg, transparent 45%, rgba(16, 185, 129, 0.15) 65%, rgba(52, 211, 153, 0.9) 88%, #00e5ff 100%)'
                        : downloadingJob.status === 'failed'
                        ? 'conic-gradient(from 0deg, transparent 45%, rgba(239, 68, 68, 0.15) 65%, rgba(244, 63, 94, 0.9) 88%, #ff5252 100%)'
                        : 'conic-gradient(from 0deg, transparent 45%, rgba(30, 58, 138, 0.2) 65%, rgba(59, 130, 246, 0.85) 88%, #00e5ff 100%)',
                  }}
                />
              </div>

              {/* Inner Card Container */}
              <Card className="relative z-10 bg-[#08070d] border border-white/[0.08] shadow-[0_12px_45px_rgba(0,0,0,0.95)] backdrop-blur-2xl overflow-hidden rounded-[2.2rem]">
                <CardContent className="p-8 sm:p-10 space-y-7 text-center relative">

                  {/* Status Icon Header */}
                  <div className="space-y-2">
                    {downloadingJob.status === 'completed' ? (
                      <div className="mx-auto w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-3 shadow-[0_0_25px_rgba(16,185,129,0.3)] animate-pulse">
                        <CheckCircle2 className="w-8 h-8" />
                      </div>
                    ) : downloadingJob.status === 'failed' ? (
                      <div className="mx-auto w-16 h-16 rounded-3xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-3">
                        <AlertTriangle className="w-8 h-8" />
                      </div>
                    ) : (
                      <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-3">
                        <Loader2 className="w-7 h-7 animate-spin text-primary" />
                      </div>
                    )}

                    <h4 className="font-headline font-black text-2xl sm:text-3xl text-white">
                      {downloadingJob.status === 'completed' && 'Download Ready!'}
                      {downloadingJob.status === 'failed' && 'Conversion Interrupted'}
                      {downloadingJob.status === 'queued' && `Preparing ${downloadingJob.formatQuality || 'Media'} ${downloadingJob.formatExt?.toUpperCase() || 'MP4'}...`}
                      {downloadingJob.status === 'active' && (
                        downloadingJob.progress >= 96
                          ? 'Validating Stream Integrity with FFprobe...'
                          : downloadingJob.progress >= 92
                          ? 'Multiplexing & Packaging Media Container...'
                          : 'Downloading Stream Packets...'
                      )}
                    </h4>
                    
                    <p className="text-brand-text-muted text-xs sm:text-sm max-w-md mx-auto">
                      {downloadingJob.status === 'completed' && (
                        downloadingJob.result?.size
                          ? `Assembled lossless file (${downloadingJob.result.size}) • ${downloadingJob.formatQuality || 'Direct Stream'} • ${downloadingJob.formatExt?.toUpperCase() || 'MP4'}`
                          : 'Your file has been assembled in high quality. Click below if download did not start.'
                      )}
                      {downloadingJob.status === 'failed' && (downloadingJob.error || 'Server error occurred during media conversion.')}
                      {downloadingJob.status === 'queued' && 'Establishing direct connection to stream source...'}
                      {downloadingJob.status === 'active' && (
                        downloadingJob.progress >= 96
                          ? 'Running FFprobe stream inspection and filesystem byte validation...'
                          : downloadingJob.progress >= 92
                          ? 'FFmpeg assembling audio & video streams into high-quality MP4...'
                          : 'Fetching media packets with parallel acceleration...'
                      )}
                    </p>
                  </div>

                  {/* Progress Indicator */}
                  {downloadingJob.status !== 'completed' && downloadingJob.status !== 'failed' && (
                    <div className="space-y-4 pt-1">
                      <div className="relative py-1">
                        <Progress value={downloadingJob.progress} className="h-3 bg-white/5 rounded-full" />
                        <div className="absolute inset-0 bg-primary/25 blur-xl -z-10 opacity-50" />
                      </div>
                      <div className="flex items-center justify-between text-xs px-1">
                        <span className="text-brand-text-muted font-medium">
                          {downloadingJob.formatQuality ? `${downloadingJob.formatQuality} (${downloadingJob.formatExt?.toUpperCase()})` : 'Processing'}
                        </span>
                        <span className="font-mono text-primary font-bold text-lg tabular-nums">
                          {Math.round(downloadingJob.progress)}%
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-3 pt-2">
                    {downloadingJob.status === 'completed' && downloadingJob.result && (
                      <>
                        <Button
                          asChild
                          className="w-full h-14 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-2xl shadow-xl shadow-emerald-500/25 gap-2 text-base active:scale-[0.99] transition-transform"
                        >
                          <a
                            href={downloadingJob.result.downloadUrl.startsWith('http') ? downloadingJob.result.downloadUrl : `${getStoredApiUrl()}${downloadingJob.result.downloadUrl}`}
                            download={downloadingJob.result.filename}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Download className="w-5 h-5" />
                            Save File ({downloadingJob.result.size || 'Download'})
                          </a>
                        </Button>
                      </>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 justify-center items-stretch sm:items-center mt-1 w-full">
                      <Button
                        onClick={clearInput}
                        variant="secondary"
                        className="w-full sm:w-auto rounded-xl font-bold text-xs sm:text-sm gap-2 hover:bg-white/10 px-5 h-12 border border-white/[0.08] transition-all"
                      >
                        <RotateCcw className="w-4 h-4 text-primary" />
                        <span>Convert another link</span>
                      </Button>

                      {downloadingJob.status === 'completed' && downloadingJob.result && (
                        <Button
                          asChild
                          variant="ghost"
                          className="w-full sm:w-auto rounded-xl font-bold text-xs sm:text-sm gap-2 hover:bg-white/10 px-5 h-12 border border-white/[0.06] text-brand-text-muted hover:text-white transition-all"
                        >
                          <a
                            href={(() => {
                              const u = downloadingJob.result.downloadUrl
                              const base = u.startsWith('http') ? u : `${getStoredApiUrl()}${u}`
                              return base.includes('?') ? `${base}&inline=true` : `${base}?inline=true`
                            })()}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span>Direct Stream Link</span>
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>

      {/* Sticky Bottom Bar for Mobile */}
      {metadata && !downloadingJob && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-brand-surface/95 backdrop-blur-xl border-t border-brand-border p-3.5 z-40 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            {metadata.thumbnail && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={getThumbnailSrc(metadata.thumbnail, metadata.platform)}
                className="w-10 h-10 object-cover rounded-lg border border-white/10 shrink-0"
                alt=""
                referrerPolicy="no-referrer"
              />
            )}
            <div className="min-w-0 leading-tight">
              <p className="text-xs font-bold text-white truncate">{metadata.title}</p>
              <p className="text-[10px] text-brand-text-muted">Formats available</p>
            </div>
          </div>
          <Button
            onClick={() => {
              const bestFormat = videoFormats[0] || audioFormats[0] || metadata.formats[0]
              if (bestFormat) {
                handleDownload(bestFormat)
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
              }
            }}
            className="bg-primary hover:bg-primary/95 text-white font-bold text-xs h-10 px-4 rounded-xl shrink-0"
          >
            Download Best
          </Button>
        </div>
      )}

      {/* Backend / Colab Settings Modal */}
      <ServerSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      {/* Share Engine QR Code Modal */}
      <QrCodeShareModal
        open={qrModalOpen}
        onOpenChange={setQrModalOpen}
        engineUrl={activeApiUrl}
        isColab={isColab}
      />

      <Footer />
      <ChatAssistant hasStickyBar={!!metadata && !downloadingJob} />
    </div>
  )
}
