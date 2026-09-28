import { createFileRoute } from '@tanstack/react-router'
import { handler } from '#/lib/auth-server'
import { withErrorCapture } from '#/lib/server-handler'

// Wrapped so auth failures are reported. Server handlers sit outside the
// router's error boundaries, so the root onCatch does not cover them
// (wordle-teams-7qa). This is the route where silence would hurt most: if
// login breaks, nothing else matters.
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: withErrorCapture('/api/auth/$ GET', ({ request }: { request: Request }) =>
        handler(request),
      ),
      POST: withErrorCapture('/api/auth/$ POST', ({ request }: { request: Request }) =>
        handler(request),
      ),
    },
  },
})
