# v2 Phase 2 — Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the loop the product exists for — enter a Wordle board, watch the team's month grid update live, and have the month's winner recomputed correctly as a side effect of the write.

**Architecture:** Three layers. Pure logic in `v2/convex/lib/` (day-string arithmetic, board validation, scoring) imported by *both* the browser and the Convex mutation, so the table and the winner can never disagree. Convex functions in `v2/convex/` (`access.ts` replacing Supabase RLS, `scores.ts` holding the queries and the one mutation). React UI in `v2/src/` reading through `@convex-dev/react-query`, which is what makes the scoreboard live-update for free.

**Tech Stack:** TanStack Start + Router, React 19, Convex, `convex-test` + Vitest, Tailwind 4, shadcn/ui (`style: "default"`), Playwright.

**Spec:** `docs/superpowers/specs/2026-08-18-v2-phase2-core-loop-design.md`

**Issues:** `wt-ksh.3.2` … `wt-ksh.3.11` under the phase epic `wt-ksh.3`, in the same order as the tasks below. The blocking graph is already wired, so `bd ready` will only ever offer you work whose prerequisites are done. Claim with `bd update <id> --claim` before starting and `bd close <id>` when its done-when is met.

---

## Before You Start

Read `docs/design-system/V2-ADDENDUM.md`. Non-negotiables from it:

- **Run every command from inside `v2/`.** A `pnpm build` from the repo root builds the *v1* app and dirties the tracked `public/sw.js` (`wordle-teams-d9g`). The shadcn CLI misdetects the project from the root.
- **v2's import alias is `#/`, not `@/`.**
- **Do not move shadcn off `style: "default"`.** The `radix-*` presets are broken upstream, and the breakage is invisible to `vite build`, `tsc --noEmit` and the whole test suite.
- **Screenshot UI work before calling it done**, using the project's own Playwright chromium from inside `v2/`. The MCP browser tool has no Chrome.

TypeScript settings that will bite you: `verbatimModuleSyntax` (type-only imports must say `import type`), `noUnusedLocals` and `noUnusedParameters` (both errors).

Vitest runs with `environment: 'edge-runtime'` and picks up `convex/**/*.test.ts` and `src/**/*.test.ts`. Commands: `pnpm test:once` (one shot), `pnpm test` (watch).

## File Structure

| File | Responsibility |
|---|---|
| `v2/convex/schema.ts` | **Modify** — `legacyId` optional on two tables |
| `v2/convex/lib/puzzleDay.ts` | **Create** — `'YYYY-MM-DD'` arithmetic. Dependency-free |
| `v2/convex/lib/board.ts` | **Create** — row padding, attempt counting, board validation |
| `v2/convex/lib/scoring.ts` | **Create** — points, month totals, winner selection |
| `v2/convex/access.ts` | **Create** — the RLS replacement |
| `v2/convex/scores.ts` | **Create** — `getMyTeams`, `getMyPlayerId`, `getTeamMonth`, `upsertBoard` |
| `v2/src/lib/wordle.ts` | **Modify** — re-export `toRows` from `board.ts` instead of defining it |
| `v2/src/lib/use-media-query.ts` | **Create** — ported from v1 |
| `v2/src/lib/use-visual-viewport.ts` | **Create** — ported from v1 |
| `v2/src/lib/format-day.ts` | **Create** — `Intl` day/month formatting + ordinals |
| `v2/src/lib/convex-error.ts` | **Create** — typed error codes → user-facing copy |
| `v2/src/components/scores-table.tsx` | **Create** — the month grid |
| `v2/src/components/team-picker.tsx` | **Create** — read-only team selector |
| `v2/src/components/month-picker.tsx` | **Create** — three-month window |
| `v2/src/components/board-entry/button.tsx` | **Create** — Dialog on desktop, Sheet on mobile |
| `v2/src/components/board-entry/form.tsx` | **Create** — the form, submit semantics |
| `v2/src/components/board-entry/board-input.tsx` | **Create** — keyboard capture over the board |
| `v2/src/components/date-picker.tsx` | **Create** — popover + calendar |
| `v2/src/routes/index.tsx` | **Modify** — becomes the real dashboard |
| `v2/e2e/sign-in.ts` | **Create** — sign-in helper extracted from `login.spec.ts` |
| `v2/e2e/board-entry.spec.ts` | **Create** — the one smoke test |

---

## Task 0: Make `legacyId` optional on natively-created tables

The schema was written for the copy, where every row carries its Supabase primary key. Phase 2 is the first phase that creates rows natively, and a board entered on beta has no Supabase identity. As things stand `upsertBoard` cannot insert at all. **Blocks Tasks 4 and 5.**

**Files:**
- Modify: `v2/convex/schema.ts`
- Test: `v2/convex/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/schema.test.ts`:

