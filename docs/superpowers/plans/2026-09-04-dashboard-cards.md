# Dashboard Cards — Splitting Today from the Month: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the dashboard's "today" job out of the month grid — a `TodayPanel` above the table, rank and self-highlight in the table, a read-only scoring legend beneath it — and move team admin off the dashboard into a dialog.

**Architecture:** Additive, and entirely client-side. Both new components join the `api.scores.getTeamMonth` subscription `routes/app.tsx` already fetches, so there are **zero new Convex functions, zero new indexes and no additional round-trips**. Three pieces of logic become pure functions in their own modules so they are unit- and mutation-testable without a rendering harness. `ScoresTable` is changed additively — day columns, sticky cells, auto-centring and the sort are untouched.

**Tech Stack:** TanStack Start + Router, React 19, Convex (`@convex-dev/react-query`), Tailwind, shadcn/ui primitives, Vitest (`edge-runtime` default, `jsdom` per-file for component tests), Playwright for the one e2e.

**Spec:** `docs/superpowers/specs/2026-09-04-dashboard-cards-design.md` (approved). **Beads issue:** `wordle-teams-5jcn`.

---

## Read this before Task 1

**§7a numbering has moved since the spec was written.** The spec says the new divergence rows are 60–64. The table now holds **sixty** rows, so **the new rows are 61–65** and the header word becomes `Sixty-five`. Task 10 covers this. `src/addendum-divergences.test.ts` fails the build if the header and the table disagree, and `Sixty-five` is already in its number-word map, so no test edit is needed.

**One deliberate deviation from the spec, flagged for the owner.** §3 asks for "a rank `#` column". This plan renders the rank **inside the existing pinned Player cell** rather than as a second sticky column. Reason: `scores-table.tsx` runs `table-layout: auto` with `w-max` (a hard-won fix — see the `w-max min-w-full` comment), so a second `sticky` column would need a pixel-exact `left-` offset matching a width that auto-layout is free to change. That is a latent misalignment bug of exactly the kind `wordle-teams-rpql` already cost a day. The rank is still stated, still pinned, still first. **If the owner wants a true separate column, that is a `table-layout: fixed` change to the first two columns and should be its own issue.**

---

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `v2/src/lib/standings.ts` | `rankWithTies` — standard competition ranking |
| `v2/src/lib/standings.test.ts` | its tests |
| `v2/src/lib/waiting-on.ts` | `waitingOnSummary` — played/waiting counts and the ≤3 name cap |
| `v2/src/lib/waiting-on.test.ts` | its tests |
| `v2/src/lib/display-names.ts` | `displayNamesFor` — the long-name collision rule, shared by the table and the panel |
| `v2/src/lib/display-names.test.ts` | its tests |
| `v2/src/components/today-panel.tsx` | `TodayPanel` |
| `v2/src/components/today-panel.hook.test.ts` | its rendering tests |
| `v2/src/components/scoring-legend.tsx` | `ScoringLegend` |
| `v2/src/components/scoring-legend.hook.test.ts` | its rendering tests |
| `v2/src/components/teams/team-settings-dialog.tsx` | tabbed shell hosting the three admin components |

**Modify:**

| File | Change |
| --- | --- |
| `v2/convex/lib/puzzleDay.ts` | add `monthContainsToday` |
| `v2/convex/lib/puzzleDay.test.ts` | its tests |
| `v2/src/components/scores-table.tsx` | rank, self-highlight, today tint, name cap; use the shared predicate |
| `v2/src/components/dashboard-skeletons.tsx` | add `TodayPanelSkeleton`, `ScoringLegendSkeleton` |
| `v2/src/routes/app.tsx` | grid rewiring; admin cards move into the dialog |
| `docs/design-system/V2-ADDENDUM.md` | §7a rows 61–65 and the header count |
| `v2/e2e/dashboard.spec.ts` | one assertion (see Task 11 for the exact path) |

---

### Task 1: `monthContainsToday`, extracted rather than written twice

`ScoresTable` holds this predicate inline (`if (monthOf(todayNow) !== month) return`). `TodayPanel` needs the same one. It goes in `convex/lib/puzzleDay.ts` because that is where `monthOf` lives and both consumers already import from it, and because `vitest.config.ts` includes `convex/**/*.test.ts`.

**Files:**
- Modify: `v2/convex/lib/puzzleDay.ts`
- Test: `v2/convex/lib/puzzleDay.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/lib/puzzleDay.test.ts`:

```ts
describe('monthContainsToday', () => {
  test('true when the day falls inside the month', () => {
    expect(monthContainsToday('2026-09', '2026-09-04')).toBe(true)
  })

  test('true on the first and last day, which are the boundaries a mutant moves', () => {
    expect(monthContainsToday('2026-09', '2026-09-01')).toBe(true)
    expect(monthContainsToday('2026-09', '2026-09-30')).toBe(true)
  })

  test('false for the month before and the month after', () => {
    expect(monthContainsToday('2026-09', '2026-08-31')).toBe(false)
    expect(monthContainsToday('2026-09', '2026-10-01')).toBe(false)
  })

  // A string compare of '2026-9' against '2026-09' would pass the happy path
  // and fail here. monthOf slices, so this pins that it keeps the zero pad.
  test('the same month a year apart is not today', () => {
    expect(monthContainsToday('2026-09', '2025-09-04')).toBe(false)
  })
})
```

Add `monthContainsToday` to that file's existing import from `./puzzleDay.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/lib/puzzleDay.test.ts`
Expected: FAIL — `monthContainsToday is not a function` (or a TS resolution error).

- [ ] **Step 3: Write the implementation**

Append to `v2/convex/lib/puzzleDay.ts`:

```ts
/**
 * Does the viewed month contain this day?
 *
 * EXTRACTED RATHER THAN WRITTEN TWICE. scores-table.tsx used this inline to
 * decide whether to auto-centre today's column; today-panel.tsx needs the same
 * question to decide whether to render at all. Two copies of a date predicate
 * is how the two surfaces come to disagree about what "today" means on the 1st
 * of a month.
 *
 * `today` is passed in, never read from a clock here: "today" is a client-only
 * fact (see today-panel.tsx's hydration note) and a pure function must stay
 * deterministic.
 */
export function monthContainsToday(month: PuzzleMonth, today: PuzzleDay): boolean {
  return monthOf(today) === month
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/lib/puzzleDay.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in `ScoresTable`**

In `v2/src/components/scores-table.tsx`, add `monthContainsToday` to the existing import from `'../../convex/lib/puzzleDay.ts'`, then replace:

```ts
    const todayNow = toPuzzleDay(new Date())
    // Only when the viewed month actually contains today. A past (or future)
    // month has no current-day column — leave it at its natural position.
    // (The key above was still updated, so a later return TO this month sees
    // that something else was viewed in between.)
    if (monthOf(todayNow) !== month) return
```

with:

```ts
    const todayNow = toPuzzleDay(new Date())
    // Only when the viewed month actually contains today. A past (or future)
    // month has no current-day column — leave it at its natural position.
    // (The key above was still updated, so a later return TO this month sees
    // that something else was viewed in between.) Shared with today-panel.tsx,
    // which asks the same question to decide whether to render at all.
    if (!monthContainsToday(month, todayNow)) return
```

Then remove `monthOf` from the import if nothing else in the file uses it. Check with:

Run: `cd v2 && grep -n 'monthOf' src/components/scores-table.tsx`

- [ ] **Step 6: Run the gates**

Run: `cd v2 && pnpm run typecheck && pnpm vitest run`
Expected: PASS, with the test count up by 4.

- [ ] **Step 7: Commit**

```bash
git add v2/convex/lib/puzzleDay.ts v2/convex/lib/puzzleDay.test.ts v2/src/components/scores-table.tsx
git commit -m "refactor(dashboard): extract monthContainsToday, shared by the table and the coming panel"
```

---

### Task 2: `rankWithTies`

**Files:**
- Create: `v2/src/lib/standings.ts`
- Test: `v2/src/lib/standings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/standings.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { rankWithTies } from './standings.ts'

