
export function Footer() {
  return (
    <footer className="w-full border-t border-white/[0.06] bg-black/40 backdrop-blur-md py-12 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex flex-col items-center sm:items-start gap-1">
            <div className="text-sm font-semibold text-white">
              ClipGrab © {new Date().getFullYear()}
            </div>
            <div className="text-xs text-muted-foreground/60">
              The high-fidelity archive engine. Safe, fast, and free.
            </div>
          </div>
          
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-xs font-semibold text-muted-foreground/80">
            <a href="https://github.com/yt-dlp/yt-dlp#readme" target="_blank" className="hover:text-primary transition-colors">Yt-dlp Engine</a>
            <a href="https://ffmpeg.org/" target="_blank" className="hover:text-primary transition-colors">FFmpeg Core</a>
            <a href="/terms" className="hover:text-primary transition-colors">Terms of Service</a>
            <a href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
