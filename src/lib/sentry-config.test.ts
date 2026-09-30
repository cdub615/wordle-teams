import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SENTRY_ENVIRONMENT,
  SENTRY_RELEASE,
  TRACES_SAMPLE_RATE,
  sentryEnvironment,
  workerSentryDsn,
} from './sentry-config'
import { SITE_ORIGIN } from './seo'

/**
 * THE ASYMMETRY IS THE POINT, as it is in robots-policy.test.ts, but it points
 * the OTHER WAY. There, an unknown host must be indexable; here, an unknown
 * host must be "production". Both rules protect the same thing — that nothing
 * about production disappears quietly — and the tests that matter most are the
 * ones proving the default rather than the ones filling in the table.
 */
describe('production is never mislabelled', () => {
  test('the canonical origin is production', () => {
    // Read off SITE_ORIGIN rather than retyped, so renaming the site cannot
    // leave this test asserting a hostname the app no longer serves.
    expect(sentryEnvironment(new URL(SITE_ORIGIN).hostname)).toBe('production')
  })

  test('www and the apex are both production', () => {
    expect(sentryEnvironment('wordleteams.com')).toBe('production')
    expect(sentryEnvironment('www.wordleteams.com')).toBe('production')
  })

  test('an unrecognised host is production, because the map is a deny-list', () => {
    // The load-bearing case. If this ever stops being "production", the module
    // has been rewritten as an allow-list and a real incident on a hostname
    // nobody added here is one Sentry environment filter away from invisible.
    for (const host of ['example.com', '', 'wordleteams.com.evil.net', 'app.wordleteams.com']) {
      expect(sentryEnvironment(host), `${host} was not production`).toBe(
        DEFAULT_SENTRY_ENVIRONMENT,
      )
    }
  })

  test('the default is production and not something quieter', () => {
    // Pinned separately from the loop above: if DEFAULT_SENTRY_ENVIRONMENT were
    // changed to "development" the loop would still pass while every unlisted
    // host went silent.
    expect(DEFAULT_SENTRY_ENVIRONMENT).toBe('production')
  })
})

describe('the non-production hostnames are labelled apart', () => {
  test('beta is beta, which is what wordle-teams-9wpd was filed for', () => {
    // A beta document carried `sentry-environment=production` in its baggage
    // meta. This is the browser half of stopping that.
    expect(sentryEnvironment('beta.wordleteams.com')).toBe('beta')
  })

  test('dev is development, listed before the deployment exists', () => {
    // wordle-teams-qjh3 gives dev its own deployment and this its own hostname.
    // Adding the entry on the day is the step that gets forgotten, and the
    // failure of forgetting it is dev traffic labelled production.
    expect(sentryEnvironment('dev.wordleteams.com')).toBe('development')
  })

  test('a workers.dev name is never production', () => {
    // Cloudflare assigns this name; a Worker stays reachable on it unless
    // workers_dev is explicitly turned off, so it is a second public URL for
    // the same deployment.
    expect(sentryEnvironment('wordle-teams-v2.someaccount.workers.dev')).toBe('development')
  })

  test('local development is its own environment, not production', () => {
    // These were "production" too before wordle-teams-9wpd — .env.local carries
    // a real DSN, so an error thrown at a breakpoint reached Sentry beside real
    // user incidents.
    expect(sentryEnvironment('localhost')).toBe('local')
    expect(sentryEnvironment('127.0.0.1')).toBe('local')
  })

  test('case, whitespace and a stray port do not leak a host into production', () => {
    // URL.hostname supplies none of these, so this pins the defence in depth
    // for a caller that passes `location.host` or a raw header instead. The
    // failure of dropping it is silent and lands in production.
    expect(sentryEnvironment('BETA.WordleTeams.com')).toBe('beta')
    expect(sentryEnvironment('localhost:3000')).toBe('local')
    expect(sentryEnvironment('  dev.wordleteams.com  ')).toBe('development')
  })
})

describe('the two SDKs agree on sampling', () => {
  test('one rate, in range', () => {
    // The constant exists so the client and the worker cannot drift apart and
    // leave holes in a waterfall. A rate outside 0..1 disables sampling
    // silently rather than erroring.
    expect(TRACES_SAMPLE_RATE).toBeGreaterThan(0)
    expect(TRACES_SAMPLE_RATE).toBeLessThanOrEqual(1)
  })
})

