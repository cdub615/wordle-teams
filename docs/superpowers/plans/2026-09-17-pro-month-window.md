# Pro Month Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Pro players month history back to their team's earliest board, enforced on the server, and produce the one canonical statement of what Pro includes.

**Architecture:** One import-free rule module (`convex/lib/monthWindow.ts`) is imported by both the browser, which builds the month dropdown from it, and by `getTeamMonthFor`, which refuses anything below its floor. A per-selected-team query supplies the rule's two inputs. `src/lib/pro-benefits.ts` falls out at the end as the inventory that wordle-teams-iht.1 and wordle-teams-wty4.1.14 both consume.

**Tech Stack:** TypeScript, Convex, TanStack Router + Query, React 19, Radix DropdownMenu, vitest (edge-runtime by default, jsdom for component tests), convex-test.

**Spec:** `docs/superpowers/specs/2026-09-17-pro-month-window-design.md`
**Issue:** `wordle-teams-kusd`

---

## Working agreements

- All commands run from `v2/`.
- The four gates are `pnpm typecheck`, `pnpm lint`, `pnpm test:once`, `pnpm build`. Run all four before the final commit; they catch different things.
- Never `git commit --no-verify` — a PII scan and a beads export run in that hook.
- Component tests are `*.hook.test.ts` with `// @vitest-environment jsdom` and `createElement`. vitest's glob is `src/**/*.test.ts`, so a `.tsx` test file would silently not run.
- User-facing copy uses typographic apostrophes (`’`).
- Comments explain WHY, at length, matching the density of the file you are in. Every factual claim about another file must be checked against that file before you write it.

## Two decisions this plan makes that the spec did not anticipate

Both are inside the approved design, not departures from it. They are called out here so a reviewer does not have to rediscover them.

**1. The server enforces a FLOOR, with one month of slack — not membership of the client's exact window.** `toPuzzleDay` resolves in the runtime's local zone, and Convex runs UTC while the viewer does not. At a month boundary a viewer in Tokyo is on 2026-10-01 while the server is still on 2026-09-30, so a server window of `[09, 08, 07]` would refuse the `2026-10` the dropdown just offered — breaking the dashboard for everyone east of UTC on the 1st of each month, and everyone west of it for the oldest month. The gate exists to stop someone browsing years of history, not to be exact to the month, so the server floor is the client window's oldest month minus one. A free player can reach at most four months by hand-typing a URL instead of three; the dropdown still offers three.

**2. The Pro check is skipped entirely in the common path.** Nearly every request is for one of the last three months. `getTeamMonthFor` compares against the free floor first and only pays for `isProFor` and the per-member earliest reads when the requested month is older than that. This keeps the dashboard's core query at exactly its current cost for almost every call — the same "the pro check is one indexed read, do it first" cost reasoning `teams.ts:722` uses, inverted.

---

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `convex/lib/monthWindow.ts` | create | The rule. Pure, importing only `puzzleDay.ts`. Client and server both import it. |
| `convex/lib/monthWindow.test.ts` | create | The rule's tests, including the element-0 property. |
| `convex/scores.ts` | modify | `earliestMonthFor` helper, `monthWindowInputsFor` + `monthWindow` query, and the floor check inside `getTeamMonthFor`. |
| `convex/scores.test.ts` | modify | Enforcement and query tests. |
| `convex/access.ts` | modify | `MONTH_OUT_OF_WINDOW` added to `AccessCode`; the stale `isProFor` comment discharged. |
| `src/lib/convex-error.ts` | modify | The new code's message. |
| `src/components/month-picker.tsx` | modify | Takes a window; renders the Pro teaser row. `monthOptions` deleted. |
| `src/components/month-picker.test.ts` | modify | Rewritten against the window. |
| `src/components/month-picker.hook.test.ts` | create | The teaser row's render rules. |
| `src/routes/app.tsx` | modify | The window query, both pickers, and the corrective navigation. |
| `src/lib/dashboard-months.ts` | create | The corrective-navigation decision, as a pure function. |
| `src/lib/dashboard-months.test.ts` | create | Its tests, including idempotence. |
| `src/lib/pro-benefits.ts` | create | The canonical inventory. |
| `src/lib/pro-benefits.test.ts` | create | Its tests. |

---

### Task 1: The rule

**Files:**
- Create: `v2/convex/lib/monthWindow.ts`
- Test: `v2/convex/lib/monthWindow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/convex/lib/monthWindow.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { monthWindowFor, proTeaserMonth, serverFloorFor } from './monthWindow.ts'

describe('monthWindowFor — free', () => {
  test('is the current month and the two before it, newest first', () => {
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: false })).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
    ])
  })

  test('walks back across a year boundary', () => {
    expect(monthWindowFor({ currentMonth: '2026-01', earliestMonth: null, pro: false })).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ])
  })

  test('ignores earliestMonth entirely — a free window does not depend on the team', () => {
    // A MUTATION GUARD, not a restatement. If the free branch ever starts
    // consulting earliestMonth, a team younger than three months would silently
    // get a shorter list than every other team, and nothing else here would say so.
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: '2026-08', pro: false })).toEqual(
      monthWindowFor({ currentMonth: '2026-08', earliestMonth: '2019-01', pro: false }),
    )
  })
})

describe('monthWindowFor — pro', () => {
  test('spans earliestMonth through currentMonth inclusive, newest first', () => {
    expect(monthWindowFor({ currentMonth: '2026-03', earliestMonth: '2025-12', pro: true })).toEqual([
      '2026-03',
      '2026-02',
      '2026-01',
      '2025-12',
    ])
  })

  test('is uncapped — a team dating to 2023 reaches 2023', () => {
    // THE POINT OF THE WHOLE FEATURE. insights-months.ts caps its own window at
    // twelve so it can render without scroll math; this one must not, because a
    // cap is exactly the regression a migrating v1 Pro subscriber would feel.
    const months = monthWindowFor({ currentMonth: '2026-09', earliestMonth: '2023-03', pro: true })

    expect(months).toHaveLength(43)
    expect(months[months.length - 1]).toBe('2023-03')
  })

  test('with no boards at all, is just the current month', () => {
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: null, pro: true })).toEqual([
      '2026-08',
    ])
  })

  test('clamps an earliestMonth in the future to the current month', () => {
    // Clock skew, or a board entered between currentMonth being computed and
    // this running. Must not produce a negative-length or empty list.
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: '2026-11', pro: true })).toEqual([
      '2026-08',
    ])
  })
})

describe('the element-0 property', () => {
  // DO NOT BREAK THIS. dashboard-months.ts falls back to element 0 for an
  // out-of-window ?month=, and that fallback settles — rather than the effect
  // behind it navigating forever — only because the fallback value is itself
  // always a member of the window it is judged against. insights-months.ts
  // records the identical property for resolveInsightsSearch, in the same words.
  const inputs = [
    { currentMonth: '2026-08', earliestMonth: null, pro: false },
    { currentMonth: '2026-08', earliestMonth: null, pro: true },
    { currentMonth: '2026-08', earliestMonth: '2023-03', pro: true },
    { currentMonth: '2026-08', earliestMonth: '2026-08', pro: true },
    { currentMonth: '2026-08', earliestMonth: '2099-01', pro: true },
    { currentMonth: '2026-01', earliestMonth: '2025-11', pro: false },
  ]

  test.each(inputs)('currentMonth is element 0 for %j', (input) => {
    expect(monthWindowFor(input)[0]).toBe(input.currentMonth)
  })

  test.each(inputs)('the window is strictly descending for %j', (input) => {
    const months = monthWindowFor(input)
    expect([...months].sort().reverse()).toEqual(months)
  })
})

describe('serverFloorFor', () => {
  test('is one month below the free window, so a timezone skew cannot refuse a month the dropdown offered', () => {
    // Convex runs UTC; the viewer does not. At a month boundary the two
    // disagree by one month in either direction, so an exact server window
    // would refuse the month the client just offered. See the plan's note 1.
    expect(serverFloorFor({ currentMonth: '2026-08', earliestMonth: null, pro: false })).toBe('2026-05')
  })

  test('is one month below the pro window', () => {
    expect(serverFloorFor({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: true })).toBe(
      '2023-02',
    )
  })
})

describe('proTeaserMonth', () => {
  test('names the earliest month when it is older than the free window', () => {
    expect(
      proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: false }),
    ).toBe('2023-03')
  })

  test('is null for a pro player — there is nothing left to tease', () => {
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: true })).toBeNull()
  })

  test('is null when the team has no boards at all', () => {
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: null, pro: false })).toBeNull()
  })

  test('is null when the earliest board is already inside the free window', () => {
    // THE GUARD THAT STOPS A WEEK-OLD TEAM ADVERTISING HISTORY IT DOES NOT HAVE.
    // '2026-06' is the oldest month the free window offers, so there is nothing
    // behind the gate and no row may render.
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '2026-06', pro: false })).toBeNull()
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '2026-07', pro: false })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd v2 && pnpm exec vitest run convex/lib/monthWindow.test.ts`
Expected: FAIL — `Failed to resolve import "./monthWindow.ts"`.

