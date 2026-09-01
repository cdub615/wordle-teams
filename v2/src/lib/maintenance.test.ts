import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { MAINTENANCE_PATH, isMaintenanceGated, maintenanceEnabled } from './maintenance.ts'

/**
 * The pure half of maintenance mode. The WIRING — that src/server.ts actually
 * asks these two questions, in front of the cache policy, and fails open when
 * it cannot — is in src/server.test.ts, because a green file here would prove
 * nothing about a Worker that never calls either function. v1's maintenance
 * mode was correct code in a file Next did not read.
 */

describe('maintenanceEnabled', () => {
  test("the exact string 'true' is the only way in", () => {
    expect(maintenanceEnabled('true')).toBe(true)
  })

  test('unset is off, which is v1 fail-open semantics for free', () => {
    // The var missing from a new environment, or a binding that did not
    // arrive, must leave the site UP. This is also the state every developer's
    // local wrangler run is in.
    expect(maintenanceEnabled(undefined)).toBe(false)
  })

  test("the string 'false' is off, and so is every other non-'true' value", () => {
    // THE REASON THIS FUNCTION EXISTS. A wrangler var is a string, so
    // `if (env.MAINTENANCE)` is TRUE for the first four of these — the site
    // goes dark the moment somebody types the word "false" into the dashboard
    // field meaning to turn it off. The empty string is the one that is falsy
    // anyway, and it is here because a dashboard field cleared rather than
    // deleted is a real state and must read as off. Each is named rather than
    // looped so a failure says which value let a site down.
    expect(maintenanceEnabled('false')).toBe(false)
    expect(maintenanceEnabled('0')).toBe(false)
    expect(maintenanceEnabled('no')).toBe(false)
    expect(maintenanceEnabled('off')).toBe(false)
    expect(maintenanceEnabled('')).toBe(false)
  })

  test('near-misses of the on-switch fail SAFE, leaving the site up', () => {
    // Deliberately strict: not case-folded, not trimmed. The consequence of
    // 'True' is that the site keeps serving, which is the direction this is
    // allowed to be wrong in. Pinned so that loosening it is a decision
    // somebody makes on purpose and not a tidy-up.
    expect(maintenanceEnabled('True')).toBe(false)
    expect(maintenanceEnabled('TRUE')).toBe(false)
    expect(maintenanceEnabled(' true')).toBe(false)
    expect(maintenanceEnabled('true ')).toBe(false)
  })
})

describe('isMaintenanceGated', () => {
  test('the app routes are gated, bare and as subtrees', () => {
    // v1's matcher is ['/', '/login', '/me', '/branding', '/complete-profile'],
    // each protected path listed alongside its ':path*' form. /branding has no
    // v2 counterpart; /app is where the dashboard lives.
    for (const path of ['/', '/login', '/app', '/me', '/complete-profile'])
      expect(isMaintenanceGated(path), `${path} should be gated`).toBe(true)

    for (const path of ['/app/teams/abc123', '/me/anything', '/complete-profile/step-2'])
      expect(isMaintenanceGated(path), `${path} should be gated`).toBe(true)
  })

  test('/login is gated, which is the decision this task had to make', () => {
    // Called out on its own because it is the only entry that is a judgment
    // rather than a port: v1 matched /login for cookie refresh, not for
    // maintenance. The reason it stays is in the comment on GATED_PATHS —
    // signing in during an outage spends a five-minute passcode to arrive at
    // the maintenance page anyway. If someone reverses that decision, this is
    // the test to delete, and deleting a named test is a decision.
    expect(isMaintenanceGated('/login')).toBe(true)
  })

  test('MAINTENANCE_PATH is NOT gated, or the redirect in server.ts loops forever', () => {
    // The single most load-bearing false in this module. Asserted through the
    // exported constant AND its literal, because the constant is what
    // src/server.ts redirects to and the literal is what a browser follows.
    expect(isMaintenanceGated(MAINTENANCE_PATH)).toBe(false)
    expect(MAINTENANCE_PATH).toBe('/maintenance')
    expect(isMaintenanceGated('/maintenance')).toBe(false)
  })

  test('the static pages keep rendering while the app is down', () => {
    // v1's own argument for the exclusion, quoted in the module: they "are
    // static and render fine while the app is down", and covering them is the
    // WORSE behaviour. /login-error joins them in v2.
    for (const path of ['/home', '/about', '/privacy', '/terms', '/login-error'])
      expect(isMaintenanceGated(path), `${path} should not be gated`).toBe(false)
  })

  test('the API routes are never gated, because nothing there reads a page', () => {
    for (const path of ['/api/funnel', '/api/auth/callback/microsoft', '/api/auth/token'])
      expect(isMaintenanceGated(path), `${path} should not be gated`).toBe(false)
  })

  test('a subtree match needs a segment boundary, not a string prefix', () => {
    // '/apple-touch-icon.png' starts with '/app'. A `startsWith('/app')` would
    // hand the browser an HTML document where it asked for a PNG, and the
    // manifest icons are exactly the paths that look like this.
    for (const path of ['/apple-touch-icon.png', '/appointments', '/me-too', '/logins'])
      expect(isMaintenanceGated(path), `${path} should not be gated`).toBe(false)
  })

  test('a trailing slash does not change the answer, in either direction', () => {
    expect(isMaintenanceGated('/app/')).toBe(true)
    expect(isMaintenanceGated('/login/')).toBe(true)
    expect(isMaintenanceGated('/privacy/')).toBe(false)
    expect(isMaintenanceGated('/maintenance/')).toBe(false)
  })

  test('an unrecognised path is NOT gated, so a new route is visible by default', () => {
    // The opposite default from cachePolicyFor's, and deliberately so. That
    // module's failure mode is a page that is slow; this one's is a page that
    // is DARK, and taking something down by accident is worse than leaving it
    // up. The exhaustive test below is what stops that default from quietly
    // swallowing a route that should have been gated.
    expect(isMaintenanceGated('/some-route-nobody-has-written-yet')).toBe(false)
  })
})

