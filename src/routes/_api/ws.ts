/**
 * CinemaSync WebSocket Signaling Server
 * Handles WebRTC signaling (offer/answer/ICE candidates) and playback sync events.
 * Rooms are ephemeral in-memory; no server-side recording.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// ── In-memory room registry ─────────────────────────────────────────────────
interface Peer {
  id: string
  role: 'host' | 'viewer'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send: (data: string) => void
}

interface Room {
  id: string
  peers: Map<string, Peer>
  createdAt: number
  playbackState: {
    playing: boolean
    currentTime: number
    playbackRate: number
    updatedAt: number
  }
}

const rooms = new Map<string, Room>()

// Clean up stale rooms older than 24 hours
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [id, room] of rooms) {
    if (room.createdAt < cutoff) {
      rooms.delete(id)
    }
  }
}, 60 * 60 * 1000)

// ── Room management server functions ────────────────────────────────────────

export const createRoomFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ roomId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { roomId } = data

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        peers: new Map(),
        createdAt: Date.now(),
        playbackState: {
          playing: false,
          currentTime: 0,
          playbackRate: 1,
          updatedAt: Date.now(),
        },
      })
    }

    return { roomId, created: true }
  })

export const getRoomInfoFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ roomId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const room = rooms.get(data.roomId)
    if (!room) return { exists: false, peerCount: 0, playbackState: null }

    return {
      exists: true,
      peerCount: room.peers.size,
      playbackState: room.playbackState,
    }
  })