```ts
describe('natively-created rows', () => {
  test('a board entered in v2 needs no legacyId', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      // No legacyId: this row was born in v2, not copied from Supabase.
      const id = await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-08-18',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['GEESE', 'SPEED'],
      })
      const row = await ctx.db.get(id)
      expect(row?.legacyId).toBeUndefined()
    })
  })

  test('a winner row computed in v2 needs no legacyId', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const id = await ctx.db.insert('monthlyWinners', {
        playerId,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })
      const row = await ctx.db.get(id)
      expect(row?.legacyId).toBeUndefined()
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run from `v2/`: `pnpm test:once convex/schema.test.ts`
Expected: FAIL — the validator rejects the insert because `legacyId` is required.

- [ ] **Step 3: Widen the two fields**

In `v2/convex/schema.ts`, change `dailyScores`:

```ts
  dailyScores: defineTable({
    // OPTIONAL SINCE PHASE 2. Copied rows carry their Supabase pk; rows created
    // natively in v2 have no Supabase identity to carry, and inventing a
    // sentinel would fake one. Absence is meaningful: `legacyId === undefined`
    // means "born in v2, not copied", which is exactly the distinction Phase 7's
    // row-count reconciliation against Supabase needs. The copy is unaffected —
    // it matches on by_legacyId, and native rows correctly never match.
    legacyId: v.optional(v.number()),
```

and `monthlyWinners` the same way:

```ts
  monthlyWinners: defineTable({
    legacyId: v.optional(v.number()), // see the note on dailyScores.legacyId
```

Leave `players`, `teams`, `playerMembership` and `webhookEvents` alone — nothing in this phase creates rows in them.

Also correct the file's header comment, which currently asserts the opposite:

```ts
// EVERY COPIED ROW CARRIES legacyId — its Supabase primary key. That is what
// makes the copy idempotent and re-runnable, which matters because the copy runs
// at least three times: now for the owner's teams, again at the Phase 7 parity
// audit for everyone, and once more inside the cutover window. Rows created
// natively in v2 (Phase 2 onward) have no legacyId; see dailyScores.
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm test:once`
Expected: PASS, including the pre-existing schema tests.

- [ ] **Step 5: Commit**

```bash
git add v2/convex/schema.ts v2/convex/schema.test.ts
git commit -m "feat(v2): allow natively-created scores and winners to omit legacyId (wt-ksh.3.2)"
```

---

## Task 1: The pure core — day strings, board rules, scoring

Three small modules under `v2/convex/lib/`. They import nothing from Convex, React or the DOM, which is what makes them cheap to test and safe to run on both sides of the wire.

**Files:**
- Create: `v2/convex/lib/puzzleDay.ts`, `v2/convex/lib/board.ts`, `v2/convex/lib/scoring.ts`
- Modify: `v2/src/lib/wordle.ts`
- Test: `v2/convex/lib/puzzleDay.test.ts`, `v2/convex/lib/board.test.ts`, `v2/convex/lib/scoring.test.ts`

- [ ] **Step 1: Write the failing day-string test**

Create `v2/convex/lib/puzzleDay.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { addMonths, daysOfMonth, fromPuzzleDay, isWeekendDay, monthOf, monthRange, toPuzzleDay } from './puzzleDay'

describe('toPuzzleDay', () => {
  test('uses local calendar fields, not UTC', () => {
    // 2026-08-18 at 23:30 local. getUTC* would roll this to the 19th east of
    // Greenwich and to the 18th west of it; the local fields never do.
    expect(toPuzzleDay(new Date(2026, 7, 18, 23, 30))).toBe('2026-08-18')
  })

  test('zero-pads single-digit months and days', () => {
    expect(toPuzzleDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('fromPuzzleDay', () => {
  test('round-trips through local noon so DST cannot shift the day', () => {
    expect(toPuzzleDay(fromPuzzleDay('2026-03-08'))).toBe('2026-03-08')
    expect(fromPuzzleDay('2026-03-08').getHours()).toBe(12)
  })
})

describe('monthOf and monthRange', () => {
  test('monthOf slices the month off a day', () => {
    expect(monthOf('2026-08-18')).toBe('2026-08')
  })

  test('monthRange bounds sort correctly against every real day', () => {
    const { start, end } = monthRange('2026-02')
    expect(start).toBe('2026-02-01')
    // '-31' is a lexicographic upper bound, not a real date. February has no
    // 31st, and the index range query never needs it to.
    expect('2026-02-28' <= end).toBe(true)
    expect('2026-03-01' <= end).toBe(false)
  })
})

describe('daysOfMonth', () => {
  test('knows month lengths including leap years', () => {
    expect(daysOfMonth('2026-02')).toHaveLength(28)
    expect(daysOfMonth('2024-02')).toHaveLength(29)
    expect(daysOfMonth('2026-08')).toHaveLength(31)
    expect(daysOfMonth('2026-09')).toHaveLength(30)
  })

  test('returns padded day strings in order', () => {
    const days = daysOfMonth('2026-08')
    expect(days[0]).toBe('2026-08-01')
    expect(days[8]).toBe('2026-08-09')
    expect(days[30]).toBe('2026-08-31')
  })
})

describe('isWeekendDay', () => {
  test('identifies Saturday and Sunday', () => {
    expect(isWeekendDay('2026-08-15')).toBe(true) // Saturday
    expect(isWeekendDay('2026-08-16')).toBe(true) // Sunday
    expect(isWeekendDay('2026-08-17')).toBe(false) // Monday
  })
})

describe('addMonths', () => {
  test('walks backwards across a year boundary', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-01', -2)).toBe('2025-11')
  })

  test('walks forwards', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run from `v2/`: `pnpm test:once convex/lib/puzzleDay.test.ts`
Expected: FAIL — `Failed to resolve import "./puzzleDay"`.

- [ ] **Step 3: Write `puzzleDay.ts`**

Create `v2/convex/lib/puzzleDay.ts`:

```ts
/**
 * Arithmetic on puzzle days, which are 'YYYY-MM-DD' strings.
 *
 * The whole point of the format is that it sorts lexicographically, so day
 * comparison, month bounding and index ranges are all plain string operations.
 * That is why this module has no dependencies and must keep none: it is
 * imported by Convex functions, and dragging a date library into that bundle
 * for `a < b` would be absurd.
 *
 * See the schema note on dailyScores.puzzleDay for why a board belongs to a
 * PUZZLE rather than to a moment.
 */

/** A puzzle day, 'YYYY-MM-DD'. */
export type PuzzleDay = string
/** A puzzle month, 'YYYY-MM'. */
export type PuzzleMonth = string

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The puzzle day a Date falls on IN THE ZONE THE DATE IS RESOLVED IN — local in
 * a browser. Deliberately reads the local getters, never the getUTC* ones:
 * resolving "which day is this" in UTC is precisely v1's bug.
 */
export function toPuzzleDay(date: Date): PuzzleDay {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * A Date at LOCAL NOON on the given day. Noon rather than midnight because a
 * DST spring-forward can erase 00:00 entirely, which would silently shift the
 * day. Only for handing days to APIs that insist on Dates (react-day-picker).
 */
export function fromPuzzleDay(day: PuzzleDay): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12)
}

export function monthOf(day: PuzzleDay): PuzzleMonth {
  return day.slice(0, 7)
}

/**
 * Inclusive string bounds for an index range query over a month.
 *
 * `end` is '<month>-31' even in February. It is a lexicographic bound, not a
 * date: no real day string in the month can exceed it, and no day of the next
 * month can fall under it.
 */
export function monthRange(month: PuzzleMonth): { start: PuzzleDay; end: PuzzleDay } {
  return { start: `${month}-01`, end: `${month}-31` }
}

export function daysOfMonth(month: PuzzleMonth): Array<PuzzleDay> {
  const [year, monthNum] = month.split('-').map(Number)
  // Day 0 of the following month is the last day of this one.
  const count = new Date(year, monthNum, 0).getDate()
  return Array.from({ length: count }, (_, i) => `${month}-${pad(i + 1)}`)
}

export function isWeekendDay(day: PuzzleDay): boolean {
  const dayOfWeek = fromPuzzleDay(day).getDay()
  return dayOfWeek === 0 || dayOfWeek === 6
}

export function addMonths(month: PuzzleMonth, delta: number): PuzzleMonth {
  const [year, monthNum] = month.split('-').map(Number)
  const shifted = new Date(year, monthNum - 1 + delta, 1)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm test:once convex/lib/puzzleDay.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing board test**

Create `v2/convex/lib/board.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { attemptsFor, boardIsValid, normalizeGuesses, toRows } from './board'

describe('toRows', () => {
  test('pads to six rows without mutating the input', () => {
    const guesses = ['CRANE']
    expect(toRows(guesses)).toEqual(['CRANE', '', '', '', '', ''])
    expect(guesses).toEqual(['CRANE'])
  })
})

describe('attemptsFor', () => {
  test('counts the guesses it took', () => {
    expect(attemptsFor(['CRANE', 'SPEED'], 'SPEED')).toBe(3 - 1)
  })

  test('returns 7 when six guesses did not reach the answer', () => {
    const missed = ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST', 'MUSIC']
    expect(attemptsFor(missed, 'SPEED')).toBe(7)
  })

  test('tolerates the trailing empty guess copied rows carry', () => {
    // v1's upsertBoard appends a '' sentinel to a failed six-guess board, so
    // copied rows can hold seven entries. DailyScore's constructor filtered it
    // on read; we filter it here. v2 writes no sentinel of its own.
    const missed = ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST', 'MUSIC', '']
    expect(attemptsFor(missed, 'SPEED')).toBe(7)
  })

  test('an empty board is zero attempts', () => {
    expect(attemptsFor(['', '', '', '', '', ''], 'SPEED')).toBe(0)
  })
})

describe('normalizeGuesses', () => {
  test('drops empty rows', () => {
    expect(normalizeGuesses(['CRANE', '', 'SPEED', ''])).toEqual(['CRANE', 'SPEED'])
  })
})

describe('boardIsValid', () => {
  const solved = ['CRANE', 'SPEED', '', '', '', '']

  test('accepts a solved board whose last guess is the answer', () => {
    expect(boardIsValid('SPEED', solved, false)).toBe(true)
  })

  test('rejects a board whose last guess is not the answer', () => {
    expect(boardIsValid('SPEED', ['CRANE', 'SLATE', '', '', '', ''], false)).toBe(false)
  })

  test('accepts a full six-row board even though it never reached the answer', () => {
    const missed = ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST', 'MUSIC']
    expect(boardIsValid('SPEED', missed, false)).toBe(true)
  })

  test('rejects a partial guess', () => {
    expect(boardIsValid('SPEED', ['CRA', '', '', '', '', ''], false)).toBe(false)
  })

  test('rejects a short answer', () => {
    expect(boardIsValid('SPE', solved, false)).toBe(false)
  })

  test('rejects a board with no guesses at all', () => {
    expect(boardIsValid('SPEED', ['', '', '', '', '', ''], false)).toBe(false)
  })

  test('an empty board is the delete case, valid only when a score exists', () => {
    const blank = ['', '', '', '', '', '']
    expect(boardIsValid('', blank, true)).toBe(true)
    expect(boardIsValid('', blank, false)).toBe(false)
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm test:once convex/lib/board.test.ts`
Expected: FAIL — `Failed to resolve import "./board"`.

- [ ] **Step 7: Write `board.ts`**

Create `v2/convex/lib/board.ts`:

```ts
/**
 * What makes a board well-formed, and how many attempts it represents.
 *
 * Ported from v1's src/components/action-buttons/board-entry/utils.ts and the
 * DailyScore class in src/lib/types.ts. Shared between the submit button's
 * disabled state and the mutation's server-side check, so the two cannot
 * disagree about what "complete" means.
 */

/** Pad a guess list out to the board's six rows. Non-mutating, unlike v1's padArray. */
export function toRows(guesses: Array<string>, rows = 6): Array<string> {
  return Array.from({ length: rows }, (_, i) => guesses[i] ?? '')
}

/** Drop empty rows. v1's DailyScore constructor does this on every read. */
export function normalizeGuesses(guesses: Array<string>): Array<string> {
  return guesses.filter((guess) => guess.length > 0)
}

/**
 * Attempts a board represents: the guess count, or 7 for a failure.
 *
 * The empty-string filter is load-bearing rather than defensive. v1's
 * upsertBoard appends a '' sentinel to a failed six-guess board, so COPIED ROWS
 * CAN HOLD SEVEN ENTRIES. Counting them raw would report 7 guesses on a board
 * that had 6.
 */
export function attemptsFor(guesses: Array<string>, answer: string): number {
  const played = normalizeGuesses(guesses)
  if (played.length >= 6 && played[5] !== answer) return 7
  return played.length
}

/**
 * Whether a board can be submitted.
 *
 * Two ways to be valid, exactly as v1: completely empty when a score already
 * exists (which submits a DELETE), or a complete board — five-letter answer,
 * a first guess, every guess either empty or five letters, and either all six
 * rows used or a last guess equal to the answer.
 */
export function boardIsValid(
  answer: string,
  guesses: Array<string>,
  hasExistingScore: boolean,
): boolean {
  const rows = toRows(guesses)
  const isEmpty = answer.length === 0 && rows.every((guess) => guess.length === 0)
  if (isEmpty) return hasExistingScore

  const played = normalizeGuesses(rows)
  return (
    answer.length === 5 &&
    rows[0].length === 5 &&
    rows.every((guess) => guess.length === 0 || guess.length === 5) &&
    (rows[5].length === 5 || played[played.length - 1] === answer)
  )
}
```

- [ ] **Step 8: Point `src/lib/wordle.ts` at the shared `toRows`**

`toRows` now has two homes. Delete the copy in `v2/src/lib/wordle.ts` and re-export the shared one so `wordle-board.tsx` and the existing `wordle.test.ts` keep working untouched. Replace the `toRows` function in that file with:

```ts
// toRows lives in convex/lib/board.ts so the mutation and the browser agree on
// what a board's six rows are. Re-exported here because this module is the
// board components' entry point.
export { toRows } from '../../convex/lib/board.ts'
```

- [ ] **Step 9: Run the tests and confirm nothing regressed**

Run: `pnpm test:once`
Expected: PASS — the new board tests plus the pre-existing `src/lib/wordle.test.ts` suite.

- [ ] **Step 10: Write the failing scoring test**

Create `v2/convex/lib/scoring.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { monthTotal, pointsFor, winnerOf, type ScoringSystem } from './scoring'

// v1's default system: src/lib/types.ts defaultSystem.
const system: ScoringSystem = {
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
}

describe('pointsFor', () => {
  test('maps each attempt count to its configured value', () => {
    expect(pointsFor(1, system)).toBe(5)
    expect(pointsFor(4, system)).toBe(1)
    expect(pointsFor(6, system)).toBe(-1)
    expect(pointsFor(7, system)).toBe(-3)
  })

  test('zero attempts scores the N/A value', () => {
    expect(pointsFor(0, system)).toBe(0)
  })

  test('is total — an impossible count cannot throw', () => {
    // v1's getScore throws "No score value found for number of attempts" on a
    // miss. This runs inside the board-entry transaction, where a throw would
    // fail the user's board, so it must not be reachable.
    expect(pointsFor(99, system)).toBe(0)
  })
})

describe('monthTotal', () => {
  const played = (puzzleDay: string, guesses: Array<string>, answer: string) => ({
    puzzleDay,
    guesses,
    answer,
  })

  test('sums the days that were played', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [
        played('2026-08-03', ['SPEED'], 'SPEED'), // 1 attempt -> 5
        played('2026-08-04', ['CRANE', 'SPEED'], 'SPEED'), // 2 -> 3
      ],
      system,
      playWeekends: true,
      today: '2026-08-05',
    })
    // The 1st and 2nd are a weekend but playWeekends is on, so they are missed
    // days before today: 0 each. The 3rd and 4th score 5 and 3.
    expect(total).toBe(8)
  })

  test('a missed day before today scores the N/A value', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [],
      system: { ...system, nA: -2 },
      playWeekends: true,
      today: '2026-08-04',
    })
    // The 1st, 2nd and 3rd are past; the 4th onward is not.
    expect(total).toBe(-6)
  })

  test('days from today onward contribute nothing', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [],
      system: { ...system, nA: -2 },
      playWeekends: true,
      today: '2026-08-01',
    })
    expect(total).toBe(0)
  })

  test('weekends are skipped entirely when the team does not play them', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [],
      system: { ...system, nA: -2 },
      playWeekends: false,
      today: '2026-08-04',
    })
    // 2026-08-01 is a Saturday and the 2nd a Sunday, so only the 3rd counts.
    expect(total).toBe(-2)
  })

  test('a failed board scores the failure value', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [played('2026-08-01', ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST', 'MUSIC'], 'SPEED')],
      system,
      playWeekends: true,
      today: '2026-08-02',
    })
    expect(total).toBe(-3)
  })

  test('when a day holds duplicate rows the first one wins, as v1 renders it', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [
        played('2026-08-01', ['SPEED'], 'SPEED'), // 5
        played('2026-08-01', ['CRANE', 'SLATE', 'SPEED'], 'SPEED'), // 2
      ],
      system,
      playWeekends: true,
      today: '2026-08-02',
    })
    expect(total).toBe(5)
  })
})

describe('winnerOf', () => {
  test('picks the highest total', () => {
    expect(winnerOf([{ playerId: 'a', total: 3 }, { playerId: 'b', total: 9 }])).toBe('b')
  })

  test('breaks a tie in favour of the first player, as v1 does', () => {
    // v1 compares with a strict > while walking players in team order, so the
    // incumbent keeps the crown on a tie.
    expect(winnerOf([{ playerId: 'a', total: 9 }, { playerId: 'b', total: 9 }])).toBe('a')
  })

  test('handles negative totals rather than defaulting to nobody', () => {
    expect(winnerOf([{ playerId: 'a', total: -8 }, { playerId: 'b', total: -3 }])).toBe('b')
  })

  test('returns null when there is nobody to win', () => {
    expect(winnerOf([])).toBeNull()
  })
})
```

- [ ] **Step 11: Run it and watch it fail**

Run: `pnpm test:once convex/lib/scoring.test.ts`
Expected: FAIL — `Failed to resolve import "./scoring"`.

- [ ] **Step 12: Write `scoring.ts`**

Create `v2/convex/lib/scoring.ts`:

```ts
import { attemptsFor } from './board.ts'
import { daysOfMonth, isWeekendDay, type PuzzleDay, type PuzzleMonth } from './puzzleDay.ts'