- [ ] **Step 3: Write the implementation**

Create `v2/convex/lib/monthWindow.ts`:

```ts
import { addMonths, type PuzzleMonth } from './puzzleDay.ts'

/**
 * HOW FAR BACK A PLAYER MAY LOOK, and what a free player is told they are missing.
 *
 * NO IMPORTS BUT puzzleDay.ts, for the reason insightsAccess.ts has none at all:
 * the browser needs this rule to build the month dropdown, and reaching it
 * through ../access.ts would drag auth.ts — the whole Better Auth server surface
 * — into the client chunk. puzzleDay.ts is itself import-free and is pure string
 * arithmetic over 'YYYY-MM', so it costs nothing to carry. If you are about to
 * add any other import here, read insightsAccess.ts's header first.
 *
 * THE DECISION LIVES HERE AS PURE FUNCTIONS and the Convex wrapper only supplies
 * the inputs, because nothing in this repo can drive an authed wrapper
 * (wordle-teams-obw) — a rule left inside one is a rule no test can execute.
 *
 * THIS IS A DIFFERENT RULE FROM insights-months.ts's `teamMonthOptions`, and the
 * two must not be unified. That one runs from the team's CREATION month and caps
 * at twelve so its list renders without scroll math. This one runs from the
 * team's earliest BOARD and is uncapped, because its job is parity with v1 —
 * where a Pro player reaches every month their team has ever played — and a cap
 * is precisely the regression a migrating subscriber would feel.
 */

/** What a free account sees: this month and the two before it. v1's window. */
export const FREE_MONTHS = 3

/**
 * ONE MONTH OF SLACK BETWEEN WHAT THE CLIENT OFFERS AND WHAT THE SERVER ACCEPTS.
 *
 * Convex runs UTC. `toPuzzleDay` resolves in the runtime's local zone, so the
 * server's idea of "this month" and the viewer's disagree for a few hours at
 * every month boundary — in BOTH directions, depending on which side of UTC the
 * viewer is on. Without slack, a viewer in Tokyo just after local midnight on
 * the 1st would be offered a month the server then refuses, and the dashboard
 * would break for everyone east of UTC on the 1st of every month.
 *
 * The gate exists to stop someone reading years of history they have not paid
 * for, not to be exact to the month. One month of tolerance costs a hand-typed
 * URL at most one extra month and removes a whole class of clock bug.
 */
const SERVER_SLACK_MONTHS = 1

export type MonthWindowInput = {
  /** The viewer's current month, 'YYYY-MM'. Local on the client, UTC on the server. */
  currentMonth: PuzzleMonth
  /** The earliest month anyone on the team's roster has a board in, or null for none. */
  earliestMonth: PuzzleMonth | null
  /** `membershipStatus === 'pro'`. The Insights trial does NOT open this window — see the spec. */
  pro: boolean
}

/**
 * Every month this viewer may look at, NEWEST FIRST.
 *
 * DESCENDING IS A DELIBERATE DIVERGENCE FROM v1 (wordle-teams-l23h), recorded in
 * V2-ADDENDUM.md row 48: v1's getMonthsFromScoreDate walks forward and pushes the
 * current month on last, which puts the month a reader almost always wants off
 * the bottom of a scroll once the list is long. It is long now.
 *
 * `currentMonth` IS ALWAYS ELEMENT 0, FOR EVERY INPUT — free or pro, with or
 * without boards, and for an earliestMonth in the future. Both clamps below bound
 * where the range STARTS, and the list is built by counting BACK from
 * `currentMonth`, so the span is never less than one.
 *
 * DO NOT BREAK THAT PROPERTY. dashboard-months.ts's termination depends on it by
 * name: `correctedMonth` falls back to element 0 whenever `?month=` is not a
 * member of this list, and that fallback settles — rather than the effect behind
 * it navigating forever — only because the fallback value is itself always a
 * member. A change like "do not offer the current month until the team has a
 * board in it" would read as entirely reasonable here and reintroduce an infinite
 * redirect in a file its author had no reason to open. insights-months.ts carries
 * this same warning for the same reason; the test that names the rule lives in
 * monthWindow.test.ts.
 */
export function monthWindowFor({
  currentMonth,
  earliestMonth,
  pro,
}: MonthWindowInput): Array<PuzzleMonth> {
  if (!pro) return countBack(currentMonth, FREE_MONTHS)

  // A team with no boards has no floor to clamp to, so the answer is the current
  // month alone — the one sure thing about any team is that it can be viewed now.
  if (earliestMonth === null) return [currentMonth]

  // PuzzleMonth is 'YYYY-MM', so lexical comparison IS chronological comparison
  // (see puzzleDay.ts's header). That is what makes this a string compare rather
  // than a date parse, and it is why an earliestMonth in the future clamps here
  // rather than producing a negative span below.
  const start = earliestMonth > currentMonth ? currentMonth : earliestMonth
  return countBack(currentMonth, monthIndex(currentMonth) - monthIndex(start) + 1)
}

/**
 * The oldest month the SERVER will serve this viewer — one month below the
 * client's window, per SERVER_SLACK_MONTHS.
 *
 * A FLOOR RATHER THAN MEMBERSHIP OF THE WINDOW, deliberately. There is no upper
 * bound to enforce: a future month simply contains no boards, and refusing one
 * would be a second way for the UTC/local disagreement above to break a page.
 */
export function serverFloorFor(input: MonthWindowInput): PuzzleMonth {
  const months = monthWindowFor(input)
  return addMonths(months[months.length - 1], -SERVER_SLACK_MONTHS)
}

/**
 * The month to advertise to a free player as what Pro reaches back to, or null
 * when there is nothing to advertise.
 *
 * NULL IS THE IMPORTANT ANSWER. A team whose earliest board is already inside the
 * free window has nothing behind the gate, and a row saying otherwise would sell
 * a week-old team history it does not have. Same for a team with no boards at
 * all, and for a player who is already Pro.
 */
export function proTeaserMonth({
  currentMonth,
  earliestMonth,
  pro,
}: MonthWindowInput): PuzzleMonth | null {
  if (pro || earliestMonth === null) return null

  const free = monthWindowFor({ currentMonth, earliestMonth, pro: false })
  const oldestOffered = free[free.length - 1]
  return earliestMonth < oldestOffered ? earliestMonth : null
}

/** `count` months ending at `from`, newest first. */
function countBack(from: PuzzleMonth, count: number): Array<PuzzleMonth> {
  return Array.from({ length: count }, (_, i) => addMonths(from, -i))
}

/** Months since year zero, purely so two PuzzleMonths can be subtracted. */
function monthIndex(month: PuzzleMonth): number {
  const [year, monthNum] = month.split('-').map(Number)
  return year * 12 + monthNum
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd v2 && pnpm exec vitest run convex/lib/monthWindow.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Mutation-test the two guards**

Guard A — the `pro` branch. Edit `monthWindowFor` so the first line reads `if (false)` instead of `if (!pro)`.
Run: `cd v2 && pnpm exec vitest run convex/lib/monthWindow.test.ts`
Expected: FAIL, naming `monthWindowFor — free › is the current month and the two before it`.
Restore the line. Re-run. Expected: PASS.

Guard B — the teaser's "nothing behind the gate" check. Edit `proTeaserMonth`'s last line to `return earliestMonth`.
Run: `cd v2 && pnpm exec vitest run convex/lib/monthWindow.test.ts`
Expected: FAIL, naming `proTeaserMonth › is null when the earliest board is already inside the free window`.
Restore the line. Re-run. Expected: PASS.

If either mutation leaves the suite green, the test is not testing what it says — fix the test before continuing.

- [ ] **Step 6: Commit**

```bash
cd v2 && git add convex/lib/monthWindow.ts convex/lib/monthWindow.test.ts
git commit -m "feat(months): the pro month window rule, shared by client and server