/**
 * EVERY ROUTE IN THE APP, PARTITIONED — so adding one forces a decision.
 *
 * The cases above pin the paths that exist today, which is the half that rots:
 * a route added in six months inherits "not gated" from the default and nobody
 * finds out until an outage, when it is the one page still serving a dashboard
 * against a dead backend. Reading the paths out of the GENERATED tree means a
 * new route file fails this test on the day it lands, and the fix is one line
 * in either this list or GATED_PATHS — whichever the author meant.
 *
 * The generated tree, not the routes directory, because the tree is what the
 * router serves and it is checked in (`git ls-files src/routeTree.gen.ts`).
 */
describe('every route the app has, sorted into gated and not', () => {
  const tree = readFileSync(new URL('../routeTree.gen.ts', import.meta.url), 'utf8')
  const paths = [...new Set([...tree.matchAll(/path: '([^']+)'/g)].map((match) => match[1]))].sort()

  test('the generated tree still parses into the routes we think exist', () => {
    // A guard on the guard: if the codegen changes shape and this regex stops
    // matching, the partition below would pass on two empty lists.
    expect(paths).toEqual([
      '/',
      '/about',
      '/api/auth/$',
      '/api/funnel',
      '/app',
      '/complete-profile',
      '/home',
      '/login',
      '/login-error',
      '/maintenance',
      '/me',
      '/privacy',
      '/sitemap.xml',
      '/terms',
    ])
  })

  test('the split is exactly the five app paths, and nothing else', () => {
    // /maintenance is in the UNGATED list, where it has to be: it is what
    // src/server.ts redirects a gated request to, so gating it is a browser
    // following this Worker in a circle.
    expect(paths.filter(isMaintenanceGated)).toEqual([
      '/',
      '/app',
      '/complete-profile',
      '/login',
      '/me',
    ])
    expect(paths.filter((path) => !isMaintenanceGated(path))).toEqual([
      '/about',
      '/api/auth/$',
      '/api/funnel',
      '/home',
      '/login-error',
      '/maintenance',
      '/privacy',
      // NOT GATED, added by Phase 7 Task 8. It renders from a compile-time
      // constant and touches nothing that can be down, so it is ungated for the
      // same reason the legal pages are. Gating it would also answer an XML URL
      // with a 307 to an HTML page, and fetch() follows a redirect by default —
      // the shape the /api note in maintenance.ts rules out.
      '/sitemap.xml',
      '/terms',
    ])
  })
})