/**
 * Month aggregation and winner selection, ported from v1's
 * Player.aggregateScoreByMonth and Team.thisMonthsCurrentWinner.
 *
 * Shared by the scores table and by the winner recomputation inside
 * upsertBoard, which is the only thing keeping the standings the user reads and
 * the standings we store from drifting apart.
 */

/** The team's per-outcome point values. Structurally satisfied by a `teams` doc. */
export type ScoringSystem = {
  oneGuess: number
  twoGuesses: number
  threeGuesses: number
  fourGuesses: number
  fiveGuesses: number
  sixGuesses: number
  failed: number
  nA: number
}

export type ScoredDay = {
  puzzleDay: PuzzleDay
  guesses: Array<string>
  answer?: string
}

/**
 * Points for an attempt count.
 *
 * TOTAL BY CONSTRUCTION — every branch returns. v1's getScore looked the count
 * up in an array and threw on a miss; v2's system is eight named schema fields,
 * so there is nothing to miss. This runs inside the board-entry transaction,
 * where a throw would roll back the user's board.
 */
export function pointsFor(attempts: number, system: ScoringSystem): number {
  switch (attempts) {
    case 1:
      return system.oneGuess
    case 2:
      return system.twoGuesses
    case 3:
      return system.threeGuesses
    case 4:
      return system.fourGuesses
    case 5:
      return system.fiveGuesses
    case 6:
      return system.sixGuesses
    case 7:
      return system.failed
    default:
      return system.nA
  }
}

/**
 * One player's total for one month.
 *
 * `today` is supplied by the caller rather than read from a clock: the client
 * sends its own local today, and the pure function stays deterministic and
 * testable. Days from `today` onward are not yet due and score nothing; earlier
 * days with no board score the team's N/A value, which is how v1 penalises a
 * miss.
 */
export function monthTotal(opts: {
  month: PuzzleMonth
  scores: Array<ScoredDay>
  system: ScoringSystem
  playWeekends: boolean
  today: PuzzleDay
}): number {
  const { month, scores, system, playWeekends, today } = opts

  // First row wins for a day. Production holds 5 duplicate (player, day) pairs
  // that the copy deliberately preserved, and v1's find() takes the first too.
  const byDay = new Map<PuzzleDay, ScoredDay>()
  for (const score of scores) {
    if (!byDay.has(score.puzzleDay)) byDay.set(score.puzzleDay, score)
  }

  return daysOfMonth(month).reduce((total, day) => {
    if (!playWeekends && isWeekendDay(day)) return total
    const score = byDay.get(day)
    if (score) return total + pointsFor(attemptsFor(score.guesses, score.answer ?? ''), system)
    // Lexicographic compare — 'YYYY-MM-DD' sorts chronologically.
    if (day < today) return total + system.nA
    return total
  }, 0)
}

export type PlayerTotal = { playerId: string; total: number }

/**
 * The month's winner, or null when there is nobody to win.
 *
 * Strict `>` while walking the list in order, so THE FIRST PLAYER AT THE MAXIMUM
 * WINS A TIE. That is v1's behaviour and callers rely on it being stable.
 */
export function winnerOf(players: Array<PlayerTotal>): string | null {
  let best: PlayerTotal | null = null
  for (const player of players) {
    if (best === null || player.total > best.total) best = player
  }
  return best?.playerId ?? null
}
```

- [ ] **Step 13: Run the whole suite**

Run: `pnpm test:once`
Expected: PASS, all files.

- [ ] **Step 14: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output.

- [ ] **Step 15: Commit**

```bash
git add v2/convex/lib v2/src/lib/wordle.ts
git commit -m "feat(v2): pure day-string, board and scoring core shared by client and server (wt-ksh.3.3)"
```

---

## Task 2: Access-check helpers

These replace the Supabase RLS policies, per the parent design's logic-relocation table.

The membership check takes an **explicit `playerId`** in its testable form (`requireTeamMemberFor`) and gets wrapped by the auth-resolving form (`requireTeamMember`). That split is deliberate: it lets `convex-test` prove a non-member is refused against real documents without having to stand up a Better Auth session inside the test harness.

**Files:**
- Create: `v2/convex/access.ts`
- Test: `v2/convex/access.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/convex/access.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { playerForEmail, requireTeamMemberFor } from './access'

const modules = import.meta.glob('./**/*.ts')

const aPlayer = (over: Record<string, unknown> = {}) => ({
  legacyId: '11111111-1111-4111-8111-111111111111',
  email: 'member@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '18:00:00',
  ...over,
})

const aTeam = (over: Record<string, unknown> = {}) => ({
  legacyId: 206,
  name: 'team 206',
  playerIds: [],
  invited: [],
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
  playWeekends: true,
  showLetters: true,
  ...over,
})

describe('playerForEmail', () => {
  test('matches case-insensitively', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('players', aPlayer())
      // Copied emails are always lowercase; a provider may hand back any case.
      const found = await playerForEmail(ctx, 'Member@Example.COM')
      expect(found?._id).toBe(id)
    })
  })

  test('returns null when no copied player matches', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      expect(await playerForEmail(ctx, 'nobody@example.com')).toBeNull()
    })
  })
})

describe('requireTeamMemberFor', () => {
  test('returns the team to a member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const team = await requireTeamMemberFor(ctx, playerId, teamId)
      expect(team._id).toBe(teamId)
    })
  })

  test('refuses a non-member — the RLS policy this replaces', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const memberId = await ctx.db.insert('players', aPlayer())
      const outsiderId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '22222222-2222-4222-8222-222222222222',
          email: 'outsider@example.com',
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [memberId] }))

      await expect(requireTeamMemberFor(ctx, outsiderId, teamId)).rejects.toThrow(ConvexError)
      await expect(requireTeamMemberFor(ctx, outsiderId, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  test('refuses a team that does not exist', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.delete(teamId)
      await expect(requireTeamMemberFor(ctx, playerId, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:once convex/access.test.ts`
Expected: FAIL — `Failed to resolve import "./access"`.

- [ ] **Step 3: Write `access.ts`**

Create `v2/convex/access.ts`:

```ts
import { ConvexError } from 'convex/values'
import { authComponent } from './auth'
import type { Doc, Id } from './_generated/dataModel'
import type { GenericDatabaseReader } from 'convex/server'
import type { DataModel } from './_generated/dataModel'

/**
 * The access checks that replace Supabase's RLS policies.
 *
 * v1 enforced reads in the database; Convex has no equivalent, so every query
 * and mutation calls one of these FIRST. See the parent design's Postgres logic
 * relocation table.
 *
 * The membership check comes in two forms on purpose. requireTeamMemberFor takes
 * an explicit playerId and is what the tests exercise, so the negative cases can
 * be proven against real documents without standing up a Better Auth session in
 * the harness. requireTeamMember is the thin wrapper the functions actually call.
 */

export type AccessCode = 'UNAUTHENTICATED' | 'NO_PLAYER' | 'NOT_A_MEMBER' | 'INVALID_BOARD'

export function accessError(code: AccessCode): ConvexError<{ code: AccessCode }> {
  return new ConvexError({ code })
}

/** Anything with a `db` reader — a query, mutation, or a convex-test `ctx.run`. */
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

/**
 * The copied player behind an email address.
 *
 * THE LINK IS BY EMAIL, for the reason me.ts spells out: copied players carry a
 * Supabase legacyId but nothing joins them to a Better Auth user id. Normalised
 * to lowercase because copied emails always are and a provider may not be.
 *
 * .first() rather than .unique(): a duplicate email would be a real data problem,
 * but throwing here would take down the signed-in page instead of showing the
 * user their teams.
 */
export async function playerForEmail(
  ctx: ReaderCtx,
  email: string,
): Promise<Doc<'players'> | null> {
  return await ctx.db
    .query('players')
    .withIndex('by_email', (q) => q.eq('email', email.toLowerCase()))
    .first()
}

/** The signed-in user's player, or null if there is no session or no match. */
export async function currentPlayer(ctx: ReaderCtx): Promise<Doc<'players'> | null> {
  const user = await authComponent.getAuthUser(ctx as never)
  if (!user?.email) return null
  return await playerForEmail(ctx, user.email)
}

/** The signed-in user's player, or a typed throw. */
export async function requirePlayer(ctx: ReaderCtx): Promise<Doc<'players'>> {
  const user = await authComponent.getAuthUser(ctx as never)
  if (!user?.email) throw accessError('UNAUTHENTICATED')
  const player = await playerForEmail(ctx, user.email)
  if (!player) throw accessError('NO_PLAYER')
  return player
}

/**
 * The team, if that player is on it. Throws NOT_A_MEMBER otherwise — including
 * when the team does not exist, so a probe cannot distinguish "no such team"
 * from "not yours".
 */
export async function requireTeamMemberFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<Doc<'teams'>> {
  const team = await ctx.db.get(teamId)
  if (!team) throw accessError('NOT_A_MEMBER')
  if (!team.playerIds.includes(playerId)) throw accessError('NOT_A_MEMBER')
  return team
}

/** The signed-in player and a team they belong to. */
export async function requireTeamMember(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
): Promise<{ player: Doc<'players'>; team: Doc<'teams'> }> {
  const player = await requirePlayer(ctx)
  const team = await requireTeamMemberFor(ctx, player._id, teamId)
  return { player, team }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm test:once convex/access.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/convex/access.ts v2/convex/access.test.ts
git commit -m "feat(v2): access-check helpers replacing the RLS policies (wt-ksh.3.4)"
```

---

## Task 3: Read queries — `getMyTeams` and `getTeamMonth`

**Files:**
- Create: `v2/convex/scores.ts`
- Test: `v2/convex/scores.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/convex/scores.test.ts`. Note the shared fixtures — Tasks 4 and 5 append to this file and reuse them.

```ts
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { getTeamMonthFor } from './scores'

const modules = import.meta.glob('./**/*.ts')

export const aPlayer = (over: Record<string, unknown> = {}) => ({
  legacyId: '11111111-1111-4111-8111-111111111111',
  email: 'member@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '18:00:00',
  ...over,
})

export const aTeam = (over: Record<string, unknown> = {}) => ({
  legacyId: 206,
  name: 'team 206',
  playerIds: [],
  invited: [],
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
  playWeekends: true,
  showLetters: true,
  ...over,
})

describe('getTeamMonthFor', () => {
  test('returns only the requested month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      for (const puzzleDay of ['2026-07-31', '2026-08-01', '2026-08-31', '2026-09-01']) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }

      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')
      expect(result.players[0].scores.map((s) => s.puzzleDay)).toEqual([
        '2026-08-01',
        '2026-08-31',
      ])
    })
  })

  test('carries the team settings and scoring system the table needs', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId], playWeekends: false }))
      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')
      expect(result.team.playWeekends).toBe(false)
      expect(result.team.system.oneGuess).toBe(5)
      expect(result.team.system.failed).toBe(-3)
    })
  })

  test('omits players who have not completed their profile', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const namedId = await ctx.db.insert('players', aPlayer())
      // A just-accepted invitee is in player_ids but has no name yet. v1's
      // getTeams filters these out because fromDbPlayer throws without names.
      const namelessId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '33333333-3333-4333-8333-333333333333',
          email: 'invited@example.com',
          firstName: undefined,
          lastName: undefined,
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [namedId, namelessId] }))

      const result = await getTeamMonthFor(ctx, namedId, teamId, '2026-08')
      expect(result.players).toHaveLength(1)
      expect(result.players[0].id).toBe(namedId)
    })
  })

  test('refuses a non-member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const memberId = await ctx.db.insert('players', aPlayer())
      const outsiderId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '22222222-2222-4222-8222-222222222222',
          email: 'outsider@example.com',
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [memberId] }))

      await expect(getTeamMonthFor(ctx, outsiderId, teamId, '2026-08')).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:once convex/scores.test.ts`
Expected: FAIL — `Failed to resolve import "./scores"`.

- [ ] **Step 3: Write the queries**

Create `v2/convex/scores.ts`:

```ts
import { v } from 'convex/values'
import { query } from './_generated/server'
import { currentPlayer, requirePlayer, requireTeamMemberFor } from './access'
import { monthRange } from './lib/puzzleDay.ts'
import type { Id } from './_generated/dataModel'
import type { GenericDatabaseReader } from 'convex/server'
import type { DataModel } from './_generated/dataModel'

