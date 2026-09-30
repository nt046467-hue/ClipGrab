"use client"

import Link from "next/link"
import { Download, Zap, QrCode } from "lucide-react"
import { useState, useEffect } from "react"
import { getStoredApiUrl, isCustomApiUrlActive } from "@/lib/api-config"
import { ServerSettingsModal } from "@/components/ServerSettingsModal"
import { QrCodeShareModal } from "@/components/QrCodeShareModal"
import { Button } from "@/components/ui/button"

export function Navbar() {
  const [engineStatus, setEngineStatus] = useState<'online' | 'degraded' | 'down'>('online')
  const [isColabActive, setIsColabActive] = useState(false)
  const [apiUrl, setApiUrl] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)

  useEffect(() => {
    const updateUrl = () => {
      const current = getStoredApiUrl()
      setApiUrl(current)
      setIsColabActive(isCustomApiUrlActive())
    }

    updateUrl()
    window.addEventListener("clipgrab_api_url_changed", updateUrl)
    return () => window.removeEventListener("clipgrab_api_url_changed", updateUrl)
  }, [])

  useEffect(() => {
    let timer: NodeJS.Timeout
    const checkHealth = async () => {
      const activeUrl = getStoredApiUrl()
      
      // Don't attempt fetch if URL is clearly localhost default and unreachable
      // This prevents console spam for users who haven't set up a backend
      const startTime = Date.now()
      try {
        const response = await fetch(`${activeUrl}/api/health`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) throw new Error('Unhealthy')
        
        const latency = Date.now() - startTime
        setLatencyMs(latency)
        if (latency >= 2500) {
          setEngineStatus('degraded')
        } else {
          setEngineStatus('online')
        }
        timer = setTimeout(checkHealth, 25000)
      } catch (err) {
        setLatencyMs(null)
        setEngineStatus('down')
        // Back off to 30s when down to avoid flooding console with ERR_NAME_NOT_RESOLVED
        timer = setTimeout(checkHealth, 30000)
      }
    }

    checkHealth()
    return () => clearTimeout(timer)
  }, [apiUrl])

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/60 backdrop-blur-2xl border-b border-white/[0.06] transition-all duration-300">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 sm:gap-3 group shrink-0">
            <div className="relative flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-gradient-to-tr from-primary via-indigo-500 to-accent shadow-[0_0_20px_rgba(99,102,241,0.35)] group-hover:scale-105 group-hover:rotate-3 transition-all duration-300">
              <Download className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              <div className="absolute inset-0 rounded-xl sm:rounded-2xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
            <div className="flex flex-col">
              <span className="font-headline text-lg sm:text-xl font-black tracking-tight text-white leading-none">
                Clip<span className="text-primary bg-clip-text bg-gradient-to-r from-primary to-accent">Grab</span>
              </span>
              <span className="text-[8px] sm:text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest mt-0.5 sm:mt-1">Media Studio</span>
            </div>
          </Link>
          
          {/* Desktop Links & Engine Controls */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            <Link
              href="/"
              className="text-sm font-semibold text-white/90 hover:text-primary transition-colors px-2 py-1 hidden sm:block"
            >
              Home
            </Link>
            
            {/* Interactive Engine Switcher / Status Pill */}
            <button
              onClick={() => setSettingsOpen(true)}
              title="Click to configure backend engine or Google Colab"
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full border transition-all duration-200 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer ${
                isColabActive
                  ? "bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.15)]"
                  : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06] text-white"
              }`}
            >
              <span className="relative flex h-2 w-2">
                {engineStatus === 'online' && (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </>
                )}
                {engineStatus === 'degraded' && (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </>
                )}
                {engineStatus === 'down' && (
                  <>
                    <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </>
                )}
              </span>

              <span className="text-[10px] sm:text-[11px] font-bold tracking-wide flex items-center gap-1">
                {isColabActive ? (
                  <>
                    <Zap className="w-3 h-3 text-amber-400 shrink-0 fill-amber-400" />
                    <span>Colab Fast</span>
                  </>
                ) : (
                  <span>Cloud Engine</span>
                )}
                {latencyMs !== null && engineStatus === 'online' && (
                  <span className="font-mono text-[9px] text-white/50 hidden md:inline">({latencyMs}ms)</span>
                )}
              </span>
            </button>

            {/* Quick Share QR Code Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setQrOpen(true)}
              className="h-7 sm:h-9 px-2 sm:px-3 rounded-xl border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/15 text-amber-300 text-[11px] sm:text-xs font-bold gap-1 sm:gap-1.5"
              title="Share engine via QR Code to mobile or other devices"
            >
              <QrCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden xs:inline sm:inline">QR Sync</span>
            </Button>
          </div>
        </div>
      </nav>

      {/* Backend / Colab Settings Modal */}
      <ServerSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      {/* QR Code Share Modal */}
      <QrCodeShareModal
        open={qrOpen}
        onOpenChange={setQrOpen}
        engineUrl={apiUrl}
        isColab={isColabActive}
      />
    </>
  )
}
