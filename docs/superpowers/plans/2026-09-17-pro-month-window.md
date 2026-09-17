# Pro Month Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Pro players month history back to their team's earliest board, enforced on the server, and produce the one canonical statement of what Pro includes.

**Architecture:** One rule module (`convex/lib/monthWindow.ts`) is imported by both the browser, which builds the month dropdown from it, and by `getTeamMonthFor`, which refuses anything below its floor. A per-selected-team query supplies the team's earliest board month; the viewer's Pro status comes from the `amIPro` subscription `routes/app.tsx` already holds. `src/lib/pro-benefits.ts` falls out at the end as the inventory that wordle-teams-iht.1 and wordle-teams-wty4.1.14 both consume.

**Tech Stack:** TypeScript, Convex, TanStack Router + Query, React 19, Radix DropdownMenu, vitest (edge-runtime by default, jsdom for component tests), convex-test.

**Spec:** `docs/superpowers/specs/2026-09-17-pro-month-window-design.md`
**Issue:** `wordle-teams-kusd`

---

## This is the second draft. Read this before anything else.

The first draft was reviewed by four adversarial passes on separate failure modes. They found **ten blockers and no false positives**. Every one is fixed below, but three deserve naming up front because they are the reason particular steps look the way they do:

1. **The Pro window was narrower than the free window** for any team younger than three months — upgrading would have *removed* months from the dropdown, which is the exact regression this work exists to close. The first draft's tests asserted the broken behaviour as correct. Task 1 now carries a `Math.max(FREE_MONTHS, span)` floor and a test that fails without it.
2. **The new error message would have been dead code.** `typedCodeMessage` is exhaustive, so typecheck forces a case — but `convexErrorCode` (`src/lib/convex-error.ts:17-43`) is a hand-written 22-term `||` chain ending in `return null`, and nothing forces that. The case would have been added, the gates would have gone green, and users would have seen the generic fallback. Task 3 edits both.
3. **Three hooks were placed below two early returns.** `routes/app.tsx` has no hook call below `:446` today; the returns are at `:612` and `:661`. Task 6 now puts them at the top of the component, which changes what they can assume about `teamParam` and `monthParam`.

---

## Working agreements

- All commands run from `v2/`.
- The four gates are `pnpm typecheck`, `pnpm lint`, `pnpm test:once`, `pnpm build`. Several tasks below run `pnpm lint` mid-task, not only at the end — the first draft deferred it to Task 9 and that is where two blockers would have surfaced.
- `"lint": "eslint . --max-warnings 0"`. A `react-hooks/exhaustive-deps` **warning** fails the gate. `react-hooks/rules-of-hooks` is an error.
- Never `git commit --no-verify` — a PII scan and a beads export run in that hook.
- Component tests are `*.hook.test.ts` with `// @vitest-environment jsdom` and `createElement`. vitest's glob is `src/**/*.test.ts`, so a `.tsx` test file would silently not run.
- User-facing copy uses typographic apostrophes (`’`).
- `formatMonthLabel` renders **short** months: `'2023-03'` → `"Mar 2023"` (`src/lib/format-day.ts:13`). Never write "March 2023" in an assertion.
- Comments explain WHY, at length, matching the density of the file you are in. Check every factual claim about another file against that file before writing it. If a test fails against a label or field name this plan gives you, **fix the plan's value, do not loosen the assertion** — a loosened matcher is how the one thing a test exists to pin gets deleted.

## Three decisions inside the approved design

**1. The server enforces a FLOOR with one month of slack**, not membership of the client's window. Convex runs UTC and the viewer does not, so an exact window would refuse the month the dropdown had just offered, for a few hours at every month boundary. Offsets span UTC−12..UTC+14, so the sides differ by at most one month and one month of slack is exactly sufficient — no margin, so do not reduce it.

**2. The Pro check is skipped in the common path.** Almost every request is for one of the last three months. Below-floor requests pay for `isProFor`; only requests that pass *that* pay for the per-member earliest reads.

**3. `pro` has one source on the client.** The query returns only `earliestMonth`. Pro-ness comes from the `amIPro` `useSuspenseQuery` already at `routes/app.tsx:203`. The first draft returned `pro` from the new query too, giving two independently-updating subscriptions to one fact — structurally the split-brain wordle-teams-iht.4 is about.

---

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `convex/lib/monthWindow.ts` | create | The rule. Pure; imports only `puzzleDay.ts`. Client and server both import it. |
| `convex/lib/monthWindow.test.ts` | create | The rule's tests, including the element-0 invariant and the free-floor guarantee. |
| `convex/scores.ts` | modify | `earliestMonthFor`, `monthWindowInputsFor`, the `monthWindow` query, the shape check and floor check in `getTeamMonthFor`. |
| `convex/scores.test.ts` | modify | Enforcement tests, plus a mandatory rewrite of nine dated literals. |
| `convex/access.ts` | modify | `MONTH_OUT_OF_WINDOW` on `AccessCode`; the stale `isProFor` comment discharged. |
| `src/lib/convex-error.ts` | modify | **Both** `convexErrorCode`'s chain and `typedCodeMessage`. |
| `convex/winners.ts` | modify | Audit + gate `getLastMonthWinner`. |
| `src/components/month-picker.tsx` | modify | Takes a window and a teaser label. `monthOptions` deleted. |
| `src/components/month-picker.test.ts` | delete | Its coverage moves to `monthWindow.test.ts`; keeping it would test nothing. |
| `src/components/month-picker.hook.test.ts` | create | The dropdown's render rules. |
| `src/lib/dashboard-months.ts` | create | `correctedMonth` and `fallbackMonths`, as pure functions. |
| `src/lib/dashboard-months.test.ts` | create | Their tests, including idempotence. |
| `src/routes/app.tsx` | modify | The query, the window, both pickers, the correction. |
| `src/components/teams/team-boards.hook.test.ts` | modify | Its source-text assertion on `app.tsx:1142` breaks. |
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
import { FREE_MONTHS, monthWindowFor, proTeaserMonth, serverFloorFor } from './monthWindow.ts'
import { addMonths } from './puzzleDay.ts'

/**
 * Shared between the element-0 invariant below and the serverFloorFor /
 * monthWindowFor relationship test at the bottom of the file — both need the
 * same spread of pro/free, with/without earliestMonth, and in- and
 * out-of-range inputs, and a second copy drifting from this one is exactly
 * how the two tests would stop agreeing on what "every input" means.
 */
const inputs: Array<{ currentMonth: string; earliestMonth: string | null; pro: boolean }> = [
  { currentMonth: '2026-08', earliestMonth: null, pro: false },
  { currentMonth: '2026-08', earliestMonth: null, pro: true },
  { currentMonth: '2026-08', earliestMonth: '2023-03', pro: true },
  { currentMonth: '2026-08', earliestMonth: '2026-08', pro: true },
  { currentMonth: '2026-08', earliestMonth: '2099-01', pro: true },
  { currentMonth: '2026-08', earliestMonth: '', pro: true },
  { currentMonth: '2026-01', earliestMonth: '2025-11', pro: false },
]

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

  test('is uncapped in practice — a team dating to 2023 reaches 2023', () => {
    // THE POINT OF THE WHOLE FEATURE. insights-months.ts caps its own window at
    // twelve so it can render without scroll math; this one must not, because a
    // cap is exactly the regression a migrating v1 Pro subscriber would feel.
    const months = monthWindowFor({ currentMonth: '2026-09', earliestMonth: '2023-03', pro: true })

    expect(months).toHaveLength(43)
    expect(months[months.length - 1]).toBe('2023-03')
  })

  test('IS NEVER NARROWER THAN THE FREE WINDOW', () => {
    // THE REGRESSION THIS WHOLE SPEC EXISTS TO CLOSE, REINTRODUCED INSIDE IT.
    // Without the max(FREE_MONTHS, span) floor, a team younger than three months
    // gives its PRO owner a one- or two-row dropdown while the FREE members
    // beside them still get three — so upgrading visibly REMOVES months. Every
    // team created during the launch window this work is aimed at is in range.
    // The first draft of this file asserted the broken behaviour as correct.
    for (const earliestMonth of [null, '2026-08', '2026-07', '2026-06', '2026-05']) {
      const pro = monthWindowFor({ currentMonth: '2026-08', earliestMonth, pro: true })
      const free = monthWindowFor({ currentMonth: '2026-08', earliestMonth, pro: false })

      expect(pro.length).toBeGreaterThanOrEqual(free.length)
      expect(pro.length).toBeGreaterThanOrEqual(FREE_MONTHS)
    }
  })

  test('with no boards at all, is still the free window', () => {
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: null, pro: true })).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
    ])
  })

  test('a future earliestMonth yields the free window', () => {
    // NAMED FOR WHAT ACTUALLY KILLS IT. spanFor also clamps a future
    // earliestMonth to currentMonth before subtracting, but that clamp is
    // belt-and-braces and unobservable on its own: without it the span would
    // go negative, and the Math.max(span, FREE_MONTHS) floor lifts that back
    // up to FREE_MONTHS regardless, landing on exactly this result either way.
    // This test dies to the FLOOR, not the clamp — see spanFor's comment.
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: '2026-11', pro: true })).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
    ])
  })

  test('survives a malformed earliestMonth without producing an empty window', () => {
    // upsertBoard TAKES puzzleDay AS A BARE v.string() AND VALIDATES NOTHING
    // (wordle-teams-qvqi), so '' is a storable puzzle day and monthOf('') is ''.
    // That makes the span NaN, Array.from({length: NaN}) returns [], and the
    // element-0 invariant below is violated for a REACHABLE input — with
    // serverFloorFor then reading months[-1] and throwing inside
    // getTeamMonthFor (scores.ts:37), taking the dashboard down for every Pro
    // member of the team rather than for the author. The cause is filed
    // separately; this is the blast shield.
    for (const earliestMonth of ['', '1', 'x', '2026', 'not-a-month']) {
      const months = monthWindowFor({ currentMonth: '2026-08', earliestMonth, pro: true })

      expect(months.length).toBeGreaterThanOrEqual(FREE_MONTHS)
      expect(months[0]).toBe('2026-08')
    }
  })

  test('caps an absurdly old earliestMonth rather than building a 12,000-entry list', () => {
    const months = monthWindowFor({ currentMonth: '2026-08', earliestMonth: '1000-01', pro: true })

    expect(months.length).toBeLessThanOrEqual(120)
    expect(months[0]).toBe('2026-08')
  })
})

describe('the element-0 invariant', () => {
  // DO NOT BREAK THIS. dashboard-months.ts does not exist yet (Task 6 creates
  // it), but it will fall back to element 0 for an out-of-window ?month=, and
  // that fallback will settle — rather than the effect behind it navigating
  // forever — only because the fallback value is itself always a member of
  // the window it is judged against. insights-months.ts records the identical
  // property for resolveInsightsSearch, in the same words.

  test.each(inputs)('currentMonth is element 0, and the window is never empty, for %j', (input) => {
    const months = monthWindowFor(input)

    expect(months.length).toBeGreaterThan(0)
    expect(months[0]).toBe(input.currentMonth)
  })

  test.each(inputs)('the window is STRICTLY descending for %j', (input) => {
    const months = monthWindowFor(input)

    // STRICTLY, WHICH THE SORT COMPARISON ALONE DOES NOT PROVE.
    // `[...months].sort().reverse()` is satisfied by a non-increasing list, so
    // ['2026-08','2026-08','2026-06'] passes it while a duplicated month would
    // give the dropdown two identical rows and a radio group two items with one
    // value. The uniqueness check is what makes the word "strictly" true.
    expect([...months].sort().reverse()).toEqual(months)
    expect(new Set(months).size).toBe(months.length)
  })
})