type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

/**
 * The core loop's reads.
 *
 * SCOPED TO ONE TEAM AND ONE MONTH, deliberately. v1 loaded every team, every
 * player and every score ever into a client context and computed from there.
 * Convex re-pushes a query's whole result to every subscriber on every write,
 * and wordle-teams-dcu flags database BANDWIDTH — not function calls — as the
 * binding free-tier limit, so porting that shape would have made a board entry
 * re-broadcast all of history.
 *
 * Each exported Convex function delegates to a plain `...For` helper that takes
 * an explicit playerId. That is what convex-test exercises, so the access
 * behaviour can be proven without a Better Auth session in the harness.
 */

export async function getTeamMonthFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  month: string,
) {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  const { start, end } = monthRange(month)

  const players = []
  for (const memberId of team.playerIds) {
    const member = await ctx.db.get(memberId)
    if (!member) continue
    // v1's getTeams excludes players without a completed profile: a
    // just-accepted invitee sits in player_ids with no name, and v1's
    // fromDbPlayer throws on one, crashing the client render.
    if (!member.firstName || !member.lastName) continue

    const scores = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', memberId).gte('puzzleDay', start).lte('puzzleDay', end),
      )
      .collect()

    players.push({
      id: member._id,
      firstName: member.firstName,
      lastName: member.lastName,
      scores: scores.map((score) => ({
        id: score._id,
        puzzleDay: score.puzzleDay,
        answer: score.answer ?? '',
        guesses: score.guesses,
      })),
    })
  }

  return {
    team: {
      id: team._id,
      name: team.name,
      playWeekends: team.playWeekends,
      showLetters: team.showLetters,
      // A `teams` doc structurally satisfies ScoringSystem, but pick the fields
      // explicitly so the wire payload does not carry the invite list.
      system: {
        oneGuess: team.oneGuess,
        twoGuesses: team.twoGuesses,
        threeGuesses: team.threeGuesses,
        fourGuesses: team.fourGuesses,
        fiveGuesses: team.fiveGuesses,
        sixGuesses: team.sixGuesses,
        failed: team.failed,
        nA: team.nA,
      },
    },
    players,
  }
}

export const getTeamMonth = query({
  args: { teamId: v.id('teams'), month: v.string() },
  handler: async (ctx, { teamId, month }) => {
    const player = await requirePlayer(ctx)
    return await getTeamMonthFor(ctx, player._id, teamId, month)
  },
})

/**
 * Just enough to drive the team selector. Real team management is Phase 3.
 *
 * Collect-and-filter is the sanctioned approach for "teams containing player X":
 * Convex cannot index array membership and production holds 171 teams in total.
 * See the schema comment on `teams`.
 */
export const getMyTeams = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return []
    const teams = await ctx.db.query('teams').collect()
    return teams
      .filter((team) => team.playerIds.includes(player._id))
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .map((team) => ({ id: team._id, name: team.name }))
  },
})

/**
 * The caller's own player id.
 *
 * Board entry needs to know which row of getTeamMonth is "you" so it can load
 * the day you already submitted. Matching on name would be the obvious shortcut
 * and is wrong — two players on a team can share a name, and v1's own table code
 * has a whole disambiguation branch proving it happens.
 */
export const getMyPlayerId = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    return player?._id ?? null
  },
})
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm test:once convex/scores.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/convex/scores.ts v2/convex/scores.test.ts
git commit -m "feat(v2): team-and-month scoped read queries (wt-ksh.3.5)"
```

---

## Task 4: `upsertBoard`

**Depends on Task 0.**

**Files:**
- Modify: `v2/convex/scores.ts`
- Test: `v2/convex/scores.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/scores.test.ts`:

```ts
describe('upsertBoardFor', () => {
  test('creates a board', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const result = await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: ['CRANE', 'SPEED', '', '', '', ''],
        today: '2026-08-18',
      })
      expect(result.action).toBe('create')

      const rows = await ctx.db.query('dailyScores').collect()
      expect(rows).toHaveLength(1)
      // Empty rows are dropped on write; v1's DailyScore does the same on read.
      expect(rows[0].guesses).toEqual(['CRANE', 'SPEED'])
      expect(rows[0].puzzleDay).toBe('2026-08-18')
      expect(rows[0].legacyId).toBeUndefined()
    })
  })

  test('a second submit for the same day updates rather than duplicating', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const board = {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: ['CRANE', 'SPEED', '', '', '', ''],
        today: '2026-08-18',
      }
      await upsertBoardFor(ctx, playerId, board)
      const second = await upsertBoardFor(ctx, playerId, {
        ...board,
        guesses: ['CRANE', 'SLATE', 'SPEED', '', '', ''],
      })

      expect(second.action).toBe('update')
      // v1 inserted a fresh row whenever the client had no scoreId, so a double
      // submit made two. Production holds 5 such pairs (wordle-teams-rac).
      const rows = await ctx.db.query('dailyScores').collect()
      expect(rows).toHaveLength(1)
      expect(rows[0].guesses).toEqual(['CRANE', 'SLATE', 'SPEED'])
    })
  })

  test('an emptied board deletes the score', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: ['SPEED', '', '', '', '', ''],
        today: '2026-08-18',
      })
      const result = await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: '',
        guesses: ['', '', '', '', '', ''],
        today: '2026-08-18',
      })

      expect(result.action).toBe('delete')
      expect(await ctx.db.query('dailyScores').collect()).toHaveLength(0)
    })
  })

  test('rejects an incomplete board even though the UI would not send one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await expect(
        upsertBoardFor(ctx, playerId, {
          puzzleDay: '2026-08-18',
          answer: 'SPEED',
          guesses: ['CRA', '', '', '', '', ''],
          today: '2026-08-18',
        }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_BOARD' } })
    })
  })

  test('rejects emptying a day that has no score', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await expect(
        upsertBoardFor(ctx, playerId, {
          puzzleDay: '2026-08-18',
          answer: '',
          guesses: ['', '', '', '', '', ''],
          today: '2026-08-18',
        }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_BOARD' } })
    })
  })
})
```

Add `upsertBoardFor` to the import at the top of the file:

```ts
import { getTeamMonthFor, upsertBoardFor } from './scores'
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:once convex/scores.test.ts`
Expected: FAIL — `upsertBoardFor is not exported`.

- [ ] **Step 3: Write the mutation**

Append to `v2/convex/scores.ts`. Extend the imports first:

```ts
import { mutation, query } from './_generated/server'
import { accessError, currentPlayer, requirePlayer, requireTeamMemberFor } from './access'
import { boardIsValid, normalizeGuesses } from './lib/board.ts'
import { monthOf, monthRange } from './lib/puzzleDay.ts'
import type { GenericDatabaseWriter } from 'convex/server'
```

then add:

```ts
type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

export type BoardInput = {
  puzzleDay: string
  answer: string
  guesses: Array<string>
  today: string
}

/**
 * Create, update or delete one board, then recompute the standings it affects.
 *
 * KEYED ON (playerId, puzzleDay), which is what makes a duplicate row
 * impossible. v1 keyed on a client-held score id and inserted whenever the
 * client did not have one, so a double submit created a second row for the same
 * day — it has already done so 5 times in production (wordle-teams-rac). The 5
 * copied pairs are left exactly as they are; readers take the first, as v1 does.
 *
 * The winner recomputation runs in this same transaction, which is the whole
 * point: v1 saved the board and then made a separate RPC that could fail, so the
 * board landed while the standings went stale and the user was told "success".
 * Here both land or neither does.
 */
export async function upsertBoardFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  input: BoardInput,
): Promise<{ action: 'create' | 'update' | 'delete' }> {
  const { puzzleDay, answer, guesses, today } = input

  const existing = await ctx.db
    .query('dailyScores')
    .withIndex('by_player_and_puzzleDay', (q) =>
      q.eq('playerId', playerId).eq('puzzleDay', puzzleDay),
    )
    .first()

  // The server does not trust the client. Unreachable through the UI, which
  // disables submit on this same predicate — v1 had no server-side check at all.
  if (!boardIsValid(answer, guesses, existing !== null)) throw accessError('INVALID_BOARD')

  const played = normalizeGuesses(guesses)
  let action: 'create' | 'update' | 'delete'

  if (played.length === 0 && answer.length === 0) {
    // boardIsValid already guaranteed `existing` here.
    await ctx.db.delete(existing!._id)
    action = 'delete'
  } else if (existing) {
    await ctx.db.patch(existing._id, { answer, guesses: played })
    action = 'update'
  } else {
    await ctx.db.insert('dailyScores', {
      playerId,
      puzzleDay,
      // The audit instant. NOT for grouping — that is what puzzleDay is for.
      date: Date.now(),
      answer,
      guesses: played,
    })
    action = 'create'
  }

  await recomputeWinners(ctx, playerId, monthOf(puzzleDay), today)
  return { action }
}

