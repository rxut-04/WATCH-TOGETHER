/**
 * CinemaSync – CinemaRoom v4
 * Robust two-user private cinema with bulletproof peer notification.
 */
import { useRef, useState, useEffect } from 'react'

function HostVoicePlayer({ stream }: { stream: MediaStream | null }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.srcObject = stream
    if (stream) el.play().catch(() => null)
  }, [stream])
  return <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
}
import type { Role } from '@/hooks/use-cinema-room'
import { useCinemaRoom } from '@/hooks/use-cinema-room'
import { VideoPlayer } from './VideoPlayer'
import { ChatOverlay } from './ChatOverlay'
import { VoiceCamera } from './VoiceCamera'

interface CinemaRoomProps {
  roomId: string
  role: Role
  inviteLink: string
  wsUrl: string
}

const CONNECTION_LABELS: Record<string, string> = {
  idle: 'Initializing',
  connecting: 'Connecting…',
  connected: 'Live',
  error: 'Reconnecting…',
  disconnected: 'Reconnecting…',
}

const CONNECTION_COLORS: Record<string, string> = {
  idle: 'text-amber-100/30',
  connecting: 'text-amber-400/60',
  connected: 'text-emerald-400',
  error: 'text-red-400',
  disconnected: 'text-amber-400/60',
}

