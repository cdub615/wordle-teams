import { describe, expect, test } from 'vitest'
import { NO_STORE, STATIC_CACHE, cachePolicyFor, hasSessionCookie } from './cache-policy.ts'

// Every assertion here compares the WHOLE header value with toBe. A
// `toContain('public')` would be satisfied by `public, no-store`, which is the
// mistake this phase has already made three times in other files.

describe('cachePolicyFor', () => {
  test('every route in the static set is cacheable anonymously', () => {
    // Named individually rather than iterating the module's own set, which
    // would assert nothing: a set that lost an entry would lose the case too.
    // The six that do not exist yet are here on purpose — later tasks in this
    // phase create them, and this is what pins them when they land.
    for (const path of ['/', '/home', '/about', '/privacy', '/terms', '/maintenance', '/login-error'])
      expect(cachePolicyFor(path, false)).toBe(STATIC_CACHE)
  })

  test('the static cache header names a shared cache and a long stale window', () => {
    // Pins the value itself as a LITERAL, never as `STATIC_CACHE` compared to
    // itself: a self-reference would assert nothing, and this is the only thing
    // in vitest that kills an `s-maxage` -> `max-age` edit — browser-private,
    // not the edge, and a silent return to jcj's 28-41% miss rate. (The /about
    // case in e2e/routes.spec.ts pins the same literal on a real response, but
    // e2e does not run in the four gates.)
    //
    // `max-age=0` is deliberate and not redundant with `s-maxage`. Without it a
    // shared cache has an explicit lifetime and a private one has none, so the
    // browser falls back to HEURISTIC freshness — and a full reload right after
    // sign-in could paint the signed-out shell from the browser's own cache.
    // Edge behaviour is unchanged: `s-maxage` overrides `max-age` for shared
    // caches.
    expect(STATIC_CACHE).toBe('public, max-age=0, s-maxage=86400, stale-while-revalidate=604800')
    expect(NO_STORE).toBe('private, no-store')
  })

  test('an authenticated route is never cacheable, even anonymously', () => {
    expect(cachePolicyFor('/app', false)).toBe(NO_STORE)
    expect(cachePolicyFor('/me', false)).toBe(NO_STORE)
    expect(cachePolicyFor('/complete-profile', false)).toBe(NO_STORE)
  })

  test('a signed-in request is never cacheable, not even on a static route', () => {
    // The whole point of the second dimension: a signed-in GET /privacy embeds
    // the auth JWT in its dehydrated router state, so a public copy of it is a
    // token handed to the next visitor.
    expect(cachePolicyFor('/about', true)).toBe(NO_STORE)
    expect(cachePolicyFor('/privacy', true)).toBe(NO_STORE)
    expect(cachePolicyFor('/', true)).toBe(NO_STORE)
  })

  test('an unrecognised path defaults to no-store', () => {
    // The most important behaviour in the module. A route added later without
    // anyone touching this file must be slow, never shared.
    expect(cachePolicyFor('/some-route-nobody-has-written-yet', false)).toBe(NO_STORE)
    expect(cachePolicyFor('/app/teams/abc123', false)).toBe(NO_STORE)
  })

  test('/login is deliberately not cached', () => {
    // Static for an anonymous visitor and still absent from the set on
    // purpose — see the comment on STATIC_DOCUMENTS. If someone adds it, this
    // fails and they have to read the reason first.
    expect(cachePolicyFor('/login', false)).toBe(NO_STORE)
  })

  test('a trailing slash is the same document', () => {
    expect(cachePolicyFor('/about/', false)).toBe(STATIC_CACHE)
    expect(cachePolicyFor('/privacy/', false)).toBe(STATIC_CACHE)
  })

  test('the root path survives the trailing-slash trim', () => {
    // A naive `replace(/\/$/, '')` turns '/' into '', which is not in the set,
    // so the landing page — the single most cacheable document on the site —
    // would quietly fall through to no-store.
    expect(cachePolicyFor('/', false)).toBe(STATIC_CACHE)
  })

  test('a path that is only slashes does not become cacheable by accident', () => {
    expect(cachePolicyFor('//', false)).toBe(STATIC_CACHE)
    expect(cachePolicyFor('/about//', false)).toBe(STATIC_CACHE)
  })

  test('matching is case-sensitive and exact, not a prefix', () => {
    // '/aboutus' must not inherit '/about'.
    expect(cachePolicyFor('/aboutus', false)).toBe(NO_STORE)
    expect(cachePolicyFor('/about/team', false)).toBe(NO_STORE)
  })
})

