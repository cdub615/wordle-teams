import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ConvexError } from 'convex/values'
import {
  classifyApplyError,
  classifyRefusals,
  decideApply,
  decideRedateTarget,
  groupBySourceMonth,
  moveIdOf,
  outputPathAllowed,
  parseRedateArgs,
  planDisagreements,
  recorder,
  redateFingerprint,
  sourceMonthsWithMoves,
  summarizePlans,
} from './redate-runner.mjs'

// wordle-teams-c442.3: what scripts/redate-misdated-boards.mjs decides before it
// touches anything, and how it keeps its record. Its target guard, --out guard and
// recorder are rac's (lib/rac-runner.mjs), re-exported, and pinned here again as
// the re-date runner uses them, so a change there that loosens this runner fails
// this file too.
//
// Every id and answer here is synthetic: this repository is public.

const PROD = 'https://fabulous-goldfish-949.convex.cloud'
const HOST = 'fabulous-goldfish-949.convex.cloud'
const ENVIRONMENTS = [
  { name: '(top level)', host: 'beta.wordleteams.com', convexUrl: PROD },
  { name: 'dev', host: 'dev.wordleteams.com', convexUrl: 'https://successful-canary-135.convex.cloud' },
]
const decide = (over) =>
  decideRedateTarget({
    convexUrl: PROD,
    environments: ENVIRONMENTS,
    local: false,
    apply: false,
    confirmHost: undefined,
    ...over,
  })

const board = (legacyId, answer) => ({ legacyId, createdAt: null, answer, attempts: 3 })
const move = (player, puzzleDay, to, legacyId) => ({
  player,
  kind: 'move',
  puzzleDay,
  to,
  stay: board(legacyId - 1, 'CRANE'),
  move: board(legacyId, 'SLATE'),
})
const hold = (player, puzzleDay, reason, targets = []) => ({
  player,
  kind: 'hold',
  puzzleDay,
  reason,
  targets,
  boards: [board(1, 'CRANE'), board(2, 'SLATE')],
})

describe('parseRedateArgs', () => {
  test('two modes, and repair defaults to a dry run', () => {
    expect(parseRedateArgs(['measure'])).toMatchObject({ mode: 'measure', apply: false, local: false })
    expect(parseRedateArgs(['repair'])).toMatchObject({ mode: 'repair', apply: false })
    expect(parseRedateArgs(['repair', '--dry-run'])).toMatchObject({ mode: 'repair', apply: false })
  })

  test("rac's impact mode is not this runner's", () => {
    expect(parseRedateArgs(['impact'])).toHaveProperty('error')
  })

  test('--apply, --local, --confirm-host, --expect and --out are read', () => {
    expect(
      parseRedateArgs([
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

  test('--apply without --expect is refused: an apply must quote the dry run it approves', () => {
    expect(parseRedateArgs(['repair', '--apply', `--confirm-host=${HOST}`]).error).toMatch(/--expect/)
  })

  test('an unknown or mistyped flag is refused, never ignored', () => {
    expect(parseRedateArgs(['repair', '--aply'])).toHaveProperty('error')
    expect(parseRedateArgs(['measure', '--prod'])).toHaveProperty('error')
  })

  test('a missing or unknown mode is refused', () => {
    expect(parseRedateArgs([])).toHaveProperty('error')
    expect(parseRedateArgs(['delete'])).toHaveProperty('error')
  })

  test('--apply only means something to repair, and never alongside --dry-run', () => {
    expect(parseRedateArgs(['measure', '--apply', '--expect=x'])).toHaveProperty('error')
    expect(parseRedateArgs(['repair', '--apply', '--dry-run', '--expect=x'])).toHaveProperty('error')
  })
})

describe('decideRedateTarget', () => {
  test('production, the top-level deployment in wrangler.jsonc, may be read', () => {
    expect(decide({})).toEqual({ ok: true, host: HOST })
  })

  test('a loopback backend is refused without --local, and the refusal says so', () => {
    for (const url of ['http://127.0.0.1:3210', 'http://localhost:3210']) {
      const verdict = decide({ convexUrl: url })
      expect(verdict.ok).toBe(false)
      expect(verdict.reason).toMatch(/LOCAL backend.*--local/)
    }
  })

  test('any other cloud host is refused, dev included', () => {
    expect(decide({ convexUrl: 'https://successful-canary-135.convex.cloud' }).ok).toBe(false)
  })

  test('with no readable wrangler.jsonc the expected host is unknown, and the answer is no', () => {
    expect(decide({ environments: [] }).ok).toBe(false)
  })

  test('--local accepts only loopback', () => {
    expect(decide({ local: true, convexUrl: 'http://127.0.0.1:3210' })).toEqual({ ok: true, host: '127.0.0.1' })
    expect(decide({ local: true }).ok).toBe(false)
  })

  test('--apply needs --confirm-host naming the printed host exactly', () => {
    expect(decide({ apply: true }).ok).toBe(false)
    expect(decide({ apply: true, confirmHost: 'fabulous-goldfish-949' }).ok).toBe(false)
    expect(decide({ apply: true, confirmHost: HOST })).toEqual({ ok: true, host: HOST })
  })
})

describe('outputPathAllowed — the report names real players, so only under the temp dir', () => {
  let base, tmp, repo
  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redate-guard-')))
    tmp = path.join(base, 'tmp')
    repo = path.join(base, 'repo')
    fs.mkdirSync(tmp)
    fs.mkdirSync(repo)
  })
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }))
  const allowed = (file) => outputPathAllowed(file, { tmpdir: tmp, repoRoot: repo })

  test('a new file under the temp dir is allowed', () => {
    expect(allowed(path.join(tmp, 'redate.jsonl'))).toBe(true)
  })

  test('outside the temp dir, or in the repository, is refused', () => {
    expect(allowed(path.join(base, 'redate.jsonl'))).toBe(false)
    expect(allowed(path.join(repo, 'redate.jsonl'))).toBe(false)
  })

  test('a symlink under the temp dir into the repository is refused', () => {
    fs.symlinkSync(repo, path.join(tmp, 'link'))
    expect(allowed(path.join(tmp, 'link', 'redate.jsonl'))).toBe(false)
  })
})

