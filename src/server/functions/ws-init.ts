/**
 * CinemaSync – WS/Signal Server Init
 *
 * Signaling has moved to SSE on port 3000 via /_api/signal/:roomId.
 * No standalone WS server is needed anymore.
 * This function is kept for loader compatibility.
 */
import { createServerFn } from '@tanstack/react-start'

export const initWsServerFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    // SSE signaling runs on the main port (3000) — no separate port needed.
    // wsPort is returned for backwards compat but is no longer used to build WS URLs.
    const wsPort = Number(process.env.PORT ?? 3000)
    return { wsPort, isPreview: process.env.IMAGINE_PREVIEW === 'true' }
  },
)