One import-free module, the way insightsAccess.ts is one, so the browser can
build the dropdown from the same rule getTeamMonthFor enforces. The server
floor carries a month of slack because Convex runs UTC and the viewer does
not — without it the dashboard breaks east of UTC on the 1st.

wordle-teams-kusd"
```

---

### Task 2: The query that supplies the inputs

**Files:**
- Modify: `v2/convex/scores.ts`
- Test: `v2/convex/scores.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/scores.test.ts`:

```ts
describe('monthWindowInputsFor', () => {
  test('reports the earliest board of anyone on the roster, not just the caller', () => {
    // "THE TEAM'S EARLIEST SCORE" IS NECESSARILY THE ROSTER'S, because
    // dailyScores has no teamId — a board belongs to a player. This is the same
    // resolution getTeamMonthFor already does, so the window and the data it
    // gates agree by construction.
    return convexTest(schema, modules).run(async (ctx) => {
      const mine = await ctx.db.insert('players', aPlayer())
      const theirs = await ctx.db.insert('players', aPlayer({ email: 'other@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [mine, theirs] }))
      await ctx.db.insert('dailyScores', {
        playerId: mine,
        puzzleDay: '2026-05-02',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('dailyScores', {
        playerId: theirs,
        puzzleDay: '2023-03-14',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      expect(await monthWindowInputsFor(ctx, mine, teamId)).toEqual({
        earliestMonth: '2023-03',
        pro: false,
      })
    })
  })

  test('reports null when nobody on the team has ever entered a board', () => {
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      expect(await monthWindowInputsFor(ctx, playerId, teamId)).toEqual({
        earliestMonth: null,
        pro: false,
      })
    })
  })

  test('reports pro for a player with a pro membership row', () => {
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })

      expect((await monthWindowInputsFor(ctx, playerId, teamId)).pro).toBe(true)
    })
  })

  test('refuses a caller who is not on the team', () => {
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const outsiderId = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      await expect(monthWindowInputsFor(ctx, outsiderId, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  test('ignores a roster entry whose player row is gone', () => {
    // Same degradation getTeamMonthFor makes for the same reason: Convex ids are
    // not foreign keys, so nothing guarantees every id in playerIds resolves.
    // Here the read is by index on the id itself, so an unresolvable member
    // contributes no rows rather than throwing — asserted so a future rewrite
    // that dereferences the member doc does not silently take the page down.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const ghostId = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId, ghostId] }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-05-02',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.delete(ghostId)

      expect((await monthWindowInputsFor(ctx, playerId, teamId)).earliestMonth).toBe('2026-05')
    })
  })
})
```

Add `monthWindowInputsFor` to the existing import from `'./scores'` at the top of the file:

```ts
import { getTeamMonthFor, monthWindowInputsFor, upsertBoardFor } from './scores'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd v2 && pnpm exec vitest run convex/scores.test.ts -t monthWindowInputsFor`
Expected: FAIL — `monthWindowInputsFor is not a function`.

- [ ] **Step 3: Write the implementation**

In `v2/convex/scores.ts`, add `isProFor` to the existing import from `'./access'`, add `monthOf` to the import from `'./lib/puzzleDay.ts'`, and add these below `getTeamMonth`:

```ts
/**
 * The earliest month anyone on this roster has a board in, or null for none.
 *
 * ONE INDEXED `.first()` PER MEMBER, ascending — `by_player_and_puzzleDay` is
 * already the index getTeamMonthFor walks for the month's scores, and an index
 * range's first row IS its smallest. No scan, no sort, no collect.
 *
 * ACROSS THE CURRENT ROSTER, WHICH IS THE ONLY MEANING AVAILABLE: dailyScores has
 * no teamId (see schema.ts), so a board belongs to a player rather than to a
 * team. That is not a workaround — it is exactly how getTeamMonthFor resolves the
 * scoreboard above, so the window and the data it gates can never disagree. A
 * member joining brings their earlier boards and widens the window; a member
 * leaving takes theirs and narrows it. Both are correct, and both are already
 * visible on the scoreboard the same way.
 *
 * DO NOT "OPTIMISE" THIS ONTO teamMonthStats. That table is computed, its
 * coverage of old months is not guaranteed, and reading it here would recreate
 * exactly the aggregate-versus-roster disagreement wordle-teams-iht.4 exists to
 * close.
 */
async function earliestMonthFor(
  ctx: ReaderCtx,
  playerIds: readonly Id<'players'>[],
): Promise<PuzzleMonth | null> {
  // Promise.all rather than a sequential loop for the reason getTeamMonthFor
  // gives above: one snapshot-isolated transaction, so this is round trips
  // rather than correctness. Order does not matter here — the result is a min.
  const firsts = await Promise.all(
    playerIds.map((memberId) =>
      ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', memberId))
        .first(),
    ),
  )

  let earliest: PuzzleDay | null = null
  for (const row of firsts) {
    // PuzzleDay is 'YYYY-MM-DD', so lexical comparison is chronological.
    if (row !== null && (earliest === null || row.puzzleDay < earliest)) earliest = row.puzzleDay
  }
  return earliest === null ? null : monthOf(earliest)
}

/**
 * What the month dropdown needs to build itself: how far back this team goes,
 * and whether this viewer may reach it.
 *
 * A SEPARATE QUERY RATHER THAN A FIELD ON getTeamMonth'S PAYLOAD. MonthPicker
 * renders in the controls row of routes/app.tsx, OUTSIDE the <Suspense> boundary
 * getTeamMonth sits behind; hanging the dropdown's contents on that payload would
 * make it wait for a month of scores to load before it could say which months
 * exist.
 *
 * IT RETURNS THE RULE'S INPUTS, NOT THE RULE'S ANSWER, because the answer needs
 * the VIEWER'S current month and the server does not have it — Convex runs UTC.
 * lib/monthWindow.ts turns these two values into a window on whichever side is
 * asking. Sending a server-computed list instead would be wrong for a few hours
 * at every month boundary, in whichever direction the viewer's zone leans.
 */
export async function monthWindowInputsFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<{ earliestMonth: PuzzleMonth | null; pro: boolean }> {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  const [earliestMonth, pro] = await Promise.all([
    earliestMonthFor(ctx, team.playerIds),
    isProFor(ctx, playerId),
  ])
  return { earliestMonth, pro }
}

export const monthWindow = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await monthWindowInputsFor(ctx, player._id, teamId)
  },
})
```

Add the `PuzzleDay` and `PuzzleMonth` types to the existing `./lib/puzzleDay.ts` import if they are not already there.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd v2 && pnpm exec vitest run convex/scores.test.ts -t monthWindowInputsFor`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd v2 && git add convex/scores.ts convex/scores.test.ts
git commit -m "feat(months): a query for how far back a team goes

Returns the rule's inputs rather than its answer: the viewer's current month
is local and the server's is UTC, so only the asking side can build the window.

