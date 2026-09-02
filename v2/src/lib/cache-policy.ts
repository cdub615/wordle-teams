/**
 * Per-route cache policy for SSR document responses.
 *
 * THE RULE IS TWO-DIMENSIONAL: a document may be cached publicly only when the
 * route is static AND the request carries no session. Neither half is
 * sufficient on its own.
 *
 * WHY THE ROUTE HALF EXISTS. v1 (wordle-teams-jcj) emitted
 * `Cache-Control: public, max-age=0, must-revalidate` on its prerendered
 * marketing pages, so 28-41% of requests to /home, /privacy and /terms missed
 * the edge and woke a cold function at ~1.9s. v1 fixed it with
 * `export const revalidate = 86400`. Phase 0 of v2 then shipped wt-ksh.1.13,
 * which set 'no-store' on EVERY document — correct for the app, and exactly
 * v1's bug re-created for the marketing routes.
 *
 * WHY THE SESSION HALF EXISTS. __root.tsx's `beforeLoad` returns
 * `{ isAuthenticated, token }` into router context, and TanStack Start
 * serialises route context into the SSR document for hydration. VERIFIED
 * EMPIRICALLY, not assumed: a signed-in GET /about carries
 * `b:{isAuthenticated:!0,token:"eyJhbGciOiJSUzI1NiIs..."}` in its dehydrated
 * match state, and that string is byte-identical to the request's
 * better-auth.convex_jwt cookie. The same request while anonymous contains no
 * JWT at all. So a signed-in /privacy embeds a bearer credential; caching it
 * publicly would hand one person's token to the next visitor.
 *
 * A signed-in visitor therefore gets `private, no-store` everywhere, including
 * on the static routes — which costs them nothing they were not already paying
 * before this module existed. The anonymous visitor and the crawler, who are
 * every visitor jcj was actually about, get the edge.
 */

/**
 * Routes whose anonymous rendering contains nothing user-specific.
 *
 * Several of these do not exist yet — later tasks in this phase create /,
 * /home, /privacy, /terms, /maintenance and /login-error. Listing them early is
 * safe ONLY BECAUSE src/server.ts consults this policy for a 200 and no other
 * status. Without that gate it is actively dangerous, and was: a listed path
 * with no route 404s, and the 404 was being published with a day of shared
 * freshness and a week of stale-while-revalidate. `wrangler deploy` purges
 * nothing, so the edge would have kept serving that 404 long after the real
 * route shipped, with no event able to evict it. The same hazard outlives the
 * missing routes — a transient 5xx on /home would earn the same day.
 *
 * The default below still makes listing LATE a silent performance regression.
 * Listing early is now merely inert until the route exists.
 *
 * /login IS DELIBERATELY ABSENT. It renders the same for every anonymous
 * visitor, so it would be legal to cache — but it is the top of the funnel and
 * its entire job is to START a session. There is nothing to win by caching the
 * one page a visitor passes through once, and an edge-cached copy of it is one
 * more thing to reason about the day sign-in changes.
 */
const STATIC_DOCUMENTS = new Set([
  '/',
  '/home',
  '/about',
  '/privacy',
  '/terms',
  '/maintenance',
  '/login-error',
])

export const NO_STORE = 'private, no-store'

/**
 * `max-age=0` DEPENDS ON A ZONE SETTING THIS REPOSITORY CANNOT SEE, and that is
 * the only reason it survives to the browser. Cloudflare's Browser Cache TTL
 * defaults to FOUR HOURS on every plan and overrides the origin's max-age
 * whenever the origin's is LOWER — so this string shipped as `max-age=14400`
 * for every response served from the edge, measured on beta 2026-09-02. The
 * zone is now set to "Respect Existing Headers" (Caching -> Configuration), and
 * the value below arrives intact. Verified end to end on /, /home, /about,
 * /privacy and /terms. (wordle-teams-g1cd)
 *
 * IT ONLY STARTED MATTERING WITH THE EDGE CACHE. Before wordle-teams-fqeq these
 * documents were never in Cloudflare's cache, so the setting had nothing to act
 * on. Storing them is what exposed it.
 *
 * WHY max-age=0 IS WORTH DEFENDING: the browser revalidates every time, so the
 * edge holds the only long-lived copy and server.ts's version-keyed cache key
 * has complete control over what anyone sees after a deploy. A browser cache is
 * outside that control — the version key cannot reach it — so four hours of it
 * meant a fix shipped today was invisible to anyone who had loaded the page in
 * the previous four.
 *
 * IF THIS EVER SILENTLY REVERTS, that setting is the first thing to check; the
 * symptom is `max-age=14400` on a second request to a static path. It is
 * zone-wide, so it also governs the assets — which is what made it safe to
 * change only after public/_headers gave every asset an explicit value
 * (wordle-teams-82zq). Note the assets were never affected anyway: the hashed
 * ones sit above 14400, and the rest carry `must-revalidate`, which Cloudflare
 * honours by leaving max-age alone.
 */
