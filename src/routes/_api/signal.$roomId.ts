/**
 * CinemaSync – Polling Signaling Route  /_api/signal/:roomId
 *
 * GET  /_api/signal/:roomId?peerId=...&role=...
 *   Returns all queued messages for this peer as JSON array and clears the queue.
 *   Client polls this every ~800ms.
 *
 * POST /_api/signal/:roomId
 *   Body: { peerId, role, type, ...payload }
 *   Routes the message to all other peers in the room.
 */
import { createFileRoute } from '@tanstack/react-router'
import { drainQueue, relayMessage, removePeer } from '@/server/signaling-store'

export const Route = createFileRoute('/_api/signal/$roomId')({
  component: () => null,

  server: {
    handlers: {
      // ── Poll: drain queued messages for this peer ──────────────────────
      GET: async ({ request, params }) => {
        const url = new URL(request.url)
        const roomId = (params as Record<string, string>).roomId ?? ''
        const peerId = url.searchParams.get('peerId') ?? ''
        const rawRole = url.searchParams.get('role') ?? 'viewer'
        const role = (rawRole === 'host' ? 'host' : 'viewer') as
          | 'host'
          | 'viewer'

        if (!peerId) {
          return new Response(JSON.stringify({ error: 'missing peerId' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        }

        const messages = drainQueue(roomId, peerId, role)

        return new Response(JSON.stringify({ messages }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          },
        })
      },

      // ── Relay: send message from one peer to others ────────────────────
      POST: async ({ request, params }) => {
        const roomId = (params as Record<string, string>).roomId ?? ''

        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return new Response('Invalid JSON', { status: 400 })
        }

        const peerId = (body.peerId as string) ?? ''
        const msgType = (body.type as string) ?? ''

        if (msgType === 'leave') {
          removePeer(roomId, peerId)
        } else {
          relayMessage(roomId, peerId, { ...body, from: peerId })
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  },
})