wordle-teams-kusd"
```

---

### Task 3: Enforcement

**Files:**
- Modify: `v2/convex/access.ts`
- Modify: `v2/convex/scores.ts:37-58` (inside `getTeamMonthFor`, after `requireTeamMemberFor`)
- Modify: `v2/src/lib/convex-error.ts`
- Test: `v2/convex/scores.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/scores.test.ts`, inside the existing `describe('getTeamMonthFor', ...)`:

```ts
  test('refuses a free caller a month below the floor', () => {
    // THE GATE. Without it the three-month window is decoration: getTeamMonthFor
    // checks membership and nothing else, so any member can reach any month by
    // typing a URL. Layer 3 stopped being decorative in wordle-teams-iht.3 and
    // this is the same standard applied to the scoreboard.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      await expect(
        getTeamMonthFor(ctx, playerId, teamId, addMonths(monthOf(today), -6)),
      ).rejects.toMatchObject({ data: { code: 'MONTH_OUT_OF_WINDOW' } })
    })
  })

  test('serves a free caller the current month and the two before it', () => {
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      for (const delta of [0, -1, -2]) {
        await expect(
          getTeamMonthFor(ctx, playerId, teamId, addMonths(monthOf(today), delta)),
        ).resolves.toBeDefined()
      }
    })
  })

  test('serves a pro caller a month back to the roster’s earliest board', () => {
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2023-03-14',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      await expect(getTeamMonthFor(ctx, playerId, teamId, '2023-03')).resolves.toBeDefined()
    })
  })

  test('refuses a pro caller a month before the roster’s earliest board', () => {
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2023-03-14',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      await expect(getTeamMonthFor(ctx, playerId, teamId, '2022-01')).rejects.toMatchObject({
        data: { code: 'MONTH_OUT_OF_WINDOW' },
      })
    })
  })

  test('refuses a caller inside the Insights trial the pro window', () => {
    // THE TRIAL DOES NOT OPEN THIS WINDOW, and that is a decision rather than an
    // oversight — see the spec's §4. The trial was specified as one month of
    // Insights layers 2 and 3, not a scoreboard grant. Asserted here rather than
    // left to follow from isProFor's definition, because "the trial is pro
    // enough" is exactly the reasonable-sounding change that would ship it.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer({ trialEndsAt: Date.now() + 86_400_000 }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2023-03-14',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      await expect(getTeamMonthFor(ctx, playerId, teamId, '2023-03')).rejects.toMatchObject({
        data: { code: 'MONTH_OUT_OF_WINDOW' },
      })
    })
  })
```

Before writing this, confirm `aPlayer` accepts `trialEndsAt` — run `grep -n "trialEndsAt" convex/fixtures.ts convex/schema.ts`. If the fixture does not take it, insert the player and then `ctx.db.patch(playerId, { trialEndsAt: ... })`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd v2 && pnpm exec vitest run convex/scores.test.ts -t "below the floor"`
Expected: FAIL — the call resolves instead of rejecting.

- [ ] **Step 3: Add the access code**

In `v2/convex/access.ts`, add to the `AccessCode` union (after `'TEAM_LIMIT_REACHED'`):

```ts
  | 'MONTH_OUT_OF_WINDOW'
```

- [ ] **Step 4: Add the message**

In `v2/src/lib/convex-error.ts`, add a case to `typedCodeMessage`:

```ts
    case 'MONTH_OUT_OF_WINDOW':
      // REACHED BY A URL, NOT BY A CONTROL. The month dropdown never offers a
      // month outside the window, and routes/app.tsx corrects ?month= when a
      // team change invalidates it — so the reader who sees this arrived with a
      // link: a bookmark kept across a downgrade, or a month a Pro teammate
      // shared. It says what happened rather than bouncing them silently to
      // this month, which would tell them nothing about why their link stopped
      // working. wordle-teams-iht.1's interstitial is the natural next step from
      // here; until it exists this sentence stands alone.
      return 'That month is part of Pro. Upgrade to see your team’s full history.'
```

`typedCodeMessage` is an exhaustive switch over `AccessCode`, so `pnpm typecheck` fails until this case exists — which is the property that keeps the two in step.

- [ ] **Step 5: Enforce it**

In `v2/convex/scores.ts`, inside `getTeamMonthFor`, immediately after `const team = await requireTeamMemberFor(...)`:

```ts
  // THE MONTH GATE (wordle-teams-kusd). Membership was the ONLY check here
  // before, which made the three-month dropdown an affordance rather than a
  // paywall — v1's own position, and one Layer 3 stopped taking in
  // wordle-teams-iht.3.
  //
  // THE FREE FLOOR IS CHECKED FIRST, AND USUALLY IT IS THE WHOLE CHECK. Almost
  // every call here asks for one of the last three months, and for those this
  // costs one string comparison and no reads at all — no isProFor, no per-member
  // index walk. Only a request OLDER than the free floor pays for the rest. Same
  // shape as invitePlayerFor's "the pro check is first because it is one indexed
  // read" reasoning (teams.ts), inverted: here the cheap answer is the common one.
  //
  // `serverFloorFor` CARRIES A MONTH OF SLACK and the reason is in its own
  // comment: this runtime is UTC and the viewer is not, so an exact window would
  // refuse a month the dropdown had just offered, for a few hours at every month
  // boundary.
  const serverMonth = monthOf(toPuzzleDay(new Date()))
  const freeFloor = serverFloorFor({ currentMonth: serverMonth, earliestMonth: null, pro: false })
  if (month < freeFloor) {
    const { earliestMonth, pro } = await monthWindowInputsFor(ctx, playerId, teamId)
    if (month < serverFloorFor({ currentMonth: serverMonth, earliestMonth, pro })) {
      accessError('MONTH_OUT_OF_WINDOW')
    }
  }
```

Add `serverFloorFor` to the imports from `./lib/monthWindow.ts`, and `accessError` and `toPuzzleDay` to their existing imports if absent.

Note that `monthWindowInputsFor` re-runs `requireTeamMemberFor`. That is one extra indexed read on a path that is already the uncommon one, and it keeps the helper usable on its own from the query; do not restructure it to thread the team doc through unless a measurement says otherwise.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd v2 && pnpm exec vitest run convex/scores.test.ts`
Expected: PASS — all pre-existing tests plus the 5 new ones.

If a pre-existing test now fails because it asks for a hardcoded month older than the floor, that is a real finding: fix the test to use a month relative to `today`, the way `scores.test.ts`'s header already says `today`-dependent values must be. Do not widen the floor to accommodate a fixture.

- [ ] **Step 7: Mutation-test the gate**

Delete the whole `if (month < freeFloor) { ... }` block.
Run: `cd v2 && pnpm exec vitest run convex/scores.test.ts`
Expected: FAIL, naming `refuses a free caller a month below the floor` AND `refuses a caller inside the Insights trial the pro window`.
Restore. Re-run. Expected: PASS.

Then change the inner condition to `if (false)`.
Expected: FAIL, naming `refuses a pro caller a month before the roster’s earliest board`.
Restore. Re-run. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd v2 && git add convex/access.ts convex/scores.ts convex/scores.test.ts src/lib/convex-error.ts
git commit -m "feat(months): enforce the pro month window server-side

getTeamMonthFor checked membership and nothing else, so the three-month
window was decoration — any member could reach any month with a URL. The
free floor is checked first and is the whole check for almost every call,
so the dashboard's core query pays nothing in the common path.

wordle-teams-kusd"
```

---

### Task 4: Audit `winners.ts` for the same hole

**Files:**
- Modify: `v2/convex/winners.ts` (comment, and a gate only if the audit finds one)

- [ ] **Step 1: Find every month-scoped read reachable by a player**

Run:

```bash
cd v2 && grep -n "export const\|export async function\|monthRange\|year\|month" convex/winners.ts | head -60
```

For each exported Convex `query` or `mutation`, answer in writing: can a team member request an arbitrary month, and does it return board-level or aggregate data for that month?

- [ ] **Step 2: Record the outcome in the file, either way**

If a hole exists, add the same guard `getTeamMonthFor` uses and a test in `convex/winners.test.ts` mirroring Task 3's, then mutation-test it the same way.

If no hole exists, add a comment at the relevant export saying so in specific terms — which function, why it cannot serve an out-of-window month (for example: it takes no caller-supplied month, or it only ever reads the current one) — so the next reader does not re-audit it. "Probably fine" is not an acceptable result, and neither is silence.