/**
 * THE RELEASE IS A BUILD-TIME CONTRACT BETWEEN TWO FILES, and this is the half
 * that can be checked from here. `SENTRY_RELEASE` reads a constant that
 * vite.config.ts substitutes with `define`; under vitest that constant is absent
 * by design, so asserting its VALUE here would assert nothing about a real build.
 * What is worth pinning is that vite.config.ts still supplies it — because
 * sentry-config.ts guards the read with `typeof` (it has to, or no suite that
 * imports it can even load), and that guard turns a deleted `define` into a
 * SILENT loss of every release rather than a crash.
 */
describe('the Sentry release is wired at build time', () => {
  const viteConfig = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')

  test('vite.config.ts defines __SENTRY_RELEASE__', () => {
    // The mutant this exists for: someone tidies the `define` away, every gate
    // stays green, and client errors quietly stop carrying a release again.
    expect(
      viteConfig,
      'vite.config.ts no longer defines __SENTRY_RELEASE__, so SENTRY_RELEASE is ' +
        'silently undefined and wordle-teams-b7av has regressed',
    ).toMatch(/define:\s*\{[^}]*__SENTRY_RELEASE__/)
  })

  test('it is derived from a commit SHA, not a hand-written string', () => {
    // A literal would satisfy the assertion above while pinning every deploy to
    // the same release, which is worse than none: Sentry would attribute a new
    // regression to whatever that string names.
    expect(viteConfig).toMatch(/GITHUB_SHA/)
    expect(viteConfig).toMatch(/rev-parse/)
  })

  test('SENTRY_RELEASE is undefined under vitest, and that is the guard working', () => {
    // Not a tautology: if the `typeof` guard were removed, importing this module
    // would throw ReferenceError and this file could not run at all. That it
    // loads AND reports undefined is the evidence.
    expect(SENTRY_RELEASE).toBeUndefined()
  })
})

/**
 * THE MEASUREMENT THAT PUT THIS HERE: 1835 of the Sentry project's 1844 events
 * came from a developer's machine, because wrangler.jsonc declares SENTRY_DSN
 * as a TOP-LEVEL var and `wrangler dev` — and the @cloudflare/vite-plugin dev
 * server behind `pnpm dev` and every Playwright run — inherits it.
 *
 * THE DIRECTION IS THE WHOLE TEST, exactly as it is for sentryEnvironment
 * above. Silencing a local run is recoverable; silencing a deployed worker is
 * an outage nobody sees. So the case that matters is the `false` one, and it is
 * asserted on the real DSN shape rather than on a truthy placeholder.
 */
describe('the worker does not report from local development', () => {
  const DSN = 'https://b709a5bb4e96c621ab3267a5efc1dbfa@o177762.ingest.us.sentry.io/4511848703918080'

  test('a dev build gets no DSN, so nothing is sent', () => {
    expect(workerSentryDsn(DSN, true)).toBeUndefined()
  })

  test('a real build keeps the DSN unchanged', () => {
    // Identity, not merely truthiness: a helper that returned some other
    // non-empty string would still pass a `toBeTruthy`, and Sentry would then
    // post every production event into the void.
    expect(workerSentryDsn(DSN, false)).toBe(DSN)
  })

  test('an unset var stays unset rather than becoming a string', () => {
    expect(workerSentryDsn(undefined, false)).toBeUndefined()
  })

  /**
   * THE HELPER BEING RIGHT IS NOT THE CLAIM — server.ts CALLING it is. The
   * whole regression is one deleted argument away: `dsn: env.SENTRY_DSN` reads
   * as perfectly correct code and puts every local run back in the project,
   * with all three tests above still green. Nothing else in the suite can see
   * that, because vitest sets `import.meta.env.DEV` to true and the deployed
   * branch is therefore unreachable from a unit test of server.ts itself.
   *
   * Source-asserted for the same reason, and by the same precedent, as the
   * __SENTRY_RELEASE__ define above.
   */
  test('server.ts passes the build-time flag rather than the bare var', () => {
    const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8')
    expect(source).toContain('dsn: workerSentryDsn(env.SENTRY_DSN, import.meta.env.DEV)')
  })
})
