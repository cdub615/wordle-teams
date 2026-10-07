# Public Leagues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Starting Words" public league (CRANE, SLATE, ADIEU, STARE, ORATE): a player joins one group, every board counts for it, and groups are ranked monthly on pooled average guesses with group totals only crossing the stranger boundary.

**Architecture:** Every rule is a pure function in `convex/lib/league.ts` (imports only `./puzzleDay.ts` and `./teamStats.ts`). `convex/leagues.ts` holds thin `…For(ctx, …)` handlers plus public wrappers gated on `LEAGUES_ENABLED`. Standings are a two-level aggregate (`leagueMemberMonth` → `leagueGroupMonth`) updated by an O(1) delta on every board write, and closed months are frozen into `leagueMonthResults` by a job the existing daily sweep schedules from day 2. UI is a `/leagues` index, `/leagues/$slug` standings, a home card, an onboarding step and an app-menu entry.

**Tech Stack:** Convex (convex-test + vitest), TanStack Start/Router, React, shadcn/ui, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-public-leagues-design.md`. It is authoritative; section references (§n) below point into it.

---

## Ground rules for every task

- **Branch:** work on `dev`. Never push `main`. A PR goes dev → main at the end (Task 15).
- **Gates, run SEPARATELY, read each exit code, never pipe a gate into `tail`/`grep`** (zsh has no `PIPESTATUS`):
  ```bash
  TZ=UTC pnpm test:once > /tmp/claude-gates/test.log 2>&1; echo "test=$?"
  pnpm typecheck        > /tmp/claude-gates/tsc.log  2>&1; echo "tsc=$?"
  pnpm lint             > /tmp/claude-gates/lint.log 2>&1; echo "lint=$?"
  pnpm build            > /tmp/claude-gates/build.log 2>&1; echo "build=$?"
  ```
  (`mkdir -p /tmp/claude-gates` once.) A task is not done until all four are 0.
- **Single test file while iterating:** `TZ=UTC pnpm vitest run <path>`.
- **Commit messages** use a quoted heredoc (backticks in `-m "…"` get executed by the shell):
  ```bash
  git commit -F - <<'EOF'
  feat(zic8.3): …

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```
- **TDD:** each task commits red (`test(zic8.3): … (red)`) then green (`feat(zic8.3): …`), matching the repo's history.
- **No commits while a subagent runs.** A subagent's `--amend` swallows a commit that lands mid-flight.
- **Refusals** always go through `accessError(code)` (`convex/access.ts`), never a plain `Error`: plain messages are redacted in prod and convex-test never redacts.
- **Never put an email address in a beads issue**: the repo is public and `.beads/issues.jsonl` is tracked.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `convex/lib/league.ts` | create | Every league rule: constants, flag, interval planning, totals, delta, standings, winner, contribution, month-to-close |
| `convex/lib/league.test.ts` | create | Unit tests for the above |
| `convex/schema.ts` | modify | Six new tables |
| `convex/access.ts` | modify | Seven new `AccessCode`s |
| `src/lib/convex-error.ts` | modify | Recognise and word the new codes |
| `convex/leagues.ts` | create | `…For` handlers, public wrappers, `closeLeagueMonth` internal job, `seedLeague` |
| `convex/leagues.test.ts` | create | convex-test coverage driving the `…For` handlers |
| `convex/scores.ts` | modify | Call `recomputeLeagueMonthFor` after `recomputePlayerMonth` |
| `convex/teamStats.ts` | modify | Sweep schedules league closes |
| `convex/e2ePrune.ts` | modify | Delete a pruned player's league rows and correct group totals |
| `convex/e2eSeed.ts` | modify | `ensureLeagueFor` e2e helper |
| `src/components/leagues/group-picker.tsx` | create | Inline buttons ≤ 6 groups, searchable sheet above |
| `src/components/leagues/league-standings.tsx` | create | The standings table, last-month line, all-time tally |
| `src/components/leagues/contribution-row.tsx` | create | Pro row / locked teaser |
| `src/components/leagues/leagues-card.tsx` | create | Home card |
| `src/routes/leagues.index.tsx` | create | `/leagues`, redirecting with one league |
| `src/routes/leagues.$slug.tsx` | create | `/leagues/$slug` |
| `src/routes/app.tsx` | modify | Mount the home card |
| `src/components/onboarding/next-step-card.tsx` | modify | "Pick your opener" step for a teamless player |
| `src/components/app-menu.tsx` | modify | "Leagues" entry |
| `e2e/leagues.spec.ts` | create | One end-to-end path |
| `.github/workflows/deploy-v2.yml` | modify | `LEAGUES_ENABLED=true` on CI's local backend |

---

### Task 1: League rules — constants, flag, totals, standings, winner, contribution

**Files:**
- Create: `convex/lib/league.ts`
- Test: `convex/lib/league.test.ts`

Interval planning is Task 2; this task is the arithmetic.

- [ ] **Step 1: Write the failing tests**

```ts
// convex/lib/league.test.ts
/**
 * BOTH SIDES OF EVERY THRESHOLD. A floor tested from one side is vacuous, so
 * MIN_LEAGUE_BOARDS is asserted at 9 and 10. LOWER IS BETTER is asserted in both
 * directions because it is the easiest thing here to implement backwards.
 */
import { describe, expect, test } from 'vitest'
import {
  contributionOf,
  groupAverageOf,
  groupDelta,
  HOME_CARD_MAX_LEAGUES,
  LEAGUES_ON,
  lastDayOfMonth,
  leaguesEnabled,
  memberTotalsFor,
  MIN_LEAGUE_BOARDS,
  monthToClose,
  PICKER_INLINE_MAX,
  standingsOf,
  winnerOf,
} from './league.ts'

describe('the constants', () => {
  test('are the values the design approved', () => {
    expect(MIN_LEAGUE_BOARDS).toBe(10)
    expect(PICKER_INLINE_MAX).toBe(6)
    expect(HOME_CARD_MAX_LEAGUES).toBe(3)
  })
})

describe('leaguesEnabled', () => {
  test('only the exact string turns leagues on', () => {
    expect(leaguesEnabled(LEAGUES_ON)).toBe(true)
    for (const value of [undefined, '', 'TRUE', ' true', '1', 'yes']) {
      expect(leaguesEnabled(value)).toBe(false)
    }
  })
})

describe('lastDayOfMonth', () => {
  // monthRange(month).end is always '-31' — a query bound, not a calendar day.
  test('is the real last day, not -31', () => {
    expect(lastDayOfMonth('2026-02-11')).toBe('2026-02-28')
    expect(lastDayOfMonth('2026-09-30')).toBe('2026-09-30')
    expect(lastDayOfMonth('2026-10-07')).toBe('2026-10-31')
  })
})

describe('memberTotalsFor', () => {
  const crane = { groupId: 'crane', fromDay: '2026-10-08' }
  test('counts only boards inside an interval and inside the month', () => {
    const boards = [
      { puzzleDay: '2026-10-07', attempts: 3 }, // before joining
      { puzzleDay: '2026-10-08', attempts: 4 },
      { puzzleDay: '2026-10-20', attempts: 7 },
      { puzzleDay: '2026-11-01', attempts: 2 }, // next month
    ]
    expect(memberTotalsFor(boards, [crane], '2026-10')).toEqual({
      groupId: 'crane',
      boards: 2,
      attempts: 11,
    })
  })
  test('toDay is inclusive', () => {
    const left = { groupId: 'crane', fromDay: '2026-10-08', toDay: '2026-10-10' }
    const boards = [
      { puzzleDay: '2026-10-10', attempts: 3 },
      { puzzleDay: '2026-10-11', attempts: 3 },
    ]
    expect(memberTotalsFor(boards, [left], '2026-10')).toEqual({ groupId: 'crane', boards: 1, attempts: 3 })
  })
  test('two intervals in the same group in one month accumulate', () => {
    const a = { groupId: 'crane', fromDay: '2026-10-02', toDay: '2026-10-03' }
    const b = { groupId: 'crane', fromDay: '2026-10-10' }
    const boards = [
      { puzzleDay: '2026-10-03', attempts: 4 },
      { puzzleDay: '2026-10-05', attempts: 4 },
      { puzzleDay: '2026-10-12', attempts: 2 },
    ]
    expect(memberTotalsFor(boards, [a, b], '2026-10')).toEqual({ groupId: 'crane', boards: 2, attempts: 6 })
  })
  test('null when nothing counts', () => {
    expect(memberTotalsFor([{ puzzleDay: '2026-10-01', attempts: 3 }], [crane], '2026-10')).toBeNull()
    expect(memberTotalsFor([], [crane], '2026-10')).toBeNull()
  })
})

describe('groupDelta', () => {
  test('null to row adds a contributor', () => {
    expect(groupDelta(null, { boards: 2, attempts: 8 })).toEqual({ boards: 2, attempts: 8, contributors: 1 })
  })
  test('row to row moves only the totals', () => {
    expect(groupDelta({ boards: 2, attempts: 8 }, { boards: 3, attempts: 10 })).toEqual({
      boards: 1,
      attempts: 2,
      contributors: 0,
    })
  })
  test('row to null removes the contributor', () => {
    expect(groupDelta({ boards: 2, attempts: 8 }, null)).toEqual({ boards: -2, attempts: -8, contributors: -1 })
  })
  test('null to null is zero', () => {
    expect(groupDelta(null, null)).toEqual({ boards: 0, attempts: 0, contributors: 0 })
  })
})

describe('groupAverageOf', () => {
  test('null below the floor, a 1dp average at it', () => {
    expect(groupAverageOf({ boards: MIN_LEAGUE_BOARDS - 1, attempts: 36 })).toBeNull()
    expect(groupAverageOf({ boards: MIN_LEAGUE_BOARDS, attempts: 41 })).toBe(4.1)
  })
})

describe('standingsOf', () => {
  const row = (groupId: string, order: number, boards: number, attempts: number, contributors = 1) => ({
    groupId,
    order,
    boards,
    attempts,
    contributors,
  })
  test('lower average ranks first', () => {
    const out = standingsOf([row('slate', 1, 10, 41), row('crane', 0, 10, 38)])
    expect(out.map((s) => [s.groupId, s.rank, s.average])).toEqual([
      ['crane', 1, 3.8],
      ['slate', 2, 4.1],
    ])
  })
  test('an equal 1dp average is broken on boards played, more first', () => {
    // 38/10 = 3.80 and 46/12 = 3.83 both display 3.8.
    const out = standingsOf([row('crane', 0, 10, 38), row('slate', 1, 12, 46)])
    expect(out.map((s) => s.groupId)).toEqual(['slate', 'crane'])
  })
  test('unranked groups follow, by boards then order, with progress', () => {
    const out = standingsOf([row('adieu', 2, 6, 24), row('orate', 4, 0, 0, 0), row('crane', 0, 10, 38), row('stare', 3, 6, 30)])
    expect(out.map((s) => [s.groupId, s.rank])).toEqual([
      ['crane', 1],
      ['adieu', null],
      ['stare', null],
      ['orate', null],
    ])
    expect(out[1].average).toBeNull()
  })
})

describe('winnerOf', () => {
  const s = (groupId: string, rank: number | null, average: number | null, boards: number) => ({
    groupId,
    rank,
    average,
    boards,
    attempts: 0,
    contributors: 1,
    order: 0,
  })
  test('the first ranked group', () => {
    expect(winnerOf([s('crane', 1, 3.8, 10), s('slate', 2, 3.9, 10)])).toBe('crane')
  })
  test('null when nobody qualified', () => {
    expect(winnerOf([s('crane', null, null, 4)])).toBeNull()
  })
  test('null on an exact tie of average AND boards', () => {
    expect(winnerOf([s('crane', 1, 3.8, 10), s('slate', 2, 3.8, 10)])).toBeNull()
  })
})

describe('contributionOf', () => {
  test('shift is the group average with the member minus without them', () => {
    // group 40/10 = 4.0; without the member 30/6 = 5.0 -> member pulls it down by 1.0
    expect(contributionOf({ boards: 4, attempts: 10 }, { boards: 10, attempts: 40 })).toEqual({
      mine: 2.5,
      group: 4,
      shift: -1,
    })
  })
  test('shift is null when the group without the member is below the floor', () => {
    expect(contributionOf({ boards: 4, attempts: 10 }, { boards: 12, attempts: 40 }).shift).toBeNull()
  })
})

