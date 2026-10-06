import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { experimental_readRawConfig } from 'wrangler'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { environmentsFromWranglerConfig } from './copy-target.mjs'
import {
  checkImpactPages,
  decideRacTarget,
  fingerprintOf,
  monthsOf,
  outputPathAllowed,
  parseRacArgs,
  recorder,
} from './rac-runner.mjs'

// wordle-teams-rac.2 (revision 2): what scripts/rac-duplicate-scores.mjs decides
// before it touches anything, and how it keeps its record. The script does its
// work at module scope against a real deployment, so — like every runner here —
// what is worth asserting lives in this lib.

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

  test('--apply, --local, --confirm-host, --expect and --out are read', () => {
    expect(
      parseRacArgs([
        'repair',
        '--apply',
        '--local',
        '--confirm-host=127.0.0.1',
        '--expect=0123456789abcdef',
        '--out=/tmp/x.jsonl',
      ]),
    ).toEqual({
      mode: 'repair',
      apply: true,
      local: true,
      confirmHost: '127.0.0.1',
      expect: '0123456789abcdef',
      out: '/tmp/x.jsonl',
    })
  })

  test('--apply requires --expect, the fingerprint a dry run printed', () => {
    const parsed = parseRacArgs(['repair', '--apply', '--confirm-host=h'])
    expect(parsed.error).toMatch(/--expect/)
  })

  test('refuses an unknown mode, a missing mode and an unknown flag', () => {
    expect(parseRacArgs(['delete'])).toHaveProperty('error')
    expect(parseRacArgs([])).toHaveProperty('error')
    expect(parseRacArgs(['measure', '--prod'])).toHaveProperty('error')
  })

  test('--apply only means something to repair, and never alongside --dry-run', () => {
    expect(parseRacArgs(['measure', '--apply', '--expect=x'])).toHaveProperty('error')
    expect(parseRacArgs(['impact', '--apply', '--expect=x'])).toHaveProperty('error')
    expect(parseRacArgs(['repair', '--apply', '--dry-run', '--expect=x'])).toHaveProperty('error')
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
    const verdict = decide({ environments: [] })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/wrangler\.jsonc/)
  })

  test('refuses a missing or malformed CONVEX_URL', () => {
    expect(decide({ convexUrl: undefined }).ok).toBe(false)
    expect(decide({ convexUrl: 'not a url' }).ok).toBe(false)
  })

  test('--local accepts only a loopback backend, never a cloud one', () => {
    expect(decide({ local: true, convexUrl: 'http://127.0.0.1:3210' })).toMatchObject({ ok: true, host: '127.0.0.1' })
    expect(decide({ local: true, convexUrl: PROD }).ok).toBe(false)
  })

  test('--apply requires --confirm-host naming the host exactly', () => {
    expect(decide({ apply: true }).ok).toBe(false)
    expect(decide({ apply: true, confirmHost: 'fabulous-goldfish-949' }).ok).toBe(false)
    expect(decide({ apply: true, confirmHost: 'fabulous-goldfish-949.convex.cloud' }).ok).toBe(true)
    expect(
      decide({ apply: true, local: true, convexUrl: 'http://127.0.0.1:3210', confirmHost: '127.0.0.1' }).ok,
    ).toBe(true)
    expect(decide({ apply: true, local: true, convexUrl: 'http://127.0.0.1:3210', confirmHost: PROD }).ok).toBe(false)
  })

  test('the real wrangler.jsonc names fabulous-goldfish-949 as the expected host', () => {
    const { rawConfig } = experimental_readRawConfig({
      config: fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)),
    })
    const environments = environmentsFromWranglerConfig(rawConfig)
    expect(decide({ environments })).toMatchObject({ ok: true, host: 'fabulous-goldfish-949.convex.cloud' })
  })
})