describe('serverFloorFor', () => {
  test('is one month below the free window, so a timezone skew cannot refuse a month the dropdown offered', () => {
    // Convex runs UTC; the viewer does not. At a month boundary the two
    // disagree by one month in either direction, so an exact server window
    // would refuse the month the client just offered — breaking the dashboard
    // east of UTC on the 1st of every month. One month of slack is exactly
    // sufficient and has zero margin: do not reduce it.
    expect(serverFloorFor({ currentMonth: '2026-08', earliestMonth: null, pro: false })).toBe('2026-05')
  })

  test('is one month below the pro window', () => {
    expect(serverFloorFor({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: true })).toBe(
      '2023-02',
    )
  })

  test('never returns undefined, whatever the earliestMonth', () => {
    // NOT a catch for `monthWindowFor(...).at(-1)` — with the FREE_MONTHS floor
    // in place, no window this function can build is ever empty, so `.at(-1)`
    // would return a well-formed month here too and this test would pass
    // either way. (The first test in this describe block is what actually
    // pins that: a naive `.at(-1)` implementation reads the CLIENT window's
    // oldest month directly, with no SERVER_SLACK_MONTHS subtracted, so it
    // would return '2026-06' there instead of the asserted '2026-05'.) What
    // this test pins is the return TYPE across a spread of malformed and
    // out-of-range earliestMonth values — that the result is always a
    // well-formed 'YYYY-MM' string, never undefined, so a caller can rely on
    // that shape without a null check.
    for (const earliestMonth of ['', 'x', null, '2099-01', '1000-01']) {
      expect(serverFloorFor({ currentMonth: '2026-08', earliestMonth, pro: true })).toMatch(
        /^\d{4}-\d{2}$/,
      )
    }
  })

  test.each(inputs)(
    'is exactly one month below the oldest month monthWindowFor reaches, for %j',
    (input) => {
      // THE CONTRACT wordle-teams-kusd's TASK 3 SERVER GATE DEPENDS ON: the
      // floor getTeamMonthFor enforces must sit exactly one month below what
      // the dropdown built from monthWindowFor actually offers, for every
      // input, or the gate refuses a month the client just showed. After the
      // Fix 1 refactor this holds because both sides derive their length from
      // the same `spanFor` seam — serverFloorFor via oldestOfferedFor, and
      // monthWindowFor by walking countBack over spanFor(input) - 1 months, so
      // its last element lands on that same value. The two do NOT share a call
      // to oldestOfferedFor, which is why this is worth pinning: the agreement
      // is structural rather than literal, and splitting spanFor would break it
      // silently.
      const months = monthWindowFor(input)
      const oldest = months[months.length - 1]

      expect(serverFloorFor(input)).toBe(addMonths(oldest, -1))
    },
  )
})

describe('proTeaserMonth', () => {
  test('names the earliest month when it is older than the free window', () => {
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: false })).toBe(
      '2023-03',
    )
  })

  test('names a month the Pro window can actually deliver, even for an ancient earliestMonth', () => {
    // THE DEFECT THIS GUARDS AGAINST. This function used to hand back
    // `earliestMonth` verbatim, so a team with an old, unvalidated
    // earliestMonth (upsertBoard, wordle-teams-qvqi) — '1000-01' here — could
    // be teased a month far older than what spanFor's MAX_MONTHS cap lets the
    // Pro window itself reach: a free player upgrades and gets 2016-09, not
    // the 1000-01 they were promised. Asserted as a RELATIONSHIP, not a
    // hardcoded month, so this keeps holding as MAX_MONTHS or the calendar
    // move: whatever the teaser names must be a month Pro's own window
    // contains.
    const input = { currentMonth: '2026-08', earliestMonth: '1000-01', pro: false }
    const teased = proTeaserMonth(input)
    const proWindow = monthWindowFor({ ...input, pro: true })

    expect(teased).not.toBeNull()
    expect(proWindow).toContain(teased)
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

  test('is null for a malformed earliestMonth rather than advertising one', () => {
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '', pro: false })).toBeNull()
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
 * — into the client chunk. puzzleDay.ts is itself import-free, so it costs
 * nothing to carry — but it is NOT pure string arithmetic: `addMonths` builds a
 * `Date` internally, and `Date` maps a two-digit year (0-99) into 1900+year, so
 * `addMonths('0050-03', -1)` silently returns `'1950-02'`. Latent rather than
 * dangerous here, because every `addMonths` call in this file takes either
 * `currentMonth` (trusted) or a value this module already derived from it —
 * never the untrusted `earliestMonth` directly. Do not add a call that does
 * without re-checking this. If you are about to add any other import here,
 * read insightsAccess.ts's header first.
 *
 * THE DECISION LIVES HERE AS PURE FUNCTIONS and the Convex wrapper only supplies
 * the inputs, because nothing in this repo can drive an authed wrapper
 * (wordle-teams-obw) — a rule left inside one is a rule no test can execute.
 *
 * A DIFFERENT RULE FROM insights-months.ts's `teamMonthOptions`, and the two must
 * not be unified. That one runs from the team's CREATION month and caps at twelve
 * so its list renders without scroll math. This one runs from the team's earliest
 * BOARD and is effectively uncapped, because its job is parity with v1 — where a
 * Pro player reaches every month their team has ever played — and a cap is
 * precisely the regression a migrating subscriber would feel.
 */

/** What a free account sees: this month and the two before it. v1's window. */
export const FREE_MONTHS = 3

/**
 * THE CEILING, WHICH EXISTS FOR SAFETY RATHER THAN FOR PRODUCT.
 *
 * `earliestMonth` comes from `dailyScores.puzzleDay`, which `upsertBoard` accepts
 * as a bare `v.string()` and validates nowhere on the server (wordle-teams-qvqi).
 * A stored '1000-01-01' would otherwise build a twelve-thousand-row dropdown and
 * make the server materialise the same array on every below-floor request. v1
 * teams date to 2023, so ten years is generous for every real team and absurd for
 * every fabricated one. This is NOT insights-months.ts's CAP — that one shapes the
 * product; this one bounds an input nobody validates.
 */
const MAX_MONTHS = 120

/**
 * ONE MONTH OF SLACK BETWEEN WHAT THE CLIENT OFFERS AND WHAT THE SERVER ACCEPTS.
 *
 * Convex runs UTC. `toPuzzleDay` resolves in the runtime's local zone, so the
 * server's idea of "this month" and the viewer's disagree for a few hours at
 * every month boundary — in BOTH directions, depending on which side of UTC the
 * viewer is on. Without slack, a viewer in Tokyo just after local midnight on the
 * 1st would be offered a month the server then refuses, and the dashboard would
 * break for everyone east of UTC on the 1st of every month.
 *
 * Offsets span UTC−12..UTC+14, so the two sides differ by at most one month:
 * ONE IS EXACTLY SUFFICIENT AND HAS NO MARGIN. Do not reduce it. Two would be
 * gratuitous. The gate exists to stop someone reading years of history they have
 * not paid for, not to be exact to the month, and the cost of the slack is that a
 * hand-typed URL reaches at most a fourth month.
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
 * current month on last, which puts the month a reader almost always wants off the
 * bottom of a scroll once the list is long. It is long now.
 *
 * THE PRO WINDOW IS NEVER NARROWER THAN THE FREE ONE, and that `Math.max` is the
 * single most important line in this file. Without it a team younger than three
 * months gives its PRO owner a one- or two-row dropdown while the FREE members
 * beside them still get three — so upgrading would visibly REMOVE months, which is
 * the exact regression this whole feature exists to close. Every team created
 * during the launch window is in that range.
 *
 * `currentMonth` IS ALWAYS ELEMENT 0, AND THE WINDOW IS NEVER EMPTY, FOR EVERY
 * INPUT — free or pro, with or without boards, for an earliestMonth in the future,
 * and for a malformed one. The list is built by counting BACK from `currentMonth`
 * over a length that is floored at FREE_MONTHS, so neither can fail.
 *
 * DO NOT BREAK THAT INVARIANT. dashboard-months.ts does not exist yet — Task 6 of
 * this spec creates it — but it will depend on this by name: its planned
 * `correctedMonth` will fall back to element 0 whenever `?month=` is not a member
 * of this list, and that fallback will settle — rather than the effect behind it
 * navigating forever — only because the fallback value is itself always a member. A
 * change like "do not offer the current month until the team has a board in it"
 * would read as entirely reasonable here and would reintroduce an infinite
 * redirect in a file its author had no reason to open. insights-months.ts carries
 * this same warning for the same reason.
 */
export function monthWindowFor({ currentMonth, earliestMonth, pro }: MonthWindowInput): Array<PuzzleMonth> {
  return countBack(currentMonth, spanFor({ currentMonth, earliestMonth, pro }))
}

/**
 * The oldest month the SERVER will serve this viewer — one month below
 * `oldestOfferedFor`, per SERVER_SLACK_MONTHS. That is now literally what the
 * code below computes, not just what this sentence claims.
 *
 * ARITHMETIC, NOT `monthWindowFor(...).at(-1)`, and that is deliberate rather than
 * a micro-optimisation: the array form would materialise up to MAX_MONTHS entries
 * on every below-floor request purely to read one value, and — before the span was
 * floored — could read `[-1]` off an empty array and throw `undefined.split` inside
 * getTeamMonthFor (scores.ts:37), taking the dashboard down for every Pro member of
 * the team.
 *
 * A FLOOR RATHER THAN MEMBERSHIP OF THE WINDOW. There is no upper bound to
 * enforce: a future month simply contains no boards, and refusing one would be a
 * second way for the UTC/local disagreement above to break a page.
 */
export function serverFloorFor(input: MonthWindowInput): PuzzleMonth {
  return addMonths(oldestOfferedFor(input), -SERVER_SLACK_MONTHS)
}

/**
 * The month to advertise to a free player as what Pro reaches back to, or null
 * when there is nothing to advertise.
 *
 * NULL IS THE IMPORTANT ANSWER. A team whose earliest board is already inside the
 * free window has nothing behind the gate, and a row saying otherwise would sell a
 * week-old team history it does not have. Same for a team with no boards, for a
 * player who is already Pro, and for a malformed earliestMonth.
 *
 * NAMES THE OLDEST MONTH PRO ACTUALLY REACHES — `oldestOfferedFor` with `pro:
 * true` — NOT `earliestMonth` itself. The two VALUES differ whenever either of
 * `spanFor`'s bounds bites — an `earliestMonth` of `currentMonth - 1` already
 * differs from the floored window's oldest month — but the ANSWER this function
 * returns only differs when the MAX_MONTHS cap does, because below the floor
 * both comparisons land on null anyway. The cap is the case that mattered: an ancient, unvalidated `earliestMonth` (upsertBoard,
 * wordle-teams-qvqi) used to be handed back verbatim, so a team with a stored
 * '1000-01' could be teased a month decades before what Pro's own capped window
 * reaches — advertising history the upgrade cannot deliver. Comparing the two
 * `oldestOfferedFor` values, instead of `earliestMonth` against the free
 * window, makes that impossible by construction: this can only ever name a
 * month the Pro window itself contains.
 *
 * THE COMPARISON IS AGAINST THE CLIENT FREE WINDOW, not the server's floor,
 * which sits one month further back (SERVER_SLACK_MONTHS). So a team whose
 * earliest board falls in exactly that slack month still gets a row here, even
 * though a free viewer could already reach that month by hand-typing its URL —
 * this can name a month the slack already covers. That is over-inclusive by one
 * month at the boundary, not under-promising, and it is accepted rather than
 * fixed: comparing against the server floor here would make this pure function
 * re-derive SERVER_SLACK_MONTHS's reasoning for a one-month edge case.
 */
export function proTeaserMonth({ currentMonth, earliestMonth, pro }: MonthWindowInput): PuzzleMonth | null {
  if (pro || earliestMonth === null || !isMonth(earliestMonth)) return null

  const proOldest = oldestOfferedFor({ currentMonth, earliestMonth, pro: true })
  const freeOldest = oldestOfferedFor({ currentMonth, earliestMonth, pro: false })
  return proOldest < freeOldest ? proOldest : null
}

/**
 * How many months long this viewer's window is. The one place the length rule
 * lives, so `monthWindowFor` and `serverFloorFor` can never disagree about it.
 */
function spanFor({ currentMonth, earliestMonth, pro }: MonthWindowInput): number {
  if (!pro || earliestMonth === null || !isMonth(earliestMonth)) return FREE_MONTHS

  // PuzzleMonth is 'YYYY-MM', so lexical comparison IS chronological comparison
  // (see puzzleDay.ts's header). CLAMPED HERE FOR SANITY, NOT LOAD-BEARING: an
  // earliestMonth in the future would otherwise drive `span` negative, but the
  // `Math.max(span, FREE_MONTHS)` floor below already lifts any span under
  // FREE_MONTHS back up to it regardless — so a future earliestMonth lands on
  // the free window whether this clamp runs or not, and no test can kill this
  // line by itself. It stays because a negative intermediate `span` is a worse
  // thing to have sitting in this function than a clamped one, not because
  // removing it would change what any caller observes.
  const start = earliestMonth > currentMonth ? currentMonth : earliestMonth
  const span = monthIndex(currentMonth) - monthIndex(start) + 1

  // FLOORED AT FREE_MONTHS so Pro is never narrower than free; capped at
  // MAX_MONTHS so an unvalidated puzzleDay cannot build an absurd list. Both
  // bounds have their own comment above; neither is tidiness.
  return Math.min(Math.max(span, FREE_MONTHS), MAX_MONTHS)
}

/**
 * The oldest month this viewer's window actually reaches — the single seam
 * `serverFloorFor` and `proTeaserMonth` both compute through, so neither can
 * name a month that disagrees with what `spanFor`'s floor and cap actually
 * produce. `monthWindowFor`'s own last element is this exact value, by
 * construction: `countBack` walks `spanFor(input) - 1` months back from
 * `currentMonth`, and the last step is this one.
 */
function oldestOfferedFor(input: MonthWindowInput): PuzzleMonth {
  return addMonths(input.currentMonth, -(spanFor(input) - 1))
}

/**
 * Whether a string is a well-formed 'YYYY-MM'.
 *
 * NEEDED BECAUSE NOTHING UPSTREAM GUARANTEES IT. `upsertBoard` stores `puzzleDay`
 * as an unvalidated `v.string()` (wordle-teams-qvqi), so `monthOf('')` is `''` and
 * `monthIndex('')` is NaN — which would make the span NaN and the window empty.
 *
 * SHAPE ONLY, AND IT ADMITS MONTH 00 AND 99. '2026-00' and '2026-99' both pass
 * here: the first yields a nine-month window and the second clamps to three.
 * Neither is harmful — a cosmetically long dropdown is not a crash, and since
 * Fix 1 every month this module hands out is `addMonths`-derived rather than
 * echoed back, so a nonsense input can no longer reach a label ('2026-00' teases
 * '2025-12'). Left shape-only deliberately: the real fix belongs upstream in
 * wordle-teams-qvqi, and a stricter check here would imply a validation
 * guarantee this module cannot make.
 */
function isMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value)
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
Expected: PASS, **40 tests**. Verified by running it.