- [ ] **Step 3: Run the suite**

Run: `cd v2 && pnpm exec vitest run convex/winners.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd v2 && git add convex/winners.ts convex/winners.test.ts
git commit -m "chore(months): audit winners.ts against the new month gate

wordle-teams-kusd"
```

---

### Task 5: The dropdown

**Files:**
- Modify: `v2/src/components/month-picker.tsx`
- Modify: `v2/src/components/month-picker.test.ts`
- Create: `v2/src/components/month-picker.hook.test.ts`

- [ ] **Step 1: Rewrite the unit test**

Replace the whole of `v2/src/components/month-picker.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { monthWindowFor } from '../../convex/lib/monthWindow.ts'

// monthOptions IS GONE (wordle-teams-kusd). Its signature took only
// currentMonth, so it could not express a window that depends on the viewer and
// the team — and left as a wrapper it would be a function any future caller
// could reach that silently answers "three months" for a Pro player. The
// ordering properties it pinned are asserted here against its replacement,
// because they are properties of the DROPDOWN and they matter more now that the
// list can be forty entries long rather than three.
describe('the order the dropdown renders', () => {
  test('is newest first, whatever the length', () => {
    // DESCENDING IS A DELIBERATE DIVERGENCE FROM v1 (wordle-teams-l23h,
    // V2-ADDENDUM.md row 48): v1 walks forward and pushes the current month on
    // last, which puts the month a reader almost always wants off the bottom of
    // a scroll. That was three rows when it was decided and is forty-three here.
    const long = monthWindowFor({ currentMonth: '2026-09', earliestMonth: '2023-03', pro: true })

    expect(long[0]).toBe('2026-09')
    expect(long[long.length - 1]).toBe('2023-03')
    expect([...long].sort().reverse()).toEqual(long)
  })

  test('walks back correctly across a year boundary', () => {
    expect(monthWindowFor({ currentMonth: '2026-01', earliestMonth: null, pro: false })).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ])
  })
})
```

- [ ] **Step 2: Write the failing component test**

Create `v2/src/components/month-picker.hook.test.ts`:

```ts
// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, and `.hook.test.ts` with
// createElement by hand, because vitest.config.ts's glob is `src/**/*.test.ts` —
// a .tsx file would simply not run. Same shape as every other component test here.
//
// WHY THIS FILE EXISTS: THE RULE IT GUARDS IS ABOUT SOMETHING BEING ABSENT. The
// Pro teaser row must not render when the team has no history behind the gate,
// and an absent row is the one defect a screenshot of a long-lived team never
// shows. Without this the row is deletable, and its condition is wideable, with
// a green suite.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MonthPicker } from './month-picker.tsx'

afterEach(cleanup)

/**
 * Radix opens a DropdownMenu on POINTERDOWN, not on click — `fireEvent.click`
 * alone leaves the menu shut and every assertion about its contents trivially
 * passing against an empty list. Lifted from team-scope-controls.hook.test.ts,
 * which pays for the same lesson on the same primitive.
 */
const open = () =>
  fireEvent.pointerDown(screen.getByRole('button', { name: /2026/ }), { button: 0 })

const props = {
  value: '2026-08',
  months: ['2026-08', '2026-07', '2026-06'],
  proTeaser: null as string | null,
  onChange: () => {},
  onUpgrade: () => {},
}

describe('the pro teaser row', () => {
  test('names the month Pro reaches back to', () => {
    render(createElement(MonthPicker, { ...props, proTeaser: '2023-03' }))
    open()

    expect(screen.getByRole('menuitem', { name: /Back to March 2023/ })).toBeTruthy()
  })

  test('does not render when there is nothing behind the gate', () => {
    // THE GUARD. A week-old team must not advertise history it does not have —
    // somebody would pay for it. `proTeaser` is null for a pro viewer, for a
    // team with no boards, and for a team whose earliest board is already inside
    // the free window; proTeaserMonth decides which, and monthWindow.test.ts
    // covers the decision. This asserts the component honours it.
    render(createElement(MonthPicker, props))
    open()

    expect(screen.queryByRole('menuitem', { name: /Back to/ })).toBeNull()
  })

  test('calls onUpgrade rather than changing the month', () => {
    // IT IS AN UPGRADE AFFORDANCE, NOT A MONTH. Rendering it inside the radio
    // group would make it selectable as a value the window does not contain,
    // which the server would then refuse.
    const onUpgrade = vi.fn()
    const onChange = vi.fn()
    render(createElement(MonthPicker, { ...props, proTeaser: '2023-03', onUpgrade, onChange }))
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /Back to March 2023/ }))

    expect(onUpgrade).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('renders every month it is given', () => {
    render(createElement(MonthPicker, { ...props, months: ['2026-08', '2026-07', '2026-06', '2026-05'] }))
    open()

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(4)
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd v2 && pnpm exec vitest run src/components/month-picker.test.ts src/components/month-picker.hook.test.ts`
Expected: FAIL — `monthOptions` no longer imported by the unit test (it passes), and the component test fails because `MonthPicker` does not accept `months`/`proTeaser`/`onUpgrade`.

- [ ] **Step 4: Rewrite the component**

Replace `v2/src/components/month-picker.tsx` in full:

```tsx
import { ChevronDown, Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { ScrollArea } from '#/components/ui/scroll-area.tsx'
import { formatMonthLabel } from '#/lib/format-day.ts'
import type { PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * How many rows the list may reach before it scrolls instead of growing.
 *
 * ONLY A PRO PLAYER EVER MEETS IT. A free window is three rows plus at most one
 * teaser, so this is dead weight on the free path by design — v1 wraps the same
 * dropdown in a ScrollArea with a computed height
 * (src/components/action-buttons/month-dropdown/utils.ts) precisely because a
 * paying player's list gets long, and v1 teams date back to 2023.
 */
const MAX_ROWS = 10

/**
 * The month dropdown.
 *
 * IT TAKES A WINDOW RATHER THAN COMPUTING ONE (wordle-teams-kusd). It used to own
 * `monthOptions`, which returned the same three months to everyone — that
 * function is gone rather than left delegating, because its signature took only
 * `currentMonth` and could not express a window that depends on the viewer's
 * membership and the team's age. routes/app.tsx builds the window from
 * convex/lib/monthWindow.ts and hands the SAME array to TeamBoards, so the
 * calendar and this control can never disagree about which months exist.
 */
export function MonthPicker({
  value,
  months,
  proTeaser,
  onChange,
  onUpgrade,
}: {
  value: PuzzleMonth
  /** Every month this viewer may select, newest first. `monthWindowFor`'s output. */
  months: Array<PuzzleMonth>
  /**
   * The month Pro reaches back to, or null when there is nothing to advertise —
   * a pro viewer, a team with no boards, or a team whose earliest board is
   * already inside the free window. `proTeaserMonth` decides; this only renders.
   */
  proTeaser: PuzzleMonth | null
  onChange: (month: PuzzleMonth) => void
  onUpgrade: () => void
}) {
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
        {/* HEIGHT SET FROM THE ROW COUNT, NOT A FIXED `max-h`: a short list must
            not leave empty scrollable space below it, and a long one must not
            run off the bottom of a phone. 2.25rem is the rendered height of a
            DropdownMenuRadioItem at this size. */}
        <ScrollArea
          style={{ height: `${Math.min(months.length, MAX_ROWS) * 2.25}rem` }}
          className={months.length > MAX_ROWS ? undefined : 'h-auto'}
        >
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {months.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {formatMonthLabel(option)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </ScrollArea>
        {/* OUTSIDE THE RADIO GROUP, AND THAT IS NOT A STYLE CHOICE. A
            DropdownMenuRadioItem carries a value, so putting this inside would
            make it selectable as a month the window does not contain — which
            the server would then refuse with MONTH_OUT_OF_WINDOW. It is an
            upgrade affordance that happens to live in a month menu.

            IT IS THE SIXTH CALLER OF THE UPGRADE PATH. Header.tsx:267,
            trial-ended-card.tsx:32, board-entry/import-upsell.tsx:49,
            routes/app.tsx:892 and routes/insights.tsx:327 are the others.
            wordle-teams-iht.1 puts one shared interstitial behind all of them;
            when it lands, this must go through it rather than remaining the one
            path that still reaches checkout directly. */}
        {proTeaser !== null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUpgrade}>
              <Sparkles className="h-4 w-4 text-accent-solid" aria-hidden="true" />
              Back to {formatMonthLabel(proTeaser)}
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide">
                Pro
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default MonthPicker
```

