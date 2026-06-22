
import { Navbar } from "@/components/Navbar"
import { Footer } from "@/components/Footer"
import { Download, MousePointerClick, Settings2, FileCheck } from "lucide-react"

export default function HowItWorks() {
  const steps = [
    {
      title: "Copy the Link",
      description: "Go to your favorite platform (YouTube, TikTok, IG, etc.) and copy the URL of the video or audio you want to save.",
      icon: MousePointerClick,
      color: "text-primary"
    },
    {
      title: "Paste & Resolve",
      description: "Paste the link into ClipGrab's search box. Our engine automatically detects the platform and fetches available formats.",
      icon: Download,
      color: "text-accent"
    },
    {
      title: "Choose Quality",
      description: "Select between HD video (MP4) or high-quality audio (MP3) depending on your needs.",
      icon: Settings2,
      color: "text-emerald-500"
    },
    {
      title: "Get your File",
      description: "Click download and your file will be ready in seconds. No ads, no redirect loops, just your content.",
      icon: FileCheck,
      color: "text-amber-500"
    }
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow pt-32 pb-20 px-4">
        <div className="max-w-4xl mx-auto space-y-16">
          <div className="text-center space-y-4">
            <h1 className="text-4xl md:text-5xl font-headline font-bold">How it Works</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              ClipGrab is designed for speed and simplicity. Here is how we make content archiving easier for you.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {steps.map((step, i) => (
              <div key={i} className="p-8 rounded-3xl bg-secondary/30 border border-white/5 space-y-4 relative group hover:border-primary/20 transition-colors">
                <div className={`w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center ${step.color}`}>
                  <step.icon className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-headline font-bold">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.description}</p>
                <div className="absolute top-8 right-8 text-4xl font-headline font-black text-white/5 group-hover:text-primary/5 transition-colors">
                  0{i + 1}
                </div>
              </div>
            ))}
          </div>

          <div className="p-8 rounded-3xl bg-primary/10 border border-primary/20 text-center space-y-6">
            <h3 className="text-2xl font-headline font-bold">Ready to try it out?</h3>
            <p className="text-muted-foreground">Join thousands of creators and fans using ClipGrab every day.</p>
            <a href="/" className="inline-block px-8 py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-all shadow-xl shadow-primary/20">
              Go to Downloader
            </a>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