If your runner reports a different number, count the `test.each` expansions before assuming the plan is wrong — but do not proceed on a mismatch without resolving it. An earlier draft of this line said 31, which is what that same breakdown sums to only if you add it up wrong; the draft before that said 17, having not expanded `test.each` at all.

- [ ] **Step 5: Mutation-test the three guards, one at a time**

Each mutation must fail the **named** test. If it fails a different set, the guard and the test are not aligned — fix that before moving on.

*Guard A — the free floor on the Pro branch.* In `spanFor`, change `Math.min(Math.max(span, FREE_MONTHS), MAX_MONTHS)` to `Math.min(span, MAX_MONTHS)`.
Expected: FAIL, **exactly two tests** — `IS NEVER NARROWER THAN THE FREE WINDOW` and `clamps an earliestMonth in the future rather than producing a negative span`. Verified by running it.

`with no boards at all, is still the free window` does **not** fail, and an earlier draft of this step wrongly predicted that it would. `spanFor` returns `FREE_MONTHS` from its early-return guard when `earliestMonth === null`, so that case never reaches the line this mutation touches. Worth knowing rather than worth fixing: the null path is covered by Guard B's territory, not Guard A's. Restore; re-run; PASS.

*Guard B — the malformed-input defence.* In `spanFor`, delete `|| !isMonth(earliestMonth)`.
Expected: FAIL, **three tests** — `survives a malformed earliestMonth without producing an empty window`, the element-0 case for `{"earliestMonth":""}`, and `serverFloorFor › never returns undefined, whatever the earliestMonth`. Verified by running it.

That blast radius is the guard doing its job rather than a coupling problem: a malformed month makes `monthIndex` return `NaN`, which propagates into an empty window (breaking element-0) and into `serverFloorFor`'s arithmetic (producing a value that fails the `YYYY-MM` assertion). Three tests failing is the evidence that one unvalidated input reaches all three consequences. Restore; re-run; PASS.

*Guard C — the teaser's "nothing behind the gate" check.* In `proTeaserMonth`, change the final line to `return earliestMonth`.
Expected: FAIL, naming `is null when the earliest board is already inside the free window`, **and nothing else**. This is the cleanest mutation in the plan; if anything else fails, something has coupled that should not have.

- [ ] **Step 6: Commit**

```bash
cd v2 && git add convex/lib/monthWindow.ts convex/lib/monthWindow.test.ts
git commit -m "feat(months): the pro month window rule, shared by client and server

One module, so the browser builds the dropdown from the same rule
getTeamMonthFor enforces.

The Math.max(FREE_MONTHS, span) floor is the line that matters: without it a
team younger than three months gives its PRO owner a shorter dropdown than its
free members, so upgrading removes months. The first draft of this rule had
that bug and a test asserting it as correct; the adversarial review caught it.

The server floor carries a month of slack because Convex runs UTC and the
viewer does not, and the span is bounded because puzzleDay is an unvalidated
v.string() (wordle-teams-qvqi).

wordle-teams-kusd"
```

---

### Task 2: The query that supplies the team's earliest month

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

      expect(await monthWindowInputsFor(ctx, mine, teamId)).toEqual({ earliestMonth: '2023-03' })
    })
  })

  test('reports null when nobody on the team has ever entered a board', () => {
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      expect(await monthWindowInputsFor(ctx, playerId, teamId)).toEqual({ earliestMonth: null })
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

  test('ignores a roster entry whose player row is gone, without losing the others', () => {
    // Convex ids are not foreign keys, so nothing guarantees every id in
    // playerIds resolves. ASSERTED WITH THE GHOST HOLDING THE OLDEST BOARD —
    // a ghost with no boards would be indistinguishable from a member with none,
    // and would prove nothing about what happens to a dangling id.
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
      await ctx.db.insert('dailyScores', {
        playerId: ghostId,
        puzzleDay: '2023-03-14',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.delete(ghostId)

      // The ghost's boards still exist and still count: the window is about what
      // the scoreboard can show, and getTeamMonthFor reads by playerId too. What
      // must not happen is a throw.
      expect((await monthWindowInputsFor(ctx, playerId, teamId)).earliestMonth).toBe('2023-03')
    })
  })
})
```

Add `monthWindowInputsFor` to the existing import from `'./scores'`:

```ts
import { getTeamMonthFor, monthWindowInputsFor, upsertBoardFor } from './scores'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd v2 && pnpm exec vitest run convex/scores.test.ts -t monthWindowInputsFor`
Expected: FAIL — `monthWindowInputsFor is not a function`.

- [ ] **Step 3: Write the implementation**

In `v2/convex/scores.ts`, add these below `getTeamMonth`. `monthOf` is **already** imported at `convex/scores.ts:6` — do not add it again.

```ts
/**
 * The earliest month anyone on this roster has a board in, or null for none.
 *
 * ONE INDEXED `.first()` PER MEMBER, ascending — `by_player_and_puzzleDay` is
 * already the index getTeamMonthFor walks for the month's scores, and an index
 * range's first row IS its smallest (Convex index queries default to ascending;
 * this file's siblings write `.order('desc')` explicitly when they want the other
 * end). No scan, no sort, no collect.
 *
 * ACROSS THE CURRENT ROSTER, WHICH IS THE ONLY MEANING AVAILABLE: dailyScores has
 * no teamId (see schema.ts), so a board belongs to a player rather than to a team.
 * That is not a workaround — it is exactly how getTeamMonthFor resolves the
 * scoreboard above, so the window and the data it gates can never disagree. A
 * member joining brings their earlier boards and widens the window; a member
 * leaving takes theirs and narrows it. Both are correct, and both are already
 * visible on the scoreboard the same way.
 *
 * A LEAVING MEMBER CAN THEREFORE SHRINK THE WINDOW UNDER A VIEWER SITTING ON AN
 * OLD MONTH. The client corrects for it — routes/app.tsx moves `?month=` back into
 * the window whenever it falls outside — which is the same correction a team
 * change gets, for the same reason: the viewer did nothing wrong.
 *
 * DO NOT "OPTIMISE" THIS ONTO teamMonthStats. That table is computed, its coverage
 * of old months is not guaranteed, and reading it here would recreate exactly the
 * aggregate-versus-roster disagreement wordle-teams-iht.4 exists to close.
 */
async function earliestMonthFor(
  ctx: ReaderCtx,
  playerIds: readonly Id<'players'>[],
): Promise<PuzzleMonth | null> {
  // Promise.all rather than a sequential loop for the reason getTeamMonthFor
  // gives above: one snapshot-isolated transaction, so this is round trips rather
  // than correctness. Order does not matter here — the result is a minimum.
  const firsts = await Promise.all(
    playerIds.map((memberId) =>
      ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', memberId))
        .first(),
    ),
  )

  let earliest: string | null = null
  for (const row of firsts) {
    // PuzzleDay is 'YYYY-MM-DD', so lexical comparison is chronological.
    if (row !== null && (earliest === null || row.puzzleDay < earliest)) earliest = row.puzzleDay
  }
  return earliest === null ? null : monthOf(earliest)
}