describe('outputPathAllowed — on the real filesystem, symlinks resolved', () => {
  let base, tmp, repo
  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rac-guard-')))
    tmp = path.join(base, 'tmp')
    repo = path.join(base, 'repo')
    fs.mkdirSync(tmp)
    fs.mkdirSync(repo)
  })
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }))
  const allowed = (file) => outputPathAllowed(file, { tmpdir: tmp, repoRoot: repo })

  test('a new file in an existing directory under the temp dir is allowed', () => {
    expect(allowed(path.join(tmp, 'report.jsonl'))).toBe(true)
  })

  test('the repository, anything outside the temp dir, and the temp dir itself are refused', () => {
    expect(allowed(path.join(repo, 'report.jsonl'))).toBe(false)
    expect(allowed(path.join(base, 'report.jsonl'))).toBe(false)
    expect(allowed(path.join(tmp, '..', 'repo', 'x.jsonl'))).toBe(false)
    expect(allowed(tmp)).toBe(false)
  })

  test('a directory symlink under the temp dir that points into the repository is refused', () => {
    fs.symlinkSync(repo, path.join(tmp, 'link'))
    expect(allowed(path.join(tmp, 'link', 'report.jsonl'))).toBe(false)
  })

  test('a file symlink under the temp dir that points into the repository is refused', () => {
    fs.writeFileSync(path.join(repo, 'target.jsonl'), '')
    fs.symlinkSync(path.join(repo, 'target.jsonl'), path.join(tmp, 'out.jsonl'))
    expect(allowed(path.join(tmp, 'out.jsonl'))).toBe(false)
  })

  test('a file in a directory that does not exist is refused rather than guessed at', () => {
    expect(allowed(path.join(tmp, 'missing', 'report.jsonl'))).toBe(false)
  })

  test('a repository that itself sits under the temp dir is still refused', () => {
    const nested = path.join(tmp, 'repo2')
    fs.mkdirSync(nested)
    expect(outputPathAllowed(path.join(nested, 'x.jsonl'), { tmpdir: tmp, repoRoot: nested })).toBe(false)
  })
})

describe('recorder', () => {
  let base
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-rec-'))
  })
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

  test('appends each record to the file AS IT IS MADE, one JSON line each', () => {
    const file = path.join(base, 'out.jsonl')
    const print = vi.fn()
    const record = recorder(file, print)
    record({ kind: 'repair', month: '2025-01' })
    // Already on disk before the next call — a crash here keeps it.
    expect(fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse)).toEqual([
      { kind: 'repair', month: '2025-01' },
    ])
    record({ kind: 'repair', month: '2025-02' })
    expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2)
    expect(print).toHaveBeenCalledTimes(2)
  })

  test('without a file it only prints', () => {
    const print = vi.fn()
    recorder(undefined, print)({ a: 1 })
    expect(print).toHaveBeenCalledWith(JSON.stringify({ a: 1 }))
  })
})

describe('fingerprintOf', () => {
  test('is sixteen hex characters, independent of month order', () => {
    const fp = fingerprintOf(['2025-01:1,2', '2024-11:7'])
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
    expect(fingerprintOf(['2024-11:7', '2025-01:1,2'])).toBe(fp)
  })

  test('changes when any deleted row changes', () => {
    const fp = fingerprintOf(['2025-01:1,2'])
    expect(fingerprintOf(['2025-01:1,3'])).not.toBe(fp)
    expect(fingerprintOf(['2025-01:1'])).not.toBe(fp)
    expect(fingerprintOf(['2025-01:1,2', '2025-02:'])).not.toBe(fp)
  })

  test('cannot be forged by moving a separator', () => {
    expect(fingerprintOf(['a', 'b'])).not.toBe(fingerprintOf(['ab']))
  })
})

describe('monthsOf', () => {
  test('every month holding a duplicated day, held or not, once and in order', () => {
    expect(
      monthsOf([
        { groups: [{ puzzleDay: '2025-02-01' }, { puzzleDay: '2024-11-17' }] },
        { groups: [{ puzzleDay: '2025-02-09' }] },
      ]),
    ).toEqual(['2024-11', '2025-02'])
  })
})

describe('checkImpactPages', () => {
  const page = (entries, pairs) => ({ entries: entries.map((team) => ({ team })), pairs })
  test('passes when the pages together hold every pair exactly once', () => {
    expect(checkImpactPages([page([1, 2], 3), page([3], 3)])).toEqual({ ok: true })
    expect(checkImpactPages([page([], 0)])).toEqual({ ok: true })
  })
  test('fails when a pair is missing, repeated, or the total moved between pages', () => {
    expect(checkImpactPages([page([1, 2], 3)]).ok).toBe(false)
    expect(checkImpactPages([page([1, 2], 2), page([2], 2)]).ok).toBe(false)
    expect(checkImpactPages([page([1, 2], 3), page([3, 4], 4)]).ok).toBe(false)
    // The entries add up to the FIRST page's total; only the moved total is wrong.
    expect(checkImpactPages([page([1, 2], 3), page([3], 4)]).ok).toBe(false)
  })
})
