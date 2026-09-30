import { NextRequest, NextResponse } from "next/server"

// Built-in intelligent response engine for ClipGrab media & support queries
function generateSupportReply(query: string): string {
  const q = query.toLowerCase().trim()

  if (q.includes("hi") || q.includes("hello") || q.includes("hey") || q.includes("namaste") || q.includes("sup")) {
    return "Hello! I am your ClipGrab Media Assistant. Ask me how to download videos in 4K, extract MP3 audio, set up 1-Click Google Colab for 100MB/s speeds, or fix YouTube rate limits."
  }

  if (q.includes("colab") || q.includes("speed") || q.includes("fast") || q.includes("100mb") || q.includes("slow") || q.includes("boost") || q.includes("1-click")) {
    return "⚡ 1-Click Colab gives you up to 100MB/s download speeds! Click 'Colab Fast' in the top bar, copy the 1-click Python script into Google Colab, click Play, and paste your trycloudflare.com URL into the input."
  }

  if (q.includes("mp3") || q.includes("audio") || q.includes("song") || q.includes("music")) {
    return "🎵 To download MP3 audio: Paste your video link and hit Convert. In the results card, click the 'Audio Extracts' tab and choose 'MP3 High Quality (320kbps)' to save."
  }

  if (q.includes("youtube") || q.includes("yt") || q.includes("4k") || q.includes("1080") || q.includes("quality")) {
    return "🎬 YouTube downloads support up to 4K 60fps and 1080p HD. Just paste the YouTube URL, click Convert, and pick your preferred video resolution or MP3 audio."
  }

  if (q.includes("cookie") || q.includes("429") || q.includes("rate limit") || q.includes("bot") || q.includes("sign in") || q.includes("auth")) {
    return "🍪 If YouTube asks for verification (HTTP 429), switch to your own free Google Colab engine in Server Settings, or export your cookies via the 'Get cookies.txt LOCALLY' browser extension and paste them in the verification box."
  }

  if (q.includes("tiktok") || q.includes("watermark") || q.includes("tt")) {
    return "📱 TikTok videos are automatically downloaded in original HD quality with watermarks removed. Just paste the TikTok link and tap Convert."
  }

  if (q.includes("instagram") || q.includes("reel") || q.includes("insta") || q.includes("ig")) {
    return "📸 Instagram Reels, Posts, and Carousels are fully supported. Paste the reel or post link to download direct high-definition MP4 video."
  }

  if (q.includes("pinterest") || q.includes("pin")) {
    return "📌 Pinterest video pins and photo pins are supported! Paste the pin.it or pinterest.com link to extract the original resolution media."
  }

  if (q.includes("twitter") || q.includes("x.com") || q.includes("tweet")) {
    return "🐦 Twitter / X video clips and GIFs can be downloaded directly in highest available bitrate MP4 format."
  }

  if (q.includes("qr") || q.includes("phone") || q.includes("mobile") || q.includes("sync") || q.includes("device") || q.includes("ios") || q.includes("iphone") || q.includes("android")) {
    return "📲 Click the 'QR Sync' button in the top bar to display your engine QR code. Scan it with your iPhone or Android camera to auto-connect on mobile instantly!"
  }

  if (q.includes("site") || q.includes("platform") || q.includes("support") || q.includes("where")) {
    return "🌐 Supported platforms include YouTube (4K/HD/MP3), Instagram (Reels & Posts), TikTok (No Watermark), Pinterest (Pins & Videos), and X/Twitter."
  }

  if (q.includes("free") || q.includes("cost") || q.includes("price") || q.includes("pay")) {
    return "✨ ClipGrab is 100% free and open-source with no ads, watermarks, or daily download limits."
  }

  return "I'm here to help with all ClipGrab features: 4K video downloads, MP3 extraction, 100MB/s Google Colab acceleration, YouTube cookie authentication, and QR mobile sync. What would you like to know?"
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message } = body

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ reply: "Please enter a question or topic." }, { status: 400 })
    }

    const trimmed = message.trim()

    // 1. Try Gemini if API key is configured
    const geminiKey = process.env.GEMINI_API_KEY
    if (geminiKey) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `You are ClipGrab's real-time AI support agent. Answer concisely (2-3 sentences max) in plain, friendly language about downloading video/audio from YouTube (4K/MP3), TikTok (no watermark), Instagram, Pinterest, Twitter/X, using 1-Click Google Colab for 100MB/s speeds, or QR mobile sync. User question: ${trimmed}`
                    }
                  ]
                }
              ]
            })
          }
        )

        if (geminiRes.ok) {
          const data = await geminiRes.json()
          const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text
          if (replyText) {
            return NextResponse.json({ reply: replyText })
          }
        }
      } catch (e) {
        console.error("Gemini route error:", e)
      }
    }

    // 2. Try Groq fallback if configured
    const groqKey = process.env.GROQ_API_KEY
    if (groqKey) {
      try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "user",
                content: `You are ClipGrab's AI support engine. Answer concisely (2-3 sentences) in friendly language about downloading video/audio from YouTube, TikTok, Instagram, Pinterest, X, or using Google Colab fast engine. User: ${trimmed}`
              }
            ],
            max_tokens: 150
          })
        })

        if (groqRes.ok) {
          const data = await groqRes.json()
          const replyText = data?.choices?.[0]?.message?.content
          if (replyText) {
            return NextResponse.json({ reply: replyText })
          }
        }
      } catch (e) {
        console.error("Groq route error:", e)
      }
    }

    // 3. Built-in instant expert response engine (guaranteed 100% uptime)
    const fallbackReply = generateSupportReply(trimmed)
    return NextResponse.json({ reply: fallbackReply })
  } catch (err: any) {
    return NextResponse.json(
      { reply: "Support engine is active. Ask about YouTube, TikTok, MP3 extraction, or 1-Click Colab setup!" },
      { status: 200 }
    )
  }
}