Before writing this, confirm the ScrollArea primitive exists: `ls src/components/ui/scroll-area.tsx`. If it does not, add it with `pnpm dlx shadcn@latest add scroll-area` and commit that separately, or render a plain `div` with `max-h-[22.5rem] overflow-y-auto` instead and say in the comment why.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd v2 && pnpm exec vitest run src/components/month-picker.test.ts src/components/month-picker.hook.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Mutation-test the teaser guard**

Change `{proTeaser !== null && (` to `{true && (` — with `proTeaser` null the label will read "Back to Invalid Date" or similar.
Run: `cd v2 && pnpm exec vitest run src/components/month-picker.hook.test.ts`
Expected: FAIL, naming `does not render when there is nothing behind the gate`.
Restore. Re-run. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd v2 && git add src/components/month-picker.tsx src/components/month-picker.test.ts src/components/month-picker.hook.test.ts
git commit -m "feat(months): the dropdown takes a window, and teases what Pro reaches

monthOptions is deleted rather than left delegating: its signature took only
currentMonth and could not express a window that depends on the viewer.

The teaser row is the sixth caller of the upgrade path and is recorded as
such on wordle-teams-iht.1.

wordle-teams-kusd"
```

---

### Task 6: Wire the route, and correct the month on a team change

**Files:**
- Create: `v2/src/lib/dashboard-months.ts`
- Create: `v2/src/lib/dashboard-months.test.ts`
- Modify: `v2/src/routes/app.tsx:23` (import), `:894-898` (MonthPicker), `:1142` (TeamBoards)

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/dashboard-months.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { correctedMonth } from './dashboard-months.ts'

describe('correctedMonth', () => {
  test('is null when the month on screen is inside the window', () => {
    expect(correctedMonth({ monthParam: '2026-07', months: ['2026-08', '2026-07', '2026-06'] })).toBeNull()
  })

  test('is null while the window is still loading', () => {
    // NOT `months[0]`. An empty or absent window means the query has not
    // answered yet, and navigating on it would move the reader off the month
    // they asked for and then have to move them back.
    expect(correctedMonth({ monthParam: '2019-01', months: undefined })).toBeNull()
    expect(correctedMonth({ monthParam: '2019-01', months: [] })).toBeNull()
  })

  test('falls back to the newest month when the month on screen is outside the window', () => {
    // THE TEAM-SWITCH CASE, and the only one this corrects. Viewing March 2023
    // on an old team and switching to one created last month leaves ?month=
    // naming a month the new team's window does not reach. The reader did
    // nothing wrong and must not meet an error.
    expect(correctedMonth({ monthParam: '2023-03', months: ['2026-08', '2026-07', '2026-06'] })).toBe(
      '2026-08',
    )
  })

  test('is idempotent — fed its own output, it does nothing', () => {
    // THE ONLY THING STANDING BETWEEN THE EFFECT THAT CONSUMES THIS AND AN
    // INFINITE REDIRECT, and the same property resolveDashboardSearch and
    // resolveInsightsSearch are each tested for. It holds because element 0 of
    // a window is always a member of that window — see monthWindow.ts, which
    // labels that DO NOT BREAK THAT PROPERTY.
    const months = ['2026-08', '2026-07', '2026-06']
    const once = correctedMonth({ monthParam: '2023-03', months })

    expect(once).not.toBeNull()
    expect(correctedMonth({ monthParam: once as string, months })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd v2 && pnpm exec vitest run src/lib/dashboard-months.test.ts`
Expected: FAIL — cannot resolve `./dashboard-months.ts`.

- [ ] **Step 3: Write the implementation**

Create `v2/src/lib/dashboard-months.ts`:

```ts
import type { PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * Whether `?month=` needs correcting, and to what.
 *
 * IN ITS OWN MODULE RATHER THAN IN dashboard-search.ts, which that file's header
 * asks for by name: "A new rule that needs a date library, a Convex call, or the
 * insights month window belongs in its own module beside what it depends on, the
 * way insights-search.ts does." This one depends on a window a Convex query
 * supplies. It is also the wrong shape for resolveDashboardSearch, which is fed
 * by useSearchSync and must therefore be reachable as a module-level function
 * with no per-team data — the constraint wordle-teams-1ubk left behind
 * (use-search-sync.ts:47-56).
 *
 * IT CORRECTS ONE CASE AND DELIBERATELY NOT THE OTHER. A team change that leaves
 * `?month=` naming a month the new team's window does not reach is nobody's
 * mistake and is corrected silently. A URL that names an unreachable month — a
 * bookmark kept across a downgrade, a link from a Pro teammate — is left to reach
 * the server's MONTH_OUT_OF_WINDOW, because the error says why the link stopped
 * working and a silent bounce to this month says nothing at all.
 *
 * THE PURE FUNCTION IS THE POINT. The caller navigates from an effect, which is
 * the shape an infinite redirect takes; pulling the decision out means the
 * termination property is a test rather than a comment. Feed this its own output
 * and it must return null.
 */
export function correctedMonth({
  monthParam,
  months,
}: {
  /** `?month=` as it stands. */
  monthParam: string
  /** The selected team's window, or undefined while the query is in flight. */
  months: Array<PuzzleMonth> | undefined
}): PuzzleMonth | null {
  // NOT A CORRECTION TO months[0] — there is no window yet to judge against, and
  // navigating on an absent one would move the reader off the month they asked
  // for and then have to move them back when the query answers.
  if (months === undefined || months.length === 0) return null
  if (months.includes(monthParam)) return null

  // Element 0, which monthWindowFor guarantees is `currentMonth` for every input.
  // That guarantee is what makes this terminate: the value returned here is
  // itself always a member of the window this function judges against, so a
  // second pass returns null.
  return months[0]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd v2 && pnpm exec vitest run src/lib/dashboard-months.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the route**

In `v2/src/routes/app.tsx`:

Replace the import at line 23:

```tsx
import { MonthPicker } from '#/components/month-picker.tsx'
```

Add:

```tsx
import { monthWindowFor, proTeaserMonth } from '../../convex/lib/monthWindow.ts'
import { correctedMonth } from '#/lib/dashboard-months.ts'
```

After `const currentMonth = hydrated ? monthOf(toPuzzleDay(new Date())) : monthParam` (line 680), add:

```tsx
  /*
    THE SELECTED TEAM'S WINDOW (wordle-teams-kusd).

    'skip' UNTIL THERE IS A TEAM, matching every other gated query in this app —
    see Header.tsx's note on why it must be 'skip' rather than `enabled:`. A
    stale or invalid `?team=` leaves `teamParam` naming a team the viewer is not
    on, and useSearchSync corrects it within a render or two; asking for its
    window in the meantime would be a guaranteed NOT_A_MEMBER throw.

    useQuery, NOT useSuspenseQuery: this feeds a control in the bar, and
    suspending the page on it would make the whole dashboard wait to find out
    how far back the dropdown goes.
  */
  const { data: window } = useQuery(
    convexQuery(api.scores.monthWindow, teamParam ? { teamId: teamParam as Id<'teams'> } : 'skip'),
  )

  /*
    BUILT ON THE CLIENT FROM THE SERVER'S TWO INPUTS, because `currentMonth` is
    the VIEWER'S and Convex runs UTC. See monthWindow.ts.

    useMemo KEYED ON PRIMITIVES, not on the query's object: a fresh array every
    render would re-run the correction effect below on every render, which is
    the exact defect wordle-teams-1ubk fixed in useSearchSync.
  */
  const months = useMemo(
    () =>
      window === undefined
        ? undefined
        : monthWindowFor({ currentMonth, earliestMonth: window.earliestMonth, pro: window.pro }),
    [currentMonth, window?.earliestMonth, window?.pro],
  )

  /*
    CORRECTING `?month=` AFTER A TEAM CHANGE. Switching from a team whose window
    reaches 2023 to one created last month leaves `?month=` naming a month the
    new team cannot show. The decision is pure and lives in lib/dashboard-months.ts,
    which has the idempotence test this effect's termination depends on — read its
    header before changing what it is fed.

    `replace: true, resetScroll: false` MATCHES useSearchSync'S OWN CORRECTION,
    and for the same reasons: this is not a navigation the reader asked for, so
    it must not take over the back button and must not move them on the page.
  */
  const correction = months === undefined ? null : correctedMonth({ monthParam, months })
  useEffect(() => {
    if (correction === null) return
    void navigate({
      to: Route.fullPath,
      search: { team: teamParam, month: correction },
      replace: true,
      resetScroll: false,
    })
  }, [correction, navigate, teamParam])
