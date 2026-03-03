/**
 * CinemaSync – Core WebRTC + Polling Signaling Hook
 *
 * Signaling via HTTP polling (GET every 800ms) + HTTP POST.
 * No SSE, no WebSocket — works through any buffering proxy on port 3000.
 *
 * Audio mixing (Google Meet-style):
 *  Movie audio + PTT mic → AudioContext mixer → single WebRTC audio track
 *  Viewer hears movie sound AND host voice through the WebRTC stream.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type Role = 'host' | 'viewer'
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disconnected'

export interface ChatMessage {
  id: string
  from: 'me' | 'them'
  text: string
  ts: number
}

export interface SyncState {
  playing: boolean
  currentTime: number
  playbackRate: number
}

export interface AudioTrackOption {
  index: number
  label: string
  language: string
}

export interface CinemaRoomState {
  role: Role
  connectionState: ConnectionState
  remoteStream: MediaStream | null
  remoteVoiceStream: MediaStream | null
  localCameraStream: MediaStream | null
  remoteCameraStream: MediaStream | null
  chatMessages: ChatMessage[]
  syncState: SyncState
  peerConnected: boolean
  pttActive: boolean
  videoFileName: string | null
  audioTrackOptions: AudioTrackOption[]
  selectedAudioTrackIndex: number
  /** Viewer: label of current audio track (synced from host) */
  remoteAudioTrackLabel: string | null
}

interface UseCinemaRoomOptions {
  roomId: string
  role: Role
  videoRef: React.RefObject<HTMLVideoElement | null>
  wsUrl: string // kept for API compat — unused
}

// ── STUN / TURN config ─────────────────────────────────────────────────────

// Keep to 4 servers — Chrome warns "five or more slows discovery"
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turns:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]

const POLL_INTERVAL_MS = 800

// ── Hook ───────────────────────────────────────────────────────────────────