/**
 * How far back this team goes — the one input the month dropdown cannot compute
 * for itself.
 *
 * IT DOES NOT RETURN `pro`, AND THAT IS DELIBERATE. routes/app.tsx already holds
 * the viewer's membership from `api.teams.amIPro` (app.tsx:203). Returning it here
 * too would give the client two independently-updating subscriptions to one fact —
 * structurally the aggregate-versus-live split-brain wordle-teams-iht.4 is about.
 * The SERVER still needs it, and reads it straight from isProFor at the one place
 * that enforces.
 *
 * A SEPARATE QUERY RATHER THAN A FIELD ON getTeamMonth'S PAYLOAD. MonthPicker
 * renders in the controls row of routes/app.tsx, OUTSIDE the <Suspense> boundary
 * getTeamMonth sits behind; hanging the dropdown's contents on that payload would
 * make it wait for a month of scores to load before it could say which months
 * exist.
 *
 * IT RETURNS THE RULE'S INPUT, NOT THE RULE'S ANSWER, because the answer needs the
 * VIEWER'S current month and the server does not have it — Convex runs UTC.
 * lib/monthWindow.ts turns this into a window on whichever side is asking. Sending
 * a server-computed list instead would be wrong for a few hours at every month
 * boundary, in whichever direction the viewer's zone leans.
 */
export async function monthWindowInputsFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<{ earliestMonth: PuzzleMonth | null }> {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  return { earliestMonth: await earliestMonthFor(ctx, team.playerIds) }
}

export const monthWindow = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await monthWindowInputsFor(ctx, player._id, teamId)
  },
})
```

Add `PuzzleMonth` to the existing `./lib/puzzleDay.ts` type import if it is not already there.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd v2 && pnpm exec vitest run convex/scores.test.ts -t monthWindowInputsFor`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd v2 && git add convex/scores.ts convex/scores.test.ts
git commit -m "feat(months): a query for how far back a team goes

Returns the earliest board month and nothing else: the viewer's current month
is local and the server's is UTC, so only the asking side can build the window
— and app.tsx already holds the one amIPro subscription that answers 'pro'.

wordle-teams-kusd"
```

---

### Task 3: Enforcement

**Files:**
- Modify: `v2/convex/access.ts`
- Modify: `v2/convex/scores.ts` (inside `getTeamMonthFor`, after `requireTeamMemberFor`)
- Modify: `v2/src/lib/convex-error.ts` (**two** functions)
- Modify: `v2/convex/scores.test.ts` (new tests **and** nine existing literals)

- [ ] **Step 1: Rewrite the nine dated literals — mandatory, not conditional**

`convex/scores.test.ts` calls `getTeamMonthFor` with a hardcoded month at lines **37, 50, 65, 135, 162, 181, 627, 651, 655** (`'2026-08'` at all but 651, which is `'2026-07'`).

They pass today, because the free floor is currently `2026-05`. They begin failing in **December 2026** and **January 2027**, when the floor moves past them — with nobody having touched the code. The first draft of this plan made fixing them conditional on seeing a failure, and there is no failure to see.

Rewrite each to be relative to the clock, the way this file's own header at `:13-16` already requires for `today`:

```ts
const thisMonth = monthOf(today)
// … then '2026-08' → thisMonth, '2026-07' → addMonths(thisMonth, -1)
```

Board fixtures inside those tests use `puzzleDay` literals like `'2026-08-01'`; those must move with the month or the assertions break. `addMonths` and `monthOf` are already imported at `convex/scores.test.ts:5`.

Add a line to the file's header comment recording that a hardcoded *month* is now as unsafe as a hardcoded `today` was, and why.

- [ ] **Step 2: Run the suite to confirm the rewrite is behaviour-neutral**

Run: `cd v2 && pnpm exec vitest run convex/scores.test.ts`
Expected: PASS, unchanged count. This is a refactor; nothing should change yet.

- [ ] **Step 3: Commit the rewrite on its own**

```bash
cd v2 && git add convex/scores.test.ts
git commit -m "test(scores): make nine getTeamMonthFor months relative to the clock

They are about to become time bombs: the month gate's floor moves with the
calendar, so hardcoded '2026-08' starts failing in January 2027 with nobody
having touched the code. Separated from the gate itself so the diff that adds
the gate is only the gate.

wordle-teams-kusd"
```

- [ ] **Step 4: Write the failing enforcement tests**

Append inside the existing `describe('getTeamMonthFor', ...)`:

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

  test('serves a free caller every month down to the slack month, and refuses the one below', () => {
    // THE BOUNDARY, BOTH SIDES OF IT. -3 is the slack month the server allows and
    // the dropdown does not offer (SERVER_SLACK_MONTHS); -4 is the first refusal.
    // Without both, SERVER_SLACK_MONTHS could be changed to 2 and every test in
    // this file would stay green.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      for (const delta of [0, -1, -2, -3]) {
        await expect(
          getTeamMonthFor(ctx, playerId, teamId, addMonths(monthOf(today), delta)),
        ).resolves.toBeDefined()
      }
      await expect(
        getTeamMonthFor(ctx, playerId, teamId, addMonths(monthOf(today), -4)),
      ).rejects.toMatchObject({ data: { code: 'MONTH_OUT_OF_WINDOW' } })
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
    //
    // THE FIELD IS insightsTrialEndsAt (schema.ts:169). `trialEndsAt` is only a
    // PARAMETER NAME on insightsAccess.ts's shouldStartTrial, and a grep for it
    // matches the real field as a substring — which is how the first draft of
    // this plan told its own implementer the wrong name was correct.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert(
        'players',
        aPlayer({ insightsTrialEndsAt: Date.now() + 86_400_000 }),
      )
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

  test('refuses a bare year, which lexically brackets a whole one', () => {
    // convex/scores.ts:180 has documented this property of `v.string()` months
    // since before the gate existed: "{ month: '2026' } bounds '2026-01'..
    // '2026-31', which lexically brackets every day of the year… getTeamMonthFor
    // has exactly the same property." Harmless while the route was the only
    // caller. Not harmless now: '2026' sorts ABOVE a pro floor of '2023-02', so
    // without a shape check a pro member could pull every board for every
    // teammate for a whole year in one payload.
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

      for (const month of ['2026', '2026-', 'abc', '']) {
        await expect(getTeamMonthFor(ctx, playerId, teamId, month)).rejects.toMatchObject({
          data: { code: 'MONTH_OUT_OF_WINDOW' },
        })
      }
    })
  })
```

First confirm the fixture accepts the field: `grep -nw "insightsTrialEndsAt" convex/fixtures.ts convex/schema.ts`. Note `-w`. If `aPlayer` does not take it, insert the player and `ctx.db.patch(playerId, { insightsTrialEndsAt: … })`.

- [ ] **Step 5: Run to verify they fail**

Run: `cd v2 && pnpm exec vitest run convex/scores.test.ts -t "below the floor"`
Expected: FAIL — the call resolves instead of rejecting.

- [ ] **Step 6: Add the access code**

In `v2/convex/access.ts`, after `'TEAM_LIMIT_REACHED'` in the `AccessCode` union:

```ts
  | 'MONTH_OUT_OF_WINDOW'
```

- [ ] **Step 7: Wire the message into BOTH functions in convex-error.ts**

This is two edits, and the second is the one that matters.

In `typedCodeMessage`:

```ts
    case 'MONTH_OUT_OF_WINDOW':
      // A BACKSTOP, NOT A CONVERSION SURFACE. The dropdown never offers a month
      // outside the window and routes/app.tsx corrects a ?month= that falls
      // outside one, so a browser user is not expected to reach this — it exists
      // so the tier is real against a direct call. The free player's actual
      // prompt is the dropdown's "Back to <month> · Pro" row, and the upgrade
      // flow belongs to wordle-teams-iht.1.
      return 'That month is part of Pro.'
```

Then in `convexErrorCode`, add to the `||` chain:

```ts
    code === 'MONTH_OUT_OF_WINDOW' ||
```

**Do not skip the second edit, and do not trust typecheck to catch it.** `typedCodeMessage` ends in `const _exhaustive: never = code`, so adding a member to `AccessCode` DOES force the case above — but `convexErrorCode` (`src/lib/convex-error.ts:17-43`) is a hand-written chain ending in `return null`, and nothing forces that at all. Without it the new case is dead code and every user sees "Something went wrong loading this page." All four gates would be green. Add a sentence to `convexErrorCode`'s header saying it must be extended by hand whenever `AccessCode` grows, because that is not otherwise discoverable.

- [ ] **Step 8: Enforce it**

In `getTeamMonthFor`, immediately after `const team = await requireTeamMemberFor(...)`:

```ts
  // THE MONTH GATE (wordle-teams-kusd). Membership was the ONLY check here
  // before, which made the three-month dropdown an affordance rather than a
  // paywall — v1's own position, and one Layer 3 stopped taking in
  // wordle-teams-iht.3.
  //
  // THE SHAPE CHECK IS FIRST, AND IT IS NOT DEFENSIVE PROGRAMMING. This function
  // takes `month: v.string()`, and :180 in this file has long recorded what that
  // allows: a bare '2026' lexically brackets every day of the year. It sorts
  // ABOVE a pro floor, so without this a pro member could pull twelve months of
  // every teammate's boards in one payload — past the floor below, and past this
  // file's own "SCOPED TO ONE TEAM AND ONE MONTH" bandwidth argument.
  if (!/^\d{4}-\d{2}$/.test(month)) throw accessError('MONTH_OUT_OF_WINDOW')

  // THE FREE FLOOR IS CHECKED FIRST, AND USUALLY IT IS THE WHOLE CHECK. Almost
  // every call asks for one of the last three months, and for those this costs
  // one string comparison and no database reads. Only a request OLDER than the
  // free floor pays for isProFor, and only one that passes THAT pays for the
  // per-member index walk — the free branch of the rule ignores earliestMonth
  // entirely, so fetching it before knowing the caller is pro would be work that
  // provably cannot change the answer.
  //
  // `serverFloorFor` CARRIES A MONTH OF SLACK and the reason is in its own
  // comment: this runtime is UTC and the viewer is not, so an exact window would
  // refuse a month the dropdown had just offered, at every month boundary.
  //
  // THE CLOCK READ IS A DEVIATION FROM THIS DIRECTORY'S CONVENTION and is worth
  // naming: every other "what month is it" question on the server takes `today`
  // from the client and bounds it with isPlausibleToday (insights.ts's teamMonth,
  // winners.ts). Taking an argument here would mean changing getTeamMonth's
  // signature at six call sites for a bound whose only failure direction is MORE
  // permissive — Convex caches on read-set invalidation rather than wall-clock, so
  // a long-lived subscriber's floor simply stays older than it should. Accepted
  // deliberately; revisit if this function ever needs the day rather than the
  // month.
  const serverMonth = monthOf(toPuzzleDay(new Date()))
  const freeFloor = serverFloorFor({ currentMonth: serverMonth, earliestMonth: null, pro: false })
  if (month < freeFloor) {
    if (!(await isProFor(ctx, playerId))) throw accessError('MONTH_OUT_OF_WINDOW')

    const earliestMonth = await earliestMonthFor(ctx, team.playerIds)
    if (month < serverFloorFor({ currentMonth: serverMonth, earliestMonth, pro: true })) {
      throw accessError('MONTH_OUT_OF_WINDOW')
    }
  }
```

Add `serverFloorFor` to a new import from `./lib/monthWindow.ts`, and `accessError`, `isProFor` and `toPuzzleDay` to their existing imports if absent. Note `throw accessError(...)` — the function is typed `never` and throws internally, but every other call site in this codebase writes the `throw`, and a reader checking whether the gate refuses should not have to look up a return type.

- [ ] **Step 9: Run the tests**

