/**
 * CinemaSync – VideoPlayer
 * Host: renders local file + controls
 * Viewer: renders remote P2P stream (controls are display-only, host-driven)
 */
import { useRef, useState, useEffect, useCallback } from 'react'
import type { Role, SyncState, AudioTrackOption } from '@/hooks/use-cinema-room'

interface VideoPlayerProps {
  role: Role
  remoteStream: MediaStream | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  syncState: SyncState
  videoFileName: string | null
  audioTrackOptions?: AudioTrackOption[]
  selectedAudioTrackIndex?: number
  remoteAudioTrackLabel?: string | null
  onLoadFile: (file: File) => void
  onTogglePlay: () => void
  onSeek: (t: number) => void
  onSetSpeed: (r: number) => void
  onSetAudioTrack?: (index: number, label?: string) => void
  onFullscreen?: () => void
  peerConnected: boolean
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

function fmtTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function VideoPlayer({
  role,
  remoteStream,
  videoRef,
  syncState,
  videoFileName,
  audioTrackOptions = [],
  selectedAudioTrackIndex = 0,
  remoteAudioTrackLabel = null,
  onLoadFile,
  onTogglePlay,
  onSeek,
  onSetSpeed,
  onSetAudioTrack,
  onFullscreen,
  peerConnected,
}: VideoPlayerProps) {
  const viewerVideoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(0)
  const [viewerVolume, setViewerVolume] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [audioTrackOpen, setAudioTrackOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [needsUnmute, setNeedsUnmute] = useState(true)
  const [debugInfo, setDebugInfo] = useState('')
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const unlockAudio = useCallback(() => {
    const vid = viewerVideoRef.current
    if (vid) {
      vid.muted = false
      vid.volume = 1.0
      vid.play().catch(() => null)
    }
    setNeedsUnmute(false)
  }, [])

  // Assign full stream to video element
  useEffect(() => {
    const vid = viewerVideoRef.current
    if (!vid || !remoteStream || role !== 'viewer') return

    const vTracks = remoteStream.getVideoTracks()
    const aTracks = remoteStream.getAudioTracks()
    console.log(`[VideoPlayer] Setting srcObject: ${vTracks.length} video, ${aTracks.length} audio`)
    vTracks.forEach((t) => {
      t.enabled = true
      console.log(`[VideoPlayer] Video track: ${t.id} state=${t.readyState} enabled=${t.enabled}`, t.getSettings())
    })

    vid.srcObject = remoteStream
    vid.muted = true

    const tryPlay = () => {
      vid.play().then(() => {
        console.log('[VideoPlayer] play() succeeded', vid.videoWidth, 'x', vid.videoHeight)
      }).catch((e) => {
        console.warn('[VideoPlayer] play() failed:', e)
      })
    }

    vid.onloadedmetadata = () => {
      console.log('[VideoPlayer] loadedmetadata', vid.videoWidth, 'x', vid.videoHeight)
      tryPlay()
    }
    vid.onresize = () => {
      console.log('[VideoPlayer] resize', vid.videoWidth, 'x', vid.videoHeight)
    }

    tryPlay()
    setTimeout(tryPlay, 500)
    setTimeout(tryPlay, 2000)
    setNeedsUnmute(true)
  }, [role, remoteStream])

  // Diagnostic: poll video element state and show overlay
  useEffect(() => {
    if (role !== 'viewer' || !remoteStream) return
    const iv = setInterval(() => {
      const vid = viewerVideoRef.current
      if (!vid) return
      const vt = remoteStream.getVideoTracks()[0]
      const info = [
        `${vid.videoWidth}x${vid.videoHeight}`,
        `ready=${vid.readyState}`,
        vid.paused ? 'PAUSED' : 'playing',
        vt ? `trk=${vt.readyState}` : 'no-trk',
      ].join(' | ')
      setDebugInfo(info)
    }, 1000)
    return () => clearInterval(iv)
  }, [role, remoteStream])

  useEffect(() => {
    if (role !== 'viewer') return
    const vid = viewerVideoRef.current
    if (vid) vid.volume = viewerVolume
  }, [role, viewerVolume])

  // Mirror syncState for viewer display
  useEffect(() => {
    if (role === 'viewer') {
      setIsPlaying(syncState.playing)
      setCurrentTime(syncState.currentTime)
    }
  }, [role, syncState])

  // Track host's own video element state
  useEffect(() => {
    if (role !== 'host') return
    const vid = videoRef.current
    if (!vid) return

    const onTime = () => {
      if (!isDragging) setCurrentTime(vid.currentTime)
    }
    const onMeta = () => setDuration(vid.duration)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)

    vid.addEventListener('timeupdate', onTime)
    vid.addEventListener('loadedmetadata', onMeta)
    vid.addEventListener('play', onPlay)
    vid.addEventListener('pause', onPause)

    return () => {
      vid.removeEventListener('timeupdate', onTime)
      vid.removeEventListener('loadedmetadata', onMeta)
      vid.removeEventListener('play', onPlay)
      vid.removeEventListener('pause', onPause)
    }
  }, [role, videoRef, isDragging])

  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setShowControls(true)
    hideTimer.current = setTimeout(() => setShowControls(false), 3000)
  }

