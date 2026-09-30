import { fileURLToPath } from 'node:url'
import { experimental_readRawConfig } from 'wrangler'
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SENTRY_ENVIRONMENT,
  HOST_ENVIRONMENTS,
  sentryEnvironment,
} from './lib/sentry-config.ts'
import { shouldNoindex } from './lib/robots-policy.ts'

/**
 * THE TWO WRANGLER DEFAULTS THAT POINT IN OPPOSITE DIRECTIONS (wordle-teams-qjh3.4).
 *
 * A named environment in wrangler.jsonc does NOT inherit the top-level config
 * uniformly, and the two fields this repository depends on most default the two
 * different ways. Both verified in the bundled wrangler on 2026-09-28, by reading
 * it rather than the documentation:
 *
 *   - `vars` is notInheritable (index.mjs:31914), defaulting to {}. An omitted key
 *     is ABSENT, not inherited. A dev Worker missing ENVIRONMENT would report its
 *     errors as PRODUCTION, because src/server.ts falls back to
 *     DEFAULT_SENTRY_ENVIRONMENT on purpose — a missing var must never hide a real
 *     incident — and /api/funnel falls back to "beta". So an environment has to
 *     repeat EVERY key, not only the ones whose values differ.
 *
 *   - `routes` IS inheritable (index.mjs:31790). An environment that declares none
 *     silently adopts the top-level's, so a dev Worker would try to claim the
 *     production hostname.
 *
 * Neither mistake is visible in review: one is a key that is simply not there, the
 * other is a key that is not there and works anyway. Hence a test.
 *
 * IT READS THE RAW CONFIG, WHICH IS THE WHOLE TRICK. wrangler's own
 * `experimental_readRawConfig` returns the file as WRITTEN, before inheritance is
 * applied, so "did this environment declare routes" and "would it have inherited
 * routes" are distinguishable here. A resolved config cannot tell them apart —
 * dist/server/wrangler.json shows the merged result and would look correct in both
 * cases. Using wrangler's parser also avoids hand-rolling a JSONC reader for a file
 * whose comments are most of its value.
 */
const CONFIG_PATH = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
const { rawConfig } = experimental_readRawConfig({ config: CONFIG_PATH })

type EnvBlock = {
  vars?: Record<string, string>
  routes?: { pattern?: string; custom_domain?: boolean; zone_name?: string }[]
}

/**
 * The top-level counts as an environment and is checked identically. It is the one
 * that serves production, so exempting it would leave the consequential half
 * untested — and it is also the SOURCE every other environment's key set is
 * compared against, so a key deleted there has to fail somewhere.
 */
const ENVIRONMENTS: [string, EnvBlock][] = [
  ['(top level)', rawConfig as EnvBlock],
  ...Object.entries((rawConfig.env ?? {}) as Record<string, EnvBlock>),
]

/**
 * The HOSTNAME each route entry answers on, with any path pattern removed.
 *
 * A `custom_domain` entry's pattern is a bare hostname; a route's is
 * `host/path`, e.g. `wordleteams.com/*`. Returning the pattern verbatim — which
 * this did until 2026-09-30 — meant a route never matched HOST_ENVIRONMENTS and
 * quietly took DEFAULT_SENTRY_ENVIRONMENT instead, which is "production". So the
 * moment the apex became a route, the agreement check below stopped checking and
 * PASSED, which is how it was found.
 */
function hostsOf(env: EnvBlock): string[] {
  return (env.routes ?? []).map((r) => (r.pattern ?? '').split('/')[0] ?? '')
}

/** `successful-canary-135` out of either of that deployment's two URLs. */
function convexSlug(url: string): string {
  const { hostname } = new URL(url)
  const match = /^([a-z0-9-]+)\.convex\.(cloud|site)$/.exec(hostname)
  expect(match, `${url} is not a Convex deployment URL`).not.toBeNull()
  return match![1]!
}

test('the dev environment is declared at all', () => {
  // The rest of this file iterates over whatever environments exist, so without
  // this every assertion below would pass vacuously on a file that lost env.dev.
  expect(Object.keys(rawConfig.env ?? {})).toContain('dev')
})

