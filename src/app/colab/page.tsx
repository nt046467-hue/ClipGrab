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

const PIP_INSTALL_CMD = '!pip install -q -U "yt-dlp[default]" fastapi uvicorn pycloudflared pydantic'

export default function ColabGuidePage() {
  const [activeUrl, setActiveUrl] = useState("")
  const [isColab, setIsColab] = useState(false)
  const [inputUrl, setInputUrl] = useState("")
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; latency: number; message: string } | null>(null)
  const [copiedCell, setCopiedCell] = useState(false)
  const [copiedFullCode, setCopiedFullCode] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [siteOrigin, setSiteOrigin] = useState("")
  const [workerCode, setWorkerCode] = useState("")
  const [isLoadingWorker, setIsLoadingWorker] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    const current = getStoredApiUrl()
    const custom = isCustomApiUrlActive()
    setActiveUrl(current)
    setIsColab(custom)
    setInputUrl(custom ? current : "")

    if (typeof window !== "undefined") {
      setSiteOrigin(window.location.origin)
    }

    fetch("/colab_worker.py")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => {
        setWorkerCode(text)
        setIsLoadingWorker(false)
      })
      .catch((err) => {
        console.error("Failed to load /colab_worker.py:", err)
        setIsLoadingWorker(false)
      })
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

  const originUrl = siteOrigin || (typeof window !== "undefined" ? window.location.origin : "https://clipgrab.net")
  const threeLineCell = `${PIP_INSTALL_CMD}\n!wget -q -O colab_worker.py ${originUrl}/colab_worker.py\n%run colab_worker.py`

  const copyThreeLineCell = async () => {
    const success = await copyToClipboard(threeLineCell)
    if (success) {
      setCopiedCell(true)
      toast({
        title: "Copied 3-Line Colab Code! 📋",
        description: "Paste into a Google Colab cell and press Run."
      })
      setTimeout(() => setCopiedCell(false), 2500)
    }
  }

  const copyFullCode = async () => {
    let code = workerCode
    if (!code) {
      try {
        const res = await fetch("/colab_worker.py")
        code = await res.text()
        setWorkerCode(code)
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Error loading script",
          description: "Could not fetch /colab_worker.py"
        })
        return
      }
    }
    const full = `${PIP_INSTALL_CMD}\n\n${code}`
    const success = await copyToClipboard(full)
    if (success) {
      setCopiedFullCode(true)
      toast({
        title: "Copied Full Python Code! 📋",
        description: "Complete worker script with pip dependencies copied."
      })
      setTimeout(() => setCopiedFullCode(false), 2500)
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
                      className={`text-[10px] font-bold shrink-0 ${isColab ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-primary/20 text-primary border-primary/30"
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
                className={`p-3.5 rounded-xl border flex items-center justify-between text-xs animate-in fade-in ${testResult.success
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
                  Click the <strong>Copy 3-Line Cell</strong> button below, paste it into the Colab cell, and click the <strong>▶️ Play button</strong> to start the worker.
                </p>
                <div className="pt-2 flex flex-col gap-2">
                  <Button
                    onClick={copyThreeLineCell}
                    size="sm"
                    className="w-full text-xs font-bold bg-amber-500 hover:bg-amber-600 text-black rounded-xl gap-1.5"
                  >
                    {copiedCell ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCell ? "Copied 3-Line Cell!" : "Copy 3-Line Cell"}
                  </Button>
                  <Button
                    onClick={copyFullCode}
                    size="sm"
                    variant="outline"
                    className="w-full text-xs font-bold border-white/10 text-white rounded-xl gap-1.5 hover:bg-white/5"
                  >
                    {copiedFullCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedFullCode ? "Copied Full Code!" : "Copy full code"}
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

        {/* 3-Line Colab Cell Snippet Box */}
        <Card className="bg-black/60 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-4 sm:p-5 bg-white/[0.02] border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">Google Colab 3-Line Cell (Recommended)</h3>
                <p className="text-[11px] text-brand-text-muted">Fetches and runs the fixed worker directly in your Google Colab instance</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={copyThreeLineCell}
                className="h-10 px-5 bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs rounded-xl gap-1.5 shadow-lg shadow-amber-500/20 shrink-0"
              >
                {copiedCell ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedCell ? "Copied 3-Line Cell!" : "Copy 3-Line Cell"}
              </Button>
              <Button
                onClick={copyFullCode}
                variant="outline"
                className="h-10 px-4 border-white/10 text-white hover:bg-white/5 font-bold text-xs rounded-xl gap-1.5 shrink-0"
              >
                {copiedFullCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copiedFullCode ? "Copied Full Code!" : "Copy full code"}
              </Button>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <pre className="text-xs sm:text-sm font-mono text-amber-300 leading-relaxed select-all whitespace-pre bg-black/40 p-4 rounded-xl border border-white/[0.04]">
              {threeLineCell}
            </pre>
          </div>
        </Card>

        {/* Full Python Worker Script Box */}
        <Card className="bg-black/60 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-4 sm:p-5 bg-white/[0.02] border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">Full Python Worker Source (public/colab_worker.py)</h3>
                <p className="text-[11px] text-brand-text-muted">Exact file served directly at runtime with zero JavaScript string escaping</p>
              </div>
            </div>

            <Button
              onClick={copyFullCode}
              variant="outline"
              className="h-10 px-4 border-white/10 text-white hover:bg-white/5 font-bold text-xs rounded-xl gap-1.5 shrink-0"
            >
              {copiedFullCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copiedFullCode ? "Copied Full Code!" : "Copy full code"}
            </Button>
          </div>

          <div className="p-4 sm:p-6">
            <pre className="text-xs font-mono text-white/80 max-h-96 overflow-y-auto leading-relaxed select-all whitespace-pre bg-black/40 p-4 rounded-xl border border-white/[0.04]">
              {isLoadingWorker ? "Loading public/colab_worker.py..." : workerCode}
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