export const upsertBoard = mutation({
  args: {
    puzzleDay: v.string(),
    answer: v.string(),
    guesses: v.array(v.string()),
    // The submitter's own local today. The server has no viewer and no correct
    // timezone to guess; see the design's "today" decision.
    today: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    return await upsertBoardFor(ctx, player._id, args)
  },
})
```

`recomputeWinners` arrives in Task 5. To keep this task's tests green on their own, add a temporary stub directly above `upsertBoardFor` — Task 5 replaces it:

```ts
// Replaced in Task 5. Declared here so upsertBoardFor is testable on its own.
async function recomputeWinners(
  _ctx: WriterCtx,
  _playerId: Id<'players'>,
  _month: string,
  _today: string,
): Promise<void> {}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm test:once convex/scores.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/convex/scores.ts v2/convex/scores.test.ts
git commit -m "feat(v2): upsertBoard keyed on (player, puzzleDay) so duplicates cannot recur (wt-ksh.3.6)"
```

---

## Task 5: Monthly-winner recomputation

**Depends on Tasks 0 and 4.** This is the relocation of the `update_monthly_winners` Postgres trigger.

**Files:**
- Modify: `v2/convex/scores.ts`
- Test: `v2/convex/scores.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/scores.test.ts`:

```ts
describe('monthly winners', () => {
  const solvedIn = (n: number, answer = 'SPEED') => {
    const filler = ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST']
    return [...filler.slice(0, n - 1), answer]
  }

  test('writes a winner row for every team the player is on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamA = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const teamB = await ctx.db.insert('teams', aTeam({ legacyId: 207, playerIds: [playerId] }))

      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(1),
        today: '2026-08-18',
      })

      const rows = await ctx.db.query('monthlyWinners').collect()
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.teamId).sort()).toEqual([teamA, teamB].sort())
      expect(rows.every((r) => r.playerId === playerId)).toBe(true)
      expect(rows.every((r) => r.year === 2026 && r.month === 8)).toBe(true)
    })
  })

  test('the highest total wins', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const adaId = await ctx.db.insert('players', aPlayer())
      const bobId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '44444444-4444-4444-8444-444444444444',
          email: 'bob@example.com',
          firstName: 'Bob',
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [adaId, bobId] }))

      // Ada solves in 4 (1 point), Bob in 1 (5 points).
      await upsertBoardFor(ctx, adaId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(4),
        today: '2026-08-19',
      })
      await upsertBoardFor(ctx, bobId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(1),
        today: '2026-08-19',
      })

      const row = await ctx.db.query('monthlyWinners').first()
      expect(row?.playerId).toBe(bobId)
      expect(row?.teamId).toBe(teamId)
    })
  })

  test('hasSeenCelebration survives a rewrite that does not change the winner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(1),
        today: '2026-08-19',
      })
      const first = await ctx.db.query('monthlyWinners').first()
      await ctx.db.patch(first!._id, { hasSeenCelebration: [playerId] })

      // Another board in the same month rewrites the row. v1's SQL deleted and
      // re-inserted, wiping the seen-list and re-firing the confetti at someone
      // who had already dismissed it.
      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-19',
        answer: 'CRANE',
        guesses: solvedIn(2, 'CRANE'),
        today: '2026-08-20',
      })

      const after = await ctx.db.query('monthlyWinners').first()
      expect(after?.hasSeenCelebration).toEqual([playerId])
    })
  })

  test('hasSeenCelebration resets when the winner actually changes', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const adaId = await ctx.db.insert('players', aPlayer())
      const bobId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '44444444-4444-4444-8444-444444444444',
          email: 'bob@example.com',
          firstName: 'Bob',
        }),
      )
      await ctx.db.insert('teams', aTeam({ playerIds: [adaId, bobId] }))

      await upsertBoardFor(ctx, adaId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(4),
        today: '2026-08-19',
      })
      const first = await ctx.db.query('monthlyWinners').first()
      expect(first?.playerId).toBe(adaId)
      await ctx.db.patch(first!._id, { hasSeenCelebration: [adaId] })

      await upsertBoardFor(ctx, bobId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(1),
        today: '2026-08-19',
      })

      const after = await ctx.db.query('monthlyWinners').first()
      expect(after?.playerId).toBe(bobId)
      expect(after?.hasSeenCelebration).toEqual([])
    })
  })

  test('only the affected month is rewritten', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const julyId = await ctx.db.insert('monthlyWinners', {
        playerId,
        teamId,
        year: 2026,
        month: 7,
        hasSeenCelebration: [playerId],
      })

      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(1),
        today: '2026-08-19',
      })

      const july = await ctx.db.get(julyId)
      expect(july?.hasSeenCelebration).toEqual([playerId])
      expect(await ctx.db.query('monthlyWinners').collect()).toHaveLength(2)
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:once convex/scores.test.ts`
Expected: FAIL — no `monthlyWinners` rows are written; the stub does nothing.

- [ ] **Step 3: Replace the stub**

In `v2/convex/scores.ts`, extend the imports:

```ts
import { monthTotal, winnerOf } from './lib/scoring.ts'
```

and replace the Task 4 stub with:

```ts
/**
 * Recompute the month's winner for every team the player belongs to.
 *
 * This is v1's update_monthly_winners trigger, relocated. Two differences from
 * the SQL, both deliberate:
 *
 * 1. The SQL DELETEs the row and re-INSERTs it, which silently wipes
 *    hasSeenCelebration every time anyone enters a board dated in that month —
 *    re-firing the confetti at someone who already dismissed it. Here the array
 *    survives an unchanged winner and resets only when the winner really changes.
 * 2. v1 computed this on the CLIENT for every team it had loaded and passed the
 *    result to the RPC. Here it is derived server-side inside the same
 *    transaction as the board write, so it cannot be stale or forged.
 */
async function recomputeWinners(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  month: string,
  today: string,
): Promise<void> {
  const [year, monthNum] = month.split('-').map(Number)
  const { start, end } = monthRange(month)

  const allTeams = await ctx.db.query('teams').collect()
  const teams = allTeams.filter((team) => team.playerIds.includes(playerId))

  for (const team of teams) {
    const totals = []
    for (const memberId of team.playerIds) {
      const member = await ctx.db.get(memberId)
      // Same exclusion as getTeamMonthFor: a profile-incomplete invitee is not
      // shown on the table and must not be able to win the month either.
      if (!member || !member.firstName || !member.lastName) continue

      const scores = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) =>
          q.eq('playerId', memberId).gte('puzzleDay', start).lte('puzzleDay', end),
        )
        .collect()

      totals.push({
        playerId: memberId,
        total: monthTotal({
          month,
          scores,
          // A `teams` doc structurally satisfies ScoringSystem.
          system: team,
          playWeekends: team.playWeekends,
          today,
        }),
      })
    }

    const winnerId = winnerOf(totals) as Id<'players'> | null
    const existing = await ctx.db
      .query('monthlyWinners')
      .withIndex('by_team_year_month', (q) =>
        q.eq('teamId', team._id).eq('year', year).eq('month', monthNum),
      )
      .first()

    if (!winnerId) {
      // Matches the SQL, which deletes unconditionally and re-inserts only where
      // winner_id is not null.
      if (existing) await ctx.db.delete(existing._id)
      continue
    }
    if (!existing) {
      await ctx.db.insert('monthlyWinners', {
        playerId: winnerId,
        teamId: team._id,
        year,
        month: monthNum,
        hasSeenCelebration: [],
      })
      continue
    }
    // Unchanged winner: leave the row, and the seen-list, alone.
    if (existing.playerId === winnerId) continue
    await ctx.db.patch(existing._id, { playerId: winnerId, hasSeenCelebration: [] })
  }
}
```

- [ ] **Step 4: Run the suite and confirm it passes**

Run: `pnpm test:once`
Expected: PASS, every file.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add v2/convex/scores.ts v2/convex/scores.test.ts
git commit -m "feat(v2): recompute monthly winners inside the score mutation (wt-ksh.3.7)"
```

---

## Task 6: Dashboard shell — search params, team picker, month picker

Team and month live in the URL. v1 kept them in a React context backed by localStorage and needed three separate hydration guards to stop the server and client disagreeing — and still shipped `wordle-teams-uc5`. Search params cannot mismatch, because the server and the client read the same URL.

**Files:**
- Create: `v2/src/lib/format-day.ts`, `v2/src/components/team-picker.tsx`, `v2/src/components/month-picker.tsx`
- Modify: `v2/src/routes/index.tsx`
- Test: `v2/src/lib/format-day.test.ts`

- [ ] **Step 1: Write the failing formatting test**

Create `v2/src/lib/format-day.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { formatDayHeader, formatMonthLabel, ordinal } from './format-day'

describe('ordinal', () => {
  test('handles the irregular ones', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
  })

  test('handles the teens, which are all th', () => {
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
  })

  test('handles the twenties and thirties', () => {
    expect(ordinal(21)).toBe('21st')
    expect(ordinal(22)).toBe('22nd')
    expect(ordinal(23)).toBe('23rd')
    expect(ordinal(31)).toBe('31st')
  })
})

describe('formatDayHeader', () => {
  test('matches v1 formatting, EE do', () => {
    // 2026-08-03 is a Monday.
    expect(formatDayHeader('2026-08-03')).toBe('Mon 3rd')
  })
})

describe('formatMonthLabel', () => {
  test('matches v1 formatting, MMM yyyy', () => {
    expect(formatMonthLabel('2026-08')).toBe('Aug 2026')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:once src/lib/format-day.test.ts`
Expected: FAIL — `Failed to resolve import "./format-day"`.

- [ ] **Step 3: Write `format-day.ts`**

Create `v2/src/lib/format-day.ts`:

```ts
import { fromPuzzleDay, type PuzzleDay, type PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * Day and month labels, matching v1's date-fns 'EE do' and 'MMM yyyy'.
 *
 * Intl rather than date-fns: nothing else in v2 needs a date library, and the
 * only thing Intl will not do is the ordinal suffix, which is six lines.
 * Locale is pinned to en-US because the labels are compared against v1's output
 * during the Phase 7 parity audit.
 */

const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })

export function ordinal(n: number): string {
  // 11th, 12th and 13th are the exceptions to the 1st/2nd/3rd pattern.
  const teen = n % 100
  if (teen >= 11 && teen <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** 'Mon 3rd' — the scores table's day column header. */
export function formatDayHeader(day: PuzzleDay): string {
  const date = fromPuzzleDay(day)
  return `${weekday.format(date)} ${ordinal(date.getDate())}`
}

/** 'Aug 2026' — the month picker's label. */
export function formatMonthLabel(month: PuzzleMonth): string {
  return monthYear.format(fromPuzzleDay(`${month}-01`))
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm test:once src/lib/format-day.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the Convex error helper**

The spec's error-handling table maps typed codes to UI. Create `v2/src/lib/convex-error.ts`:

```ts
import { ConvexError } from 'convex/values'
import type { AccessCode } from '../../convex/access'

/**
 * The typed code behind a thrown ConvexError, or null for anything else.
 *
 * The parent design's error-handling contract is "mutations throw ConvexError
 * with typed codes; UI maps codes to sonner toasts". Everything that is not one
 * of ours — a dropped connection, a platform 5xx — returns null and gets the
 * generic recovery message, which is the case that must never lose a board.
 */
export function convexErrorCode(error: unknown): AccessCode | null {
  if (!(error instanceof ConvexError)) return null
  const data = error.data as { code?: string } | undefined
  const code = data?.code
  if (
    code === 'UNAUTHENTICATED' ||
    code === 'NO_PLAYER' ||
    code === 'NOT_A_MEMBER' ||
    code === 'INVALID_BOARD'
  ) {
    return code
  }
  return null
}

/** What to tell the user, per the spec's error table. */
export function boardErrorMessage(error: unknown): string {
  switch (convexErrorCode(error)) {
    case 'UNAUTHENTICATED':
    case 'NO_PLAYER':
      return 'Your session expired. Please sign in again.'
    case 'NOT_A_MEMBER':
      return 'You are not on that team any more.'
    case 'INVALID_BOARD':
      return 'That board is not complete. Check the answer and your guesses.'
    default:
      // The a335ae8 message, verbatim: the entry is still on screen and the user
      // needs to know that before anything else.
      return 'Could not save your board. Your entry is still here — please try again.'
  }
}
```

- [ ] **Step 6: Write the team picker**

Create `v2/src/components/team-picker.tsx`:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select.tsx'

/**
 * Read-only team selection. Creating, renaming and managing teams is Phase 3;
 * this exists because a scoreboard needs to know which team it is showing.
 */
export type TeamOption = { id: string; name: string }

export function TeamPicker({
  teams,
  value,
  onChange,
}: {
  teams: Array<TeamOption>
  value: string
  onChange: (teamId: string) => void
}) {
  if (teams.length === 0) return null

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44" aria-label="Team">
        <SelectValue placeholder="Pick a team" />
      </SelectTrigger>
      <SelectContent>
        {teams.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default TeamPicker
```

