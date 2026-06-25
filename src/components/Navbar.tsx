
"use client"

import Link from "next/link"
import { Download } from "lucide-react"
import { useState, useEffect } from "react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080"

export function Navbar() {
  const [engineStatus, setEngineStatus] = useState<'online' | 'degraded' | 'down'>('online')

  useEffect(() => {
    const checkHealth = async () => {
      const startTime = Date.now()
      try {
        const response = await fetch(`${API_URL}/api/health`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(5000), // 5s timeout
        })
        if (!response.ok) throw new Error('Unhealthy')
        
        const latency = Date.now() - startTime
        if (latency >= 1500) {
          setEngineStatus('degraded')
        } else {
          setEngineStatus('online')
        }
      } catch (err) {
        setEngineStatus('down')
      }
    }

    checkHealth()
    const interval = setInterval(checkHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/40 backdrop-blur-xl border-b border-white/[0.06] transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-2xl bg-gradient-to-tr from-primary via-primary to-accent shadow-[0_0_20px_rgba(99,102,241,0.3)] group-hover:scale-105 group-hover:rotate-3 transition-all duration-300">
            <Download className="w-5 h-5 text-white" />
            <div className="absolute inset-0 rounded-2xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
          <div className="flex flex-col">
            <span className="font-headline text-xl font-black tracking-tight text-white leading-none">
              Clip<span className="text-primary bg-clip-text bg-gradient-to-r from-primary to-accent">Grab</span>
            </span>
            <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest mt-1">Media Archiver</span>
          </div>
        </Link>
        
        <div className="flex items-center gap-6 sm:gap-8">
          <div className="hidden sm:flex items-center gap-6 text-sm font-semibold text-muted-foreground">
            <Link href="/" className="text-white hover:text-primary transition-colors">Home</Link>
            <Link href="https://github.com/yt-dlp/yt-dlp#readme" target="_blank" className="hover:text-primary transition-colors">Documentation</Link>
          </div>
          
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.05]">
            <span className="relative flex h-2 w-2">
              {engineStatus === 'online' && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-signal opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-signal"></span>
                </>
              )}
              {engineStatus === 'degraded' && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-processing opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-processing"></span>
                </>
              )}
              {engineStatus === 'down' && (
                <>
                  <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-brand-error opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-error"></span>
                </>
              )}
            </span>
            <span className={`text-[10px] font-black uppercase tracking-wider ${
              engineStatus === 'online' ? 'text-brand-signal' :
              engineStatus === 'degraded' ? 'text-brand-processing' :
              'text-brand-error'
            }`}>
              {engineStatus === 'online' && 'Engine Online'}
              {engineStatus === 'degraded' && 'Engine Degraded'}
              {engineStatus === 'down' && 'Engine Reconnecting...'}
            </span>
          </div>
        </div>
      </div>
    </nav>
  )
}
