
import { Platform } from "@/components/PlatformIcon";

export function detectPlatform(url: string): Platform {
  if (!url) return "unknown";
  const normalizedUrl = url.toLowerCase();
  
  if (normalizedUrl.includes("youtube.com") || normalizedUrl.includes("youtu.be")) return "youtube";
  if (normalizedUrl.includes("tiktok.com")) return "tiktok";
  if (normalizedUrl.includes("instagram.com")) return "instagram";
  if (normalizedUrl.includes("facebook.com") || normalizedUrl.includes("fb.watch")) return "facebook";
  if (normalizedUrl.includes("twitter.com") || normalizedUrl.includes("x.com")) return "twitter";
  
  return "unknown";
}
