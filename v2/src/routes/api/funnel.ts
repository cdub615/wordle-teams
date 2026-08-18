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

/**
 * Always 204. The `x-funnel` header reports what happened WITHOUT changing the
 * beacon contract — clients ignore it, but it makes the one silent failure mode
 * observable: if LOGSNAG_TOKEN is unset on the Worker, delivery is skipped and
 * nothing is reported anywhere, so a 204 alone cannot tell "delivered" from
 * "quietly dropped". curl -sI the endpoint to check a deployment.
 *   sent    — LogSnag accepted it
 *   skipped — no token configured, or LogSnag rejected it (that case also
 *             reports to Sentry)
 *   dropped — unknown event name or malformed body
 */
const noContent = (state: 'sent' | 'skipped' | 'dropped') =>
  new Response(null, { status: 204, headers: { 'x-funnel': state } })

async function handle(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return noContent('dropped') // malformed: it is a beacon, not an API
  }

  const payload = toLogSnagPayload(body, process.env.ENVIRONMENT ?? 'beta')
  if (!payload) return noContent('dropped')

  const delivered = await sendToLogSnag(payload)
  return noContent(delivered ? 'sent' : 'skipped')
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
