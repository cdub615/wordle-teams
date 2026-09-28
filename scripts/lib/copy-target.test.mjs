import { describe, expect, test } from 'vitest'
import { experimental_readRawConfig } from 'wrangler'
import { fileURLToPath } from 'node:url'
import { describeCopyTarget, environmentsFromWranglerConfig } from './copy-target.mjs'

// WHICH DEPLOYMENT THE COPY IS ABOUT TO WRITE TO (wordle-teams-qjh3.12).
//
// copy-from-supabase.mjs is aimed by two environment variables, and with THREE
// deployments now in play — local, dev, and the one that becomes production —
// "which one am I pointed at" stopped being rhetorical. The cutover runbook's
// section 0 makes reading a sentinel first a rule for every shell; this moves that
// rule into the tool, where it cannot be skipped under time pressure.

const ENVIRONMENTS = [
  { name: '(top level)', host: 'beta.wordleteams.com', convexUrl: 'https://fabulous-goldfish-949.convex.cloud' },
  { name: 'dev', host: 'dev.wordleteams.com', convexUrl: 'https://successful-canary-135.convex.cloud' },
]

describe('a recognised deployment', () => {
  test('is named, with the environment and hostname it serves', () => {
    const target = describeCopyTarget('https://fabulous-goldfish-949.convex.cloud', ENVIRONMENTS)
    expect(target.kind).toBe('environment')
    expect(target.environment).toBe('(top level)')
    expect(target.host).toBe('beta.wordleteams.com')
    expect(target.label).toMatch(/beta\.wordleteams\.com/)
  })

  test('matches on the deployment slug, so .site and .cloud are the same target', () => {
    // The script is given CONVEX_URL, but an operator reading a runbook may have
    // the .site host in hand. Matching the slug means both answer correctly
    // rather than one silently reading as an unknown deployment.
    expect(describeCopyTarget('https://successful-canary-135.convex.site', ENVIRONMENTS).environment).toBe('dev')
  })

  test('a trailing slash does not make a known deployment unrecognisable', () => {
    expect(describeCopyTarget('https://successful-canary-135.convex.cloud/', ENVIRONMENTS).kind).toBe('environment')
  })
})

describe('a local backend', () => {
  test('is recognised rather than treated as unknown', () => {
    // Running the copy against a local anonymous backend is an ordinary thing to
    // do while developing. Treating it as an unrecognised cloud deployment would
    // make the guard fire on the one case that is certainly harmless.
    for (const url of ['http://127.0.0.1:3210', 'http://localhost:3210']) {
      const target = describeCopyTarget(url, ENVIRONMENTS)
      expect(target.kind).toBe('local')
      expect(target.label).toMatch(/local/i)
    }
  })
})

describe('an unrecognised deployment', () => {
  test('is reported as unknown, which is what the guard keys on', () => {
    const target = describeCopyTarget('https://someone-elses-42.convex.cloud', ENVIRONMENTS)
    expect(target.kind).toBe('unknown')
    // The slug is echoed so the operator can tell WHICH unknown deployment it is.
    expect(target.label).toMatch(/someone-elses-42/)
  })

  test('a malformed URL is unknown rather than a crash', () => {
    // The copy must fail for copy reasons, never because the thing that describes
    // it threw. Same principle the insert report already follows.
    for (const url of ['', 'not a url', undefined]) {
      expect(describeCopyTarget(url, ENVIRONMENTS).kind).toBe('unknown')
    }
  })

  test('an empty environment list makes everything unknown, and does not throw', () => {
    // This is the "wrangler.jsonc could not be read" path. It must degrade to
    // "cannot identify the target" rather than to an exception.
    expect(describeCopyTarget('https://fabulous-goldfish-949.convex.cloud', []).kind).toBe('unknown')
  })
})

describe('environmentsFromWranglerConfig, against the REAL wrangler.jsonc', () => {
  // The literal ENVIRONMENTS above prove the matching. This proves the EXTRACTION
  // — that the paths into the config are right — and it has to read the real file,
  // because a wrong path is silent in the safe-looking direction: every URL comes
  // back undefined, every target resolves to 'unknown', and the guard demanding an
  // acknowledgement for both real deployments looks like the guard working.
  const { rawConfig } = experimental_readRawConfig({
    config: fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)),
  })
  const environments = environmentsFromWranglerConfig(rawConfig)

  test('every declared environment yields a Convex URL and a hostname', () => {
    expect(environments.length).toBeGreaterThan(1)
    for (const environment of environments) {
      expect(environment.convexUrl, `${environment.name} has no VITE_CONVEX_URL`).toMatch(
        /^https:\/\/[a-z0-9-]+\.convex\.cloud$/,
      )
      expect(environment.host, `${environment.name} has no route`).toMatch(/wordleteams\.com$/)
    }
  })

  test("each environment's own Convex URL resolves back to that environment", () => {
    // The round trip. If extraction and matching ever disagree, this is what says
    // so — and it is the exact question the guard asks at run time.
    for (const environment of environments) {
      const target = describeCopyTarget(environment.convexUrl, environments)
      expect(target.kind).toBe('environment')
      expect(target.environment).toBe(environment.name)
    }
  })
})
