import * as Sentry from '@sentry/cloudflare'
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react'
import handler from '@tanstack/react-start/server-entry'
import { NO_STORE, STATIC_CACHE, cachePolicyFor, hasSessionCookie } from './lib/cache-policy'
import { MAINTENANCE_PATH, isMaintenanceGated, maintenanceEnabled } from './lib/maintenance'
import { NOINDEX_VALUE, shouldNoindex } from './lib/robots-policy'
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
/**
 * The header that makes the edge cache OBSERVABLE, because nothing else does.
 *
 * `cf-cache-status` is NOT emitted for a Cache API hit. That header is added by
 * the CDN cache layer a `fetch()` passes through; a response we return out of
 * `caches.default` is returned by the Worker, and Cloudflare does not annotate
 * it. So a curl against beta cannot otherwise tell "served from the edge" from
 * "rendered again", which is exactly the mistake wt-ksh.8.45 was filed to stop
 * anyone making twice.
 *
 * The value is baked into the STORED copy as HIT and set on the LIVE copy as
 * MISS, so two consecutive GETs report MISS then HIT. That is a stronger signal
 * than cf-cache-status would have been: it can only be produced by our own
 * put/match round-trip.
 */
const DOC_CACHE_HEADER = 'x-doc-cache'

/**
 * The edge cache and the key to use, or null when caching must not happen.
 *
 * RETURNING NULL IS THE SAFE ANSWER AND IT IS RETURNED OFTEN. `caches` does not
 * exist under plain vitest (the test script is `vitest`, not
 * @cloudflare/vitest-pool-workers), and CF_VERSION_METADATA is absent anywhere
 * the Worker is not a deployed version. Both degrade to "render it", which
 * costs latency and nothing else — the same direction cache-policy.ts's default
 * chooses, for the same reason: the failure mode must be a SLOW page and never
 * a SHARED one.
 *
 * WITHOUT A VERSION WE DO NOT CACHE AT ALL, deliberately. The version IS the
 * invalidation mechanism (see wrangler.jsonc): `wrangler deploy` purges
 * nothing, so an unversioned key would leave the previous build's marketing
 * pages at the edge for a day of freshness and a week of stale-while-
 * revalidate with no event able to evict them. A missing version means we
 * cannot promise that, so we decline rather than cache something we cannot
 * later displace.
 *
 * THE KEY IS ON OUR OWN ORIGIN, under a path no route can ever occupy.
 * Cloudflare's docs do not state whether an off-zone hostname is honoured as a
 * cache key, and the answer does not need to be discovered here — keying on
 * `${origin}/__doc-cache/${version}${pathname}` is correct either way, cannot
 * collide with a real document, and keeps every version's entries distinct.
 *
 * IT IS A SYNTHETIC KEY RATHER THAN THE REQUEST ITSELF, because the request
 * carries cookies and an Accept-Encoding and the stored entry must depend on
 * neither. The caller has already established there is no session; the key must
 * not quietly reintroduce one as a dimension.
 *
 * IT FAILS OPEN, like the maintenance gate above it and for the same reason: a
 * missing binding or a Proxy'd env must degrade to serving the site, not to a
 * 500 on every marketing page at once.
 */
type DocumentCache = {
  match(key: Request): Promise<Response | undefined>
  put(key: Request, response: Response): Promise<void>
}

/**
 * `caches.default` IS NOT REACHABLE THROUGH THE GLOBAL TYPES HERE, and the two
 * lines below are the whole reason this alias exists rather than a cast.
 * tsconfig's `lib` includes "DOM", so the DOM's `CacheStorage` and Cloudflare's
 * both declare `caches` and the DOM one wins — and the DOM's has no `default`.
 * Naming only the two methods this file calls keeps that from being papered
 * over with an `any` on the whole object, and makes the surface we depend on
 * obvious if the runtime ever changes underneath it.
 */
function edgeCacheFor(env: unknown, url: URL): { cache: DocumentCache; key: Request } | null {
  try {
    if (typeof caches === 'undefined') return null
    const cache = (caches as unknown as { default?: DocumentCache }).default
    if (!cache) return null
    const version = (env as { CF_VERSION_METADATA?: { id?: string } } | null)?.CF_VERSION_METADATA
      ?.id
    if (!version) return null
    return {
      cache,
      key: new Request(`${url.origin}/__doc-cache/${version}${url.pathname}`),
    }
  } catch (error) {
    console.warn('edge cache unavailable, rendering', error)
    return null
  }
}

