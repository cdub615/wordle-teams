# Insights UI Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/insights` so it follows the project's design system and reads as a product worth $49.99/year, without adding a single Convex query.

**Architecture:** All new statistics are pure functions in `src/lib/insights-personal.ts`, unit-tested with no DOM. The 517-line `src/routes/insights.tsx` is decomposed into one component per panel under `src/components/insights/`, each wired in as it is built so every commit leaves the app green. The route keeps only the guard, the corpus hook, the four top-level branches and the composition.

**Tech Stack:** TanStack Start + TanStack Router, React 19, Tailwind 4 (tokens in `src/styles.css`), shadcn/ui (`style: "default"`), Convex + `@convex-dev/react-query`, Vitest (edge-runtime by default, jsdom opt-in per file), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-insights-ui-revamp-design.md`

---

## Working rules

**All commands run from `/home/cdub/projects/wordle-teams/v2`.** The repo root is v1; `v2/` is a separate pnpm island with its own lockfile.

| Task | Command |
| --- | --- |
| One test file | `pnpm test:once src/lib/insights-personal.test.ts` |
| All tests | `pnpm test:once` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Build | `pnpm build` |
| e2e | `pnpm e2e e2e/insights.spec.ts` |

**Run all four gates before the final commit, not just the one that looks relevant.** `build` ≠ `lint` ≠ `typecheck` ≠ `test`. A docs-only change has broken tests in this repo before.

**Never use `--no-verify`.** The pre-commit hook runs the PII guard, which has failed open three times already.

**Import conventions, which are not uniform and must be matched per file:**
- Test files import siblings without an extension: `from './insights-personal'`
- Components import with the alias and the extension: `from '#/lib/insights-personal.ts'`
- Convex shared libs are relative from `src/lib/`: `from '../../convex/lib/board.ts'`

**Two constraints on `src/routes/insights.tsx` survive every task below:**
1. `InsightsRoute` must stay **unexported**. The vite plugin silently declines to code-split a route file whose routed identifier is also exported. `src/routes.test.ts` pins this.
2. `loadInsightsBenchmark()` must not be lifted into a shared module. The corpus is ~79 KB and must stay on this code-split route only. CI greps `dist/client`.

**Green TEXT is `text-accent-solid`, never `text-success`.** `--success` is a
BACKGROUND token: it travels with `--success-foreground` (design principle #3 —
"background and foreground travel together, never set one without the other from
the same pair"), and every legitimate use pairs them, as `badge.tsx` does with
`bg-success text-success-foreground`. Critically `--success` is `#15803d` in BOTH
themes, so as a text colour on a dark card it measures **3.74:1 and fails WCAG
AA**. `--accent-solid` is the established green foreground — `maintenance.tsx`,
`feature-cards.tsx` and `pull-to-refresh.tsx` all use it — and it carries a
dark-mode value (`#22c55e`), measuring 5.02:1 light and **8.22:1 dark**. Light is
identical either way; only dark differs. This plan originally specified
`text-success` in three places and every one was wrong.

**Every existing `data-testid` is load-bearing** — all 27 appear in `e2e/`, `src/routes/-insights.hook.test.ts`, or a component test. Preserve each one on the element that keeps its meaning. Where a meaning genuinely changes, update the test in the same commit and say so in the commit message. Never silently drop one.

---

## File structure

**Create:**

| File | Responsibility |
| --- | --- |
| `src/components/insights/unlock-prompt.tsx` | The §6.1 prompt: what unlocks, what it gives, how far away. Three call sites, one component |
| `src/components/insights/mini-board.tsx` | `MiniBoard` (coloured, real answer) and `WordTiles` (uncoloured, a word only) |
| `src/components/insights/attempt-distribution.tsx` | The 1–6/X bars |
| `src/components/insights/personal-summary.tsx` | The hero: lead figure, trailing-form comparison, distribution, four supporting stats |
| `src/components/insights/openers-panel.tsx` | Advice callout, difficulty line, opener rows |
| `src/components/insights/trend-panel.tsx` | The month bars |
| `src/components/insights/daily-benchmark.tsx` | Filters, bounded scroller, count |
| `src/components/insights/board-row.tsx` | One day's row |
| `src/components/insights/no-team-card.tsx` | The stated empty state for a player on no team |

**Modify:**

| File | Change |
| --- | --- |
| `src/lib/insights-personal.ts` | Five new pure functions and their constants |
| `src/lib/insights-personal.test.ts` | Tests for all five |
| `src/routes/insights.tsx` | Header, wrapper, composition; `PersonalHistory`, `Stat`, `DailyBenchmark` and `BoardCard` all move out |
| `src/components/insights/team-panel.tsx` | Head-to-head leads; averages become bars; card takes the team name |

---

## Task 1: The header

The owner's first, explicit request: remove the word "Back". `chat.tsx` and `team.tsx` already carry the canonical icon-only shape and insights is the only page that diverges.

**Files:**
- Modify: `src/routes/insights.tsx:118-131`

- [ ] **Step 1: Replace the header block**

In `src/routes/insights.tsx`, replace the outer wrapper and header:

```tsx
  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/app">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Back
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">Insights</h1>
      </div>
```

with:

```tsx
  return (
    /* THE CAP IS NESTED INSIDE page-max, NOT COMBINED WITH IT ON ONE ELEMENT,
       and this is not a style preference. `.page-max` is declared UNLAYERED in
       styles.css while every Tailwind utility lives in `@layer utilities`, and
       unlayered declarations beat layered ones outright regardless of source
       order or specificity. `class="page-max max-w-3xl"` therefore renders at
       --page-max's 1440px and the cap silently does nothing. wordle-teams-wty4.1.2
       already paid to learn this on /team; team.tsx:195 is the shape to copy. */
    <main className="page-max mt-2 md:mt-6">
      <div className="mx-auto w-full max-w-3xl">
      {/* THE SHAPE IS team.tsx'S AND chat.tsx'S, DOWN TO THE aria-label. This
          page was the only one carrying a "Back" text label, and three pages
          that go back differently is a worse outcome than any one of the
          shapes on its own. NO `-ml-2`: team.tsx and chat.tsx do not have one,
          and adding it here would reintroduce an 8px difference between this
          page's back arrow and /team's — the exact inconsistency this comment
          claims to be removing. */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back to dashboard" asChild>
          <Link to="/app">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Insights</h1>
      </div>
```

Close both: the route component's final `</div>` becomes `</div></main>`.

- [ ] **Step 2: Add the scope line**

Immediately after the header `</div>`, before `<TrialEndedCard />`:

```tsx
      <InsightsScope data={data} />
```

And add this component below `InsightsRoute`:

```tsx
/**
 * What the page is computed from. Nothing on the page stated this before, so a
 * player had no way to tell whether a number covered their whole history or
 * only what the current tier unlocks.
 *
 * ABSENT RATHER THAN ZERO while the query is in flight or empty: "0 boards" is
 * a claim, and the loading and empty branches below already say the true thing.
 */
function InsightsScope({ data }: { data: Boards | null | undefined }) {
  if (!data || data.boards.length === 0) return null
  const earliest = data.boards.reduce(
    (min, board) => (board.puzzleDay < min ? board.puzzleDay : min),
    data.boards[0].puzzleDay,
  )
  return (
    <p className="text-muted-foreground mb-4 ml-8 text-xs" data-testid="insights-scope">
      {data.boards.length} {data.boards.length === 1 ? 'board' : 'boards'} · since{' '}
      {formatMonthLabel(monthOf(earliest))}
    </p>
  )
}
```

`formatMonthLabel` and `monthOf` are already imported by this file.

**The prop type includes `null`, and must.** `myBenchmarkBoards` returns `null`
when there is no player row (`convex/insights.ts`), so `useQuery`'s `data` is
`Boards | null | undefined`. Narrowing it to `Boards | undefined` fails
typecheck with TS2322. The existing guard already treats both identically.

**Export `InsightsScope`** so it can be unit-tested, for exactly the reason the
file's own comment gives for exporting `InsightsPanel`: the route's hidden
queries are unreachable from a test, since the hook test's `useQuery` mock
reports every query unresolved. A sibling export is safe; only the ROUTED
identifier (`InsightsRoute`) must stay unexported.

- [ ] **Step 3: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm test:once
```

Expected: all pass. `src/routes/-insights.hook.test.ts` does not assert on the header.

- [ ] **Step 4: Commit**

```bash
git add src/routes/insights.tsx
git commit -m "fix(insights): the back control is an arrow, like every other page

The owner's first note walking v2. chat.tsx and team.tsx already carry the
icon-only shape down to the aria-label; insights was the only page with a
'Back' text label and the only one not wrapped in page-max.

Also states what the page is computed from, which nothing did before."
```

---

## Task 2: `attemptDistribution`

**Files:**
- Modify: `src/lib/insights-personal.ts`
- Test: `src/lib/insights-personal.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/insights-personal.test.ts`:

```ts
describe('attemptDistribution', () => {
  test('it counts 1 through 6 and folds the failure sentinel into X', () => {
    const rows = attemptDistribution([
      board('2026-08-01', 'CRANE', 3),
      board('2026-08-02', 'CRANE', 3),
      board('2026-08-03', 'CRANE', 4),
      failed('2026-08-04', 'CRANE'),
    ])

    expect(rows.map((r) => r.label)).toEqual(['1', '2', '3', '4', '5', '6', 'X'])
    expect(rows.find((r) => r.label === '3')!.count).toBe(2)
    expect(rows.find((r) => r.label === '4')!.count).toBe(1)
    expect(rows.find((r) => r.label === 'X')!.count).toBe(1)
  })

  test('the modal row is the most common, and ties go to the lower attempt count', () => {
    const rows = attemptDistribution([
      board('2026-08-01', 'CRANE', 3),
      board('2026-08-02', 'CRANE', 4),
    ])
    expect(rows.find((r) => r.isModal)!.label).toBe('3')
    expect(rows.filter((r) => r.isModal)).toHaveLength(1)
  })

  test('no history means no modal row, rather than a spurious one at 1', () => {
    const rows = attemptDistribution([])
    expect(rows.every((r) => r.count === 0)).toBe(true)
    expect(rows.some((r) => r.isModal)).toBe(false)
  })
})
```

Add the `failed` helper beside the existing `board` helper at the top of the file:

```ts
/** An unsolved board: six guesses, none of them the answer. attemptsFor scores 7. */
const failed = (day: string, opener: string): PersonalBoard => ({
  puzzleDay: day,
  answer: 'SPEED',
  guesses: [opener, 'MOIST', 'MOIST', 'MOIST', 'MOIST', 'MOIST'],
})
```

Add `attemptDistribution` to the import list at the top of the test file.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/lib/insights-personal.test.ts
```

Expected: FAIL — `attemptDistribution is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/insights-personal.ts`:

