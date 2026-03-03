/**
 * CinemaSync – Landing Page
 * Create a room or paste an invite link to join.
 */
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

function generateRoomId() {
  // URL-safe random ID: 6 chars
  return Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}

export function LandingPage() {
  const navigate = useNavigate()
  const [joinId, setJoinId] = useState('')
  const [creating, setCreating] = useState(false)
  const [joinError, setJoinError] = useState('')

  const handleCreate = async () => {
    setCreating(true)
    const roomId = generateRoomId()
    await navigate({
      to: '/room/$roomId',
      params: { roomId },
      search: { role: 'host' },
    })
    setCreating(false)
  }

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault()
    setJoinError('')
    const raw = joinId.trim()
    if (!raw) return

    // Accept full URL or just the room ID
    const match = raw.match(/room\/([a-z0-9]+)/i)
    const roomId = match ? match[1] : raw

    if (!/^[a-z0-9]{6,24}$/i.test(roomId)) {
      setJoinError('Invalid invite link or room ID')
      return
    }

    void navigate({
      to: '/room/$roomId',
      params: { roomId },
      search: { role: 'viewer' },
    })
  }

  return (
    <div
      className="min-h-screen bg-black flex flex-col items-center justify-center relative overflow-hidden"
      style={{ fontFamily: 'DM Mono, monospace' }}
    >
      {/* Deep ambient background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 50% 0%, rgba(180,120,40,0.06) 0%, transparent 70%),
            radial-gradient(ellipse 50% 40% at 20% 80%, rgba(120,80,20,0.04) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 80% 70%, rgba(80,50,10,0.04) 0%, transparent 60%)
          `,
        }}
      />

      {/* Subtle film grain */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: '200px 200px',
        }}
      />

      {/* Letterbox lines */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />

      {/* Corner decoration */}
      <div className="absolute top-8 left-8 w-6 h-6 border-t border-l border-amber-500/20" />
      <div className="absolute top-8 right-8 w-6 h-6 border-t border-r border-amber-500/20" />
      <div className="absolute bottom-8 left-8 w-6 h-6 border-b border-l border-amber-500/20" />
      <div className="absolute bottom-8 right-8 w-6 h-6 border-b border-r border-amber-500/20" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-md px-8 w-full">
        {/* Eyebrow */}
        <div className="flex items-center gap-3 mb-8">
          <div className="h-px w-12 bg-amber-500/30" />
          <span className="text-xs text-amber-500/50 tracking-[0.3em] uppercase">
            Private Screening
          </span>
          <div className="h-px w-12 bg-amber-500/30" />
        </div>

        {/* Title */}
        <h1
          className="mb-3 leading-none"
          style={{
            fontFamily: 'Cormorant Garant, serif',
            fontSize: 'clamp(52px, 10vw, 80px)',
            fontWeight: 300,
            color: 'rgba(251,236,200,0.92)',
            letterSpacing: '-0.02em',
          }}
        >
          Cinema
          <span style={{ fontStyle: 'italic', color: 'rgba(251,191,36,0.75)' }}>
            Sync
          </span>
        </h1>

        {/* Tagline */}
        <p
          className="mb-16 text-center leading-relaxed"
          style={{
            fontFamily: 'Cormorant Garant, serif',
            fontSize: '16px',
            fontStyle: 'italic',
            color: 'rgba(251,220,160,0.35)',
            letterSpacing: '0.02em',
          }}
        >
          Watch together, perfectly in sync.
          <br />
          Just the two of you.
        </p>

        {/* Create room */}
        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full group relative mb-4 py-4 border border-amber-500/30 hover:border-amber-400/60 transition-all duration-500 overflow-hidden"
        >
          {/* Hover shimmer */}
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
            style={{
              background:
                'linear-gradient(105deg, transparent 20%, rgba(251,191,36,0.05) 50%, transparent 80%)',
            }}
          />
          <div className="relative flex items-center justify-center gap-3">
            {creating ? (
              <div className="w-4 h-4 border border-amber-400/60 border-t-amber-400 rounded-full animate-spin" />
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-amber-400/60 group-hover:text-amber-400 transition-colors"
              >
                <path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.82v6.36a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
              </svg>
            )}
            <span
              className="text-amber-100/70 group-hover:text-amber-100 transition-colors tracking-widest uppercase"
              style={{ fontSize: '12px' }}
            >
              {creating ? 'Creating room…' : 'Start a Screening'}
            </span>
          </div>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4 w-full mb-4">
          <div className="flex-1 h-px bg-white/5" />
          <span className="text-xs text-amber-100/15 tracking-widest uppercase">
            or
          </span>
          <div className="flex-1 h-px bg-white/5" />
        </div>

        {/* Join room */}
        <form onSubmit={handleJoin} className="w-full space-y-3">
          <div className="relative">
            <input
              value={joinId}
              onChange={(e) => {
                setJoinId(e.target.value)
                setJoinError('')
              }}
              placeholder="Paste invite link or room ID"
              className="w-full bg-transparent border border-white/8 hover:border-white/15 focus:border-amber-500/30 outline-none px-4 py-3.5 text-xs text-amber-100/60 placeholder:text-amber-100/20 tracking-wider transition-all duration-300"
              style={{ fontFamily: 'DM Mono, monospace' }}
            />
          </div>
          {joinError && (
            <p className="text-xs text-red-400/70 text-left">{joinError}</p>
          )}
          <button
            type="submit"
            disabled={!joinId.trim()}
            className="w-full py-3.5 text-xs tracking-widest uppercase transition-all duration-300 text-amber-100/30 hover:text-amber-100/70 border border-white/5 hover:border-white/15 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Join as Viewer
          </button>
        </form>

        {/* Features footer */}
        <div className="mt-16 flex items-center gap-6 flex-wrap justify-center">
          {['P2P Encrypted', 'No Recording', 'Host-Synced', 'No Account'].map(
            (f) => (
              <span
                key={f}
                className="flex items-center gap-1.5 text-amber-100/20"
                style={{ fontSize: '10px' }}
              >
                <div className="w-1 h-1 rounded-full bg-amber-500/30" />
                {f}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  )
}
