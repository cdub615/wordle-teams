import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { convexMismatch, varsForEnvironment, viteAssignments } from './build-env.mjs'

// The per-environment build values, and the guard that stops a bundle being
// built against the wrong Convex deployment (wordle-teams-qjh3.5).
//
// Driven by literal config objects rather than by wrangler.jsonc, for the reason
// the rest of scripts/lib has tests: the failures worth pinning are the ones the
// real file cannot currently exhibit. src/wrangler-environments.test.ts is what
// asserts against the real file.

const CONFIG = {
  vars: {
    SENTRY_DSN: 'https://public@sentry.example/1',
    ENVIRONMENT: 'beta',
    VITE_CONVEX_URL: 'https://prod-one.convex.cloud',
    VITE_CONVEX_SITE_URL: 'https://prod-one.convex.site',
  },
  env: {
    dev: {
      vars: {
        SENTRY_DSN: 'https://public@sentry.example/1',
        ENVIRONMENT: 'development',
        VITE_CONVEX_URL: 'https://dev-two.convex.cloud',
        VITE_CONVEX_SITE_URL: 'https://dev-two.convex.site',
      },
    },
    broken: {},
  },
}

describe('varsForEnvironment', () => {
  test('no environment name means the top level, which is production', () => {
    expect(varsForEnvironment(CONFIG, undefined).ENVIRONMENT).toBe('beta')
  })

  test('a named environment returns its OWN vars, never the top level merged in', () => {
    // The notInheritable rule, honoured here rather than papered over. If this
    // ever fell back to the top level, print-build-env.mjs would emit production's
    // Convex URL for an environment that forgot to declare one -- which is the
    // exact failure the whole issue exists to make impossible.
    expect(varsForEnvironment(CONFIG, 'dev').VITE_CONVEX_URL).toBe('https://dev-two.convex.cloud')
  })

  test('an unknown environment throws and names the ones that exist', () => {
    // A typo in a workflow file would otherwise export nothing and build a bundle
    // carrying .env.production's production URLs under a dev deploy key.
    expect(() => varsForEnvironment(CONFIG, 'devv')).toThrow(/devv/)
    expect(() => varsForEnvironment(CONFIG, 'devv')).toThrow(/dev/)
  })

  test('an environment that declares no vars throws rather than returning nothing', () => {
    // Empty is the notInheritable DEFAULT, so silence here is precisely the bug.
    expect(() => varsForEnvironment(CONFIG, 'broken')).toThrow(/broken/)
  })
})

describe('viteAssignments', () => {
  test('emits only the VITE_ prefixed vars, since the rest are worker runtime vars', () => {
    const lines = viteAssignments(CONFIG.vars)
    expect(lines.join('\n')).not.toMatch(/SENTRY_DSN|ENVIRONMENT/)
    expect(lines).toHaveLength(2)
  })

  test('emits shell assignments in a stable order', () => {
    expect(viteAssignments(CONFIG.vars)).toEqual([
      "VITE_CONVEX_SITE_URL='https://prod-one.convex.site'",
      "VITE_CONVEX_URL='https://prod-one.convex.cloud'",
    ])
  })

  test('quotes defensively, so a value can never run as a command', () => {
    // These lines are eval'd by the deploy step. Nothing in wrangler.jsonc looks
    // like this today and nothing should, which is exactly why the escaping must
    // be here rather than trusted to the current contents of that file.
    const lines = viteAssignments({ VITE_X: "it's; rm -rf /" })
    expect(lines).toEqual(["VITE_X='it'\\''s; rm -rf /'"])
  })
})