```ts
export type DistributionRow = {
  label: '1' | '2' | '3' | '4' | '5' | '6' | 'X'
  count: number
  /** The most common outcome. At most one row carries it. */
  isModal: boolean
}

const DISTRIBUTION_LABELS = ['1', '2', '3', '4', '5', '6', 'X'] as const

/**
 * How often they solve in each number of guesses — the statistic every Wordle
 * player already knows how to read, and the one this page was missing entirely.
 *
 * SEVEN IS X, NOT A SEVENTH BAR. attemptsFor scores an unsolved board 7, which
 * is a sentinel rather than a count: nobody takes seven guesses. Rendering it as
 * "7" would invent a rule the game does not have.
 *
 * ALL SEVEN ROWS ALWAYS RENDER, including the empty ones. A distribution with
 * missing rows is not a distribution — the gap at 2 is information, and an axis
 * that changes shape between players cannot be compared at a glance.
 *
 * NO MODAL ROW ON AN EMPTY HISTORY. Taking the max of seven zeroes would paint
 * the accent on "1" and claim a most-common outcome that does not exist.
 */
export function attemptDistribution(boards: PersonalBoard[]): DistributionRow[] {
  const counts = new Map<DistributionRow['label'], number>(
    DISTRIBUTION_LABELS.map((label) => [label, 0]),
  )

  for (const board of boards) {
    const attempts = attemptsFor(board.guesses, board.answer ?? '')
    const label: DistributionRow['label'] =
      attempts >= 7 ? 'X' : (String(attempts) as DistributionRow['label'])
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  // Ties go to the lower attempt count because DISTRIBUTION_LABELS is in order
  // and `>` never displaces an equal earlier row.
  let modal: DistributionRow['label'] | null = null
  let best = 0
  for (const label of DISTRIBUTION_LABELS) {
    const count = counts.get(label) ?? 0
    if (count > best) {
      best = count
      modal = label
    }
  }

  return DISTRIBUTION_LABELS.map((label) => ({
    label,
    count: counts.get(label) ?? 0,
    isModal: label === modal,
  }))
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:once src/lib/insights-personal.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights-personal.ts src/lib/insights-personal.test.ts
git commit -m "feat(insights): attempt distribution, the stat the page was missing

Seven is folded into X rather than rendered as a seventh bar -- attemptsFor
scores an unsolved board 7 as a sentinel, and nobody takes seven guesses.
Empty rows still render, because the gap at 2 is information. An empty history
gets no modal row at all rather than painting the accent on a zero."
```

---

## Task 3: `trailingForm`

**Files:**
- Modify: `src/lib/insights-personal.ts`
- Test: `src/lib/insights-personal.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('trailingForm', () => {
  /** `n` boards on consecutive days from 2026-01-01, each solved in `attempts`. */
  const run = (n: number, attempts: number, from = 0): PersonalBoard[] =>
    Array.from({ length: n }, (_, i) =>
      board(`2026-01-${String(from + i + 1).padStart(2, '0')}`, 'CRANE', attempts),
    )

  test('it withholds below the floor rather than comparing a window with itself', () => {
    expect(trailingForm(run(TRAILING_FORM_MIN_BOARDS - 1, 4))).toBeNull()
  })

  test('at the floor exactly it reports, and the window is a real subset', () => {
    const form = trailingForm(run(TRAILING_FORM_MIN_BOARDS, 4))
    expect(form).not.toBeNull()
    expect(form!.recent).toBe(4)
    expect(form!.lifetime).toBe(4)
    expect(form!.delta).toBe(0)
  })

  test('a better recent window gives a positive delta', () => {
    // 20 boards at 5, then 30 at 3. Lifetime 3.8, recent 3.
    const boards = [...run(20, 5), ...run(30, 3, 20)]
    const form = trailingForm(boards)!
    expect(form.recent).toBe(3)
    expect(form.lifetime).toBe(3.8)
    expect(form.delta).toBe(0.8)
    expect(form.isBest).toBe(true)
  })

  test('a worse recent window gives a negative delta and is not the best', () => {
    const boards = [...run(30, 3), ...run(20, 5, 30)]
    const form = trailingForm(boards)!
    expect(form.delta).toBeLessThan(0)
    expect(form.isBest).toBe(false)
  })

  test('the window is the most recent by puzzle day, not by array order', () => {
    const boards = [...run(30, 3, 20), ...run(20, 5)]
    expect(trailingForm(boards)!.recent).toBe(3)
  })
})
```

Add `trailingForm` and `TRAILING_FORM_MIN_BOARDS` to the test file's imports.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/lib/insights-personal.test.ts
```

Expected: FAIL — `trailingForm is not a function`.

- [ ] **Step 3: Implement**

```ts
/** How many of their most recent boards the comparison covers. */
export const TRAILING_FORM_WINDOW = 30

/**
 * The floor below which there is no comparison to make.
 *
 * AT EXACTLY TRAILING_FORM_WINDOW THE WINDOW IS THE LIFETIME and the delta is
 * necessarily zero — a comparison of a set against itself, dressed up as a
 * result. Forty leaves at least ten boards outside the window, so the figure is
 * measured against something.
 */
export const TRAILING_FORM_MIN_BOARDS = 40

export type TrailingForm = {
  /** Mean attempts across their whole history. */
  lifetime: number
  /** Mean attempts across the last TRAILING_FORM_WINDOW boards. */
  recent: number
  /** lifetime - recent. POSITIVE MEANS IMPROVING, because lower is better. */
  delta: number
  /** Whether no earlier window of the same size was better. */
  isBest: boolean
}

/**
 * Their recent form against their own record.
 *
 * THIS REPLACED A COMPARISON AGAINST THE BENCHMARK, which cannot be built: the
 * corpus holds opener ranks and per-day difficulty percentiles and no attempt
 * averages at all, so there is no "par" to be better than. See the spec's §3.
 * Comparing a player against themselves needs no corpus, is available to every
 * player on any tier, and answers the more motivating question anyway.
 *
 * SORTED BY PUZZLE DAY, NOT TAKEN FROM ARRAY ORDER. The query's order is not
 * part of its contract, and "recent" is a claim about the calendar.
 */
export function trailingForm(boards: PersonalBoard[]): TrailingForm | null {
  if (boards.length < TRAILING_FORM_MIN_BOARDS) return null

  const attempts = [...boards]
    .sort((a, b) => a.puzzleDay.localeCompare(b.puzzleDay))
    .map((board) => attemptsFor(board.guesses, board.answer ?? ''))

  const mean = (slice: number[]) => slice.reduce((total, n) => total + n, 0) / slice.length

  const lifetime = mean(attempts)
  const recent = mean(attempts.slice(-TRAILING_FORM_WINDOW))

  // Every window of the same size, so "best stretch yet" is a measured claim
  // rather than a flattering one. <= because the final window is itself one of
  // the candidates and must not disqualify itself.
  let isBest = true
  for (let start = 0; start + TRAILING_FORM_WINDOW <= attempts.length; start++) {
    const window = mean(attempts.slice(start, start + TRAILING_FORM_WINDOW))
    if (window < recent) {
      isBest = false
      break
    }
  }

  return {
    lifetime: round1(lifetime),
    recent: round1(recent),
    delta: round1(lifetime - recent),
    isBest,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:once src/lib/insights-personal.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights-personal.ts src/lib/insights-personal.test.ts
git commit -m "feat(insights): trailing form, replacing a comparison that cannot exist

The hero's first draft compared the player to a benchmark average. Inspecting
both corpus artifacts shows no such figure: openers hold a ranked word list,
difficulty holds a per-day percentile, and neither holds attempt averages.

Comparing a player against their own record needs no corpus, works on any tier,
and answers the better question. Floor is 40 rather than the 30-board window
because at exactly 30 the window IS the lifetime and the delta is always zero."
```

---

## Task 4: `openerAdvice`

**Files:**
- Modify: `src/lib/insights-personal.ts`
- Test: `src/lib/insights-personal.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('openerAdvice', () => {
  const rows = (...specs: [string, number, number][]) =>
    specs.map(([word, count, meanAttempts]) => ({ word, count, meanAttempts, rank: 1 }))

  test('it names the saving between their two most-used openers', () => {
    const advice = openerAdvice(rows(['MUSIC', 41, 4.6], ['CRANE', 28, 3.9]))
    expect(advice).toEqual({ from: 'MUSIC', to: 'CRANE', savingPerDay: 0.7 })
  })

  test('no advice when their most-used opener is already the better one', () => {
    expect(openerAdvice(rows(['CRANE', 41, 3.9], ['MUSIC', 28, 4.6]))).toBeNull()
  })

  test('no advice from a barely-used alternative', () => {
    expect(openerAdvice(rows(['MUSIC', 41, 4.6], ['CRANE', 2, 3.0]))).toBeNull()
  })

  test('no advice without two openers to compare', () => {
    expect(openerAdvice(rows(['MUSIC', 41, 4.6]))).toBeNull()
    expect(openerAdvice([])).toBeNull()
  })
})
```

Add `openerAdvice` to the test file's imports.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/lib/insights-personal.test.ts
```

Expected: FAIL — `openerAdvice is not a function`.

- [ ] **Step 3: Implement**

```ts
/**
 * Uses required of the alternative before it is worth recommending.
 *
 * A GUARD, NOT A FEATURE FLOOR. The spec pins two sample-size floors and this is
 * neither; it exists because "switch to CRANE" drawn from two lucky boards is
 * advice this page should not give. Five is the same figure MIN_BOARDS_FOR_STATS
 * uses for the same reason at a different scale.
 */
const MIN_OPENER_USES_FOR_ADVICE = 5

export type OpenerAdvice = {
  /** Their most-used opener. */
  from: string
  /** The one to switch to. */
  to: string
  /** Mean attempts saved per board, to one decimal. Always positive. */
  savingPerDay: number
}

/**
 * The conclusion the headline sentence stops short of.
 *
 * headlineComparison states two averages and leaves the player to do the
 * subtraction; the subtraction is the part worth paying for. This does it.
 *
 * IT REUSES headlineComparison'S PAIR rather than picking the player's globally
 * best opener, and that is deliberate — that function's comment records the
 * reason: the comparison is about their HABITS, so it is their two most-used
 * openers, not their best one they have tried twice.
 */
export function openerAdvice(rows: OpenerRow[]): OpenerAdvice | null {
  const pair = headlineComparison(rows)
  if (pair === null) return null

  const { most, other } = pair
  if (other.count < MIN_OPENER_USES_FOR_ADVICE) return null

  const saving = round1(most.meanAttempts - other.meanAttempts)
  // Not >= 0: a saving that rounds to 0.0 is not a saving, and "would save you
  // about 0 guesses a day" is a sentence no product should print.
  if (saving <= 0) return null

  return { from: most.word, to: other.word, savingPerDay: saving }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:once src/lib/insights-personal.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights-personal.ts src/lib/insights-personal.test.ts
git commit -m "feat(insights): openerAdvice does the subtraction the headline leaves

'You average 4.6 with MUSIC and 3.9 with CRANE' makes the player work out that
switching saves 0.7 a day. That arithmetic is the part worth paying for.

Reuses headlineComparison's pair rather than the globally best opener, per that
function's own reasoning: the sentence is about habits. Guarded so a two-board
alternative cannot generate a recommendation."
```

---

## Task 5: `trendWindow`

**Files:**
- Modify: `src/lib/insights-personal.ts`
- Test: `src/lib/insights-personal.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('trendWindow', () => {
  const months = (...specs: [string, number, number][]): MonthRow[] =>
    specs.map(([month, boards, meanAttempts]) => ({
      month: month as MonthRow['month'],
      boards,
      meanAttempts,
    }))

  test('it keeps only the most recent TREND_MONTHS, oldest first', () => {
    const rows = Array.from({ length: 20 }, (_, i): [string, number, number] => [
      `2025-${String((i % 12) + 1).padStart(2, '0')}`,
      10,
      4,
    ]).map(([m], i): [string, number, number] => [`20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, 10, 4])
    const trend = trendWindow(months(...rows))
    expect(trend.months).toHaveLength(TREND_MONTHS)
    expect(trend.months[0].month).toBe(rows[rows.length - TREND_MONTHS][0])
  })

  test('a short history is returned whole', () => {
    const trend = trendWindow(months(['2026-07', 10, 4.5], ['2026-08', 10, 4.2]))
    expect(trend.months).toHaveLength(2)
  })

  test('best is the lowest mean across ALL history, not only the window', () => {
    const rows = Array.from({ length: 14 }, (_, i): [string, number, number] => [
      `2025-${String(i + 1).padStart(2, '0')}`,
      10,
      i === 0 ? 3.1 : 4.5,
    ])
    const trend = trendWindow(months(...rows))
    expect(trend.best!.meanAttempts).toBe(3.1)
    expect(trend.months.some((m) => m.meanAttempts === 3.1)).toBe(false)
    expect(trend.latestIsBest).toBe(false)
  })

  test('latestIsBest when the most recent month is the best one', () => {
    const trend = trendWindow(months(['2026-07', 10, 4.5], ['2026-08', 10, 4.0]))
    expect(trend.latestIsBest).toBe(true)
    expect(trend.best!.month).toBe('2026-08')
  })

  test('no months means no best, rather than a crash', () => {
    const trend = trendWindow([])
    expect(trend.months).toEqual([])
    expect(trend.best).toBeNull()
    expect(trend.latestIsBest).toBe(false)
  })
})
```

Add `trendWindow`, `TREND_MONTHS` and `type MonthRow` to the test file's imports.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/lib/insights-personal.test.ts
```