describe('monthToClose', () => {
  test('nothing on day 1, last month from day 2', () => {
    expect(monthToClose('2026-11-01', '2026-09-15')).toBeNull()
    expect(monthToClose('2026-11-02', '2026-09-15')).toBe('2026-10')
    expect(monthToClose('2027-01-05', '2026-09-15')).toBe('2026-12')
  })
  test('never a month before the league existed', () => {
    expect(monthToClose('2026-11-02', '2026-11-01')).toBeNull()
    expect(monthToClose('2026-11-02', '2026-10-31')).toBe('2026-10')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `TZ=UTC pnpm vitest run convex/lib/league.test.ts`
Expected: FAIL, `Failed to resolve import "./league.ts"`.

Commit red:
```bash
git add convex/lib/league.test.ts
git commit -F - <<'EOF'
test(zic8.3): league arithmetic — totals, delta, standings, winner, contribution (red)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 3: Implement**

```ts
// convex/lib/league.ts
import { addMonths, daysOfMonth, monthOf } from './puzzleDay.ts'
import type { PuzzleDay, PuzzleMonth } from './puzzleDay.ts'
import { meanAttemptsOf } from './teamStats.ts'

/**
 * THE RULES OF A PUBLIC LEAGUE (wordle-teams-zic8.3), in one dependency-light
 * module. Spec: docs/superpowers/specs/2026-10-07-public-leagues-design.md.
 *
 * WHY EVERYTHING DECIDABLE IS IN HERE. Nothing in this repo can drive an authed
 * Convex wrapper (wordle-teams-obw), so a rule left inside a mutation is a rule
 * no test can execute. ../leagues.ts supplies inputs; this file decides.
 *
 * WHAT MAY BE IMPORTED HERE. ./puzzleDay.ts and ./teamStats.ts only, both of
 * which the client already pulls in. NOT ../access.ts and NOT ../auth.ts — see
 * the banner on lib/challenge.ts for the measurement.
 *
 * GENERIC OVER THE ID TYPES (`G extends string`) so Id<'leagueGroups'> flows
 * through without this module importing the generated data model — the idiom
 * lib/teamStats.ts uses for the same reason.
 */

/** Boards a group needs in a month before it has an average or a rank. */
export const MIN_LEAGUE_BOARDS = 10

/** At or below this many groups the picker is inline buttons; above, a sheet. */
export const PICKER_INLINE_MAX = 6

/** Joined leagues the home card lists before "See all". */
export const HOME_CARD_MAX_LEAGUES = 3

/**
 * WHETHER LEAGUES ARE ON FOR THIS DEPLOYMENT. Read from LEAGUES_ENABLED.
 * AN ALLOW-LIST, for lib/challenge.ts's reason: only the exact string 'true'
 * turns the feature on, so a typo keeps it dark rather than publishing it.
 * The daily close is NOT gated on this — switching the feature off must not
 * leave a played month unclosed.
 */
export const LEAGUES_ON = 'true'

export function leaguesEnabled(value: string | undefined): boolean {
  return value === LEAGUES_ON
}

/**
 * The real last calendar day of `day`'s month. NOT monthRange(month).end, which
 * is always '-31' because it is an index bound, not a date.
 */
export function lastDayOfMonth(day: PuzzleDay): PuzzleDay {
  return daysOfMonth(monthOf(day)).at(-1)!
}

/** A membership interval. `toDay` absent means open. Both bounds inclusive. */
export type Interval<G extends string = string> = {
  groupId: G
  fromDay: PuzzleDay
  toDay?: PuzzleDay
}

export function intervalCovers(interval: Interval, day: PuzzleDay): boolean {
  return day >= interval.fromDay && (interval.toDay === undefined || day <= interval.toDay)
}

export type ScoredBoard = { puzzleDay: PuzzleDay; attempts: number }
export type Totals = { boards: number; attempts: number }

/**
 * One member's contribution to their group for `month`.
 *
 * A board counts iff its day is in `month` AND inside one of the intervals. The
 * spec's one-group-per-month invariant (§4.1) means every covering interval
 * names the same group; the first covering interval's group is taken.
 *
 * NULL WHEN NOTHING COUNTS, which the caller turns into "no member row" — a
 * member with no boards is not a contributor.
 */
export function memberTotalsFor<G extends string>(
  boards: readonly ScoredBoard[],
  intervals: readonly Interval<G>[],
  month: PuzzleMonth,
): (Totals & { groupId: G }) | null {
  let groupId: G | null = null
  let count = 0
  let attempts = 0
  for (const board of boards) {
    if (monthOf(board.puzzleDay) !== month) continue
    const interval = intervals.find((i) => intervalCovers(i, board.puzzleDay))
    if (!interval) continue
    groupId ??= interval.groupId
    count += 1
    attempts += board.attempts
  }
  return groupId === null ? null : { groupId, boards: count, attempts }
}

/**
 * What to add to the group-month row when one member's row goes from `before`
 * to `after`. EXACT BECAUSE `after` IS A FULL RECOMPUTE of that member, not a
 * running counter — a delta of two recomputes cannot drift.
 */
export function groupDelta(before: Totals | null, after: Totals | null): Totals & { contributors: number } {
  return {
    boards: (after?.boards ?? 0) - (before?.boards ?? 0),
    attempts: (after?.attempts ?? 0) - (before?.attempts ?? 0),
    contributors: (after ? 1 : 0) - (before ? 1 : 0),
  }
}

/**
 * A group's month average, or null below MIN_LEAGUE_BOARDS. Rounded to 1dp by
 * meanAttemptsOf BEFORE anything compares it (wordle-teams-iht.3.3).
 */
export function groupAverageOf(totals: Totals): number | null {
  if (totals.boards < MIN_LEAGUE_BOARDS) return null
  return meanAttemptsOf(totals)
}

export type GroupMonthRow<G extends string = string> = Totals & {
  groupId: G
  order: number
  contributors: number
}

export type Standing<G extends string = string> = GroupMonthRow<G> & {
  average: number | null
  rank: number | null
}

/**
 * Ranked groups first — LOWER AVERAGE FIRST, ties on the 1dp average broken by
 * MORE boards — then unranked groups by boards (their progress) and display
 * order. Ranks are 1..n over ranked groups only.
 */
export function standingsOf<G extends string>(rows: readonly GroupMonthRow<G>[]): Standing<G>[] {
  const withAvg = rows.map((row) => ({ ...row, average: groupAverageOf(row) }))
  const ranked = withAvg
    .filter((row) => row.average !== null)
    .sort((a, b) => a.average! - b.average! || b.boards - a.boards || a.order - b.order)
  const unranked = withAvg
    .filter((row) => row.average === null)
    .sort((a, b) => b.boards - a.boards || a.order - b.order)
  return [
    ...ranked.map((row, i) => ({ ...row, rank: i + 1 })),
    ...unranked.map((row) => ({ ...row, rank: null })),
  ]
}

/**
 * The month's winner: the top ranked group, or null when none qualified OR the
 * top two are tied on BOTH the 1dp average and boards — an exact tie names no
 * single winner.
 */
export function winnerOf<G extends string>(standings: readonly Standing<G>[]): G | null {
  const [first, second] = standings
  if (!first || first.rank === null) return null
  if (second && second.rank !== null && second.average === first.average && second.boards === first.boards) {
    return null
  }
  return first.groupId
}

/**
 * The Pro contribution view. `shift` is the group's average WITH the member
 * minus WITHOUT them: negative means the member pulls the group's average down,
 * which is good. Null when either side is below the floor.
 */
export function contributionOf(
  member: Totals,
  group: Totals,
): { mine: number | null; group: number | null; shift: number | null } {
  const withMember = groupAverageOf(group)
  const without = groupAverageOf({
    boards: group.boards - member.boards,
    attempts: group.attempts - member.attempts,
  })
  const shift =
    withMember === null || without === null ? null : Math.round((withMember - without) * 10) / 10 + 0
  return { mine: meanAttemptsOf(member), group: withMember, shift }
}

/**
 * The month the daily sweep should close today, if any.
 *
 * FROM DAY 2, NOT DAY 1 (spec §9): at 00:45 UTC on the 1st a player at UTC-12
 * still has hours to play the last day, and a close then freezes the result
 * without their boards forever.
 *
 * NEVER A MONTH BEFORE THE LEAGUE EXISTED — otherwise launch day snapshots an
 * empty "no winner" month nobody could have played.
 */
export function monthToClose(today: PuzzleDay, leagueCreatedDay: PuzzleDay): PuzzleMonth | null {
  if (Number(today.slice(8, 10)) < 2) return null
  const month = addMonths(monthOf(today), -1)
  return month < monthOf(leagueCreatedDay) ? null : month
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `TZ=UTC pnpm vitest run convex/lib/league.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Gates, then commit green**

Run the four gates (ground rules). Then:
```bash
git add convex/lib/league.ts
git commit -F - <<'EOF'
feat(zic8.3): league arithmetic — totals, delta, standings, winner, contribution

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: League rules — membership planning (join / switch / leave)

**Files:**
- Modify: `convex/lib/league.ts`
- Test: `convex/lib/league.test.ts`

A player's intervals for one league are planned here as a list of operations the handler applies, so every membership rule (§3, §10) is testable without Convex. States (spec §4.1, §6):

- **started** — `fromDay <= today` and (`toDay` absent or `toDay >= today`)
- **pending** — `fromDay > today`
- A member is in exactly one of: started only; pending only (just joined); started (closing at month end) + pending (a switch).

- [ ] **Step 1: Write the failing tests** (append to `convex/lib/league.test.ts`; add `membershipOf, planJoin, planLeave, planSwitch` to the import list)

```ts
describe('planJoin', () => {
  const today = '2026-10-07'
  test('a first join opens from tomorrow and counts +1', () => {
    expect(planJoin([], today, 'crane')).toEqual({
      ops: [{ op: 'insert', groupId: 'crane', fromDay: '2026-10-08' }],
      countFrom: null,
      countTo: 'crane',
    })
  })
  test('refused while a live interval exists', () => {
    expect(planJoin([{ groupId: 'crane', fromDay: '2026-10-01' }], today, 'slate')).toEqual({
      refused: 'ALREADY_IN_LEAGUE',
    })
    expect(planJoin([{ groupId: 'crane', fromDay: '2026-10-08' }], today, 'crane')).toEqual({
      refused: 'ALREADY_IN_LEAGUE',
    })
  })
  test('rejoining the SAME group after leaving this month opens tomorrow', () => {
    const left = [{ groupId: 'crane', fromDay: '2026-10-02', toDay: '2026-10-05' }]
    expect(planJoin(left, today, 'crane')).toMatchObject({
      ops: [{ op: 'insert', groupId: 'crane', fromDay: '2026-10-08' }],
    })
  })
  test('joining a DIFFERENT group after leaving this month opens on the 1st', () => {
    const left = [{ groupId: 'crane', fromDay: '2026-10-02', toDay: '2026-10-05' }]
    expect(planJoin(left, today, 'slate')).toMatchObject({
      ops: [{ op: 'insert', groupId: 'slate', fromDay: '2026-11-01' }],
    })
  })
  test('an interval that ended last month does not hold this month', () => {
    const old = [{ groupId: 'crane', fromDay: '2026-09-02', toDay: '2026-09-30' }]
    expect(planJoin(old, today, 'slate')).toMatchObject({
      ops: [{ op: 'insert', groupId: 'slate', fromDay: '2026-10-08' }],
    })
  })
})

describe('planSwitch', () => {
  const today = '2026-10-07'
  test('refused when not a member', () => {
    expect(planSwitch([], today, 'slate')).toEqual({ refused: 'NOT_IN_LEAGUE' })
  })
  test('started only: close at month end, open on the 1st', () => {
    expect(planSwitch([{ groupId: 'crane', fromDay: '2026-09-01' }], today, 'slate')).toEqual({
      ops: [
        { op: 'patch', index: 0, toDay: '2026-10-31' },
        { op: 'insert', groupId: 'slate', fromDay: '2026-11-01' },
      ],
      countFrom: 'crane',
      countTo: 'slate',
    })
  })
  test('started only, same group: nothing', () => {
    expect(planSwitch([{ groupId: 'crane', fromDay: '2026-09-01' }], today, 'crane')).toEqual({
      ops: [],
      countFrom: null,
      countTo: null,
    })
  })
  test('pending only (just joined): retarget it in place', () => {
    expect(planSwitch([{ groupId: 'crane', fromDay: '2026-10-08' }], today, 'slate')).toEqual({
      ops: [{ op: 'retarget', index: 0, groupId: 'slate' }],
      countFrom: 'crane',
      countTo: 'slate',
    })
  })
  test('started + pending: switching again replaces the pending group', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(planSwitch(state, today, 'adieu')).toEqual({
      ops: [{ op: 'retarget', index: 1, groupId: 'adieu' }],
      countFrom: 'slate',
      countTo: 'adieu',
    })
  })
  test('started + pending: switching back cancels the pending switch', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(planSwitch(state, today, 'crane')).toEqual({
      ops: [
        { op: 'delete', index: 1 },
        { op: 'reopen', index: 0 },
      ],
      countFrom: 'slate',
      countTo: 'crane',
    })
  })
  test('closed history before the live interval is ignored', () => {
    const state = [
      { groupId: 'adieu', fromDay: '2026-08-01', toDay: '2026-08-31' },
      { groupId: 'crane', fromDay: '2026-09-01' },
    ]
    expect(planSwitch(state, today, 'slate')).toMatchObject({
      ops: [
        { op: 'patch', index: 1, toDay: '2026-10-31' },
        { op: 'insert', groupId: 'slate', fromDay: '2026-11-01' },
      ],
    })
  })
})

describe('membershipOf', () => {
  const today = '2026-10-07'
  test('null when not a member', () => {
    expect(membershipOf([], today)).toBeNull()
    expect(membershipOf([{ groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-09-30' }], today)).toBeNull()
  })
  test('started only', () => {
    expect(membershipOf([{ groupId: 'crane', fromDay: '2026-09-01' }], today)).toEqual({
      groupId: 'crane',
      since: '2026-09-01',
      pendingGroupId: null,
      pendingFrom: null,
    })
  })
  test('pending only reports the group it will start in', () => {
    expect(membershipOf([{ groupId: 'crane', fromDay: '2026-10-08' }], today)).toEqual({
      groupId: 'crane',
      since: '2026-10-08',
      pendingGroupId: null,
      pendingFrom: null,
    })
  })
  test('a pending switch', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(membershipOf(state, today)).toEqual({
      groupId: 'crane',
      since: '2026-09-01',
      pendingGroupId: 'slate',
      pendingFrom: '2026-11-01',
    })
  })
})

describe('planLeave', () => {
  const today = '2026-10-07'
  test('refused when not a member', () => {
    expect(planLeave([], today)).toEqual({ refused: 'NOT_IN_LEAGUE' })
  })
  test('started only: ends today', () => {
    expect(planLeave([{ groupId: 'crane', fromDay: '2026-09-01' }], today)).toEqual({
      ops: [{ op: 'patch', index: 0, toDay: '2026-10-07' }],
      countFrom: 'crane',
      countTo: null,
    })
  })
  test('pending only: deleted, never started', () => {
    expect(planLeave([{ groupId: 'crane', fromDay: '2026-10-08' }], today)).toEqual({
      ops: [{ op: 'delete', index: 0 }],
      countFrom: 'crane',
      countTo: null,
    })
  })
  test('started + pending: ends today and drops the pending switch', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(planLeave(state, today)).toEqual({
      ops: [
        { op: 'patch', index: 0, toDay: '2026-10-07' },
        { op: 'delete', index: 1 },
      ],
      countFrom: 'slate',
      countTo: null,
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `TZ=UTC pnpm vitest run convex/lib/league.test.ts`
Expected: FAIL, `planJoin is not a function` (or an import error).

Commit red: `test(zic8.3): membership planning — join, switch, leave (red)` (same heredoc form).

- [ ] **Step 3: Implement** (append to `convex/lib/league.ts`; add `addDays` and `monthRange` to the `./puzzleDay.ts` import)

```ts
/**
 * ONE STEP OF A MEMBERSHIP CHANGE, against the player's intervals for ONE
 * league, by index into the array the planner was given. The handler maps
 * indexes to document ids and applies the ops in order.
 *
 *   insert   — a new interval
 *   patch    — set an interval's toDay
 *   reopen   — clear an interval's toDay
 *   retarget — change a not-yet-started interval's group
 *   delete   — remove an interval
 */
export type IntervalOp<G extends string = string> =
  | { op: 'insert'; groupId: G; fromDay: PuzzleDay }
  | { op: 'patch'; index: number; toDay: PuzzleDay }
  | { op: 'reopen'; index: number }
  | { op: 'retarget'; index: number; groupId: G }
  | { op: 'delete'; index: number }

/**
 * `countFrom`/`countTo` move leagueGroups.memberCount. memberCount counts a
 * member under their LATEST live group, so a pending switcher counts for the
 * group they are switching to.
 */
export type MembershipPlan<G extends string = string> =
  | { ops: IntervalOp<G>[]; countFrom: G | null; countTo: G | null }
  | { refused: 'ALREADY_IN_LEAGUE' | 'NOT_IN_LEAGUE' }

type Live<G extends string> = { started: number | null; pending: number | null; groupOf: (i: number) => G }

/** Index of the started and the pending interval, if any. */
function liveOf<G extends string>(intervals: readonly Interval<G>[], today: PuzzleDay): Live<G> {
  let started: number | null = null
  let pending: number | null = null
  intervals.forEach((interval, i) => {
    if (interval.fromDay > today) pending = i
    else if (interval.toDay === undefined || interval.toDay >= today) started = i
  })
  return { started, pending, groupOf: (i) => intervals[i].groupId }
}

function firstOfNextMonth(today: PuzzleDay): PuzzleDay {
  return monthRange(addMonths(monthOf(today), 1)).start
}

/**
 * Join. From TOMORROW (spec §3: non-retroactive), unless the player already
 * counted for a DIFFERENT group earlier this month, in which case from the 1st —
 * one group per league per month (§4.1, §10).
 */
export function planJoin<G extends string>(
  intervals: readonly Interval<G>[],
  today: PuzzleDay,
  groupId: G,
): MembershipPlan<G> {
  const live = liveOf(intervals, today)
  if (live.started !== null || live.pending !== null) return { refused: 'ALREADY_IN_LEAGUE' }
  const monthStart = monthRange(monthOf(today)).start
  const otherGroupThisMonth = intervals.some(
    (i) => i.groupId !== groupId && (i.toDay === undefined || i.toDay >= monthStart),
  )
  const fromDay = otherGroupThisMonth ? firstOfNextMonth(today) : addDays(today, 1)
  return { ops: [{ op: 'insert', groupId, fromDay }], countFrom: null, countTo: groupId }
}

/** Switch. Takes effect on the 1st; see the state table in the plan's Task 2. */
export function planSwitch<G extends string>(
  intervals: readonly Interval<G>[],
  today: PuzzleDay,
  groupId: G,
): MembershipPlan<G> {
  const { started, pending, groupOf } = liveOf(intervals, today)
  if (started === null && pending === null) return { refused: 'NOT_IN_LEAGUE' }

  if (pending !== null) {
    const pendingGroup = groupOf(pending)
    if (started !== null && groupOf(started) === groupId) {
      return {
        ops: [{ op: 'delete', index: pending }, { op: 'reopen', index: started }],
        countFrom: pendingGroup,
        countTo: groupId,
      }
    }
    if (pendingGroup === groupId) return { ops: [], countFrom: null, countTo: null }
    return { ops: [{ op: 'retarget', index: pending, groupId }], countFrom: pendingGroup, countTo: groupId }
  }

  const current = groupOf(started!)
  if (current === groupId) return { ops: [], countFrom: null, countTo: null }
  return {
    ops: [
      { op: 'patch', index: started!, toDay: lastDayOfMonth(today) },
      { op: 'insert', groupId, fromDay: firstOfNextMonth(today) },
    ],
    countFrom: current,
    countTo: groupId,
  }
}

/** Leave. Effective today; boards already counted stay counted (§3). */
export function planLeave<G extends string>(intervals: readonly Interval<G>[], today: PuzzleDay): MembershipPlan<G> {
  const { started, pending, groupOf } = liveOf(intervals, today)
  if (started === null && pending === null) return { refused: 'NOT_IN_LEAGUE' }
  const ops: IntervalOp<G>[] = []
  if (started !== null) ops.push({ op: 'patch', index: started, toDay: today })
  if (pending !== null) ops.push({ op: 'delete', index: pending })
  return { ops, countFrom: groupOf(pending ?? started!), countTo: null }
}
```

Also append:

```ts
/** What a player's membership looks like today, for myLeagues. Null if not a member. */
export function membershipOf<G extends string>(
  intervals: readonly Interval<G>[],
  today: PuzzleDay,
): { groupId: G; since: PuzzleDay; pendingGroupId: G | null; pendingFrom: PuzzleDay | null } | null {
  const { started, pending } = liveOf(intervals, today)
  if (started === null && pending === null) return null
  if (started === null) {
    const p = intervals[pending!]
    return { groupId: p.groupId, since: p.fromDay, pendingGroupId: null, pendingFrom: null }
  }
  const s = intervals[started]
  const p = pending === null ? null : intervals[pending]
  return { groupId: s.groupId, since: s.fromDay, pendingGroupId: p?.groupId ?? null, pendingFrom: p?.fromDay ?? null }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `TZ=UTC pnpm vitest run convex/lib/league.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates, commit green** — `feat(zic8.3): membership planning — join, switch, leave`.

---

### Task 3: Schema, access codes, client error copy

**Files:**
- Modify: `convex/schema.ts` (add six tables beside `teamChallenges`)
- Modify: `convex/access.ts:105-140` (`AccessCode` union)
- Modify: `src/lib/convex-error.ts` (the `code === …` recogniser list near line 40-70, and the `typedCodeMessage` switch near line 270-300)
- Test: `convex/leagues.test.ts` (created here with a schema smoke test)

- [ ] **Step 1: Write the failing test**

```ts
// convex/leagues.test.ts
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer } from './fixtures.ts'

/**
 * DRIVEN THROUGH ctx.db AND THE …For HANDLERS, never the public wrappers, which
 * need a Better Auth session the harness cannot mint (wordle-teams-obw).
 */
const modules = import.meta.glob('./**/*.ts')

describe('league tables', () => {
  test('accept the documents the handlers write', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const leagueId = await ctx.db.insert('leagues', {
        slug: 'starting-words',
        name: 'Starting Words',
        featured: true,
        createdAt: 0,
      })
      const groupId = await ctx.db.insert('leagueGroups', {
        leagueId,
        slug: 'crane',
        name: 'CRANE',
        order: 0,
        memberCount: 0,
      })
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId, fromDay: '2026-10-08' })
      await ctx.db.insert('leagueMemberMonth', { playerId, leagueId, groupId, year: 2026, month: 10, boards: 1, attempts: 4 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId, year: 2026, month: 10, boards: 1, attempts: 4, contributors: 1 })
      await ctx.db.insert('leagueMonthResults', {
        leagueId,
        year: 2026,
        month: 9,
        standings: [{ groupId, boards: 0, attempts: 0, average: null, contributors: 0 }],
        winnerGroupId: null,
        closedAt: 0,
      })
      expect(await ctx.db.query('leagueMonthResults').collect()).toHaveLength(1)
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `TZ=UTC pnpm vitest run convex/leagues.test.ts`
Expected: FAIL. The schema has no `leagues` table (a validation or type error naming the table).

Commit red: `test(zic8.3): league tables (red)`.

- [ ] **Step 3: Add the tables to `convex/schema.ts`** (inside `defineSchema({ … })`, after `teamChallenges`)

```ts
  // PUBLIC LEAGUES (wordle-teams-zic8.3). Spec:
  // docs/superpowers/specs/2026-10-07-public-leagues-design.md §4. Rules live in
  // lib/league.ts. Nothing here is ever shown to another player with a name
  // attached: strangers see group totals only (§3.2).
  leagues: defineTable({
    slug: v.string(),
    name: v.string(),
    // The league onboarding and the empty home card offer. Starting Words today.
    featured: v.boolean(),
    createdAt: v.number(),
  }).index('by_slug', ['slug']),

  leagueGroups: defineTable({
    leagueId: v.id('leagues'),
    slug: v.string(),
    name: v.string(),
    order: v.number(),
    // MAINTAINED at join/switch/leave from lib/league.ts's countFrom/countTo,
    // never counted on read. A pending switcher counts for their NEW group.
    memberCount: v.number(),
  }).index('by_league', ['leagueId']),

  // ONE ROW PER INTERVAL, both bounds inclusive. toDay ABSENT MEANS OPEN.
  // Switches only ever land on a month boundary, so a player is in exactly one
  // group per league per month (§4.1) — leagueMemberMonth relies on that.
  leagueMemberships: defineTable({
    playerId: v.id('players'),
    leagueId: v.id('leagues'),
    groupId: v.id('leagueGroups'),
    fromDay: v.string(),
    toDay: v.optional(v.string()),
  })
    .index('by_player_and_league', ['playerId', 'leagueId'])
    .index('by_group', ['groupId']),

  // DERIVED. Rebuilt from the player's own boards on every board write.
  leagueMemberMonth: defineTable({
    playerId: v.id('players'),
    leagueId: v.id('leagues'),
    groupId: v.id('leagueGroups'),
    year: v.number(),
    month: v.number(), // 1-12, matching teamMonthStats
    boards: v.number(),
    attempts: v.number(),
  }).index('by_player_league_year_month', ['playerId', 'leagueId', 'year', 'month']),

  // DERIVED BY DELTA from leagueMemberMonth (lib/league.ts groupDelta), so a
  // board write costs O(1) however large the group is.
  leagueGroupMonth: defineTable({
    leagueId: v.id('leagues'),
    groupId: v.id('leagueGroups'),
    year: v.number(),
    month: v.number(),
    boards: v.number(),
    attempts: v.number(),
    contributors: v.number(),
  })
    .index('by_league_year_month', ['leagueId', 'year', 'month'])
    .index('by_group_year_month', ['groupId', 'year', 'month']),

  // THE FROZEN SNAPSHOT, and authoritative for every closed month. Never
  // rewritten: a board backfilled into a closed month must not restate who won
  // (§4.1, the zic8.2 §6 reason).
  leagueMonthResults: defineTable({
    leagueId: v.id('leagues'),
    year: v.number(),
    month: v.number(),
    standings: v.array(
      v.object({
        groupId: v.id('leagueGroups'),
        boards: v.number(),
        attempts: v.number(),
        average: v.union(v.number(), v.null()),
        contributors: v.number(),
      }),
    ),
    winnerGroupId: v.union(v.id('leagueGroups'), v.null()),
    closedAt: v.number(),
  }).index('by_league_year_month', ['leagueId', 'year', 'month']),
```

- [ ] **Step 4: Extend `AccessCode`** in `convex/access.ts`, after `| 'CHALLENGE_NO_ACCEPTER'`:

```ts
  | 'LEAGUES_DISABLED'
  | 'UNKNOWN_LEAGUE'
  | 'UNKNOWN_GROUP'
  | 'ALREADY_IN_LEAGUE'
  | 'NOT_IN_LEAGUE'
```

- [ ] **Step 5: Teach the client the codes** in `src/lib/convex-error.ts`. In the recogniser, after `code === 'CHALLENGE_NO_ACCEPTER'`:

```ts
    code === 'CHALLENGE_NO_ACCEPTER' ||
    code === 'LEAGUES_DISABLED' ||
    code === 'UNKNOWN_LEAGUE' ||
    code === 'UNKNOWN_GROUP' ||
    code === 'ALREADY_IN_LEAGUE' ||
    code === 'NOT_IN_LEAGUE'
```

and in the `typedCodeMessage` switch, after the `CHALLENGE_NO_ACCEPTER` case:

```ts
    case 'LEAGUES_DISABLED':
      // The LEAGUES_ENABLED deployment switch is off.
      return "Leagues aren't available yet."
    case 'UNKNOWN_LEAGUE':
      return "That league doesn't exist."
    case 'UNKNOWN_GROUP':
      return "That group isn't part of this league."
    case 'ALREADY_IN_LEAGUE':
      // joinGroup while already in. Points at the control that does work.
      return "You're already in this league. Use Switch group to change."
    case 'NOT_IN_LEAGUE':
      return "You're not in this league."
```

If the file has an exhaustiveness test over `AccessCode` (look for a test asserting every code has copy — `rg -n "AccessCode" src/lib/*.test.ts`), it now passes. If it lists codes literally, add the five there too.

- [ ] **Step 6: Run to verify it passes**

Run: `TZ=UTC pnpm vitest run convex/leagues.test.ts src/lib/convex-error.test.ts`
Expected: PASS.

- [ ] **Step 7: Gates, commit green** — `feat(zic8.3): league tables and refusal codes`.

---
### Task 4: Seeding and the read side — `seedLeague`, `leagues`, `standings`

**Files:**
- Create: `convex/leagues.ts`
- Test: `convex/leagues.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `convex/leagues.test.ts`; extend the imports)

```ts
import { seedLeagueFor, standingsFor, leaguesFor, STARTING_WORDS } from './leagues.ts'
import type { DataModel, Id } from './_generated/dataModel'
import type { GenericDatabaseWriter } from 'convex/server'

type Ctx = { db: GenericDatabaseWriter<DataModel> }

/** Seeds Starting Words and returns its id and its groups by slug. */
async function seedStartingWords(ctx: Ctx, createdAt = 0) {
  const leagueId = await seedLeagueFor(ctx, STARTING_WORDS, createdAt)
  const groups = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', leagueId)).collect()
  const bySlug = Object.fromEntries(groups.map((g) => [g.slug, g._id])) as Record<string, Id<'leagueGroups'>>
  return { leagueId, group: bySlug }
}

describe('seedLeagueFor', () => {
  test('creates Starting Words with its five groups in order', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      const groups = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', leagueId)).collect()
      expect(groups.sort((a, b) => a.order - b.order).map((g) => g.name)).toEqual(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'])
      expect(groups.every((g) => g.memberCount === 0)).toBe(true)
    })
  })
  test('is idempotent: a second run adds nothing and keeps createdAt', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const first = await seedLeagueFor(ctx, STARTING_WORDS, 100)
      const second = await seedLeagueFor(ctx, STARTING_WORDS, 999)
      expect(second).toBe(first)
      expect(await ctx.db.query('leagues').collect()).toHaveLength(1)
      expect(await ctx.db.query('leagueGroups').collect()).toHaveLength(5)
      expect((await ctx.db.get(first))!.createdAt).toBe(100)
    })
  })
})

describe('standingsFor', () => {
  test('null for an unknown slug', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      expect(await standingsFor(ctx, 'nope', '2026-10-07')).toBeNull()
    })
  })
  test('every group appears, zero-filled, unranked below the floor', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 10, boards: 10, attempts: 38, contributors: 2 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 10, boards: 6, attempts: 24, contributors: 1 })
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      expect(out.month).toBe('2026-10')
      expect(out.standings.map((s) => [s.groupId, s.rank, s.average, s.boards])).toEqual([
        [group.crane, 1, 3.8, 10],
        [group.slate, null, null, 6],
        [group.adieu, null, null, 0],
        [group.stare, null, null, 0],
        [group.orate, null, null, 0],
      ])
      expect(out.lastMonth).toBeNull()
    })
  })
  test('last month and the all-time tally come from snapshots, never live rows', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 8, standings: [], winnerGroupId: group.crane, closedAt: 0 })
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 9, standings: [], winnerGroupId: group.crane, closedAt: 0 })
      // A live September row that disagrees must be ignored.
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 9, boards: 50, attempts: 100, contributors: 3 })
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      expect(out.lastMonth).toEqual({ month: '2026-09', winnerGroupId: group.crane })
      expect(out.monthsWon.find((m) => m.groupId === group.crane)?.count).toBe(2)
      expect(out.monthsWon.find((m) => m.groupId === group.slate)?.count).toBe(0)
    })
  })
})

