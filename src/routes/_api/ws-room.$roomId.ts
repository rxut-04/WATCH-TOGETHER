/**
 * CinemaSync – WebSocket Signaling Route
 *
 * Handles WS upgrades for /_api/ws-room/:roomId
 * The main Bun.serve in server.ts includes `websocket: cinemaWsHandler`
 * which is the actual message handler. This route just triggers the upgrade.
 */
import { createFileRoute } from '@tanstack/react-router'
import { cinemaWsHandler } from '@/server/ws-server'

export const Route = createFileRoute('/_api/ws-room/$roomId')({
  component: () => null,
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url)
        const upgrade = request.headers.get('upgrade')

        if (upgrade?.toLowerCase() !== 'websocket') {
          return new Response('Expected WebSocket upgrade', { status: 426 })
        }

        const roomId =
          (params as Record<string, string>).roomId ??
          url.pathname.split('/').pop() ??
          ''
        const peerId = url.searchParams.get('peerId') ?? crypto.randomUUID()
        const role = (url.searchParams.get('role') ?? 'viewer') as
          | 'host'
          | 'viewer'

        // Try globalThis.__bunServer__ first (set by server.ts at startup)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bunReq = request as any
        const srv = bunReq.server ?? globalThis.__bunServer__

        if (srv && typeof srv.upgrade === 'function') {
          const upgraded = srv.upgrade(request, {
            data: { peerId, roomId, role },
          })
          if (upgraded) return undefined as unknown as Response
        }

        return new Response(
          JSON.stringify({
            error:
              'WebSocket upgrade unavailable. Connect to the standalone WS server instead.',
          }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        )
      },
    },
  },
})

// Register the WS handler globally
if (typeof globalThis !== 'undefined') {
  globalThis.__cinemaWsHandler__ = cinemaWsHandler
}

declare global {
  var __cinemaWsHandler__: typeof cinemaWsHandler | undefined
}
