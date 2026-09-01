import * as Sentry from '@sentry/cloudflare'
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react'
import handler from '@tanstack/react-start/server-entry'
import { NO_STORE, cachePolicyFor, hasSessionCookie } from './lib/cache-policy'
import { MAINTENANCE_PATH, isMaintenanceGated, maintenanceEnabled } from './lib/maintenance'
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

/**
 * MAINTENANCE MODE, IN FRONT OF THE CACHE POLICY.
 *
 * THE ORDER IS THE POINT. `/`, `/home` and the other static paths are in
 * STATIC_DOCUMENTS, so a maintenance response produced downstream of the policy
 * would be published with `s-maxage=86400` — a day of a shared "Coming Soon" on
 * the marketing landing, outliving an outage that lasted twenty minutes, and
 * `wrangler deploy` purges nothing. Gating first means the response never
 * reaches cachePolicyFor at all and carries NO_STORE unconditionally. The
 * redirect needs that explicitly: it has no content-type, so the policy below
 * would have skipped it entirely and let a browser cache it for the day.
 *
 * IT IS A REDIRECT, AND v1 REWROTE. THAT IS A MEASURED CHANGE, NOT A
 * PREFERENCE. v1's middleware calls `NextResponse.rewrite`, which keeps the
 * visitor's URL and swaps only what is rendered, and that shape was built here
 * first because keeping the URL is genuinely nicer. IT DOES NOT SURVIVE
 * HYDRATION ON THIS PLATFORM. Measured against `wrangler dev` with the flag on,
 * GET /app served the maintenance document and then, about a second later:
 *
 *     url  : http://localhost:8788/login
 *     h1   : Sign in
 *     error: Minified React error #418 (hydration mismatch)
 *
 * The document is SSR'd for /maintenance while `window.location` says /app, so
 * the client router hydrates, disagrees, re-matches /app, runs its anonymous
 * bounce and lands on /login — with the app fully alive underneath. Maintenance
 * mode would have been visible for one frame and then gone, which is worse than
 * not having it: it would have looked like it worked. A 307 to /maintenance
 * makes the URL and the SSR'd route agree, so the router has nothing to
 * disagree with, and it is the shape that was verified end to end.
 *
 * 307, NOT 301 OR 302: a permanent redirect is exactly the thing a browser
 * remembers after the outage, and this response is `private, no-store` for the
 * same reason. The query string is deliberately dropped — the path it belonged
 * to is not where the visitor is any more, and `?checkout=success` on the
 * outage page is a promise about a page that is not being rendered.
 *
 * IT FAILS OPEN, and the try/catch is not decoration. v1's comment is the one
 * to keep: "A transient Edge Config or Supabase outage must degrade to 'let the
 * request through', never to a 500. This middleware has never run in production
 * before, so it gets no benefit of the doubt." v2's read is a property lookup
 * on `env` rather than a network call, so the surface that can throw is
 * smaller — but "smaller" is exactly the reasoning that left v1's version
 * unexercised for the life of the project. A missing binding, a Proxy'd env, a
 * URL this runtime will not parse: any of them takes the site down for everyone
 * if this throws, on the one day nobody wants a second incident.
 * src/server.test.ts exercises the catch with an env that throws on read.
 */
const withMaintenanceGate = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    let gated = false
    try {
      gated =
        maintenanceEnabled((env as { MAINTENANCE?: string }).MAINTENANCE) &&
        isMaintenanceGated(new URL(request.url).pathname)
    } catch (error) {
      console.warn('maintenance gate unreadable, continuing', error)
    }
    if (!gated) return withCachePolicyOnDocuments.fetch(request, env, ctx)

    return new Response(null, {
      status: 307,
      headers: { location: MAINTENANCE_PATH, 'cache-control': NO_STORE },
    })
  },
}

export default Sentry.withSentry(
  (env: { SENTRY_DSN?: string }) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: TRACES_SAMPLE_RATE,
  }),
  withMaintenanceGate,
)
