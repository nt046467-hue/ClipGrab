"use client"

import { useState, useRef, useEffect } from "react"
import { Terminal, Send, X, Bot, User, CornerDownLeft, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"

interface Message {
  sender: "user" | "engine"
  text: string
  timestamp: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080"

interface ChatAssistantProps {
  hasStickyBar?: boolean
}

export function ChatAssistant({ hasStickyBar = false }: ChatAssistantProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: "engine",
      text: "Support Engine online. Ask me about downloading formats, YouTube cookies, or platform support.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const quickPrompts = [
    "Supported sites?",
    "How to download MP3?",
    "YouTube Cookie Auth?"
  ]

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return

    const userMessage: Message = {
      sender: "user",
      text: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: textToSend.trim() })
      })

      const data = await response.json().catch(() => ({}))
      
      if (!response.ok) {
        throw new Error(data.reply || "Failed to contact engine")
      }

      setMessages((prev) => [
        ...prev,
        {
          sender: "engine",
          text: data.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ])
    } catch (err: any) {
      const errorMsg = (err?.message === "Failed to fetch" || !err?.message)
        ? "Couldn't reach the engine — check your connection and retry."
        : err.message;
      setMessages((prev) => [
        ...prev,
        {
          sender: "engine",
          text: errorMsg,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ])
    } finally {
      setIsLoading(false)
    }
  }

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  // Prevent scroll propagation when chat modal is open on desktop/mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [isOpen])

  return (
    <>
      {/* Floating Toggle Button — sits above sticky CTA bar on mobile */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed right-4 sm:right-6 z-50 flex items-center justify-center w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-primary text-white border border-white/[0.08] shadow-[0_4px_24px_rgba(99,102,241,0.4)] hover:bg-primary/90 hover:shadow-[0_4px_28px_rgba(99,102,241,0.5)] hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background transition-all duration-300 ${
          hasStickyBar ? 'bottom-20 sm:bottom-6' : 'bottom-4 sm:bottom-6'
        }`}
        aria-label="Toggle chat assistant"
      >
        {isOpen ? <X className="w-4 h-4 sm:w-6 sm:h-6" /> : <Terminal className="w-4 h-4 sm:w-6 sm:h-6" />}
      </button>

      {/* Chat Interface Drawer/Overlay */}
      {isOpen && (
        <div className="fixed inset-0 sm:inset-auto sm:bottom-24 sm:right-6 z-[60] w-full h-full sm:w-[400px] sm:h-[520px] animate-in slide-in-from-bottom-6 duration-300">
          {/* Backdrop on mobile — closes chat */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm sm:hidden" onClick={() => setIsOpen(false)} />

          <Card className="relative w-full h-full flex flex-col bg-brand-surface border-brand-border sm:border shadow-2xl rounded-none sm:rounded-2xl overflow-hidden z-10">
            {/* Header */}
            <CardHeader className="py-4 px-5 border-b border-brand-border bg-black/20 flex flex-row items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
                  <Terminal className="w-4.5 h-4.5" />
                </div>
                <div>
                  <CardTitle className="text-sm font-headline font-bold text-white tracking-tight flex items-center gap-1.5">
                    Ask the Engine
                    <Sparkles className="w-3.5 h-3.5 text-brand-signal animate-pulse" />
                  </CardTitle>
                  <p className="text-[10px] text-brand-text-muted font-mono leading-none mt-0.5">SUPPORT_AGENT_SYS // ACTIVE</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8 text-brand-text-muted hover:text-white hover:bg-white/5 rounded-full"
              >
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>

            {/* Messages body */}
            <CardContent className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs leading-relaxed bg-brand-bg/50">
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex gap-2.5 max-w-[85%] ${
                      msg.sender === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                        msg.sender === "user"
                          ? "bg-primary/15 border-primary/30 text-primary"
                          : "bg-white/[0.04] border-white/[0.08] text-brand-text-primary"
                      }`}
                    >
                      {msg.sender === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    </div>

                    <div className="space-y-1">
                      <div
                        className={`p-3 rounded-xl border text-[11px] leading-relaxed break-words whitespace-pre-wrap ${
                          msg.sender === "user"
                            ? "bg-primary/10 border-primary/25 text-white rounded-tr-none"
                            : "bg-brand-surface border-brand-border text-brand-text-primary rounded-tl-none"
                        }`}
                      >
                        {msg.text}
                      </div>
                      <p className={`text-[9px] font-mono text-brand-text-muted/65 ${msg.sender === "user" ? "text-right" : ""}`}>
                        {msg.timestamp}
                      </p>
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex gap-2.5 max-w-[85%] mr-auto">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-white/[0.04] border border-white/[0.08] text-brand-text-primary">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <div className="space-y-1">
                      <div className="p-3 rounded-xl border border-brand-border bg-brand-surface text-brand-text-muted rounded-tl-none flex items-center gap-1.5 font-mono text-[10px]">
                        <Loader2 className="w-3 h-3 animate-spin text-brand-processing" />
                        [processing readout...]
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </CardContent>

            {/* Quick action prompts */}
            {messages.length === 1 && !isLoading && (
              <div className="px-4 py-2 bg-brand-bg/50 flex flex-wrap gap-2 shrink-0">
                {quickPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(prompt)}
                    className="px-2.5 py-1 rounded-lg bg-brand-surface border border-brand-border hover:border-primary/50 text-brand-text-muted hover:text-white font-mono text-[10px] transition-all"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {/* Input Footer */}
            <CardFooter className="p-3 border-t border-brand-border bg-black/10 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSend(input)
                }}
                className="w-full flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted text-[10px] font-bold select-none">{`>`}</span>
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Input command..."
                    className="w-full h-10 pl-7 pr-3 bg-brand-surface border border-brand-border rounded-xl text-xs font-mono text-white placeholder:text-brand-text-muted/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    disabled={isLoading}
                  />
                </div>
                <Button
                  type="submit"
                  size="icon"
                  disabled={!input.trim() || isLoading}
                  className="h-10 w-10 shrink-0 bg-primary hover:bg-primary/95 text-white rounded-xl active:scale-95 transition-all shadow-md"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </CardFooter>
          </Card>
        </div>
      )}
    </>
  )
}