describe('recorder', () => {
  let base
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'redate-rec-'))
  })
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

  test('each record is on disk, one JSON line, before the next call is made', () => {
    const file = path.join(base, 'out.jsonl')
    const print = vi.fn()
    const record = recorder(file, print)
    record({ kind: 'applied', month: '2025-01' })
    expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify({ kind: 'applied', month: '2025-01' }) + '\n')
    expect(print).toHaveBeenCalledTimes(1)
  })
})

describe('groupBySourceMonth and sourceMonthsWithMoves', () => {
  const plans = [
    move('p-1', '2025-02-03', '2025-02-04', 102),
    hold('p-2', '2025-01-31', 'target-occupied', ['2025-02-01']),
    move('p-1', '2025-01-31', '2025-02-01', 101),
    hold('p-3', '2024-12-10', 'no-consensus'),
  ]

  test('groups moves and holds by SOURCE month (the day the pair sits on), months in order', () => {
    expect(groupBySourceMonth(plans)).toEqual([
      { month: '2024-12', moves: [], holds: [plans[3]] },
      { month: '2025-01', moves: [plans[2]], holds: [plans[1]] },
      { month: '2025-02', moves: [plans[0]], holds: [] },
    ])
  })

  test('the months to repair are those with a move — by source month, never the target month', () => {
    expect(sourceMonthsWithMoves(plans)).toEqual(['2025-01', '2025-02'])
  })

  test('a month holding only holds is not repaired', () => {
    expect(sourceMonthsWithMoves([hold('p-3', '2024-12-10', 'no-target')])).toEqual([])
  })
})

describe('summarizePlans', () => {
  test('counts moves, holds and each hold reason', () => {
    expect(
      summarizePlans([
        move('p-1', '2025-01-02', '2025-01-03', 11),
        hold('p-2', '2025-01-05', 'no-target'),
        hold('p-2', '2025-01-09', 'no-target'),
        hold('p-3', '2025-01-09', 'v2-row'),
      ]),
    ).toEqual({ moves: 1, holds: 3, holdReasons: { 'no-target': 2, 'v2-row': 1 } })
  })
})

describe('moveIdOf', () => {
  test("names a move exactly as redateKey does: the moving board's legacyId, from>to", () => {
    expect(moveIdOf(move('p-1', '2025-01-31', '2025-02-01', 101))).toBe('101:2025-01-31>2025-02-01')
  })
})

describe('redateFingerprint — the one value an apply must quote', () => {
  const keys = ['2025-01:101:2025-01-31>2025-02-01', '2025-02:102:2025-02-03>2025-02-04']
  const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

  test("sixteen hex characters of SHA-256 over the months' keys, in MONTH order, newline-joined", () => {
    const planned = [
      { month: '2025-02', redateKey: keys[1] },
      { month: '2025-01', redateKey: keys[0] },
    ]
    expect(redateFingerprint(planned)).toBe(sha(keys.join('\n')))
    expect(redateFingerprint([...planned].reverse())).toBe(redateFingerprint(planned))
  })

  test('a month that could not be planned is in it as refused, so it cannot be applied around', () => {
    const fp = redateFingerprint([{ month: '2025-01', redateKey: keys[0] }])
    expect(redateFingerprint([{ month: '2025-01', redateKey: keys[0] }, { month: '2025-02', refused: true }])).toBe(
      sha(`${keys[0]}\n2025-02:refused`),
    )
    expect(
      redateFingerprint([
        { month: '2025-01', redateKey: keys[0] },
        { month: '2025-02', refused: true },
      ]),
    ).not.toBe(fp)
  })

  test('changes when any move changes', () => {
    const fp = redateFingerprint([{ month: '2025-01', redateKey: keys[0] }])
    expect(redateFingerprint([{ month: '2025-01', redateKey: '2025-01:101:2025-01-31>2025-01-30' }])).not.toBe(fp)
    expect(redateFingerprint([{ month: '2025-01', redateKey: '2025-01:' }])).not.toBe(fp)
  })

  test("refuses a key that is not its own month's: the server binds the month into it", () => {
    expect(() => redateFingerprint([{ month: '2025-01', redateKey: keys[1] }])).toThrow(/2025-01/)
  })
})