Expected: FAIL — `trendWindow is not a function`.

- [ ] **Step 3: Implement**

```ts
/**
 * How many months the trend draws.
 *
 * A BOUND, NOT A PREFERENCE. attemptsByMonth grows for as long as the player
 * plays; a two-year history is 24 bars, which on a 358px phone is about 11px
 * each. Twelve is a year, which is the comparison a reader actually wants.
 */
export const TREND_MONTHS = 12

export type Trend = {
  /** The last TREND_MONTHS rows, oldest first. */
  months: MonthRow[]
  /** The best month across their WHOLE history, which may predate the window. */
  best: MonthRow | null
  /** Whether their most recent month is that best one. */
  latestIsBest: boolean
}

/**
 * The drawable slice of attemptsByMonth, plus the one fact worth captioning.
 *
 * `best` IS OVER ALL HISTORY, NOT OVER THE WINDOW, so a caption reading "your
 * best month yet" is true rather than true-of-the-last-twelve. The caller needs
 * `latestIsBest` to know which caption it has earned.
 *
 * TIES GO TO THE MOST RECENT. Two equally good months should congratulate the
 * one they just finished.
 */
export function trendWindow(rows: MonthRow[], limit = TREND_MONTHS): Trend {
  const months = rows.slice(-limit)

  let best: MonthRow | null = null
  for (const row of rows) {
    if (best === null || row.meanAttempts <= best.meanAttempts) best = row
  }

  const latest = rows[rows.length - 1]
  return {
    months,
    best,
    latestIsBest: best !== null && latest !== undefined && best.month === latest.month,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:once src/lib/insights-personal.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights-personal.ts src/lib/insights-personal.test.ts
git commit -m "feat(insights): trendWindow bounds the month list at a year

attemptsByMonth grows for as long as the player plays. Twenty-four bars on a
358px phone is 11px each, and the count has no ceiling.

best is computed over ALL history rather than the drawn window, so a caption
saying 'your best month yet' is true rather than true-of-the-last-twelve."
```

---

## Task 6: `difficultySplit`

**Files:**
- Modify: `src/lib/insights-personal.ts`
- Test: `src/lib/insights-personal.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('difficultySplit', () => {
  // firstDay 2026-01-01, so index n is 2026-01-(n+1). Percentiles alternate so
  // the first 20 days give 10 hard (>=65) and 10 easy.
  const difficulty = {
    release: 'current',
    snapshotId: 'test',
    attribution: 'x',
    licence: 'CC BY 4.0',
    licenceUrl: 'x',
    citation: 'x',
    firstDay: '2026-01-01' as PersonalBoard['puzzleDay'],
    count: 20,
    percentiles: Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 90 : 10)),
  }

  const onDay = (index: number, attempts: number) =>
    board(`2026-01-${String(index + 1).padStart(2, '0')}`, 'CRANE', attempts)

  test('it splits on the corpus own band boundary and reports both means', () => {
    const boards = Array.from({ length: 20 }, (_, i) => onDay(i, i % 2 === 0 ? 5 : 3))
    const split = difficultySplit(boards, difficulty)
    expect(split.kind).toBe('ready')
    if (split.kind !== 'ready') throw new Error('unreachable')
    expect(split.hard).toBe(5)
    expect(split.rest).toBe(3)
    expect(split.hardBoards).toBe(10)
    expect(split.restBoards).toBe(10)
  })

  test('it withholds, with counts, when a band is short', () => {
    const boards = [onDay(0, 5), onDay(1, 3), onDay(3, 3)]
    const split = difficultySplit(boards, difficulty)
    expect(split).toEqual({ kind: 'thin', hardBoards: 1, restBoards: 2 })
  })

  test('a day the artifact does not cover is excluded from both bands', () => {
    const boards = [...Array.from({ length: 20 }, (_, i) => onDay(i, 4)), board('2030-01-01', 'CRANE', 6)]
    const split = difficultySplit(boards, difficulty)
    if (split.kind !== 'ready') throw new Error('unreachable')
    expect(split.hardBoards + split.restBoards).toBe(20)
  })

  test('percentile 65 exactly is hard, matching difficultyLabel bands', () => {
    const atBoundary = { ...difficulty, count: 1, percentiles: [65] }
    const split = difficultySplit([onDay(0, 4)], atBoundary)
    expect(split).toEqual({ kind: 'thin', hardBoards: 1, restBoards: 0 })
  })
})
```

Add `difficultySplit` and `HARD_DAY_PERCENTILE` to the test file's imports.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/lib/insights-personal.test.ts
```

Expected: FAIL — `difficultySplit is not a function`.

- [ ] **Step 3: Implement**

First extend the imports at the top of `src/lib/insights-personal.ts`:

```ts
import {
  dayDifficulty,
  openerRank,
  type DifficultyBenchmark,
  type OpenerBenchmark,
} from './insights-benchmark.ts'
```

Then append:

```ts
/**
 * Where "hard" starts.
 *
 * THE CORPUS'S OWN BOUNDARY, NOT ONE INVENTED HERE. difficultyLabel puts
 * "Tricky" at 65-89 and "Hard for the solver" above 89, so >= 65 is exactly
 * "the two harder bands" and this page cannot drift from the label the day-by-
 * day list prints beside it.
 */
export const HARD_DAY_PERCENTILE = 65

/** Boards required in EACH band before the split is stable enough to print. */
export const MIN_BOARDS_PER_BAND = 10

export type DifficultySplitResult =
  | { kind: 'ready'; hard: number; rest: number; hardBoards: number; restBoards: number }
  | { kind: 'thin'; hardBoards: number; restBoards: number }

/**
 * How they score when the world found the day hard, against every other day.
 *
 * THE ONE INSIGHT HERE THAT ONLY THE CORPUS CAN PRODUCE. Everything else on this
 * page compares the player against themselves or their team; this compares their
 * result against how hard the puzzle actually was for everybody.
 *
 * A DAY THE ARTIFACT DOES NOT COVER IS EXCLUDED FROM BOTH BANDS, never defaulted
 * into one. That is the common case rather than an edge case — today is always
 * outside the range, and so is every day since the corpus was last refreshed —
 * and defaulting would quietly load one band with unrated days.
 *
 * RETURNS COUNTS EVEN WHEN IT WITHHOLDS, because the caller renders an unlock
 * prompt that has to say how far away the insight is.
 */
