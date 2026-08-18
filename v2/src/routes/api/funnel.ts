import { createFileRoute } from '@tanstack/react-router'
import { toLogSnagPayload } from '#/lib/funnel-payload'
import { sendToLogSnag } from '#/lib/logsnag'
import { withErrorCapture } from '#/lib/server-handler'

/**
 * Receives login funnel events from the browser and forwards them to LogSnag
 * (wt-ksh.12.11).
 *
 * This route exists for one reason: the LogSnag token is a secret and cannot
 * be shipped to the client. The browser posts here; the Worker holds the token.
 *
 * It ALWAYS answers 204, even when delivery fails or LogSnag is unconfigured.
 * The caller is a fire-and-forget beacon on the sign-in path — wordle-teams-4ov
 * is the bug where v1 awaited logsnag.track() with no try/catch and a vendor
 * outage blocked sign-in. Nothing here may ever surface to a user or fail the
 * request; failures go to Sentry instead.
 */

const noContent = () => new Response(null, { status: 204 })

async function handle(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return noContent() // malformed: drop it silently, it is a beacon
  }

  const payload = toLogSnagPayload(body, process.env.ENVIRONMENT ?? 'beta')
  if (!payload) return noContent() // unknown event or junk: dropped

  await sendToLogSnag(payload)
  return noContent()
}

export const Route = createFileRoute('/api/funnel')({
  server: {
    handlers: {
      POST: withErrorCapture('/api/funnel POST', ({ request }: { request: Request }) =>
        handle(request),
      ),
    },
  },
})
