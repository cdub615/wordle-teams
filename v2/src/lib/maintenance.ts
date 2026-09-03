/**
 * MAINTENANCE MODE: THE FLAG, AND THE PATHS IT COVERS.
 *
 * THE REASON THIS MODULE IS TESTED AT ALL. v1 has the same feature and IT HAD
 * NEVER ONCE EXECUTED IN PRODUCTION. Its middleware sat at the repo root while
 * Next resolves middleware at `src/middleware.ts` for a project with a src
 * directory — no warning, no build error, `"middleware": {}` in the build
 * output — so maintenance mode, the welcome-path redirects and the auth cookie
 * refresh were all dead for the entire life of the project, until bdca5f5.
 * Nothing about "the file exists" implies "the feature runs", which is why the
 * OFF state, the ON state, the exclusions and the failure path all get an
 * assertion here and in src/server.test.ts rather than a comment.
 *
 * THE FLAG IS A PLAIN WORKER VAR, NOT A FEATURE-FLAG SERVICE. v1 read
 * `maintenance_${ENVIRONMENT}` out of Vercel Edge Config; Edge Config is on the
 * re-platform's "killed with no replacement" list. A `vars` entry in
 * wrangler.jsonc replaces it because it keeps the one property Edge Config was
 * actually providing: it can be edited in the Cloudflare dashboard and takes
 * effect WITHOUT A CODE DEPLOY, which is the whole point of a switch you reach
 * for while the site is on fire.
 *
 * The cost of the swap is that a var is a string, not a boolean — hence
 * maintenanceEnabled() below rather than a bare truthiness check.
 */

/**
 * ONLY THE EXACT STRING 'true' TURNS THIS ON.
 *
 * Everything else is off, and two of the "everything else" cases are the ones
 * that matter:
 *
 *   - UNSET IS OFF. That is v1's fail-open semantics for free: a var that was
 *     never added to a new environment, or a binding that did not arrive,
 *     leaves the site up rather than dark.
 *   - THE STRING 'false' IS OFF. This is the classic way to take a site down by
 *     accident — `if (env.MAINTENANCE)` is true for 'false', for '0' and for
 *     'no', because every non-empty string is truthy. Comparing against one
 *     literal makes the dangerous direction unreachable rather than merely
 *     unlikely.
 *
 * Deliberately NOT case-insensitive and NOT trimmed. A var is set by one person
 * in a dashboard field, and the failure of 'True' is that the site stays up,
 * which is the safe way for this to be wrong. Accepting sloppy input here would
 * mean accepting it in the direction that takes the site down.
 */
export function maintenanceEnabled(value: string | undefined): boolean {
  return value === 'true'
}

/**
 * WHERE A GATED REQUEST IS SENT, and — just as importantly — the one path that
 * must stay OUT of the set below. src/server.ts answers a gated request with a
 * 307 here; if this path were itself gated the Worker would redirect to it
 * forever, which is the single worst failure available in this module and the
 * reason it is named once and shared rather than spelled in two files.
 */
export const MAINTENANCE_PATH = '/maintenance'

/**
 * The route subtrees whose descendants are gated as well as their own path.
 *
 * NONE OF THE THREE HAS A CHILD ROUTE TODAY — src/routeTree.gen.ts lists
 * exactly `/app`, `/me` and `/complete-profile`. They are matched as subtrees
 * anyway because v1's matcher did the same thing for the same reason: it lists
 * `'/me'` next to `'/me/:path*'` and `'/complete-profile'` next to its
 * `:path*` form "rather than relying on zero-segment matching, so a protected
 * route can never fall through by accident". A child added later is covered on
 * the day it is added rather than on the day someone remembers this file.
 */
const GATED_SUBTREES = ['/app', '/me', '/complete-profile'] as const