describe('leaguesFor', () => {
  test('lists leagues with their groups', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedStartingWords(ctx)
      const out = await leaguesFor(ctx)
      expect(out).toHaveLength(1)
      expect(out[0]).toMatchObject({ slug: 'starting-words', name: 'Starting Words', featured: true })
      expect(out[0].groups.map((g) => g.name)).toEqual(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'])
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `TZ=UTC pnpm vitest run convex/leagues.test.ts`
Expected: FAIL, `Failed to resolve import "./leagues.ts"`. Commit red: `test(zic8.3): seed and standings (red)`.

- [ ] **Step 3: Implement** — create `convex/leagues.ts`

```ts
import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'
import { accessError, requirePlausibleToday, requirePlayer } from './access.ts'
import { addMonths, monthOf } from './lib/puzzleDay.ts'
import { leaguesEnabled, standingsOf } from './lib/league.ts'
import type { PuzzleDay, PuzzleMonth } from './lib/puzzleDay.ts'
import type { Standing } from './lib/league.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server'

/**
 * PUBLIC LEAGUES (wordle-teams-zic8.3). Spec:
 * docs/superpowers/specs/2026-10-07-public-leagues-design.md.
 *
 * THIN BY DESIGN. Every rule is in lib/league.ts. The …For handlers read and
 * write; the public wrappers check LEAGUES_ENABLED and supply a player id —
 * nothing else, because a wrapper is code no test can reach (wordle-teams-obw).
 *
 * NO NAME EVER LEAVES THIS FILE. Strangers see group totals only (§3.2): no
 * function here returns a player's name, email or id belonging to anyone but
 * the caller.
 */

type WriterCtx = { db: GenericDatabaseWriter<DataModel> }
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

export type LeagueSpec = { slug: string; name: string; featured: boolean; groups: { slug: string; name: string }[] }

/** v1's one league (§1). Seeded per deployment by `seedLeague`. */
export const STARTING_WORDS: LeagueSpec = {
  slug: 'starting-words',
  name: 'Starting Words',
  featured: true,
  groups: ['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'].map((name) => ({ slug: name.toLowerCase(), name })),
}

const LEAGUE_SPECS: Record<string, LeagueSpec> = { [STARTING_WORDS.slug]: STARTING_WORDS }

/** 'YYYY-MM' as the two numbers the month tables store (1-12). */
export function yearMonthOf(month: PuzzleMonth): { year: number; month: number } {
  const [year, m] = month.split('-').map(Number)
  return { year, month: m }
}

/**
 * Create or update a league and its groups, matched by slug. IDEMPOTENT: a
 * re-run renames and reorders but never duplicates, and never moves createdAt
 * (monthToClose reads it, so moving it would skip or invent a close).
 */
export async function seedLeagueFor(ctx: WriterCtx, spec: LeagueSpec, now: number): Promise<Id<'leagues'>> {
  const found = await ctx.db.query('leagues').withIndex('by_slug', (q) => q.eq('slug', spec.slug)).unique()
  const leagueId =
    found?._id ??
    (await ctx.db.insert('leagues', { slug: spec.slug, name: spec.name, featured: spec.featured, createdAt: now }))
  if (found) await ctx.db.patch(found._id, { name: spec.name, featured: spec.featured })

  const existing = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', leagueId)).collect()
  for (const [order, group] of spec.groups.entries()) {
    const row = existing.find((e) => e.slug === group.slug)
    if (row) await ctx.db.patch(row._id, { name: group.name, order })
    else await ctx.db.insert('leagueGroups', { leagueId, slug: group.slug, name: group.name, order, memberCount: 0 })
  }
  return leagueId
}

/** Run once per deployment: `pnpm exec convex run leagues:seedLeague '{"slug":"starting-words"}'`. */
export const seedLeague = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const spec = LEAGUE_SPECS[slug]
    if (!spec) throw accessError('UNKNOWN_LEAGUE')
    return await seedLeagueFor(ctx, spec, Date.now())
  },
})

export async function groupsOf(ctx: ReaderCtx, leagueId: Id<'leagues'>): Promise<Doc<'leagueGroups'>[]> {
  const groups = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', leagueId)).collect()
  return groups.sort((a, b) => a.order - b.order)
}

/** The live month's standings for one league: one range read, zero-filled. */
export async function currentStandings(
  ctx: ReaderCtx,
  leagueId: Id<'leagues'>,
  groups: Doc<'leagueGroups'>[],
  month: PuzzleMonth,
): Promise<Standing<Id<'leagueGroups'>>[]> {
  const { year, month: m } = yearMonthOf(month)
  const rows = await ctx.db
    .query('leagueGroupMonth')
    .withIndex('by_league_year_month', (q) => q.eq('leagueId', leagueId).eq('year', year).eq('month', m))
    .collect()
  return standingsOf(
    groups.map((g) => {
      const row = rows.find((r) => r.groupId === g._id)
      return {
        groupId: g._id,
        order: g.order,
        boards: row?.boards ?? 0,
        attempts: row?.attempts ?? 0,
        contributors: row?.contributors ?? 0,
      }
    }),
  )
}

export async function leaguesFor(ctx: ReaderCtx) {
  const leagues = await ctx.db.query('leagues').collect()
  return await Promise.all(
    leagues.map(async (league) => ({
      slug: league.slug,
      name: league.name,
      featured: league.featured,
      groups: (await groupsOf(ctx, league._id)).map((g) => ({ _id: g._id, slug: g.slug, name: g.name, memberCount: g.memberCount })),
    })),
  )
}

/**
 * The standings page. CLOSED MONTHS COME FROM leagueMonthResults ONLY — a live
 * row for a closed month can have been restated by backfill (§4.1).
 */
export async function standingsFor(ctx: ReaderCtx, slug: string, today: PuzzleDay) {
  const league = await ctx.db.query('leagues').withIndex('by_slug', (q) => q.eq('slug', slug)).unique()
  if (!league) return null
  const groups = await groupsOf(ctx, league._id)
  const month = monthOf(today)
  const standings = await currentStandings(ctx, league._id, groups, month)

  const results = await ctx.db
    .query('leagueMonthResults')
    .withIndex('by_league_year_month', (q) => q.eq('leagueId', league._id))
    .collect()
  const previous = addMonths(month, -1)
  const prev = yearMonthOf(previous)
  const last = results.find((r) => r.year === prev.year && r.month === prev.month)

  return {
    league: { slug: league.slug, name: league.name },
    month,
    groups: groups.map((g) => ({ _id: g._id, slug: g.slug, name: g.name, memberCount: g.memberCount })),
    standings,
    lastMonth: last ? { month: previous, winnerGroupId: last.winnerGroupId } : null,
    monthsWon: groups.map((g) => ({ groupId: g._id, count: results.filter((r) => r.winnerGroupId === g._id).length })),
  }
}

/** RETURNS rather than throws when dark, so a page never errors on a dark deployment. */
export const leagues = query({
  args: {},
  handler: async (ctx) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    await requirePlayer(ctx)
    return { enabled: true as const, leagues: await leaguesFor(ctx) }
  },
})

export const standings = query({
  args: { slug: v.string(), today: v.string() },
  handler: async (ctx, { slug, today }) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    await requirePlayer(ctx)
    return { enabled: true as const, view: await standingsFor(ctx, slug, requirePlausibleToday(today)) }
  },
})
```

- [ ] **Step 4: Run to verify it passes** — `TZ=UTC pnpm vitest run convex/leagues.test.ts`, expected PASS.

- [ ] **Step 5: Gates, commit green** — `feat(zic8.3): seed Starting Words; leagues and standings queries`.

---

### Task 5: Membership mutations — join, switch, leave

**Files:**
- Modify: `convex/leagues.ts`
- Test: `convex/leagues.test.ts`

The handlers apply a `MembershipPlan` from lib/league.ts, move `memberCount`, then call `recomputeLeagueMonthFor` for today's month. That function is a no-op stub in this task (`async () => {}`), defined so Task 6 can fill it without touching these handlers. The recompute is what keeps a same-day leave or retarget exact, even in the edge case of a board already entered for a pending day.

- [ ] **Step 1: Write the failing tests**

```ts
import { joinGroupFor, leaveLeagueFor, switchGroupFor } from './leagues.ts'
import { vi, beforeEach, afterEach } from 'vitest'

/**
 * FROZEN CLOCK: requirePlausibleToday bounds `today` to +-1 day of the server's,
 * so a literal date would start failing on its own with INVALID_DATE.
 */
const NOW = new Date('2026-10-07T12:00:00Z')
const today = '2026-10-07'

describe('membership', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p
      return null
    } catch (error) {
      return (error as { data?: { code?: string } }).data?.code ?? String(error)
    }
  }

  test('join opens an interval from tomorrow and counts the member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await joinGroupFor(ctx, playerId, { groupId: group.crane, today })
      const rows = await ctx.db.query('leagueMemberships').collect()
      expect(rows).toEqual([expect.objectContaining({ playerId, leagueId, groupId: group.crane, fromDay: '2026-10-08' })])
      expect(rows[0].toDay).toBeUndefined()
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(1)
    })
  })

  test('a second join is refused ALREADY_IN_LEAGUE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await joinGroupFor(ctx, playerId, { groupId: group.crane, today })
      expect(await codeOf(joinGroupFor(ctx, playerId, { groupId: group.slate, today }))).toBe('ALREADY_IN_LEAGUE')
      expect((await ctx.db.get(group.slate))!.memberCount).toBe(0)
    })
  })

  test('switch from a started interval closes at month end and moves the count', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await ctx.db.patch(group.crane, { memberCount: 1 })
      await switchGroupFor(ctx, playerId, { groupId: group.slate, today })
      const rows = (await ctx.db.query('leagueMemberships').collect()).sort((a, b) => a.fromDay.localeCompare(b.fromDay))
      expect(rows.map((r) => [r.groupId, r.fromDay, r.toDay])).toEqual([
        [group.crane, '2026-09-01', '2026-10-31'],
        [group.slate, '2026-11-01', undefined],
      ])
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(0)
      expect((await ctx.db.get(group.slate))!.memberCount).toBe(1)
    })
  })

  test('switching back cancels the pending switch', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await ctx.db.patch(group.crane, { memberCount: 1 })
      await switchGroupFor(ctx, playerId, { groupId: group.slate, today })
      await switchGroupFor(ctx, playerId, { groupId: group.crane, today })
      const rows = await ctx.db.query('leagueMemberships').collect()
      expect(rows.map((r) => [r.groupId, r.toDay])).toEqual([[group.crane, undefined]])
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(1)
      expect((await ctx.db.get(group.slate))!.memberCount).toBe(0)
    })
  })

  test('switch to a group from another league is refused UNKNOWN_GROUP', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const other = await seedLeagueFor(ctx, { slug: 'other', name: 'Other', featured: false, groups: [{ slug: 'x', name: 'X' }] }, 0)
      const [x] = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', other)).collect()
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      // x belongs to `other`, where this player has no membership: NOT_IN_LEAGUE.
      expect(await codeOf(switchGroupFor(ctx, playerId, { groupId: x._id, today }))).toBe('NOT_IN_LEAGUE')
    })
  })

  test('leave ends today, and a pending-only membership is deleted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const a = await ctx.db.insert('players', aPlayer({ email: 'a@example.com' }))
      const b = await ctx.db.insert('players', aPlayer({ email: 'b@example.com' }))
      await ctx.db.insert('leagueMemberships', { playerId: a, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await joinGroupFor(ctx, b, { groupId: group.crane, today })
      await ctx.db.patch(group.crane, { memberCount: 2 })
      await leaveLeagueFor(ctx, a, { leagueId, today })
      await leaveLeagueFor(ctx, b, { leagueId, today })
      const rows = await ctx.db.query('leagueMemberships').collect()
      expect(rows.map((r) => [r.playerId, r.toDay])).toEqual([[a, today]])
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(0)
    })
  })

  test('leave when not a member is refused NOT_IN_LEAGUE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await codeOf(leaveLeagueFor(ctx, playerId, { leagueId, today }))).toBe('NOT_IN_LEAGUE')
    })
  })

  test('an implausible today is refused INVALID_DATE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await codeOf(joinGroupFor(ctx, playerId, { groupId: group.crane, today: '2026-01-01' }))).toBe('INVALID_DATE')
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails** — expected FAIL (`joinGroupFor is not a function`). Commit red: `test(zic8.3): join, switch, leave (red)`.

- [ ] **Step 3: Implement** (append to `convex/leagues.ts`; add `mutation` to the server import and `planJoin, planLeave, planSwitch, type MembershipPlan` to the lib import)

```ts
type GroupId = Id<'leagueGroups'>

/** One player's intervals for one league, OLDEST FIRST — plan indexes refer to this order. */
async function intervalsOf(ctx: ReaderCtx, playerId: Id<'players'>, leagueId: Id<'leagues'>) {
  const rows = await ctx.db
    .query('leagueMemberships')
    .withIndex('by_player_and_league', (q) => q.eq('playerId', playerId).eq('leagueId', leagueId))
    .collect()
  return rows.sort((a, b) => a.fromDay.localeCompare(b.fromDay))
}

async function bumpCount(ctx: WriterCtx, groupId: GroupId | null, by: 1 | -1) {
  if (groupId === null) return
  const group = await ctx.db.get(groupId)
  if (group) await ctx.db.patch(groupId, { memberCount: Math.max(0, group.memberCount + by) })
}

/** Apply a plan's ops IN ORDER against `rows`, then move memberCount. */
async function applyPlan(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  leagueId: Id<'leagues'>,
  rows: Doc<'leagueMemberships'>[],
  plan: MembershipPlan<GroupId>,
) {
  if ('refused' in plan) accessError(plan.refused)
  for (const op of plan.ops) {
    if (op.op === 'insert') await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: op.groupId, fromDay: op.fromDay })
    else if (op.op === 'patch') await ctx.db.patch(rows[op.index]._id, { toDay: op.toDay })
    else if (op.op === 'reopen') await ctx.db.patch(rows[op.index]._id, { toDay: undefined })
    else if (op.op === 'retarget') await ctx.db.patch(rows[op.index]._id, { groupId: op.groupId })
    else await ctx.db.delete(rows[op.index]._id)
  }
  await bumpCount(ctx, plan.countFrom, -1)
  await bumpCount(ctx, plan.countTo, 1)
}

async function requireGroup(ctx: ReaderCtx, groupId: GroupId) {
  const group = await ctx.db.get(groupId)
  if (!group) accessError('UNKNOWN_GROUP')
  return group
}

export async function joinGroupFor(ctx: WriterCtx, playerId: Id<'players'>, args: { groupId: GroupId; today: string }) {
  const today = requirePlausibleToday(args.today)
  const group = await requireGroup(ctx, args.groupId)
  const rows = await intervalsOf(ctx, playerId, group.leagueId)
  await applyPlan(ctx, playerId, group.leagueId, rows, planJoin(rows, today, group._id))
  await recomputeLeagueMonthFor(ctx, playerId, monthOf(today))
}

export async function switchGroupFor(ctx: WriterCtx, playerId: Id<'players'>, args: { groupId: GroupId; today: string }) {
  const today = requirePlausibleToday(args.today)
  const group = await requireGroup(ctx, args.groupId)
  const rows = await intervalsOf(ctx, playerId, group.leagueId)
  await applyPlan(ctx, playerId, group.leagueId, rows, planSwitch(rows, today, group._id))
  await recomputeLeagueMonthFor(ctx, playerId, monthOf(today))
}

export async function leaveLeagueFor(ctx: WriterCtx, playerId: Id<'players'>, args: { leagueId: Id<'leagues'>; today: string }) {
  const today = requirePlausibleToday(args.today)
  if (!(await ctx.db.get(args.leagueId))) accessError('UNKNOWN_LEAGUE')
  const rows = await intervalsOf(ctx, playerId, args.leagueId)
  await applyPlan(ctx, playerId, args.leagueId, rows, planLeave(rows, today))
  await recomputeLeagueMonthFor(ctx, playerId, monthOf(today))
}

/** Filled in by Task 6. */
export async function recomputeLeagueMonthFor(_ctx: WriterCtx, _playerId: Id<'players'>, _month: PuzzleMonth): Promise<void> {}

const gate = () => {
  if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) accessError('LEAGUES_DISABLED')
}

export const joinGroup = mutation({
  args: { groupId: v.id('leagueGroups'), today: v.string() },
  handler: async (ctx, args) => {
    gate()
    const player = await requirePlayer(ctx)
    await joinGroupFor(ctx, player._id, args)
  },
})

export const switchGroup = mutation({
  args: { groupId: v.id('leagueGroups'), today: v.string() },
  handler: async (ctx, args) => {
    gate()
    const player = await requirePlayer(ctx)
    await switchGroupFor(ctx, player._id, args)
  },
})

export const leaveLeague = mutation({
  args: { leagueId: v.id('leagues'), today: v.string() },
  handler: async (ctx, args) => {
    gate()
    const player = await requirePlayer(ctx)
    await leaveLeagueFor(ctx, player._id, args)
  },
})
```

- [ ] **Step 4: Run to verify it passes** — expected PASS.
- [ ] **Step 5: Gates, commit green** — `feat(zic8.3): join, switch and leave a league group`.

---

### Task 6: The write path — `recomputeLeagueMonthFor`, hooked into board writes

**Files:**
- Modify: `convex/leagues.ts` (replace the Task 5 stub)
- Modify: `convex/scores.ts:689` (after `recomputePlayerMonth`)
- Test: `convex/leagues.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { recomputeLeagueMonthFor } from './leagues.ts'
import { upsertBoardFor } from './scores.ts'

/** A solved board in `n` guesses on `day`. */
async function board(ctx: Ctx, playerId: Id<'players'>, day: string, n: number) {
  const guesses = [...Array(n - 1).fill('wrong'), 'crane']
  await ctx.db.insert('dailyScores', { playerId, puzzleDay: day, date: 0, answer: 'crane', guesses })
}

/** INVARIANT: every group-month row equals the sum of its member rows. */
async function expectGroupRowsAreSums(ctx: Ctx) {
  const members = await ctx.db.query('leagueMemberMonth').collect()
  for (const row of await ctx.db.query('leagueGroupMonth').collect()) {
    const mine = members.filter((m) => m.groupId === row.groupId && m.year === row.year && m.month === row.month)
    expect({ boards: row.boards, attempts: row.attempts, contributors: row.contributors }).toEqual({
      boards: mine.reduce((s, m) => s + m.boards, 0),
      attempts: mine.reduce((s, m) => s + m.attempts, 0),
      contributors: mine.length,
    })
  }
}

describe('recomputeLeagueMonthFor', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  test('a non-member costs nothing and writes nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await board(ctx, playerId, '2026-10-05', 3)
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      expect(await ctx.db.query('leagueMemberMonth').collect()).toEqual([])
      expect(await ctx.db.query('leagueGroupMonth').collect()).toEqual([])
    })
  })

  test('only boards inside the interval count, and the group row follows', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-10-03' })
      await board(ctx, playerId, '2026-10-02', 2) // before joining: never counts
      await board(ctx, playerId, '2026-10-03', 4)
      await board(ctx, playerId, '2026-10-05', 3)
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      const [row] = await ctx.db.query('leagueGroupMonth').collect()
      expect(row).toMatchObject({ groupId: group.crane, year: 2026, month: 10, boards: 2, attempts: 7, contributors: 1 })
      await expectGroupRowsAreSums(ctx)
    })
  })

  test('two members, edits and a delete keep the invariant', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const a = await ctx.db.insert('players', aPlayer({ email: 'a@example.com' }))
      const b = await ctx.db.insert('players', aPlayer({ email: 'b@example.com' }))
      for (const p of [a, b]) await ctx.db.insert('leagueMemberships', { playerId: p, leagueId, groupId: group.crane, fromDay: '2026-10-01' })
      await board(ctx, a, '2026-10-02', 3)
      await board(ctx, b, '2026-10-02', 5)
      await recomputeLeagueMonthFor(ctx, a, '2026-10')
      await recomputeLeagueMonthFor(ctx, b, '2026-10')
      await expectGroupRowsAreSums(ctx)

      const [aBoard] = await ctx.db.query('dailyScores').withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', a)).collect()
      await ctx.db.patch(aBoard._id, { guesses: ['wrong', 'crane'] })
      await recomputeLeagueMonthFor(ctx, a, '2026-10')
      await expectGroupRowsAreSums(ctx)

      await ctx.db.delete(aBoard._id)
      await recomputeLeagueMonthFor(ctx, a, '2026-10')
      await expectGroupRowsAreSums(ctx)
      const [row] = await ctx.db.query('leagueGroupMonth').collect()
      expect(row).toMatchObject({ boards: 1, attempts: 5, contributors: 1 })
    })
  })

  test('a failed board counts as 7', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-10-01' })
      await ctx.db.insert('dailyScores', { playerId, puzzleDay: '2026-10-02', date: 0, answer: 'crane', guesses: Array(6).fill('wrong') })
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      expect((await ctx.db.query('leagueMemberMonth').collect())[0]).toMatchObject({ boards: 1, attempts: 7 })
    })
  })

  test('upsertBoardFor drives it: a member submitting a board moves their group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.slate, fromDay: '2026-10-01' })
      await upsertBoardFor(ctx, playerId, {
        puzzleDay: today,
        answer: 'crane',
        guesses: ['slate', 'crane', '', '', '', ''],
        today,
      })
      expect((await ctx.db.query('leagueGroupMonth').collect())[0]).toMatchObject({ groupId: group.slate, boards: 1, attempts: 2 })
    })
  })
})
```

Before writing the last test, check `upsertBoardFor`'s exact signature: `rg -n "export async function upsertBoardFor" -A6 convex/scores.ts`. Adapt the argument object to it, and keep the assertion.

- [ ] **Step 2: Run to verify it fails** — the stub writes nothing, so FAIL on the row assertions. Commit red: `test(zic8.3): league write path (red)`.

- [ ] **Step 3: Implement.** Replace the stub in `convex/leagues.ts` (add `attemptsFor` from `./lib/board.ts`, `monthRange` from `./lib/puzzleDay.ts`, and `groupDelta, memberTotalsFor` from `./lib/league.ts`):

```ts
/**
 * Rebuild ONE player's league rows for ONE month from their own boards, and
 * move each group row by the difference. Called on every board write
 * (scores.ts) and after every membership change.
 *
 * COST: for a player in no league, two index reads and nothing else — which is
 * almost everyone. For a member, their month's boards plus one group row per
 * league. Never O(group size): the group row moves by delta (§7).
 *
 * WRITES NOTHING WHEN NOTHING CHANGED, so a board edit that does not move the
 * totals does not invalidate every standings subscription.
 */