Run: `cd v2 && pnpm exec vitest run convex/scores.test.ts`
Expected: PASS — everything from Step 1 plus the 6 new tests.

- [ ] **Step 10: Mutation-test the gate — three isolating mutations**

*Mutation 1 — the shape check.* Delete the `if (!/^\d{4}-\d{2}$/...)` line.
Expected: FAIL, naming `refuses a bare year`, **and nothing else**.

*Mutation 2 — the pro check.* Change `if (!(await isProFor(ctx, playerId)))` to `if (false)`.
Expected: FAIL, naming `refuses a free caller a month below the floor`, `serves a free caller every month down to the slack month`, and `refuses a caller inside the Insights trial the pro window` — the three that depend on a non-pro caller being stopped. It must **not** fail the two pro tests.

*Mutation 3 — the pro floor.* Change the inner `serverFloorFor({ …, earliestMonth, pro: true })` to `{ …, earliestMonth: null, pro: true }`.
Expected: FAIL, naming `serves a pro caller a month back to the roster’s earliest board`, **and nothing else** — the pro window collapses to the free one, so the 2023 read is refused while every free-side test is unaffected.

Restore after each and re-run to green. The first draft offered two mutations that were the same mutation; if two of yours fail the same set, you have not isolated anything.

- [ ] **Step 11: Lint, then commit**

Run: `cd v2 && pnpm lint && pnpm typecheck`

```bash
cd v2 && git add convex/access.ts convex/scores.ts convex/scores.test.ts src/lib/convex-error.ts
git commit -m "feat(months): enforce the pro month window server-side

getTeamMonthFor checked membership and nothing else, so the three-month window
was decoration — any member could reach any month with a URL, and a bare
'2026' lexically brackets a whole year, which :180 has documented all along.

The free floor is checked first and is the whole check for almost every call,
so the dashboard's core query pays nothing in the common path.

MONTH_OUT_OF_WINDOW is added to convexErrorCode's chain as well as to
typedCodeMessage. Only the latter is exhaustive; without the former the
message is dead code behind a generic fallback, with every gate green.

wordle-teams-kusd"
```

---

### Task 4: Audit every other path that serves a caller-supplied month

The spec says the gate must cover every such path. Two are already known; find any third.

**Files:**
- Modify: `v2/convex/winners.ts`
- Modify: `v2/convex/scores.ts` (a comment, and a gate only if the decision goes that way)

- [ ] **Step 1: `getLastMonthWinner` — a known hole**

`convex/winners.ts:470` takes `{ teamId, month: v.string() }` and `lastMonthWinnerFor` checks `requireTeamMemberFor` and nothing else, so any member can ask who won March 2023.

Decide and implement: either apply the same shape-and-floor check `getTeamMonthFor` now has, or record in the file why a winner's name is not worth gating when the month's boards are. If you gate it, add a test mirroring Task 3's and mutation-test it the same way.

- [ ] **Step 2: `scores.getMyMonth` — in the file this task already edits**

`convex/scores.ts:190` takes `{ month: v.string() }` and returns **the caller's own** boards for any month, with no window check. It is own-data, which is a real argument for leaving it open — but `pro-benefits.ts` (Task 7) sells "your full history" as Pro, and Insights Layer 2 is gated on exactly that. Decide which, and write the decision into the function's doc comment either way.

- [ ] **Step 3: Sweep for a third**

```bash
cd v2 && grep -rn "month: v.string()" convex/*.ts | grep -v test
```

For every hit not covered above, state in writing whether a caller can supply an arbitrary month and what it returns. `convex/teamStats.ts` needs no audit — its only exports are `internalMutation`s. `convex/insights.ts:153` serves arbitrary months but returns `stats: null` without `hasFullTeamMonth`, so it is already closed; say so rather than leaving it unmentioned.

- [ ] **Step 4: "Probably fine" is not an acceptable result**

Each audited function ends this task with either a gate or a comment naming the specific reason it needs none. Silence is a failure of the task.

- [ ] **Step 5: Run and commit**

Run: `cd v2 && pnpm exec vitest run convex/winners.test.ts convex/scores.test.ts`

```bash
cd v2 && git add convex/winners.ts convex/winners.test.ts convex/scores.ts
git commit -m "fix(months): audit every caller-supplied-month path, not just getTeamMonth

getLastMonthWinner and getMyMonth both take an unbounded v.string() month.
A gate on one path is not a gate.

wordle-teams-kusd"
```

---

### Task 5: The dropdown

**Files:**
- Delete: `v2/src/components/month-picker.test.ts`
- Modify: `v2/src/components/month-picker.tsx`
- Create: `v2/src/components/month-picker.hook.test.ts`

- [ ] **Step 1: Delete the old unit test**

```bash
cd v2 && git rm src/components/month-picker.test.ts
```

It tested `monthOptions`, which this task deletes. The obvious move — repointing it at `monthWindowFor` — would leave a file under `components/` that renders no component and duplicates `monthWindow.test.ts`'s ordering cases exactly; `month-picker.tsx` could then be deleted entirely and it would stay green. The ordering properties it pinned (descending, strictly monotonic, holds at any length) are covered in `monthWindow.test.ts`, which is where the rule now lives. The component's own behaviour is covered by the jsdom test below.

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
// shows. Without this the row is deletable, and its condition wideable, with a
// green suite.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MonthPicker } from './month-picker.tsx'

afterEach(cleanup)

/**
 * Radix opens a DropdownMenu on POINTERDOWN, not on click — `fireEvent.click`
 * alone leaves the menu shut and every assertion about its contents trivially
 * passing against an empty list. Lifted from team-scope-controls.hook.test.ts,
 * which pays for the same lesson on the same primitive, including the two extra
 * event fields Radix's own handler reads.
 */
const open = () =>
  fireEvent.pointerDown(screen.getByRole('button', { name: /2026/ }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  })

const props = {
  value: '2026-08',
  months: ['2026-08', '2026-07', '2026-06'],
  teaserLabel: null as string | null,
  onChange: () => {},
  onUpgrade: () => {},
}

describe('the month list', () => {
  test('renders every month it is given, and only those', () => {
    render(createElement(MonthPicker, { ...props, months: ['2026-08', '2026-07', '2026-06', '2026-05'] }))
    open()

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(4)
  })

  test('labels months in the short form the app uses everywhere', () => {
    // 'Aug 2026', NOT 'August 2026'. formatMonthLabel is
    // Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })
    // (format-day.ts:13), and its own doc line says "'Aug 2026' — the month
    // picker's label". The first draft of this file asserted the long form in
    // three places and could never have passed.
    render(createElement(MonthPicker, props))
    open()

    expect(screen.getByRole('menuitemradio', { name: 'Aug 2026' })).toBeTruthy()
  })
})

