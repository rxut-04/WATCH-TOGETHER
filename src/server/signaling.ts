/**
 * CinemaSync – In-memory WebSocket signaling state
 * Pure data; the actual WebSocket handling lives in the vite plugin / server.
 */

export interface SignalingPeer {
  id: string
  role: 'host' | 'viewer'
  roomId: string
  send: (data: string) => void
}

export interface SignalingRoom {
  id: string
  peers: Map<string, SignalingPeer>
  createdAt: number
}

// Singleton map shared across the process
const rooms = new Map<string, SignalingRoom>()

export function getOrCreateRoom(roomId: string): SignalingRoom {
  let room = rooms.get(roomId)
  if (!room) {
    room = { id: roomId, peers: new Map(), createdAt: Date.now() }
    rooms.set(roomId, room)
  }
  return room
}

export function removeRoom(roomId: string) {
  rooms.delete(roomId)
}

export function getRooms() {
  return rooms
}