describe('planDisagreements — the dry run must plan what measure planned', () => {
  const measured = [
    move('p-1', '2025-01-31', '2025-02-01', 101),
    hold('p-2', '2025-01-12', 'no-target'),
    move('p-1', '2025-02-03', '2025-02-04', 102),
  ]
  const planned = (month, moves) => ({ month, redateKey: `${month}:`, moves, holds: [], teamMonths: [] })

  test('none when every planned month moves exactly the boards measure moved there', () => {
    expect(
      planDisagreements(measured, [planned('2025-01', [measured[0]]), planned('2025-02', [measured[2]])]),
    ).toEqual([])
  })

  test('a move only the dry run plans, or only measure, is a disagreement for that month', () => {
    const extra = move('p-4', '2025-01-20', '2025-01-21', 400)
    expect(planDisagreements(measured, [planned('2025-01', [measured[0], extra]), planned('2025-02', [])])).toEqual([
      { month: '2025-01', onlyMeasured: [], onlyPlanned: ['400:2025-01-20>2025-01-21'] },
      { month: '2025-02', onlyMeasured: ['102:2025-02-03>2025-02-04'], onlyPlanned: [] },
    ])
  })

  test('a move to a different day is a disagreement', () => {
    const elsewhere = move('p-1', '2025-01-31', '2025-01-30', 101)
    expect(planDisagreements(measured, [planned('2025-01', [elsewhere])])).toEqual([
      { month: '2025-01', onlyMeasured: ['101:2025-01-31>2025-02-01'], onlyPlanned: ['101:2025-01-31>2025-01-30'] },
    ])
  })

  test('a month that was not planned (refused) is not compared', () => {
    expect(planDisagreements(measured, [planned('2025-01', [measured[0]])])).toEqual([])
  })
})

describe('decideApply — refuse unless the plan is still the one approved', () => {
  const ok = { fingerprint: '0123456789abcdef', expect: '0123456789abcdef', failed: [], disagreements: [] }

  test('proceeds only when the fingerprint matches, every month planned and agrees with measure', () => {
    expect(decideApply(ok)).toEqual({ ok: true })
  })

  test('refuses a fingerprint other than the one expected', () => {
    const verdict = decideApply({ ...ok, expect: 'fedcba9876543210' })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/0123456789abcdef/)
    expect(verdict.reason).toMatch(/fedcba9876543210/)
  })

  test('refuses when a month could not be planned', () => {
    expect(decideApply({ ...ok, failed: ['2025-01'] })).toMatchObject({ ok: false, reason: expect.stringMatching(/2025-01/) })
  })

  test('refuses when the dry run disagrees with measure', () => {
    const disagreements = [{ month: '2025-02', onlyMeasured: ['102:2025-02-03>2025-02-04'], onlyPlanned: [] }]
    expect(decideApply({ ...ok, disagreements })).toMatchObject({ ok: false, reason: expect.stringMatching(/2025-02/) })
  })

  test('refuses a missing expectation', () => {
    expect(decideApply({ ...ok, expect: undefined }).ok).toBe(false)
  })
})

describe('classifyRefusals and classifyApplyError, as this runner meets them', () => {
  test("repairMisdatedBoards' not-a-past-month refusal DEFERS the month; anything else FAILS it", () => {
    expect(
      classifyRefusals([
        { month: '2026-10', reason: 'repairMisdatedBoards: 2026-10 is not a past month; the latest allowed is 2026-09' },
        { month: '2025-12', reason: 'fetch failed' },
      ]),
    ).toEqual({ deferred: ['2026-10'], failed: ['2025-12'] })
  })

  test('a ConvexError (the stale-plan refusal) wrote nothing; anything else is unconfirmed', () => {
    expect(classifyApplyError(new ConvexError('repairMisdatedBoards: the plan changed since the dry run'))).toBe(
      'refused',
    )
    expect(classifyApplyError(new TypeError('fetch failed'))).toBe('unconfirmed')
  })
})