- [ ] **Step 7: Write the month picker**

Create `v2/src/components/month-picker.tsx`:

```tsx
import { ChevronDown } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { formatMonthLabel } from '#/lib/format-day.ts'
import { addMonths, type PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * The current month and the two before it — what v1 shows a free account.
 *
 * The pro expansion (back to the team's earliest score) ships with the rest of
 * the pro gate, not here. Note that in v1 this window is a UI affordance rather
 * than access control: every score is loaded client-side regardless. Whether the
 * gate should be enforced server-side is a question for the phase that adds it.
 */
export function monthOptions(currentMonth: PuzzleMonth): Array<PuzzleMonth> {
  return [addMonths(currentMonth, -2), addMonths(currentMonth, -1), currentMonth]
}

export function MonthPicker({
  currentMonth,
  value,
  onChange,
}: {
  currentMonth: PuzzleMonth
  value: PuzzleMonth
  onChange: (month: PuzzleMonth) => void
}) {
  const options = monthOptions(currentMonth)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="px-2 text-xs md:px-4 md:text-sm">
          {formatMonthLabel(value)}
          <ChevronDown className="ml-1 h-4 w-4 md:ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Change Month</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {formatMonthLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default MonthPicker
```

- [ ] **Step 8: Rewrite the dashboard route**

Replace the body of `v2/src/routes/index.tsx`. Keep the existing `head`, `beforeLoad` and the login-funnel effect exactly as they are — that effect is the bottom of the funnel `wt-ksh.12.7` measures and must not be disturbed.

```tsx
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { SIGNIN_PARAM, trackFunnel } from '#/lib/funnel.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { MonthPicker } from '#/components/month-picker.tsx'
import { TeamPicker } from '#/components/team-picker.tsx'
import { ScoresTable } from '#/components/scores-table.tsx'
import { BoardEntryButton } from '#/components/board-entry/button.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Id } from '../../convex/_generated/dataModel'

type DashboardSearch = { team?: string; month?: string }

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }] }),
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    team: typeof search.team === 'string' ? search.team : undefined,
    // Anything not shaped like a month is dropped rather than trusted; the
    // effect below then fills in the local current month.
    month:
      typeof search.month === 'string' && /^\d{4}-\d{2}$/.test(search.month)
        ? search.month
        : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.scores.getMyTeams, {}))
  },
  component: Dashboard,
})

function Dashboard() {
  const { team: teamParam, month: monthParam } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const hydrated = useHydrated()
  const { data: teams } = useSuspenseQuery(convexQuery(api.scores.getMyTeams, {}))

  // Bottom of the login funnel (wt-ksh.12.7). Reaching here authenticated is the
  // only reliable "they made it" signal: the OAuth round-trip finishes as a fresh
  // document load, so nothing on /login survives to observe it. The marker is
  // stripped from the URL immediately so a refresh or a share cannot double-count.
  useEffect(() => {
    const url = new URL(window.location.href)
    const method = url.searchParams.get(SIGNIN_PARAM)
    if (method !== 'oauth' && method !== 'otp') return
    trackFunnel({ name: 'login_callback_arrived', method })
    url.searchParams.delete(SIGNIN_PARAM)
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }, [])

  // Fill in whatever the URL did not specify, AFTER hydration.
  //
  // The current month has to come from the browser's local clock, and reading it
  // during render would make the server (UTC) and the client (local) disagree on
  // the last and first days of a month — the hydration-mismatch class that
  // 45e3cd6 fixed in v1 and that wordle-teams-uc5 was. The URL is the source of
  // truth; localStorage only supplies the default.
  useEffect(() => {
    if (!hydrated) return
    if (teamParam && monthParam) return

    const storedTeam = localStorage.getItem('selectedTeam')
    const team =
      teamParam ??
      (storedTeam && teams.some((t) => t.id === storedTeam) ? storedTeam : teams[0]?.id)
    const month = monthParam ?? monthOf(toPuzzleDay(new Date()))
    if (!team) return

    void navigate({ to: '/', search: { team, month }, replace: true })
  }, [hydrated, teamParam, monthParam, teams, navigate])

  useEffect(() => {
    if (teamParam) localStorage.setItem('selectedTeam', teamParam)
  }, [teamParam])

  if (teams.length === 0) {
    return (
      <main className="p-2 md:p-12">
        <p className="text-muted-foreground">
          You are not on a team yet. Creating and joining teams arrives in Phase 3.
        </p>
      </main>
    )
  }

  // Until the effect above resolves both params there is nothing well-defined to
  // render, and rendering a guess is what causes the mismatch.
  if (!teamParam || !monthParam) {
    return (
      <main className="p-2 md:p-12">
        <Skeleton className="h-96 w-full rounded-lg" />
      </main>
    )
  }

  const currentMonth = hydrated ? monthOf(toPuzzleDay(new Date())) : monthParam

  return (
    <main className="mb-12 grid gap-2 p-2 md:grid-cols-3 md:gap-6 md:p-12">
      <div className="flex items-center gap-2 md:col-span-3">
        <TeamPicker
          teams={teams}
          value={teamParam}
          onChange={(team) => navigate({ to: '/', search: { team, month: monthParam } })}
        />
        <MonthPicker
          currentMonth={currentMonth}
          value={monthParam}
          onChange={(month) => navigate({ to: '/', search: { team: teamParam, month } })}
        />
        <div className="ml-auto">
          <BoardEntryButton teamId={teamParam as Id<'teams'>} month={monthParam} />
        </div>
      </div>
      <ScoresTable teamId={teamParam as Id<'teams'>} month={monthParam} className="md:col-span-3" />
    </main>
  )
}
```

`ScoresTable` and `BoardEntryButton` land in Tasks 7 and 8. Until then this file will not compile — that is expected, and Task 7 is the next thing you do.

- [ ] **Step 9: Commit the parts that stand alone**

```bash
git add v2/src/lib/format-day.ts v2/src/lib/format-day.test.ts \
        v2/src/lib/convex-error.ts \
        v2/src/components/team-picker.tsx v2/src/components/month-picker.tsx
git commit -m "feat(v2): day formatting, error mapping, team and month pickers (wt-ksh.3.8)"
```

Hold `src/routes/index.tsx` back and commit it with Task 8, when its imports resolve.

---

## Task 7: The scores table

**Files:**
- Create: `v2/src/components/scores-table.tsx`

No unit test: the spec's testing section rules out a component-test suite for a 1:1 port, and the display rules underneath it (`scoreCell`) are already covered by `src/lib/wordle.test.ts`. **Verification is a screenshot in both themes**, which is the only thing that catches the failure mode V2-ADDENDUM §5 documents.

- [ ] **Step 1: Write the component**

Create `v2/src/components/scores-table.tsx`:

```tsx
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table.tsx'
import { ScoreCell } from '#/components/score-cell.tsx'
import { formatDayHeader } from '#/lib/format-day.ts'
import { cn } from '#/lib/utils.ts'
import { attemptsFor } from '../../convex/lib/board.ts'
import { monthTotal } from '../../convex/lib/scoring.ts'
import { daysOfMonth, isWeekendDay, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * The month grid. DESIGN_SYSTEM.md §8 "Leaderboard table".
 *
 * Hand-rolled rather than @tanstack/react-table, which is what v1 uses: this
 * table never sorts, filters or paginates, and its column pinning is plain
 * `sticky` CSS that react-table plays no part in. The rows arrive pre-ordered by
 * month total, exactly as v1's getData sorted them.
 *
 * Live-updating comes free from Convex reactivity through convexQuery — one of
 * the two sanctioned departures from strict parity in the parent design.
 */
export function ScoresTable({
  teamId,
  month,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  className?: string
}) {
  const hydrated = useHydrated()
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { team, players } = data

  // Local midnight, and only after hydration — the server has no idea what
  // "today" is for this viewer, and guessing it is a hydration mismatch. Before
  // hydration every day of the month reads as "not yet due", which renders
  // blanks rather than wrong values.
  const today = hydrated ? toPuzzleDay(new Date()) : `${month}-01`
  const days = daysOfMonth(month)

  const rows = players
    .map((player) => {
      const byDay = new Map(player.scores.map((score) => [score.puzzleDay, score]))
      return {
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        byDay,
        total: monthTotal({
          month,
          scores: player.scores,
          system: team.system,
          playWeekends: team.playWeekends,
          today,
        }),
      }
    })
    .sort((a, b) => b.total - a.total)

  // v1 shows a first name alone, and 'First L' only when two players on the team
  // share one. Initials replace both on mobile.
  const duplicateFirstNames = new Set(
    rows
      .map((row) => row.firstName)
      .filter((name, i, all) => all.indexOf(name) !== i),
  )

  const pinnedLeft = 'sticky left-0 bg-background'
  const pinnedRight = 'sticky right-0 bg-background'

  return (
    <div className={className}>
      <div className="max-w-[96vw] overflow-x-auto rounded-md border text-xs md:text-base">
        <Table className="relative">
          <TableHeader>
            <TableRow>
              <TableHead className={cn(pinnedLeft, 'rounded-tl-lg px-2 md:px-4')}>
                <div className="text-xs md:text-sm">Player</div>
              </TableHead>
              {days.map((day) => (
                <TableHead key={day}>
                  <div className="text-xs md:text-sm">{formatDayHeader(day)}</div>
                </TableHead>
              ))}
              <TableHead className={cn(pinnedRight, 'rounded-tr-lg px-2 md:px-4')}>
                <div className="text-right text-xs font-bold md:text-sm">Score</div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className={cn(pinnedLeft, 'rounded-bl-lg')}>
                  <div className="invisible h-0 w-0 md:visible md:h-fit md:w-max md:pr-px">
                    {duplicateFirstNames.has(row.firstName)
                      ? `${row.firstName} ${row.lastName[0]}`
                      : row.firstName}
                  </div>
                  <div className="text-xs md:invisible md:h-0 md:w-0 md:text-sm">
                    {row.firstName[0]}
                    {row.lastName[0]}
                  </div>
                </TableCell>
                {days.map((day) => {
                  const score = row.byDay.get(day)
                  return (
                    <TableCell key={day}>
                      <ScoreCell
                        attempts={score ? attemptsFor(score.guesses, score.answer) : undefined}
                        hasScore={score !== undefined}
                        isBeforeToday={day < today}
                        isWeekend={isWeekendDay(day)}
                        playWeekends={team.playWeekends}
                      />
                    </TableCell>
                  )
                })}
                <TableCell className={cn(pinnedRight, 'rounded-br-lg')}>
                  <div className="text-right font-bold">{row.total}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default ScoresTable
```

Note this renders only the days the month actually has, so v1's `getDayVisibility` — which hid columns 29–31 in short months — has no equivalent to port.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: errors only from `src/routes/index.tsx` about the missing `board-entry/button.tsx`. Everything else clean.

- [ ] **Step 3: Commit**

```bash
git add v2/src/components/scores-table.tsx
git commit -m "feat(v2): the month scores table (wt-ksh.3.9)"
```

---

## Task 8: Board entry

The largest task. It ports v1's board entry **as it stands on `dev` today**, which per amendment A3 is not the version the original design was written against.