const withCachePolicyOnDocuments = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    /**
     * ONE PREDICATE GATES BOTH DIRECTIONS, and that is the whole safety
     * argument. cache-policy.ts decides what the HEADER says; until now nothing
     * was stored, so that was the only question it had to answer. Storing makes
     * two new ones — what may be WRITTEN, and what may be SERVED FROM STORE —
     * and both are dangerous in the way that module's comments already spell
     * out: a document rendered for a session embeds a bearer JWT in its
     * dehydrated router state (verified empirically there, not assumed), so
     * writing one would publish a credential, and reading before the session
     * check would hand it to the next visitor.
     *
     * Computing the policy ONCE, from the request, and consulting the cache
     * only when it comes back STATIC_CACHE means both new questions are already
     * answered by the tested predicate. There is deliberately no second
     * condition here restating "and no session" — a restatement is a thing that
     * can drift from what it restates.
     *
     * GET ONLY: cache.put rejects anything else outright.
     *
     * NO QUERY STRING. The key is the pathname, so serving a document rendered
     * for `/about?x=1` to a later bare `/about` would be cache poisoning by
     * construction. Declining to cache a query-bearing request is the fix and
     * costs nothing real — these are marketing routes reached without one, and
     * the maintenance gate's comment already notes query strings do turn up on
     * these paths.
     */
    const policy = cachePolicyFor(url.pathname, hasSessionCookie(request.headers.get('cookie')))
    const edge =
      policy === STATIC_CACHE && request.method === 'GET' && url.search === ''
        ? edgeCacheFor(env, url)
        : null

    if (edge) {
      try {
        const hit = await edge.cache.match(edge.key)
        if (hit) return hit
      } catch (error) {
        console.warn('edge cache read failed, rendering', error)
      }
    }

    const response = await sentryFetch(request, env, ctx)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return response
    const doc = new Response(response.body, response)
    doc.headers.set('cache-control', response.status === 200 ? policy : NO_STORE)

    /**
     * ONLY A 200 IS STORED, mirroring the header rule above it and resting on
     * the same reasoning the module comment gives: a 404 or a transient 5xx is
     * an HTML document too, and publishing one would hand the edge a day of a
     * wrong page that no deploy can evict. The version in the key bounds that
     * to a single deployment now, which shortens the fuse without removing it.
     *
     * THE STORED COPY IS TAKEN BEFORE THE LIVE ONE IS LABELLED, so the two
     * carry different values of DOC_CACHE_HEADER. server.test.ts asserts both
     * halves rather than trusting clone()'s header semantics.
     *
     * waitUntil, so the put never delays the response, and a rejected put is
     * caught rather than left to surface as an unhandled rejection: failing to
     * populate the cache is a slow next request, not an error worth an event.
     */
    if (edge && response.status === 200) {
      const stored = doc.clone()
      stored.headers.set(DOC_CACHE_HEADER, 'HIT')
      ctx.waitUntil(
        edge.cache.put(edge.key, stored).catch((error: unknown) => {
          console.warn('edge cache write failed', error)
        }),
      )
      doc.headers.set(DOC_CACHE_HEADER, 'MISS')
    }
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

/**
 * X-Robots-Tag ON THE STAGING HOSTNAMES, AND IT IS THE OUTERMOST LAYER.
 *
 * Vercel gave v1 an automatic `noindex` on every preview; Cloudflare gives
 * nothing, so beta served the whole marketing surface on a real hostname with
 * no canonical link to production (wt-ksh.8.54). lib/robots-policy.ts holds the
 * decision and the argument for keying it on the HOSTNAME rather than the
 * ENVIRONMENT var — briefly, beta and production are the SAME DEPLOYMENT, so a
 * var cannot tell them apart on the day the apex is added.
 *
 * OUTERMOST FOR THREE REASONS, each of which is a way an inner placement leaks:
 *   - THE MAINTENANCE REDIRECT. Gated below, it never reaches the document
 *     handler, so a header set there would miss the 307 entirely.
 *   - THE EDGE CACHE. A cache hit returns before the document handler runs.
 *     Setting the header here means a stored response cannot carry the wrong
 *     answer even if it were somehow written under a different hostname.
 *   - EVERY NON-HTML RESPONSE. /sitemap.xml and the /api routes are documents a
 *     crawler can reach and are skipped by the content-type guard below.
 *
 * IT DOES NOT REACH THE STATIC ASSETS, and that is a real limit rather than an
 * oversight: /favicon.ico and /opengraph-image.png are served by the Workers
 * assets layer without entering this handler at all (measured on wt-ksh.8.45,
 * where they were the paths that DID report cf-cache-status). Images are not
 * what wt-ksh.8.54 is about — the exposure is the marketing pages, and those
 * are documents — but an asset on beta remains indexable. Fixing that needs a
 * headers rule on the assets layer, which is not this file.
 *
 * A RESPONSE IS COPIED ONLY WHEN THE HEADER IS ACTUALLY ADDED. On production
 * this wrapper is a hostname lookup and a pass-through, so the common path pays
 * one Set lookup and allocates nothing.
 */
const withRobotsPolicy = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const response = await withMaintenanceGate.fetch(request, env, ctx)
    // NO try/catch HERE, UNLIKE THE MAINTENANCE GATE BELOW, and the difference
    // is real rather than an oversight. That one guards a property read on
    // `env`, which can be a binding that never arrived or a Proxy that throws,
    // and catching lets the request through. There is nothing equivalent to
    // catch here: `new URL(request.url)` is the same call the cache-policy
    // layer already made to serve this request, so a URL this cannot parse has
    // already failed further down and no handling here can rescue it. A
    // try/catch would read as a safety property the code does not have.
    if (!shouldNoindex(new URL(request.url).hostname)) return response
    const tagged = new Response(response.body, response)
    tagged.headers.set('x-robots-tag', NOINDEX_VALUE)
    return tagged
  },
}

export default Sentry.withSentry(
  (env: { SENTRY_DSN?: string }) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: TRACES_SAMPLE_RATE,
  }),
  withRobotsPolicy,
)