export async function recomputeLeagueMonthFor(ctx: WriterCtx, playerId: Id<'players'>, month: PuzzleMonth): Promise<void> {
  const memberships = await ctx.db
    .query('leagueMemberships')
    .withIndex('by_player_and_league', (q) => q.eq('playerId', playerId))
    .collect()
  const { year, month: m } = yearMonthOf(month)
  const existing = (
    await ctx.db
      .query('leagueMemberMonth')
      .withIndex('by_player_league_year_month', (q) => q.eq('playerId', playerId))
      .collect()
  ).filter((r) => r.year === year && r.month === m)
  const leagueIds = new Set([...memberships.map((r) => r.leagueId), ...existing.map((r) => r.leagueId)])
  if (leagueIds.size === 0) return

  const { start, end } = monthRange(month)
  const boards = (
    await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', playerId).gte('puzzleDay', start).lte('puzzleDay', end))
      .collect()
  ).map((b) => ({ puzzleDay: b.puzzleDay, attempts: attemptsFor(b.guesses, b.answer ?? '') }))

  for (const leagueId of leagueIds) {
    const after = memberTotalsFor(boards, memberships.filter((r) => r.leagueId === leagueId), month)
    const before = existing.find((r) => r.leagueId === leagueId) ?? null
    if (before && after && before.groupId === after.groupId && before.boards === after.boards && before.attempts === after.attempts) continue

    if (before && after && before.groupId === after.groupId) {
      await moveGroup(ctx, leagueId, after.groupId, year, m, groupDelta(before, after))
    } else {
      if (before) await moveGroup(ctx, leagueId, before.groupId, year, m, groupDelta(before, null))
      if (after) await moveGroup(ctx, leagueId, after.groupId, year, m, groupDelta(null, after))
    }

    if (before && after) await ctx.db.patch(before._id, { groupId: after.groupId, boards: after.boards, attempts: after.attempts })
    else if (after) await ctx.db.insert('leagueMemberMonth', { playerId, leagueId, groupId: after.groupId, year, month: m, boards: after.boards, attempts: after.attempts })
    else if (before) await ctx.db.delete(before._id)
  }
}