export function CinemaRoom({
  roomId,
  role,
  inviteLink,
  wsUrl,
}: CinemaRoomProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [showInvite, setShowInvite] = useState(role === 'host')
  const [partnerBanner, setPartnerBanner] = useState(false)
  const [partnerBannerKey, setPartnerBannerKey] = useState(0)
  const prevPeerRef = useRef(false)
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    state,
    loadVideoFile,
    togglePlay,
    seek,
    setSpeed,
    setAudioTrack,
    sendChat,
    startPTT,
    stopPTT,
    toggleCamera,
  } = useCinemaRoom({ roomId, role, videoRef, wsUrl })

  // ── Partner arrived / left detection ────────────────────────────────────
  useEffect(() => {
    const arrived = state.peerConnected && !prevPeerRef.current
    const left = !state.peerConnected && prevPeerRef.current
    prevPeerRef.current = state.peerConnected

    if (arrived) {
      // Hide invite link — partner is here
      setShowInvite(false)

      if (role === 'host') {
        // Show arrival banner with re-mount key to restart animation
        setPartnerBannerKey((k) => k + 1)
        setPartnerBanner(true)
        if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current)
        bannerTimerRef.current = setTimeout(() => setPartnerBanner(false), 8000)
      }
    }

    if (left) {
      setPartnerBanner(false)
      if (role === 'host') {
        setShowInvite(true)
      }
    }
  }, [state.peerConnected, role])

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteLink)
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2500)
  }

  const statusDotColor =
    state.connectionState === 'connected'
      ? 'bg-emerald-400'
      : state.connectionState === 'error' ||
          state.connectionState === 'disconnected'
        ? 'bg-amber-400/60'
        : 'bg-amber-400/40'

  const isPulsing =
    state.connectionState === 'connecting' ||
    state.connectionState === 'disconnected' ||
    state.connectionState === 'error'

  return (
    <div
      className="relative flex flex-col min-h-screen bg-black overflow-hidden"
      style={{ fontFamily: 'DM Mono, monospace' }}
    >
      {/* Film grain overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.4'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />

      {/* ── Top bar ── */}
      <header className="relative z-20 flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-4">
          <span
            className="text-amber-400/80 tracking-widest"
            style={{
              fontFamily: 'Cormorant Garant, serif',
              fontSize: '17px',
              fontStyle: 'italic',
              letterSpacing: '0.12em',
            }}
          >
            CinemaSync
          </span>

          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${statusDotColor} ${isPulsing ? 'animate-pulse' : ''}`}
            />
            <span
              className={`text-xs ${CONNECTION_COLORS[state.connectionState] ?? 'text-amber-100/30'}`}
            >
              {CONNECTION_LABELS[state.connectionState] ?? 'Unknown'}
            </span>
          </div>

          {/* Partner status pill */}
          {state.peerConnected && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 border border-emerald-500/20 bg-emerald-500/5 rounded-full">
              <div className="w-1 h-1 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-400/80">
                {role === 'host' ? 'Partner connected' : 'Host connected'}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-100/15 border border-white/5 px-2 py-0.5 rounded-full font-mono">
            {roomId.slice(0, 8)}
          </span>

          {role === 'host' && (
            <button
              onClick={copyInvite}
              className="flex items-center gap-1.5 text-xs text-amber-100/40 hover:text-amber-300 transition-colors px-2 py-1 border border-transparent hover:border-amber-500/20"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              {inviteCopied ? '✓ Copied!' : 'Copy Invite'}
            </button>
          )}

          <span
            className={`text-xs px-2 py-0.5 border ${
              role === 'host'
                ? 'text-amber-400/60 border-amber-500/20 bg-amber-500/5'
                : 'text-blue-400/60 border-blue-500/20 bg-blue-500/5'
            }`}
          >
            {role === 'host' ? 'Screening' : 'Watching'}
          </span>
        </div>
      </header>

      {/* ── Partner joined banner (host only, highly visible) ── */}
      {partnerBanner && role === 'host' && (
        <div
          key={partnerBannerKey}
          className="relative z-30 flex items-center justify-between px-6 py-4 border-b border-emerald-500/30"
          style={{
            background:
              'linear-gradient(90deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.06) 100%)',
            animation: 'bannerIn 0.5s cubic-bezier(0.16,1,0.3,1) forwards',
          }}
        >
          <div className="flex items-center gap-4">
            {/* Pulsing ring */}
            <div className="relative flex-shrink-0">
              <div className="w-3 h-3 rounded-full bg-emerald-400" />
              <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
            </div>
            <div>
              <p
                className="text-emerald-300 font-light"
                style={{
                  fontFamily: 'Cormorant Garant, serif',
                  fontStyle: 'italic',
                  fontSize: '19px',
                  lineHeight: '1.3',
                }}
              >
                Your partner has joined the screening.
              </p>
              <p className="text-xs text-emerald-400/50 mt-0.5 font-mono tracking-widest uppercase">
                Select a film to begin
              </p>
            </div>
          </div>
          <button
            onClick={() => setPartnerBanner(false)}
            className="text-emerald-400/40 hover:text-emerald-300 transition-colors ml-6 flex-shrink-0 p-1"
            aria-label="Dismiss"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Viewer: waiting for host banner ── */}
      {role === 'viewer' && !state.peerConnected && (
        <div
          className="relative z-30 flex items-center gap-4 px-6 py-3 border-b border-blue-500/10"
          style={{ background: 'rgba(59,130,246,0.04)' }}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400/50 animate-pulse flex-shrink-0" />
          <p className="text-xs text-blue-400/50 tracking-widest uppercase font-mono">
            Waiting for host to start the screening…
          </p>
        </div>
      )}

      {/* ── Invite link banner (host, before partner joins) ── */}
      {role === 'host' && showInvite && !state.peerConnected && (
        <div
          className="relative z-20 flex items-center justify-between px-6 py-3 border-b border-amber-500/10"
          style={{
            background: 'rgba(251,191,36,0.04)',
            animation: 'fadeIn 0.4s ease',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400/50 animate-pulse flex-shrink-0" />
            <p className="text-xs text-amber-100/40 tracking-widest uppercase flex-shrink-0 font-mono">
              Waiting for partner
            </p>
            <span className="text-xs text-amber-100/20 font-mono truncate hidden md:block">
              {inviteLink}
            </span>
          </div>
          <div className="flex items-center gap-3 ml-4 flex-shrink-0">
            <button
              onClick={copyInvite}
              className="text-xs text-amber-400/70 hover:text-amber-300 transition-colors font-mono tracking-widest uppercase whitespace-nowrap"
            >
              {inviteCopied ? '✓ Copied' : 'Copy Link'}
            </button>
            <button
              onClick={() => setShowInvite(false)}
              className="text-amber-100/20 hover:text-amber-100/50 transition-colors"
              aria-label="Hide"
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
        </div>
      )}

      {/* Host: play viewer's voice (PTT from her side) */}
      {role === 'host' && <HostVoicePlayer stream={state.remoteVoiceStream} />}

      {/* ── Video area ── */}
      <main className="relative z-10 flex-1 flex items-center justify-center">
        <div
          className="relative w-full"
          style={{
            maxHeight: 'calc(100vh - 120px)',
            aspectRatio: '16/9',
          }}
        >
          <VideoPlayer
            role={role}
            remoteStream={state.remoteStream}
            videoRef={videoRef}
            syncState={state.syncState}
            videoFileName={state.videoFileName}
            audioTrackOptions={state.audioTrackOptions}
            selectedAudioTrackIndex={state.selectedAudioTrackIndex}
            remoteAudioTrackLabel={state.remoteAudioTrackLabel}
            onLoadFile={loadVideoFile}
            onTogglePlay={togglePlay}
            onSeek={seek}
            onSetSpeed={setSpeed}
            onSetAudioTrack={setAudioTrack}
            peerConnected={state.peerConnected}
          />

          {/* Chat overlay */}
          <div className="absolute top-4 right-4 z-40">
            <ChatOverlay
              messages={state.chatMessages}
              onSend={sendChat}
              visible={chatOpen}
              onToggle={() => setChatOpen((o) => !o)}
            />
          </div>
        </div>
      </main>

      {/* ── Bottom bar ── */}
      <footer className="relative z-20 flex items-center justify-between px-6 py-2 border-t border-white/5 bg-black/80">
        <VoiceCamera
          pttActive={state.pttActive}
          onPTTStart={startPTT}
          onPTTStop={stopPTT}
          onToggleCamera={toggleCamera}
          localCameraStream={state.localCameraStream}
          remoteCameraStream={state.remoteCameraStream}
          peerConnected={state.peerConnected}
        />

        <div className="flex items-center gap-4">
          {state.peerConnected && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400/40">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              End-to-end encrypted
            </div>
          )}

          {/* Connection debug info (small, unobtrusive) */}
          <span className="text-[10px] text-white/10 font-mono hidden lg:block">
            sig:{state.connectionState}
          </span>
        </div>
      </footer>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bannerIn {
          from { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
          to   { opacity: 1; max-height: 120px; padding-top: 16px; padding-bottom: 16px; }
        }
      `}</style>
    </div>
  )
}