/** The shape under test is just `{ total }`; the real rows carry much more. */
const rows = (...totals: Array<number>) => totals.map((total, i) => ({ id: `p${i}`, total }))
const ranks = (...totals: Array<number>) => rankWithTies(rows(...totals)).map((r) => r.rank)

describe('rankWithTies', () => {
  test('distinct totals rank 1, 2, 3', () => {
    expect(ranks(10, 8, 6)).toEqual([1, 2, 3])
  })

  // THE DECIDED RULE, and the reason this function exists rather than an
  // index+1 in the component. Dense ranking would give [1, 2, 2, 3] and tell
  // the fourth-placed player they came third.
  test('STANDARD COMPETITION RANKING — a tie for 2nd is followed by 4th, not 3rd', () => {
    expect(ranks(10, 8, 8, 6)).toEqual([1, 2, 2, 4])
  })

  test('a tie at the top is followed by 3rd', () => {
    expect(ranks(10, 10, 6)).toEqual([1, 1, 3])
  })

  test('a three-way tie skips two places', () => {
    expect(ranks(10, 8, 8, 8, 6)).toEqual([1, 2, 2, 2, 5])
  })

  test('everyone level is all 1st', () => {
    expect(ranks(4, 4, 4)).toEqual([1, 1, 1])
  })

  test('a tie in last place still ranks', () => {
    expect(ranks(10, 6, 6)).toEqual([1, 2, 2])
  })

  // Totals go negative: sixGuesses is -1 and failed is -3 in DEFAULT_SYSTEM,
  // so a bad month is a negative number and 0 is not the floor.
  test('negative and zero totals compare like any other number', () => {
    expect(ranks(0, -1, -1, -3)).toEqual([1, 2, 2, 4])
  })

  test('a single row is 1st', () => {
    expect(ranks(5)).toEqual([1])
  })

  test('no rows is no rows, not a crash', () => {
    expect(rankWithTies([])).toEqual([])
  })

  test('every input property is carried through beside the rank', () => {
    expect(rankWithTies([{ id: 'a', total: 3, firstName: 'Ada' }])).toEqual([
      { id: 'a', total: 3, firstName: 'Ada', rank: 1 },
    ])
  })

  test('the input array is not mutated', () => {
    const input = rows(10, 8)
    rankWithTies(input)
    expect(input).toEqual([{ id: 'p0', total: 10 }, { id: 'p1', total: 8 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/lib/standings.test.ts`
Expected: FAIL — cannot resolve `./standings.ts`.

- [ ] **Step 3: Write the implementation**

Create `v2/src/lib/standings.ts`:

```ts
/**
 * Standings rank for an ALREADY-SORTED list of rows.
 *
 * STANDARD COMPETITION RANKING (1, 2, 2, 4), decided in the dashboard design
 * rather than left to the implementer. Two players on equal points are equal,
 * and the alternative — dense ranking, 1, 2, 2, 3 — would tell the
 * fourth-placed player they came third. A tie is the normal case in a small
 * team on a slow month, so this is not an edge case.
 *
 * SORTING IS THE CALLER'S JOB AND STAYS THERE. scores-table.tsx already sorts
 * by month total descending, exactly as v1's getData did; re-sorting here would
 * be a second opinion about order that could drift from the one on screen.
 * This function only reads `total` to find the boundaries between places.
 */
export function rankWithTies<T extends { total: number }>(
  rows: ReadonlyArray<T>,
): Array<T & { rank: number }> {
  let rank = 0
  let previousTotal: number | undefined

  return rows.map((row, index) => {
    // The rank only advances when the total CHANGES — and it advances to the
    // 1-based position, not to `rank + 1`, which is what makes the place after
    // a tie skip. index is 0-based, so the position is index + 1.
    if (row.total !== previousTotal) {
      rank = index + 1
      previousTotal = row.total
    }
    return { ...row, rank }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run src/lib/standings.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Mutation-test the tie rule — the spec requires this specifically**

A green test here means nothing until the mutants have been seen to die. Apply each mutant BY HAND, run the file, confirm RED, then revert.

| # | Mutant | Must be caught by |
| --- | --- | --- |
| 1 | `rank = index + 1` → `rank = rank + 1` | the 1,2,2,4 test (would give 1,2,2,3) |
| 2 | `rank = index + 1` → `rank = index` | the distinct-totals test (0-based) |
| 3 | `row.total !== previousTotal` → `row.total === previousTotal` | the distinct-totals test |
| 4 | drop the `if` guard entirely (always assign) | the 1,2,2,4 test |
| 5 | `previousTotal` initialised to `0` instead of `undefined` | the negative/zero test — a first row with total 0 would rank 0 |

Run after each: `cd v2 && pnpm vitest run src/lib/standings.test.ts`
Expected: FAIL each time. **If any mutant survives, add the test that kills it before continuing.**

- [ ] **Step 6: Commit**

```bash
git add v2/src/lib/standings.ts v2/src/lib/standings.test.ts
git commit -m "feat(dashboard): rankWithTies, standard competition ranking

Five mutants applied by hand and seen to die, including rank+1 (which
produces dense ranking) and a 0-initialised previousTotal (which mis-ranks
a leading zero total). The tie rule is the decided one: 1, 2, 2, 4."
```

---

### Task 3: `waitingOnSummary`

**Files:**
- Create: `v2/src/lib/waiting-on.ts`
- Test: `v2/src/lib/waiting-on.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/waiting-on.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { waitingOnSummary } from './waiting-on.ts'

const members = (...ids: Array<string>) => ids.map((id) => ({ id, label: id.toUpperCase() }))

describe('waitingOnSummary', () => {
  test('counts who has played out of the whole team', () => {
    const s = waitingOnSummary(members('a', 'b', 'c'), new Set(['a']), 3)
    expect(s.total).toBe(3)
    expect(s.playedCount).toBe(1)
  })

  test('members with no score are the ones waited on, in team order', () => {
    const s = waitingOnSummary(members('a', 'b', 'c'), new Set(['b']), 3)
    expect(s.shown).toEqual(['A', 'C'])
    expect(s.othersCount).toBe(0)
  })

  // THE CAP IS THE OFF-BY-ONE. Exactly `limit` waiting must show all of them
  // and say "and 0 others" to nobody.
  test('exactly the limit shows every name and hides none', () => {
    const s = waitingOnSummary(members('a', 'b', 'c'), new Set([]), 3)
    expect(s.shown).toEqual(['A', 'B', 'C'])
    expect(s.othersCount).toBe(0)
  })

  test('one over the limit shows the limit and hides exactly one', () => {
    const s = waitingOnSummary(members('a', 'b', 'c', 'd'), new Set([]), 3)
    expect(s.shown).toEqual(['A', 'B', 'C'])
    expect(s.othersCount).toBe(1)
  })

  test('a large team hides the rest and never grows the shown list', () => {
    const s = waitingOnSummary(members(...'abcdefghij'.split('')), new Set([]), 3)
    expect(s.shown).toHaveLength(3)
    expect(s.othersCount).toBe(7)
    // The full list is still returned, for the disclosure that reveals it.
    expect(s.waiting).toHaveLength(10)
  })

  test('everyone played leaves nothing to wait on', () => {
    const s = waitingOnSummary(members('a', 'b'), new Set(['a', 'b']), 3)
    expect(s.shown).toEqual([])
    expect(s.waiting).toEqual([])
    expect(s.othersCount).toBe(0)
    expect(s.playedCount).toBe(2)
  })

  test('an empty team is all zeroes, not a crash or a NaN', () => {
    const s = waitingOnSummary([], new Set([]), 3)
    expect(s).toEqual({ total: 0, playedCount: 0, waiting: [], shown: [], othersCount: 0 })
  })

  // A played id that is not on the team must not inflate the count past total.
  test('a stale played id for a departed member does not overcount', () => {
    const s = waitingOnSummary(members('a', 'b'), new Set(['a', 'gone']), 3)
    expect(s.playedCount).toBe(1)
    expect(s.total).toBe(2)
  })

  test('a limit of zero shows no names and hides them all', () => {
    const s = waitingOnSummary(members('a', 'b'), new Set([]), 0)
    expect(s.shown).toEqual([])
    expect(s.othersCount).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/lib/waiting-on.test.ts`
Expected: FAIL — cannot resolve `./waiting-on.ts`.

- [ ] **Step 3: Write the implementation**

Create `v2/src/lib/waiting-on.ts`:

```ts
/** One team member, reduced to what this summary needs. */
export type WaitingMember = { id: string; label: string }

export type WaitingOnSummary = {
  /** Everyone on the team, whether or not they have a score. */
  total: number
  playedCount: number
  /** Every waiting member's label, for the disclosure that reveals the rest. */
  waiting: Array<string>
  /** The first `limit` of them — what is shown before the disclosure. */
  shown: Array<string>
  /** How many `waiting` are NOT in `shown`. Zero when they all fit. */
  othersCount: number
}

/**
 * "N of M played", and who is being waited on.
 *
 * THE CAP IS THE POINT, NOT A DETAIL. Team size is unbounded — FREE_TEAM_LIMIT
 * caps teams per player, not members per team, and nothing in convex/ caps
 * membership — so any layout that renders one element per member is
 * disqualified. `shown` is bounded by `limit` and `othersCount` carries the
 * remainder, which keeps the panel a constant height at any team size.
 *
 * `playedCount` is derived from the MEMBER list rather than from the size of
 * `played`, so a stale id for someone who has left the team cannot report more
 * players than the team has.
 *
 * Order is the caller's team order, untouched — the same order the scores
 * table's own long-name collision rule was computed against.
 */
export function waitingOnSummary(
  members: ReadonlyArray<WaitingMember>,
  played: ReadonlySet<string>,
  limit: number,
): WaitingOnSummary {
  const waiting = members.filter((m) => !played.has(m.id)).map((m) => m.label)
  const shown = waiting.slice(0, limit)

  return {
    total: members.length,
    playedCount: members.filter((m) => played.has(m.id)).length,
    waiting,
    shown,
    othersCount: waiting.length - shown.length,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run src/lib/waiting-on.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Mutation-test the truncation — the spec requires this specifically**

| # | Mutant | Must be caught by |
| --- | --- | --- |
| 1 | `waiting.slice(0, limit)` → `slice(0, limit + 1)` | "exactly the limit" / "one over the limit" |
| 2 | `waiting.slice(0, limit)` → `slice(1, limit)` | "members with no score are the ones waited on" |
| 3 | `waiting.length - shown.length` → `waiting.length` | "exactly the limit hides none" |
| 4 | `!played.has(m.id)` → `played.has(m.id)` | "members with no score are the ones waited on" |
| 5 | `playedCount` computed as `played.size` | "a stale played id does not overcount" |

Run after each: `cd v2 && pnpm vitest run src/lib/waiting-on.test.ts`
Expected: FAIL each time. **If any survives, add the killing test before continuing.**

- [ ] **Step 6: Commit**

```bash
git add v2/src/lib/waiting-on.ts v2/src/lib/waiting-on.test.ts
git commit -m "feat(dashboard): waitingOnSummary, capped at any team size

Five mutants applied by hand and seen to die, including the two off-by-one
shapes on the cap and a playedCount read from played.size, which overcounts
when a departed member still holds a score."
```

---

---

### Task 4: `displayNamesFor` — the collision rule, extracted

The spec requires `TodayPanel` to reuse the table's long-name strategy **"imported rather than restated"**. That rule currently lives inline in `scores-table.tsx` as `duplicateFirstNames`. Two copies is how the table and the panel come to call the same person two different things on the same screen.

The rule, ported from v1 and explicitly worth keeping: **first name alone; `First L` only when two players on the team share a first name.** (Initials below `md:` are a presentation concern and stay in the table's JSX — they are not part of the collision decision.)

**Files:**
- Create: `v2/src/lib/display-names.ts`
- Test: `v2/src/lib/display-names.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/display-names.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { displayNamesFor } from './display-names.ts'

const people = (...pairs: Array<[string, string, string]>) =>
  pairs.map(([id, firstName, lastName]) => ({ id, firstName, lastName }))

const labels = (...pairs: Array<[string, string, string]>) => [
  ...displayNamesFor(people(...pairs)).values(),
]

describe('displayNamesFor', () => {
  test('a unique first name stands alone', () => {
    expect(labels(['1', 'Ada', 'Lovelace'], ['2', 'Grace', 'Hopper'])).toEqual(['Ada', 'Grace'])
  })

  // The whole point of the rule: BOTH colliding players get the initial, not
  // just the second one seen.
  test('a shared first name gives BOTH players their last initial', () => {
    expect(labels(['1', 'Ada', 'Lovelace'], ['2', 'Ada', 'Byron'])).toEqual(['Ada L', 'Ada B'])
  })

  test('a third sharer is disambiguated too', () => {
    expect(labels(['1', 'Ada', 'Lovelace'], ['2', 'Ada', 'Byron'], ['3', 'Ada', 'King'])).toEqual([
      'Ada L',
      'Ada B',
      'Ada K',
    ])
  })

  test('collisions are per first name, not global', () => {
    expect(
      labels(['1', 'Ada', 'Lovelace'], ['2', 'Ada', 'Byron'], ['3', 'Grace', 'Hopper']),
    ).toEqual(['Ada L', 'Ada B', 'Grace'])
  })

  test('the map is keyed by id, so the caller can look up by player', () => {
    const map = displayNamesFor(people(['p1', 'Ada', 'Lovelace']))
    expect(map.get('p1')).toBe('Ada')
  })

  // An empty last name must not produce "Ada undefined" — the exact bug
  // lib/initials.ts exists to not reproduce, via lastName[0] on ''.
  test('a colliding player with no last name gets no stray undefined', () => {
    expect(labels(['1', 'Ada', ''], ['2', 'Ada', 'Byron'])).toEqual(['Ada', 'Ada B'])
  })

  test('an empty roster is an empty map, not a crash', () => {
    expect(displayNamesFor([]).size).toBe(0)
  })

  test('case differences are different names, matching the table today', () => {
    // Documents current behaviour rather than asserting it is ideal: the table
    // compares raw first names, so 'ada' and 'Ada' do not collide. Changing
    // that is a product decision, not a refactor.
    expect(labels(['1', 'ada', 'Lovelace'], ['2', 'Ada', 'Byron'])).toEqual(['ada', 'Ada'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/lib/display-names.test.ts`
Expected: FAIL — cannot resolve `./display-names.ts`.

- [ ] **Step 3: Write the implementation**

Create `v2/src/lib/display-names.ts`:

```ts
/** A player, reduced to what the naming rule reads. */
export type NamedPlayer = { id: string; firstName: string; lastName: string }

/**
 * The team's display names, by player id.
 *
 * THE RULE, ported from v1 and kept deliberately: a first name alone, and
 * `First L` ONLY when two players on the same team share that first name. It is
 * a good rule — it stays short in the common case and disambiguates exactly
 * when it must.
 *
 * EXTRACTED SO THE TABLE AND THE TODAY PANEL CANNOT DISAGREE. This lived inline
 * in scores-table.tsx; the panel needs the same answer, and two copies of a
 * naming rule is how the same person ends up called two things on one screen.
 *
 * A COLLIDING PLAYER WITH AN EMPTY LAST NAME KEEPS THEIR BARE FIRST NAME rather
 * than gaining a trailing space or an "undefined" — `''[0]` is undefined, which
 * is the precise bug lib/initials.ts was written against. They stay ambiguous,
 * which is honest: there is no initial to disambiguate them with.
 */
export function displayNamesFor(players: ReadonlyArray<NamedPlayer>): Map<string, string> {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const p of players) {
    if (seen.has(p.firstName)) duplicated.add(p.firstName)
    seen.add(p.firstName)
  }

  return new Map(
    players.map((p) => {
      const initial = p.lastName.charAt(0)
      const label = duplicated.has(p.firstName) && initial ? `${p.firstName} ${initial}` : p.firstName
      return [p.id, label]
    }),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run src/lib/display-names.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-test the collision detection**

| # | Mutant | Must be caught by |
| --- | --- | --- |
| 1 | `duplicated` never populated (drop the `if`) | "a shared first name gives BOTH players their last initial" |
| 2 | `seen.add` moved before the `if` | the same test — every name would look duplicated |
| 3 | `p.lastName.charAt(0)` → `p.lastName[0]` | "no stray undefined" — `[0]` is `undefined`, and `&& initial` still guards it, so **if this mutant survives, that is correct**; note it and move on |
| 4 | drop `&& initial` | "no stray undefined" (yields `'Ada '`) |
| 5 | `duplicated.has(...)` → `seen.has(...)` | "a unique first name stands alone" |

Run after each: `cd v2 && pnpm vitest run src/lib/display-names.test.ts`
Expected: FAIL for 1, 2, 4, 5. Mutant 3 is an equivalent mutant under the guard — record that rather than inventing a test for it.

- [ ] **Step 6: Commit**

```bash
git add v2/src/lib/display-names.ts v2/src/lib/display-names.test.ts
git commit -m "feat(dashboard): extract the long-name collision rule so two surfaces cannot disagree"
```

---

### Task 5: `ScoresTable` — rank, self-highlight, today tint, name cap

Additive only. Day columns, sticky cells, auto-centring and the sort are untouched.

**Files:**
- Modify: `v2/src/components/scores-table.tsx`
- Test: `v2/src/components/scores-table.hook.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `v2/src/components/scores-table.hook.test.ts`:

```ts
// @vitest-environment jsdom
//
// jsdom for the same reason dashboard-skeletons.hook.test.ts uses it, and
// `.test.ts` not `.test.tsx` because vitest.config.ts's glob is
// `src/**/*.test.ts` — elements go through createElement by hand.
//
// WHY THIS FILE EXISTS: the four changes in this task are all invisible to the
// other gates. Dropping the self-highlight, the today tint, the name cap or the
// rank all type-check, lint, build and pass every other test — the table just
// silently stops answering the question it was changed to answer.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const source = readFileSync(new URL('./scores-table.tsx', import.meta.url), 'utf8')

describe('the additive changes are present and are not decorative', () => {
  test('the name column is capped, so one long name cannot steal the day columns', () => {
    // The latent bug this fixes: `md:w-max` with no maximum let a single long
    // name widen the pinned column and squeeze every day column beside it.
    expect(source).toMatch(/max-w-\[/)
    expect(source).not.toMatch(/md:w-max md:pr-px/)
  })

  test('the full name survives as a title attribute when it is ellipsed', () => {
    expect(source).toMatch(/title=/)
  })

  test('the collision rule is imported, not restated', () => {
    // The panel and the table must call the same person the same thing. A
    // second inline copy of this rule is how they drift apart.
    expect(source).toContain("from '#/lib/display-names.ts'")
    expect(source).not.toContain('duplicateFirstNames')
  })

  test('rank comes from rankWithTies, not from a map index', () => {
    expect(source).toContain("from '#/lib/standings.ts'")
    expect(source).toContain('rankWithTies(')
    // An index+1 rank would be dense-ranked and would contradict the decided
    // tie rule without any test noticing.
    expect(source).not.toMatch(/rank[^\n]*index \+ 1/)
  })
})
```

> **Note for the implementer:** this file asserts on source text rather than on a render. `ScoresTable` calls `useSuspenseQuery`, so rendering it needs a Convex + react-query provider stack that no existing test in this repo stands up. Source assertions are what `dashboard-skeletons.hook.test.ts` already does for the same reason. The *behavioural* coverage for rank, truncation and the name rule lives in Tasks 2, 3 and 4, where it is pure and mutation-tested.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/components/scores-table.hook.test.ts`
Expected: FAIL on all three — none of the changes exist yet.

- [ ] **Step 3: Add the imports and compute ranked rows**

In `v2/src/components/scores-table.tsx`, add to the imports:

```ts
import { rankWithTies } from '#/lib/standings.ts'
import { displayNamesFor } from '#/lib/display-names.ts'
```

Change the component signature to accept the caller's own player id:

```ts
export function ScoresTable({
  teamId,
  month,
  myPlayerId,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  myPlayerId?: Id<'players'>
  className?: string
}) {
```

Replace the inline collision rule — the block reading:

```ts
  // v1 shows a first name alone, and 'First L' only when two players on the team
  // share one. Initials replace both on mobile.
  const duplicateFirstNames = new Set(
    rows
      .map((row) => row.firstName)
      .filter((name, i, all) => all.indexOf(name) !== i),
  )
```

with a call to the extracted rule, which today-panel.tsx uses too:

```ts
  // v1 shows a first name alone, and 'First L' only when two players on the team
  // share one; lib/display-names.ts owns that rule so the Today panel above
  // cannot disagree with this table about what to call someone. Initials
  // replace both on mobile, below, which is presentation rather than collision.
  const displayNames = displayNamesFor(players)
```

Then wrap the existing sort. Replace:

```ts
    .sort((a, b) => b.total - a.total)
```

with:

```ts
    .sort((a, b) => b.total - a.total)

  // Rank AFTER the sort and from the totals, never from the map index — the
  // decided tie rule is standard competition (1, 2, 2, 4) and an index would
  // silently produce dense ranking. lib/standings.ts owns it and is
  // mutation-tested; see its header.
  const rankedRows = rankWithTies(rows)
```

…so the statement reads `const rows = players.map(...).sort(...)` followed by the `rankedRows` line.

- [ ] **Step 4: Render the rank, the self-highlight and the name cap**

Replace the Player `TableHead`:

```tsx
              <TableHead scope="col" className={cn(pinnedLeft, 'rounded-tl-md px-2 md:px-4')}>
                <div className="text-xs md:text-sm">Player</div>
              </TableHead>
```

with:

```tsx
              <TableHead scope="col" className={cn(pinnedLeft, 'rounded-tl-md px-2 md:px-4')}>
                {/* RANK LIVES INSIDE THE PINNED PLAYER CELL, NOT IN A COLUMN OF
                    ITS OWN, and that is a deliberate departure from the design
                    doc's "a rank # column". This table is `table-layout: auto`
                    with `w-max` (see the w-max note below, and
                    wordle-teams-rpql), so a second `sticky` column would need a
                    `left-` offset equal to a width auto-layout is free to
                    change — a latent misalignment of exactly the kind that
                    file's measurements were about. Rank is still stated, still
                    pinned and still first. */}
                <div className="flex items-baseline gap-2 text-xs md:text-sm">
                  <span className="w-4 text-muted-foreground">#</span>
                  <span>Player</span>
                </div>
              </TableHead>
```

Replace the body row opening and its Player cell:

```tsx
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className={pinnedLeft}>
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
```

with:

```tsx
            {rankedRows.map((row) => {
              const isMe = myPlayerId !== undefined && row.id === myPlayerId
              const displayName = displayNames.get(row.id) ?? row.firstName
              return (
              // The caller's own row, tinted. `data-self` is for the e2e and
              // for anyone debugging "why is this row highlighted" — the class
              // alone reads as a styling accident.
              <TableRow key={row.id} data-self={isMe || undefined} className={cn(isMe && 'bg-muted/50')}>
                <TableCell className={cn(pinnedLeft, isMe && 'bg-muted/50')}>
                  {/* The pinned cell needs its OWN tint: pinnedLeft sets
                      `bg-background` opaque (wt-ksh.3.16 — z-index alone does
                      not stop the day columns showing through), which would
                      paint over the row's highlight on exactly the cell the
                      reader looks at first. */}
                  <div className="flex items-baseline gap-2">
                    <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground md:text-sm">
                      {row.rank}
                    </span>
                    {/* CAPPED, WHERE THIS USED TO BE `md:w-max` WITH NO MAXIMUM.
                        That let one long name widen the pinned column and steal
                        horizontal space from every day column beside it — live
                        before this change, and called out in the design doc as
                        a latent bug to fix rather than inherit. The full name
                        stays reachable on `title`. */}
                    <div
                      className="invisible h-0 w-0 md:visible md:h-fit md:max-w-[12ch] md:truncate md:pr-px"
                      title={`${row.firstName} ${row.lastName}`.trim()}
                    >
                      {displayName}
                    </div>
                    <div className="text-xs md:invisible md:h-0 md:w-0 md:text-sm">
                      {row.firstName[0]}
                      {row.lastName[0]}
                    </div>
                  </div>
                </TableCell>
```

- [ ] **Step 5: Tint today's column, and close the map**

Replace the day `TableCell` opening tag:

```tsx
                    <TableCell key={day} data-day={day}>
```

with:

```tsx
                    <TableCell key={day} data-day={day} className={cn(day === today && 'bg-accent/40')}>
```

Then close the new `return` — replace the row's closing:

```tsx
                <TableCell className={pinnedRight}>
                  <div className="text-right font-bold">{row.total}</div>
                </TableCell>
              </TableRow>
            ))}
```

with:

```tsx
                <TableCell className={cn(pinnedRight, isMe && 'bg-muted/50')}>
                  <div className="text-right font-bold">{row.total}</div>
                </TableCell>
              </TableRow>
              )
            })}
```

> **Before hydration `today` is `${month}-01`** (unchanged, and deliberate — see the `today` comment at the top of the file). So the tint lands on the 1st for one paint and moves on hydration. That is the same trade the existing code already makes for the score cells and needs no new hydration guard here; `TodayPanel` is the component where it does (Task 6).

- [ ] **Step 6: Run the test and the gates**

Run: `cd v2 && pnpm vitest run src/components/scores-table.hook.test.ts && pnpm run typecheck && pnpm run lint`
Expected: PASS. (`app.tsx` does not yet pass `myPlayerId`; the prop is optional, so this compiles. Task 9 wires it.)

- [ ] **Step 7: Commit**

```bash
git add v2/src/components/scores-table.tsx v2/src/components/scores-table.hook.test.ts
git commit -m "feat(dashboard): rank, self-highlight, today tint and a capped name column

The name cap fixes a live latent bug rather than inheriting it: md:w-max had
no maximum, so one long name widened the pinned column and squeezed the day
columns. Rank sits inside the pinned cell rather than in a second sticky
column, because table-layout:auto gives no stable width to offset against."
```

---

### Task 6: `TodayPanel`

**Files:**
- Create: `v2/src/components/today-panel.tsx`
- Modify: `v2/src/components/dashboard-skeletons.tsx`
- Test: `v2/src/components/today-panel.hook.test.ts`

- [ ] **Step 1: Add the skeleton**

Append to `v2/src/components/dashboard-skeletons.tsx`:

```tsx
/**
 * CONSTANT HEIGHT AT ANY TEAM SIZE, matching the panel it stands in for: the
 * count, the bar and the capped name list are all fixed-height, so this cannot
 * cause the layout jump the other skeletons here were written to avoid.
 *
 * It is ALSO what TodayPanel renders before hydration — not only what Suspense
 * renders. See that component's hydration note; "today" is a client-only fact
 * and there is nothing honest to draw until the browser clock is readable.
 */
export function TodayPanelSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('rounded-md border p-4', className)}>
      <div className="h-5 w-32 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-2 w-full animate-pulse rounded bg-muted" />
      <div className="mt-3 h-4 w-48 animate-pulse rounded bg-muted" />
    </div>
  )
}

/** One chip row, wrapping — the shape of the legend beneath the table. */
export function ScoringLegendSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-wrap gap-2', className)}>
      {SYSTEM_FIELDS.map((field) => (
        <div key={field} className="h-6 w-12 animate-pulse rounded-full bg-muted" />
      ))}
    </div>
  )
}
```

(`SYSTEM_FIELDS` and `cn` are already imported in that file.)

- [ ] **Step 2: Write the failing test**

Create `v2/src/components/today-panel.hook.test.ts`:

```ts
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { TodayPanelSkeleton } from './dashboard-skeletons.tsx'

afterEach(cleanup)

const source = readFileSync(new URL('./today-panel.tsx', import.meta.url), 'utf8')

describe('TodayPanel guards the hydration hazard', () => {
  // THE TRAP THIS COMPONENT IS BUILT AROUND. "Today" is a client-only fact.
  // Guessing it during SSR is a hydration mismatch, which surfaces in
  // production as a minified React #418 — the same failure src/server.ts
  // records the maintenance-mode rewrite being rejected for. This component is
  // ENTIRELY about today, so it must render the skeleton until hydrated rather
  // than render a guessed value.
  test('it reads useHydrated and returns the skeleton before hydration', () => {
    expect(source).toContain("from '#/lib/use-hydrated.ts'")
    expect(source).toContain('useHydrated()')
    expect(source).toMatch(/if \(!hydrated\) return/)
  })

  test('it renders nothing at all when the month does not contain today', () => {
    // Absent, not empty: a "Today" panel is meaningless while browsing March.
    expect(source).toContain('monthContainsToday')
    expect(source).toMatch(/return null/)
  })

  test('the waiting list is capped through waitingOnSummary, not sliced inline', () => {
    expect(source).toContain("from '#/lib/waiting-on.ts'")
    expect(source).toContain('waitingOnSummary(')
  })

  test('names come from the shared collision rule, not from bare first names', () => {
    // Two Adas must not both read as "Ada" here while the table below
    // disambiguates them.
    expect(source).toContain("from '#/lib/display-names.ts'")
  })
})

describe('TodayPanelSkeleton', () => {
  test('is hidden from the accessibility tree like every other skeleton here', () => {
    const { container } = render(createElement(TodayPanelSkeleton, {}))
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })

  test('pulses, which is what loading looks like in this app', () => {
    render(createElement(TodayPanelSkeleton, {}))
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/components/today-panel.hook.test.ts`
Expected: FAIL — cannot read `today-panel.tsx`.

- [ ] **Step 4: Write the component**

Create `v2/src/components/today-panel.tsx`:

```tsx
import { useState } from 'react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { BoardEntryButton } from '#/components/board-entry/board-entry-button.tsx'
import { TodayPanelSkeleton } from '#/components/dashboard-skeletons.tsx'
import { Button } from '#/components/ui/button.tsx'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { waitingOnSummary } from '#/lib/waiting-on.ts'
import { displayNamesFor } from '#/lib/display-names.ts'
import { cn } from '#/lib/utils.ts'
import { monthContainsToday, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Id } from '../../convex/_generated/dataModel'

/** At most three names before the disclosure. The design's number, not a guess. */
const NAME_LIMIT = 3

/**
 * "Did I play today", and "who are we waiting on" — the two jobs the month grid
 * answers badly by asking you to locate a cell.
 *
 * NO NEW QUERY. This joins the `getTeamMonth` subscription routes/app.tsx
 * already fetches for ScoresTable, TeamBoards and ScoringSystemCard, so it
 * costs no round-trip and updates live with them. getTeamMonthFor maps over
 * team.playerIds, so the payload carries EVERY MEMBER, not only those with
 * scores — which is exactly what "who hasn't played" needs and is why no
 * backend change is required.
 *
 * THE HYDRATION HAZARD IS THE REAL TRAP HERE, and it is why this component
 * renders a skeleton rather than a value on the server. "Today" is a
 * client-only fact; scores-table.tsx records the rule and the reason. That
 * table can render a *neutral* pre-hydration state (every day reads "not yet
 * due", which draws blanks rather than wrong values) because today is one
 * detail of a month grid. This panel is ENTIRELY about today — there is no
 * neutral version of it — so guessing would be a guaranteed mismatch, and a
 * mismatch here is a minified React #418 in production.
 *
 * LONG NAMES USE THE TABLE'S RULE, IMPORTED. lib/display-names.ts is shared
 * with scores-table.tsx so the two surfaces cannot call the same person two
 * different things on one screen.
 *
 * CONSTANT HEIGHT AT ANY TEAM SIZE. Team membership is unbounded
 * (FREE_TEAM_LIMIT caps teams per player, not members per team), so nothing
 * here renders one element per member: the count and the bar are fixed, and the
 * name list is capped by waitingOnSummary with the remainder behind a
 * disclosure.
 */
export function TodayPanel({
  teamId,
  month,
  myPlayerId,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  myPlayerId?: Id<'players'>
  className?: string
}) {
  const hydrated = useHydrated()
  const [expanded, setExpanded] = useState(false)
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))

  // Before hydration there is no honest answer — see the note above.
  if (!hydrated) return <TodayPanelSkeleton className={className} />

  const today = toPuzzleDay(new Date())
  // Absent, not empty. A "Today" panel while browsing March is noise.
  if (!monthContainsToday(month, today)) return null

  const { players } = data
  const played = new Set(
    players.filter((p) => p.scores.some((s) => s.puzzleDay === today)).map((p) => p.id),
  )
  // THE SAME COLLISION RULE THE TABLE USES, imported rather than restated: two
  // Adas on a team must not both read as "Ada" in a "waiting on" line that the
  // table below disambiguates.
  const displayNames = displayNamesFor(players)
  const summary = waitingOnSummary(
    players.map((p) => ({ id: p.id, label: displayNames.get(p.id) ?? p.firstName })),
    played,
    NAME_LIMIT,
  )
  const iPlayed = myPlayerId !== undefined && played.has(myPlayerId)
  const pct = summary.total === 0 ? 0 : Math.round((summary.playedCount / summary.total) * 100)

  return (
    <section aria-label="Today" data-testid="today-panel" className={cn('rounded-md border p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold md:text-base">
          {iPlayed ? "You've played today" : 'You have not played today'}
        </h2>
        {!iPlayed && <BoardEntryButton teamId={teamId} month={month} />}
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-xs text-muted-foreground md:text-sm">
          <span>
            {summary.playedCount} of {summary.total} played
          </span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        {/* A plain div, not <progress>: the role and the values are stated
            explicitly so a screen reader gets the same sentence the sighted
            reader does, without the UA's own styling to fight. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={summary.total}
          aria-valuenow={summary.playedCount}
          aria-label="Players who have entered a board today"
          className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {summary.waiting.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground md:text-sm">
          Waiting on {(expanded ? summary.waiting : summary.shown).join(', ')}
          {!expanded && summary.othersCount > 0 && (
            <>
              {' '}
              <Button
                variant="link"
                className="h-auto p-0 text-xs md:text-sm"
                onClick={() => setExpanded(true)}
              >
                and {summary.othersCount} other{summary.othersCount === 1 ? '' : 's'}
              </Button>
            </>
          )}
        </p>
      )}
    </section>
  )
}

export default TodayPanel
```

- [ ] **Step 5: Verify the import paths resolve**

`BoardEntryButton`'s path and export name must be confirmed rather than assumed:

Run: `cd v2 && grep -rn 'export function BoardEntryButton\|export const BoardEntryButton' src/components/board-entry/`
Then correct the import above if the path differs. Do the same for `Button`:
Run: `cd v2 && ls src/components/ui/button.tsx`

- [ ] **Step 6: Run test and gates**

Run: `cd v2 && pnpm vitest run src/components/today-panel.hook.test.ts && pnpm run typecheck && pnpm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add v2/src/components/today-panel.tsx v2/src/components/today-panel.hook.test.ts v2/src/components/dashboard-skeletons.tsx
git commit -m "feat(dashboard): TodayPanel, gated on hydration and capped at any team size

It renders the skeleton until hydrated rather than guessing today, because
unlike the scores table it has no neutral pre-hydration state -- a guess here
is a guaranteed mismatch and a minified React #418 in production."
```

---

### Task 7: `ScoringLegend`

**Files:**
- Create: `v2/src/components/scoring-legend.tsx`
- Test: `v2/src/components/scoring-legend.hook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/components/scoring-legend.hook.test.ts`:

```ts
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { SYSTEM_FIELDS, SYSTEM_FIELD_LABELS } from '../../convex/lib/scoringSystem.ts'

const source = readFileSync(new URL('./scoring-legend.tsx', import.meta.url), 'utf8')

describe('the legend is derived, never hand-listed', () => {
  // The reason scoringSystem.ts derives SYSTEM_FIELDS from DEFAULT_SYSTEM in
  // the first place: a hand-written list compiles perfectly after a ninth
  // scoring field is added and simply never surfaces it.
  test('order comes from SYSTEM_FIELDS and labels from SYSTEM_FIELD_LABELS', () => {
    expect(source).toContain("from '../../convex/lib/scoringSystem.ts'")
    expect(source).toContain('SYSTEM_FIELDS')
    expect(source).toContain('SYSTEM_FIELD_LABELS')
  })

  test('no label is spelled out in the component', () => {
    // "Missed day" is the one most likely to get retyped, and the design says
    // explicitly that it is NOT abbreviated.
    expect(source).not.toContain("'Missed day'")
    expect(SYSTEM_FIELD_LABELS.nA).toBe('Missed day')
  })

  test('it renders the team system, never DEFAULT_SYSTEM', () => {
    // A legend showing the defaults to a team that scores differently is worse
    // than no legend.
    expect(source).not.toContain('DEFAULT_SYSTEM')
  })

  test('the Edit affordance is gated on isOwner', () => {
    // Team mutations are creator-only and enforced server-side (7a 4), so
    // showing Edit to a member offers an action the server will refuse.
    expect(source).toContain('isOwner')
  })

  test('all eight fields are covered by the derived list', () => {
    expect(SYSTEM_FIELDS).toHaveLength(8)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/components/scoring-legend.hook.test.ts`
Expected: FAIL — cannot read `scoring-legend.tsx`.

- [ ] **Step 3: Write the component**

Create `v2/src/components/scoring-legend.tsx`:

```tsx
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'
import { SYSTEM_FIELDS, SYSTEM_FIELD_LABELS } from '../../convex/lib/scoringSystem.ts'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * The team's points, as a read-only chip strip beneath the table. Replaces
 * ScoringSystemCard's place on the dashboard; the editor itself moves into the
 * team settings dialog.
 *
 * DERIVED, NEVER HAND-LISTED. Order comes from SYSTEM_FIELDS and labels from
 * SYSTEM_FIELD_LABELS, for the reason that module's own header gives: a literal
 * list compiles fine after a ninth field is added and silently never shows it.
 * `nA`'s label is "Missed day" and is deliberately NOT abbreviated even though
 * it is the longest chip — it is the value a player is least likely to guess.
 *
 * THE TEAM'S ACTUAL SYSTEM, NOT DEFAULT_SYSTEM. Teams customise, and a legend
 * showing the defaults to a team that scores differently is worse than no
 * legend at all.
 *
 * NO NEW QUERY — the fourth consumer of the getTeamMonth subscription the page
 * already holds.
 */
export function ScoringLegend({
  teamId,
  month,
  isOwner,
  onEdit,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  isOwner: boolean
  onEdit: () => void
  className?: string
}) {
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { system } = data.team

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <span className="text-xs text-muted-foreground">Scoring</span>
      {SYSTEM_FIELDS.map((field) => {
        const value = system[field]
        return (
          <span
            key={field}
            className="inline-flex items-baseline gap-1 rounded-full border px-2 py-0.5 text-xs"
          >
            <span className="text-muted-foreground">{SYSTEM_FIELD_LABELS[field]}</span>
            {/* The sign is kept, so -1 and -3 read as penalties rather than as
                bare numbers. A leading + on positives makes the two visually
                symmetrical; 0 stays unsigned. */}
            <span className="font-medium tabular-nums">
              {value > 0 ? `+${value}` : String(value)}
            </span>
          </span>
        )
      })}
      {/* CREATOR ONLY. isOwner is already on the page and already passed to
          CurrentTeamCard, so this gate costs no backend change -- it is a prop,
          not a new query. Team mutations are creator-only and enforced
          server-side (7a 4); showing this to a member would offer an action the
          server refuses. */}
      {isOwner && (
        <Button variant="link" className="h-auto p-0 text-xs" onClick={onEdit}>
          Edit
        </Button>
      )}
    </div>
  )
}

export default ScoringLegend
```

- [ ] **Step 4: Confirm the payload actually carries the system under `team.system`**

Run: `cd v2 && grep -n 'system' convex/scores.ts | head -20`
Expected: `getTeamMonthFor` returns the team with a `system` property — `scores-table.tsx` already reads `team.system` for `monthTotal`, so this is a confirmation, not a change. If the shape differs, correct the destructure above.

- [ ] **Step 5: Run test and gates**

Run: `cd v2 && pnpm vitest run src/components/scoring-legend.hook.test.ts && pnpm run typecheck && pnpm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add v2/src/components/scoring-legend.tsx v2/src/components/scoring-legend.hook.test.ts
git commit -m "feat(dashboard): read-only scoring legend, derived from SYSTEM_FIELDS

Renders the team's actual system rather than DEFAULT_SYSTEM, keeps the sign on
negatives, and gates Edit on isOwner because team mutations are creator-only
and enforced server-side."
```

---

### Task 8: `TeamSettingsDialog`

**The components move; they are not rewritten.** A dialog matches the frequency of the job and matches the Settings dialog pattern the app already has. A `/app/team` route was considered and rejected — it adds a `routeTree.gen.ts` entry, which drags in `crawler-metadata.test.ts`'s coverage assertion and a sitemap/robots decision, for no daily benefit.

**Files:**
- Create: `v2/src/components/teams/team-settings-dialog.tsx`

- [ ] **Step 1: Read the existing dialog pattern before writing**

Run: `cd v2 && sed -n '1,60p' src/components/teams/update-team-dialog.tsx`
Run: `cd v2 && ls src/components/ui/ | grep -E 'dialog|tabs'`

Match that file's `Dialog` / `DialogContent` / `DialogHeader` usage and its `open` / `onOpenChange` prop shape exactly rather than inventing a second convention.

- [ ] **Step 2: Write the shell**

Create `v2/src/components/teams/team-settings-dialog.tsx`:

```tsx
import { CurrentTeamCard } from '#/components/teams/current-team-card.tsx'
import { MyTeamsCard } from '#/components/teams/my-teams-card.tsx'
import { ScoringSystemCard } from '#/components/scoring-system-card.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs.tsx'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Team admin, off the dashboard.
 *
 * WHY IT MOVED. Asked which questions the dashboard should answer fastest, the
 * owner selected five and pointedly did not select team admin -- yet
 * CurrentTeamCard, MyTeamsCard and ScoringSystemCard held two of the three
 * columns under the scores table, because v1 held it that way
 * (routes/app.tsx called that slot "the slot v1 gives it"). The carving was
 * inherited, not chosen, and it gave the most room to the one job nobody wants
 * done daily.
 *
 * THE COMPONENTS ARE HOSTED, NOT REWRITTEN. Every prop below is the one
 * routes/app.tsx already passed; this file is a shell and a tab strip.
 */
export function TeamSettingsDialog({
  open,
  onOpenChange,
  teamId,
  month,
  isPro,
  ...cardProps
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: Id<'teams'>
  month: string
  isPro: boolean
} & Omit<React.ComponentProps<typeof CurrentTeamCard>, 'teamId'> &
  Pick<React.ComponentProps<typeof MyTeamsCard>, 'teams' | 'onDeleted'>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Team settings</DialogTitle>
          <DialogDescription>Members, your teams, and how this team scores.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="teams">My teams</TabsTrigger>
            <TabsTrigger value="scoring">Scoring</TabsTrigger>
          </TabsList>
          <TabsContent value="members">
            <CurrentTeamCard teamId={teamId} {...cardProps} />
          </TabsContent>
          <TabsContent value="teams">
            <MyTeamsCard teams={cardProps.teams} onDeleted={cardProps.onDeleted} />
          </TabsContent>
          <TabsContent value="scoring">
            <ScoringSystemCard
              teamId={teamId}
              month={month}
              isPro={isPro}
              isOwner={cardProps.isOwner}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export default TeamSettingsDialog
```

> **The prop spread above is a sketch of intent, not a guarantee.** `CurrentTeamCard` and `MyTeamsCard` have concrete prop types; if the `Omit`/`Pick` composition fights the compiler, **write the props out explicitly** rather than loosening types to make it pass. Explicit is correct here — there are only about eight of them, and they are all visible in `routes/app.tsx`'s current call sites.

- [ ] **Step 3: Confirm `tabs` exists as a UI primitive**

Run: `cd v2 && ls src/components/ui/tabs.tsx`
If absent, add it with the project's shadcn workflow before continuing — do **not** hand-roll a tab strip.

- [ ] **Step 4: Run the gates**

Run: `cd v2 && pnpm run typecheck && pnpm run lint`
Expected: PASS. (Nothing renders it yet; Task 9 wires it.)

- [ ] **Step 5: Commit**

```bash
git add v2/src/components/teams/team-settings-dialog.tsx
git commit -m "feat(dashboard): team settings dialog shell, hosting the three admin cards"
```

---

### Task 9: Rewire the dashboard grid

**Files:**
- Modify: `v2/src/routes/app.tsx`

Target layout:

```
controls        Team · Month · [Team settings] · [Enter board]
TodayPanel      full width, only when the month contains today
ScoresTable     full width
ScoringLegend   attached beneath the table
TeamBoards      full width
```

- [ ] **Step 1: Add the imports**

```ts
import { TodayPanel } from '#/components/today-panel.tsx'
import { ScoringLegend } from '#/components/scoring-legend.tsx'
import { TeamSettingsDialog } from '#/components/teams/team-settings-dialog.tsx'
import { TodayPanelSkeleton, ScoringLegendSkeleton } from '#/components/dashboard-skeletons.tsx'
```

…and remove the now-unused `CurrentTeamCard`, `MyTeamsCard`, `ScoringSystemCard` and `ScoringSystemCardSkeleton` imports.

- [ ] **Step 2: Add a Team settings control to the controls row**

Inside the `<div className="flex items-center gap-2 md:col-span-3">`, before the `ml-auto` board-entry div:

```tsx
        <Button variant="outline" size="sm" onClick={() => setTeamSettingsOpen(true)}>
          Team settings
        </Button>
```

and add the state beside the existing `settingsOpen`:

```ts
  const [teamSettingsOpen, setTeamSettingsOpen] = useState(false)
```

- [ ] **Step 3: Insert `TodayPanel` above the scores table**

Immediately before the `<Suspense>` that wraps `ScoresTable`:

```tsx
      {/* Above the table because it answers a different clock's question --
          "did I play today" is a today question the grid answers badly, by
          asking you to locate a cell. It renders NOTHING when the viewed month
          does not contain today, so the grid closes up on a past month. */}
      <Suspense fallback={<TodayPanelSkeleton className="md:col-span-3" />}>
        <TodayPanel
          teamId={teamParam as Id<'teams'>}
          month={monthParam}
          myPlayerId={myPlayerId}
          className="md:col-span-3"
        />
      </Suspense>
```

- [ ] **Step 4: Pass `myPlayerId` to the table and attach the legend beneath it**

Change the `ScoresTable` call to add `myPlayerId={myPlayerId}`, then immediately after its `</Suspense>`:

```tsx
      {selectedTeam && (
        <Suspense fallback={<ScoringLegendSkeleton className="md:col-span-3" />}>
          <ScoringLegend
            teamId={teamParam as Id<'teams'>}
            month={monthParam}
            isOwner={selectedTeam.isOwner}
            onEdit={() => setTeamSettingsOpen(true)}
            className="md:col-span-3"
          />
        </Suspense>
      )}
```

- [ ] **Step 5: Give `TeamBoards` the full width**

Change `<TeamBoardsSkeleton className="md:row-span-3" />` to `className="md:col-span-3"` and `className="md:row-span-3"` on `TeamBoards` to `className="md:col-span-3"`.

> **`md:row-span-3` existed solely so the admin cards could sit beside it.** With them gone it is inherited v1 geometry with nothing left to justify it. Delete the `className="md:row-span-3"` line on the `TeamBoards` element and the comment above it that describes the v1 slot, replacing that comment with:
>
> ```tsx
>       {/* Full width since the admin cards left the grid. The `md:row-span-3`
>           that used to be here existed only so CurrentTeamCard and
>           ScoringSystemCard could sit beside it. */}
> ```

- [ ] **Step 6: Replace the admin card block with the dialog**

Delete the entire `{selectedTeam && (<> <CurrentTeamCard .../> <UpdateTeamDialog .../> <Suspense><ScoringSystemCard .../></Suspense> </>)}` block **and** the trailing `<MyTeamsCard ... />`, and put in their place, just before `</main>`:

```tsx
      {selectedTeam && (
        <>
          <TeamSettingsDialog
            open={teamSettingsOpen}
            onOpenChange={setTeamSettingsOpen}
            teamId={selectedTeam.id}
            month={monthParam}
            isPro={isPro}
            name={selectedTeam.name}
            members={selectedTeam.members}
            isOwner={selectedTeam.isOwner}
            myPlayerId={myPlayerId}
            teams={teams}
            onEditSettings={() => setSettingsOpen(true)}
            onLeft={() => {
              localStorage.removeItem(STORAGE_KEY)
              void navigate({ to: Route.fullPath, search: {}, replace: true })
            }}
            onDeleted={(deleted) => {
              if (deleted !== teamParam) return
              localStorage.removeItem(STORAGE_KEY)
              void navigate({ to: Route.fullPath, search: {}, replace: true })
            }}
          />
          <UpdateTeamDialog open={settingsOpen} onOpenChange={setSettingsOpen} team={selectedTeam} />
        </>
      )}
```

**Both navigation handlers are preserved verbatim** — they solve the broken-`?team=` problem that leaving or deleting a team creates, and that problem is unchanged by the move.

- [ ] **Step 7: Run every gate**

Run: `cd v2 && pnpm run typecheck && pnpm run lint && pnpm vitest run && pnpm run build`
Expected: all PASS. Fix any unused-import lint errors from the removed components.

- [ ] **Step 8: Look at it**

Run: `cd v2 && pnpm run dev`
Check by hand, because none of the above is visible to a gate:
1. Current month — `TodayPanel` present, count and bar correct, CTA shown only when you have not played.
2. Switch to a past month — `TodayPanel` **absent**, and the grid closes up with no gap.
3. Your own row is tinted, including its pinned first and last cells.
4. Today's column is tinted.
5. A long name ellipses instead of widening the pinned column; `title` shows the full name.
6. The legend shows the team's real values with signs on negatives; Edit appears only if you own the team.
7. Team settings opens the dialog with all three tabs working.

- [ ] **Step 9: Commit**

```bash
git add v2/src/routes/app.tsx
git commit -m "feat(dashboard): split Today from the Month, and move team admin into a dialog

TeamBoards loses md:row-span-3 and goes full width -- that span existed only
so the admin cards could sit beside it. Both the onLeft and onDeleted
navigation handlers move across verbatim; they solve the broken ?team= problem
that leaving or deleting a team creates, which this change does not alter."
```

---

### Task 10: §7a rows 61–65

**Files:**
- Modify: `docs/design-system/V2-ADDENDUM.md`

**Parity with v1 is explicitly not a constraint for this work** — that is the issue's own wording — which is exactly why each adopted change earns a row.

- [ ] **Step 1: Confirm the current last row number and header word**

Run: `grep -n 'known differences' docs/design-system/V2-ADDENDUM.md`
Run: `grep -c '^| [0-9]' docs/design-system/V2-ADDENDUM.md`
Expected as of 2026-09-04: header `**Sixty known differences...`, §7a table last row `60`.

**If these differ, use the real numbers** — the rows below become `last+1 … last+5` and the header word changes accordingly. `src/addendum-divergences.test.ts` will fail loudly if you get it wrong, and its number-word map already covers up to `Sixty-five`.

- [ ] **Step 2: Append the five rows to the §7a table**

```markdown
| 61 | A Today panel above the scores table; v1 has no equivalent surface |
| 62 | The scores table states rank and highlights the caller's own row |
| 63 | Today's column is tinted in the scores table |
| 64 | Team admin lives in a dialog, not in cards on the dashboard |
| 65 | A read-only scoring legend replaces the on-page scoring card |
```

- [ ] **Step 3: Update the header count IN THE SAME EDIT**

Change `**Sixty known differences` to `**Sixty-five known differences`.

> **This is the step that has been skipped three times** (`wordle-teams-4m2t`). The header is load-bearing: §7a tells the reader that anything past the stated number is a bug, so a stale count turns real divergences into false defects. Do not split it into a follow-up commit.

- [ ] **Step 4: Run the assertion**

Run: `cd v2 && pnpm vitest run src/addendum-divergences.test.ts`
Expected: PASS — 3 tests. A failure names exactly which of the count, the contiguity or the parse is wrong.

- [ ] **Step 5: Run all four gates**

Run: `cd v2 && pnpm vitest run && pnpm run typecheck && pnpm run lint && pnpm run build`

> **Yes, all four, for a docs-only edit.** `V2-ADDENDUM.md` is tested — `test` is the gate that catches this one, and a docs commit that skips it is exactly how the count drifted before.

- [ ] **Step 6: Commit**

```bash
git add docs/design-system/V2-ADDENDUM.md
git commit -m "docs(7a): rows 61-65 for the dashboard split, and the header count with them"
```

---

### Task 11: The one e2e worth its keep

`TodayPanel` being absent on a non-current month is the one behaviour whose failure is **silent** and whose cause (hydration) is expensive to diagnose after the fact.

**Files:**
- Modify: an existing dashboard spec under `v2/e2e/`

- [ ] **Step 1: Find the right spec and its sign-in helper**

Run: `cd v2 && ls e2e/`
Run: `cd v2 && grep -rn 'test(' e2e/ | head -20`

Add to the existing dashboard spec rather than creating a new file, and reuse its established sign-in/seed helper — do not invent a second way in.

- [ ] **Step 2: Write the test**

```ts
test('the Today panel is absent when the viewed month is not the current month', async ({ page }) => {
  // THE FAILURE THIS CATCHES IS SILENT. TodayPanel renders its skeleton until
  // hydrated and null when the month does not contain today; get either wrong
  // and the panel either never appears at all or appears on every month
  // showing last-month data as though it were today. Neither throws, and no
  // unit test sees it, because the predicate and the hydration gate only meet
  // in the rendered component.
  await page.goto('/app')
  await expect(page.getByTestId('today-panel')).toBeVisible()

  // Navigate to a previous month via the month picker. Adapt the selector to
  // whatever the surrounding spec already uses -- do not add a second way of
  // driving this control.
  await page.getByRole('button', { name: /month/i }).click()
  await page.getByRole('option').nth(1).click()

  await expect(page.getByTestId('today-panel')).toHaveCount(0)
})
```

- [ ] **Step 3: Run it — against a FRESH dev server**

```bash
cd v2 && pnpm exec playwright test e2e/<the-spec>.spec.ts
```

> **Kill anything already holding :3000 first.** Playwright attaches to whatever owns that port, and a stale dev server means every run tests stale code — a two-day-old `vite dev` once made a whole run meaningless. Check with `lsof -ti:3000` and kill it before running.

- [ ] **Step 4: Verify it actually discriminates**

Temporarily change `if (!monthContainsToday(month, today)) return null` to `return null` unconditionally in `today-panel.tsx` and re-run: the FIRST assertion must fail. Then change it to never return null and re-run: the SECOND must fail. **Revert both.** A test that passes under both mutations is not coverage — this project has already shipped three no-op "kills".

- [ ] **Step 5: Commit**

```bash
git add v2/e2e/
git commit -m "test(e2e): the Today panel is absent off the current month

Verified to discriminate in both directions -- forced always-null and
never-null each fail a different assertion."
```

---

## Final verification

- [ ] **All four gates, from `v2/`, with no pipes** (a piped check reports a false green under zsh — `PIPESTATUS` is empty there):

```bash
cd v2
TZ=UTC pnpm vitest run;   echo "TEST=$?"
TZ=UTC pnpm run typecheck; echo "TSC=$?"
TZ=UTC pnpm run lint;      echo "LINT=$?"
TZ=UTC pnpm run build;     echo "BUILD=$?"
```

`TZ=UTC` because that is what CI runs, and a date-sensitive test can pass on the host zone and fail there.

- [ ] **e2e separately** — it is not one of the four gates and has stayed red for three tasks before now.
- [ ] Close `wordle-teams-5jcn` in beads with what shipped and what deviated.
- [ ] `git push`.

---

## Deviations from the spec, for the owner

1. **Rank is inside the pinned Player cell, not a separate `#` column** (Task 5). `table-layout: auto` gives no stable width to offset a second sticky column against. A true column means making the first two columns fixed-width, which is its own change.
2. **New §7a rows are 61–65, not 60–64.** The table gained a row after the spec was written.