/** Add a delta to one group-month row, creating it on first contribution. */
export async function moveGroup(
  ctx: WriterCtx,
  leagueId: Id<'leagues'>,
  groupId: GroupId,
  year: number,
  month: number,
  d: { boards: number; attempts: number; contributors: number },
) {
  if (d.boards === 0 && d.attempts === 0 && d.contributors === 0) return
  const row = await ctx.db
    .query('leagueGroupMonth')
    .withIndex('by_group_year_month', (q) => q.eq('groupId', groupId).eq('year', year).eq('month', month))
    .unique()
  if (row) {
    await ctx.db.patch(row._id, { boards: row.boards + d.boards, attempts: row.attempts + d.attempts, contributors: row.contributors + d.contributors })
  } else {
    await ctx.db.insert('leagueGroupMonth', { leagueId, groupId, year, month, ...d })
  }
}
```

Then in `convex/scores.ts`, import `recomputeLeagueMonthFor` from `./leagues.ts` and add it directly under the existing call:

```ts
  await recomputePlayerMonth(ctx, playerId, monthOf(puzzleDay), today)
  // PUBLIC LEAGUES (zic8.3): every board counts for the player's group too. NOT
  // gated on LEAGUES_ENABLED — the aggregate must already be right on the day
  // the flag flips, and for a non-member this is two index reads.
  await recomputeLeagueMonthFor(ctx, playerId, monthOf(puzzleDay))
```

- [ ] **Step 4: Run** `TZ=UTC pnpm vitest run convex/leagues.test.ts convex/scores.test.ts`, expected PASS.
- [ ] **Step 5: Mutation-check the delta.** Temporarily change `groupDelta(before, after)` to `groupDelta(null, after)` in `recomputeLeagueMonthFor`, run `convex/leagues.test.ts`, and confirm the invariant test FAILS. Revert the change.
- [ ] **Step 6: Gates, commit green** — `feat(zic8.3): league standings follow every board write`.

---

### Task 7: Month close — snapshot job and sweep scheduling

**Files:**
- Modify: `convex/leagues.ts`
- Modify: `convex/teamStats.ts` (`sweep`, after the challenges close)
- Test: `convex/leagues.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { closeLeagueMonthFor, scheduleLeagueClosesFor } from './leagues.ts'

describe('closing a month', () => {
  test('writes a snapshot with standings and the winner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 9, boards: 12, attempts: 42, contributors: 2 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 9, boards: 10, attempts: 40, contributors: 1 })
      expect(await closeLeagueMonthFor(ctx, leagueId, '2026-09')).toBe(true)
      const [result] = await ctx.db.query('leagueMonthResults').collect()
      expect(result.winnerGroupId).toBe(group.slate) // 3.5 beats 4.0
      expect(result.standings).toHaveLength(5)
      expect(result.standings[0]).toEqual({ groupId: group.slate, boards: 12, attempts: 42, average: 3.5, contributors: 2 })
    })
  })

  test('is idempotent: a second close changes nothing, even after backfill', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const rowId = await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 9, boards: 10, attempts: 40, contributors: 1 })
      await closeLeagueMonthFor(ctx, leagueId, '2026-09')
      await ctx.db.patch(rowId, { boards: 30, attempts: 31 })
      expect(await closeLeagueMonthFor(ctx, leagueId, '2026-09')).toBe(false)
      const results = await ctx.db.query('leagueMonthResults').collect()
      expect(results).toHaveLength(1)
      expect(results[0].standings[0]).toMatchObject({ boards: 10, attempts: 40 })
    })
  })

  test('no qualifying group snapshots winnerGroupId null', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      await closeLeagueMonthFor(ctx, leagueId, '2026-09')
      expect((await ctx.db.query('leagueMonthResults').collect())[0].winnerGroupId).toBeNull()
    })
  })
})

describe('scheduleLeagueClosesFor', () => {
  const seededIn = Date.parse('2026-08-15T12:00:00Z')
  test('nothing on day 1', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedLeagueFor(ctx, STARTING_WORDS, seededIn)
      expect(await scheduleLeagueClosesFor(ctx, '2026-10-01')).toBe(0)
    })
  })
  test('day 2 schedules last month once; an existing snapshot schedules nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const leagueId = await seedLeagueFor(ctx, STARTING_WORDS, seededIn)
      expect(await scheduleLeagueClosesFor(ctx, '2026-10-02')).toBe(1)
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 9, standings: [], winnerGroupId: null, closedAt: 0 })
      expect(await scheduleLeagueClosesFor(ctx, '2026-10-03')).toBe(0)
    })
  })
  test('never the month before the league existed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedLeagueFor(ctx, STARTING_WORDS, Date.parse('2026-10-01T12:00:00Z'))
      expect(await scheduleLeagueClosesFor(ctx, '2026-10-02')).toBe(0)
    })
  })
  test('the sweep runs it, and the scheduled job writes the snapshot', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-02T00:45:00Z') })
    try {
      const t = convexTest(schema, modules)
      await t.run((ctx) => seedLeagueFor(ctx, STARTING_WORDS, seededIn))
      await t.mutation(internal.teamStats.sweep, {})
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      const results = await t.run((ctx) => ctx.db.query('leagueMonthResults').collect())
      expect(results.map((r) => [r.year, r.month])).toEqual([[2026, 9]])
    } finally {
      vi.useRealTimers()
    }
  })
})
```

(Add `import { internal } from './_generated/api'` to the test imports. If `SWEEPS_ENABLED` must be set for the sweep in tests, follow the existing `convex/challenges.test.ts` 'teamStats.sweep closes due challenges' test. It leaves the variable unset, because `sweepsEnabled` fails towards ON.)

- [ ] **Step 2: Run to verify it fails.** Commit red: `test(zic8.3): month close and its scheduling (red)`.

- [ ] **Step 3: Implement** (append to `convex/leagues.ts`; add `internalMutation` and `monthToClose, winnerOf` imports, `toPuzzleDay` from puzzleDay, `internal` from `./_generated/api`, and `import type { SchedulingCtx } from './winners.ts'`)

```ts
/**
 * Freeze one league-month. IDEMPOTENT: a snapshot that exists is never
 * rewritten, so a retried or duplicated job cannot restate who won, and a board
 * backfilled after close changes the live rows but never this.
 */
export async function closeLeagueMonthFor(ctx: WriterCtx, leagueId: Id<'leagues'>, month: PuzzleMonth): Promise<boolean> {
  const { year, month: m } = yearMonthOf(month)
  const existing = await ctx.db
    .query('leagueMonthResults')
    .withIndex('by_league_year_month', (q) => q.eq('leagueId', leagueId).eq('year', year).eq('month', m))
    .unique()
  if (existing) return false
  if (!(await ctx.db.get(leagueId))) return false

  const standings = await currentStandings(ctx, leagueId, await groupsOf(ctx, leagueId), month)
  await ctx.db.insert('leagueMonthResults', {
    leagueId,
    year,
    month: m,
    standings: standings.map(({ groupId, boards, attempts, average, contributors }) => ({ groupId, boards, attempts, average, contributors })),
    winnerGroupId: winnerOf(standings),
    closedAt: Date.now(),
  })
  return true
}

/**
 * Called by teamStats.sweep. SCHEDULES, never closes inline (zic8.2's D5): a
 * close that throws fails its own job and cannot roll the sweep back. Returns
 * how many jobs it queued.
 */
export async function scheduleLeagueClosesFor(ctx: SchedulingCtx, today: PuzzleDay): Promise<number> {
  let queued = 0
  for (const league of await ctx.db.query('leagues').collect()) {
    const month = monthToClose(today, toPuzzleDay(new Date(league.createdAt)))
    if (!month) continue
    const { year, month: m } = yearMonthOf(month)
    const done = await ctx.db
      .query('leagueMonthResults')
      .withIndex('by_league_year_month', (q) => q.eq('leagueId', league._id).eq('year', year).eq('month', m))
      .unique()
    if (done) continue
    await ctx.scheduler.runAfter(0, internal.leagues.closeLeagueMonth, { leagueId: league._id, month })
    queued += 1
  }
  return queued
}

/** NOT gated on LEAGUES_ENABLED: switching the feature off must not leave a played month unclosed. */
export const closeLeagueMonth = internalMutation({
  args: { leagueId: v.id('leagues'), month: v.string() },
  handler: async (ctx, { leagueId, month }) => {
    try {
      await closeLeagueMonthFor(ctx, leagueId, month)
    } catch (error) {
      console.error(`leagues.closeLeagueMonth: ${leagueId} ${month} did not close`)
      throw error
    }
  },
})
```

In `convex/teamStats.ts`, import `scheduleLeagueClosesFor` from `./leagues.ts`. In `sweep`, after `const challenges = await closeDueChallengesFor(...)`:

```ts
    // LEAGUE MONTHS CLOSE ON THIS SWEEP TOO (zic8.3, spec §9), from day 2, one
    // scheduled job per league. Gated on SWEEPS_ENABLED (above) only.
    const leagueCloses = await scheduleLeagueClosesFor(ctx, toPuzzleDay(new Date()))
    return { teams: teams.length, month, challenges, leagueCloses }