export const STATIC_CACHE =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'

/**
 * THE DEFAULT FOR AN UNRECOGNISED PATH IS `NO_STORE`, and that is the most
 * important line in this file. It makes the failure mode of a missing entry a
 * SLOW page and never a SHARED one: an authenticated route added in six months
 * is safe without anyone remembering this module exists, and a new marketing
 * route is simply uncached until someone notices the latency.
 */
export function cachePolicyFor(pathname: string, hasSession: boolean): string {
  if (hasSession) return NO_STORE
  // `/foo/` and `/foo` are the same document; `/` must survive the trim.
  // Defence in depth only: TanStack 307s `/about/` to `/about` before this runs.
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname
  return STATIC_DOCUMENTS.has(normalised) ? STATIC_CACHE : NO_STORE
}

/**
 * The cookie names that mean "this request has a session".
 *
 * ESTABLISHED EMPIRICALLY, not from the docs: signing in through the e2e OTP
 * helper against the running dev server and reading the browser context's
 * cookies yields exactly `better-auth.session_token` and
 * `better-auth.convex_jwt`. Neither convex/auth.ts nor src/lib/auth-client.ts
 * sets `cookiePrefix`, so Better Auth's default prefix of `better-auth` is what
 * this deployment actually uses.
 *
 * BOTH NAMES ARE MATCHED, not just the session token, because getting this
 * wrong is the single most dangerous mistake available here: a matcher that
 * misses returns false for a signed-in user and publishes their token-bearing
 * document to a shared cache. Two independent names, either of which is
 * sufficient, means a rename upstream has to break both before the policy goes
 * quiet.
 *
 * `__Secure-` IS OPTIONAL because Better Auth prefixes secure cookies over
 * https and does not over local http. A rule that is right in production and
 * wrong in dev is worse than no rule, because the environment where you would
 * notice is the one where it works.
 */
const SESSION_COOKIE_NAMES = ['better-auth.session_token', 'better-auth.convex_jwt']

/**
 * Matches a session cookie at a NAME position only — start of the header, or
 * immediately after a separator — so the word appearing inside some other
 * cookie's VALUE cannot flip the policy to no-store, and more importantly
 * cannot be relied on to. Escaped because the names contain `.`, which would
 * otherwise match any character.
 *
 * A COMMA IS A SEPARATOR HERE AS WELL AS `;`. HTTP/2 permits a client to send
 * the cookie as several field lines, and `Headers.get('cookie')` rejoins
 * duplicates with `", "` — so `a=1, better-auth.session_token=x` is a real
 * shape this can be handed. Anchoring on `;` alone MISSES it, and missing is
 * the dangerous direction: a signed-in request read as anonymous publishes a
 * token-bearing document to a shared cache. RFC 9113 requires the rejoin to use
 * `"; "` and Cloudflare does that at the edge, so this is unlikely in practice;
 * it costs one character to stop being unlikely.
 *
 * A comma is legal inside a cookie VALUE, so accepting it as a separator can
 * only ever OVER-match — an anonymous visitor whose cookie value contains
 * `, better-auth.session_token=` loses the edge cache. That is the acceptable
 * direction: the failure is slow, not shared.
 */
const SESSION_COOKIE_RE = new RegExp(
  `(?:^|[;,])\\s*(?:__Secure-)?(?:${SESSION_COOKIE_NAMES.map((n) => n.replace(/\./g, '\\.')).join('|')})=`,
)

export function hasSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false
  return SESSION_COOKIE_RE.test(cookieHeader)
}