describe.each(ENVIRONMENTS)('environment %s', (name, env) => {
  test('declares its own vars block rather than inheriting one', () => {
    expect(env.vars, `${name} declares no vars, so every key would be ABSENT`).toBeDefined()
  })

  test('declares the same vars keys as every other environment', () => {
    // THE KEY SET, NOT THE VALUES. Values are supposed to differ; a key that
    // exists in one environment and not another is the notInheritable trap, and
    // it reads as deliberate in a diff because the line is simply not there.
    const everyKey = new Set(ENVIRONMENTS.flatMap(([, e]) => Object.keys(e.vars ?? {})))
    expect(new Set(Object.keys(env.vars ?? {}))).toEqual(everyKey)
  })

  test('sets ENVIRONMENT to a non-empty value', () => {
    // Unset is not neutral: the worker's Sentry defaults to "production" and the
    // funnel to "beta", so an environment without this reports as something it
    // is not.
    expect(env.vars?.ENVIRONMENT, `${name} has no ENVIRONMENT`).toBeTruthy()
  })

  test('declares its own routes rather than inheriting the production hostname', () => {
    expect(env.routes, `${name} declares no routes and would INHERIT them`).toBeDefined()
    expect(hostsOf(env).length, `${name} declares an empty routes array`).toBeGreaterThan(0)
    for (const host of hostsOf(env)) expect(host).not.toBe('')
  })

  test('its hostnames agree with the Sentry environment the browser will report', () => {
    // The worker tags events from env.ENVIRONMENT (server.ts) while the BROWSER
    // keys on the hostname (sentry-config.ts), because one bundle is served on
    // every name its deployment answers to. The two mechanisms are independent
    // and nothing else makes them agree — so a new hostname added here and not
    // there splits one request's traces across two environments.
    for (const host of hostsOf(env)) {
      // EXPLICITLY MAPPED, NOT MERELY AGREEING. sentryEnvironment falls back to
      // DEFAULT_SENTRY_ENVIRONMENT ("production") for anything it does not know,
      // so a hostname missing from HOST_ENVIRONMENTS agrees with a production
      // Worker BY ACCIDENT and this assertion becomes decorative. Demanding the
      // entry is what makes a typo'd or newly-added hostname fail here.
      expect(
        HOST_ENVIRONMENTS.has(host),
        `${host} has no entry in sentry-config.ts's HOST_ENVIRONMENTS, so the browser would tag it "${DEFAULT_SENTRY_ENVIRONMENT}" by default rather than deliberately`,
      ).toBe(true)
      expect(sentryEnvironment(host), `${host} disagrees with ENVIRONMENT`).toBe(
        env.vars?.ENVIRONMENT,
      )
    }
  })

  test('every non-production hostname is noindexed', () => {
    // robots-policy is a DENY-list on purpose, so a new staging hostname is
    // crawlable by default. This is what stops one shipping unnoticed.
    if (env.vars?.ENVIRONMENT === 'production') return
    for (const host of hostsOf(env)) {
      expect(shouldNoindex(host), `${host} is not noindexed`).toBe(true)
    }
  })

  test('its two Convex URLs name the same deployment', () => {
    // THE HAZARD src/lib/convex-url.ts's header DESCRIBES. SSR resolves the
    // Convex URL from the worker's runtime var while the browser inlines a
    // build-time literal; if the .cloud and .site halves of one environment name
    // different deployments, auth and queries talk to different backends and the
    // app SILENTLY HALF-WORKS rather than failing.
    const cloud = env.vars?.VITE_CONVEX_URL
    const site = env.vars?.VITE_CONVEX_SITE_URL
    expect(cloud, `${name} has no VITE_CONVEX_URL`).toBeTruthy()
    expect(site, `${name} has no VITE_CONVEX_SITE_URL`).toBeTruthy()
    expect(convexSlug(site!)).toBe(convexSlug(cloud!))
  })
})

describe('the environments are distinct from one another', () => {
  test('no two environments share a Convex deployment', () => {
    // The copy-paste failure: env.dev added by duplicating the block and only the
    // hostname changed. Every per-environment test above still passes, and dev
    // writes to production's database.
    const slugs = ENVIRONMENTS.map(([, e]) => convexSlug(e.vars!.VITE_CONVEX_URL!))
    expect(new Set(slugs).size, `two environments share a Convex deployment: ${slugs}`).toBe(
      slugs.length,
    )
  })

  test('no two environments claim the same hostname', () => {
    const hosts = ENVIRONMENTS.flatMap(([, e]) => hostsOf(e))
    expect(new Set(hosts).size, `two environments claim one hostname: ${hosts}`).toBe(hosts.length)
  })
})
