/**
 * CinemaSync – Voice (PTT) + Camera widget
 */
import { useRef, useEffect } from 'react'

interface VoiceCameraProps {
  pttActive: boolean
  onPTTStart: () => void
  onPTTStop: () => void
  onToggleCamera: () => void
  localCameraStream: MediaStream | null
  remoteCameraStream: MediaStream | null
  peerConnected: boolean
}

export function VoiceCamera({
  pttActive,
  onPTTStart,
  onPTTStop,
  onToggleCamera,
  localCameraStream,
  remoteCameraStream,
  peerConnected,
}: VoiceCameraProps) {
  const localVidRef = useRef<HTMLVideoElement>(null)
  const remoteVidRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = localVidRef.current
    if (!v) return
    if (localCameraStream) {
      v.srcObject = localCameraStream
      v.play().catch(() => null)
    } else {
      v.srcObject = null
    }
  }, [localCameraStream])

  useEffect(() => {
    const v = remoteVidRef.current
    if (!v) return
    if (remoteCameraStream) {
      v.srcObject = remoteCameraStream
      v.play().catch(() => null)
    } else {
      v.srcObject = null
    }
  }, [remoteCameraStream])

  return (
    <div className="flex items-center gap-3">
      {/* PTT button */}
      <button
        onMouseDown={onPTTStart}
        onMouseUp={onPTTStop}
        onTouchStart={onPTTStart}
        onTouchEnd={onPTTStop}
        className={`flex items-center gap-1.5 px-3 py-2 transition-all duration-150 font-mono text-xs tracking-widest uppercase select-none ${
          pttActive
            ? 'text-amber-300 bg-amber-500/20 border border-amber-500/50'
            : 'text-amber-100/40 hover:text-amber-100/70 border border-transparent'
        }`}
        title="Hold to talk"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={pttActive ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        {pttActive ? 'Talking' : 'Hold'}
      </button>

      {/* Camera toggle */}
      <button
        onClick={onToggleCamera}
        className={`flex items-center gap-1.5 px-3 py-2 transition-all duration-150 font-mono text-xs tracking-widest uppercase select-none ${
          localCameraStream
            ? 'text-amber-300 bg-amber-500/10 border border-amber-500/30'
            : 'text-amber-100/40 hover:text-amber-100/70 border border-transparent'
        }`}
        title={localCameraStream ? 'Hide camera' : 'Show camera'}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={localCameraStream ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
        Cam
      </button>

      {/* Camera windows */}
      {(localCameraStream || remoteCameraStream) && (
        <div className="flex gap-2 ml-1">
          {localCameraStream && (
            <div
              className="relative rounded-sm overflow-hidden border border-amber-500/20"
              style={{ width: 80, height: 60 }}
            >
              <video
                ref={localVidRef}
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-1 left-1">
                <span
                  className="font-mono text-white/60 bg-black/60 px-1 rounded"
                  style={{ fontSize: '8px' }}
                >
                  You
                </span>
              </div>
            </div>
          )}
          {remoteCameraStream && peerConnected && (
            <div
              className="relative rounded-sm overflow-hidden border border-amber-500/20"
              style={{ width: 80, height: 60 }}
            >
              <video
                ref={remoteVidRef}
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-1 left-1">
                <span
                  className="font-mono text-white/60 bg-black/60 px-1 rounded"
                  style={{ fontSize: '8px' }}
                >
                  Them
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
