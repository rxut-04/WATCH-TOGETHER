/**
 * CinemaSync – Text Chat Overlay
 */
import { useRef, useEffect, useState } from 'react'
import type { ChatMessage } from '@/hooks/use-cinema-room'

interface ChatOverlayProps {
  messages: ChatMessage[]
  onSend: (text: string) => void
  visible: boolean
  onToggle: () => void
}

export function ChatOverlay({
  messages,
  onSend,
  visible,
  onToggle,
}: ChatOverlayProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, visible])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    onSend(text)
    setInput('')
  }

  const fmtTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="relative flex items-center gap-2 px-3 py-2 text-amber-100/50 hover:text-amber-300 transition-colors"
        title="Toggle chat"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {messages.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full" />
        )}
      </button>

      {/* Chat panel */}
      {visible && (
        <div
          className="absolute right-4 bottom-20 w-72 z-50 flex flex-col"
          style={{
            background:
              'linear-gradient(135deg, rgba(20,16,12,0.95) 0%, rgba(12,10,8,0.98) 100%)',
            border: '1px solid rgba(251,191,36,0.12)',
            borderRadius: '2px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <span className="font-mono text-xs text-amber-100/40 tracking-widest uppercase">
              Messages
            </span>
            <button
              onClick={onToggle}
              className="text-amber-100/20 hover:text-amber-100/50 transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto max-h-64 px-4 py-3 space-y-3 scrollbar-thin">
            {messages.length === 0 && (
              <p className="font-mono text-xs text-amber-100/20 text-center py-4">
                No messages yet
              </p>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col gap-0.5 ${msg.from === 'me' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`px-3 py-1.5 rounded-sm max-w-[220px] ${
                    msg.from === 'me'
                      ? 'bg-amber-500/15 text-amber-100'
                      : 'bg-white/5 text-amber-100/80'
                  }`}
                >
                  <p
                    className="text-sm leading-relaxed break-words"
                    style={{
                      fontFamily: 'DM Mono, monospace',
                      fontSize: '12px',
                    }}
                  >
                    {msg.text}
                  </p>
                </div>
                <span
                  className="font-mono text-xs text-amber-100/20"
                  style={{ fontSize: '10px' }}
                >
                  {fmtTime(msg.ts)}
                </span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="px-4 py-3 border-t border-white/5"
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Say something…"
                maxLength={500}
                className="flex-1 bg-transparent font-mono text-xs text-amber-100/80 placeholder:text-amber-100/20 outline-none border-b border-white/10 focus:border-amber-500/40 pb-1 transition-colors"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="text-amber-400/60 hover:text-amber-400 transition-colors disabled:opacity-20"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
