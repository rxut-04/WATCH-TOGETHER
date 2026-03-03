/**
 * CinemaSync – In-process Polling Signaling Store
 *
 * Uses a simple message queue per peer.
 * Clients call GET /_api/signal/:roomId/poll?peerId=...  every ~800ms to drain queued messages.
 * Clients call POST /_api/signal/:roomId to send messages.
 *
 * No SSE, no WebSocket — works through any buffering proxy.
 */

// ── Singleton on globalThis so it survives HMR ─────────────────────────────

interface PeerEntry {
  id: string
  role: 'host' | 'viewer'
  roomId: string
  queue: object[]
  lastSeen: number
}

type RoomMap = Map<string, PeerEntry>

declare global {
  var __cinemaSignalRooms__: Map<string, RoomMap> | undefined
}

if (!globalThis.__cinemaSignalRooms__) {
  globalThis.__cinemaSignalRooms__ = new Map<string, RoomMap>()
}

function getRooms(): Map<string, RoomMap> {
  return globalThis.__cinemaSignalRooms__!
}

function getOrCreateRoom(roomId: string): RoomMap {
  const rooms = getRooms()
  let r = rooms.get(roomId)
  if (!r) {
    r = new Map()
    rooms.set(roomId, r)
  }
  return r
}

/** Evict peers that haven't polled in > 30 seconds */
function evictStalePeers(room: RoomMap, roomId: string) {
  const now = Date.now()
  for (const [id, peer] of room) {
    if (now - peer.lastSeen > 30_000) {
      room.delete(id)
      // Notify remaining peers
      for (const [rid, remaining] of room) {
        if (rid !== id) {
          remaining.queue.push({ type: 'peer-left', from: id })
        }
      }
      console.log(
        `[CinemaSync] Evicted stale peer ${id.slice(0, 8)} from room ${roomId}`,
      )
    }
  }
  if (room.size === 0) getRooms().delete(roomId)
}

/** Register or refresh a peer, returns the entry */
export function registerPeer(
  roomId: string,
  peerId: string,
  role: 'host' | 'viewer',
): PeerEntry {
  const room = getOrCreateRoom(roomId)
  let peer = room.get(peerId)
  if (!peer) {
    peer = { id: peerId, role, roomId, queue: [], lastSeen: Date.now() }
    room.set(peerId, peer)

    // Tell everyone else that this peer joined
    for (const [rid, other] of room) {
      if (rid !== peerId) {
        other.queue.push({ type: 'peer-joined', from: peerId, role })
      }
    }

    // Tell the newcomer who's already here
    const existing = [...room.entries()]
      .filter(([id]) => id !== peerId)
      .map(([, p]) => ({ id: p.id, role: p.role }))

    peer.queue.push({ type: 'room-state', peerId, peers: existing })

    console.log(
      `[CinemaSync] ${role} ${peerId.slice(0, 8)} joined room ${roomId} — ${room.size} peer(s)`,
    )
  } else {
    peer.lastSeen = Date.now()
  }
  return peer
}

/** Drain the queue for a peer (called on each poll) */
export function drainQueue(
  roomId: string,
  peerId: string,
  role: 'host' | 'viewer',
): object[] {
  const room = getOrCreateRoom(roomId)
  evictStalePeers(room, roomId)

  const peer = registerPeer(roomId, peerId, role)
  peer.lastSeen = Date.now()

  const messages = [...peer.queue]
  peer.queue = []
  return messages
}

/** Route a message from sender to all other peers in the room */
export function relayMessage(
  roomId: string,
  senderId: string,
  payload: object,
) {
  const room = getRooms().get(roomId)
  if (!room) return
  for (const [id, peer] of room) {
    if (id !== senderId) {
      peer.queue.push(payload)
    }
  }
}

/** Send a message to a specific peer only */
export function sendToPeer(roomId: string, peerId: string, payload: object) {
  const room = getRooms().get(roomId)
  if (!room) return
  const peer = room.get(peerId)
  if (peer) peer.queue.push(payload)
}

/** Remove a peer and notify others */
export function removePeer(roomId: string, peerId: string) {
  const rooms = getRooms()
  const room = rooms.get(roomId)
  if (!room) return
  room.delete(peerId)
  if (room.size === 0) {
    rooms.delete(roomId)
  } else {
    for (const [, peer] of room) {
      peer.queue.push({ type: 'peer-left', from: peerId })
    }
  }
  console.log(`[CinemaSync] Peer ${peerId.slice(0, 8)} left room ${roomId}`)
}

/** Get all peers in a room except the given one */
export function getPeers(
  roomId: string,
  excludeId: string,
): Array<{ id: string; role: string }> {
  const room = getRooms().get(roomId)
  if (!room) return []
  return [...room.entries()]
    .filter(([id]) => id !== excludeId)
    .map(([, p]) => ({ id: p.id, role: p.role }))
}