describe('convexMismatch', () => {
  const declared = CONFIG.env.dev.vars

  test('agreeing values are not a mismatch', () => {
    expect(
      convexMismatch(declared, {
        VITE_CONVEX_URL: 'https://dev-two.convex.cloud',
        VITE_CONVEX_SITE_URL: 'https://dev-two.convex.site',
      }),
    ).toBeNull()
  })

  test('catches a bundle being built against the WRONG deployment', () => {
    // The case this whole guard exists for: CLOUDFLARE_ENV=dev selected, but the
    // Convex deploy key in the environment was production's, so convex deploy
    // injected production's URL. Without this the build succeeds and the app
    // half-works -- see the header on src/lib/convex-url.ts.
    const message = convexMismatch(declared, {
      VITE_CONVEX_URL: 'https://prod-one.convex.cloud',
      VITE_CONVEX_SITE_URL: 'https://dev-two.convex.site',
    })
    expect(message).toMatch(/VITE_CONVEX_URL/)
    // BOTH values in the message, because the whole difficulty of this failure is
    // that neither side is obviously wrong on its own.
    expect(message).toMatch(/prod-one/)
    expect(message).toMatch(/dev-two/)
  })

  test('catches the site half drifting on its own', () => {
    expect(
      convexMismatch(declared, {
        VITE_CONVEX_URL: 'https://dev-two.convex.cloud',
        VITE_CONVEX_SITE_URL: 'https://prod-one.convex.site',
      }),
    ).toMatch(/VITE_CONVEX_SITE_URL/)
  })

  test('a local backend is not a mismatch, so a developer can still build locally', () => {
    // `vite build` against a local anonymous backend is a legitimate thing to do
    // and has nothing to do with deploying. The failure worth catching is naming
    // the wrong CLOUD deployment; loopback cannot be that.
    for (const host of ['http://127.0.0.1:3210', 'http://localhost:3210']) {
      expect(
        convexMismatch(declared, { VITE_CONVEX_URL: host, VITE_CONVEX_SITE_URL: host }),
      ).toBeNull()
    }
  })

  test('an absent value is not a mismatch', () => {
    // Nothing has been resolved yet, so there is nothing to disagree with.
    expect(convexMismatch(declared, {})).toBeNull()
  })
})

/**
 * THE GUARD IS ONLY WORTH ANYTHING IF IT IS WIRED IN, and nothing above can see
 * that. Every assertion in this file would still pass with the plugin deleted
 * from vite.config.ts's `plugins` array — the functions would be correct and
 * uncalled. That is the shape of a suite that passes for the wrong reason, so
 * this asserts against vite.config.ts's SOURCE, the way
 * src/lib/sentry-config.test.ts does for the `define` that supplies
 * __SENTRY_RELEASE__.
 *
 * SOURCE RATHER THAN BEHAVIOUR because the behaviour needs a real `vite build`:
 * the hook runs inside vite's config resolution, and driving that from a unit
 * test would mean building the whole app to assert one throw. The negative case
 * was verified by hand instead — CLOUDFLARE_ENV=dev with production's
 * VITE_CONVEX_URL injected exits 1 and names both deployments.
 */
describe('the deployment guard is wired into the build', () => {
  const source = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')

  test('vite.config.ts imports the guard helpers from this module', () => {
    expect(source).toMatch(/from '\.\/scripts\/lib\/build-env\.mjs'/)
    expect(source).toMatch(/convexMismatch/)
    expect(source).toMatch(/varsForEnvironment/)
  })

  test('the guard is listed in the plugins array, not merely defined', () => {
    // Defined-but-unused is the exact regression this catches: the function can
    // sit in the file, fully correct, and never run.
    const plugins = source.slice(source.indexOf('plugins: ['))
    expect(plugins).toMatch(/convexDeploymentGuard\(\)/)
  })

  test('it is gated on the build command, so `vite dev` is never blocked', () => {
    expect(source).toMatch(/command !== 'build'/)
  })

  test('it reads the resolved env with loadEnv rather than trusting process.env', () => {
    // process.env alone would miss a .env file overriding the exported value,
    // which is half the ways this goes wrong.
    expect(source).toMatch(/loadEnv\(/)
  })
})
