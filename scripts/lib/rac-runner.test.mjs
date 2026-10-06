import { describe, expect, test } from 'vitest'
import { experimental_readRawConfig } from 'wrangler'
import { fileURLToPath } from 'node:url'
import { environmentsFromWranglerConfig } from './copy-target.mjs'
import {
  chunk,
  decideRacTarget,
  dedupeEntries,
  monthsToRepair,
  outputPathAllowed,
  parseRacArgs,
} from './rac-runner.mjs'

// wordle-teams-rac.2: what scripts/rac-duplicate-scores.mjs decides before it
// touches anything. The script itself does its work at module scope against a
// real deployment, so — like every runner here — what is worth asserting lives in
// this lib.

const PROD = 'https://fabulous-goldfish-949.convex.cloud'
const ENVIRONMENTS = [
  { name: '(top level)', host: 'beta.wordleteams.com', convexUrl: PROD },
  { name: 'dev', host: 'dev.wordleteams.com', convexUrl: 'https://successful-canary-135.convex.cloud' },
]
const decide = (over) =>
  decideRacTarget({
    convexUrl: PROD,
    environments: ENVIRONMENTS,
    local: false,
    apply: false,
    confirmHost: undefined,
    ...over,
  })

describe('parseRacArgs', () => {
  test('the three modes, and repair defaults to a dry run', () => {
    expect(parseRacArgs(['measure'])).toMatchObject({ mode: 'measure', apply: false, local: false })
    expect(parseRacArgs(['impact'])).toMatchObject({ mode: 'impact', apply: false })
    expect(parseRacArgs(['repair'])).toMatchObject({ mode: 'repair', apply: false })
    expect(parseRacArgs(['repair', '--dry-run'])).toMatchObject({ mode: 'repair', apply: false })
  })

  test('--apply, --local, --confirm-host and --out are read', () => {
    expect(
      parseRacArgs(['repair', '--apply', '--local', '--confirm-host=127.0.0.1', '--out=/tmp/x.json']),
    ).toEqual({
      mode: 'repair',
      apply: true,
      local: true,
      confirmHost: '127.0.0.1',
      out: '/tmp/x.json',
    })
  })

  test('refuses an unknown mode, a missing mode and an unknown flag', () => {
    expect(parseRacArgs(['delete'])).toHaveProperty('error')
    expect(parseRacArgs([])).toHaveProperty('error')
    expect(parseRacArgs(['measure', '--prod'])).toHaveProperty('error')
  })

  test('--apply only means something to repair, and never alongside --dry-run', () => {
    expect(parseRacArgs(['measure', '--apply'])).toHaveProperty('error')
    expect(parseRacArgs(['impact', '--apply'])).toHaveProperty('error')
    expect(parseRacArgs(['repair', '--apply', '--dry-run'])).toHaveProperty('error')
  })
})

describe('decideRacTarget', () => {
  test('production is the top-level deployment wrangler.jsonc declares, and reads proceed', () => {
    expect(decide({})).toMatchObject({ ok: true, host: 'fabulous-goldfish-949.convex.cloud' })
  })

  test('refuses 127.0.0.1 and localhost without --local', () => {
    for (const url of ['http://127.0.0.1:3210', 'http://localhost:3210']) {
      const verdict = decide({ convexUrl: url })
      expect(verdict.ok).toBe(false)
      expect(verdict.reason).toMatch(/--local/)
    }
  })

  test('refuses any cloud host other than the expected one, including dev', () => {
    expect(decide({ convexUrl: 'https://successful-canary-135.convex.cloud' }).ok).toBe(false)
    expect(decide({ convexUrl: 'https://someone-else-1.convex.cloud' }).ok).toBe(false)
  })

  test('refuses when wrangler.jsonc could not be read, since the expected host is then unknown', () => {
    // Refused either way; the reason must say WHY, not report a host mismatch
    // against `null`.
    const verdict = decide({ environments: [] })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/wrangler\.jsonc/)
  })

  test('refuses a missing or malformed CONVEX_URL', () => {
    expect(decide({ convexUrl: undefined }).ok).toBe(false)
    expect(decide({ convexUrl: 'not a url' }).ok).toBe(false)
  })

  test('--local accepts only a loopback backend, never a cloud one', () => {
    expect(decide({ local: true, convexUrl: 'http://127.0.0.1:3210' })).toMatchObject({
      ok: true,
      host: '127.0.0.1',
    })
    expect(decide({ local: true, convexUrl: PROD }).ok).toBe(false)
  })

  test('--apply requires --confirm-host naming the host exactly', () => {
    expect(decide({ apply: true }).ok).toBe(false)
    expect(decide({ apply: true, confirmHost: 'fabulous-goldfish-949' }).ok).toBe(false)
    expect(decide({ apply: true, confirmHost: 'fabulous-goldfish-949.convex.cloud' }).ok).toBe(true)
    expect(
      decide({ apply: true, local: true, convexUrl: 'http://127.0.0.1:3210', confirmHost: '127.0.0.1' })
        .ok,
    ).toBe(true)
    expect(
      decide({ apply: true, local: true, convexUrl: 'http://127.0.0.1:3210', confirmHost: PROD }).ok,
    ).toBe(false)
  })

  test('the real wrangler.jsonc names fabulous-goldfish-949 as the expected host', () => {
    const { rawConfig } = experimental_readRawConfig({
      config: fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)),
    })
    const environments = environmentsFromWranglerConfig(rawConfig)
    expect(decide({ environments })).toMatchObject({
      ok: true,
      host: 'fabulous-goldfish-949.convex.cloud',
    })
  })
})

describe('outputPathAllowed', () => {
  const where = { tmpdir: '/tmp', repoRoot: '/home/me/repo' }
  test('a path under the OS temp dir is allowed', () => {
    expect(outputPathAllowed('/tmp/rac/report.json', where)).toBe(true)
  })
  test('anything else is refused, the repository above all', () => {
    expect(outputPathAllowed('/home/me/repo/report.json', where)).toBe(false)
    expect(outputPathAllowed('/home/me/report.json', where)).toBe(false)
    expect(outputPathAllowed('/tmp/../home/me/repo/x.json', where)).toBe(false)
    expect(outputPathAllowed('/tmpfoo/x.json', where)).toBe(false)
    expect(outputPathAllowed('/tmp', where)).toBe(false)
  })
  test('a repository that itself sits under the temp dir is still refused', () => {
    expect(outputPathAllowed('/tmp/repo/x.json', { tmpdir: '/tmp', repoRoot: '/tmp/repo' })).toBe(false)
  })
})

describe('batching helpers', () => {
  test('chunk splits into runs of at most n', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([[1, 2, 3, 4, 5], [6, 7]])
    expect(chunk([], 5)).toEqual([])
  })

  test('monthsToRepair lists each month holding a duplicated day once, in order', () => {
    expect(
      monthsToRepair({
        groups: [{ puzzleDay: '2025-02-01' }, { puzzleDay: '2024-11-17' }, { puzzleDay: '2025-02-09' }],
      }),
    ).toEqual(['2024-11', '2025-02'])
  })

  test('dedupeEntries drops an identical (team, month) entry seen from a second batch', () => {
    const a = { team: 206, month: '2025-01', winnerChanged: true }
    const b = { team: 207, month: '2025-01', winnerChanged: false }
    expect(dedupeEntries([a, b, { ...a }])).toEqual([a, b])
  })
})
