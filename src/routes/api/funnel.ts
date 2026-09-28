import { createFileRoute } from '@tanstack/react-router'
import {
  MAX_FUNNEL_BODY_BYTES,
  declaresOversizedBody,
  toLogSnagPayload,
} from '#/lib/funnel-payload'
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

/**
 * The body, or null if it is absent or over the cap (wordle-teams-umeq).
 *
 * READS AT MOST THE CAP AND THEN STOPS, which is the half that actually holds.
 * `request.json()` had no bound at all: a 60MB body cost 1321ms of Worker CPU,
 * of which JSON.parse was 18ms — the cost is in RECEIVING the bytes, and this
 * endpoint is public, unauthenticated, rate-limited nowhere, and exempt from the
 * maintenance gate, so nothing else stands in front of it.
 *
 * THE Content-Length CHECK IS A FAST PATH, NOT THE GUARANTEE. It rejects the
 * measured attack without reading anything, but the header comes from the
 * caller and a chunked request omits it — so the loop below is what a
 * determined caller actually meets. It cancels the stream rather than draining
 * it, so an oversized body costs one chunk.
 *
 * NEVER THROWS. Everything here answers null and the caller answers 204, per
 * this route's contract: wordle-teams-4ov is the v1 bug where a vendor call on
 * the sign-in path was awaited without a catch and an outage blocked sign-in.
 */
async function readBoundedBody(request: Request): Promise<string | null> {
  if (declaresOversizedBody(request.headers.get('content-length'))) return null
  if (!request.body) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_FUNNEL_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null // a truncated or aborted upload is not worth a stack trace
  }

  const joined = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

async function handle(request: Request): Promise<Response> {
  const text = await readBoundedBody(request)
  if (text === null) return noContent('dropped') // absent, oversized or unreadable

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return noContent('dropped') // malformed: it is a beacon, not an API
  }

  const payload = toLogSnagPayload(body, process.env.ENVIRONMENT ?? 'beta')
  if (!payload) return noContent('dropped')

  const delivered = await sendToLogSnag(payload)
  return noContent(delivered ? 'sent' : 'skipped')
}

/**
 * EVERY NON-POST METHOD, ANSWERED EXPLICITLY — wordle-teams-ao7j.
 *
 * WITHOUT THIS, GET /api/funnel WAS A SOFT 404. A method with no handler never
 * reaches the route at all; it falls through to the SPA catch-all, which renders
 * the app shell at 200 with the marketing landing page's own <title> and no
 * noindex. Measured on beta 2026-09-04: 200, text/html, 9578 bytes. An unknown
 * path like /definitely-not-a-route-xyz correctly 404s, so this one URL was the
 * exception.
 *
 * WHY THAT IS A DEFECT RATHER THAN COSMETIC. Search engines treat a soft 404 as a
 * real indexable page, so it was a duplicate of the landing page under a URL
 * nobody would want ranked.
 *
 * ROBOTS.TXT WAS NOT ENOUGH, WHICH IS THE PART WORTH REMEMBERING. `Disallow: /api`
 * stops a COMPLIANT crawler fetching it, but a Disallow does not prevent indexing
 * a URL discovered by a link — and a page that is never fetched can never be seen
 * to carry a noindex. Exclusion by robots is not the same as being unindexable.
 *
 * 405 RATHER THAN 404, because the route genuinely exists and it is the method
 * that is wrong; `Allow: POST` says so precisely, and it is as unambiguous to a
 * crawler as a 404 while remaining honest to a client. HEAD is included because
 * it would otherwise fall through exactly as GET did, and OPTIONS because a
 * fall-through there would answer HTML to a preflight.
 *
 * IT ALSO REPAIRS A WRITTEN JUSTIFICATION. public/robots.txt argues /api is
 * excluded because "/api/auth/$ is Better Auth's proxy to Convex and /api/funnel
 * takes analytics beacons. Neither speaks HTML." On a GET, this one did.
 *
 * NOTHING IN CI COULD HAVE SEEN IT: crawler-metadata.test.ts walks
 * routeTree.gen.ts and asserts every route is in the sitemap, disallowed, or a
 * named exclusion — /api/funnel is a named exclusion — and it asserts nothing
 * about METHODS. Hence funnel-methods.test.ts, which asserts the status directly.
 */
const methodNotAllowed = () =>
  new Response(null, { status: 405, headers: { allow: 'POST' } })

export const Route = createFileRoute('/api/funnel')({
  server: {
    handlers: {
      POST: withErrorCapture('/api/funnel POST', ({ request }: { request: Request }) =>
        handle(request),
      ),
      GET: methodNotAllowed,
      HEAD: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      OPTIONS: methodNotAllowed,
    },
  },
})
