"use client"

import Link from "next/link"
import { Download, Zap, QrCode, Film, MoreHorizontal, ChevronRight, Settings } from "lucide-react"
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)

  // Safety: Ensure pointer-events on body are always cleaned up when modals close
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const timer = setTimeout(() => {
        if (document.body.style.pointerEvents === 'none') {
          document.body.style.pointerEvents = ''
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [settingsOpen, qrOpen, mobileMenuOpen])

  useEffect(() => {
    const handleCloseMenu = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-mobile-menu]')) {
        setMobileMenuOpen(false)
      }
    }
    if (mobileMenuOpen) {
      window.addEventListener('mousedown', handleCloseMenu)
      window.addEventListener('touchstart', handleCloseMenu)
    }
    return () => {
      window.removeEventListener('mousedown', handleCloseMenu)
      window.removeEventListener('touchstart', handleCloseMenu)
    }
  }, [mobileMenuOpen])

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
      } catch {
        setLatencyMs(null)
        setEngineStatus('down')
        timer = setTimeout(checkHealth, 30000)
      }
    }

    checkHealth()
    return () => clearTimeout(timer)
  }, [apiUrl])

  const openLibrary = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clipgrab_open_library'))
    }
  }

  return (
    <>
      <nav 
        className="fixed top-0 left-0 right-0 z-40 bg-[#07080d]/85 backdrop-blur-2xl border-b border-white/[0.07] transition-all duration-300"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        }}
      >
        <div className="max-w-7xl mx-auto h-14 sm:h-20 flex items-center justify-between gap-2">
          
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 sm:gap-3 group shrink-0 min-w-0">
            <div className="relative flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-gradient-to-tr from-primary via-indigo-500 to-accent shadow-[0_0_20px_rgba(99,102,241,0.35)] group-hover:scale-105 group-hover:rotate-3 transition-all duration-300 shrink-0">
              <Download className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              <div className="absolute inset-0 rounded-xl sm:rounded-2xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-headline text-base sm:text-xl font-black tracking-tight text-white leading-none whitespace-nowrap">
                Clip<span className="text-primary bg-clip-text bg-gradient-to-r from-primary to-accent">Grab</span>
              </span>
              <span className="text-[7.5px] sm:text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest mt-0.5 sm:mt-1 whitespace-nowrap">
                Media Studio
              </span>
            </div>
          </Link>
          
          {/* Desktop Navigation (>= 640px) */}
          <div className="hidden sm:flex items-center gap-2 sm:gap-2.5">
            {/* Library / Player Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={openLibrary}
              className="h-9 px-3.5 rounded-xl bg-white/[0.04] hover:bg-white/10 text-white font-semibold text-xs sm:text-sm gap-1.5 border border-white/5 cursor-pointer active:scale-95"
              title="Open ClipGrab Player & Saved Downloads"
            >
              <Film className="w-4 h-4 text-primary" />
              <span>Player &amp; Library</span>
            </Button>
            
            {/* Interactive Engine Switcher / Status Pill */}
            <button
              onClick={() => setSettingsOpen(true)}
              title="Click to configure backend engine or Google Colab"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer ${
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

              <span className="text-[11px] font-bold tracking-wide flex items-center gap-1">
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
              className="h-9 px-3 rounded-xl border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/15 text-amber-300 text-xs font-bold gap-1.5 cursor-pointer active:scale-95"
              title="Share engine via QR Code to mobile or other devices"
            >
              <QrCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>QR Sync</span>
            </Button>
          </div>

          {/* Mobile Header Actions (< 640px) */}
          <div className="flex sm:hidden items-center gap-1.5 shrink-0">
            {/* Direct Player & Library Access */}
            <button
              type="button"
              onClick={openLibrary}
              aria-label="Open ClipGrab Player and Library"
              className="h-8.5 px-2.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/30 text-white font-semibold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            >
              <Film className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="font-bold text-[11px] tracking-tight text-primary-foreground">Player</span>
            </button>

            {/* Compact Secondary Menu (•••) */}
            <div data-mobile-menu className="relative">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-label="More options and engine settings"
                aria-expanded={mobileMenuOpen}
                className="relative w-8.5 h-8.5 rounded-xl bg-white/[0.04] hover:bg-white/10 border border-white/10 text-white/80 hover:text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer"
              >
                <MoreHorizontal className="w-4 h-4" />
                {/* Status Indicator Dot on Menu */}
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  {engineStatus === 'online' && (
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 ring-2 ring-[#07080d]"></span>
                  )}
                  {engineStatus === 'degraded' && (
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500 ring-2 ring-[#07080d]"></span>
                  )}
                  {engineStatus === 'down' && (
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 ring-2 ring-[#07080d]"></span>
                  )}
                </span>
              </button>

              {/* Controlled Dropdown Menu */}
              {mobileMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-[65]"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute right-0 top-full mt-2 w-56 p-1.5 rounded-2xl bg-[#0e111a]/95 border border-white/12 shadow-[0_12px_40px_rgba(0,0,0,0.85)] backdrop-blur-2xl text-white z-[70] animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-2.5 py-1 text-[10px] font-bold text-white/40 uppercase tracking-wider">
                      Engine &amp; Settings
                    </div>

                    {/* Cloud Engine / Colab Switcher */}
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false)
                        setSettingsOpen(true)
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors cursor-pointer text-xs text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2 shrink-0">
                          {engineStatus === 'online' && <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500" />}
                          {engineStatus === 'degraded' && <span className="inline-flex rounded-full h-2 w-2 bg-amber-500" />}
                          {engineStatus === 'down' && <span className="inline-flex rounded-full h-2 w-2 bg-red-500" />}
                        </span>
                        <div className="flex flex-col">
                          <span className="font-bold text-[12px] flex items-center gap-1 text-white">
                            {isColabActive ? (
                              <>
                                <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
                                <span>Colab Fast</span>
                              </>
                            ) : (
                              <span>Cloud Engine</span>
                            )}
                          </span>
                          <span className="text-[10px] text-white/40">
                            {engineStatus === 'online' ? (latencyMs ? `${latencyMs}ms ping` : 'Connected') : engineStatus}
                          </span>
                        </div>
                      </div>
                      <Settings className="w-3.5 h-3.5 text-white/40" />
                    </button>

                    <div className="h-px bg-white/10 my-1" />

                    {/* QR Code Sync */}
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false)
                        setQrOpen(true)
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors cursor-pointer text-xs text-left"
                    >
                      <div className="flex items-center gap-2">
                        <QrCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-bold text-[12px] text-amber-300">QR Code Sync</span>
                          <span className="text-[10px] text-white/40">Connect other devices</span>
                        </div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-white/40" />
                    </button>
                  </div>
                </>
              )}
            </div>
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