```

(Replace the existing `return`. If a test asserts the sweep's return shape exactly — `rg -n "teamStats.sweep" convex/*.test.ts` — add `leagueCloses: 0` there.)

- [ ] **Step 4: Run** `TZ=UTC pnpm vitest run convex/leagues.test.ts convex/teamStats.test.ts convex/challenges.test.ts convex/crons.test.ts convex/lib/sweeps.test.ts`, expected PASS.
- [ ] **Step 5: Mutation-check idempotency.** Delete the `if (existing) return false` line, confirm the idempotency test FAILS, then revert.
- [ ] **Step 6: Gates, commit green** — `feat(zic8.3): close league months on the daily sweep`.

---

### Task 8: `myLeagues`, `myContribution`, and the onboarding fact

**Files:**
- Modify: `convex/leagues.ts`
- Modify: `convex/onboarding.ts` (`getStatus`)
- Test: `convex/leagues.test.ts`, `convex/onboarding.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { myContributionFor, myLeaguesFor } from './leagues.ts'

describe('myLeaguesFor', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  test('empty for a non-member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await myLeaguesFor(ctx, playerId, today)).toEqual([])
    })
  })

  test('group, rank, average and a pending switch', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01', toDay: '2026-10-31' })
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.slate, fromDay: '2026-11-01' })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 10, boards: 10, attempts: 38, contributors: 3 })
      expect(await myLeaguesFor(ctx, playerId, today)).toEqual([
        {
          league: { slug: 'starting-words', name: 'Starting Words' },
          leagueId,
          group: { _id: group.crane, name: 'CRANE' },
          since: '2026-09-01',
          pending: { group: { _id: group.slate, name: 'SLATE' }, from: '2026-11-01' },
          rank: 1,
          average: 3.8,
          boards: 10,
        },
      ])
    })
  })
})

describe('myContributionFor', () => {
  test('mine, group, and the shift', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberMonth', { playerId, leagueId, groupId: group.crane, year: 2026, month: 10, boards: 4, attempts: 10 })
      // 14 boards with the member, exactly 10 without: both sides clear MIN_LEAGUE_BOARDS.
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 10, boards: 14, attempts: 56, contributors: 2 })
      expect(await myContributionFor(ctx, playerId, 'starting-words', today)).toEqual({ mine: 2.5, group: 4, shift: -0.6 })
    })
  })
  test('null with no boards this month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await myContributionFor(ctx, playerId, 'starting-words', today)).toBeNull()
    })
  })
})
```

In `convex/onboarding.test.ts`, find the existing `toEqual({ enteredBoard: …, dismissed: … })` at about line 29 and add `inLeague: true` to the expected object. `LEAGUES_ENABLED` is unset there, and a dark deployment reports in-league so the step never offers something that would refuse. Then add two tests under `vi.stubEnv('LEAGUES_ENABLED', 'true')` (with `vi.unstubAllEnvs()` after): a fresh player gets `inLeague: false`, and a player with a `leagueMemberships` row gets `inLeague: true`. Copy that file's setup for the authed `as` client and insert the league rows with `t.run`.

- [ ] **Step 2: Run to verify it fails.** Commit red: `test(zic8.3): my leagues, my contribution, inLeague (red)`.

- [ ] **Step 3: Implement** (append to `convex/leagues.ts`; import `contributionOf, membershipOf` from lib and `isProFor` from access)

```ts
/** The home card and the standings header: one row per league the caller is in. */
export async function myLeaguesFor(ctx: ReaderCtx, playerId: Id<'players'>, today: PuzzleDay) {
  const rows = await ctx.db
    .query('leagueMemberships')
    .withIndex('by_player_and_league', (q) => q.eq('playerId', playerId))
    .collect()
  const out = []
  for (const leagueId of new Set(rows.map((r) => r.leagueId))) {
    const intervals = rows.filter((r) => r.leagueId === leagueId).sort((a, b) => a.fromDay.localeCompare(b.fromDay))
    const membership = membershipOf(intervals, today)
    const league = await ctx.db.get(leagueId)
    if (!membership || !league) continue
    const groups = await groupsOf(ctx, leagueId)
    const nameOf = (id: GroupId) => ({ _id: id, name: groups.find((g) => g._id === id)?.name ?? '' })
    const standing = (await currentStandings(ctx, leagueId, groups, monthOf(today))).find((s) => s.groupId === membership.groupId)
    out.push({
      league: { slug: league.slug, name: league.name },
      leagueId,
      group: nameOf(membership.groupId),
      since: membership.since,
      pending: membership.pendingGroupId ? { group: nameOf(membership.pendingGroupId), from: membership.pendingFrom! } : null,
      rank: standing?.rank ?? null,
      average: standing?.average ?? null,
      boards: standing?.boards ?? 0,
    })
  }
  return out
}

/** Pro view: the caller's month against their group's. Null if they have no boards counted this month. */
export async function myContributionFor(ctx: ReaderCtx, playerId: Id<'players'>, slug: string, today: PuzzleDay) {
  const league = await ctx.db.query('leagues').withIndex('by_slug', (q) => q.eq('slug', slug)).unique()
  if (!league) return null
  const { year, month } = yearMonthOf(monthOf(today))
  const mine = await ctx.db
    .query('leagueMemberMonth')
    .withIndex('by_player_league_year_month', (q) => q.eq('playerId', playerId).eq('leagueId', league._id).eq('year', year).eq('month', month))
    .unique()
  if (!mine) return null
  const group = await ctx.db
    .query('leagueGroupMonth')
    .withIndex('by_group_year_month', (q) => q.eq('groupId', mine.groupId).eq('year', year).eq('month', month))
    .unique()
  return contributionOf(mine, group ?? mine)
}

export const myLeagues = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    const player = await requirePlayer(ctx)
    return { enabled: true as const, leagues: await myLeaguesFor(ctx, player._id, requirePlausibleToday(today)) }
  },
})

/** Free callers get `locked: true` rather than an error, so the page can render the teaser. */
export const myContribution = query({
  args: { slug: v.string(), today: v.string() },
  handler: async (ctx, { slug, today }) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    const player = await requirePlayer(ctx)
    if (!(await isProFor(ctx, player._id))) return { enabled: true as const, locked: true as const }
    return {
      enabled: true as const,
      locked: false as const,
      contribution: await myContributionFor(ctx, player._id, slug, requirePlausibleToday(today)),
    }
  },
})
```

In `convex/onboarding.ts` `getStatus`, before the `return`. This read is keyed to the caller's own id, so it respects the banner's no-team-scan rule:

```ts
    // PUBLIC LEAGUES (zic8.3): whether to offer "Pick your opener". Keyed to the
    // caller's own id like everything else here, so nobody else's activity can
    // invalidate it. Reported as in-league while the feature is dark, so the
    // step never offers something that would refuse.
    const inLeague =
      !leaguesEnabled(process.env.LEAGUES_ENABLED) ||
      (await ctx.db
        .query('leagueMemberships')
        .withIndex('by_player_and_league', (q) => q.eq('playerId', player._id))
        .first()) !== null

    return { enteredBoard, dismissed: player.onboardingDismissedAt !== undefined, inLeague }
```

(import `leaguesEnabled` from `./lib/league.ts`.)

- [ ] **Step 4: Run** `TZ=UTC pnpm vitest run convex/leagues.test.ts convex/onboarding.test.ts`, expected PASS.
- [ ] **Step 5: Gates, commit green** — `feat(zic8.3): my leagues, Pro contribution, onboarding inLeague fact`.

---

### Task 9: `e2ePrune` removes a pruned player's league rows

**Files:**
- Modify: `convex/e2ePrune.ts` (report type, `emptyReport`, the per-player block before `// LAST, ALWAYS.`)
- Modify: `convex/leagues.ts` (`pruneLeagueRowsFor`)
- Test: `convex/e2ePrune.test.ts`

- [ ] **Step 1: Write the failing test** in `convex/e2ePrune.test.ts`. Follow that file's existing setup (an `e2e+…@wordleteams.com` player, `t.mutation(internal.e2ePrune.pruneBatch, { … execute: true })`):

```ts
test('a pruned player leaves no league rows and their group totals drop out', async () => {
  const t = convexTest(schema, modules)
  const { groupId } = await t.run(async (ctx) => {
    const leagueId = await seedLeagueFor(ctx, STARTING_WORDS, 0) // from './leagues.ts'
    const groups = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', leagueId)).collect()
    const group = { crane: groups.find((g) => g.slug === 'crane')!._id }
    const e2e = await ctx.db.insert('players', aPlayer({ email: 'e2e+league@wordleteams.com' }))
    const real = await ctx.db.insert('players', aPlayer({ email: 'real@example.com' }))
    for (const [p, boards, attempts] of [[e2e, 3, 9], [real, 2, 8]] as const) {
      await ctx.db.insert('leagueMemberships', { playerId: p, leagueId, groupId: group.crane, fromDay: '2026-10-01' })
      await ctx.db.insert('leagueMemberMonth', { playerId: p, leagueId, groupId: group.crane, year: 2026, month: 10, boards, attempts })
    }
    await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 10, boards: 5, attempts: 17, contributors: 2 })
    await ctx.db.patch(group.crane, { memberCount: 2 })
    return { groupId: group.crane }
  })
  // …run pruneBatch with execute: true exactly as the neighbouring tests do, summing reports…
  await t.run(async (ctx) => {
    expect(await ctx.db.query('leagueMemberships').collect()).toHaveLength(1)
    expect(await ctx.db.query('leagueMemberMonth').collect()).toHaveLength(1)
    expect((await ctx.db.query('leagueGroupMonth').collect())[0]).toMatchObject({ boards: 2, attempts: 8, contributors: 1 })
    expect((await ctx.db.get(groupId))!.memberCount).toBe(1)
  })
  // and the report: expect(totals.leagueRowsDeleted).toBe(2)
})
```

Seeding is inline because test files must not import each other's helpers.

- [ ] **Step 2: Run to verify it fails.** Commit red: `test(zic8.3): e2ePrune clears league rows (red)`.

- [ ] **Step 3: Implement.** In `convex/leagues.ts`:

```ts
/**
 * Remove every league row for a player being deleted, keeping group totals and
 * member counts exact. The only caller today is e2ePrune — the app has no
 * account deletion (spec §7). Whoever builds that must call this too.
 * Returns the number of membership + member-month rows removed.
 */
export async function pruneLeagueRowsFor(ctx: WriterCtx, playerId: Id<'players'>, today: PuzzleDay): Promise<number> {
  const memberships = await ctx.db
    .query('leagueMemberships')
    .withIndex('by_player_and_league', (q) => q.eq('playerId', playerId))
    .collect()
  for (const leagueId of new Set(memberships.map((r) => r.leagueId))) {
    const current = membershipOf(memberships.filter((r) => r.leagueId === leagueId).sort((a, b) => a.fromDay.localeCompare(b.fromDay)), today)
    if (current) await bumpCount(ctx, current.pendingGroupId ?? current.groupId, -1)
  }
  const monthRows = await ctx.db
    .query('leagueMemberMonth')
    .withIndex('by_player_league_year_month', (q) => q.eq('playerId', playerId))
    .collect()
  for (const row of monthRows) {
    await moveGroup(ctx, row.leagueId, row.groupId, row.year, row.month, groupDelta(row, null))
    await ctx.db.delete(row._id)
  }
  for (const row of memberships) await ctx.db.delete(row._id)
  return memberships.length + monthRows.length
}
```

In `convex/e2ePrune.ts`: add `leagueRowsDeleted: number` to `PruneBatchReport` and `leagueRowsDeleted: 0` to `emptyReport`. Then, immediately above `// LAST, ALWAYS.`:

```ts
      // PUBLIC LEAGUES (zic8.3). Before the player row, for the reason above.
      // Through pruneLeagueRowsFor so the group totals the player fed are
      // corrected, not just orphaned — beta standings would otherwise keep a
      // deleted test player's boards forever.
      if (execute) report.leagueRowsDeleted += await pruneLeagueRowsFor(ctx, player._id, toPuzzleDay(new Date()))
```

(import `pruneLeagueRowsFor` from `./leagues.ts` and `toPuzzleDay` if not already imported.) If the dry run must report a count too, mirror the neighbouring blocks: count rows without deleting when `!execute`.

- [ ] **Step 4: Run** `TZ=UTC pnpm vitest run convex/e2ePrune.test.ts convex/leagues.test.ts`, expected PASS.
- [ ] **Step 5: Gates, commit green** — `feat(zic8.3): e2ePrune removes league rows and corrects group totals`.

---
### Task 10: `GroupPicker` component

**Files:**
- Create: `src/components/leagues/group-picker.tsx`
- Test: `src/components/leagues/group-picker.hook.test.ts`

Tests in `src/` are `.ts` (the vitest glob is `src/**/*.test.ts`), so they build elements with `createElement`. They open with `// @vitest-environment jsdom`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GroupPicker } from './group-picker.tsx'

afterEach(cleanup)

