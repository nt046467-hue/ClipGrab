"use client"

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080"
const STORAGE_KEY = "clipgrab_custom_api_url"

/** Strip invisible chars, trailing junk, and validate URL shape */
function sanitizeUrl(raw: string): string {
  // Remove zero-width chars, non-breaking spaces, and control characters
  let url = raw.replace(/[\u200B-\u200D\uFEFF\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, '')
  url = url.trim().replace(/\/+$/, '')
  // Remove any trailing non-ASCII or whitespace that trim() missed
  url = url.replace(/[^\x20-\x7E]+$/g, '')
  return url
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    // Must be http or https, hostname must not contain encoded spaces or unicode
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
           !/%20/.test(parsed.hostname) &&
           /^[a-zA-Z0-9.-]+$/.test(parsed.hostname)
  } catch {
    return false
  }
}

export function getStoredApiUrl(): string {
  if (typeof window === "undefined") return DEFAULT_API_URL
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const clean = sanitizeUrl(raw)
      if (clean.length > 0 && isValidUrl(clean)) {
        return clean
      }
      // Bad URL stored — auto-clear it
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch (e) {
    // LocalStorage might be disabled or restricted
  }
  return DEFAULT_API_URL.replace(/\/+$/, "")
}

export function setCustomApiUrl(url: string): void {
  if (typeof window === "undefined") return
  const cleanUrl = sanitizeUrl(url)
  if (!cleanUrl || !isValidUrl(cleanUrl)) {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, cleanUrl)
  }
  // Dispatch custom event to notify all components
  window.dispatchEvent(new CustomEvent("clipgrab_api_url_changed", { detail: cleanUrl || DEFAULT_API_URL }))
}

export function resetToDefaultApiUrl(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent("clipgrab_api_url_changed", { detail: DEFAULT_API_URL }))
}

export function isCustomApiUrlActive(): boolean {
  if (typeof window === "undefined") return false
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const clean = sanitizeUrl(raw)
    return clean.length > 0 && isValidUrl(clean)
  } catch {
    return false
  }
}

export function getDefaultApiUrl(): string {
  return DEFAULT_API_URL.replace(/\/+$/, "")
}

export async function testApiHealth(baseUrl: string): Promise<{ success: boolean; latency: number; message: string }> {
  const url = sanitizeUrl(baseUrl)
  
  // Fast-fail for clearly invalid URLs — no network request, no console spam
  if (!url || !isValidUrl(url)) {
    return {
      success: false,
      latency: 0,
      message: `Invalid URL format: "${baseUrl.slice(0, 60)}" — check for extra spaces or special characters`
    }
  }
  
  const startTime = Date.now()
  try {
    const res = await fetch(`${url}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    })
    const latency = Date.now() - startTime
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      return {
        success: true,
        latency,
        message: data.status === "healthy" ? `Connected (${latency}ms) — Server is ready` : `Connected (${latency}ms)`
      }
    } else {
      return {
        success: false,
        latency,
        message: `Server returned HTTP ${res.status}: ${res.statusText}`
      }
    }
  } catch (err: any) {
    let msg = err.message || "Failed to connect to server"
    if (err.name === "TimeoutError") {
      msg = "Connection timed out (10s) — Colab may be starting up or sleeping"
    } else if (msg === "Failed to fetch" || err.name === "TypeError") {
      msg = "Cannot reach Colab tunnel. Make sure your Google Colab cell is actively running and the URL is copied correctly."
    }
    return {
      success: false,
      latency: Date.now() - startTime,
      message: msg
    }
  }
}
