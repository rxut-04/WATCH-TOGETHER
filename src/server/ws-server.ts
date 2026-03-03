/**
 * CinemaSync – WebSocket Signaling Server
 *
 * Uses a globalThis singleton for room state so it works whether the
 * WebSocket upgrade comes from the main Bun.serve (via server.ts websocket hook)
 * or from the standalone server on WS_PORT.
 *
 * Message envelope: { type, from, ... }
 *
 * Types:
 *   ping        → pong
 *   join        → room-state to sender, peer-joined to others
 *   offer/answer/ice/sync/chat → forwarded to all other peers in room
 *   leave       → peer-left broadcast + cleanup
 */

// ── Room state singleton (shared across all imports) ────────────────────────

interface Peer {
  id: string
  role: 'host' | 'viewer'
  roomId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any
}

// Use globalThis so the map is shared even if this module is re-imported
if (!globalThis.__cinemaRooms__) {
  globalThis.__cinemaRooms__ = new Map<string, Map<string, Peer>>()
}

function getRooms(): Map<string, Map<string, Peer>> {
  return globalThis.__cinemaRooms__ as Map<string, Map<string, Peer>>
}

function getRoom(roomId: string): Map<string, Peer> {
  const rooms = getRooms()
  let r = rooms.get(roomId)
  if (!r) {
    r = new Map()
    rooms.set(roomId, r)
  }
  return r
}

function broadcast(roomId: string, senderId: string, payload: string) {
  const room = getRooms().get(roomId)
  if (!room) return
  for (const [id, peer] of room) {
    if (id !== senderId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(peer.ws as any).send(payload)
      } catch {
        /* ignore closed sockets */
      }
    }
  }
}

function sendTo(ws: { send: (msg: string) => void }, payload: object) {
  try {
    ws.send(JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

function cleanupPeer(peerId: string, roomId: string) {
  const rooms = getRooms()
  const room = rooms.get(roomId)
  if (!room) return
  room.delete(peerId)
  if (room.size === 0) rooms.delete(roomId)
  broadcast(roomId, peerId, JSON.stringify({ type: 'peer-left', from: peerId }))
  console.log(
    `[CinemaSync] Peer ${peerId.slice(0, 8)} removed from room ${roomId}`,
  )
}

// ── Bun WebSocket data type ──────────────────────────────────────────────────

interface WsData {
  peerId: string
  roomId: string
  role: string
}

// ── Shared handler (used by both main server and standalone) ─────────────────

export const cinemaWsHandler = {
  open(ws: { data: WsData; send: (msg: string) => void }) {
    const { peerId, roomId, role } = ws.data
    const room = getRoom(roomId)

    // Register peer
    room.set(peerId, {
      id: peerId,
      role: role as 'host' | 'viewer',
      roomId,
      ws,
    })

    console.log(
      `[CinemaSync] ${role} ${peerId.slice(0, 8)} joined room ${roomId} (room now has ${room.size} peer(s))`,
    )

    // Send room-state to the NEW peer so they know who is already here
    const existingPeers = [...room.entries()]
      .filter(([id]) => id !== peerId)
      .map(([, p]) => ({ id: p.id, role: p.role }))

    sendTo(ws, {
      type: 'room-state',
      peerId,
      peers: existingPeers,
    })

    // Notify ALL other peers that someone joined
    broadcast(
      roomId,
      peerId,
      JSON.stringify({ type: 'peer-joined', from: peerId, role }),
    )
  },

  message(
    ws: { data: WsData; send: (msg: string) => void },
    rawMsg: string | Buffer,
  ) {
    const { peerId, roomId } = ws.data
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(rawMsg as string) as Record<string, unknown>
    } catch {
      return
    }

    switch (msg.type) {
      case 'ping':
        sendTo(ws, { type: 'pong', ts: msg.ts })
        break

      case 'join': {
        // Client re-announces after WS open — re-send room-state to them
        // and re-broadcast peer-joined to others so nobody misses it
        const room = getRoom(roomId)
        const existingPeers = [...room.entries()]
          .filter(([id]) => id !== peerId)
          .map(([, p]) => ({ id: p.id, role: p.role }))

        sendTo(ws, {
          type: 'room-state',
          peerId,
          peers: existingPeers,
        })

        broadcast(
          roomId,
          peerId,
          JSON.stringify({
            type: 'peer-joined',
            from: peerId,
            role: ws.data.role,
          }),
        )
        console.log(
          `[CinemaSync] Join re-announce from ${peerId.slice(0, 8)} in room ${roomId}, ${existingPeers.length} existing peer(s) notified`,
        )
        break
      }

      case 'offer':
      case 'answer':
      case 'ice':
      case 'sync':
      case 'chat':
        broadcast(roomId, peerId, rawMsg as string)
        break

      case 'leave':
        cleanupPeer(peerId, roomId)
        break

      default:
        // Unknown message types are silently ignored
        break
    }
  },

  close(ws: { data: WsData }) {
    const { peerId, roomId } = ws.data
    cleanupPeer(peerId, roomId)
  },
}

export function attachWsHandler() {
  console.log('[CinemaSync] WebSocket signaling handler ready')
}

// ── Standalone WS server (used in dev / when main server cannot upgrade) ─────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let standaloneServer: any = null

export function startWsServer() {
  if (standaloneServer) return standaloneServer

  const WS_PORT = Number(process.env.WS_PORT ?? 3001)

  standaloneServer = Bun.serve<WsData>({
    port: WS_PORT,
    hostname: '::',

    fetch(req, srv) {
      const url = new URL(req.url)
      // Support both /room/:roomId and /_api/ws-room/:roomId
      const match =
        url.pathname.match(/^\/room\/([^/]+)$/) ||
        url.pathname.match(/^\/_api\/ws-room\/([^/]+)$/)

      if (!match) {
        return new Response(
          JSON.stringify({ status: 'CinemaSync Signaling Server' }),
          { headers: { 'content-type': 'application/json' } },
        )
      }

      const roomId = match[1]
      const peerId = url.searchParams.get('peerId') ?? crypto.randomUUID()
      const role = url.searchParams.get('role') ?? 'viewer'

      const upgraded = srv.upgrade(req, { data: { peerId, roomId, role } })
      if (upgraded) return undefined
      return new Response('Upgrade failed', { status: 500 })
    },

    websocket: cinemaWsHandler,
  })

  console.log(
    `[CinemaSync] Standalone signaling WS server on ws://localhost:${WS_PORT}`,
  )
  return standaloneServer
}

// Global declaration for TypeScript
declare global {
  var __cinemaRooms__: Map<string, Map<string, unknown>> | undefined
  var __bunServer__:
    | { upgrade: (req: Request, opts: { data: unknown }) => boolean }
    | undefined
}