const groups = (names: string[]) => names.map((name, i) => ({ _id: `g${i}`, name, memberCount: i }))
const FIVE = groups(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'])

describe('GroupPicker', () => {
  test('inline buttons at or below PICKER_INLINE_MAX, and a tap picks', () => {
    const onPick = vi.fn()
    render(createElement(GroupPicker, { groups: FIVE, currentGroupId: null, onPick }))
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'])
    fireEvent.click(screen.getByRole('button', { name: 'SLATE' }))
    expect(onPick).toHaveBeenCalledWith('g1')
  })
  test('the current group is pressed', () => {
    render(createElement(GroupPicker, { groups: FIVE, currentGroupId: 'g2', onPick: vi.fn() }))
    expect(screen.getByRole('button', { name: 'ADIEU' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'CRANE' }).getAttribute('aria-pressed')).toBe('false')
  })
  test('above the cap, a single sheet trigger instead of inline buttons', () => {
    render(createElement(GroupPicker, { groups: groups(['A', 'B', 'C', 'D', 'E', 'F', 'G']), currentGroupId: null, onPick: vi.fn() }))
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Pick a group'])
  })
  test('disabled disables every choice', () => {
    render(createElement(GroupPicker, { groups: FIVE, currentGroupId: null, onPick: vi.fn(), disabled: true }))
    expect(screen.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })
})
```

- [ ] **Step 2: Run** `TZ=UTC pnpm vitest run src/components/leagues/group-picker.hook.test.ts`, expected FAIL (no module). Commit red.

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#/components/ui/sheet.tsx'
import { cn } from '#/lib/utils.ts'
import { PICKER_INLINE_MAX } from '../../../convex/lib/league.ts'

export type PickerGroup = { _id: string; name: string; memberCount: number }

type Props = {
  groups: PickerGroup[]
  currentGroupId: string | null
  onPick: (groupId: string) => void
  disabled?: boolean
  className?: string
}

/**
 * Choose a league group. INLINE BUTTONS for a small league (Starting Words has
 * five) and a SEARCHABLE SHEET above PICKER_INLINE_MAX, so a 32-group league
 * later is a data change rather than a redesign (spec §8.3, §8.5).
 */
export function GroupPicker({ groups, currentGroupId, onPick, disabled = false, className }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const choice = (group: PickerGroup, extra?: string) => (
    <Button
      key={group._id}
      type="button"
      variant={group._id === currentGroupId ? 'default' : 'outline'}
      aria-pressed={group._id === currentGroupId}
      disabled={disabled}
      className={cn('font-mono tracking-widest', extra)}
      onClick={() => {
        setOpen(false)
        onPick(group._id)
      }}
    >
      {group.name}
    </Button>
  )

  if (groups.length <= PICKER_INLINE_MAX) {
    return <div className={cn('flex flex-wrap gap-2', className)}>{groups.map((g) => choice(g))}</div>
  }

  const shown = groups.filter((g) => g.name.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className={className}>
          Pick a group
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Pick a group</SheetTitle>
        </SheetHeader>
        <Input aria-label="Search groups" value={search} onChange={(e) => setSearch(e.target.value)} className="my-3" />
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">{shown.map((g) => choice(g, 'justify-start'))}</div>
      </SheetContent>
    </Sheet>
  )
}
```

(Check `src/components/ui/sheet.tsx` exports these names and accepts `side`: `rg -n "^export|side" src/components/ui/sheet.tsx`.)

- [ ] **Step 4: Run, expected PASS.** **Step 5: Gates, commit green** — `feat(zic8.3): group picker, inline or sheet`.

---

### Task 11: Standings components and the `/leagues` routes

**Files:**
- Create: `src/components/leagues/league-standings.tsx`, `src/components/leagues/contribution-row.tsx`
- Create: `src/routes/leagues.index.tsx`, `src/routes/leagues.$slug.tsx` (flat files, no `leagues.tsx` parent, so no `<Outlet/>` is needed)
- Modify: `src/lib/plans.ts` (`UpgradeOrigin` + `UPGRADE_HEADLINES`), `src/lib/plans.test.ts` (`ORIGINS`)
- Modify: `public/robots.txt` (`Disallow: /leagues`), `src/crawler-metadata.test.ts` (exact disallow list, about line 198)
- Regenerated: `src/routeTree.gen.ts` (by `pnpm build`; commit it)
- Test: `src/components/leagues/league-standings.hook.test.ts`, `src/components/leagues/contribution-row.hook.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/leagues/league-standings.hook.test.ts
// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LeagueStandings } from './league-standings.tsx'

afterEach(cleanup)

const groups = ['CRANE', 'SLATE', 'ADIEU'].map((name, i) => ({ _id: `g${i}`, name }))
const base = {
  month: '2026-10',
  groups,
  standings: [
    { groupId: 'g0', rank: 1, average: 3.8, boards: 142, contributors: 9 },
    { groupId: 'g1', rank: 2, average: 3.9, boards: 96, contributors: 6 },
    { groupId: 'g2', rank: null, average: null, boards: 6, contributors: 2 },
  ],
  myGroupId: 'g1',
  lastMonth: null,
  monthsWon: [],
}

describe('LeagueStandings', () => {
  test('ranked rows show the average, unranked rows show progress to the floor', () => {
    render(createElement(LeagueStandings, base))
    expect(screen.getByTestId('standing-CRANE').textContent).toContain('3.8')
    expect(screen.getByTestId('standing-ADIEU').textContent).toContain('not yet ranked (6/10)')
  })
  test("the viewer's group is marked", () => {
    render(createElement(LeagueStandings, base))
    expect(screen.getByTestId('standing-SLATE').textContent).toContain('you')
    expect(screen.getByTestId('standing-CRANE').textContent).not.toContain('you')
  })
  test('last month: a winner, or no winner', () => {
    render(createElement(LeagueStandings, { ...base, lastMonth: { month: '2026-09', winnerGroupId: 'g0' } }))
    expect(screen.getByText('September winner: CRANE')).toBeTruthy()
    cleanup()
    render(createElement(LeagueStandings, { ...base, lastMonth: { month: '2026-09', winnerGroupId: null } }))
    expect(screen.getByText('No winner in September')).toBeTruthy()
  })
  test('the all-time tally lists only groups that have won, most first', () => {
    render(createElement(LeagueStandings, { ...base, monthsWon: [{ groupId: 'g0', count: 1 }, { groupId: 'g1', count: 3 }, { groupId: 'g2', count: 0 }] }))
    expect(screen.getByTestId('league-all-time').textContent).toBe('All-time: SLATE 3 · CRANE 1')
  })
})
```

```ts
// src/components/leagues/contribution-row.hook.test.ts
// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ContributionRow } from './contribution-row.tsx'

afterEach(cleanup)

describe('ContributionRow', () => {
  test('locked: an upgrade button, never a number', () => {
    const onUpgrade = vi.fn()
    render(createElement(ContributionRow, { view: { locked: true }, groupName: 'SLATE', onUpgrade }))
    fireEvent.click(screen.getByRole('button', { name: 'See how much you move SLATE' }))
    expect(onUpgrade).toHaveBeenCalled()
  })
  test('negative shift reads as pulling the average down', () => {
    render(createElement(ContributionRow, { view: { locked: false, contribution: { mine: 3.6, group: 3.9, shift: -0.1 } }, groupName: 'SLATE', onUpgrade: vi.fn() }))
    expect(screen.getByTestId('league-contribution').textContent).toBe("Your 3.6 vs SLATE's 3.9 — you pull SLATE down by 0.1 guesses")
  })
  test('positive shift reads as pushing it up', () => {
    render(createElement(ContributionRow, { view: { locked: false, contribution: { mine: 4.4, group: 4, shift: 0.2 } }, groupName: 'SLATE', onUpgrade: vi.fn() }))
    expect(screen.getByTestId('league-contribution').textContent).toBe("Your 4.4 vs SLATE's 4 — you push SLATE up by 0.2 guesses")
  })
  test('no boards yet', () => {
    render(createElement(ContributionRow, { view: { locked: false, contribution: null }, groupName: 'SLATE', onUpgrade: vi.fn() }))
    expect(screen.getByTestId('league-contribution').textContent).toBe('Play a board to see what you add to SLATE.')
  })
})
```

- [ ] **Step 2: Run both, expected FAIL. Commit red.**

- [ ] **Step 3: Implement the components**

```tsx
// src/components/leagues/league-standings.tsx
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { cn } from '#/lib/utils.ts'
import { MIN_LEAGUE_BOARDS } from '../../../convex/lib/league.ts'

type Row = { groupId: string; rank: number | null; average: number | null; boards: number; contributors: number }

type Props = {
  month: string // 'YYYY-MM'
  groups: { _id: string; name: string }[]
  standings: Row[]
  myGroupId: string | null
  lastMonth: { month: string; winnerGroupId: string | null } | null
  monthsWon: { groupId: string; count: number }[]
  className?: string
}

/** 'YYYY-MM' -> 'October'. Noon avoids a timezone rolling the date back a day. */
export function monthName(month: string): string {
  return new Date(`${month}-01T12:00:00`).toLocaleString('en-US', { month: 'long' })
}

/**
 * The standings table (spec §8.2). GROUP TOTALS ONLY: nothing here names a
 * player, and nothing may — strangers see groups, never people (§3.2).
 */
export function LeagueStandings({ month, groups, standings, myGroupId, lastMonth, monthsWon, className }: Props) {
  const nameOf = (id: string) => groups.find((g) => g._id === id)?.name ?? ''
  const tally = monthsWon.filter((m) => m.count > 0).sort((a, b) => b.count - a.count)
  return (
    <Card className={className} role="region" aria-label="Standings">
      <CardHeader>
        <CardTitle asChild>
          <h2>{monthName(month)}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="flex flex-col divide-y">
          {standings.map((row) => {
            const name = nameOf(row.groupId)
            return (
              <li
                key={row.groupId}
                data-testid={`standing-${name}`}
                className={cn('flex items-center gap-3 py-2', row.groupId === myGroupId && 'font-semibold')}
              >
                <span className="w-5 text-right tabular-nums text-muted-foreground">{row.rank ?? '–'}</span>
                <span className="font-mono tracking-widest">{name}</span>
                {row.groupId === myGroupId && <span className="text-xs text-muted-foreground">you</span>}
                <span className="ml-auto text-right tabular-nums">
                  {row.average === null ? (
                    <span className="text-muted-foreground">not yet ranked ({row.boards}/{MIN_LEAGUE_BOARDS})</span>
                  ) : (
                    <>
                      {row.average.toFixed(1)}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.boards} boards · {row.contributors} played
                      </span>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
        {lastMonth && (
          <p className="text-sm">
            {lastMonth.winnerGroupId
              ? `${monthName(lastMonth.month)} winner: ${nameOf(lastMonth.winnerGroupId)}`
              : `No winner in ${monthName(lastMonth.month)}`}
          </p>
        )}
        {tally.length > 0 && (
          <p data-testid="league-all-time" className="text-sm text-muted-foreground">
            {`All-time: ${tally.map((m) => `${nameOf(m.groupId)} ${m.count}`).join(' · ')}`}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
```

Note: `row.average.toFixed(1)` renders `4.0`. The test expects `3.8`, which is fine. The contribution test deliberately uses the raw number (`4`).

```tsx
// src/components/leagues/contribution-row.tsx
import { Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'

type Contribution = { mine: number | null; group: number | null; shift: number | null }
type View = { locked: true } | { locked: false; contribution: Contribution | null }

/** The Pro layer (spec §3): free members get the button, never a number. */
export function ContributionRow({ view, groupName, onUpgrade }: { view: View; groupName: string; onUpgrade: () => void }) {
  if (view.locked) {
    return (
      <Button type="button" variant="outline" onClick={onUpgrade}>
        <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
        See how much you move {groupName}
      </Button>
    )
  }
  const c = view.contribution
  let text: string
  if (!c || c.mine === null) text = `Play a board to see what you add to ${groupName}.`
  else if (c.group === null || c.shift === null) text = `Your ${c.mine} — ${groupName} needs more boards to compare.`
  else if (c.shift < 0) text = `Your ${c.mine} vs ${groupName}'s ${c.group} — you pull ${groupName} down by ${-c.shift} guesses`
  else if (c.shift > 0) text = `Your ${c.mine} vs ${groupName}'s ${c.group} — you push ${groupName} up by ${c.shift} guesses`
  else text = `Your ${c.mine} vs ${groupName}'s ${c.group} — right on ${groupName}'s average`
  return (
    <p data-testid="league-contribution" className="text-sm">
      {text}
    </p>
  )
}
```

- [ ] **Step 4: Add the upgrade origin.** In `src/lib/plans.ts`, add `| 'leagues'` to `UpgradeOrigin`, and to `UPGRADE_HEADLINES`:

```ts
  // Reached from the league page's locked contribution row.
  leagues: 'Know exactly what you add to your group',
```

Add `'leagues'` to `ORIGINS` in `src/lib/plans.test.ts`. That file also guards headlines against sharing four consecutive words with a benefit. If it fails, reword the headline; do not loosen the guard.

- [ ] **Step 5: Create the routes**

```tsx
// src/routes/leagues.$slug.tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { toast } from 'sonner'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { useUpgrade } from '#/components/upgrade-dialog.tsx'
import { DashboardError } from '#/components/dashboard-error.tsx'
import { Button } from '#/components/ui/button.tsx'
import { GroupPicker } from '#/components/leagues/group-picker.tsx'
import { LeagueStandings, monthName } from '#/components/leagues/league-standings.tsx'
import { ContributionRow } from '#/components/leagues/contribution-row.tsx'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Id } from '../../convex/_generated/dataModel'

export const Route = createFileRoute('/leagues/$slug')({
  head: () => ({ meta: [{ title: pageTitle('Leagues') }] }),
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(convexQuery(api.players.needsProfile, {}))
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
  errorComponent: DashboardError,
  component: LeaguePage,
})

/** KEYED BY SLUG: TanStack reuses the component across a param change. */
function LeaguePage() {
  const { slug } = Route.useParams()
  return <LeagueFor key={slug} slug={slug} />
}

function LeagueFor({ slug }: { slug: string }) {
  // The viewer's LOCAL day, read only after hydration (the app.tsx idiom), so
  // SSR and the first client render agree.
  const hydrated = useHydrated()
  const today = hydrated ? toPuzzleDay(new Date()) : null
  const { openUpgrade } = useUpgrade()

  const { data: standings } = useQuery(convexQuery(api.leagues.standings, today ? { slug, today } : 'skip'))
  const { data: mine } = useQuery(convexQuery(api.leagues.myLeagues, today ? { today } : 'skip'))
  const { data: contribution } = useQuery(convexQuery(api.leagues.myContribution, today ? { slug, today } : 'skip'))

  const join = useMutation({ mutationFn: useConvexMutation(api.leagues.joinGroup) })
  const change = useMutation({ mutationFn: useConvexMutation(api.leagues.switchGroup) })
  const leave = useMutation({ mutationFn: useConvexMutation(api.leagues.leaveLeague) })

  if (!today || !standings || !mine) return <main className="page-max p-4" aria-busy="true" />
  if (!standings.enabled || !mine.enabled) return <main className="page-max p-4"><p>Leagues aren't available yet.</p></main>
  const view = standings.view
  if (!view) return <main className="page-max p-4"><p>That league doesn't exist.</p></main>

  const membership = mine.leagues.find((l) => l.league.slug === slug) ?? null
  const busy = join.isPending || change.isPending || leave.isPending
  const run = async (action: () => Promise<unknown>, failure: string) => {
    try {
      await action()
    } catch (error) {
      toast.error(mutationErrorMessage(error, failure))
    }
  }
  const nextMonth = monthName(monthOf(membership?.pending?.from ?? today))

  return (
    <main className="page-max flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">{view.league.name}</h1>
      {membership ? (
        <p className="text-sm">
          You play for <span className="font-mono tracking-widest">{membership.group.name}</span>
          {membership.pending && ` · switching to ${membership.pending.group.name} on ${nextMonth} 1`}
        </p>
      ) : (
        <section aria-label="Pick your opener" className="flex flex-col gap-2">
          <h2 className="font-medium">Pick your opener</h2>
          <GroupPicker
            groups={view.groups}
            currentGroupId={null}
            disabled={busy}
            onPick={(groupId) => run(() => join.mutateAsync({ groupId: groupId as Id<'leagueGroups'>, today }), 'Could not join that group')}
          />
          <p className="text-xs text-muted-foreground">Your boards count for your group from tomorrow.</p>
        </section>
      )}
      <LeagueStandings
        month={view.month}
        groups={view.groups}
        standings={view.standings}
        myGroupId={membership?.group._id ?? null}
        lastMonth={view.lastMonth}
        monthsWon={view.monthsWon}
      />
      {membership && contribution?.enabled && (
        <ContributionRow
          view={contribution.locked ? { locked: true } : { locked: false, contribution: contribution.contribution }}
          groupName={membership.group.name}
          onUpgrade={() => openUpgrade('leagues')}
        />
      )}
      {membership && (
        <section aria-label="Your group" className="flex flex-col gap-2">
          <h2 className="font-medium">Switch group</h2>
          <GroupPicker
            groups={view.groups}
            currentGroupId={membership.pending?.group._id ?? membership.group._id}
            disabled={busy}
            onPick={(groupId) => run(() => change.mutateAsync({ groupId: groupId as Id<'leagueGroups'>, today }), 'Could not switch group')}
          />
          <p className="text-xs text-muted-foreground">A switch takes effect on the 1st.</p>
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            disabled={busy}
            onClick={() => run(() => leave.mutateAsync({ leagueId: membership.leagueId, today }), 'Could not leave the league')}
          >
            Leave league
          </Button>
        </section>
      )}
    </main>
  )
}
```

```tsx
// src/routes/leagues.index.tsx
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { DashboardError } from '#/components/dashboard-error.tsx'
import { Card, CardHeader, CardTitle } from '#/components/ui/card.tsx'

/**
 * /leagues. WITH ONE LEAGUE IT REDIRECTS to that league's page, so v1 never
 * shows an index of one (spec §8.1). With several it is the directory.
 */
export const Route = createFileRoute('/leagues/')({
  head: () => ({ meta: [{ title: pageTitle('Leagues') }] }),
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(convexQuery(api.players.needsProfile, {}))
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
  loader: async ({ context }) => {
    const result = await context.queryClient.ensureQueryData(convexQuery(api.leagues.leagues, {}))
    if (result.enabled && result.leagues.length === 1) {
      throw redirect({ to: '/leagues/$slug', params: { slug: result.leagues[0].slug }, replace: true })
    }
  },
  errorComponent: DashboardError,
  component: LeaguesIndex,
})

