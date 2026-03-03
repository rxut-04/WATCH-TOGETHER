import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CinemaRoom } from '@/components/cinema/CinemaRoom'
import { initWsServerFn } from '@/server/functions/ws-init'

const roomSearchSchema = z.object({
  role: z.enum(['host', 'viewer']).default('viewer'),
})

export const Route = createFileRoute('/_public/room/$roomId')({
  validateSearch: roomSearchSchema,
  loader: async () => {
    const data = await initWsServerFn()
    return data
  },
  component: RoomPage,
})

/**
 * Build the WebSocket URL for the CinemaSync signaling server.
 *
 * The Imagine preview proxy embeds the port as a PREFIX in the subdomain:
 *   https://3000-xxxx.imagine-proxy.work  →  port 3000
 *   wss://3001-xxxx.imagine-proxy.work    →  port 3001
 *
 * So we must REPLACE the port prefix in the subdomain, not append :wsPort.
 */
function buildWsUrl(roomId: string, wsPort: number): string {
  if (typeof window === 'undefined') return ''

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const hostname = window.location.hostname

  // ── Localhost / direct IP: use port suffix ──────────────────────────────
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${proto}://${hostname}:${wsPort}/room/${roomId}`
  }

  // ── Imagine preview proxy: port is the SUBDOMAIN prefix ─────────────────
  // Pattern: {currentPort}-{uniqueId}.imagine-proxy.work
  // We need to swap the port prefix to wsPort.
  const imagineProxyMatch = hostname.match(/^(\d+)-(.+\.imagine-proxy\.work)$/)
  if (imagineProxyMatch) {
    const restOfHost = imagineProxyMatch[2]
    return `${proto}://${wsPort}-${restOfHost}/room/${roomId}`
  }

  // ── Generic: same hostname, append port ─────────────────────────────────
  const portStr = wsPort !== 80 && wsPort !== 443 ? `:${wsPort}` : ''
  return `${proto}://${hostname}${portStr}/room/${roomId}`
}

function RoomPage() {
  const { roomId } = Route.useParams()
  const { role } = Route.useSearch()
  const { wsPort } = Route.useLoaderData()

  const inviteLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/room/${roomId}?role=viewer`
      : `/room/${roomId}?role=viewer`

  const wsUrl = buildWsUrl(roomId, wsPort)

  return (
    <CinemaRoom
      roomId={roomId}
      role={role}
      inviteLink={inviteLink}
      wsUrl={wsUrl}
    />
  )
}