```

Replace the `MonthPicker` element at lines 894-898:

```tsx
        <MonthPicker
          value={monthParam}
          months={months ?? [currentMonth]}
          proTeaser={
            window === undefined
              ? null
              : proTeaserMonth({
                  currentMonth,
                  earliestMonth: window.earliestMonth,
                  pro: window.pro,
                })
          }
          onChange={(month) => navigate({ to: Route.fullPath, search: { team: teamParam, month } })}
          onUpgrade={() => void startUpgrade()}
        />
```

`months ?? [currentMonth]` is the in-flight state: one row, the month already on screen, so the control is never empty and never offers a month it cannot yet justify.

Replace line 1142:

```tsx
          months={months ?? [currentMonth]}
```

Add `useEffect` and `useMemo` to the `react` import if absent.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `cd v2 && pnpm typecheck && pnpm exec vitest run`
Expected: PASS. `routes.test.ts` and any dashboard tests that referenced `monthOptions` must be updated, not deleted — if one breaks, it is telling you a call site moved.

- [ ] **Step 7: Commit**

```bash
cd v2 && git add src/lib/dashboard-months.ts src/lib/dashboard-months.test.ts src/routes/app.tsx
git commit -m "feat(months): drive both pickers from the window, and correct on team change

The correction is a pure function with an idempotence test, for the reason
resolveDashboardSearch is: it is consumed by an effect that navigates, which
is the shape an infinite redirect takes.

wordle-teams-kusd"
```

---

### Task 7: The inventory

**Files:**
- Create: `v2/src/lib/pro-benefits.ts`
- Test: `v2/src/lib/pro-benefits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/pro-benefits.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { PRO_BENEFITS } from './pro-benefits.ts'