**Files:**
- Create: `v2/src/lib/use-media-query.ts`, `v2/src/lib/use-visual-viewport.ts`, `v2/src/components/date-picker.tsx`, `v2/src/components/board-entry/{button,form,board-input}.tsx`
- Modify: `v2/src/routes/index.tsx` (staged in Task 6)
- Test: `v2/src/lib/use-visual-viewport.test.ts`

- [ ] **Step 1: Add the two shadcn components**

Run **from inside `v2/`**:

```bash
pnpm dlx shadcn@latest add popover calendar
```

From the repo root the CLI misdetects the project as v1 and resolves the Tailwind entry to `docs/design-system/globals.v2.css`. Confirm afterwards that `v2/src/components/ui/popover.tsx` and `calendar.tsx` exist and that `components.json` still reads `"style": "default"`.

- [ ] **Step 2: Write the failing visual-viewport test**

Create `v2/src/lib/use-visual-viewport.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { readVisualViewport } from './use-visual-viewport'

describe('readVisualViewport', () => {
  test('prefers the visualViewport measurements when the API exists', () => {
    expect(
      readVisualViewport({ visualViewport: { height: 420, offsetTop: 96 }, innerHeight: 800 }),
    ).toEqual({ height: 420, offsetTop: 96 })
  })

  test('falls back to innerHeight when the API is missing', () => {
    // Older browsers. The sheet is still bounded and scrollable — degraded but
    // functional, never clipped-without-scroll.
    expect(readVisualViewport({ innerHeight: 800 })).toEqual({ height: 800, offsetTop: 0 })
  })

  test('is SSR-safe when there is no window at all', () => {
    expect(readVisualViewport(undefined)).toEqual({ height: 0, offsetTop: 0 })
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test:once src/lib/use-visual-viewport.test.ts`
Expected: FAIL — `Failed to resolve import "./use-visual-viewport"`.

- [ ] **Step 4: Write the two hooks**

Create `v2/src/lib/use-visual-viewport.ts`:

```ts
import { useEffect, useState } from 'react'

/**
 * The visible area above the mobile keyboard.
 *
 * iOS Safari does not shrink the layout viewport when the keyboard opens — not
 * `100vh`, not `100dvh` — so a `position: fixed` sheet does not reflow and the
 * bottom guess rows and the Submit button end up behind the keyboard, with body
 * scroll locked by Radix so the user cannot reach them. It DOES update
 * window.visualViewport, which is what this reads.
 *
 * See docs/superpowers/specs/2026-07-15-mobile-board-entry-keyboard-aware-sheet-design.md.
 */
export type ViewportBounds = { height: number; offsetTop: number }

type ViewportSource = {
  visualViewport?: { height: number; offsetTop: number } | null
  innerHeight?: number
}

/** Extracted so the fallback chain is testable without a browser. */
export function readVisualViewport(source: ViewportSource | undefined): ViewportBounds {
  if (!source) return { height: 0, offsetTop: 0 }
  const viewport = source.visualViewport
  if (viewport) return { height: viewport.height, offsetTop: viewport.offsetTop }
  return { height: source.innerHeight ?? 0, offsetTop: 0 }
}

export function useVisualViewport(): ViewportBounds {
  // Zero on the server and on first render, which the consumer treats as
  // "unbounded" — matching what the server rendered, so hydration is clean.
  const [bounds, setBounds] = useState<ViewportBounds>({ height: 0, offsetTop: 0 })

  useEffect(() => {
    const update = () => setBounds(readVisualViewport(window))
    update()

    const viewport = window.visualViewport
    if (!viewport) {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return bounds
}
```

Create `v2/src/lib/use-media-query.ts`:

```ts
import { useEffect, useState } from 'react'

/**
 * Ported from v1's src/lib/hooks/use-media-query.ts.
 *
 * Starts false on the server and on the first client render so hydration
 * matches, then flips in an effect. Board entry therefore renders its mobile
 * Sheet first and swaps to the desktop Dialog after mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const list = window.matchMedia(query)
    setMatches(list.matches)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm test:once src/lib/use-visual-viewport.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the date picker**

Create `v2/src/components/date-picker.tsx`:

```tsx
import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { Calendar } from '#/components/ui/calendar.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover.tsx'
import { cn } from '#/lib/utils.ts'
import { fromPuzzleDay, toPuzzleDay, type PuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Matcher } from 'react-day-picker'

/**
 * Day selection for board entry. Ported from v1's src/components/date-picker.tsx.
 *
 * Speaks puzzle days at its edges and Dates only inside, because
 * react-day-picker insists on Dates. fromPuzzleDay lands on local noon so a DST
 * transition cannot shift the selected day.
 */
export function DatePicker({
  day,
  onSelect,
  playWeekends,
  tabIndex,
  className,
}: {
  day: PuzzleDay | undefined
  onSelect: (day: PuzzleDay) => void
  playWeekends?: boolean
  tabIndex?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = day ? fromPuzzleDay(day) : undefined

  // Same matchers as v1: no future days, and no weekends unless the team plays them.
  const disabled: Array<Matcher> = [{ after: new Date() }]
  if (!playWeekends) disabled.push({ dayOfWeek: [0, 6] })

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          tabIndex={tabIndex}
          variant="outline"
          className={cn(
            'justify-start px-2 text-left text-xs font-normal sm:text-sm md:px-4',
            !day && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {day ? fromPuzzleDay(day).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }) : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(picked) => {
            if (!picked) return
            onSelect(toPuzzleDay(picked))
            setOpen(false)
          }}
          showOutsideDays
          fixedWeeks
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}

export default DatePicker
```

- [ ] **Step 7: Write the board input**

Create `v2/src/components/board-entry/board-input.tsx`:

```tsx
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { KeyboardEvent, KeyboardEventHandler } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { WordleBoard } from '#/components/wordle-board.tsx'
import { boardIsValid, toRows } from '../../../convex/lib/board.ts'

/**
 * The board, with the keyboard captured over it. Ported from v1's
 * wordle-board-input.tsx and the handleKey/handleLetter/handleBackspace trio in
 * board-entry/utils.ts.
 *
 * The board is a contentEditable div rather than inputs so the mobile keyboard
 * appears without a visible caret or a focus-zoom. Every key except Tab is
 * preventDefault'd; nothing is ever typed into the DOM directly.
 */
export function applyLetter(key: string, answer: string, guesses: Array<string>): Array<string> {
  const rows = toRows(guesses)
  const current = rows.find((guess) => guess.length < 5) ?? ''
  // v1 stops here: once a row equals the answer the board is finished, and
  // typing past it would start a seventh guess.
  if (current === answer) return rows
  const next = [...rows]
  next[rows.indexOf(current)] = current + key.toUpperCase()
  return next
}

export function applyBackspace(guesses: Array<string>): Array<string> {
  const rows = toRows(guesses)
  const lastFilled = rows.findLastIndex((guess) => guess.length > 0)
  if (lastFilled < 0) return rows
  const next = [...rows]
  next[lastFilled] = rows[lastFilled].slice(0, -1)
  return next
}

export function BoardInput({
  guesses,
  setGuesses,
  answer,
  hasExistingScore,
  submitting,
  submitDisabled,
  tabIndex,
  onBoardFocus,
}: {
  guesses: Array<string>
  setGuesses: (guesses: Array<string>) => void
  answer: string
  hasExistingScore: boolean
  submitting: boolean
  submitDisabled: boolean
  tabIndex?: number
  onBoardFocus?: () => void
}) {
  const handleKeyDown: KeyboardEventHandler = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key
    if (key === 'Tab') return
    event.preventDefault()

    if (key === 'Backspace') {
      setGuesses(applyBackspace(guesses))
      return
    }
    if (key === 'Enter') {
      if (boardIsValid(answer, guesses, hasExistingScore)) {
        document.getElementById('board-submit')?.click()
      } else {
        toast.warning('Board must be complete to submit')
      }
      return
    }
    const isLetter = key.length === 1 && /[a-zA-Z]/.test(key)
    if (isLetter && !boardIsValid(answer, guesses, hasExistingScore) && toRows(guesses)[5].length < 5) {
      setGuesses(applyLetter(key, answer, guesses))
    }
  }

  return (
    <>
      <div
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onFocus={onBoardFocus}
        className="mt-4 flex h-fit w-full select-none justify-center rounded-lg caret-transparent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 focus:ring-offset-background md:my-6"
        role="region"
        aria-label="Wordle Board"
        tabIndex={tabIndex}
      >
        <WordleBoard guesses={toRows(guesses)} answer={answer} boardEntry />
      </div>
      {/* Desktop's submit. The mobile one lives in the sheet footer so it can
          pin above the keyboard. */}
      <div className="invisible mt-2 flex h-0 justify-end space-x-4 md:visible md:mt-4 md:h-fit">
        <Button
          disabled={submitting || submitDisabled}
          aria-disabled={submitting || submitDisabled}
          type="submit"
          id="board-submit"
          tabIndex={5}
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit
        </Button>
      </div>
    </>
  )
}

