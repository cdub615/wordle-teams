import * as Sentry from '@sentry/cloudflare'
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react'
import handler from '@tanstack/react-start/server-entry'
import { NO_STORE, cachePolicyFor, hasSessionCookie } from './lib/cache-policy'
import { TRACES_SAMPLE_RATE } from './lib/sentry-config'

// @ts-expect-error handler type mismatch between TanStack Start and the Sentry
// SDK's ServerEntry (Start's fetch opts are typed, Sentry's are unknown) —
// required per the Sentry TanStack Start on Cloudflare docs
const sentryHandler = wrapFetchWithSentry(handler)

// The Start server entry's fetch is typed as (request, opts?) but the Workers
// runtime invokes it as (request, env, ctx) — forward all args through.
type WorkerFetch = (
  request: Request,
  env: unknown,
  ctx: ExecutionContext,
) => Response | Promise<Response>
const sentryFetch = sentryHandler.fetch as unknown as WorkerFetch

/**
 * Sets the cache policy on SSR document responses.
 *
 * An SSR document embeds the dehydrated router/query state, and root context
 * carries the auth JWT — so a document rendered FOR A SESSION must never land
 * in any shared cache. That is wt-ksh.1.13, and it is still true; what changed
 * is that it was being applied unconditionally, to anonymous renders of the
 * marketing routes as well. Unconditional no-store on those is v1's
 * wordle-teams-jcj rebuilt on a new platform: 28-41% of requests to the static
 * pages missing the edge and waking a cold function.
 *
 * The rule now has two dimensions — static route AND no session — and both
 * live in lib/cache-policy.ts, where they are unit-tested. This function is
 * only the wiring: compute, and set. Note that the policy needs the REQUEST
 * (its path and its cookies), not the response, which is why it is derived
 * here rather than anywhere the route itself could reach.
 *
 * Static assets (JS/CSS/images) are served by the Workers assets layer and
 * don't pass through this handler, and the content-type guard keeps this from
 * touching anything but HTML documents.
 *
 * ONLY A 200 MAY BE SHARED. A 404 or a 5xx is an HTML document too, and a
 * listed-but-not-yet-built path (cache-policy.ts lists six) answers 404 today.
 * Publishing that with `s-maxage=86400` hands the edge a day of a wrong page —
 * and `wrangler deploy` purges nothing, so shipping the real route evicts
 * nothing either. A transient 5xx on a route that DOES exist is the same bug
 * with a shorter fuse. Everything that is not a 200 gets NO_STORE.
 */
const withCachePolicyOnDocuments = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const response = await sentryFetch(request, env, ctx)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return response
    const policy =
      response.status === 200
        ? cachePolicyFor(
            new URL(request.url).pathname,
            hasSessionCookie(request.headers.get('cookie')),
          )
        : NO_STORE
    const doc = new Response(response.body, response)
    doc.headers.set('cache-control', policy)
    return doc
  },
}

export default Sentry.withSentry(
  (env: { SENTRY_DSN?: string }) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: TRACES_SAMPLE_RATE,
  }),
  withCachePolicyOnDocuments,
)