export function useCinemaRoom({
  role,
  videoRef,
  roomId,
}: UseCinemaRoomOptions) {
  // ── All mutable refs (no stale closures) ────────────────────────────
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dataChanRef = useRef<RTCDataChannel | null>(null)
  const localVideoStreamRef = useRef<MediaStream | null>(null)
  const voiceStreamRef = useRef<MediaStream | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef<number>(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const micGainRef = useRef<GainNode | null>(null)
  const localGainRef = useRef<GainNode | null>(null) // host's local playback volume (movie in their ears)
  const mixedDestRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const movieSrcConnectedRef = useRef(false)
  const mountedRef = useRef(true)
  const makingOfferRef = useRef(false)
  const ignoreOfferRef = useRef(false)
  const peerConnectedRef = useRef(false)
  // Stable stream object for viewer — tracks are added to it as they arrive via ontrack
  const remoteFilmStreamRef = useRef<MediaStream | null>(null)

  const peerId = useRef(crypto.randomUUID())
  const roleRef = useRef(role)
  roleRef.current = role
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId

  // ── React UI state ───────────────────────────────────────────────────
  const [state, setState] = useState<CinemaRoomState>({
    role,
    connectionState: 'idle',
    remoteStream: null,
    localCameraStream: null,
    remoteCameraStream: null,
    chatMessages: [],
    syncState: { playing: false, currentTime: 0, playbackRate: 1 },
    peerConnected: false,
    pttActive: false,
    videoFileName: null,
    audioTrackOptions: [],
    selectedAudioTrackIndex: 0,
    remoteAudioTrackLabel: null,
    remoteVoiceStream: null,
  })

  const audioTrackInfoRef = useRef<{ index: number; label: string } | null>(null)

  const patch = useCallback((partial: Partial<CinemaRoomState>) => {
    if (!mountedRef.current) return
    setState((prev) => ({ ...prev, ...partial }))
  }, [])

  // ── HTTP POST signaling sender ───────────────────────────────────────
  const postSignal = useCallback((msg: object) => {
    if (typeof window === 'undefined') return
    const url = `/signal/${roomIdRef.current}`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...msg,
        peerId: peerId.current,
        role: roleRef.current,
      }),
    }).catch(() => null)
  }, [])

  // ── DataChannel send ─────────────────────────────────────────────────
  const dcSend = useCallback((msg: object) => {
    const dc = dataChanRef.current
    if (dc?.readyState === 'open') {
      dc.send(JSON.stringify(msg))
    }
  }, [])

  // ── Playback sync ────────────────────────────────────────────────────
  const sendSync = useCallback(
    (extra?: Partial<SyncState>) => {
      const vid = videoRef.current
      if (!vid) return
      const payload = {
        type: 'sync',
        playing: !vid.paused,
        currentTime: vid.currentTime,
        playbackRate: vid.playbackRate,
        ts: Date.now(),
        ...extra,
      }
      dcSend(payload)
      postSignal(payload)
    },
    [videoRef, dcSend, postSignal],
  )

  const applySync = useCallback(
    (s: SyncState & { ts?: number }) => {
      const vid = videoRef.current
      if (!vid || roleRef.current === 'host') return

      const latency = s.ts ? (Date.now() - s.ts) / 1000 : 0.03
      const target = s.currentTime + (s.playing ? latency : 0)

      if (Math.abs(vid.currentTime - target) > 0.5) {
        vid.currentTime = target
      }
      vid.playbackRate = s.playbackRate

      if (s.playing && vid.paused) {
        vid.play().catch(() => null)
      } else if (!s.playing && !vid.paused) {
        vid.pause()
      }

      patch({
        syncState: {
          playing: s.playing,
          currentTime: s.currentTime,
          playbackRate: s.playbackRate,
        },
      })
    },
    [videoRef, patch],
  )

  // ── Audio context: Google Meet-style mixing ──────────────────────────
  const ensureAudioContext = useCallback((): AudioContext => {
    if (audioCtxRef.current) return audioCtxRef.current

    const ctx = new AudioContext({ sampleRate: 48000 })
    audioCtxRef.current = ctx

    const dest = ctx.createMediaStreamDestination()
    mixedDestRef.current = dest

    const micGain = ctx.createGain()
    micGain.gain.value = 0
    micGain.connect(dest)
    micGainRef.current = micGain

    return ctx
  }, [])

  const connectVideoAudio = useCallback(
    (vid: HTMLVideoElement) => {
      if (movieSrcConnectedRef.current) return
      const ctx = ensureAudioContext()

      try {
        const src = ctx.createMediaElementSource(vid)

        // Host local playback: movie → localGain → speakers/headphones (so host hears the film)
        const localGain = ctx.createGain()
        localGain.gain.value = 1.0
        localGainRef.current = localGain
        src.connect(localGain)
        localGain.connect(ctx.destination)

        // Same movie audio also goes to mixedDest → WebRTC (viewer hears film + host voice)
        src.connect(mixedDestRef.current!)

        movieSrcConnectedRef.current = true
        console.log('[CinemaSync] connectVideoAudio — host speakers + WebRTC mix ✓')
      } catch (e) {
        console.warn('[CinemaSync] connectVideoAudio failed (may already be connected):', e)
      }
    },
    [ensureAudioContext],
  )

  // ── Perfect negotiation (RFC 8829) ───────────────────────────────────
  const negotiate = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || pc.signalingState === 'closed') return
    try {
      makingOfferRef.current = true
      await pc.setLocalDescription()
      postSignal({ type: 'offer', sdp: pc.localDescription })
    } catch (e) {
      console.error('[CinemaSync] negotiate error', e)
    } finally {
      makingOfferRef.current = false
    }
  }, [postSignal])

  const setVideoQuality = useCallback((sender: RTCRtpSender) => {
    try {
      const params = sender.getParameters()
      if (!params.encodings) params.encodings = [{}]
      params.encodings[0].maxBitrate = 5_000_000
      params.encodings[0].maxFramerate = 30
      sender.setParameters(params).catch(() => null)
    } catch {
      /* unsupported */
    }
  }, [])

  const addVideoTracksToPC = useCallback(
    (pc: RTCPeerConnection) => {
      const stream = localVideoStreamRef.current
      if (!stream) return
      const existingIds = new Set(
        pc
          .getSenders()
          .map((s) => s.track?.id)
          .filter(Boolean),
      )
      for (const track of stream.getTracks()) {
        if (!existingIds.has(track.id)) {
          const sender = pc.addTrack(track, stream)
          if (track.kind === 'video') setVideoQuality(sender)
          console.log(`[CinemaSync] Added ${track.kind} track to PC`)
        }
      }
    },
    [setVideoQuality],
  )

  // ── DataChannel setup ────────────────────────────────────────────────
  const setupDataChannel = useCallback(
    (dc: RTCDataChannel) => {
      dc.onopen = () => {
        console.log('[CinemaSync] DataChannel open')
        patch({ peerConnected: true, connectionState: 'connected' })
        peerConnectedRef.current = true
        if (roleRef.current === 'host' && audioTrackInfoRef.current) {
          const { index, label } = audioTrackInfoRef.current
          dc.send(JSON.stringify({ type: 'audioTrack', index, label }))
        }
      }
      dc.onclose = () => {
        console.log('[CinemaSync] DataChannel closed')
      }
      dc.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as Record<string, unknown>
          if (msg.type === 'sync') {
            applySync(msg as unknown as SyncState & { ts: number })
          } else if (msg.type === 'chat') {
            const id = (msg.id as string) ?? crypto.randomUUID()
            const text = (msg.text as string) ?? ''
            const ts = (msg.ts as number) ?? Date.now()
            setState((prev) => ({
              ...prev,
              chatMessages: [
                ...prev.chatMessages,
                { id, from: 'them', text, ts },
              ],
            }))
          } else if (msg.type === 'audioTrack') {
            const label = (msg.label as string) ?? ''
            patch({ remoteAudioTrackLabel: label || null })
          }
        } catch {
          /* ignore */
        }
      }
    },
    [patch, applySync],
  )

  // ── PeerConnection factory ────────────────────────────────────────────
  const createPC = useCallback((): RTCPeerConnection => {
    if (pcRef.current) {
      const old = pcRef.current
      old.onicecandidate = null
      old.onconnectionstatechange = null
      old.ontrack = null
      old.ondatachannel = null
      old.onnegotiationneeded = null
      old.close()
      pcRef.current = null
    }
    // Reset the remote stream so stale tracks don't linger between sessions
    remoteFilmStreamRef.current = new MediaStream()

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        postSignal({ type: 'ice', candidate: candidate.toJSON() })
      }
    }

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      console.log('[CinemaSync] PC state:', s)
      if (s === 'connected') {
        patch({ connectionState: 'connected', peerConnected: true })
        peerConnectedRef.current = true
      } else if (s === 'disconnected') {
        if (roleRef.current === 'host') {
          setTimeout(() => {
            if (pcRef.current?.connectionState === 'disconnected') {
              pcRef.current.restartIce()
            }
          }, 2000)
        }
      } else if (s === 'failed') {
        patch({ connectionState: 'disconnected', peerConnected: false })
        peerConnectedRef.current = false
      }
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce()
    }

    // Bug fix: build a single stable remoteStream and add tracks to it as they arrive.
    // Do NOT rely on ev.streams[0] — it can be undefined or change between tracks.
    // Using a ref ensures the video element srcObject stays stable across React renders.
    if (!remoteFilmStreamRef.current) {
      remoteFilmStreamRef.current = new MediaStream()
    }
    const remoteFilmStream = remoteFilmStreamRef.current

    pc.ontrack = (ev) => {
      console.log(`[CinemaSync] ontrack: ${ev.track.kind} readyState=${ev.track.readyState}`)

      // Host receives viewer's PTT voice (audio from viewer)
      if (roleRef.current === 'host' && ev.track.kind === 'audio') {
        const stream = ev.streams[0] ?? new MediaStream([ev.track])
        patch({ remoteVoiceStream: stream })
        return
      }

      const label = (ev.track.label ?? '').toLowerCase()
      const isCamera =
        ev.track.kind === 'video' &&
        (label.includes('camera') ||
          label.includes('facetime') ||
          label.includes('webcam') ||
          label.includes('front') ||
          label.includes('back'))

      if (isCamera) {
        const camStream = ev.streams[0] ?? new MediaStream([ev.track])
        patch({ remoteCameraStream: camStream })
        return
      }

      // All other tracks (film video + film audio) go into the accumulating stream
      const alreadyHas = remoteFilmStream.getTracks().some((t) => t.id === ev.track.id)
      if (!alreadyHas) {
        remoteFilmStream.addTrack(ev.track)
        console.log(`[CinemaSync] Added ${ev.track.kind} to remoteFilmStream — total tracks: ${remoteFilmStream.getTracks().length}`)
      }

      const videoTracks = remoteFilmStream.getVideoTracks()
      const audioTracks = remoteFilmStream.getAudioTracks()
      console.log(`[CinemaSync] remoteFilmStream — video:${videoTracks.length} audio:${audioTracks.length}`)
      if (videoTracks.length > 0) {
        const vt = videoTracks[0]
        console.log(`[CinemaSync] Video track: id=${vt.id} readyState=${vt.readyState} enabled=${vt.enabled} muted=${vt.muted}`, vt.getSettings())
      }
      if (videoTracks.length === 0 || audioTracks.length === 0) return
      const freshStream = new MediaStream([...videoTracks, ...audioTracks])
      remoteFilmStreamRef.current = freshStream
      console.log('[CinemaSync] Dispatching remoteStream with', freshStream.getTracks().length, 'tracks')
      // Viewer: mark peer connected as soon as we have media (seamless UI, no "Awaiting host" once stream is live)
      if (roleRef.current === 'viewer') {
        patch({ remoteStream: freshStream, peerConnected: true })
        peerConnectedRef.current = true
      } else {
        patch({ remoteStream: freshStream })
      }
    }

    if (roleRef.current === 'host') {
      const dc = pc.createDataChannel('cinema', { ordered: true })
      setupDataChannel(dc)
      dataChanRef.current = dc
    } else {
      pc.ondatachannel = (ev) => {
        setupDataChannel(ev.channel)
        dataChanRef.current = ev.channel
      }
    }

    pcRef.current = pc
    return pc
  }, [postSignal, patch, setupDataChannel])

  // ── Handle a single signaling message ───────────────────────────────
  const handleMessage = useCallback(
    async (msg: Record<string, unknown>) => {
      const pc = pcRef.current

      switch (msg.type) {
        case 'room-state': {
          const peers = (msg.peers as Array<{ id: string; role: string }>) ?? []
          console.log(`[CinemaSync] room-state: ${peers.length} peer(s)`, peers)
          if (peers.length > 0) {
            patch({ peerConnected: true })
            peerConnectedRef.current = true
            if (roleRef.current === 'host' && pc) {
              addVideoTracksToPC(pc)
              pc.onnegotiationneeded = negotiate
              setTimeout(() => negotiate(), 150)
            }
          }
          break
        }

        case 'peer-joined': {
          console.log(
            `[CinemaSync] peer-joined! from=${String(msg.from)} role=${String(msg.role)}`,
          )
          patch({ peerConnected: true })
          peerConnectedRef.current = true

          if (roleRef.current === 'host' && pc) {
            addVideoTracksToPC(pc)
            pc.onnegotiationneeded = negotiate
            setTimeout(() => negotiate(), 200)
          }
          break
        }

        case 'offer': {
          if (!pc) break
          if ((msg.from as string) === peerId.current) break

          const offerCollision =
            makingOfferRef.current || pc.signalingState !== 'stable'
          ignoreOfferRef.current = roleRef.current === 'host' && offerCollision
          if (ignoreOfferRef.current) break

          try {
            await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit)
            if ((msg.sdp as RTCSessionDescriptionInit).type === 'offer') {
              await pc.setLocalDescription()
              postSignal({ type: 'answer', sdp: pc.localDescription })
            }
          } catch (e) {
            console.error('[CinemaSync] offer error:', e)
          }
          break
        }

        case 'answer': {
          if (!pc) break
          if ((msg.from as string) === peerId.current) break
          try {
            if (pc.signalingState === 'have-local-offer') {
              await pc.setRemoteDescription(
                msg.sdp as RTCSessionDescriptionInit,
              )
            }
          } catch (e) {
            console.error('[CinemaSync] answer error:', e)
          }
          break
        }

        case 'ice': {
          if (!pc) break
          if ((msg.from as string) === peerId.current) break
          try {
            await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit)
          } catch (e) {
            if (!ignoreOfferRef.current) {
              console.warn('[CinemaSync] ICE candidate error:', e)
            }
          }
          break
        }

        case 'sync': {
          if ((msg.from as string) === peerId.current) break
          applySync(msg as unknown as SyncState & { ts: number })
          break
        }

        case 'chat': {
          if ((msg.from as string) === peerId.current) break
          const id = (msg.id as string) ?? crypto.randomUUID()
          const text = (msg.text as string) ?? ''
          const ts = (msg.ts as number) ?? Date.now()
          setState((prev) => ({
            ...prev,
            chatMessages: [
              ...prev.chatMessages,
              { id, from: 'them', text, ts },
            ],
          }))
          break
        }

        case 'audioTrack': {
          if ((msg.from as string) === peerId.current) break
          const label = (msg.label as string) ?? ''
          patch({ remoteAudioTrackLabel: label || null })
          break
        }

        case 'peer-left': {
          console.log('[CinemaSync] peer-left')
          patch({ peerConnected: false })
          peerConnectedRef.current = false
          break
        }

        default:
          break
      }
    },
    [postSignal, applySync, negotiate, patch, addVideoTracksToPC],
  )

  // ── Polling loop ─────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    if (!mountedRef.current) return

    try {
      const url = `/signal/${roomIdRef.current}?peerId=${encodeURIComponent(peerId.current)}&role=${roleRef.current}`
      const res = await fetch(url, { cache: 'no-store' })

      if (res.ok) {
        const data = (await res.json()) as {
          messages: Record<string, unknown>[]
        }
        patch({ connectionState: 'connected' })

        for (const msg of data.messages ?? []) {
          await handleMessage(msg)
        }
      } else {
        patch({ connectionState: 'error' })
      }
    } catch {
      if (mountedRef.current) {
        patch({ connectionState: 'error' })
      }
    }

    if (mountedRef.current) {
      pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS)
    }
  }, [patch, handleMessage])

  // ── Start polling ────────────────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current)

    patch({ connectionState: 'connecting' })

    // Create the PC
    const pc = createPC()

    pc.onnegotiationneeded = negotiate

    if (roleRef.current === 'host' && localVideoStreamRef.current) {
      addVideoTracksToPC(pc)
    }

    // Announce ourselves via POST (the GET poll will also register us)
    postSignal({ type: 'join', role: roleRef.current })

    // Start polling immediately
    pollTimer.current = setTimeout(poll, 100)
  }, [createPC, addVideoTracksToPC, negotiate, postSignal, poll, patch])

  // ── Public API ────────────────────────────────────────────────────────

  const loadVideoFile = useCallback(
    async (file: File) => {
      const vid = videoRef.current
      if (!vid) return

      localVideoStreamRef.current?.getTracks().forEach((t) => t.stop())
      movieSrcConnectedRef.current = false

      const url = URL.createObjectURL(file)

      // Video element must not be muted so AudioContext createMediaElementSource gets real audio.
      // Host hears via AudioContext (localGain → destination), not the element directly.
      vid.muted = false
      vid.volume = 1
      vid.src = url
      vid.load()

      // Wait for metadata so duration/tracks are known
      await new Promise<void>((res) => {
        vid.onloadedmetadata = () => res()
      })

      // Enumerate audio tracks for language selector (multi-language films)
      const audioTracks = (vid as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { enabled: boolean; language: string; label: string } } }).audioTracks
      const options: AudioTrackOption[] = []
      let selectedIdx = 0
      if (audioTracks) {
        for (let i = 0; i < audioTracks.length; i++) {
          const t = audioTracks[i]
          options.push({
            index: i,
            label: t.label || t.language || `Track ${i + 1}`,
            language: t.language || '',
          })
        }
        const prefLang = (navigator.language || navigator.languages?.[0] || '').slice(0, 2).toLowerCase()
        for (let i = 0; i < audioTracks.length; i++) {
          const lang = (audioTracks[i].language || '').slice(0, 2).toLowerCase()
          if (prefLang && lang && lang === prefLang) {
            selectedIdx = i
            break
          }
        }
        if (selectedIdx === 0) {
          for (let i = 0; i < audioTracks.length; i++) {
            if (audioTracks[i].enabled) {
              selectedIdx = i
              break
            }
          }
        }
        for (let i = 0; i < audioTracks.length; i++) {
          audioTracks[i].enabled = i === selectedIdx
        }
      }
      patch({ audioTrackOptions: options, selectedAudioTrackIndex: selectedIdx })

      const selectedLabel = options[selectedIdx]?.label ?? (selectedIdx > 0 ? `Track ${selectedIdx + 1}` : '')
      if (selectedLabel) audioTrackInfoRef.current = { index: selectedIdx, label: selectedLabel }

      // Build AudioContext BEFORE captureStream so the audio pipeline is ready.
      // connectVideoAudio wires: videoElement → AudioContext → mixedDest (WebRTC out)
      //                                                      → ctx.destination (host speakers)
      if (roleRef.current === 'host') {
        const ctx = ensureAudioContext()
        // Resume must happen inside a user-gesture callstack.
        // loadVideoFile is always called from a file-picker click, so this is safe.
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => null)
        }
        connectVideoAudio(vid)
      }

      // ── Canvas-based video capture (more reliable than videoElement.captureStream) ──
      // Some browsers don't produce video frames from captureStream when the element
      // was hidden (display:none) or after createMediaElementSource was called.
      // Drawing to a canvas and capturing that stream is universally reliable.

      cancelAnimationFrame(animFrameRef.current)

      let canvas = captureCanvasRef.current
      if (canvas) {
        canvas.remove()
      }
      canvas = document.createElement('canvas')
      canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;'
      document.body.appendChild(canvas)
      captureCanvasRef.current = canvas

      const cw = vid.videoWidth || 1920
      const ch = vid.videoHeight || 1080
      canvas.width = cw
      canvas.height = ch
      const ctx2d = canvas.getContext('2d')!

      // Draw the first frame immediately so the stream has content
      ctx2d.drawImage(vid, 0, 0, cw, ch)

      // Continuous draw loop for seamless streaming — keep drawing while video is ready
      const drawLoop = () => {
        if (vid.readyState >= 2) {
          ctx2d.drawImage(vid, 0, 0, cw, ch)
        }
        animFrameRef.current = requestAnimationFrame(drawLoop)
      }
      animFrameRef.current = requestAnimationFrame(drawLoop)

      const canvasStream = (canvas as HTMLCanvasElement & {
        captureStream?: (fps?: number) => MediaStream
      }).captureStream?.(30)

      if (!canvasStream) {
        console.error('[CinemaSync] canvas.captureStream() not supported')
        return
      }

      // Wait until the canvas stream's video track is live
      await new Promise<void>((res) => {
        const check = () => {
          const vt = canvasStream.getVideoTracks()
          if (vt.length > 0 && vt[0].readyState === 'live') return res()
          setTimeout(check, 80)
        }
        check()
      })

      console.log('[CinemaSync] Canvas capture started:', cw, 'x', ch)

      const outStream = new MediaStream()

      for (const t of canvasStream.getVideoTracks()) outStream.addTrack(t)

      if (mixedDestRef.current) {
        const audioTracks = mixedDestRef.current.stream.getAudioTracks()
        console.log('[CinemaSync] AudioContext audio tracks:', audioTracks.length, audioTracks[0]?.readyState)
        for (const t of audioTracks) outStream.addTrack(t)
      } else {
        console.warn('[CinemaSync] No AudioContext — falling back to element audio')
        const captureEl = vid as HTMLVideoElement & {
          captureStream?: () => MediaStream
          mozCaptureStream?: () => MediaStream
        }
        const elStream = captureEl.captureStream?.() ?? captureEl.mozCaptureStream?.()
        if (elStream) {
          for (const t of elStream.getAudioTracks()) outStream.addTrack(t)
        }
      }

      console.log(
        `[CinemaSync] loadVideoFile — outStream video:${outStream.getVideoTracks().length} audio:${outStream.getAudioTracks().length}`,
      )

      localVideoStreamRef.current = outStream
      patch({ videoFileName: file.name })

      // Wire tracks into the peer connection and force renegotiation
      const pc = pcRef.current
      if (pc && pc.signalingState !== 'closed') {
        let needsNegotiation = false
        const senders = pc.getSenders()
        for (const track of outStream.getTracks()) {
          const existing = senders.find((s) => s.track?.kind === track.kind)
          if (existing) {
            await existing.replaceTrack(track)
            if (track.kind === 'video') setVideoQuality(existing)
            console.log(`[CinemaSync] replaceTrack ${track.kind}`)
          } else {
            const sender = pc.addTrack(track, outStream)
            if (track.kind === 'video') setVideoQuality(sender)
            console.log(`[CinemaSync] addTrack ${track.kind}`)
            needsNegotiation = true
          }
        }
        if (needsNegotiation) {
          console.log('[CinemaSync] Explicit renegotiation after addTrack')
          await negotiate()
        }
      }

      if (audioTrackInfoRef.current && peerConnectedRef.current) {
        const { index, label } = audioTrackInfoRef.current
        dcSend({ type: 'audioTrack', index, label })
        postSignal({ type: 'audioTrack', index, label })
      }
    },
    [videoRef, patch, connectVideoAudio, ensureAudioContext, setVideoQuality, dcSend, postSignal, negotiate],
  )

  const togglePlay = useCallback(() => {
    const vid = videoRef.current
    if (!vid || roleRef.current !== 'host') return
    if (vid.paused) {
      // Unlock host speakers (Edge/Firefox require resume on user gesture)
      audioCtxRef.current?.resume().catch(() => null)
      if (localGainRef.current) localGainRef.current.gain.value = 1.0
      vid
        .play()
        .then(() => sendSync())
        .catch(() => null)
    } else {
      vid.pause()
      sendSync()
    }
  }, [videoRef, sendSync])

  const seek = useCallback(
    (time: number) => {
      const vid = videoRef.current
      if (!vid || roleRef.current !== 'host') return
      vid.currentTime = time
      sendSync()
    },
    [videoRef, sendSync],
  )

  const setSpeed = useCallback(
    (rate: number) => {
      const vid = videoRef.current
      if (!vid || roleRef.current !== 'host') return
      vid.playbackRate = rate
      sendSync()
    },
    [videoRef, sendSync],
  )

  const setAudioTrack = useCallback(
    (index: number, label?: string) => {
      const vid = videoRef.current
      if (!vid || roleRef.current !== 'host') return
      const audioTracks = (vid as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }).audioTracks
      if (!audioTracks) return
      for (let i = 0; i < audioTracks.length; i++) {
        audioTracks[i].enabled = i === index
      }
      const displayLabel = label ?? `Track ${index + 1}`
      audioTrackInfoRef.current = { index, label: displayLabel }
      patch({ selectedAudioTrackIndex: index })
      dcSend({ type: 'audioTrack', index, label: displayLabel })
      postSignal({ type: 'audioTrack', index, label: displayLabel })
    },
    [videoRef, patch, dcSend, postSignal],
  )

  const sendChat = useCallback(
    (text: string) => {
      const id = crypto.randomUUID()
      const ts = Date.now()
      dcSend({ type: 'chat', id, text, ts })
      postSignal({ type: 'chat', id, text, ts })
      setState((prev) => ({
        ...prev,
        chatMessages: [...prev.chatMessages, { id, from: 'me', text, ts }],
      }))
    },
    [dcSend, postSignal],
  )

  const startPTT = useCallback(async () => {
    if (voiceStreamRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
        video: false,
      })
      voiceStreamRef.current = stream

      if (roleRef.current === 'host') {
        const ctx = ensureAudioContext()
        if (ctx.state === 'suspended') await ctx.resume()
        const micSrc = ctx.createMediaStreamSource(stream)
        micSrc.connect(micGainRef.current!)
        if (micGainRef.current) micGainRef.current.gain.value = 1
      } else {
        // Viewer: add mic track to PC so host hears her — triggers renegotiation
        const pc = pcRef.current
        if (pc && pc.signalingState !== 'closed') {
          const [track] = stream.getAudioTracks()
          if (track) {
            pc.addTrack(track, stream)
            console.log('[CinemaSync] Viewer added PTT track, negotiating…')
            await negotiate()
          }
        }
      }

      patch({ pttActive: true })
    } catch (e) {
      console.warn('[CinemaSync] PTT denied:', e)
    }
  }, [patch, ensureAudioContext, negotiate])

  const stopPTT = useCallback(() => {
    if (roleRef.current === 'host') {
      if (micGainRef.current) micGainRef.current.gain.value = 0
    } else {
      // Viewer: remove PTT track from PC (viewer only adds her mic as audio)
      const stream = voiceStreamRef.current
      const pc = pcRef.current
      if (pc && stream) {
        const ids = new Set(stream.getAudioTracks().map((t) => t.id))
        const senders = pc.getSenders().filter((s) => s.track && ids.has(s.track.id))
        senders.forEach((s) => pc.removeTrack(s))
        if (senders.length) negotiate()
      }
    }
    voiceStreamRef.current?.getTracks().forEach((t) => t.stop())
    voiceStreamRef.current = null
    patch({ pttActive: false })
  }, [patch, negotiate])

  const toggleCamera = useCallback(async () => {
    if (cameraStreamRef.current) {
      const stream = cameraStreamRef.current
      const trackIds = new Set(stream.getTracks().map((t) => t.id))
      const pc = pcRef.current
      if (pc) {
        pc.getSenders()
          .filter((s) => s.track && trackIds.has(s.track.id))
          .forEach((s) => pc.removeTrack(s))
        negotiate()
      }
      stream.getTracks().forEach((t) => t.stop())
      cameraStreamRef.current = null
      patch({ localCameraStream: null })
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        cameraStreamRef.current = stream
        patch({ localCameraStream: stream })
        const pc = pcRef.current
        if (pc && pc.signalingState !== 'closed') {
          for (const track of stream.getVideoTracks()) {
            pc.addTrack(track, stream)
          }
          negotiate()
        }
      } catch {
        /* permission denied */
      }
    }
  }, [patch, negotiate])

  // ── Host: push sync on video events + unlock local audio (Edge/Firefox) ──

  useEffect(() => {
    if (role !== 'host') return
    const vid = videoRef.current
    if (!vid) return

    const onPlay = () => {
      // Unlock host speakers: browsers (Edge, Firefox) often keep AudioContext suspended until play
      audioCtxRef.current?.resume().catch(() => null)
      if (localGainRef.current) localGainRef.current.gain.value = 1.0
      sendSync()
    }
    const onPause = () => sendSync()
    const onSeeked = () => sendSync()
    const onRateChange = () => sendSync()

    vid.addEventListener('play', onPlay)
    vid.addEventListener('pause', onPause)
    vid.addEventListener('seeked', onSeeked)
    vid.addEventListener('ratechange', onRateChange)

    return () => {
      vid.removeEventListener('play', onPlay)
      vid.removeEventListener('pause', onPause)
      vid.removeEventListener('seeked', onSeeked)
      vid.removeEventListener('ratechange', onRateChange)
    }
  }, [role, videoRef, sendSync])

  // ── Mount / unmount ──────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true
    startPolling()

    return () => {
      mountedRef.current = false
      if (pollTimer.current) clearTimeout(pollTimer.current)
      cancelAnimationFrame(animFrameRef.current)
      captureCanvasRef.current?.remove()
      captureCanvasRef.current = null

      postSignal({ type: 'leave' })

      pcRef.current?.close()
      audioCtxRef.current?.close().catch(() => null)
      localVideoStreamRef.current?.getTracks().forEach((t) => t.stop())
      voiceStreamRef.current?.getTracks().forEach((t) => t.stop())
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [roomId])

  return {
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
    sendSync,
  }
}