export default BoardInput
```

- [ ] **Step 8: Write the form**

Create `v2/src/components/board-entry/form.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import type { FormEventHandler, KeyboardEvent, KeyboardEventHandler } from 'react'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { DatePicker } from '#/components/date-picker.tsx'
import { BoardInput } from './board-input.tsx'
import { boardErrorMessage } from '#/lib/convex-error.ts'
import { cn } from '#/lib/utils.ts'
import { boardIsValid, toRows } from '../../../convex/lib/board.ts'
import { daysOfMonth, isWeekendDay, monthOf, toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { Id } from '../../../convex/_generated/dataModel'

const EMPTY_ROWS = ['', '', '', '', '', '']

/**
 * Board entry. Ports v1's form.tsx AS IT STANDS ON dev, per amendment A3 — not
 * the version the 2026-07-16 design was written against.
 *
 * The three behaviours a335ae8 added, which a faithful port of the older code
 * would have regressed:
 *   1. handleSubmit is wrapped in try/catch
 *   2. setSubmitting(false) runs in `finally`, so the form can never be left
 *      stuck mid-submit
 *   3. the sheet closes ONLY on success — it used to close unconditionally and
 *      throw away everything the user had typed
 *
 * The third a335ae8 behaviour, a warning toast when the winner update failed, is
 * designed out rather than dropped: the winner write shares upsertBoard's
 * transaction, so the board landing while the standings go stale is no longer a
 * reachable state.
 */
export function BoardEntryForm({
  teamId,
  month,
  onSuccess,
}: {
  teamId: Id<'teams'>
  month: string
  onSuccess: () => void
}) {
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { data: myPlayerId } = useSuspenseQuery(convexQuery(api.scores.getMyPlayerId, {}))
  const upsert = useMutation({ mutationFn: useConvexMutation(api.scores.upsertBoard) })

  const myScores = data.players.find((player) => player.id === myPlayerId)?.scores ?? []

  const [day, setDay] = useState<string | undefined>(undefined)
  const [answer, setAnswer] = useState('')
  const [guesses, setGuesses] = useState<Array<string>>(EMPTY_ROWS)
  const [submitting, setSubmitting] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Deferred to an effect rather than a useState initialiser: picking the
  // default day calls new Date(), and this component also renders on the server,
  // where "now" is UTC. Same reasoning as v1's team-boards.tsx.
  useEffect(() => {
    const today = toPuzzleDay(new Date())
    if (monthOf(today) === month) {
      setDay(today)
      return
    }
    // A past month: the first unplayed, playable day, falling back to its last day.
    const played = new Set(myScores.map((score) => score.puzzleDay))
    const candidates = daysOfMonth(month).filter(
      (d) => !played.has(d) && (data.team.playWeekends || !isWeekendDay(d)),
    )
    setDay(candidates[0] ?? daysOfMonth(month).at(-1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  // Load whatever is already stored for the selected day.
  const existing = day ? myScores.find((score) => score.puzzleDay === day) : undefined
  useEffect(() => {
    setAnswer(existing?.answer ?? '')
    setGuesses(toRows(existing?.guesses ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, existing?.id])

  useEffect(() => {
    answerRef.current?.focus()
  }, [])

  const scrollActiveRowIntoView = () => {
    const active = guesses.findIndex((guess) => guess.length < 5)
    const index = active === -1 ? guesses.length - 1 : active
    scrollContainerRef.current?.querySelector(`#${index + 1}-1`)?.scrollIntoView({ block: 'nearest' })
  }

  useEffect(scrollActiveRowIntoView, [guesses])

  const submitDisabled = !day || !boardIsValid(answer, guesses, existing !== undefined)

  const handleAnswerKeyDown: KeyboardEventHandler = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key
    if (key === 'Tab') return
    event.preventDefault()
    if (key === 'Backspace') {
      setAnswer((current) => current.slice(0, -1))
      return
    }
    const isLetter = key.length === 1 && /[a-zA-Z]/.test(key)
    if (isLetter) setAnswer((current) => (current.length < 5 ? current + key.toUpperCase() : current))
  }

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!day) return
    setSubmitting(true)

    try {
      await upsert.mutateAsync({
        puzzleDay: day,
        answer,
        guesses,
        // The submitter's own local today; the server has no viewer to ask.
        today: toPuzzleDay(new Date()),
      })
      toast.success('Successfully saved board')
      // ONLY on success. A failed submit used to close the sheet too, throwing
      // away everything the user had typed.
      onSuccess()
    } catch (error) {
      // Reaching here means the mutation failed: one of our typed codes, or —
      // the case that matters — a dropped mobile connection or a platform error.
      // Without this the promise rejected, setSubmitting(false) never ran, and
      // the form sat spinning forever with the board silently lost.
      console.error('Board submission failed before it could be saved', error)
      toast.error(boardErrorMessage(error))
    } finally {
      // Always runs, so the form can never be left stuck mid-submit.
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex min-h-0 flex-1 flex-col', submitting && 'animate-pulse')}
    >
      <div className="ml-2 flex w-full shrink-0 items-center space-x-4 md:px-4">
        <div className="flex w-[54%] flex-col md:w-full">
          <Label htmlFor="wordle-board-date" className="mb-2 text-xs sm:text-sm">
            Wordle Date
          </Label>
          <DatePicker
            day={day}
            onSelect={setDay}
            playWeekends={data.team.playWeekends}
            tabIndex={1}
          />
        </div>
        <div className="flex w-[30%] flex-col space-y-2 md:w-full">
          <Label htmlFor="answer" className="text-xs sm:text-sm">
            Wordle Answer
          </Label>
          <div
            id="answer"
            ref={answerRef}
            contentEditable
            suppressContentEditableWarning
            tabIndex={2}
            onKeyDown={handleAnswerKeyDown}
            className="flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-base uppercase caret-transparent ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 md:px-3"
          >
            {answer}
          </div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
        <BoardInput
          guesses={guesses}
          setGuesses={setGuesses}
          answer={answer}
          hasExistingScore={existing !== undefined}
          submitting={submitting}
          submitDisabled={submitDisabled}
          tabIndex={3}
          onBoardFocus={scrollActiveRowIntoView}
        />
      </div>

      {/* Sticky so it pins above the mobile keyboard; hidden on desktop, where
          BoardInput renders its own submit. */}
      <div className="sticky bottom-0 flex w-full shrink-0 flex-row space-x-2 bg-background pt-2 md:invisible md:h-0 md:p-0">
        <Button type="button" variant="outline" className="w-full" onClick={onSuccess}>
          Cancel
        </Button>
        <Button
          disabled={submitting || submitDisabled}
          aria-disabled={submitting || submitDisabled}
          type="submit"
          className="w-full"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit
        </Button>
      </div>
    </form>
  )
}

export default BoardEntryForm
```

- [ ] **Step 9: Write the button**

Create `v2/src/components/board-entry/button.tsx`:

```tsx
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog.tsx'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTrigger } from '#/components/ui/sheet.tsx'
import { useMediaQuery } from '#/lib/use-media-query.ts'
import { useVisualViewport } from '#/lib/use-visual-viewport.ts'
import { BoardEntryForm } from './form.tsx'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Dialog on desktop, top Sheet on mobile — DESIGN_SYSTEM.md §7, "On mobile the
 * same content renders as a top Sheet instead."
 *
 * The Sheet's height and top are bound to the visual viewport so it sits above
 * the keyboard: iOS Safari does not reflow a fixed panel when the keyboard
 * opens, and Radix locks body scroll, so without this the lower guess rows and
 * Submit are unreachable.
 */
export function BoardEntryButton({ teamId, month }: { teamId: Id<'teams'>; month: string }) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const { height, offsetTop } = useVisualViewport()

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary">
            Board Entry
            <Plus size={20} className="ml-2" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader className="pb-4">
            <DialogTitle>Add or Update Board</DialogTitle>
            <DialogDescription>Enter the day&apos;s answer and then your guesses</DialogDescription>
          </DialogHeader>
          <BoardEntryForm teamId={teamId} month={month} onSuccess={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="text-xs" variant="secondary" aria-label="Board Entry">
          <Plus size={20} />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="top"
        className="flex flex-col gap-0 overflow-hidden"
        style={{ maxHeight: height || undefined, top: offsetTop }}
      >
        <SheetHeader className="-ml-4 mb-4 mt-4">
          <SheetDescription>Enter the day&apos;s answer and then your guesses</SheetDescription>
        </SheetHeader>
        <BoardEntryForm teamId={teamId} month={month} onSuccess={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}

export default BoardEntryButton
```

- [ ] **Step 10: Typecheck and build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: both clean. `src/routes/index.tsx` now resolves.

- [ ] **Step 11: Screenshot both themes, desktop and mobile**

Start the dev server from `v2/` (`pnpm dev`), kill strays first with `lsof -ti :3000 | xargs -r kill` — a second `pnpm dev` silently binds 3001 and you end up testing a stale server.

Capture with the project's own Playwright chromium: the dashboard at 1280×800 and 390×844, in light and dark, plus board entry open in both. **Look at them.** `vite build`, `tsc` and the whole test suite stayed green while ~80 component selectors were dead (V2-ADDENDUM §5); a screenshot is the only thing that catches it.

Check specifically: the pinned Player and Score columns paint over the scrolling days rather than letting rows show through; tiles are square with no rounding; the mobile sheet's Submit stays visible with the keyboard open.

- [ ] **Step 12: Commit**

```bash
git add v2/src/lib/use-media-query.ts v2/src/lib/use-visual-viewport.ts \
        v2/src/lib/use-visual-viewport.test.ts v2/src/components/date-picker.tsx \
        v2/src/components/board-entry v2/src/components/ui/popover.tsx \
        v2/src/components/ui/calendar.tsx v2/src/routes/index.tsx v2/package.json v2/pnpm-lock.yaml
git commit -m "feat(v2): board entry with the keyboard-aware mobile sheet (wt-ksh.3.10)"
```

---

## Task 9: End-to-end smoke, beta deploy, phase close

**Files:**
- Modify: `v2/e2e/login.spec.ts` or create `v2/e2e/board-entry.spec.ts`

- [ ] **Step 1: Extract the sign-in helper**

Run: `cat v2/e2e/login.spec.ts`

It already signs in through the `testOtps` path. Move those steps into `v2/e2e/sign-in.ts` as an exported `signIn(page: Page): Promise<void>` and have `login.spec.ts` import it, so there is one definition rather than two copies drifting apart. Do not change what the login spec asserts.

Run `pnpm e2e` and confirm the login spec still passes before going further.

- [ ] **Step 2: Write the smoke test**

Create `v2/e2e/board-entry.spec.ts`. One test, not a suite — the parent design is explicit about that:

```ts
import { expect, test } from '@playwright/test'
import { signIn } from './sign-in'

test('enter a board and see the score land', async ({ page }) => {
  await signIn(page)

  await page.getByRole('button', { name: 'Board Entry' }).click()
  await page.getByRole('region', { name: 'Wordle Board' }).waitFor()

  // The answer field takes focus on open; type the answer, then the guesses.
  await page.keyboard.type('SPEED')
  await page.getByRole('region', { name: 'Wordle Board' }).click()
  await page.keyboard.type('CRANESPEED')

  await page.getByRole('button', { name: 'Submit' }).click()

  // The dialog closes only on success, so its disappearance IS the assertion
  // that the write landed.
  await expect(page.getByRole('region', { name: 'Wordle Board' })).toBeHidden()
  await expect(page.getByRole('table')).toContainText('2')
})
```

- [ ] **Step 3: Run it**

Run from `v2/`: `pnpm e2e`
Expected: PASS.

- [ ] **Step 4: Full verification sweep**

```bash
pnpm test:once
pnpm exec tsc --noEmit
pnpm build
```

All three clean. **Report the actual output** — if anything fails, say so rather than proceeding.

- [ ] **Step 5: Commit and push**

```bash
git add v2/e2e
git commit -m "test(v2): e2e smoke for the core loop (wt-ksh.3.11)"
git pull --rebase
bd dolt push
git push
git status   # MUST show up to date with origin
```

- [ ] **Step 6: Verify the phase done-when on beta**

The GitHub Action deploys on `v2/`-touching pushes. Once it lands, on `beta.wordleteams.com`:

1. Sign in as a copied account.
2. Enter a board for today. Confirm the score appears in the table without a refresh.
3. Open the same team in a second browser and enter a board as a different player. Confirm the first browser's table updates **with no refresh** — the reactivity exception.
4. Confirm the month total and the ordering match what v1 shows for the same data.
5. Check the `monthlyWinners` row in the Convex dashboard for each of that player's teams.

**Done when: a full fake day works on beta — enter board, live score updates, correct monthly winner.**

- [ ] **Step 7: Close the phase**

```bash
bd close wt-ksh.3.2 wt-ksh.3.3 wt-ksh.3.4 wt-ksh.3.5 wt-ksh.3.6
bd close wt-ksh.3.7 wt-ksh.3.8 wt-ksh.3.9 wt-ksh.3.10 wt-ksh.3.11
bd close wt-ksh.3
```

Then file anything discovered along the way, and note in `V2-ADDENDUM.md` §7 that Phase 7's parity audit now expects **three** known divergences rather than one: duplicate-letter tiles, no new duplicate score rows, and `hasSeenCelebration` surviving an unchanged winner.

---

## Notes For Whoever Picks This Up

- **`teams.createdAt` is optional**, so `getMyTeams` sorts with `?? 0`. Teams created natively in a later phase should set it, or ordering will drift.
- **`getMyPlayerId` is a separate round trip** purely so board entry can find your row. If Phase 3 introduces a richer "current user" query, fold it in rather than accumulating one-field queries.
- **Do not "fix" the four token values** in `v2/src/styles.css` that deviate from `tokens.json`. They are deliberate contrast corrections; the bundle's own table is wrong. V2-ADDENDUM §2.
- **`v2/wrangler.jsonc` `ENVIRONMENT` must become `"production"` at cutover** (Phase 8) or every production funnel event is tagged `beta`.