describe('the pro teaser row', () => {
  test('names the month Pro reaches back to', () => {
    render(createElement(MonthPicker, { ...props, teaserLabel: 'Mar 2023' }))
    open()

    const row = screen.getByRole('menuitem', { name: /Back to/ })
    // THE MONTH IS PINNED SEPARATELY FROM THE PREFIX, deliberately. The row's
    // whole job is to name the actual reward rather than an abstraction, so a
    // future edit that keeps "Back to …" and loses the month must fail here.
    expect(row.textContent).toContain('Mar 2023')
  })

  test('does not render when there is nothing behind the gate', () => {
    // THE GUARD. A week-old team must not advertise history it does not have —
    // somebody would pay for it. `teaserLabel` is null for a pro viewer, for a
    // team with no boards, and for a team whose earliest board is already inside
    // the free window; proTeaserMonth decides which, and monthWindow.test.ts
    // covers that decision. This asserts the component honours it.
    render(createElement(MonthPicker, props))
    open()

    // A POSITIVE CONTROL FIRST. Without it, an `open()` that silently failed
    // would make the null assertion below pass vacuously — which is exactly the
    // failure mode team-scope-controls.hook.test.ts warns about in its own helper.
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    expect(screen.queryByRole('menuitem', { name: /Back to/ })).toBeNull()
  })

  test('calls onUpgrade rather than changing the month', () => {
    // IT IS AN UPGRADE AFFORDANCE, NOT A MONTH. Rendering it inside the radio
    // group would make it selectable as a value the window does not contain,
    // which the server would then refuse.
    const onUpgrade = vi.fn()
    const onChange = vi.fn()
    render(createElement(MonthPicker, { ...props, teaserLabel: 'Mar 2023', onUpgrade, onChange }))
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /Back to/ }))

    expect(onUpgrade).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd v2 && pnpm exec vitest run src/components/month-picker.hook.test.ts`
Expected: FAIL — `MonthPicker` does not accept `months` / `teaserLabel` / `onUpgrade`.

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
import { formatMonthLabel } from '#/lib/format-day.ts'
import type { PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * The month dropdown.
 *
 * IT TAKES A WINDOW RATHER THAN COMPUTING ONE (wordle-teams-kusd). It used to own
 * `monthOptions`, which returned the same three months to everyone — that function
 * is gone rather than left delegating, because its signature took only
 * `currentMonth` and could not express a window that depends on the viewer's
 * membership and the team's age; left as a wrapper it would be a function any
 * future caller could reach that silently answers "three months" for a Pro player.
 * routes/app.tsx builds the window from convex/lib/monthWindow.ts and hands the
 * SAME array to TeamBoards, so the calendar and this control cannot disagree about
 * which months exist.
 *
 * NO SCROLL CONTAINER OF ITS OWN, even though a Pro list runs to dozens of rows.
 * DropdownMenuContent already carries
 * `max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto`
 * (ui/dropdown-menu.tsx:68), which is viewport-aware and therefore better than a
 * computed height on a phone. v1 wraps its own long dropdown in a ScrollArea with
 * a hand-computed height (src/components/action-buttons/month-dropdown/utils.ts);
 * porting that here would nest a second scroll container inside one that already
 * works, and v2 has no ScrollArea primitive to port it with.
 */
export function MonthPicker({
  value,
  months,
  teaserLabel,
  onChange,
  onUpgrade,
}: {
  value: PuzzleMonth
  /** Every month this viewer may select, newest first. `monthWindowFor`'s output. */
  months: Array<PuzzleMonth>
  /**
   * The already-formatted month Pro reaches back to, or null when there is
   * nothing to advertise — a pro viewer, a team with no boards, or a team whose
   * earliest board is already inside the free window. `proTeaserMonth` decides
   * and the route formats; this only renders.
   *
   * A FORMATTED STRING RATHER THAN A PuzzleMonth, so that deleting the guard
   * below renders an empty label instead of throwing: `formatMonthLabel(null)`
   * reaches `Intl.DateTimeFormat.format(Invalid Date)`, which raises a
   * RangeError. A guard whose only mutant is a crash cannot be mutation-tested —
   * the crash proves the component still runs, not that the guard works.
   */
  teaserLabel: string | null
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
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {months.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {formatMonthLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {/* OUTSIDE THE RADIO GROUP, AND THAT IS NOT A STYLE CHOICE. A
            DropdownMenuRadioItem carries a value, so putting this inside would
            make it selectable as a month the window does not contain — which the
            server would then refuse with MONTH_OUT_OF_WINDOW. It is an upgrade
            affordance that happens to live in a month menu.

            IT IS THE SIXTH CALLER OF THE UPGRADE PATH. Header.tsx:267,
            trial-ended-card.tsx:32, board-entry/import-upsell.tsx:49,
            routes/app.tsx:892 and routes/insights.tsx:327 are the others.
            wordle-teams-iht.1 puts one shared interstitial behind all of them;
            when it lands this must go through it rather than remaining the one
            path that still reaches checkout directly. That issue's notes carry
            the count.

            THE "Pro" BADGE IS PART OF THE ACCESSIBLE NAME, not hidden from it —
            "Back to Mar 2023 Pro" — matching board-entry/import-upsell.tsx,
            which renders the same badge the same way. */}
        {teaserLabel !== null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUpgrade}>
              <Sparkles className="h-4 w-4 text-accent-solid" aria-hidden="true" />
              Back to {teaserLabel}
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

- [ ] **Step 5: Run to verify it passes**

Run: `cd v2 && pnpm exec vitest run src/components/month-picker.hook.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Mutation-test the teaser guard**

Change `{teaserLabel !== null && (` to `{teaserLabel !== '__never__' && (`.
Expected: FAIL, naming `does not render when there is nothing behind the gate`, **and nothing else** — the row renders with an empty month and no crash, which is the point of taking a formatted string. Restore; re-run; PASS.

- [ ] **Step 7: Commit**

```bash
cd v2 && git add -A src/components/month-picker.tsx src/components/month-picker.hook.test.ts src/components/month-picker.test.ts
git commit -m "feat(months): the dropdown takes a window, and teases what Pro reaches

monthOptions is deleted rather than left delegating: its signature took only
currentMonth and could not express a window that depends on the viewer.

No ScrollArea — DropdownMenuContent already scrolls, viewport-aware, and v2
has no ScrollArea primitive to port v1's computed-height one with.

The teaser takes a formatted label so the guard has a non-crashing mutant.

wordle-teams-kusd"
```

---

### Task 6: Wire the route

**Files:**
- Create: `v2/src/lib/dashboard-months.ts`
- Create: `v2/src/lib/dashboard-months.test.ts`
- Modify: `v2/src/routes/app.tsx`
- Modify: `v2/src/components/teams/team-boards.hook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/dashboard-months.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { correctedMonth, fallbackMonths } from './dashboard-months.ts'

describe('correctedMonth', () => {
  test('is null when the month on screen is inside the window', () => {
    expect(correctedMonth({ monthParam: '2026-07', months: ['2026-08', '2026-07', '2026-06'] })).toBeNull()
  })

  test('is null while the window is still loading, and null with no month yet', () => {
    // NOT months[0]. An absent window means the query has not answered, and
    // navigating on it would move the reader off the month they asked for and
    // then have to move them back. An absent monthParam belongs to useSearchSync,
    // which fills it — this must not race that.
    expect(correctedMonth({ monthParam: '2019-01', months: undefined })).toBeNull()
    expect(correctedMonth({ monthParam: '2019-01', months: [] })).toBeNull()
    expect(correctedMonth({ monthParam: undefined, months: ['2026-08'] })).toBeNull()
  })

  test('falls back to the newest month when the month on screen is outside the window', () => {
    // Viewing March 2023 on an old team and switching to one created last month
    // leaves ?month= naming a month the new team cannot show. Same for a Pro
    // subscriber's bookmark after a downgrade, and for a roster change that takes
    // the team's oldest board away with a departing member. All three are
    // corrected identically — see dashboard-months.ts's header for why the spec
    // stopped trying to tell them apart.
    expect(correctedMonth({ monthParam: '2023-03', months: ['2026-08', '2026-07', '2026-06'] })).toBe(
      '2026-08',
    )
  })

  test('always returns a member of the window it was given', () => {
    // THE PROPERTY THE EFFECT'S TERMINATION ACTUALLY RESTS ON, asserted directly
    // rather than inferred from the round-trip test below — which, on its own,
    // would also pass for `return months[months.length - 1]`.
    const months = ['2026-08', '2026-07', '2026-06']

    expect(months).toContain(correctedMonth({ monthParam: '2019-01', months }))
  })

  test('is idempotent — fed its own output, it does nothing', () => {
    // The same property resolveDashboardSearch and resolveInsightsSearch are each
    // tested for, and the only thing standing between the effect that consumes
    // this and an infinite redirect. It holds because element 0 of a window is
    // always currentMonth — see monthWindow.ts, which labels that DO NOT BREAK
    // THAT PROPERTY.
    const months = ['2026-08', '2026-07', '2026-06']
    const once = correctedMonth({ monthParam: '2023-03', months })

    expect(once).not.toBeNull()
    expect(correctedMonth({ monthParam: once as string, months })).toBeNull()
  })
})

describe('fallbackMonths', () => {
  test('is the free window, newest first', () => {
    expect(fallbackMonths('2026-08', '2026-08')).toEqual(['2026-08', '2026-07', '2026-06'])
  })

  test('includes the month on screen even when it is older than the free window', () => {
    // WITHOUT THIS THE DAY PICKER GOES DEAD MID-LOAD. team-boards.tsx:227 sets
    // minDay from the OLDEST month in this array, so a Pro viewer sitting on
    // 2026-02 would, for the length of one round trip, get a minDay of 2026-06 —
    // after every day in the month on screen — and react-day-picker would
    // disable the whole visible grid and both arrows.
    expect(fallbackMonths('2026-08', '2026-02')).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-02',
    ])
  })

  test('never duplicates a month', () => {
    expect(fallbackMonths('2026-08', '2026-07')).toEqual(['2026-08', '2026-07', '2026-06'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd v2 && pnpm exec vitest run src/lib/dashboard-months.test.ts`
Expected: FAIL — cannot resolve `./dashboard-months.ts`.

- [ ] **Step 3: Write the implementation**

Create `v2/src/lib/dashboard-months.ts`:

```ts
import { monthWindowFor } from '../../convex/lib/monthWindow.ts'
import type { PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * What the dashboard should do about `?month=` once it knows the team's window.
 *
 * IN ITS OWN MODULE RATHER THAN IN dashboard-search.ts, which that file's header
 * asks for by name: "A new rule that needs a date library, a Convex call, or the
 * insights month window belongs in its own module beside what it depends on, the
 * way insights-search.ts does." This one needs a window a Convex query supplies.
 *
 * IT IS ALSO THE WRONG SHAPE FOR resolveDashboardSearch, and that is a hard
 * constraint rather than a preference. useSearchSync's `resolve` must be a
 * module-level function (use-search-sync.ts:47-50) — the sibling requirement on
 * `navigate` at :59-72 is what wordle-teams-1ubk fixed, after a call-site closure
 * re-ran that effect on every render — so the resolver cannot be handed per-team
 * data. resolveInsightsSearch escapes this only because `createdAt` rides along on
 * every entry of the `teams` array it already receives; `earliestMonth` does not.
 *
 * EVERY OUT-OF-WINDOW MONTH IS CORRECTED, AND THE SPEC USED TO SPLIT THEM.
 * An earlier design corrected a team switch but let a bookmark kept across a
 * downgrade reach the server's typed error, so it could explain itself. That is
 * not implementable here: both arrive as "?month= is not in this window", and
 * telling them apart means threading the previous teamParam through an effect that
 * navigates — the riskiest code in the feature. It would also race: six components
 * call useSuspenseQuery(getTeamMonth) during render while this correction only
 * runs after commit, so whichever resolved first would decide what the player saw.
 * Intermittent behaviour is worse than either branch. The server gate stays and
 * still makes the tier real; a browser user simply is not expected to meet it.
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
  /** `?month=` as it stands, or undefined before useSearchSync has filled it. */
  monthParam: string | undefined
  /** The selected team's window, or undefined while the query is in flight. */
  months: Array<PuzzleMonth> | undefined
}): PuzzleMonth | null {
  if (monthParam === undefined) return null
  if (months === undefined || months.length === 0) return null
  if (months.includes(monthParam)) return null

  // Element 0, which monthWindowFor guarantees is `currentMonth` for every input.
  // That guarantee is what makes this terminate: the value returned here is itself
  // always a member of the window this function judges against, so a second pass
  // returns null.
  return months[0]
}

/**
 * What to drive the two month controls with while `api.scores.monthWindow` is
 * still in flight.
 *
 * THE FREE WINDOW, PLUS THE MONTH ALREADY ON SCREEN. Not `[currentMonth]`, which
 * an earlier draft used: team-boards.tsx:227 derives `minDay` from the OLDEST
 * entry here, so a one-element array would set minDay to the first of the current
 * month — after every day of a past month a Pro viewer might be looking at — and
 * react-day-picker would disable the entire visible grid and both step arrows for
 * the length of one round trip. Including `monthParam` keeps the control alive on
 * the month actually being viewed.
 *
 * THE FREE WINDOW IS THE SAFE FLOOR because every account is entitled to it, so
 * this can only ever WIDEN when the query lands — never take a month away that was
 * briefly offered.
 */
export function fallbackMonths(currentMonth: PuzzleMonth, monthParam: PuzzleMonth): Array<PuzzleMonth> {
  const free = monthWindowFor({ currentMonth, earliestMonth: null, pro: false })
  return [...new Set([...free, monthParam])].sort().reverse()
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd v2 && pnpm exec vitest run src/lib/dashboard-months.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-test the correction**

Delete the `if (months.includes(monthParam)) return null` line.
Expected: FAIL, naming `is null when the month on screen is inside the window` and `is idempotent`. Restore; re-run; PASS.

- [ ] **Step 6: Wire the route — hooks at the TOP of the component**

In `v2/src/routes/app.tsx`:

Change the import at `:23` to `import { MonthPicker } from '#/components/month-picker.tsx'`. Add `useQuery` to the `@tanstack/react-query` import at `:6` (it currently imports only `useMutation, useSuspenseQuery`). Add `useMemo` to the `react` import at `:7`. Add:

```tsx
import { monthWindowFor, proTeaserMonth } from '../../convex/lib/monthWindow.ts'
import { correctedMonth, fallbackMonths } from '#/lib/dashboard-months.ts'
```

**Insert the new hooks immediately after `const { data: onboardingStatus } = …` (around `:208`) — NOT further down.** `Dashboard` has early returns at `:612` (`if (teams.length === 0)`) and `:661` (`if (!teamParam || !monthParam)`), and today there is not one hook call below `:446`. Three hooks below those returns would call a different number of hooks on the render before `useSearchSync` fills the params and the render after it — `Rendered more hooks than during the previous render`, on every load, caught by `react-hooks/rules-of-hooks` but only when lint runs.

```tsx
  /*
    THE SELECTED TEAM'S MONTH WINDOW (wordle-teams-kusd).

    UP HERE WITH THE OTHER HOOKS, NOT BESIDE THE CONTROLS IT FEEDS. This component
    returns early twice below — an empty state at :612 and a skeleton at :661 —
    and every hook must run on both paths.

    NAMED monthWindowInputs, NOT `window`. A `const window` in this scope shadows
    the global that the sign-in arrival effect uses at :357 and :374, which would
    break the funnel event, promoteLoginAttempt and the ?signin= strip — silently,
    since :359 already records that a failure there just leaves the last-used badge
    naming the wrong method forever.

    'skip' GATED ON MEMBERSHIP, NOT ON TRUTHINESS. A stale or foreign ?team= is a
    non-empty string, so `teamParam ? … : 'skip'` would fire the query and take a
    guaranteed NOT_A_MEMBER throw for the render or two before useSearchSync
    corrects it. `teams` is already resolved above, so validating against it costs
    nothing — and it is the same check resolveDashboardSearch makes.

    useQuery, NOT useSuspenseQuery: this feeds a control in the bar, and suspending
    the page on it would make the whole dashboard wait to learn how far back the
    dropdown goes.
  */
  const monthWindowArgs =
    teamParam && teams.some((team) => team.id === teamParam)
      ? { teamId: teamParam as Id<'teams'> }
      : 'skip'
  const { data: monthWindowInputs } = useQuery(convexQuery(api.scores.monthWindow, monthWindowArgs))

  /*
    THE VIEWER'S OWN CLOCK, and the same post-hydration guard :680 uses for the
    same reason: reading it during an SSR-matching render would make the server
    (UTC) and the client (local) disagree on the last and first days of a month —
    the hydration-mismatch class wordle-teams-uc5 was.
  */
  const clockMonth = hydrated ? monthOf(toPuzzleDay(new Date())) : undefined

  /*
    THE WINDOW, BUILT ON THE CLIENT because `currentMonth` is the VIEWER'S and
    Convex runs UTC — see monthWindow.ts.

    `pro` IS THE EXISTING isPro (:203), NOT A FIELD ON THE NEW QUERY. Two
    subscriptions to one fact, updating independently, is the aggregate-versus-live
    split-brain wordle-teams-iht.4 is about. isPro is a useSuspenseQuery, so it is
    always a boolean here and needs no in-flight branch.

    EVERY DEPENDENCY IS A PRIMITIVE, AND THE LIST IS EXHAUSTIVE. `earliestMonth` is
    destructured out first rather than left as `monthWindowInputs?.earliestMonth`
    in the array, because react-hooks/exhaustive-deps resolves a bare
    `monthWindowInputs` in the body to the identifier itself and would report a
    missing dependency — and `pnpm lint` runs with --max-warnings 0, where that
    warning is a failed gate.
  */
  const earliestMonth = monthWindowInputs?.earliestMonth ?? null
  const windowReady = monthWindowInputs !== undefined && clockMonth !== undefined
  const months = useMemo(
    () =>
      windowReady && clockMonth !== undefined
        ? monthWindowFor({ currentMonth: clockMonth, earliestMonth, pro: isPro })
        : undefined,
    [windowReady, clockMonth, earliestMonth, isPro],
  )

  /*
    MOVING `?month=` BACK INTO THE WINDOW. Three situations produce a ?month= the
    selected team cannot show: switching to a younger team, a bookmark kept across
    a downgrade, and a departing member taking the team's oldest board with them.
    All three are corrected the same way; lib/dashboard-months.ts's header explains
    why the spec stopped trying to distinguish them.

    THE DECISION IS PURE AND THE TERMINATION IS A TEST, not a comment — read that
    file's header before changing what this is fed.

    `replace: true, resetScroll: false` MATCHES useSearchSync'S OWN CORRECTION and
    for the same reasons: this is not a navigation the reader asked for, so it must
    not take over the back button and must not move them on the page.
  */
  const monthCorrection = correctedMonth({ monthParam, months })
  useEffect(() => {
    if (monthCorrection === null || !teamParam) return
    void navigate({
      to: Route.fullPath,
      search: { team: teamParam, month: monthCorrection },
      replace: true,
      resetScroll: false,
    })
  }, [monthCorrection, teamParam, navigate])
```

Then, below the early returns where `currentMonth` and `monthParam` are both known strings, define the value both controls share:

```tsx
  // ONE ARRAY FOR BOTH CONTROLS, which is what keeps the dropdown and the day
  // picker from disagreeing about which months exist — team-boards.tsx's `months`
  // prop doc has said so since wordle-teams-5vv3, predicting this change.
  const monthsForControls = months ?? fallbackMonths(currentMonth, monthParam)
```

Replace the `MonthPicker` element at `:894-898`:

```tsx
        <MonthPicker
          value={monthParam}
          months={monthsForControls}
          teaserLabel={
            months === undefined
              ? null
              : (() => {
                  const teaser = proTeaserMonth({
                    currentMonth,
                    earliestMonth,
                    pro: isPro,
                  })
                  return teaser === null ? null : formatMonthLabel(teaser)
                })()
          }
          onChange={(month) => navigate({ to: Route.fullPath, search: { team: teamParam, month } })}
          onUpgrade={() => void startUpgrade()}
        />
```

Add `formatMonthLabel` to the imports if absent.

Replace `:1142`:

```tsx
          months={monthsForControls}
```

- [ ] **Step 7: Fix the source-text assertion this breaks**

`src/components/teams/team-boards.hook.test.ts:679` asserts the literal JSX text of `app.tsx:1142`:

```ts
expect(rendered[0].get('months')).toBe('{monthOptions(currentMonth)}')
```

Update it to `'{monthsForControls}'`, and — because that assertion exists to prove the two controls share one array — **extend it to walk `<MonthPicker>` too** and assert both `months` attributes render the identical expression. As written it only ever inspected `<TeamBoards>`, so it could never have caught the two drifting apart, which is the one thing its comment says it is for.

(`src/routes.test.ts` contains no reference to `monthOptions` — the first draft of this plan named it and was wrong.)

- [ ] **Step 8: Run typecheck, lint and the full suite**

Run: `cd v2 && pnpm typecheck && pnpm lint && pnpm exec vitest run`
Expected: all green. **Run `lint` here, not only in Task 9** — `rules-of-hooks` and `exhaustive-deps` are the two rules this task is most likely to trip, and neither shows up in typecheck or vitest.

- [ ] **Step 9: Commit**

```bash
cd v2 && git add src/lib/dashboard-months.ts src/lib/dashboard-months.test.ts src/routes/app.tsx src/components/teams/team-boards.hook.test.ts
git commit -m "feat(months): drive both pickers from the window, and correct ?month=

The hooks go at the top of Dashboard, above its two early returns — there is
no hook call below :446 today and adding three below :661 would change the
hook count between renders on every load.

The correction is a pure function with an idempotence test, for the reason
resolveDashboardSearch is one: it is consumed by an effect that navigates.

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
// @vitest-environment node
//
// node rather than the suite's default edge-runtime, because the gatedAt test
// below reads the filesystem. That is the whole point of it: a path that does not
// resolve is a claim nobody checked.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { PRO_BENEFITS } from './pro-benefits.ts'

describe('PRO_BENEFITS', () => {
  test('lists exactly the five things Pro gates today', () => {
    // A COUNT AND ORDER ASSERTION, deliberately. This file is copy, and copy is
    // the one thing typecheck, lint and build cannot check: an entry deleted or a
    // sixth invented would otherwise ship silently to the interstitial and the
    // landing page at once.
    expect(PRO_BENEFITS.map((benefit) => benefit.id)).toEqual([
      'teams',
      'scoring',
      'import',
      'insights',
      'months',
    ])
  })

  test('every gatedAt path exists on disk', () => {
    // THE PROPERTY THAT KEEPS THIS HONEST, and it has to touch the filesystem to
    // have it. A suffix check (`/\.tsx?$/`) would pass for 'nonsense.ts' while
    // the comment claimed the entry named real code — which is the same shape as
    // the "unlimited months" claim this whole file exists to stop.
    for (const benefit of PRO_BENEFITS) {
      expect(existsSync(resolve(__dirname, '../..', benefit.gatedAt)), benefit.gatedAt).toBe(true)
    }
  })

  test('records which gates are server-enforced and which are UI-only', () => {
    // TWO OF THE FIVE ARE NOT ENFORCED, and access.ts:265-268 says so: "createTeam
    // PAST THE CAP IS NOT ENFORCED… THE SCORING-SYSTEM EDITOR IS NOT ENFORCED."
    // form.tsx:161 says the same of the import gate. Both are deliberate v1-parity
    // decisions and neither is a reason not to sell the feature — but a list that
    // implied all five were enforced would be false on the day it was written.
    expect(
      PRO_BENEFITS.filter((benefit) => benefit.serverEnforced).map((benefit) => benefit.id),
    ).toEqual(['teams', 'insights', 'months'])
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

  test('quotes no price, in any of the shapes a price takes', () => {
    // The price lives in Polar and reaches the customer on Polar's hosted
    // checkout. A number here is a second source of truth that goes stale
    // silently with every gate green — trial-copy.ts's own rule, same reason.
    const prose = PRO_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ')

    expect(prose).not.toMatch(/[$£€]|\bUSD\b|\bper (month|year)\b|\ba (month|year)\b|\bmonthly\b|\bannually\b|\/mo\b/i)
  })

  test('uses typographic apostrophes and no typewriter ones', () => {
    const prose = PRO_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ')

    expect(prose).not.toContain("'")
    // AND AT LEAST ONE IS PRESENT, so that deleting every apostrophe — which
    // would also satisfy the line above — fails instead of passing.
    expect(prose).toContain('’')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd v2 && pnpm exec vitest run src/lib/pro-benefits.test.ts`
Expected: FAIL — cannot resolve `./pro-benefits.ts`.

- [ ] **Step 3: Write the implementation**

Create `v2/src/lib/pro-benefits.ts`:

```ts
/**
 * WHAT PRO ACTUALLY INCLUDES — one list, checked against the code that gates it.
 *
 * Sibling of trial-copy.ts and billing-copy.ts, and here for the reason
 * trial-copy.ts gives: the copy is the deliverable and the component is not. A
 * sentence chosen in a spec and then typed straight into JSX is a product decision
 * no test can reach.
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
 * `gatedAt` IS NOT DECORATION, AND IT IS NOT `enforcedAt`. Every entry names the
 * file where a free player is turned away, and pro-benefits.test.ts asserts each
 * path exists on disk. But only three of the five are turned away by the SERVER —
 * convex/access.ts:265-268 states plainly that "createTeam PAST THE CAP IS NOT
 * ENFORCED" and "THE SCORING-SYSTEM EDITOR IS NOT ENFORCED", and
 * board-entry/form.tsx:161 calls the import gate "UI-ONLY BY DESIGN". Both are
 * deliberate v1-parity decisions — v1 sells those features the same way — and
 * neither is a reason to leave them off the list. What would be wrong is a field
 * named `enforcedAt` claiming a server check that two of these do not have.
 *
 * NO PRICE HERE. The price lives in Polar and reaches the customer on Polar's
 * hosted checkout. A number in this file is a second source of truth that goes
 * stale the moment the dashboard changes, silently, with every gate green.
 *
 * TEAM CHAT AND PUSH NOTIFICATIONS ARE NOT ON THIS LIST, and their absence is a
 * decision rather than an omission: neither is gated — there is no isProFor
 * anywhere in convex/chat.ts or convex/chatNotify.ts. They are part of the free
 * product and belong in the story the landing page tells about what the app does,
 * not in the one it tells about what Pro buys.
 */
export type ProBenefit = {
  id: 'teams' | 'scoring' | 'import' | 'insights' | 'months'
  /** A few words, headline case. */
  title: string
  /** One sentence, second person, no price. */
  body: string
  /** Repo-relative path to where a free player is turned away. Checked on disk. */
  gatedAt: string
  /** Whether the server refuses it, or only the UI hides it. See this file's header. */
  serverEnforced: boolean
}

export const PRO_BENEFITS: ReadonlyArray<ProBenefit> = [
  {
    id: 'teams',
    title: 'As many teams as you like',
    body: 'Free accounts can join two teams. Pro lifts the cap, and any invites waiting on it come through the moment you upgrade.',
    gatedAt: 'convex/lib/teamLimits.ts',
    serverEnforced: true,
  },
  {
    id: 'scoring',
    title: 'Your own scoring system',
    body: 'Decide what a two-guess day is worth, and what a failed one costs, for every team you own.',
    gatedAt: 'src/components/scoring-system-card.tsx',
    serverEnforced: false,
  },
  {
    id: 'import',
    title: 'Import from a screenshot',
    body: 'Paste a screenshot of your Wordle and we’ll fill the board in for you — check it and submit.',
    gatedAt: 'src/components/board-entry/form.tsx',
    serverEnforced: false,
  },
  {
    id: 'insights',
    title: 'Your full history, and your team’s whole month',
    body: 'Free shows you today. Pro shows you everything you have done, and how the whole team’s month is going rather than just one day of it.',
    gatedAt: 'convex/insights.ts',
    serverEnforced: true,
  },
  {
    id: 'months',
    title: 'Every month you have ever played',
    body: 'Free reaches back three months. Pro reaches back to your team’s very first board.',
    gatedAt: 'convex/lib/monthWindow.ts',
    serverEnforced: true,
  },
]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd v2 && pnpm exec vitest run src/lib/pro-benefits.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Mutation-test both honesty guards**

*Mutation 1.* Delete the `months` entry.
Expected: FAIL, naming `lists exactly the five things Pro gates today`. Restore.

*Mutation 2.* Change the `scoring` entry's `gatedAt` to `'src/components/nope.tsx'`.
Expected: FAIL, naming `every gatedAt path exists on disk`. Restore; re-run; PASS.

- [ ] **Step 6: Commit**

```bash
cd v2 && git add src/lib/pro-benefits.ts src/lib/pro-benefits.test.ts
git commit -m "feat(pro): one canonical list of what Pro includes

The product had no such list, and the only description it had — feature-cards'
'Go Pro' card — claimed unlimited months while v2 gated none.

The field is gatedAt, not enforcedAt: access.ts:265-268 and form.tsx:161 both
say the scoring editor and the import gate are UI-only, so a field claiming
server enforcement for all five would be false on the day it was written.

wordle-teams-kusd"
```

---

### Task 8: Discharge the stale predictions — there are nine, not four

Comments that predict this work as future become comments that assert something the code does not do. This project has found nineteen of those recently; leaving nine behind would be the largest single batch yet.

**Files (all confirmed to contain a prediction or a reference to the deleted `monthOptions`):**

| File | What is now false |
| --- | --- |
| `v2/convex/access.ts` (~`:270`, the `isProFor` header) | "the month window… DOES NOT EXIST HERE YET", "v2 currently shows a pro player LESS history than production" |
| `v2/src/routes/app.tsx:1136-1137` | "widen together when the pro / expansion lands" — **wrapped across a line break**, so a phrase grep misses it; six lines above the line Task 6 edits |
| `v2/src/components/teams/team-boards.tsx:49-60` | "v2 has NO pro month gate yet — `monthOptions` returns three months for everyone" |
| `v2/src/components/teams/team-boards.tsx:202` | "is `monthOptions`' output" |
| `v2/src/components/teams/team-boards-model.ts:147,153-154` | "v2 has no pro month gate yet, so both controls read `monthOptions`" |
| `v2/src/components/teams/team-boards-model.test.ts:283` | "that is `monthOptions`’ order" |
| `v2/src/components/teams/team-boards.hook.test.ts:89,441-444` | "the shape `monthOptions` produces"; "the pro expansion would later have to take it away" |
| `v2/src/components/insights/team-scope-controls.tsx:49-55` | "`monthOptions(currentMonth)` is computed INSIDE that component"; "An `options` prop on MonthPicker would have closed the gap" — Task 5 adds exactly that prop |
| `v2/src/lib/insights-months.ts:9-16` | "still owes its own score-based expansion" |
| `docs/design-system/V2-ADDENDUM.md:450` (row 50) | "v2 has no pro month gate yet… both controls widen together when it lands" |
| `docs/design-system/V2-ADDENDUM.md:587` | "Phase 2 deliberately deferred the pro gate, so v2…" — contains no "month", so a month-shaped grep misses it |

- [ ] **Step 1: Correct each one**

Rewrite each from prediction to fact. Keep what is still true — `insights-months.ts`'s explanation of why its window and this one are *different rules that must not be unified* is now more load-bearing, not less, and V2-ADDENDUM row 48's newest-first divergence is still a divergence the parity audit needs.

**Row 50 at `:450` is the one that carries the quoted sentence, not row 48 at `:446`.** An earlier draft of the spec cited `:446` and the error reached the beads issue; editing row 48 and leaving row 50 would discharge the wrong comment.

- [ ] **Step 2: Verify nothing survives**

**Two traps, both found by running the first version of this grep, and both of which would have left work undone:**

*Multi-word phrases wrap.* `app.tsx:1136` reads "…when the pro / expansion lands" across a line break, so `grep "pro expansion"` does not match it. Nor does any month-shaped phrase match `V2-ADDENDUM.md:587`'s "deferred the pro gate". Search single distinctive words and read the context.

*`monthOptionsFor` is a DIFFERENT function and it SURVIVES.* `src/lib/insights-panel.ts:238` exports it; `daily-benchmark.tsx` and `insights-panel.test.ts` use it. A substring grep for `monthOptions` hits all three. Use `-w`, and do not let anyone "tidy up" those call sites.

```bash
cd /home/cdub/projects/wordle-teams
# The deleted function, word-bounded so monthOptionsFor is excluded.
grep -rnw "monthOptions" v2/src v2/convex
# The predictions, single words so a line break cannot hide them.
grep -rniE "pro (month )?gate|pro[[:space:]]+expansion|expansion lands|score-based" \
  v2/src v2/convex docs/design-system/V2-ADDENDUM.md
```

Expected: **zero** hits from the first grep — Task 5 deleted `monthOptions`, so any surviving reference names something that no longer exists. Every hit from the second is past tense about work that has landed, or is `monthWindow.ts`'s own deliberate explanation of why its rule and `teamMonthOptions` differ. The first draft of this task listed four files and used a grep that would have left eleven references standing.

- [ ] **Step 3: Commit**

```bash
cd /home/cdub/projects/wordle-teams && git add -A v2/src v2/convex docs/design-system/V2-ADDENDUM.md
git commit -m "docs(months): discharge nine comments that predicted the pro month gate

Each said the expansion was future work, or named monthOptions, which is now
deleted. A comment that asserts something the code does not do is the defect
class this project has found nineteen of; the first draft of this task found
four of these nine.

wordle-teams-kusd"
```

---

### Task 9: Gates, e2e, and close

- [ ] **Step 1: Run all four gates**

```bash
cd v2 && pnpm typecheck && pnpm lint && pnpm test:once && pnpm build
```

Expected: all four green. Run all four — they catch different things; `lint` reaches `public/*.js` that `build` does not, and the suite asserts counts a docs-only change can break.

Do not pipe these through anything that swallows the exit status. This shell is zsh, where `PIPESTATUS` is empty, so a piped gate check can report a false green.

- [ ] **Step 2: Start a local Convex backend for e2e**

```bash
printf 'CONVEX_DEPLOYMENT=anonymous:anonymous-v2\n' > /tmp/convex.anon.env
cd v2 && PATH="$HOME/.local/share/mise/installs/node/22.23.2/bin:$PATH" \
  CONVEX_AGENT_MODE=anonymous pnpm exec convex dev --env-file /tmp/convex.anon.env
```

Run it in the background. The `--env-file` is **not optional**: `.env.local` carries `CONVEX_DEPLOY_KEY` and a bare `convex dev` targets a real cloud deployment. Confirm the log says `[Local] Port 3210` before continuing. Node 22 is required; the workstation default is 25, which refuses `use node` actions.

Before starting Playwright, confirm nothing stale holds port 3000 — a leftover dev server will be attached to and every spec will test old code.

- [ ] **Step 3: Run e2e**

Run the full Playwright suite in the background; it takes about 11 minutes and exceeds the foreground tool-call limit.
Expected: 101/101, or a failure that names a real behaviour change from this work.

A server-side access change to the dashboard's core query is exactly the class e2e catches and the unit suite does not. **`convex/e2eSeed.ts` is the first place to look** on a failure: a seeded team whose boards predate the free window will now be refused for a free seeded player. Fix the seed, not the floor.

- [ ] **Step 4: Kill the backend**

Wait on the log rather than on the process name — `until ! pgrep -f convex` never exits, because the waiter matches itself.

- [ ] **Step 5: Close and push**

```bash
cd /home/cdub/projects/wordle-teams
bd close wordle-teams-kusd
git status   # bd writes Dolt only; commit .beads/issues.jsonl again if it changed
git pull --rebase && bd dolt push && git push
git status   # MUST show up to date with origin
```

`bd` changes lag one commit: after `bd close`, check `git status` and commit `.beads/issues.jsonl` again if it changed. Never `--no-verify`.

Leave `wordle-teams-qvqi` (unvalidated `puzzleDay`) open — Task 1's span bounds defend against its symptom, not its cause.

---

## Self-review

**Spec coverage.** §3 the rule, both bounds and the invariant → Task 1. §4 the query → Task 2; the floor, the slack, the shape check and the trial → Task 3; the always-correct decision → Task 6. §5 the dropdown, the teaser, the short label, no ScrollArea → Task 5; the day picker → Task 6 steps 6-7; the sixth affordance → Task 5's component comment and `wordle-teams-iht.1`'s notes. §6 the inventory and the `gatedAt`/`serverEnforced` split → Task 7. §7's five mutation-tested guards → Task 1 step 5 (guards 2, 3 and the new 5), Task 3 step 10 (guard 1), Task 5 step 6, Task 6 step 5 (guard 4), Task 7 step 5. §9 AC 1–12 → AC1 Task 6, AC2 Task 5, AC3 Task 3, AC4 Task 6, AC5 Tasks 5 and 8, AC6 Task 7, AC7 Task 8, AC8 Task 1, AC9 Task 3, AC10 Task 4, AC11 Task 3 step 7, AC12 Task 9.

**Names used consistently across tasks:** `monthWindowFor`, `serverFloorFor`, `proTeaserMonth`, `spanFor`, `isMonth`, `MonthWindowInput`, `FREE_MONTHS`, `MAX_MONTHS`, `SERVER_SLACK_MONTHS`, `monthWindowInputsFor`, `earliestMonthFor`, `correctedMonth`, `fallbackMonths`, `monthsForControls`, `monthWindowInputs`, `PRO_BENEFITS`, `ProBenefit`, `gatedAt`, `serverEnforced`, `MONTH_OUT_OF_WINDOW`. `MonthPicker`'s props are `value`, `months`, `teaserLabel`, `onChange`, `onUpgrade` in both Task 5's test and Task 6's call site. `monthWindowInputsFor` returns `{ earliestMonth }` only — no `pro` — in Task 2's tests, Task 2's implementation and Task 6's consumer.

**Test counts, expanded rather than estimated:** Task 1 = 31 (free 3, pro 7, `test.each` 7×2 = 14, floor 3, teaser 5); Task 2 = 4; Task 3 = 6 new; Task 5 = 5; Task 6 = 8; Task 7 = 6. The first draft said 17 for Task 1 because it did not expand `test.each`.

**Two things the implementer must verify rather than assume**, flagged inline where they occur: that `aPlayer` accepts `insightsTrialEndsAt` (Task 3 step 4 — grep with `-w`, because the wrong name matches the right field as a substring), and the exact shape of `team-boards.hook.test.ts`'s AST helper before extending it to `<MonthPicker>` (Task 6 step 7).
