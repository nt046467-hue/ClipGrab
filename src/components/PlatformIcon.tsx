
import { Youtube, Instagram, Facebook, Twitter, LinkIcon } from "lucide-react"

export type Platform = "youtube" | "tiktok" | "instagram" | "facebook" | "twitter" | "unknown"

/** Inline TikTok logo SVG — Lucide doesn't include one */
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TikTok"
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" />
    </svg>
  )
}

export function PlatformIcon({ platform, className = "w-5 h-5" }: { platform: Platform, className?: string }) {
  switch (platform) {
    case "youtube":   return <Youtube className={`${className} text-red-500`} />
    case "tiktok":    return <TikTokIcon className={`${className} text-white`} />
    case "instagram": return <Instagram className={`${className} text-pink-500`} />
    case "facebook":  return <Facebook className={`${className} text-blue-500`} />
    case "twitter":   return <Twitter className={`${className} text-sky-400`} />
    default:          return <LinkIcon className={`${className} text-muted-foreground`} />
  }
}