describe('hasSessionCookie', () => {
  test('no cookie header at all is not a session', () => {
    expect(hasSessionCookie(null)).toBe(false)
    expect(hasSessionCookie('')).toBe(false)
  })

  test('unrelated cookies are not a session', () => {
    expect(hasSessionCookie('theme=dark; tz=America%2FChicago')).toBe(false)
  })

  test('recognises the session cookie this deployment actually sets', () => {
    // NOT the documented default taken on faith. Signing in through
    // e2e/sign-in.ts against the running dev server and reading the browser
    // context's cookies produced exactly these two names. If Better Auth ever
    // renames one, this test names what to look for.
    expect(hasSessionCookie('better-auth.session_token=abc123')).toBe(true)
    expect(hasSessionCookie('better-auth.convex_jwt=eyJhbGciOiJSUzI1NiIs.x.y')).toBe(true)
  })

  test('recognises the __Secure- prefixed spelling used over https', () => {
    // Production is https and prefixes; local dev is http and does not. A
    // matcher right on one and wrong on the other is worse than none, because
    // the environment you would notice in is the working one.
    expect(hasSessionCookie('__Secure-better-auth.session_token=abc123')).toBe(true)
    expect(hasSessionCookie('__Secure-better-auth.convex_jwt=abc123')).toBe(true)
  })

  test('finds the session cookie when it is not the first one', () => {
    expect(hasSessionCookie('theme=dark; better-auth.session_token=abc; tz=UTC')).toBe(true)
  })

  test('tolerates the space after the separator being absent', () => {
    expect(hasSessionCookie('theme=dark;better-auth.session_token=abc')).toBe(true)
  })

  test('finds the session cookie after an HTTP/2 comma-joined separator', () => {
    // HTTP/2 permits the cookie to arrive as several field lines, and
    // `Headers.get('cookie')` rejoins duplicates with `", "`. Anchoring on `;`
    // alone MISSES this, and missing is the dangerous direction — a signed-in
    // request read as anonymous publishes a token-bearing document to a shared
    // cache.
    //
    // A comma is legal inside a cookie VALUE, so treating it as a separator can
    // only ever OVER-match: the worst case is an anonymous visitor losing the
    // edge cache. Slow, not shared, is the acceptable direction.
    expect(hasSessionCookie('theme=dark, better-auth.session_token=abc')).toBe(true)
    expect(hasSessionCookie('theme=dark,better-auth.convex_jwt=abc')).toBe(true)
  })

  test('a mention inside another cookie VALUE does not count', () => {
    // The anchoring is the point. Without it any cookie whose value happened to
    // contain the name — a return-to URL, a logged error string — would report
    // a session for an anonymous visitor and silently disable the caching this
    // whole module exists to enable.
    expect(hasSessionCookie('last_error=missing%20better-auth.session_token=')).toBe(false)
    expect(hasSessionCookie('note=see better-auth.convex_jwt=x for details')).toBe(false)
  })

  test('a cookie whose name merely ENDS with the session name does not count', () => {
    // 'not-better-auth.session_token' is a different cookie. A regex anchored
    // only on the name text and not on the separator would accept it.
    expect(hasSessionCookie('not-better-auth.session_token=abc')).toBe(false)
    expect(hasSessionCookie('theme=dark; xbetter-auth.session_token=abc')).toBe(false)
  })

  test('the dot in the cookie name is a literal, not a wildcard', () => {
    // An unescaped `.` in the pattern would match this, so a cookie named
    // 'better-authXsession_token' would be read as a session.
    expect(hasSessionCookie('better-authXsession_token=abc')).toBe(false)
  })

  test('the name must be followed by = , not merely appear', () => {
    expect(hasSessionCookie('better-auth.session_token')).toBe(false)
  })
})

describe('the two dimensions together', () => {
  test('only anonymous AND static is cacheable', () => {
    const policy = (path: string, cookie: string | null) =>
      cachePolicyFor(path, hasSessionCookie(cookie))

    expect(policy('/about', null)).toBe(STATIC_CACHE)
    expect(policy('/about', 'theme=dark')).toBe(STATIC_CACHE)
    expect(policy('/about', 'better-auth.session_token=abc')).toBe(NO_STORE)
    expect(policy('/app', null)).toBe(NO_STORE)
    expect(policy('/app', 'better-auth.session_token=abc')).toBe(NO_STORE)
  })
})