describe('PRO_BENEFITS', () => {
  test('lists exactly the five things Pro gates today', () => {
    // A COUNT ASSERTION, deliberately. This file is copy, and copy is the one
    // thing typecheck, lint and build cannot check: an entry deleted or a sixth
    // one invented would otherwise ship silently to the interstitial and the
    // landing page at once.
    expect(PRO_BENEFITS.map((benefit) => benefit.id)).toEqual([
      'teams',
      'scoring',
      'import',
      'insights',
      'months',
    ])
  })

  test('every benefit names where it is enforced', () => {
    // THE PROPERTY THAT KEEPS THIS HONEST. An entry with no enforcement site is
    // a claim nobody checked, which is precisely how "unlimited months" survived
    // on the landing page for months while v2 gated nothing.
    for (const benefit of PRO_BENEFITS) {
      expect(benefit.enforcedAt).toMatch(/\.tsx?$/)
    }
  })

  test('says nothing about chat or notifications', () => {
    // NEITHER IS PRO-GATED — there is no isProFor anywhere in convex/chat.ts or
    // convex/chatNotify.ts. They belong to the free product's story. Selling
    // something already free is the same defect as selling something that does
    // not exist.
    const prose = PRO_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ').toLowerCase()

    expect(prose).not.toContain('chat')
    expect(prose).not.toContain('notification')
  })

  test('quotes no price', () => {
    // The price lives in Polar and reaches the customer on Polar's hosted
    // checkout. A number here is a second source of truth that goes stale
    // silently with every gate green — trial-copy.ts's own rule, same reason.
    const prose = PRO_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ')

    expect(prose).not.toMatch(/[$£€]|\bper month\b|\bper year\b|\/mo\b/)
  })

  test('uses typographic apostrophes', () => {
    const prose = PRO_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ')

    expect(prose).not.toContain("'")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd v2 && pnpm exec vitest run src/lib/pro-benefits.test.ts`
Expected: FAIL — cannot resolve `./pro-benefits.ts`.

- [ ] **Step 3: Write the implementation**

Create `v2/src/lib/pro-benefits.ts`:

```ts
/**
 * WHAT PRO ACTUALLY INCLUDES — one list, checked against the gates that enforce it.
 *
 * Sibling of trial-copy.ts and billing-copy.ts, and here for the reason
 * trial-copy.ts gives: the copy is the deliverable and the component is not. A
 * sentence chosen in a spec and then typed straight into JSX is a product
 * decision no test can reach.
 *
 * IT EXISTS BECAUSE THE PRODUCT HAD NO SUCH LIST AND THE ONE DESCRIPTION IT DID
 * HAVE WAS WRONG. components/home/feature-cards.tsx's "Go Pro" card sold
 * "unlimited months" while month-picker.tsx offered everyone three — a claim v2
 * did not honour, on the only page that described the tier, in the week of a
 * launch email. wordle-teams-kusd shipped the month window so the claim became
 * true; this file is what stops the next one drifting.
 *
 * TWO CONSUMERS, BOTH DOWNSTREAM: wordle-teams-iht.1's upgrade interstitial and
 * wordle-teams-wty4.1.14's marketing pages. They describe one tier and must not
 * describe it twice.
 *
 * `enforcedAt` IS NOT DECORATION. Every entry names the file that actually
 * refuses the thing to a free player, and pro-benefits.test.ts asserts each one
 * is present. An entry that cannot name its gate is a claim nobody checked,
 * which is exactly what "unlimited months" was.
 *
 * NO PRICE HERE. The price lives in Polar and reaches the customer on Polar's
 * hosted checkout. A number in this file is a second source of truth that goes
 * stale the moment the dashboard changes, silently, with every gate green.
 *
 * TEAM CHAT AND PUSH NOTIFICATIONS ARE NOT ON THIS LIST, and their absence is a
 * decision rather than an omission: neither is gated — there is no isProFor
 * anywhere in convex/chat.ts or convex/chatNotify.ts. They are part of the free
 * product and belong in the story the landing page tells about what the app
 * does, not in the one it tells about what Pro buys. Selling something already
 * free is the same defect as selling something that does not exist.
 */
export type ProBenefit = {
  id: 'teams' | 'scoring' | 'import' | 'insights' | 'months'
  /** A few words, headline case. */
  title: string
  /** One sentence, second person, no price. */
  body: string
  /** The file that refuses this to a free player. Checked by the test. */
  enforcedAt: string
}

export const PRO_BENEFITS: ReadonlyArray<ProBenefit> = [
  {
    id: 'teams',
    title: 'As many teams as you like',
    body: 'Free accounts can join two teams. Pro lifts the cap, and any invites waiting on it come through the moment you upgrade.',
    enforcedAt: 'convex/lib/teamLimits.ts',
  },
  {
    id: 'scoring',
    title: 'Your own scoring system',
    body: 'Decide what a two-guess day is worth, and what a failed one costs, for every team you own.',
    enforcedAt: 'src/components/scoring-system-card.tsx',
  },
  {
    id: 'import',
    title: 'Import from a screenshot',
    body: 'Paste a screenshot of your Wordle and we’ll fill the board in for you — check it and submit.',
    enforcedAt: 'src/components/board-entry/form.tsx',
  },
  {
    id: 'insights',
    title: 'Your full history, and your team’s whole month',
    body: 'Free shows you today. Pro shows you everything you have done, and how the whole team’s month is going, not just one day of it.',
    enforcedAt: 'convex/insights.ts',
  },
  {
    id: 'months',
    title: 'Every month you have ever played',
    body: 'Free reaches back three months. Pro reaches back to your team’s very first board.',
    enforcedAt: 'convex/lib/monthWindow.ts',
  },
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd v2 && pnpm exec vitest run src/lib/pro-benefits.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation-test the count assertion**

Delete the `months` entry from `PRO_BENEFITS`.
Run: `cd v2 && pnpm exec vitest run src/lib/pro-benefits.test.ts`
Expected: FAIL, naming `lists exactly the five things Pro gates today`.
Restore. Re-run. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd v2 && git add src/lib/pro-benefits.ts src/lib/pro-benefits.test.ts
git commit -m "feat(pro): one canonical list of what Pro includes

The product had no such list, and the only description it had — feature-cards'
'Go Pro' card — claimed unlimited months while v2 gated none. Both downstream
issues (iht.1's interstitial, wty4.1.14's marketing pages) consume this so one
tier gets one description.

wordle-teams-kusd"
```

---

### Task 8: Discharge the stale predictions

Four comments predict this work as future. Leaving them is the defect class this project has found nineteen instances of: comments that assert things the code does not do.

**Files:**
- Modify: `v2/convex/access.ts` (the `isProFor` header, ~line 270)
- Modify: `v2/src/components/teams/team-boards.tsx:61` (the `months` prop doc)
- Modify: `v2/src/lib/insights-months.ts` (the `teamMonthOptions` header)
- Modify: `docs/design-system/V2-ADDENDUM.md:446` (row 48)

- [ ] **Step 1: Correct each one**

`convex/access.ts` — the paragraph beginning "THE FOURTH GATE wordle-teams-6tn NAMES" says the month window "does not exist here yet" and "v2 currently shows a pro player LESS history than production". Both are now false. Replace it with a statement that the gate exists, that it lives in `scores.ts`'s `getTeamMonthFor` rather than in the list above because it is a read gate rather than a write gate, and that `wordle-teams-kusd` is what built it.

`src/components/teams/team-boards.tsx:61` — the `months` doc says "v2 has NO pro month gate yet — `monthOptions` returns three months for everyone — so an unbounded picker would hand every player unlimited history now and the pro expansion would later have to take it away." Rewrite to say the expansion has landed, that `months` is now `monthWindowFor`'s output passed down from `routes/app.tsx`, and that sharing one array is what still keeps this control and the dropdown from disagreeing.

`src/lib/insights-months.ts` — the header says the scores picker "still owes its own score-based expansion". It no longer does. Say instead that it has one, in `convex/lib/monthWindow.ts`, and keep the sentence explaining why the two rules are different and must not be unified — that part is still true and is now more load-bearing, not less.

`docs/design-system/V2-ADDENDUM.md:446` — row 48 says "That three-month window is a free-tier affordance and is temporary" and "v2 has no pro month gate yet". Update to record that the expansion landed in `wordle-teams-kusd`, that the descending order it argued for is what the now-long list inherited, and leave the divergence itself (newest-first versus v1's oldest-first) intact — that is still a divergence and the parity audit still needs it.

- [ ] **Step 2: Verify no stale prediction survives**

Run:

```bash
cd /home/cdub/projects/wordle-teams && grep -rn "no pro month gate\|pro expansion\|still owes its own score-based\|does not exist here yet" v2/src v2/convex docs/design-system/V2-ADDENDUM.md
```

Expected: every remaining hit is a sentence written in the past tense about work that has now landed. Any hit still predicting future work is one you missed.

- [ ] **Step 3: Commit**

```bash
cd /home/cdub/projects/wordle-teams && git add v2/convex/access.ts v2/src/components/teams/team-boards.tsx v2/src/lib/insights-months.ts docs/design-system/V2-ADDENDUM.md
git commit -m "docs(months): discharge four comments that predicted the pro month gate

Each said the expansion was future work. It is not any more, and a comment
that asserts something the code does not do is the defect class this project
has found nineteen of.

wordle-teams-kusd"
```

---

### Task 9: Gates, e2e, and close

- [ ] **Step 1: Run all four gates**

```bash
cd v2 && pnpm typecheck && pnpm lint && pnpm test:once && pnpm build
```

Expected: all four green. Run all four — they catch different things; `lint` reaches `public/*.js` that `build` does not, and the test suite asserts counts that a docs-only change can break.

Do not pipe these through anything that swallows the exit status. This shell is zsh, where `PIPESTATUS` is empty, so a piped gate check can report a false green.

- [ ] **Step 2: Start a local Convex backend for e2e**

```bash
printf 'CONVEX_DEPLOYMENT=anonymous:anonymous-v2\n' > /tmp/convex.anon.env
cd v2 && PATH="$HOME/.local/share/mise/installs/node/22.23.2/bin:$PATH" \
  CONVEX_AGENT_MODE=anonymous pnpm exec convex dev --env-file /tmp/convex.anon.env
```

Run it in the background. The `--env-file` is **not optional**: `.env.local` carries `CONVEX_DEPLOY_KEY` and a bare `convex dev` targets a real cloud deployment. Confirm the log says `[Local] Port 3210` before continuing. Node 22 is required; the workstation default is 25, which refuses `use node` actions.

Before starting Playwright, confirm nothing stale holds port 3000 — a previous dev server will be attached to and every run will test old code.

- [ ] **Step 3: Run e2e**

Run the full Playwright suite in the background; it takes about 11 minutes and exceeds the foreground tool-call limit.
Expected: 101/101, or a failure that names a real behaviour change from this work.

A server-side access change to the dashboard's core query is exactly the class e2e catches and the unit suite does not. If a spec fails because a seeded fixture asks for a month older than the floor, fix the seed (`convex/e2eSeed.ts`), not the floor.

- [ ] **Step 4: Kill the backend**

Wait on the log rather than on the process name — `until ! pgrep -f convex` never exits, because the waiter matches itself.

- [ ] **Step 5: Close the issue and push**

```bash
cd /home/cdub/projects/wordle-teams
bd close wordle-teams-kusd
git status   # bd writes Dolt only; commit .beads/issues.jsonl again if it changed
git pull --rebase && bd dolt push && git push
git status   # MUST show up to date with origin
```

`bd` changes lag one commit: after `bd close`, check `git status` and commit `.beads/issues.jsonl` again if it changed. Never `--no-verify`.

---

## Self-review

**Spec coverage.** §3 the rule → Task 1. §4 the query → Task 2; enforcement → Task 3; the trial decision → Task 3 step 1; the two-ways-in split → Tasks 3 and 6. §5 the dropdown and the teaser → Task 5; the day picker → Task 6 step 5; the sixth affordance → recorded in Task 5's component comment and already on `wordle-teams-iht.1`. §6 the inventory → Task 7. §7 testing → the mutation steps in Tasks 1, 3, 5, 7 and Task 9. §9 AC 1–10 → AC1 Task 6, AC2 Task 5, AC3 Task 3, AC4 Task 6, AC5 Tasks 1 and 5, AC6 Task 7, AC7 Task 8, AC8 Task 3, AC9 Task 4, AC10 Task 9.

**Names used consistently across tasks:** `monthWindowFor`, `serverFloorFor`, `proTeaserMonth`, `MonthWindowInput`, `FREE_MONTHS`, `monthWindowInputsFor`, `earliestMonthFor`, `correctedMonth`, `PRO_BENEFITS`, `ProBenefit`, `MONTH_OUT_OF_WINDOW`. `MonthPicker`'s props are `value`, `months`, `proTeaser`, `onChange`, `onUpgrade` in both Task 5's test and Task 6's call site.

**Two things the implementer must verify rather than assume**, flagged inline where they occur: that `src/components/ui/scroll-area.tsx` exists (Task 5 step 4), and that `aPlayer` accepts `trialEndsAt` (Task 3 step 1). Both have a stated fallback.