function LeaguesIndex() {
  const { data } = useSuspenseQuery(convexQuery(api.leagues.leagues, {}))
  if (!data.enabled) return <main className="page-max p-4"><p>Leagues aren't available yet.</p></main>
  return (
    <main className="page-max flex flex-col gap-3 p-4">
      <h1 className="text-xl font-semibold">Leagues</h1>
      {data.leagues.map((league) => (
        <Link key={league.slug} to="/leagues/$slug" params={{ slug: league.slug }}>
          <Card>
            <CardHeader>
              <CardTitle asChild>
                <h2>{league.name}</h2>
              </CardTitle>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </main>
  )
}
```

The page components are NOT exported (`src/routes.test.ts` asserts that no route file exports its component).

- [ ] **Step 6: Robots and crawler test.** In `public/robots.txt`, add `Disallow: /leagues` after `Disallow: /challenge`. In `src/crawler-metadata.test.ts`, add `'/leagues'` to the exact sorted disallow list (between `'/join'` and `'/me'`).

- [ ] **Step 7: Regenerate the route tree** by running `pnpm build` (the vite plugin is the only generator; never run `tsr generate`). Confirm that `src/routeTree.gen.ts` now contains `/leagues/` and `/leagues/$slug`.

- [ ] **Step 8: Run** `TZ=UTC pnpm vitest run src/components/leagues src/lib/plans.test.ts src/crawler-metadata.test.ts src/routes.test.ts`, expected PASS.

- [ ] **Step 9: Gates, commit green** (include `src/routeTree.gen.ts`) — `feat(zic8.3): league standings page and /leagues`.

---

### Task 12: Home card

**Files:**
- Create: `src/components/leagues/leagues-card.tsx`
- Modify: `src/routes/app.tsx` (render beside `ChallengeNudge` in the grid, about line 1430, and in the teamless branch, about line 966, under the onboarding card)
- Test: `src/components/leagues/leagues-card.hook.test.ts`

The card is presentational. `app.tsx` supplies data from `api.leagues.myLeagues` and `api.leagues.leagues`, read with `useQuery` under the existing `hydrated` guard.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params?: { slug: string }; children: unknown }) =>
    createElement('a', { href: params ? to.replace('$slug', params.slug) : to, ...rest }, children as never),
}))

import { LeaguesCard } from './leagues-card.tsx'

afterEach(cleanup)

const featured = {
  slug: 'starting-words',
  name: 'Starting Words',
  featured: true,
  groups: ['CRANE', 'SLATE'].map((name, i) => ({ _id: `g${i}`, name, memberCount: 0 })),
}
const row = (slug: string, rank: number | null) => ({
  league: { slug, name: slug },
  leagueId: slug,
  group: { _id: 'g0', name: 'CRANE' },
  since: '2026-10-01',
  pending: null,
  rank,
  average: rank ? 3.8 : null,
  boards: 12,
})

describe('LeaguesCard', () => {
  test('not in a league: offers the featured league inline', () => {
    const onJoin = vi.fn()
    render(createElement(LeaguesCard, { mine: [], featured, onJoin, busy: false }))
    expect(screen.getByRole('heading', { name: 'Pick your opener' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'SLATE' }))
    expect(onJoin).toHaveBeenCalledWith('g1')
  })
  test('in a league: one row with rank and average, linking to the league', () => {
    render(createElement(LeaguesCard, { mine: [row('starting-words', 1)], featured, onJoin: vi.fn(), busy: false }))
    const link = screen.getByRole('link', { name: /CRANE/ })
    expect(link.getAttribute('href')).toBe('/leagues/starting-words')
    expect(link.textContent).toContain('#1')
    expect(link.textContent).toContain('3.8')
  })
  test('caps at HOME_CARD_MAX_LEAGUES with See all', () => {
    render(createElement(LeaguesCard, { mine: ['a', 'b', 'c', 'd'].map((s) => row(s, null)), featured, onJoin: vi.fn(), busy: false }))
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toContain('See all')
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })
  test('nothing at all when there is no featured league and no membership', () => {
    const { container } = render(createElement(LeaguesCard, { mine: [], featured: null, onJoin: vi.fn(), busy: false }))
    expect(container.innerHTML).toBe('')
  })
})
```

- [ ] **Step 2: Run, expected FAIL. Commit red.**

- [ ] **Step 3: Implement**

```tsx
import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { GroupPicker, type PickerGroup } from './group-picker.tsx'
import { HOME_CARD_MAX_LEAGUES } from '../../../convex/lib/league.ts'

type MyLeague = {
  league: { slug: string; name: string }
  group: { _id: string; name: string }
  rank: number | null
  average: number | null
  boards: number
}

type Props = {
  mine: MyLeague[]
  featured: { slug: string; name: string; groups: PickerGroup[] } | null
  onJoin: (groupId: string) => void
  busy: boolean
  className?: string
}

/** Dashboard card (spec §8.4): your leagues, or the featured league's picker. */
export function LeaguesCard({ mine, featured, onJoin, busy, className }: Props) {
  if (mine.length === 0 && !featured) return null
  if (mine.length === 0 && featured) {
    return (
      <Card className={className} role="region" aria-label="Leagues">
        <CardHeader>
          <CardTitle asChild>
            <h2>Pick your opener</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Join a {featured.name} group. Every board you play counts for it.</p>
          <GroupPicker groups={featured.groups} currentGroupId={null} disabled={busy} onPick={onJoin} />
        </CardContent>
      </Card>
    )
  }
  const shown = mine.slice(0, HOME_CARD_MAX_LEAGUES)
  return (
    <Card className={className} role="region" aria-label="Leagues">
      <CardHeader>
        <CardTitle asChild>
          <h2>Leagues</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {shown.map((l) => (
          <Link key={l.league.slug} to="/leagues/$slug" params={{ slug: l.league.slug }} className="flex items-center gap-3 rounded-md border p-3">
            <span className="font-mono tracking-widest">{l.group.name}</span>
            <span className="text-sm text-muted-foreground">{l.league.name}</span>
            <span className="ml-auto tabular-nums">
              {l.rank === null ? 'not yet ranked' : `#${l.rank} · ${l.average!.toFixed(1)}`}
            </span>
          </Link>
        ))}
        {mine.length > HOME_CARD_MAX_LEAGUES && (
          <Link to="/leagues" className="text-sm underline">
            See all
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Mount it in `src/routes/app.tsx`.** Near the other `useQuery` calls (around line 579):

```tsx
  // PUBLIC LEAGUES (zic8.3). Keyed to the caller, not the team scan, so a team
  // change elsewhere does not invalidate them (onboarding.ts's banner rule).
  const leagueToday = hydrated ? toPuzzleDay(new Date()) : null
  const { data: myLeagues } = useQuery(convexQuery(api.leagues.myLeagues, leagueToday ? { today: leagueToday } : 'skip'))
  const { data: allLeagues } = useQuery(convexQuery(api.leagues.leagues, {}))
  const joinLeague = useMutation({ mutationFn: useConvexMutation(api.leagues.joinGroup) })
  const leaguesCard = (className?: string) =>
    myLeagues?.enabled && allLeagues?.enabled && leagueToday ? (
      <LeaguesCard
        className={className}
        mine={myLeagues.leagues}
        featured={allLeagues.leagues.find((l) => l.featured) ?? null}
        busy={joinLeague.isPending}
        onJoin={(groupId) =>
          joinLeague
            .mutateAsync({ groupId: groupId as Id<'leagueGroups'>, today: leagueToday })
            .catch((error: unknown) => toast.error(mutationErrorMessage(error, 'Could not join that group')))
        }
      />
    ) : null
```

Render `{leaguesCard('md:col-span-3')}` directly after `<ChallengeNudge … />`, and `{leaguesCard('mx-auto mb-4 max-w-md')}` directly after `{onboardingCard('mx-auto mb-4 max-w-md')}` in the teamless branch. Add any missing imports (`LeaguesCard`, `useMutation`, `useConvexMutation`, `toast`, `mutationErrorMessage`, `Id`). Several are already imported, so check the top of the file first.

**This must sit above any early return in the component** (hooks rule). Place it with the other hooks near line 579, not inside a branch.

- [ ] **Step 5: Run** `TZ=UTC pnpm vitest run src/components/leagues src/routes.test.ts src/routes/-insights.hook.test.ts`, expected PASS. If an `app.tsx` hook test mocks `useQuery` by function name and throws on unknown refs, teach its mock to answer `leagues.myLeagues`/`leagues.leagues` with `{ enabled: false }`.
- [ ] **Step 6: Gates, commit green** — `feat(zic8.3): leagues home card`.

---

### Task 13: Onboarding step and app-menu entry

**Files:**
- Modify: `src/lib/onboarding-tasks.ts`, `src/lib/onboarding-facts.ts`, `src/components/onboarding/next-step-card.tsx`, `src/routes/app.tsx` (pass `onLeague`)
- Modify: `src/components/app-menu.tsx`
- Test: `src/lib/onboarding-tasks.test.ts` (or wherever `incompleteTasks` is tested: `rg -ln "incompleteTasks" src`), `src/components/onboarding/next-step-card.hook.test.ts`, `src/components/app-menu.hook.test.ts`

- [ ] **Step 1: Write the failing tests**

In the `incompleteTasks` test file:

```ts
test('a teamless player not in a league is offered the league', () => {
  expect(incompleteTasks({ enteredBoard: false, hasTeam: false, hasInvited: false, dismissed: false, inLeague: false }).map((t) => t.id)).toEqual([
    'board',
    'league',
    'team',
  ])
})
test('the league step disappears once in a league, and is never offered to a player with a team', () => {
  expect(incompleteTasks({ enteredBoard: true, hasTeam: false, hasInvited: false, dismissed: false, inLeague: true }).map((t) => t.id)).toEqual(['team'])
  expect(incompleteTasks({ enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false, inLeague: false })).toEqual([])
})
```

Every existing `OnboardingFacts` literal in tests now needs `inLeague: true` (true keeps existing expectations unchanged). Find them with `rg -n "hasInvited:" src --glob '*.test.ts'`.

In `next-step-card.hook.test.ts`: render with a teamless, not-in-league `facts` and an `onLeague` spy, click the button titled `Pick your opener`, and expect the spy to have been called.

In `app-menu.hook.test.ts`: change both signed-in expected lists (about line 366 and the separator-order list about line 402) to put `'Leagues'` after `'Insights'`.

- [ ] **Step 2: Run, expected FAIL. Commit red.**

- [ ] **Step 3: Implement.**

`src/lib/onboarding-tasks.ts`:

```ts
export type OnboardingTaskId = 'board' | 'league' | 'team' | 'invite'

export type OnboardingFacts = {
  enteredBoard: boolean
  hasTeam: boolean
  hasInvited: boolean
  dismissed: boolean
  // PUBLIC LEAGUES (zic8.3). The server reports true while the feature is dark,
  // so the step never offers something that would refuse.
  inLeague: boolean
}
```

Add to `TASK_COPY`:

```ts
  league: { title: 'Pick your opener', hint: 'No team yet? Play for a group today' },
```

In `incompleteTasks`, after the `board` line:

```ts
  if (!facts.hasTeam && !facts.inLeague) ids.push('league')
```

`src/lib/onboarding-facts.ts`: widen `Status` to include `inLeague: boolean`, and return `inLeague: status?.inLeague ?? true`.

`next-step-card.tsx`: add `onLeague: () => void` to the props and `league: onLeague` to `runners`.

`src/routes/app.tsx`: pass `onLeague={() => navigate({ to: '/leagues' })}` to `NextStepCard` inside `onboardingCard`. `/leagues` redirects to the featured league while there is one.

`src/components/app-menu.tsx`: directly after the Insights item:

```tsx
            <DropdownMenuItem asChild>
              <Link to="/leagues">
                <Trophy className="mr-2 h-4 w-4" aria-hidden="true" />
                <span>Leagues</span>
              </Link>
            </DropdownMenuItem>
```

(add `Trophy` to the `lucide-react` import.) The menu entry is not flag-gated: a dark deployment's `/leagues` says "Leagues aren't available yet." That is acceptable for the beta window. If you would rather hide it, gate it on `api.leagues.leagues` returning `enabled`, using the `isAuthenticated ? {} : 'skip'` idiom the menu already uses. Note which you chose in the commit.

- [ ] **Step 4: Run** `TZ=UTC pnpm vitest run src/lib src/components/onboarding src/components/app-menu.hook.test.ts`, expected PASS. Also update `e2e/app-menu.ts` if it pins the menu list (`rg -n "Insights" e2e/app-menu.ts`).
- [ ] **Step 5: Gates, commit green** — `feat(zic8.3): onboarding offers a league; app menu links it`.

---

### Task 14: End to end, CI flag, e2e seed helper

**Files:**
- Modify: `convex/e2eSeed.ts` (`ensureLeagueFor`)
- Modify: `.github/workflows/deploy-v2.yml` (about line 231, beside `CHALLENGES_ENABLED`)
- Modify: `src/deploy-workflow.test.ts` if it pins the env lines (`rg -n "CHALLENGES_ENABLED" src/deploy-workflow.test.ts`)
- Create: `e2e/leagues.spec.ts`

- [ ] **Step 1: e2e seed helper** in `convex/e2eSeed.ts`, guarded exactly like `ensureTeamFor`:

```ts
/**
 * Seeds Starting Words on the e2e backend. Guarded like ensureTeamFor:
 * E2E_TEST_MODE must be 'true' and the caller must name an e2e+* address.
 * Idempotent — seedLeagueFor matches by slug.
 */
export const ensureLeagueFor = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (!isE2eTraffic(email, process.env.E2E_TEST_MODE)) {
      throw new Error('e2eSeed.ensureLeagueFor is only available in E2E test mode for e2e+* addresses')
    }
    await seedLeagueFor(ctx, STARTING_WORDS, Date.now())
  },
})
```

This is the same plain-`Error` refusal `ensureTeamFor` uses, which is deliberate: it is test-only plumbing, not a user-facing code. Import `seedLeagueFor, STARTING_WORDS` from `./leagues.ts`.

- [ ] **Step 2: CI flag.** In `deploy-v2.yml`, after `pnpm exec convex env set CHALLENGES_ENABLED true`:

```yaml
          pnpm exec convex env set LEAGUES_ENABLED true
```

Update `src/deploy-workflow.test.ts` if it asserts that block.

- [ ] **Step 3: Write the spec**

```ts
// e2e/leagues.spec.ts
import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { completeProfile } from './complete-profile'

/**
 * PUBLIC LEAGUES, END TO END (zic8.3): a teamless player picks an opener from
 * the onboarding card and sees their group on the standings page.
 *
 * THE DEPLOYMENT MUST HAVE LEAGUES_ENABLED SET (deploy-v2.yml does, beside
 * E2E_TEST_MODE). Without it the step never appears and this fails at its
 * first assertion rather than passing vacuously.
 */
const TIMEOUT = { timeout: 15_000 }

test('a teamless player joins CRANE from onboarding and sees it on the standings', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const email = `e2e+league-${stamp}@wordleteams.com`
  await new ConvexHttpClient(process.env.VITE_CONVEX_URL!).mutation(api.e2eSeed.ensureLeagueFor, { email })

  await signIn(page, email)
  await completeProfile(page)
  await page.getByRole('button', { name: /Pick your opener/ }).click()
  await expect(page).toHaveURL(/\/leagues\/starting-words$/, TIMEOUT)

  await page.getByRole('region', { name: 'Pick your opener' }).getByRole('button', { name: 'CRANE' }).click()
  await expect(page.getByText(/You play for/)).toContainText('CRANE', TIMEOUT)
  await expect(page.getByTestId('standing-CRANE')).toContainText('you', TIMEOUT)
})
```

Check `signIn` and `completeProfile`'s real signatures in `e2e/sign-in.ts` and `e2e/complete-profile.ts`, and how `e2e/onboarding.spec.ts` gets a fresh player to the dashboard. Follow that sequence exactly. The three assertions above are what matter.

The region in this test is the standings page's `<section aria-label="Pick your opener">` (Task 11). The dashboard card uses `aria-label="Leagues"`, and its heading is also "Pick your opener", so stay scoped to the region.

- [ ] **Step 4: Run e2e in the background** (about 11 minutes, over the foreground cap). It needs a Convex backend on :3210 with `LEAGUES_ENABLED=true` and `E2E_TEST_MODE=true` set (`pnpm exec convex env set …` against the local backend). First make sure nothing stale holds :3000: `lsof -i :3000`. Playwright attaches to whatever is there.

```bash
pnpm e2e > /tmp/claude-gates/e2e.log 2>&1; echo "e2e=$?"
```

Expected: `e2e=0`, with `leagues.spec.ts` passing and nothing else regressing.

- [ ] **Step 5: Gates, commit** — `test(zic8.3): league join end to end; LEAGUES_ENABLED on CI`.

---

### Task 15: Rollout

Not code. Each step is an outward action, and the standing authorization covers beta only.

- [ ] **Step 1: Push `dev`** (`git pull --rebase && bd dolt push && git push`). Watch the CI run by SHA, not `--limit 1`.
- [ ] **Step 2: Beta.** Seed and switch on (beta deploys are pre-authorized):
  ```bash
  pnpm exec convex run leagues:seedLeague '{"slug":"starting-words"}'   # against beta; confirm the target first
  pnpm exec convex env set LEAGUES_ENABLED true
  ```
  Remember: `convex run --prod` silently hits local and `convex run` cannot reach beta, so use the deploy-key route your memory notes describe and **verify the target before running**. Then check by hand: join, the standings render, switch shows "switching to … on November 1", leave, rejoin.
- [ ] **Step 3: PR dev → main.** **Ask the owner first**: production is not covered by the standing authorization. After merge and deploy, run `seedLeague` against prod, then `convex env set LEAGUES_ENABLED true` on prod.
- [ ] **Step 4: First close** happens on the 2nd of the month after launch. File a P3 beads task to verify that `leagueMonthResults` has one row for the launch month on that date.
