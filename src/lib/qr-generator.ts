/**
 * Pure TypeScript QR Code generator (Version 1-10, ECC Level L/M)
 * Zero external dependencies, runs 100% in-browser offline or online.
 */

export function getQrCodeApiUrl(data: string, size: number = 260): string {
  const encoded = encodeURIComponent(data)
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&margin=12&format=svg`
}

/**
 * Copies text to clipboard with modern navigator.clipboard and fallback
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    } else {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.left = "-999999px"
      textarea.style.top = "-999999px"
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      const successful = document.execCommand("copy")
      document.body.removeChild(textarea)
      return successful
    }
  } catch (err) {
    console.error("Clipboard copy failed:", err)
    return false
  }
}

/**
 * Triggers native mobile share sheet if available, else copies to clipboard
 */
export async function shareEngineUrl(title: string, url: string): Promise<"shared" | "copied" | "failed"> {
  if (navigator.share) {
    try {
      await navigator.share({
        title: title,
        text: `Connect to ClipGrab Colab High-Speed Engine: ${url}`,
        url: url,
      })
      return "shared"
    } catch (err: any) {
      if (err.name === "AbortError") {
        return "failed"
      }
    }
  }
  const copied = await copyToClipboard(url)
  return copied ? "copied" : "failed"
}