export function difficultySplit(
  boards: PersonalBoard[],
  difficulty: DifficultyBenchmark,
): DifficultySplitResult {
  const hard: number[] = []
  const rest: number[] = []

  for (const board of boards) {
    const rated = dayDifficulty(difficulty, board.puzzleDay)
    if (rated === null) continue
    const attempts = attemptsFor(board.guesses, board.answer ?? '')
    ;(rated.percentile >= HARD_DAY_PERCENTILE ? hard : rest).push(attempts)
  }

  if (hard.length < MIN_BOARDS_PER_BAND || rest.length < MIN_BOARDS_PER_BAND) {
    return { kind: 'thin', hardBoards: hard.length, restBoards: rest.length }
  }

  const mean = (slice: number[]) => round1(slice.reduce((t, n) => t + n, 0) / slice.length)
  return {
    kind: 'ready',
    hard: mean(hard),
    rest: mean(rest),
    hardBoards: hard.length,
    restBoards: rest.length,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:once src/lib/insights-personal.test.ts && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights-personal.ts src/lib/insights-personal.test.ts
git commit -m "feat(insights): difficultySplit, the one insight only the corpus can give

Everything else on this page compares a player against themselves or their
team. This compares their result against how hard the day actually was.

The threshold reuses difficultyLabel's own boundary (>=65 is Tricky + Hard)
rather than inventing one, so it cannot drift from the label printed beside it
in the day-by-day list. Unrated days are excluded from both bands, never
defaulted into one -- today is always unrated, so that is the common case."
```

---

## Task 7: `UnlockPrompt`

**Files:**
- Create: `src/components/insights/unlock-prompt.tsx`
- Test: `src/components/insights/unlock-prompt.hook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/insights/unlock-prompt.hook.test.ts`:

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { UnlockPrompt } from './unlock-prompt.tsx'

afterEach(cleanup)

describe('UnlockPrompt', () => {
  const props = {
    what: 'Your form trend',
    need: 40,
    have: 12,
    unit: 'boards',
    value: 'how your last 30 boards compare with your all-time average',
    testId: 'insights-unlock-form',
  }

  test('it names what unlocks, what it gives, and how far away it is', () => {
    render(createElement(UnlockPrompt, props))
    const node = screen.getByTestId('insights-unlock-form')
    expect(node.textContent).toContain('Your form trend unlocks at 40 boards')
    expect(node.textContent).toContain('how your last 30 boards compare')
    expect(node.textContent).toContain('12 / 40')
  })

  test('it exposes progress to assistive tech as a real progressbar', () => {
    render(createElement(UnlockPrompt, props))
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('12')
    expect(bar.getAttribute('aria-valuemax')).toBe('40')
  })

  test('progress never exceeds full, even if have overshoots need', () => {
    render(createElement(UnlockPrompt, { ...props, have: 99 }))
    expect(screen.getByTestId('insights-unlock-form-fill').style.width).toBe('100%')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/components/insights/unlock-prompt.hook.test.ts
```

Expected: FAIL — cannot resolve `./unlock-prompt.tsx`.

- [ ] **Step 3: Implement**

Create `src/components/insights/unlock-prompt.tsx`:

```tsx
/**
 * An unmet sample-size floor, rendered as an invitation rather than a blank.
 *
 * THE OWNER'S CALL, 2026-09-15: a player should know that more is coming, what
 * specifically it is, and how close they are — so the floor reads as a reason to
 * keep entering boards instead of a silent absence. Generalised rather than
 * invented: the thin-history message already named what was coming; what it
 * lacked was the distance.
 *
 * DELIBERATELY NOT ACCENT-COLOURED, and this is the load-bearing detail. The
 * upsell asks for money and carries the accent; this asks for play. Green is
 * reserved for what the player has ACHIEVED — the modal distribution row, the
 * best month, a winning head-to-head. A prompt for something they have not
 * earned yet must not wear the same colour as something they have.
 *
 * NOTHING UNREACHABLE GETS ONE. Every floor this renders for is reachable by
 * playing. Tier, team membership and corpus coverage have their own states: the
 * upsell, the no-team card, and "not rated yet" respectively.
 */
export function UnlockPrompt({
  what,
  need,
  have,
  unit,
  value,
  testId,
}: {
  /** What unlocks, named concretely. Never "more insights". */
  what: string
  need: number
  have: number
  /** Pluralised by the caller — "boards", "hard days". */
  unit: string
  /** One clause of actual value, no leading capital. */
  value: string
  testId: string
}) {
  // Clamped because a caller may hold a count past the floor for a render or two
  // while another condition gates the insight, and a bar wider than its track
  // would overflow the card.
  const pct = Math.min(100, Math.round((have / need) * 100))

  return (
    <div className="text-muted-foreground space-y-2 text-sm" data-testid={testId}>
      <p>
        <span className="text-foreground font-medium">
          {what} unlocks at {need} {unit}
        </span>{' '}
        — {value}.
      </p>
      <div className="flex items-center gap-2">
        <div
          className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={have}
          aria-valuemin={0}
          aria-valuemax={need}
          aria-label={`${what} progress`}
        >
          <div
            className="bg-muted-foreground h-full rounded-full motion-safe:transition-[width]"
            style={{ width: `${pct}%` }}
            data-testid={`${testId}-fill`}
          />
        </div>
        <span className="text-xs tabular-nums">
          {have} / {need}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:once src/components/insights/unlock-prompt.hook.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/insights/unlock-prompt.tsx src/components/insights/unlock-prompt.hook.test.ts
git commit -m "feat(insights): an unmet floor is an invitation, not a blank

Says what unlocks, what it will tell them, and how far away it is, with a real
progressbar role so the distance reaches assistive tech too.

Deliberately not accent-coloured: the upsell asks for money, this asks for
play, and green stays reserved for what the player has actually achieved."
```

---

## Task 8: `MiniBoard` and `WordTiles`

**Files:**
- Create: `src/components/insights/mini-board.tsx`
- Test: `src/components/insights/mini-board.hook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/insights/mini-board.hook.test.ts`:

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { MiniBoard, WordTiles } from './mini-board.tsx'

afterEach(cleanup)

describe('MiniBoard', () => {
  test('it colours tiles from the real answer', () => {
    render(
      createElement(MiniBoard, {
        guesses: ['CRANE'],
        answer: 'CRAZY',
        testId: 'board',
      }),
    )
    const tiles = screen.getByTestId('board').querySelectorAll('span')
    expect(tiles).toHaveLength(5)
    expect(tiles[0].className).toContain('bg-wordle-correct')
    expect(tiles[4].className).toContain('bg-wordle-absent')
  })

  test('the grid is hidden from assistive tech, which reads the score instead', () => {
    render(createElement(MiniBoard, { guesses: ['CRANE'], answer: 'CRAZY', testId: 'board' }))
    expect(screen.getByTestId('board').getAttribute('aria-hidden')).toBe('true')
  })

  test("v1's empty-string sentinel on a failed board renders no row", () => {
    render(
      createElement(MiniBoard, {
        guesses: ['CRANE', 'MOIST', ''],
        answer: 'CRAZY',
        testId: 'board',
      }),
    )
    expect(screen.getByTestId('board').querySelectorAll('span')).toHaveLength(10)
  })

  test('without an answer it renders neutral tiles rather than guessing colours', () => {
    render(createElement(MiniBoard, { guesses: ['CRANE'], testId: 'board' }))
    const tiles = screen.getByTestId('board').querySelectorAll('span')
    expect(tiles[0].className).not.toContain('bg-wordle-correct')
  })
})

describe('WordTiles', () => {
  test('it renders the letters uncoloured, because one opener has many results', () => {
    render(createElement(WordTiles, { word: 'CRANE', testId: 'word' }))
    const tiles = screen.getByTestId('word').querySelectorAll('span')
    expect(tiles).toHaveLength(5)
    expect(tiles[0].textContent).toBe('C')
    expect(tiles[0].className).not.toContain('bg-wordle-correct')
    expect(tiles[0].className).not.toContain('bg-wordle-present')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/components/insights/mini-board.hook.test.ts
```

Expected: FAIL — cannot resolve `./mini-board.tsx`.

- [ ] **Step 3: Implement**

Create `src/components/insights/mini-board.tsx`:

```tsx
import { tileStates, type TileState } from '#/lib/wordle.ts'
import { cn } from '#/lib/utils.ts'

/**
 * The signature component, at list scale.
 *
 * DESIGN PRINCIPLE #5 IS "THE BOARD IS THE SIGNATURE", and until now the page
 * about board performance rendered no tiles at all. Square corners, no radius —
 * the sharp corner is the game's visual mark and rounding it is the one thing
 * DESIGN_SYSTEM.md §6 says not to do.
 *
 * aria-hidden BECAUSE A SCREEN READER DOES NOT WANT THIS. Fifteen to thirty
 * tiles read one colour at a time is noise; the score ("3/6") sits beside it as
 * real text and carries the information.
 */
const FILL: Record<TileState, string> = {
  correct: 'bg-wordle-correct',
  present: 'bg-wordle-present',
  absent: 'bg-wordle-absent',
  empty: 'border-wordle-tile-border border bg-transparent',
}

export function MiniBoard({
  guesses,
  answer,
  testId,
}: {
  guesses: string[]
  /** Optional on dailyScores, so its absence is ordinary rather than an error. */
  answer?: string
  testId?: string
}) {
  /*
    THE EMPTY-STRING SENTINEL IS REAL DATA, NOT DEFENSIVENESS. v1 appended a ''
    to a failed six-guess board, and those rows were copied into v2. Rendering
    one would draw a row of five blank tiles under a completed board.
  */
  const rows = guesses.filter((guess) => guess.length > 0)

  return (
    <div
      className="grid w-fit grid-cols-5 gap-[2px]"
      aria-hidden="true"
      data-testid={testId}
    >
      {rows.map((guess, row) =>
        // Without an answer there is nothing to colour against, and inventing a
        // colouring would assert a result. Neutral tiles state nothing.
        (answer ? tileStates(answer, guess) : guess.split('').map(() => 'empty' as TileState)).map(
          (state, column) => (
            <span
              key={`${row}-${column}`}
              className={cn('size-[11px] md:size-[13px]', FILL[state])}
            />
          ),
        ),
      )}
    </div>
  )
}

/**
 * A word in the board's typography, asserting no result.
 *
 * UNCOLOURED ON PURPOSE, and this is the whole point of the component existing
 * separately from MiniBoard. An opener used 41 times has 41 different
 * colourings, so there is no correct one to show. Colouring by, say, hit rate
 * would give green and yellow a second meaning, and in this product they mean
 * exactly one thing. The tiles carry the shape; the numbers beside them carry
 * the result.
 */
export function WordTiles({ word, testId }: { word: string; testId?: string }) {
  return (
    <div className="flex w-fit gap-[2px]" data-testid={testId}>
      {word.split('').map((letter, index) => (
        <span
          key={index}
          className="border-wordle-tile-border text-foreground flex size-[19px] items-center justify-center border text-[11px] font-bold"
        >
          {letter}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:once src/components/insights/mini-board.hook.test.ts && pnpm typecheck
```

Expected: PASS. If `cn` is not at `#/lib/utils.ts`, find it with `grep -rn "export function cn" src/lib/` and correct the import.

- [ ] **Step 5: Commit**

```bash
git add src/components/insights/mini-board.tsx src/components/insights/mini-board.hook.test.ts
git commit -m "feat(insights): the board comes back to the page about boards

Design principle #5 is 'the board is the signature' and the insights page
rendered no tiles at all. Square corners, no radius, per DESIGN_SYSTEM.md 6.

WordTiles is separate and uncoloured on purpose: an opener used 41 times has 41
colourings, so there is no correct one, and a hit-rate colouring would give
green and yellow a second meaning they do not have in this product.

Filters v1's empty-string sentinel, which would otherwise draw a blank row
under every failed board copied from v1."
```

---

## Task 9: `AttemptDistribution`

**Files:**
- Create: `src/components/insights/attempt-distribution.tsx`
- Test: `src/components/insights/attempt-distribution.hook.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { AttemptDistribution } from './attempt-distribution.tsx'

afterEach(cleanup)

const rows = [
  { label: '1' as const, count: 0, isModal: false },
  { label: '2' as const, count: 7, isModal: false },
  { label: '3' as const, count: 62, isModal: false },
  { label: '4' as const, count: 104, isModal: true },
  { label: '5' as const, count: 81, isModal: false },
  { label: '6' as const, count: 46, isModal: false },
  { label: 'X' as const, count: 7, isModal: false },
]

describe('AttemptDistribution', () => {
  test('it is a list, so a screen reader gets the numbers rather than a shrug', () => {
    render(createElement(AttemptDistribution, { rows }))
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })

  test('every row renders, including the empty one', () => {
    render(createElement(AttemptDistribution, { rows }))
    expect(screen.getByTestId('insights-distribution-1').textContent).toContain('0')
  })

  test('only the modal row takes the accent', () => {
    render(createElement(AttemptDistribution, { rows }))
    expect(screen.getByTestId('insights-distribution-4-fill').className).toContain('bg-accent-solid')
    expect(screen.getByTestId('insights-distribution-3-fill').className).toContain('bg-muted')
  })

  test('bars are scaled against the largest row, not the total', () => {
    render(createElement(AttemptDistribution, { rows }))
    expect(screen.getByTestId('insights-distribution-4-fill').style.width).toBe('100%')
    expect(screen.getByTestId('insights-distribution-2-fill').style.width).toBe('7%')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/components/insights/attempt-distribution.hook.test.ts
```

Expected: FAIL — cannot resolve `./attempt-distribution.tsx`.

- [ ] **Step 3: Implement**

```tsx
import { cn } from '#/lib/utils.ts'
import type { DistributionRow } from '#/lib/insights-personal.ts'

/**
 * The statistic every Wordle player already knows how to read.
 *
 * A LIST, NOT A CHART. Each row is a real `li` carrying its label and its count
 * as text, so a screen reader gets the distribution rather than a decorative
 * div. The bars are presentation on top of that, not a replacement for it.
 *
 * SCALED AGAINST THE LARGEST ROW, NOT THE TOTAL. Against the total, a player
 * with an even spread gets seven stubs and the shape disappears; the question a
 * distribution answers is which outcome is most common, which is a comparison
 * between rows.
 *
 * COLOUR IS NEVER THE ONLY CARRIER. The modal row is also the longest bar and
 * its count is the emphasised one, so the accent is reinforcement.
 */
export function AttemptDistribution({ rows }: { rows: DistributionRow[] }) {
  const max = Math.max(...rows.map((row) => row.count), 1)

  return (
    <div>
      <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
        Distribution
      </h3>
      <ul className="space-y-1" data-testid="insights-distribution">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-center gap-2"
            data-testid={`insights-distribution-${row.label}`}
          >
            <span
              className={cn(
                'w-2 text-xs font-semibold',
                row.label === 'X' && 'text-muted-foreground',
              )}
            >
              {row.label}
            </span>
            <div className="flex-1">
              <div
                className={cn(
                  'h-3.5 rounded-sm motion-safe:transition-[width]',
                  row.isModal ? 'bg-accent-solid' : 'bg-muted',
                )}
                style={{ width: `${Math.round((row.count / max) * 100)}%` }}
                data-testid={`insights-distribution-${row.label}-fill`}
              />
            </div>
            <span
              className={cn(
                'w-8 text-right text-xs tabular-nums',
                row.isModal ? 'text-foreground font-semibold' : 'text-muted-foreground',
              )}
            >
              {row.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:once src/components/insights/attempt-distribution.hook.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/insights/attempt-distribution.tsx src/components/insights/attempt-distribution.hook.test.ts
git commit -m "feat(insights): the distribution bars

A real list, so assistive tech gets the numbers rather than a decorative div.
Scaled against the largest row rather than the total -- against the total an
even spread collapses to seven stubs and the shape disappears.

The accent is reinforcement, never the only carrier: the modal row is also the
longest bar and the only emphasised count."
```

---

## Task 10: The hero, `PersonalSummary`

Replaces `PersonalHistory`'s six-cell `<dl>` and the `Stat` helper.

**Files:**
- Create: `src/components/insights/personal-summary.tsx`
- Test: `src/components/insights/personal-summary.hook.test.ts`
- Modify: `src/routes/insights.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { PersonalSummary } from './personal-summary.tsx'
import { TRAILING_FORM_MIN_BOARDS, type PersonalBoard } from '#/lib/insights-personal.ts'

afterEach(cleanup)

const run = (n: number, attempts: number, from = 0): PersonalBoard[] =>
  Array.from({ length: n }, (_, i) => ({
    puzzleDay: `2026-01-${String(from + i + 1).padStart(2, '0')}`,
    answer: 'SPEED',
    guesses: ['CRANE', ...Array.from({ length: attempts - 2 }, () => 'MOIST'), 'SPEED'].slice(
      0,
      attempts,
    ),
  })) as PersonalBoard[]

describe('PersonalSummary', () => {
  test('the lead figure renders at display size with tabular numerals', () => {
    render(createElement(PersonalSummary, { boards: run(10, 4) }))
    const lead = screen.getByTestId('insights-lead-figure')
    expect(lead.textContent).toBe('4')
    expect(lead.className).toContain('tabular-nums')
  })

  test('below the floor it prompts rather than comparing the window with itself', () => {
    render(createElement(PersonalSummary, { boards: run(10, 4) }))
    expect(screen.getByTestId('insights-unlock-form').textContent).toContain(
      `unlocks at ${TRAILING_FORM_MIN_BOARDS} boards`,
    )
    expect(screen.queryByTestId('insights-trailing-form')).toBeNull()
  })

  test('at the floor it compares, and never scolds a worse stretch in red', () => {
    render(createElement(PersonalSummary, { boards: [...run(30, 3), ...run(20, 5, 30)] }))
    const form = screen.getByTestId('insights-trailing-form')
    expect(form.className).not.toContain('text-destructive')
    expect(screen.queryByTestId('insights-unlock-form')).toBeNull()
  })

  test('it keeps the insights-consistency testid on the supporting stats', () => {
    render(createElement(PersonalSummary, { boards: run(10, 4) }))
    expect(screen.getByTestId('insights-consistency')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/components/insights/personal-summary.hook.test.ts
```

Expected: FAIL — cannot resolve `./personal-summary.tsx`.

- [ ] **Step 3: Implement**

```tsx
import { Card, CardContent } from '#/components/ui/card.tsx'
import {
  TRAILING_FORM_MIN_BOARDS,
  TRAILING_FORM_WINDOW,
  attemptDistribution,
  consistency,
  streaks,
  trailingForm,
  type PersonalBoard,
} from '#/lib/insights-personal.ts'
import { AttemptDistribution } from './attempt-distribution.tsx'
import { UnlockPrompt } from './unlock-prompt.tsx'

/**
 * The hero, and the page's answer to "what am I looking at".
 *
 * IT OPENS WITH A NUMBER RATHER THAN A PARAGRAPH. What shipped before was six
 * equally weighted cells in a two-column dl at text-sm — every figure on a
 * statistics page rendered at the same size as the label beside it, which is
 * why the page did not read as a statistics product.
 *
 * THE COMPARISON IS THE POINT, NOT THE FIGURE. A mean of 4.32 means nothing on
 * its own. It compares against the player's OWN record because the corpus holds
 * no attempt averages to compare against — see the spec's §3 and trailingForm's
 * comment.
 */
export function PersonalSummary({ boards }: { boards: PersonalBoard[] }) {
  const spread = consistency(boards)
  const runs = streaks(boards)
  const form = trailingForm(boards)
  const distribution = attemptDistribution(boards)
  const solvedRate = Math.round((spread.solved / Math.max(spread.solved + spread.failed, 1)) * 100)

  return (
    /* `insights-summary`, NOT `insights-personal`. PersonalHistory still owns
       that id at this stage and the two render SIDE BY SIDE, so reusing it
       would give getByTestId two matches and throw in the existing tests
       rather than fail informatively. Task 16 hands `insights-personal` over
       to this card once PersonalHistory is deleted. */
    <Card data-testid="insights-summary">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
          <div className="md:shrink-0">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Average guesses
            </h3>
            <p
              className="text-4xl leading-none font-bold tracking-tight tabular-nums md:text-5xl"
              data-testid="insights-lead-figure"
            >
              {spread.meanAttempts}
            </p>
          </div>

          <div className="md:flex-1">
            {form ? (
              /* NEVER text-destructive ON A WORSE STRETCH. A page someone pays
                 for should not scold them for a bad fortnight; the neutral
                 treatment states the fact without the judgement. */
              <p className="text-sm" data-testid="insights-trailing-form">
                <span className={form.delta > 0 ? 'text-accent-solid font-semibold' : 'font-semibold'}>
                  {form.delta > 0 ? '▲' : form.delta < 0 ? '▼' : '—'}{' '}
                  {Math.abs(form.delta).toFixed(1)}
                </span>{' '}
                <span className="text-muted-foreground">
                  over your last {TRAILING_FORM_WINDOW} boards ({form.recent})
                  {form.isBest && ' — your best stretch yet'}
                </span>
              </p>
            ) : (
              <UnlockPrompt
                what="Your form trend"
                need={TRAILING_FORM_MIN_BOARDS}
                have={boards.length}
                unit="boards"
                value={`how your last ${TRAILING_FORM_WINDOW} boards compare with your all-time average`}
                testId="insights-unlock-form"
              />
            )}
          </div>
        </div>

        <AttemptDistribution rows={distribution} />

        {/* `insights-consistency` KEPT, AND ITS MEANING WITH IT: the four
            statistics that sit beside the mean. Solved and Missed are now one
            rate — two counts stated the same fact twice and neither at a
            glance. */}
        <dl
          className="grid grid-cols-2 gap-3 border-t pt-4 md:grid-cols-4"
          data-testid="insights-consistency"
        >
          <Stat label="Streak" value={String(runs.current)} />
          <Stat label="Best ever" value={String(runs.longest)} />
          <Stat label="Solved" value={`${solvedRate}%`} />
          <Stat label="Spread" value={`±${spread.spread}`} />
        </dl>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
```

- [ ] **Step 4: Wire it into the route**

In `src/routes/insights.tsx`:

1. Delete the `Stat` function entirely — `PersonalSummary` owns it now.
2. In `PersonalHistory`, delete the `<dl data-testid="insights-consistency">` block and the now-unused `const spread = consistency(boards)` and `const runs = streaks(boards)`.
3. In `InsightsPanel`, render the summary above the existing personal card:

```tsx
      {data.access.layer2 === 'full' && (
        <>
          {/* GATED ON isThin FOR THE REASON isThin EXISTS. Rendering the hero
              unconditionally puts a mean over two boards at 48px — the exact
              state MIN_BOARDS_FOR_STATS was introduced to prevent, and the one
              the spec calls "worse than empty: a product that has nothing to
              say rather than one waiting for data." */}
          {!isThin(data.boards) && <PersonalSummary boards={data.boards} />}
          <PersonalHistory benchmark={benchmark} boards={data.boards} />
        </>
      )}
```

4. Add the import and prune `consistency` / `streaks` from the `insights-personal` import list if nothing else in the file uses them.

- [ ] **Step 5: Verify**

```bash
pnpm test:once && pnpm typecheck && pnpm lint
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/insights/personal-summary.tsx src/components/insights/personal-summary.hook.test.ts src/routes/insights.tsx
git commit -m "feat(insights): the page opens with a number, not a paragraph

Six equally weighted cells in a two-column dl at text-sm becomes one figure at
display size, its comparison, the distribution, and four supporting stats.

Solved and Missed collapse into one rate: two counts stated the same fact twice
and neither at a glance. insights-consistency keeps its testid on the stats it
still describes.

A worse stretch is never rendered in text-destructive. A page someone pays for
should not scold them for a bad fortnight."
```

---

## Task 11: `OpenersPanel`

**Files:**
- Create: `src/components/insights/openers-panel.tsx`
- Test: `src/components/insights/openers-panel.hook.test.ts`
- Modify: `src/routes/insights.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { OpenersPanel } from './openers-panel.tsx'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import type { PersonalBoard } from '#/lib/insights-personal.ts'

afterEach(cleanup)

const benchmark: InsightsBenchmark = {
  openers: {
    release: 'v1',
    attribution: 'x',
    licence: 'CC BY 4.0',
    licenceUrl: 'x',
    citation: 'x',
    count: 3,
    words: 'cranemusicadieu',
  },
  difficulty: {
    release: 'current',
    snapshotId: 'test',
    attribution: 'x',
    licence: 'CC BY 4.0',
    licenceUrl: 'x',
    citation: 'x',
    firstDay: '2026-01-01',
    count: 4,
    percentiles: [90, 10, 90, 10],
  },
}

const board = (day: string, opener: string, n: number): PersonalBoard => ({
  puzzleDay: day as PersonalBoard['puzzleDay'],
  answer: 'SPEED',
  guesses: [opener, ...Array.from({ length: n - 2 }, () => 'MOIST'), 'SPEED'].slice(0, n),
})

const boards = [
  ...Array.from({ length: 8 }, (_, i) => board(`2026-01-0${(i % 4) + 1}`, 'MUSIC', 5)),
  ...Array.from({ length: 6 }, (_, i) => board(`2026-01-0${(i % 4) + 1}`, 'CRANE', 3)),
]

describe('OpenersPanel', () => {
  test('the advice closes the loop instead of leaving the subtraction to the reader', () => {
    render(createElement(OpenersPanel, { benchmark, boards }))
    expect(screen.getByTestId('insights-headline').textContent).toContain('save you about')
    expect(screen.getByTestId('insights-headline').textContent).toContain('CRANE')
  })

  test('opener tiles assert no result, because one opener has many', () => {
    render(createElement(OpenersPanel, { benchmark, boards }))
    const tiles = screen.getByTestId('insights-repertoire').querySelectorAll('span')
    expect([...tiles].some((t) => t.className.includes('bg-wordle-correct'))).toBe(false)
  })

  test('a short difficulty band prompts rather than printing an unstable split', () => {
    render(createElement(OpenersPanel, { benchmark, boards }))
    expect(screen.getByTestId('insights-unlock-difficulty')).toBeTruthy()
    expect(screen.queryByTestId('insights-difficulty-split')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/components/insights/openers-panel.hook.test.ts
```

Expected: FAIL — cannot resolve `./openers-panel.tsx`.

- [ ] **Step 3: Implement**

```tsx
import { Badge } from '#/components/ui/badge.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import {
  MIN_BOARDS_PER_BAND,
  difficultySplit,
  headlineComparison,
  openerAdvice,
  openerRepertoire,
  type PersonalBoard,
} from '#/lib/insights-personal.ts'
import { openerRankSentence } from '#/lib/insights-panel.ts'
import { WordTiles } from './mini-board.tsx'
import { UnlockPrompt } from './unlock-prompt.tsx'

/**
 * Their openers, and the two sentences this page exists to say.
 *
 * THE ADVICE CALLOUT CLOSES THE LOOP. What shipped stated two averages as body
 * text and left the player to do the subtraction. The subtraction is the part
 * worth paying for, so it is stated, and it is the only thing in this card that
 * carries the accent.
 *
 * THE DIFFICULTY LINE IS THE CORPUS'S ONE REAL CONTRIBUTION HERE. Everything
 * else compares the player against themselves; this compares their result
 * against how hard the day was for everybody.
 */
export function OpenersPanel({
  benchmark,
  boards,
}: {
  benchmark: InsightsBenchmark
  boards: PersonalBoard[]
}) {
  const repertoire = openerRepertoire(boards, benchmark.openers)
  const headline = headlineComparison(repertoire)
  const advice = openerAdvice(repertoire)
  const split = difficultySplit(boards, benchmark.difficulty)

  // Scaled against the worst mean so the bars compare openers with each other,
  // which is the question. Against a fixed 6 they would all look the same.
  const worst = Math.max(...repertoire.map((row) => row.meanAttempts), 1)

  return (
    <Card data-testid="insights-openers">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg md:text-xl">Your openers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {headline && (
          <div
            className="border-accent-solid bg-muted rounded-r-md border-l-[3px] px-3 py-2"
            data-testid="insights-headline"
          >
            <p>
              You average <span className="font-medium tabular-nums">{headline.most.meanAttempts}</span>{' '}
              with <span className="font-medium">{headline.most.word}</span> and{' '}
              <span className="font-medium tabular-nums">{headline.other.meanAttempts}</span> with{' '}
              <span className="font-medium">{headline.other.word}</span>.
            </p>
            {advice && (
              <p className="mt-1 font-semibold">
                Opening {advice.to} instead would save you about{' '}
                <span className="text-accent-solid tabular-nums">{advice.savingPerDay}</span> guesses a
                day.
              </p>
            )}
          </div>
        )}

        {split.kind === 'ready' ? (
          <p className="text-muted-foreground" data-testid="insights-difficulty-split">
            You average <span className="text-foreground font-medium tabular-nums">{split.hard}</span>{' '}
            on days the world found hard, and{' '}
            <span className="text-foreground font-medium tabular-nums">{split.rest}</span> on the
            rest.
          </p>
        ) : (
          <UnlockPrompt
            what="Your difficulty breakdown"
            need={MIN_BOARDS_PER_BAND}
            have={Math.min(split.hardBoards, split.restBoards)}
            unit={split.hardBoards <= split.restBoards ? 'hard days' : 'ordinary days'}
            value="how you score when the world struggles"
            testId="insights-unlock-difficulty"
          />
        )}

        <ul className="space-y-3" data-testid="insights-repertoire">
          {repertoire.slice(0, 8).map((row) => (
            <li key={row.word} className="space-y-1.5 md:flex md:items-center md:gap-3 md:space-y-0">
              <div className="flex items-center justify-between gap-2 md:contents">
                <WordTiles word={row.word} />
                <div className="flex items-center gap-2 md:order-3">
                  <Badge variant="secondary" className="tabular-nums">
                    {row.rank === null ? 'unranked' : `#${row.rank.toLocaleString()}`}
                  </Badge>
                  <span className="text-muted-foreground w-8 text-right text-xs tabular-nums">
                    {row.count}×
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 md:order-2 md:flex-1">
                <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-muted-foreground h-full rounded-full"
                    style={{ width: `${Math.round((row.meanAttempts / worst) * 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right font-medium tabular-nums">{row.meanAttempts}</span>
              </div>
              <span className="sr-only">
                {row.rank === null
                  ? `${row.word} is not in the benchmark set`
                  : openerRankSentence({ word: row.word, rank: row.rank, outOf: benchmark.openers.count })}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Wire it into the route**

In `src/routes/insights.tsx`, inside `InsightsPanel`, replace the `PersonalHistory` call with `OpenersPanel`, and delete `PersonalHistory`'s headline paragraph and `insights-repertoire` block. `PersonalHistory` now holds only the `insights-months` list — Task 12 removes it entirely.

```tsx
      {data.access.layer2 === 'full' && (
        <>
          <PersonalSummary boards={data.boards} />
          <OpenersPanel benchmark={benchmark} boards={data.boards} />
          <PersonalHistory benchmark={benchmark} boards={data.boards} />
        </>
      )}
```

- [ ] **Step 5: Verify**

```bash
pnpm test:once && pnpm typecheck && pnpm lint
```

Expected: all pass. `src/routes/-insights.hook.test.ts` asserts `insights-headline` and `insights-repertoire` exist — both are preserved above.

- [ ] **Step 6: Commit**

```bash
git add src/components/insights/openers-panel.tsx src/components/insights/openers-panel.hook.test.ts src/routes/insights.tsx
git commit -m "feat(insights): the openers card states its conclusion

The headline used to give two averages and leave the reader to subtract. It now
says what switching would save, and that sentence is the only accent in the
card.

Adds the difficulty line -- the one insight the corpus can produce that the
player cannot compute about themselves -- with an unlock prompt when either
band is short of MIN_BOARDS_PER_BAND.

Opener tiles are uncoloured, with the rank sentence kept in an sr-only span so
assistive tech still gets the wording it had before the badges."
```

---

## Task 12: `TrendPanel`

**Files:**
- Create: `src/components/insights/trend-panel.tsx`
- Test: `src/components/insights/trend-panel.hook.test.ts`
- Modify: `src/routes/insights.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { TrendPanel } from './trend-panel.tsx'
import { TREND_MONTHS, type PersonalBoard } from '#/lib/insights-personal.ts'

afterEach(cleanup)

const boardsOver = (months: number): PersonalBoard[] =>
  Array.from({ length: months }, (_, i) => ({
    puzzleDay: `20${25 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
    answer: 'SPEED',
    guesses: ['CRANE', 'MOIST', 'SPEED'],
  })) as PersonalBoard[]

describe('TrendPanel', () => {
  test('it never draws more than TREND_MONTHS bars', () => {
    render(createElement(TrendPanel, { boards: boardsOver(20) }))
    expect(screen.getAllByRole('listitem')).toHaveLength(TREND_MONTHS)
  })

  test('it states the direction, because a shorter bar being better is not obvious', () => {
    render(createElement(TrendPanel, { boards: boardsOver(3) }))
    expect(screen.getByTestId('insights-months').textContent).toContain('lower is better')
  })

  test('it keeps the insights-months testid', () => {
    render(createElement(TrendPanel, { boards: boardsOver(3) }))
    expect(screen.getByTestId('insights-months')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/components/insights/trend-panel.hook.test.ts
```

Expected: FAIL — cannot resolve `./trend-panel.tsx`.

- [ ] **Step 3: Implement**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { cn } from '#/lib/utils.ts'
import { formatMonthLabel } from '#/lib/format-day'
import { TREND_MONTHS, attemptsByMonth, trendWindow, type PersonalBoard } from '#/lib/insights-personal.ts'

/**
 * The same data attemptsByMonth always produced, drawn.
 *
 * "August 2026 — 28 boards · avg 4.2" repeated twelve times is a table of
 * numbers nobody reads for a trend. The shape is the information.
 *
 * THE DIRECTION IS STATED, because a bar chart where SHORTER is better is
 * ambiguous and no axis can disambiguate it on its own.
 *
 * BARS ARE SCALED FROM ZERO, not from the minimum. A scale that starts at the
 * best month exaggerates ordinary variation into a dramatic slope, which on a
 * page someone pays for is a lie of presentation.
 */
export function TrendPanel({ boards }: { boards: PersonalBoard[] }) {
  const trend = trendWindow(attemptsByMonth(boards), TREND_MONTHS)
  if (trend.months.length === 0) return null

  const worst = Math.max(...trend.months.map((row) => row.meanAttempts), 1)

  return (
    <Card data-testid="insights-trend">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-lg md:text-xl">Your trend</CardTitle>
          <span className="text-muted-foreground text-xs">
            last {Math.min(TREND_MONTHS, trend.months.length)} months
          </span>
        </div>
      </CardHeader>
      <CardContent data-testid="insights-months">
        <p className="text-muted-foreground mb-3 text-xs">avg guesses · lower is better</p>
        <ul className="flex h-20 items-end gap-1">
          {trend.months.map((row) => {
            const isLatest = row.month === trend.months[trend.months.length - 1].month
            return (
              <li key={row.month} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={cn(
                    'w-full rounded-t-sm',
                    isLatest && trend.latestIsBest ? 'bg-accent-solid' : 'bg-muted',
                  )}
                  style={{ height: `${Math.round((row.meanAttempts / worst) * 64)}px` }}
                />
                <span
                  className={cn(
                    'text-[9px]',
                    isLatest ? 'text-foreground font-semibold' : 'text-muted-foreground',
                  )}
                >
                  {/* An initial on a phone, where twelve short names cannot fit. */}
                  <span className="md:hidden">{formatMonthLabel(row.month).charAt(0)}</span>
                  <span className="hidden md:inline">
                    {formatMonthLabel(row.month).split(' ')[0].slice(0, 3)}
                  </span>
                </span>
                <span className="sr-only">
                  {formatMonthLabel(row.month)}: {row.boards} boards, average {row.meanAttempts}
                </span>
              </li>
            )
          })}
        </ul>
        {trend.best && (
          <p className="text-muted-foreground mt-3 border-t pt-2 text-sm">
            {trend.latestIsBest ? 'Your best month yet' : 'Your best month'} —{' '}
            <span className="text-foreground font-medium tabular-nums">
              {trend.best.meanAttempts}
            </span>{' '}
            across {trend.best.boards} boards in {formatMonthLabel(trend.best.month)}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Wire it in and delete `PersonalHistory` — THREE testids change owner**

`PersonalHistory` currently carries **three** load-bearing testids, and deleting it
orphans all three at once. An orphaned testid does not fail loudly: the assertion
simply never matches anything, and the suite can stay green while the coverage is
gone. All three handovers happen in THIS commit, so no task leaves a red or
falsely-green window behind it.

| testid | was on | moves to |
| --- | --- | --- |
| `insights-months` | `PersonalHistory`'s month list | `TrendPanel`'s `CardContent` |
| `insights-personal` | `PersonalHistory`'s non-thin `Card` | `PersonalSummary`'s `Card` (keep `insights-summary` too — Task 10's tests use it) |
| `insights-personal-thin` | `PersonalHistory`'s thin branch | a thin-state block in `InsightsPanel`, built now rather than deferred |

Build the thin state here, using the `UnlockPrompt` shape Task 16 describes and
keeping the existing copy verbatim — it already names what is coming and only
lacked the distance.

**Before committing, prove every id still resolves exactly once in production
code:** `grep -rn 'insights-months\|insights-personal\|insights-personal-thin' src/ --include='*.tsx'`.
Zero matches is as much a failure as two.

In `src/routes/insights.tsx`:
1. Delete the entire `PersonalHistory` function, having moved all three testids per the table above.
2. Replace its call site:

```tsx
      {data.access.layer2 === 'full' && (
        <>
          <PersonalSummary boards={data.boards} />
          <OpenersPanel benchmark={benchmark} boards={data.boards} />
          <TrendPanel boards={data.boards} />
        </>
      )}
```

3. Remove now-unused imports (`attemptsByMonth`, `consistency`, `headlineComparison`, `openerRepertoire`, `streaks`, `formatMonthLabel` if unused, `openerRankSentence` if unused).

- [ ] **Step 5: Verify**

```bash
pnpm test:once && pnpm typecheck && pnpm lint
```

Expected: everything green. `-insights.hook.test.ts`'s assertions on
`insights-personal`, `insights-personal-thin` and `insights-months` must all
still pass, because all three ids moved in this commit rather than being
deferred. **If any of them fails, the handover is incomplete — fix the handover,
never the assertion.**

- [ ] **Step 6: Commit**

```bash
git add src/components/insights/trend-panel.tsx src/components/insights/trend-panel.hook.test.ts src/routes/insights.tsx
git commit -m "feat(insights): by-month becomes a trend, and PersonalHistory dissolves

Twelve rows of 'August 2026 - 28 boards, avg 4.2' is a table nobody reads for a
trend. The shape is the information.

Bars scale from zero rather than from the best month: a scale starting at the
minimum exaggerates ordinary variation into a dramatic slope, which on a page
someone pays for is a lie of presentation. The direction is stated outright
because shorter-is-better cannot be inferred from an axis."
```

---

## Task 13: `BoardRow` and `DailyBenchmark`

**Files:**
- Create: `src/components/insights/board-row.tsx`
- Create: `src/components/insights/daily-benchmark.tsx`
- Test: `src/components/insights/board-row.hook.test.ts`
- Modify: `src/routes/insights.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { BoardRow } from './board-row.tsx'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'

afterEach(cleanup)

const benchmark: InsightsBenchmark = {
  openers: {
    release: 'v1', attribution: 'x', licence: 'CC BY 4.0', licenceUrl: 'x',
    citation: 'x', count: 2, words: 'cranemusic',
  },
  difficulty: {
    release: 'current', snapshotId: 'test', attribution: 'x', licence: 'CC BY 4.0',
    licenceUrl: 'x', citation: 'x', firstDay: '2026-01-01', count: 2, percentiles: [90, 10],
  },
}

describe('BoardRow', () => {
  test('it renders the score as text beside the aria-hidden grid', () => {
    render(
      createElement(BoardRow, {
        benchmark,
        board: { puzzleDay: '2026-01-01', guesses: ['CRANE', 'MOIST', 'SPEED'], answer: 'SPEED' },
      }),
    )
    expect(screen.getByTestId('insights-board').textContent).toContain('3')
  })

  test('an opener the corpus lacks never reads as a rank of zero', () => {
    render(
      createElement(BoardRow, {
        benchmark,
        board: { puzzleDay: '2026-01-01', guesses: ['ZZZZZ', 'SPEED'], answer: 'SPEED' },
      }),
    )
    expect(screen.getByTestId('insights-board').textContent).toContain('not in the benchmark set')
    expect(screen.getByTestId('insights-board').textContent).not.toContain('0th')
  })

  test('a day outside the artifact reads as not rated, not as easy', () => {
    render(
      createElement(BoardRow, {
        benchmark,
        board: { puzzleDay: '2030-01-01', guesses: ['CRANE', 'SPEED'], answer: 'SPEED' },
      }),
    )
    expect(screen.getByTestId('insights-board').textContent).toContain('not rated yet')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/components/insights/board-row.hook.test.ts
```

Expected: FAIL — cannot resolve `./board-row.tsx`.

- [ ] **Step 3: Implement `board-row.tsx`**

```tsx
import { Badge } from '#/components/ui/badge.tsx'
import { attemptsFor } from '../../../convex/lib/board.ts'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import { benchmarkFor, difficultySentence, openerRankSentence } from '#/lib/insights-panel.ts'
import { formatDayHeaderParts } from '#/lib/format-day'
import { MiniBoard } from './mini-board.tsx'

/**
 * One day, with the board that produced it.
 *
 * WAS TWO LINES OF TEXT INSIDE A NESTED Card. The board is the thing the player
 * actually remembers about a day, and the page about board performance rendered
 * none. The nested Card is gone too — a card inside a card inside a scroller is
 * three borders to say one thing.
 *
 * BOTH ABSENT STATES ARE UNCHANGED IN WORDING and must stay that way. "Is not in
 * the benchmark set" is never a zero, because 'ranks 0th' reads as a real and
 * extreme result and 26 of our boards have an opener the corpus does not hold.
 * "Not rated yet" is the common case rather than an edge case: the corpus
 * publishes only globally completed days, so today never has a row.
 */
export function BoardRow({
  benchmark,
  board,
}: {
  benchmark: InsightsBenchmark
  board: { puzzleDay: string; guesses: string[]; answer?: string }
}) {
  const result = benchmarkFor(benchmark, board)
  const { weekday, ordinal } = formatDayHeaderParts(board.puzzleDay)
  const attempts = attemptsFor(board.guesses, board.answer ?? '')

  return (
    <div className="flex gap-3 rounded-md border p-3" data-testid="insights-board">
      <MiniBoard guesses={board.guesses} answer={board.answer} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">
            {weekday} {ordinal}
          </span>
          <span className="text-sm font-bold tabular-nums">
            {attempts >= 7 ? 'X' : attempts}
            <span className="text-muted-foreground font-normal">/6</span>
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          {result.opener ? (
            <>
              Opened <span className="text-foreground font-medium">{result.opener.word}</span>{' '}
              <Badge variant="secondary" className="ml-1 tabular-nums">
                #{result.opener.rank.toLocaleString()}
              </Badge>
              <span className="sr-only">{openerRankSentence(result.opener)}</span>
            </>
          ) : (
            <>Opener is not in the benchmark set</>
          )}
        </p>
        <p className="text-muted-foreground text-xs">
          {result.difficulty ? (
            <>
              <span className="text-foreground font-medium">{result.difficulty.label}</span> —{' '}
              {difficultySentence(result.difficulty)}
            </>
          ) : (
            <>Difficulty not rated yet</>
          )}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Move `DailyBenchmark` into its own file**

Create `src/components/insights/daily-benchmark.tsx` by moving the `DailyBenchmark` function out of `src/routes/insights.tsx` **verbatim**, including its full header comment, with these changes only:

1. Export it: `export function DailyBenchmark(`
2. Import its dependencies with `#/` aliases.
3. Replace `<BoardCard ... />` with `<BoardRow ... />`.
4. Card title: `className="text-lg md:text-xl"`.
5. Filters become full-width and stacked on mobile — replace the `<div className="flex gap-2">` wrapper and both `<select>` class strings:

```tsx
          {filterable && (
            <div className="flex w-full gap-2 md:w-auto">
              <select
                aria-label="Filter by month"
                className="bg-background h-9 flex-1 rounded-md border px-2 text-sm md:flex-none"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                data-testid="insights-filter-month"
              >
```

with the same treatment for the opener select. The 24px `py-1 text-xs` controls were the page's only interactive elements and were well under the 44px touch minimum.

Then delete `DailyBenchmark` and `BoardCard` from `src/routes/insights.tsx` and import the new component.

- [ ] **Step 5: Verify**

```bash
pnpm test:once && pnpm typecheck && pnpm lint
```

Expected: pass (except the known `insights-personal-thin` gap from Task 12).

- [ ] **Step 6: Commit**

```bash
git add src/components/insights/board-row.tsx src/components/insights/daily-benchmark.tsx src/components/insights/board-row.hook.test.ts src/routes/insights.tsx
git commit -m "feat(insights): day-by-day rows show the board

Two lines of text inside a nested Card becomes the real board beside the day
and the score. A card inside a card inside a scroller was three borders to say
one thing.

Both absent states keep their exact wording: 'not in the benchmark set' is
never a zero, and 'not rated yet' is the common case because today is always
outside the corpus.

Filters go full-width and h-9 on mobile. At py-1 text-xs they were about 24px
tall -- the page's only interactive controls, well under the touch minimum."
```

---

## Task 14: The team panel

**Files:**
- Modify: `src/components/insights/team-panel.tsx`
- Test: `src/components/insights/team-panel.hook.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to the existing `src/components/insights/team-panel.hook.test.ts` (read it first to match its existing fixture helpers):

```ts
describe('TeamPanel leads with the comparison', () => {
  test('a two-person team gets the versus block, not a list row', () => {
    render(createElement(TeamPanel, { data: twoPersonTeam, teamName: 'The Wordlers' }))
    expect(screen.getByTestId('insights-versus')).toBeTruthy()
  })

  test('the card takes the team name, falling back when there is none', () => {
    render(createElement(TeamPanel, { data: twoPersonTeam, teamName: undefined }))
    expect(screen.getByTestId('insights-team').textContent).toContain('Your team')
  })

  test('head to head still renders, keeping its testid', () => {
    render(createElement(TeamPanel, { data: twoPersonTeam, teamName: 'The Wordlers' }))
    expect(screen.getByTestId('insights-head-to-head')).toBeTruthy()
  })
})
```

Build `twoPersonTeam` from the same `TeamPanelData` shape the file's existing tests use.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:once src/components/insights/team-panel.hook.test.ts
```

Expected: FAIL — no `insights-versus`, and `teamName` is not a prop.

- [ ] **Step 3: Implement**

In `src/components/insights/team-panel.tsx`:

1. Add `teamName?: string` to the props and use it in both `CardTitle`s:

```tsx
export function TeamPanel({ data, teamName }: { data: TeamPanelData; teamName?: string }) {
```

```tsx
        <CardTitle className="text-lg md:text-xl">{teamName ?? 'Your team'}</CardTitle>
```

2. Replace the `insights-head-to-head` block's list with the versus treatment for a single opponent, keeping the list for more:

```tsx
        <div data-testid="insights-head-to-head">
          {records.length === 0 ? (
            <p className="text-muted-foreground">
              You are the only member of this team, so there is nobody to compare with.
            </p>
          ) : records.length === 1 ? (
            /* THE MOST ENGAGING FACT ON THE PAGE, and it used to be a list row.
               A two-person team is the shape this product is most often in, so
               it earns the treatment rather than being folded into a table of
               one. */
            <div data-testid="insights-versus">
              <div className="bg-muted flex items-center gap-3 rounded-md p-3">
                <div className="flex-1 text-center">
                  <p className="text-sm font-semibold">You</p>
                  <p className="text-accent-solid text-3xl leading-tight font-bold tabular-nums">
                    {records[0].wins}
                  </p>
                </div>
                <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  vs
                </span>
                <div className="flex-1 text-center">
                  <p className="text-sm font-semibold">{nameOf(records[0].opponentId)}</p>
                  <p className="text-3xl leading-tight font-bold tabular-nums">
                    {records[0].losses}
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground mt-2 text-center text-xs">
                {records[0].shared === 0
                  ? 'no shared days yet'
                  : `${records[0].ties} ${records[0].ties === 1 ? 'tie' : 'ties'} · ${records[0].shared} shared ${records[0].shared === 1 ? 'day' : 'days'}`}
              </p>
            </div>
          ) : (
            <>
              <h3 className="mb-2 font-medium">Head to head</h3>
              <ul className="space-y-1">
                {records.map((record) => (
                  <li key={record.opponentId} className="flex justify-between gap-2">
                    <span>{nameOf(record.opponentId)}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {record.shared === 0
                        ? 'no shared days yet'
                        : `${record.wins}-${record.losses}${record.ties > 0 ? `-${record.ties}` : ''} over ${record.shared} shared ${record.shared === 1 ? 'day' : 'days'}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
```

3. Turn the `insights-team-averages` list into bars, scaled against the worst mean, keeping the testid and the `no boards this month` empty text.

4. In `src/routes/insights.tsx`'s `TeamSection`, pass the name through: `<TeamPanel data={data} teamName={teams?.[0]?.name} />`.

- [ ] **Step 4: Verify**

```bash
pnpm test:once && pnpm typecheck && pnpm lint
```

Expected: pass. The existing e2e assertions on `insights-team`, `insights-team-averages`, `insights-team-days` and `insights-team-consistency` all still resolve.

- [ ] **Step 5: Commit**

```bash
git add src/components/insights/team-panel.tsx src/components/insights/team-panel.hook.test.ts src/routes/insights.tsx
git commit -m "feat(insights): head to head leads, and the card knows the team's name

A two-person team is the shape this product is most often in, and its record
was rendered as one row of a four-section list. It gets the versus treatment;
three or more keeps the table.

Averages become bars so the comparison is visible rather than arithmetic. The
card takes the team name with 'Your team' as the fallback, the same three-state
handling chat.tsx already applies to its heading."
```

---

## Task 15: The no-team empty state

**Files:**
- Create: `src/components/insights/no-team-card.tsx`
- Modify: `src/routes/insights.tsx`

- [ ] **Step 1: Implement**

`TeamSection` currently returns `null` when `!teamId` — a silent empty state that a v1 migrant who left every team lands in. wty4.1.11 names it.

Create `src/components/insights/no-team-card.tsx`:

```tsx
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'

/**
 * A STATED EMPTY STATE, WHERE THERE WAS SILENCE. TeamSection returned null for a
 * player on no team, so a third of this page simply did not exist with nothing
 * saying why — and a v1 migrant who left every team is in exactly that position.
 *
 * NOT AN UNLOCK PROMPT. This is not reachable by entering boards, so it gets no
 * progress bar; it is reachable by joining a team, so it gets a link.
 */
export function NoTeamCard() {
  return (
    <Card data-testid="insights-no-team">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg md:text-xl">Your team</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          You are not on a team yet. Team insights compare your scores with your teammates
          day by day — head to head records, averages, and the month's best and worst days.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/app">Find a team</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Wire it in**

In `src/routes/insights.tsx`'s `TeamSection`, replace:

```tsx
  if (!teamId || !data) return null
```

with:

```tsx
  // Distinguished on purpose: no team is a STATE and gets a card; a team whose
  // aggregate has not resolved yet is a loading frame and gets nothing.
  if (!teamId) return <NoTeamCard />
  if (!data) return null
```

- [ ] **Step 3: Verify**

```bash
pnpm test:once && pnpm typecheck && pnpm lint
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/insights/no-team-card.tsx src/routes/insights.tsx
git commit -m "feat(insights): a player on no team is told so

TeamSection returned null, so a third of the page did not exist with nothing
saying why -- and a v1 migrant who left every team lands in exactly that state.
wty4.1.11 names it.

Not an unlock prompt: this is not reachable by entering boards, so it gets a
link rather than a progress bar."
```

---

## Task 16: Route composition, the thin state, and the upsell

**Files:**
- Modify: `src/routes/insights.tsx`

- [ ] **Step 0: confirm the testid handovers Task 12 already made**

Task 12 moved `insights-personal`, `insights-personal-thin` and `insights-months`
off `PersonalHistory` before deleting it. Re-run the proof rather than assuming:
`grep -rn 'insights-personal\|insights-personal-thin\|insights-months' src/ --include='*.tsx'`
— each must resolve to exactly one production element. If Task 12 was done
correctly there is nothing to do here.

- [ ] **Step 0b: the original note, kept for the reasoning**

Deleting `PersonalHistory` removes the element carrying `data-testid="insights-personal"`,
and **nine assertions across `e2e/` and `-insights.hook.test.ts` depend on it.**
`PersonalSummary` currently carries `insights-summary` precisely because both
rendered at once; once `PersonalHistory` is gone that collision is gone too.

Move `insights-personal` onto `PersonalSummary`'s `Card` — it is now *the*
personal card and inherits the id's meaning. Keep `insights-summary` as well so
the tests written against it in Task 10 keep passing. Verify with
`grep -rn 'insights-personal' e2e/ src/` that every existing reference still
resolves; a dropped testid is a silently skipped assertion, not a failure.

- [ ] **Step 1: Restore the thin state at the route**

`PersonalHistory` owned `insights-personal-thin` and was deleted in Task 12. It now becomes an unlock prompt in `InsightsPanel`, which is where the tier branch already lives:

```tsx
      {data.access.layer2 === 'full' &&
        (isThin(data.boards) ? (
          <Card data-testid="insights-personal-thin">
            <CardContent className="pt-6">
              <UnlockPrompt
                what="Your history"
                need={MIN_BOARDS_FOR_STATS}
                have={data.boards.length}
                unit="boards"
                value="your opening repertoire, your streaks and how your scores move month to month"
                testId="insights-unlock-history"
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <PersonalSummary boards={data.boards} />
            <OpenersPanel benchmark={benchmark} boards={data.boards} />
            <TrendPanel boards={data.boards} />
          </>
        ))}
```

The value clause is the previous copy's wording, kept deliberately — it already named exactly what was coming; what it lacked was the distance.

- [ ] **Step 2: Give the upsell the presence of a card**

Replace the bare paragraph:

```tsx
      {upsell && (
        <p className="text-muted-foreground text-sm" data-testid="insights-upsell">
          {upsell}
        </p>
      )}
```

with:

```tsx
      {/* A CARD, NOT A MUTED LINE ABOVE THE FOOTER. The string is unchanged and
          upsellFor is untouched — placement and conversion copy belong to
          wordle-teams-iht. What changes is only this page's visual state, which
          is what wty4.1.11 owns. THE ACCENT BORDER IS WHAT SEPARATES IT FROM AN
          UnlockPrompt: this one asks for money. */}
      {upsell && (
        <Card className="border-accent-solid/40">
          <CardContent className="pt-6 text-sm" data-testid="insights-upsell">
            {upsell}
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 3: Verify the route is now composition only**

```bash
grep -c '' src/routes/insights.tsx
grep -n '^function \|^export function ' src/routes/insights.tsx
```

Expected: only `InsightsRoute`, `InsightsScope`, `InsightsPanel`, `TeamSection`, `useBenchmark`. No panel bodies. Confirm `InsightsRoute` is still **unexported**.

- [ ] **Step 4: Run every gate**

```bash
pnpm test:once && pnpm typecheck && pnpm lint && pnpm build
```

Expected: all four pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/insights.tsx
git commit -m "refactor(insights): the route is composition, the panels are components

517 lines holding the route plus four panels becomes the guard, the corpus
hook, the four branches and the composition. InsightsRoute stays unexported --
the vite plugin silently declines to code-split a route whose routed identifier
is exported, and routes.test.ts pins it.

The thin state becomes an unlock prompt keeping its exact copy, which already
named what was coming and only lacked the distance. The upsell becomes a card
with an accent border; upsellFor itself is untouched, because placement and
conversion copy are wordle-teams-iht's."
```

---

## Task 17: Verification

**Files:** none — this task changes no code.

- [ ] **Step 1: All four gates**

```bash
pnpm test:once && pnpm typecheck && pnpm lint && pnpm build
```

Expected: four passes. Check each exit status individually — **do not pipe these through anything in zsh**, where `PIPESTATUS` is empty and a piped check can report a false green.

- [ ] **Step 2: e2e, which the gates never run**

```bash
pnpm e2e e2e/insights.spec.ts
```

Expected: pass. If Playwright attaches to a stale dev server on :3000, kill it first — a days-old vite has made whole runs test stale code here before.

- [ ] **Step 3: Screenshot both themes at both widths**

Start the app and capture `/insights` at 390px and at desktop width, in light and dark. Four screenshots.

This step is not optional and not replaceable by the gates. V2-ADDENDUM §5 records `vite build`, `tsc --noEmit` and the full suite all green while the Switch was invisible and the Separator zero-height — Tailwind emits no rule for a selector that cannot match, so the toolchain cannot see this class of bug.

Check specifically:
- Every `bg-*`/`text-*` resolves in dark. No token defined only inside a light block.
- The distribution's modal row is visibly the accent in both themes.
- Opener tile borders are visible against the card in dark.
- The hero's lead figure does not wrap at 390px.
- The filter selects are full-width and about 36px tall on mobile.

- [ ] **Step 4: Walk every state in the spec's §6**

Confirm each renders deliberately: loading, corpus failed, no boards, thin, free tier, no team, team with no boards this month, solo team, trailing form below floor, difficulty split below floor.

- [ ] **Step 5: Commit any fixes, then close the issue**

```bash
bd close wordle-teams-wty4.1.11
```

`bd` writes Dolt only, so a bd-only commit aborts on the first attempt — retry once with `||`, never twice unconditionally. And verify the close actually recorded before committing alongside code: a close committed together with code silently records the pre-close state.

---

## Self-review

**Spec coverage.** Every section maps to a task: §4.1 → 1; §4.2 → 2, 3, 9, 10; §4.3 → 4, 6, 11; §4.4 → 5, 12; §4.5 → 14, 15; §4.6 → 8, 13; §4.7 → 16; §5 responsive → 10, 11, 12, 13; §6 states → 10, 11, 15, 16; §6.1 unlock prompts → 7, 10, 11, 16; §7 decomposition → 10–16; §8 a11y → 7, 8, 9, 12, 13; §9 theme → 17; §10 testing → every task, plus 17.

**Two deliberate deviations from the spec, both narrowed rather than widened:**
1. `MIN_OPENER_USES_FOR_ADVICE` (Task 4) is a third floor the spec does not enumerate. It is a correctness guard, not a feature — without it a two-board opener can generate a recommendation — and it renders no unlock prompt, so it adds no surface.
2. The spec's §4.5 describes a pinned standings table for larger teams using `bg-pinned-self`. Task 14 keeps the existing list for three or more members and applies the versus treatment only to the two-person case. Pinning within a list that does not yet sort by record would be decoration; if the owner wants the full standings table it is a follow-up issue, not a silent inclusion.

**Type consistency.** `DistributionRow`, `TrailingForm`, `OpenerAdvice`, `Trend`, `DifficultySplitResult` are each defined once in Tasks 2–6 and consumed with those exact names in Tasks 9–12. `UnlockPrompt`'s six props are identical at all four call sites. `MiniBoard` takes `guesses`/`answer`/`testId` in Tasks 8 and 13 alike.

**Placeholder scan.** No TBDs. Every code step carries the code. Task 14 step 3 item 3 and Task 13 step 4 describe transformations of code that already exists in the repo rather than reproducing whole files — the surrounding text names the exact file, the exact testid to preserve, and the exact change.