  const handleMouseMove = () => scheduleHide()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onLoadFile(file)
      setDuration(0)
      setCurrentTime(0)
    }
  }

  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value)
    setCurrentTime(t)
  }

  const handleSeekCommit = () => {
    setIsDragging(false)
    const vid = videoRef.current
    if (vid && duration > 0) {
      onSeek(currentTime)
    }
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const handleFullscreen = useCallback(() => {
    const el = stageRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen?.() ?? (el as HTMLElement & { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
  }, [])

  return (
    <div
      ref={stageRef}
      className="relative w-full h-full bg-black flex items-center justify-center group"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowControls(false)}
      onMouseEnter={scheduleHide}
    >
      {/* Hidden host video (source of captureStream) */}
      {role === 'host' && (
        <video
          ref={videoRef as React.RefObject<HTMLVideoElement>}
          className="w-full h-full object-contain"
          playsInline
          preload="auto"
          style={{ display: videoFileName ? 'block' : 'none' }}
        />
      )}

      {/* Viewer video */}
      {role === 'viewer' && (
        <>
          <video
            ref={viewerVideoRef}
            className="w-full h-full object-contain bg-black"
            playsInline
            autoPlay
            muted
          />
          {debugInfo && (
            <div style={{
              position: 'absolute', top: 4, left: 4,
              background: 'rgba(0,0,0,0.7)', color: '#0f0',
              fontSize: 11, padding: '2px 6px', borderRadius: 4,
              fontFamily: 'monospace', zIndex: 50, pointerEvents: 'none',
            }}>
              {debugInfo}
            </div>
          )}
        </>
      )}

      {/* Viewer: tap-to-unmute — required on mobile Chrome (autoplay blocks audio) */}
      {role === 'viewer' && needsUnmute && (
        <button
          type="button"
          onClick={unlockAudio}
          onTouchEnd={(e) => {
            e.preventDefault()
            unlockAudio()
          }}
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 cursor-pointer bg-black/40"
        >
          <div className="flex flex-col items-center gap-3 bg-black/90 border-2 border-amber-500 rounded-2xl px-10 py-8 backdrop-blur-sm min-w-[200px]">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5">
              <path d="M9 9v6h4l5 5V4l-5 5H9z"/>
              <line x1="23" y1="9" x2="17" y2="15"/>
              <line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
            <p className="font-mono text-base text-amber-100 tracking-widest uppercase font-medium">Tap to enable audio</p>
            <p className="font-mono text-xs text-amber-100/50">Video is playing muted</p>
          </div>
        </button>
      )}

      {/* No video selected – host upload prompt */}
      {role === 'host' && !videoFileName && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 z-10">
          <div className="text-center space-y-3">
            <p className="font-display text-4xl text-amber-100/80 font-light italic">
              Select a film to begin
            </p>
            <p className="font-mono text-xs text-amber-100/30 tracking-widest uppercase">
              MP4 · MKV · MOV · WEBM
            </p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="group/btn relative px-8 py-3 border border-amber-500/40 text-amber-400 font-mono text-sm tracking-widest uppercase hover:border-amber-400 hover:text-amber-300 transition-all duration-300 hover:bg-amber-500/5"
          >
            <span className="relative z-10">Open File</span>
            <div className="absolute inset-0 bg-gradient-to-r from-amber-500/0 via-amber-500/5 to-amber-500/0 opacity-0 group-hover/btn:opacity-100 transition-opacity" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* Viewer waiting for stream */}
      {role === 'viewer' && !peerConnected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10">
          <div className="w-8 h-8 border border-amber-500/40 border-t-amber-400 rounded-full animate-spin" />
          <p className="font-mono text-xs text-amber-100/40 tracking-widest uppercase">
            Awaiting host…
          </p>
        </div>
      )}

      {/* Viewer: peer connected but no stream yet */}
      {role === 'viewer' && peerConnected && !remoteStream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10">
          <p className="font-mono text-xs text-amber-100/40 tracking-widest uppercase">
            Host is selecting a film…
          </p>
        </div>
      )}

      {/* Gradient overlay for controls visibility */}
      <div
        className="absolute inset-x-0 bottom-0 h-40 pointer-events-none z-20 transition-opacity duration-500"
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)',
          opacity: showControls ? 1 : 0,
        }}
      />

      {/* ── Controls ── */}
      <div
        className="absolute inset-x-0 bottom-0 z-30 px-6 pb-5 transition-all duration-500"
        style={{
          opacity: showControls ? 1 : 0,
          transform: showControls ? 'translateY(0)' : 'translateY(8px)',
        }}
      >
        {/* File name */}
        {videoFileName && (
          <p className="font-mono text-xs text-amber-100/40 tracking-wider mb-3 truncate max-w-md">
            {videoFileName}
          </p>
        )}

        {/* Seek bar */}
        <div className="relative mb-4 group/seek">
          <div className="h-0.5 bg-white/10 rounded-full relative overflow-visible">
            <div
              className="absolute inset-y-0 left-0 bg-amber-400 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          {role === 'host' && duration > 0 && (
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={currentTime}
              className="absolute inset-0 w-full opacity-0 cursor-pointer h-6 -top-2.5"
              onChange={handleSeekInput}
              onMouseDown={() => setIsDragging(true)}
              onMouseUp={handleSeekCommit}
              onTouchEnd={handleSeekCommit}
            />
          )}
          {/* Thumb dot */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-400 shadow-amber-400/50 shadow-lg transition-all"
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>

        {/* Control row */}
        <div className="flex items-center gap-5">
          {/* Play/Pause */}
          {role === 'host' ? (
            <button
              onClick={onTogglePlay}
              className="text-amber-100 hover:text-amber-300 transition-colors"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5.14v14l11-7-11-7z" />
                </svg>
              )}
            </button>
          ) : (
            <div
              className="text-amber-100/30"
              title="Playback controlled by host"
            >
              {isPlaying ? (
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5.14v14l11-7-11-7z" />
                </svg>
              )}
            </div>
          )}

          {/* Skip back 10s (host only) */}
          {role === 'host' && (
            <button
              onClick={() => onSeek(Math.max(0, currentTime - 10))}
              className="text-amber-100/60 hover:text-amber-100 transition-colors"
              title="Back 10s"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
                <text
                  x="9"
                  y="16"
                  fontSize="5"
                  fill="currentColor"
                  stroke="none"
                  fontFamily="DM Mono"
                >
                  10
                </text>
              </svg>
            </button>
          )}

          {/* Skip forward 10s (host only) */}
          {role === 'host' && (
            <button
              onClick={() => onSeek(Math.min(duration, currentTime + 10))}
              className="text-amber-100/60 hover:text-amber-100 transition-colors"
              title="Forward 10s"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M11.5 8c2.65 0 5.05.99 6.9 2.6L22 7v9h-9l3.62-3.62A7.494 7.494 0 0 0 11.5 10.5C7.96 10.5 4.95 12.81 3.9 16l-2.37-.78C2.92 11.03 6.85 8 11.5 8z" />
                <text
                  x="9"
                  y="16"
                  fontSize="5"
                  fill="currentColor"
                  stroke="none"
                  fontFamily="DM Mono"
                >
                  10
                </text>
              </svg>
            </button>
          )}

          {/* Time display */}
          <span className="font-mono text-xs text-amber-100/50 tabular-nums">
            {fmtTime(currentTime)}
            {duration > 0 && (
              <span className="text-amber-100/25"> / {fmtTime(duration)}</span>
            )}
          </span>

          <div className="flex-1" />

          {/* Audio track / language (host only, multi-language films) */}
          {role === 'host' && audioTrackOptions.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setAudioTrackOpen((o) => !o)}
                className="font-mono text-xs text-amber-100/50 hover:text-amber-400 transition-colors tracking-wider"
                title="Change audio language (synced to viewer live)"
              >
                {audioTrackOptions[selectedAudioTrackIndex]?.label || 'Audio'}
                {audioTrackOptions[selectedAudioTrackIndex]?.language && (
                  <span className="text-amber-100/40"> ({audioTrackOptions[selectedAudioTrackIndex].language})</span>
                )}
              </button>
              {audioTrackOpen && (
                <div className="absolute bottom-8 left-0 bg-neutral-900 border border-white/10 rounded py-1 min-w-[100px]">
                  {audioTrackOptions.map((t) => {
                    const displayLabel = t.language ? `${t.label} (${t.language})` : t.label || `Track ${t.index + 1}`
                    return (
                      <button
                        key={t.index}
                        onClick={() => {
                          onSetAudioTrack?.(t.index, displayLabel)
                          setAudioTrackOpen(false)
                        }}
                        className={`w-full text-left px-3 py-1 font-mono text-xs hover:text-amber-300 transition-colors ${
                          selectedAudioTrackIndex === t.index ? 'text-amber-400' : 'text-amber-100/50'
                        }`}
                      >
                        {t.language ? `${t.label} (${t.language})` : t.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Speed (host only) */}
          {role === 'host' && (
            <div className="relative">
              <button
                onClick={() => setSpeedOpen((o) => !o)}
                className="font-mono text-xs text-amber-100/50 hover:text-amber-400 transition-colors tracking-wider"
              >
                {syncState.playbackRate}×
              </button>
              {speedOpen && (
                <div className="absolute bottom-8 right-0 bg-neutral-900 border border-white/10 rounded py-1 min-w-[72px]">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        onSetSpeed(s)
                        setSpeedOpen(false)
                      }}
                      className={`w-full text-right px-3 py-1 font-mono text-xs hover:text-amber-300 transition-colors ${
                        syncState.playbackRate === s
                          ? 'text-amber-400'
                          : 'text-amber-100/50'
                      }`}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Change file (host only) */}
          {role === 'host' && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="font-mono text-xs text-amber-100/30 hover:text-amber-100/60 transition-colors tracking-widest uppercase"
                title="Change file"
              >
                File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </>
          )}

          {/* Viewer: current audio language (synced from host) */}
          {role === 'viewer' && remoteAudioTrackLabel && (
            <span className="font-mono text-xs text-amber-100/40 tracking-wider" title="Audio track (host-selected)">
              🎧 {remoteAudioTrackLabel}
            </span>
          )}

          {/* Viewer: fullscreen + volume (local-only, no sync impact) */}
          {role === 'viewer' && peerConnected && remoteStream && (
            <>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={viewerVolume}
                onChange={(e) => setViewerVolume(parseFloat(e.target.value))}
                className="w-16 h-1 accent-amber-500"
                title="Volume"
              />
              <button
                onClick={onFullscreen ?? handleFullscreen}
                className="text-amber-100/60 hover:text-amber-300 transition-colors"
                title="Fullscreen"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              </button>
            </>
          )}

          {/* Viewer label when no stream yet */}
          {role === 'viewer' && (!peerConnected || !remoteStream) && (
            <span className="font-mono text-xs text-amber-100/20 tracking-widest uppercase">
              Host controls
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
