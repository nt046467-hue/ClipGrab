"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { getQrCodeApiUrl, copyToClipboard, shareEngineUrl } from "@/lib/qr-generator"
import {
  QrCode,
  Copy,
  Check,
  Share2,
  Smartphone,
  Zap,
  Cloud,
  X,
  ExternalLink,
  ShieldCheck
} from "lucide-react"

interface QrCodeShareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  engineUrl: string
  isColab: boolean
}

export function QrCodeShareModal({ open, onOpenChange, engineUrl, isColab }: QrCodeShareModalProps) {
  const [copiedRaw, setCopiedRaw] = useState(false)
  const [copiedWebLink, setCopiedWebLink] = useState(false)
  const [qrLoaded, setQrLoaded] = useState(false)
  const { toast } = useToast()

  // Generate web auto-connect link
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const autoConnectUrl = origin && engineUrl ? `${origin}?engine=${encodeURIComponent(engineUrl)}` : engineUrl
  const qrTargetUrl = autoConnectUrl || engineUrl

  const handleCopyRaw = async () => {
    const success = await copyToClipboard(engineUrl)
    if (success) {
      setCopiedRaw(true)
      toast({
        title: "Engine URL Copied!",
        description: "Paste this backend URL on any device."
      })
      setTimeout(() => setCopiedRaw(false), 2500)
    }
  }

  const handleCopyWebLink = async () => {
    const success = await copyToClipboard(autoConnectUrl)
    if (success) {
      setCopiedWebLink(true)
      toast({
        title: "Auto-Connect Web Link Copied! 🚀",
        description: "Opening this link on any device will auto-connect to this Colab engine."
      })
      setTimeout(() => setCopiedWebLink(false), 2500)
    }
  }

  const handleShare = async () => {
    const result = await shareEngineUrl("ClipGrab Colab Fast Engine", autoConnectUrl)
    if (result === "copied") {
      toast({
        title: "Link Copied to Clipboard!",
        description: "Shared link copied."
      })
    } else if (result === "shared") {
      toast({
        title: "Share initiated!",
        description: "Sent via system share."
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full max-w-md bg-brand-surface/95 backdrop-blur-2xl border border-white/10 text-white shadow-2xl p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] overflow-x-hidden overflow-y-auto max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <QrCode className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm sm:text-base font-headline font-black text-white truncate">
                Share Engine to Mobile
              </DialogTitle>
              <DialogDescription className="text-[10.5px] sm:text-[11px] text-brand-text-muted truncate">
                Scan with phone camera to connect
              </DialogDescription>
            </div>
          </div>
          <Badge
            variant="outline"
            className={`text-[9px] sm:text-[10px] px-2 sm:px-2.5 py-0.5 font-bold shrink-0 ${
              isColab
                ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                : "bg-primary/10 text-primary border-primary/30"
            }`}
          >
            {isColab ? "⚡ Colab Active" : "☁️ Cloud Engine"}
          </Badge>
        </div>

        {/* QR Code Container */}
        <div className="py-3 sm:py-4 flex flex-col items-center justify-center space-y-3 sm:space-y-4">
          <div className="relative p-3 sm:p-4 bg-white rounded-2xl shadow-xl border-4 border-white/[0.1] flex items-center justify-center max-w-[200px] sm:max-w-[230px] aspect-square w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getQrCodeApiUrl(qrTargetUrl, 220)}
              alt="Engine QR Code"
              className="w-full h-full max-w-full object-contain"
              onLoad={() => setQrLoaded(true)}
            />
            <div className="absolute inset-0 border-2 border-primary/20 rounded-2xl pointer-events-none" />
          </div>

          <div className="flex items-center justify-center gap-1.5 text-[11px] sm:text-xs text-brand-text-muted/80 text-center font-medium px-2">
            <Smartphone className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Scan QR with phone camera to auto-connect!</span>
          </div>
        </div>

        {/* Active URL display */}
        <div className="bg-black/40 border border-white/[0.06] rounded-xl p-3 space-y-1 overflow-hidden">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-brand-text-muted/60">
            <span>Target Engine URL</span>
            <span className="text-emerald-400 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Ready
            </span>
          </div>
          <p className="font-mono text-[11px] sm:text-xs text-white/90 break-all select-all leading-snug">
            {engineUrl || "http://127.0.0.1:8080"}
          </p>
        </div>

        {/* Action Buttons (Stacked on Mobile, Side-by-side on sm) */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1 w-full">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopyRaw}
            className="w-full sm:flex-1 min-h-[44px] h-11 rounded-xl text-xs font-bold border-white/10 hover:bg-white/5 gap-1.5 text-white active:scale-[0.98] transition-transform"
          >
            {copiedRaw ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedRaw ? "Copied URL!" : "Copy Engine URL"}
          </Button>

          <Button
            type="button"
            onClick={handleShare}
            className="w-full sm:flex-1 min-h-[44px] h-11 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-black gap-1.5 shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-transform"
          >
            <Share2 className="w-3.5 h-3.5" />
            Share Link
          </Button>
        </div>

        {/* Copy Auto-Connect Web Link */}
        <div className="pt-1 w-full">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCopyWebLink}
            className="w-full min-h-[44px] h-11 rounded-xl text-xs font-bold gap-1.5 hover:bg-white/10 border border-white/[0.05] active:scale-[0.98] transition-transform"
          >
            {copiedWebLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ExternalLink className="w-3.5 h-3.5" />}
            {copiedWebLink ? "Copied Auto-Connect Link!" : "Copy Auto-Connect Web Link"}
          </Button>
        </div>

        {/* Close Button */}
        <div className="pt-1 text-center">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-xs text-brand-text-muted hover:text-white transition-colors py-2 px-4 rounded-lg min-h-[36px] active:opacity-70"
          >
            Close / Hide QR
          </button>
        </div>

      </DialogContent>
    </Dialog>
  )
}
