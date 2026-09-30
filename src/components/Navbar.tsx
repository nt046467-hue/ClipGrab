"use client"

import Link from "next/link"
import { Download, Zap, QrCode, Film, MoreHorizontal, ChevronRight, Settings } from "lucide-react"
import { useState, useEffect } from "react"
import { getStoredApiUrl, isCustomApiUrlActive } from "@/lib/api-config"
import { ServerSettingsModal } from "@/components/ServerSettingsModal"
import { QrCodeShareModal } from "@/components/QrCodeShareModal"
import { getWatchHistory } from "@/lib/player-storage"

export function Navbar() {
  const [engineStatus, setEngineStatus] = useState<'online' | 'degraded' | 'down'>('online')
  const [isColabActive, setIsColabActive] = useState(false)
  const [apiUrl, setApiUrl] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [savedCount, setSavedCount] = useState(0)

  // Track library open/close state (for Library button active tint)
  useEffect(() => {
    const handleOpen = () => setLibraryOpen(true)
    const handleClose = () => setLibraryOpen(false)
    window.addEventListener('clipgrab_open_library', handleOpen)
    window.addEventListener('clipgrab_library_closed', handleClose)
    return () => {
      window.removeEventListener('clipgrab_open_library', handleOpen)
      window.removeEventListener('clipgrab_library_closed', handleClose)
    }
  }, [])

  // Keep saved video count fresh
  useEffect(() => {
    const refresh = () => setSavedCount(getWatchHistory().length)
    refresh()
    window.addEventListener('clipgrab_history_updated', refresh)
    window.addEventListener('clipgrab_open_library', refresh)
    return () => {
      window.removeEventListener('clipgrab_history_updated', refresh)
      window.removeEventListener('clipgrab_open_library', refresh)
    }
  }, [])

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

  // Status dot helpers
  const statusColor =
    engineStatus === 'online' ? 'bg-emerald-500' :
    engineStatus === 'degraded' ? 'bg-amber-500' :
    'bg-red-500'
  const statusLabel =
    engineStatus === 'online' ? 'Server online' :
    engineStatus === 'degraded' ? 'Server slow' :
    'Server offline'

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-40 border-b border-white/[0.06]"
        style={{
          background: 'rgba(7,8,13,0.92)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        }}
      >
        <div className="max-w-7xl mx-auto h-14 flex items-center justify-between gap-3">

          {/* ── Logo ── */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0 min-w-0">
            <div
              className="relative flex items-center justify-center rounded-xl bg-gradient-to-tr from-primary via-indigo-500 to-accent group-hover:scale-105 group-hover:rotate-3 transition-transform duration-300 shrink-0"
              style={{ width: 36, height: 36 }}
            >
              <Download className="w-4 h-4 text-white" />
              <div className="absolute inset-0 rounded-xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-headline text-base sm:text-xl font-black tracking-tight text-white leading-none whitespace-nowrap">
                Clip<span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">Grab</span>
              </span>
              {/* Hide subtitle below 380px */}
              <span className="hidden text-[8px] sm:text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest mt-0.5 whitespace-nowrap min-[380px]:block">
                Media Studio
              </span>
            </div>
          </Link>

          {/* ── Desktop Action Group (>= 640px) ── */}
          <div className="hidden sm:flex items-center gap-2">
            {/* Library button — pill with label + badge */}
            <button
              type="button"
              onClick={openLibrary}
              aria-label="Open Library and saved videos"
              title="Open ClipGrab Player & Saved Downloads"
              className={`relative inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full border transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-95 ${
                libraryOpen
                  ? 'bg-primary/15 border-primary/30 text-primary'
                  : 'bg-white/[0.05] border-white/[0.08] hover:bg-white/10 text-white'
              }`}
            >
              <Film className={`w-4 h-4 shrink-0 ${libraryOpen ? 'text-primary' : 'text-white/80'}`} />
              <span className="text-sm font-semibold">Library</span>
              {savedCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold leading-none">
                  {savedCount > 99 ? '99+' : savedCount}
                </span>
              )}
            </button>

            {/* Engine status pill */}
            <button
              onClick={() => setSettingsOpen(true)}
              title="Click to configure backend engine or Google Colab"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer ${isColabActive
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

            {/* QR Sync button */}
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              aria-label="Share engine via QR Code"
              title="Share engine via QR Code to mobile or other devices"
              className="h-10 px-3 rounded-full border border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/15 text-amber-300 text-xs font-bold gap-1.5 flex items-center cursor-pointer active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
            >
              <QrCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>QR Sync</span>
            </button>
          </div>

          {/* ── Mobile Action Group (< 640px) ── */}
          <div className="flex sm:hidden items-center gap-2 shrink-0">

            {/* Library button — icon + count badge */}
            <button
              type="button"
              onClick={openLibrary}
              aria-label={savedCount > 0 ? `Open Library — ${savedCount} saved videos` : 'Open Library'}
              style={{ minWidth: 44, minHeight: 44 }}
              className={`relative flex items-center justify-center w-10 h-10 rounded-full border transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-95 ${
                libraryOpen
                  ? 'bg-primary/15 border-primary/30'
                  : 'bg-white/[0.05] border-white/[0.08] hover:bg-white/10'
              }`}
            >
              <Film className={`w-[18px] h-[18px] ${libraryOpen ? 'text-primary' : 'text-white/80'}`} />
              {savedCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full bg-primary text-white text-[9px] font-bold leading-none ring-2 ring-[#07080d]"
                  aria-hidden="true"
                >
                  {savedCount > 9 ? '9+' : savedCount}
                </span>
              )}
            </button>

            {/* Menu button — icon + status dot inside corner */}
            <div data-mobile-menu className="relative" style={{ minWidth: 44, minHeight: 44 }}>
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-label={`More options and engine settings — ${statusLabel}`}
                aria-expanded={mobileMenuOpen}
                style={{ minWidth: 44, minHeight: 44 }}
                className="relative flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] hover:bg-white/10 border border-white/[0.08] text-white transition-all active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                <MoreHorizontal className="w-[18px] h-[18px]" />
                {/* Status dot — reflects /api/health; inside button bottom-right corner */}
                <span
                  className={`absolute bottom-[7px] right-[7px] h-[7px] w-[7px] rounded-full ${statusColor} ring-[1.5px] ring-[#07080d]`}
                  role="img"
                  aria-label={statusLabel}
                />
              </button>

              {/* Dropdown */}
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

                    {/* Engine / Colab Switcher */}
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
                            {engineStatus === 'online' ? (latencyMs ? `${latencyMs}ms ping` : 'Connected') : statusLabel}
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

      {/* Backdrop-blur only at sm+ for mobile performance */}
      <style>{`
        @media (min-width: 640px) {
          nav.fixed { backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
        }
      `}</style>
    </>
  )
}