/**
 * AN ALLOWLIST, NOT A FILTER — and the exclusions are the deliberate part.
 *
 * v1's matcher is `['/', '/login', '/me', '/branding', '/complete-profile']`
 * and its comment argues the omission rather than apologising for it:
 * /home, /about, /privacy and /terms are "DELIBERATELY NOT matched ... The
 * trade-off is that maintenance mode no longer covers those four pages — which
 * is the better behaviour, since they are static and render fine while the app
 * is down." That reasoning carries over unchanged, and it is the reason this is
 * a small set of app paths instead of "everything except /maintenance":
 *
 *   - The legal pages are the ones someone may be legally entitled to read at a
 *     moment that has nothing to do with our outage.
 *   - /home and /about are the marketing surface, and /home is one of the three
 *     routes wordle-teams-jcj was measured on (see lib/cache-policy.ts). All
 *     four are in STATIC_DOCUMENTS and go out with a day of shared freshness,
 *     which is only safe because their rendering depends on nothing that can be
 *     down — the same property that makes them worth leaving up.
 *   - /login-error renders a static explanation and a link. Nobody arrives
 *     there except mid sign-in, and by then /login itself has already stopped
 *     them.
 *
 * `/` IS IN BOTH SETS, AND THAT INTERSECTION IS A RUNBOOK STEP (wt-ksh.8.52).
 * It is the ONLY path that is both gated here and listed in
 * lib/cache-policy.ts's STATIC_DOCUMENTS, so while maintenance is OFF the
 * landing page goes out `public, max-age=0, s-maxage=86400,
 * stale-while-revalidate=604800`. src/server.ts reasons about the OUTBOUND
 * direction and gets it right — the gate runs in front of the cache policy, so
 * a maintenance response is never published with shared freshness. It can do
 * nothing about the INBOUND one: a shared cache still holding the pre-outage
 * copy of `/` keeps serving it for up to a day fresh and a week stale, and THE
 * GATE NEVER SEES THOSE REQUESTS, because a cache hit does not invoke the
 * Worker. `wrangler deploy` purges nothing.
 *
 * SO FLIPPING THE VAR IS NOT SUFFICIENT FOR `/`. Turning maintenance on is two
 * steps: set MAINTENANCE to 'true', then purge the Cloudflare cache for the
 * apex. That is procedure, not code — neither set is the wrong one to be in.
 * Dropping `/` from STATIC_DOCUMENTS would cost the highest-traffic anonymous
 * route the edge cache wordle-teams-jcj exists to buy back; ungating `/` would
 * leave the landing page up during an outage, which is a behaviour change
 * nobody asked for.
 *
 * THE PURGE IS NOW REAL, AND THIS PARAGRAPH USED TO SAY THE OPPOSITE. It read:
 * "wt-ksh.8.45 has not yet established that `s-maxage` on a Worker response
 * reaches Cloudflare's edge cache at all... If nothing is cached there, the
 * purge is a no-op and this costs nothing today." Both halves have since been
 * settled and both flipped. wt-ksh.8.45 measured that the header alone reached
 * nothing, and wordle-teams-fqeq then put these documents in the Cache API
 * deliberately — verified on beta, `/` and `/home` return `x-doc-cache: HIT`.
 * So `/` IS cached at the edge, and the purge step is load-bearing rather than
 * free. Turning maintenance on without it leaves the pre-outage landing page
 * being served for up to a day fresh and a week stale, to exactly the visitors
 * the outage notice is for.
 *
 * MAINTENANCE_PATH IS NOT IN THIS SET, AND THAT ABSENCE IS LOAD-BEARING. It is
 * where src/server.ts sends a gated request; adding it here is an infinite
 * redirect. Its absence is what protects that, so it is pinned by a named test
 * rather than left to be obvious.
 *
 * /login IS GATED, WHICH IS A DECISION AND NOT INHERITANCE. v1 matched /login
 * too, but for a different reason — its middleware refreshed the Supabase auth
 * cookie and bounced signed-in visitors off the welcome paths, and /login was
 * in the list for that, with maintenance-mode coverage a side effect. The
 * reason to keep it here is its own: /login exists to start a session, and a
 * session's only destination is /app, which IS gated. Letting someone sign in
 * during an outage spends their time and their passcode to drop them on the
 * maintenance page anyway — and the OTP they burned expires in five minutes
 * (convex/lib/otpExpiry.ts), so it will not be there when the site comes back.
 * Stopping them at the door is both kinder and cheaper.
 *
 * /api/* IS NOT GATED, and that exclusion is structural rather than a judgment
 * call: /api/auth/$ is Better Auth's proxy to the Convex deployment and
 * /api/funnel takes analytics beacons. Neither speaks HTML, and fetch() follows
 * a 307 by default — so gating them would answer a JSON call with the outage
 * page's markup and turn a clean failure into a parse error at the caller. A
 * path is gated here only if a human reads the result.
 */
const GATED_PATHS = new Set<string>(['/', '/login', ...GATED_SUBTREES])

export function isMaintenanceGated(pathname: string): boolean {
  // `/app/` and `/app` are the same route; `/` must survive the trim. Same
  // normalisation as cachePolicyFor, and defence in depth for the same reason:
  // TanStack 307s the trailing-slash form away before either is reached.
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname
  if (GATED_PATHS.has(normalised)) return true
  // The trailing slash is what keeps this from being a prefix match on the
  // STRING: '/apple-touch-icon.png' starts with '/app' and is emphatically not
  // in the /app subtree. (/login needs no such guard — it is an exact entry
  // rather than a subtree, so '/login-error' was never a candidate.)
  return GATED_SUBTREES.some((subtree) => normalised.startsWith(`${subtree}/`))
}
