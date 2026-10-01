# Insights Trial Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the running Insights trial visible — a card naming the trial and its end date, plus a marker on the two blocks the trial actually unlocks.

**Architecture:** No Convex and no schema changes. `api.insights.myAccess` already returns `trialActive` and `trialEndsAt` to the client, and `myBenchmarkBoards` already returns the same object as `data.access` — the client-side `Boards` type simply narrowed it away. So the work is: new copy constants, a date formatter, a new upgrade origin, one new card mounted beside the existing `TrialEndedCard`, one widened type, and one marker component rendered in two places.

**Tech Stack:** TanStack Start + React, Convex, vitest (edge-runtime by default, jsdom per-file via `// @vitest-environment jsdom`), Playwright for e2e, Tailwind + shadcn (`Badge`, `Card`).

**Spec:** `docs/superpowers/specs/2026-10-01-insights-trial-messaging-design.md`
**Epic:** `wordle-teams-a6pz`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `src/lib/trial-copy.ts` | What the trial prompts SAY | Modify — add active-trial constants beside the ended ones |
| `src/lib/trial-copy.test.ts` | The three copy guards | Modify — extend each over the new constants |
| `src/lib/format-day.ts` | How dates render | Modify — add an epoch-ms long-date export |
| `src/lib/format-day.test.ts` | Formatter behaviour | Modify — add the new function's cases |
| `src/lib/plans.ts` | Price, plans, upgrade origins | Modify — add the `trial-active` origin + headline |
| `src/lib/plans.test.ts` | Origin/headline guards | Modify — add `'trial-active'` to `ORIGINS` |
| `src/components/trial-active-card.tsx` | The card, for `trialActive` only | **Create** |
| `src/components/trial-active-card.hook.test.ts` | Card populations + CTA origin | **Create** |
| `src/components/trial-marker.tsx` | The shared badge | **Create** |
| `src/lib/insights-panel.ts` | `Boards` type + upsell decision | Modify — widen `access` with `trialActive` |
| `src/routes/insights.tsx` | Mounts the card; Layer 2 marker; passes `trialActive` to the team section | Modify |
| `src/components/insights/team-section.tsx` | Forwards `trialActive` | Modify |
| `src/components/insights/team-panel.tsx` | Layer 3 marker | Modify |
| `src/routes/-insights.hook.test.ts` | Marker visibility by population | Modify |
| `e2e/insights.spec.ts` | Real HTTP, real seeded trial | Modify |

**Ordering rationale:** copy and pure functions first (Tasks 1–3) so the component tasks can import real constants instead of placeholders; the card before the markers (Tasks 4–5) because it is the surface that carries the message for the majority of players (spec §6.2.1); the type widening (Task 6) before the markers that depend on it.

---

### Task 1: The copy constants and their guards

**Files:**
- Modify: `src/lib/trial-copy.ts`
- Test: `src/lib/trial-copy.test.ts`

Read `src/lib/trial-copy.ts` first. It holds `TRIAL_ENDED_TITLE`, `TRIAL_ENDED_BODY`, `TRIAL_ENDED_CTA` and a header stating two rules this task must honour: **no price**, and no claim of a complete history.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/trial-copy.test.ts`. Note the import line at the top must gain the new names and `PRO_ONLY_WORDS`:

```ts
import { COMPLETE_HISTORY_WORDS, PRO_ONLY_WORDS } from './pro-benefits.ts'
import {
  TRIAL_ACTIVE_BODY,
  TRIAL_ACTIVE_CTA,
  TRIAL_ACTIVE_TITLE,
  TRIAL_MARKER_LABEL,
  TRIAL_ENDED_BODY,
  TRIAL_ENDED_CTA,
  TRIAL_ENDED_TITLE,
} from './trial-copy'
```

```ts
describe('the active-trial prompt', () => {
  /**
   * ONE CORPUS, so a phrase added to any constant is measured by every guard
   * below rather than only the one whose test mentions it.
   */
  const all = () =>
    `${TRIAL_ACTIVE_TITLE} ${TRIAL_ACTIVE_BODY} ${TRIAL_ACTIVE_CTA} ${TRIAL_MARKER_LABEL}`.toLowerCase()

  test('names the trial as an INSIGHTS trial, not a month of Pro', () => {
    // The spec's section 3.2 decision, and the reason it is load-bearing: the
    // trial grants Layers 2 and 3 only, so "a free month of Pro" sends players
    // hunting for import, custom scoring, a third team and the widened month
    // window — four of the five PRO_BENEFITS entries it does NOT include.
    expect(TRIAL_ACTIVE_TITLE.toLowerCase()).toContain('insights trial')
  })

  test('promises no COMPLETE history, because PRO_BOARD_LIMIT truncates one', () => {
    // The same shared list already guarding TRIAL_ENDED_*, pro-benefits and
    // insights-panel. PRO_BOARD_LIMIT is 400 (convex/insights.ts:24).
    for (const claim of COMPLETE_HISTORY_WORDS) {
      expect(all(), `"${claim}" promises a history PRO_BOARD_LIMIT truncates`).not.toContain(claim)
    }
  })

  test('claims none of the four benefits the trial does NOT grant', () => {
    // insightsAccess applies `paid = isPro || trialActive` to layer2 and layer3
    // ONLY. access.ts states the rest in its own words: "The trial does not
    // widen this window". So trial copy may not reach for the vocabulary of
    // import, scoring or the month window — which is exactly what PRO_ONLY_WORDS
    // already enumerates, one entry per benefit it belongs to.
    for (const word of PRO_ONLY_WORDS) {
      expect(all(), `"${word}" names a benefit the trial does not grant`).not.toContain(word)
    }
  })

  test('carries no price, because the price lives in Polar', () => {
    const raw = `${TRIAL_ACTIVE_TITLE} ${TRIAL_ACTIVE_BODY} ${TRIAL_ACTIVE_CTA} ${TRIAL_MARKER_LABEL}`
    expect(raw).not.toMatch(/\$\d/)
  })

  test('uses typographic apostrophes and no typewriter ones', () => {
    // Asserts BOTH directions, the way plans.test.ts does, so deleting every
    // apostrophe fails this rather than passing it.
    const raw = `${TRIAL_ACTIVE_TITLE} ${TRIAL_ACTIVE_BODY} ${TRIAL_ACTIVE_CTA} ${TRIAL_MARKER_LABEL}`
    expect(raw).not.toContain("'")
    expect(raw).toContain('’')
  })

  test('the call to action is a verb, not a noun', () => {
    // Same rule as TRIAL_ENDED_CTA.
    expect(TRIAL_ACTIVE_CTA).toMatch(/^(See|Get|Upgrade|Keep)/)
  })

  test('the marker is short enough for a badge', () => {
    // It renders inside components/ui/badge.tsx at text-xs. A sentence here
    // wraps the badge onto two lines and looks like a bug.
    expect(TRIAL_MARKER_LABEL.length).toBeLessThanOrEqual(24)
  })

  test('the active and ended prompts do not share a title', () => {
    // They are mutually exclusive populations (trialActive and trialExpired
    // cannot both be true) but a player sees both, a month apart, and two
    // identical titles would read as the same card failing to update.
    expect(TRIAL_ACTIVE_TITLE).not.toEqual(TRIAL_ENDED_TITLE)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
TZ=UTC pnpm vitest run src/lib/trial-copy.test.ts > /tmp/t1.log 2>&1; echo "exit=$?"; tail -20 /tmp/t1.log
```

Expected: FAIL. The import of `TRIAL_ACTIVE_TITLE` et al. does not resolve.

**Do not pipe this into `tail` directly.** `PIPESTATUS` is empty in this zsh, so `$?` would be the pipe's exit code and a red run would read as green. Redirect, read the code, then inspect.

- [ ] **Step 3: Add the constants**

Append to `src/lib/trial-copy.ts`:

```ts
/**
 * WHAT THE RUNNING TRIAL SAYS — the counterpart to the TRIAL_ENDED_* trio above,
 * and here for the same reason: the copy is the deliverable and the component is
 * not.
 *
 * IT EXISTS BECAUSE NOTHING IN src/ READ `trialActive`. The trial ran silently
 * for its whole thirty days and the first notice a player ever got was the card
 * saying it had ended — which convex/insights.ts's own header on `myAccess`
 * names as "the difference between a player who upgrades and a player who
 * assumes the feature broke".
 *
 * IT SAYS *INSIGHTS* TRIAL, AND THAT IS THE WHOLE DESIGN. insightsAccess applies
 * `paid = isPro || trialActive` to layer2 and layer3 ONLY: a trialist still sees
 * Layer 1 as free, gets no Layer 4, and does not get the widened month window
 * (access.ts: "The trial does not widen this window"). So four of the five
 * PRO_BENEFITS entries — teams, scoring, import, months — are NOT in the trial.
 * "A free month of Pro" would be a claim this product does not honour, and
 * trial-copy.test.ts refuses the vocabulary of all four.
 *
 * THE END DATE IS NOT IN THESE STRINGS. It is per-player, arrives as epoch ms on
 * `access.trialEndsAt`, and is rendered by `trialEndsOnLine` below from a date
 * the CALLER formats — so this module stays free of both a clock and a locale.
 */
export const TRIAL_ACTIVE_TITLE = 'Your Insights trial is running'

/**
 * NAMES THE TWO LAYERS THE TRIAL ACTUALLY GRANTS, in the same order and the same
 * voice as TRIAL_ENDED_BODY, so a player meeting both a month apart reads one
 * product rather than two.
 *
 * "month by month" and "full month" are deliberate and are NOT the `months`
 * benefit: Layer 2's trend is denominated in months and Layer 3 is a per-month
 * team aggregate, whereas `months` is how far BACK a player may browse — which a
 * trial does not widen. TRIAL_ENDED_BODY already draws the same distinction in
 * the same words.
 */
export const TRIAL_ACTIVE_BODY =
  'The numbers on this page are part of Pro, and they’re yours while your trial ' +
  'runs — your playing history month by month, and your team’s full month rather ' +
  'than just today.'

/**
 * The end date, as its own line rather than spliced into the body, so the body
 * stays a constant a test can read whole.
 *
 * TAKES AN ALREADY-FORMATTED DATE, not a timestamp: formatting needs a locale and
 * a zone, and this module's job is wording. lib/format-day.ts owns the rendering.
 */
export function trialEndsOnLine(endsOn: string): string {
  return `Free until ${endsOn}.`
}

/** A verb, so the button reads as an action rather than a label. */
export const TRIAL_ACTIVE_CTA = 'See what Pro includes'

/**
 * THE BADGE ON THE BLOCKS THE TRIAL UNLOCKS. Short because it renders inside
 * components/ui/badge.tsx at text-xs; a sentence wraps it onto two lines.
 *
 * IT SAYS "IN YOUR TRIAL" RATHER THAN "PRO" ALONE because the marker is gated on
 * `trialActive`, never on `layer2 === 'full'` — that predicate is equally true
 * for a paying subscriber, and telling a subscriber their panels are "in your
 * trial" is false to the one population that has already paid.
 */
export const TRIAL_MARKER_LABEL = 'Pro · in your trial'
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
TZ=UTC pnpm vitest run src/lib/trial-copy.test.ts > /tmp/t1.log 2>&1; echo "exit=$?"; tail -20 /tmp/t1.log
```

Expected: exit=0, all tests in the file passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trial-copy.ts src/lib/trial-copy.test.ts
git commit -m "feat(trial): copy for the running Insights trial

Nothing in src/ read trialActive, so the trial ran silently for thirty days
and the first notice was the card saying it had ended.

Says INSIGHTS trial, not a month of Pro: insightsAccess grants layer2 and
layer3 only, so four of the five PRO_BENEFITS entries are not included. The
new guard refuses PRO_ONLY_WORDS over the active copy for that reason.

Refs: wordle-teams-a6pz"
```

---

### Task 2: The end-date formatter

**Files:**
- Modify: `src/lib/format-day.ts`
- Test: `src/lib/format-day.test.ts`

`format-day.ts` already holds a module-private `longDay` formatter with exactly the right options (`month: 'long', day: 'numeric', year: 'numeric'`), but every exported date function is keyed to `PuzzleDay`/`PuzzleMonth` strings. `trialEndsAt` is epoch milliseconds.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/format-day.test.ts`:

```ts
describe('formatInstantLabel', () => {
  test('renders an epoch instant as a long calendar date', () => {
    // 2026-10-30T00:00:00Z — the first trials stamped on launch day expire here
    // (LAUNCH_AT 2026-09-30 + INSIGHTS_TRIAL_DAYS 30).
    expect(formatInstantLabel(Date.UTC(2026, 9, 30))).toBe('October 30, 2026')
  })

  test('spells the month out, matching formatDayLabel rather than the picker', () => {
    // formatMonthLabel is 'Oct 2026' and is a DIFFERENT formatter. This one
    // shares longDay with formatDayLabel, so the two agree on the same day.
    expect(formatInstantLabel(Date.UTC(2026, 0, 1))).toBe('January 1, 2026')
  })

  test('agrees with formatDayLabel on the same calendar day', () => {
    // The property that stops a second formatter drifting from the first: both
    // read the shared `longDay` instance rather than each constructing options.
    expect(formatInstantLabel(Date.UTC(2026, 8, 20))).toBe(formatDayLabel('2026-09-20'))
  })
})
```

The file's import line must gain `formatInstantLabel`, and `formatDayLabel` if it is not already imported.

- [ ] **Step 2: Run the test to verify it fails**

```bash
TZ=UTC pnpm vitest run src/lib/format-day.test.ts > /tmp/t2.log 2>&1; echo "exit=$?"; tail -20 /tmp/t2.log
```

Expected: FAIL — `formatInstantLabel` is not exported.

- [ ] **Step 3: Add the export**

Append to `src/lib/format-day.ts`:

```ts
/**
 * 'October 30, 2026' — an absolute instant as a calendar date.
 *
 * SHARES `longDay` WITH formatDayLabel rather than constructing its own options,
 * so the two cannot drift about what a long date looks like. The test asserts
 * they agree on the same day.
 *
 * TAKES EPOCH MS, WHICH IS WHY IT EXISTS: every other export here is keyed to a
 * PuzzleDay or PuzzleMonth string, and `trialEndsAt` (convex/lib/insightsAccess.ts)
 * is a timestamp.
 *
 * THE ZONE IS THE RUNTIME'S, AND THAT IS CORRECT RATHER THAN SLOPPY. A trial
 * ends at an instant; which calendar day that falls on genuinely differs by
 * viewer, and each should see their own. It is safe from hydration mismatch only
 * because its one caller renders from client-only useQuery data — see
 * components/trial-active-card.tsx, which records that obligation.
 */
export function formatInstantLabel(instant: number): string {
  return longDay.format(new Date(instant))
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
TZ=UTC pnpm vitest run src/lib/format-day.test.ts > /tmp/t2.log 2>&1; echo "exit=$?"; tail -20 /tmp/t2.log
```

Expected: exit=0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format-day.ts src/lib/format-day.test.ts
git commit -m "feat(format): render an epoch instant as a long calendar date

trialEndsAt is epoch ms and every existing export here is keyed to a
PuzzleDay string. Shares the private longDay instance with formatDayLabel so
the two cannot drift, and the test pins that they agree.

Refs: wordle-teams-a6pz"
```

---

### Task 3: The `trial-active` upgrade origin

**Files:**
- Modify: `src/lib/plans.ts`
- Test: `src/lib/plans.test.ts`

The origin is the only thing that chooses the dialog's headline. Four existing guards in `plans.test.ts` bind the new entry: a key-set equality against `ORIGINS`, a 60-character limit, a typewriter-apostrophe ban, and a longest-shared-run check against every `PRO_BENEFITS` title and body that fails at `SHARED_RUN_LIMIT` (4).

- [ ] **Step 1: Add the origin to the test's ORIGINS list, which makes the suite fail**

In `src/lib/plans.test.ts`, extend the list:

```ts
  const ORIGINS: UpgradeOrigin[] = [
    'header',
    'teams',
    'months',
    'import',
    'insights',
    'trial-ended',
    'trial-active',
  ]
```

Then add one assertion that the headline speaks to the trial rather than to a click, since this is the only origin reached without the player pressing anything:

```ts
  test('the trial-active line speaks to a state, not to a click', () => {
    // Every other origin is named for an affordance the player just pressed, so
    // its headline names what they reached for. This one is reached from a card
    // that appeared on its own, so there is nothing reached for — the line has
    // to be about the trial itself.
    expect(UPGRADE_HEADLINES['trial-active'].toLowerCase()).toContain('trial')
  })
```

- [ ] **Step 2: Run the suite to verify it fails**

```bash
TZ=UTC pnpm vitest run src/lib/plans.test.ts > /tmp/t3.log 2>&1; echo "exit=$?"; tail -25 /tmp/t3.log
```

Expected: FAIL — `'trial-active'` is not assignable to `UpgradeOrigin`, and the key-set equality finds a missing key.

- [ ] **Step 3: Add the origin and its headline**

In `src/lib/plans.ts`, extend the union and the record:

```ts
export type UpgradeOrigin =
  | 'header'
  | 'teams'
  | 'months'
  | 'import'
  | 'insights'
  | 'trial-ended'
  | 'trial-active'

export const UPGRADE_HEADLINES: Record<UpgradeOrigin, string> = {
  header: 'What you get with Pro',
  teams: 'You are at the two-team limit',
  months: 'You reached past the last three months',
  import: 'Your screenshot can do the typing',
  insights: 'See who’s actually beating whom',
  'trial-ended': 'Pick up where your trial left off',
  // THE ONLY ORIGIN NOT NAMED FOR A CLICK. The other six are reached by pressing
  // something, so each names what the player reached for; this one is reached
  // from a card that appeared on its own, mid-trial, so the line is about the
  // trial rather than about an affordance. 39 characters, and it shares at most
  // one consecutive word with any benefit title or body — the guard fails at 4.
  'trial-active': 'Keep these numbers when your trial ends',
}
```

Add to `UpgradeOrigin`'s doc comment, where it says "Six affordances, six lines": it is now seven lines over six affordances, and the seventh is a state.

- [ ] **Step 4: Run the suite to verify it passes**

```bash
TZ=UTC pnpm vitest run src/lib/plans.test.ts > /tmp/t3.log 2>&1; echo "exit=$?"; tail -25 /tmp/t3.log
```

Expected: exit=0. If the shared-run guard fails, the message names the colliding benefit text — reword the headline rather than raising `SHARED_RUN_LIMIT`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plans.ts src/lib/plans.test.ts
git commit -m "feat(upgrade): a trial-active origin for the dialog

Seven headlines over six affordances now: this is the only origin not named
for a click, because the card that opens it appears on its own mid-trial. So
the line is about the trial state rather than about what was pressed.

Refs: wordle-teams-a6pz"
```

---

### Task 4: The `TrialActiveCard`

**Files:**
- Create: `src/components/trial-active-card.tsx`
- Create (test): `src/components/trial-active-card.hook.test.ts`

Read `src/components/trial-ended-card.tsx` and `src/components/trial-ended-card.hook.test.ts` in full first. This card is their sibling and the test mirrors that file's mocking strategy, including its reason for mocking `useConvexAction` rather than the upgrade hook: with the hook stubbed, a card wired straight to `startUpgrade` would record nothing the test could see.

- [ ] **Step 1: Write the failing test**

Create `src/components/trial-active-card.hook.test.ts`:

```ts
// @vitest-environment jsdom
//
// THE CARD FOR THE POPULATION NOTHING IN src/ COULD SEE. Before this component
// no file in src/ read `trialActive` at all, so the whole thirty-day trial ran
// with no surface and the first notice a player got was TrialEndedCard.
//
// MIRRORS trial-ended-card.hook.test.ts, including WHY it mocks one layer down
// (`useConvexAction`, not use-start-upgrade): with the hook stubbed, a card
// wired straight to startUpgrade would record nothing this file could see. That
// sibling's banner records a dead `onClick={() => {}}` passing the whole suite,
// tsc, eslint and the build — this card has the same shape and the same exposure.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { insightsAccess, type InsightsAccess } from '../../convex/lib/insightsAccess.ts'
import { UPGRADE_HEADLINES } from '#/lib/plans.ts'
import { formatInstantLabel } from '#/lib/format-day.ts'
import {
  TRIAL_ACTIVE_BODY,
  TRIAL_ACTIVE_CTA,
  TRIAL_ACTIVE_TITLE,
  trialEndsOnLine,
} from '#/lib/trial-copy.ts'

const { createCheckout, toastInfo, toastError } = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}))

let access: InsightsAccess | null | undefined

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({
    queryKey: [getFunctionName(ref), args],
  }),
  useConvexAction: (ref: FunctionReference<'action'>) => {
    const name = getFunctionName(ref)
    if (name === getFunctionName(api.polar.createProCheckout)) return createCheckout
    throw new Error(`the upgrade dialog asked for an unexpected action: ${name}`)
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    if (queryKey[0] !== getFunctionName(api.insights.myAccess)) {
      throw new Error(`the trial-active card asked for an unexpected query: ${queryKey[0]}`)
    }
    return { data: access }
  },
}))

vi.mock('sonner', () => ({ toast: { info: toastInfo, error: toastError } }))

const { UpgradeDialogProvider } = await import('./upgrade-dialog.tsx')
const { TrialActiveCard } = await import('./trial-active-card.tsx')

const HERE = 'http://localhost:3000/insights'
let location: { href: string }

const NOW = Date.UTC(2026, 0, 15)
const DAY = 24 * 60 * 60 * 1000
const ENDS_AT = NOW + 10 * DAY

/**
 * BUILT BY THE REAL RESOLVER rather than written out by hand, for the reason
 * trial-ended-card.hook.test.ts gives: a hand-written fixture lets this file
 * agree with itself about who is in the set while disagreeing with
 * convex/lib/insightsAccess.ts, which is the one disagreement that matters.
 */
const trialRunning = insightsAccess({ isPro: false, trialEndsAt: ENDS_AT, now: NOW })
const expiredTrial = insightsAccess({ isPro: false, trialEndsAt: NOW - DAY, now: NOW })
const neverTrialed = insightsAccess({ isPro: false, trialEndsAt: undefined, now: NOW })
const proNeverTrialed = insightsAccess({ isPro: true, trialEndsAt: undefined, now: NOW })
const proMidTrial = insightsAccess({ isPro: true, trialEndsAt: ENDS_AT, now: NOW })

const card = () =>
  render(createElement(UpgradeDialogProvider, null, createElement(TrialActiveCard, null)))

const clickCta = () => fireEvent.click(screen.getByRole('button', { name: TRIAL_ACTIVE_CTA }))
const dialog = () => screen.getByRole('dialog')
const headline = () => within(dialog()).getByRole('heading').textContent

beforeEach(() => {
  access = trialRunning
  location = { href: HERE }
  vi.stubGlobal('location', location)
  createCheckout.mockReset()
  createCheckout.mockResolvedValue({ url: null, reason: 'not-configured' })
  toastInfo.mockClear()
  toastError.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the card a player mid-trial actually sees', () => {
  test('renders its title, body and CTA', () => {
    card()

    expect(screen.getByTestId('trial-active')).toBeTruthy()
    expect(screen.getByText(TRIAL_ACTIVE_TITLE)).toBeTruthy()
    expect(screen.getByText(TRIAL_ACTIVE_BODY)).toBeTruthy()
    expect(screen.getByRole('button', { name: TRIAL_ACTIVE_CTA })).toBeTruthy()
  })

  test('names the day the trial ends, formatted rather than as a timestamp', () => {
    // THE POINT OF THE WHOLE CARD. A trial a player cannot date is one they
    // cannot plan around, and the raw epoch number reaching the screen is the
    // failure mode worth pinning — it renders as '1768...' and looks like a bug.
    card()

    expect(screen.getByText(trialEndsOnLine(formatInstantLabel(ENDS_AT)))).toBeTruthy()
    expect(screen.queryByText(String(ENDS_AT))).toBeNull()
  })
})

describe('and nobody else', () => {
  /**
   * `trialActive` CARRIES THE WHOLE CONDITION. The two Pro rows are the ones
   * worth stating: a subscriber who never trialed, and a subscriber who
   * converted DURING a trial whose clock is still running. insightsAccess
   * reports trialActive true for the second — the field is about the clock, not
   * about who is paying — so a card keyed on it alone would tell a paying
   * customer their Pro features are "yours while your trial runs".
   */
  const silent: ReadonlyArray<readonly [string, InsightsAccess | null | undefined]> = [
    ['trial has ended', expiredTrial],
    ['never started a trial', neverTrialed],
    ['is Pro and never trialed', proNeverTrialed],
    ['is Pro with a trial clock still running', proMidTrial],
    ['is signed out, so myAccess answered null', null],
    ['has myAccess still in flight', undefined],
  ]

  for (const [who, answer] of silent) {
    test(`renders nothing for a player whose ${who}`, () => {
      access = answer
      card()

      expect(screen.queryByTestId('trial-active')).toBeNull()
      expect(screen.queryByRole('button', { name: TRIAL_ACTIVE_CTA })).toBeNull()
    })
  }
})

describe('the CTA opens the upgrade dialog on this card’s own headline', () => {
  /**
   * THE ORIGIN LITERAL, WHICH NOTHING ELSE IN THE REPO CAN SEE. Swapping it for
   * any of the other six type-checks, lints and builds while headlining the
   * wrong sentence. Read off UPGRADE_HEADLINES rather than typed out, so the
   * copy stays owned by plans.ts: this pins WHICH headline, never what it says.
   */
  test('opens on the trial-active headline, not another affordance’s', () => {
    card()
    clickCta()

    expect(headline()).toBe(UPGRADE_HEADLINES['trial-active'])
  })

  test('starts no checkout by itself, because the dialog owns that step', () => {
    card()
    clickCta()

    expect(createCheckout.mock.calls.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
TZ=UTC pnpm vitest run src/components/trial-active-card.hook.test.ts > /tmp/t4.log 2>&1; echo "exit=$?"; tail -25 /tmp/t4.log
```

Expected: FAIL — `./trial-active-card.tsx` cannot be resolved.

- [ ] **Step 3: Write the component**

Create `src/components/trial-active-card.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import { useUpgrade } from '#/components/upgrade-dialog.tsx'
import { formatInstantLabel } from '#/lib/format-day.ts'
import {
  TRIAL_ACTIVE_BODY,
  TRIAL_ACTIVE_CTA,
  TRIAL_ACTIVE_TITLE,
  trialEndsOnLine,
} from '#/lib/trial-copy.ts'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'

/**
 * Shown to exactly one population: a player whose Insights trial is running.
 *
 * THE SIBLING OF trial-ended-card.tsx, and the two are mutually exclusive by
 * construction — insightsAccess cannot report `trialActive` and `trialExpired`
 * at once, since the second requires `!trialActive`. They mount side by side in
 * routes/insights.tsx and at most one ever renders.
 *
 * `trialActive && !isPro` IS TWO CONDITIONS AND BOTH ARE LOAD-BEARING, which is
 * the one place this card is NOT a mirror of its sibling. `trialExpired` already
 * excludes a Pro player itself; `trialActive` does not — it is a fact about the
 * CLOCK, not about who is paying, so it stays true for somebody who converted
 * mid-trial. Keyed on `trialActive` alone this card would tell a paying customer
 * that Pro is "yours while your trial runs".
 *
 * THE `trialEndsAt === null` CLAUSE IS A TYPE OBLIGATION, NOT A LIVE CASE:
 * insightsAccess returns the timestamp whenever `trialActive` is true, but types
 * it `number | null` for the inactive case, and the date is the whole point of
 * the card — so it is narrowed here rather than rendered as 'Invalid Date'.
 *
 * useQuery, NOT useSuspenseQuery, deliberately, for the reason the sibling gives:
 * this card is an aside, and suspending the insights route on it would make the
 * page wait in order to tell somebody about a trial.
 *
 * THAT CHOICE IS ALSO WHAT MAKES THE DATE SAFE. `formatInstantLabel` reads the
 * runtime's zone, so it must never run during SSR — a date formatted on the
 * server and reformatted in the browser is the minified React #418 that
 * routes/pricing.tsx, components/today-panel.tsx and components/scores-table.tsx
 * each record at length. Rendering from client-only useQuery data means Intl only
 * ever runs in the browser. DO NOT promote this to a loader-fed banner.
 */
export function TrialActiveCard() {
  const { data: access } = useQuery(convexQuery(api.insights.myAccess, {}))
  const { openUpgrade } = useUpgrade()

  if (!access?.trialActive || access.layer4 === 'full' || access.trialEndsAt === null) return null

  return (
    <Card className="mb-4" data-testid="trial-active">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{TRIAL_ACTIVE_TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{TRIAL_ACTIVE_BODY}</p>
        <p className="text-foreground font-medium">
          {trialEndsOnLine(formatInstantLabel(access.trialEndsAt))}
        </p>
        <Button variant="link" className="h-auto p-0" onClick={() => openUpgrade('trial-active')}>
          {TRIAL_ACTIVE_CTA}
        </Button>
      </CardContent>
    </Card>
  )
}
```

**Note on the Pro check:** `InsightsAccess` carries no `isPro` field, so this uses `access.layer4 === 'full'`, which `insightsAccess` sets from `isPro` alone and which no trial can produce. If a later change gives a trial Layer 4, this guard moves — and the `proMidTrial` test row is what fails. Prefer this over re-querying the tier: it reads the one object the card already has.

- [ ] **Step 4: Run the test to verify it passes**

```bash
TZ=UTC pnpm vitest run src/components/trial-active-card.hook.test.ts > /tmp/t4.log 2>&1; echo "exit=$?"; tail -25 /tmp/t4.log
```

Expected: exit=0, including both Pro rows.

- [ ] **Step 5: Commit**

```bash
git add src/components/trial-active-card.tsx src/components/trial-active-card.hook.test.ts
git commit -m "feat(trial): a card for the running Insights trial

Mirrors TrialEndedCard except in one place that matters: trialExpired
excludes a Pro player by itself, trialActive does not — it is a fact about
the clock, so it stays true for someone who converted mid-trial. Keyed on it
alone the card tells a paying customer that Pro is theirs while their trial
runs. Both Pro rows are pinned.

The date is formatted from client-only useQuery data so Intl never runs
during SSR; the component records why it must not become a loader-fed banner.

Refs: wordle-teams-a6pz"
```

---

### Task 5: Mount the card on the insights route

**Files:**
- Modify: `src/routes/insights.tsx` (beside `<TrialEndedCard />`)

- [ ] **Step 1: Add the mount**

Find `<TrialEndedCard />` in `src/routes/insights.tsx` and add its sibling immediately above it, with the import alongside the existing one:

```tsx
import { TrialActiveCard } from '#/components/trial-active-card.tsx'
```

```tsx
        {/*
          BOTH CARDS MOUNT AND AT MOST ONE RENDERS. insightsAccess cannot report
          trialActive and trialExpired at once (the second requires !trialActive),
          so this is not two prompts competing for the same slot — it is one slot
          whose occupant depends on where the player is in the trial. Each owns
          its own condition rather than the route branching between them, which
          is what keeps the route from re-deriving a rule convex/lib owns.
        */}
        <TrialActiveCard />
        <TrialEndedCard />
```

- [ ] **Step 2: Verify the route still type-checks and builds**

```bash
pnpm typecheck > /tmp/t5-tsc.log 2>&1; echo "tsc exit=$?"
pnpm build > /tmp/t5-build.log 2>&1; echo "build exit=$?"
```

Expected: both exit=0. Run them separately and read each code — `build` does not typecheck, because vite strips types.

- [ ] **Step 3: Commit**

```bash
git add src/routes/insights.tsx
git commit -m "feat(insights): mount TrialActiveCard beside TrialEndedCard

Both mount, at most one renders: trialActive and trialExpired cannot both be
true. Each card owns its own condition so the route never re-derives a rule
convex/lib/insightsAccess.ts owns.

Refs: wordle-teams-a6pz"
```

---

### Task 6: Widen `Boards.access` with `trialActive`

**Files:**
- Modify: `src/lib/insights-panel.ts` (the `Boards` type)
- Modify: `src/routes/-insights.hook.test.ts` (fixtures)

`myBenchmarkBoards` returns `{ access, boards }` where `access` is a full `InsightsAccess` from `insightsAccessFor`. The client-side `Boards` type narrows it to three layers, which is why `trialActive` is unreachable in `InsightsPanel` despite being present at runtime.

- [ ] **Step 1: Widen the type**

In `src/lib/insights-panel.ts`:

```ts
export type Boards = {
  access: {
    layer1: 'none' | 'free' | 'full'
    layer2: 'none' | 'free' | 'full'
    layer3: 'none' | 'free' | 'full'
    /**
     * WHETHER THE CLOCK IS RUNNING, which the server has always sent and this
     * type used to narrow away. convex/insights.ts's myBenchmarkBoards returns
     * `insightsAccessFor`'s whole InsightsAccess; the three layers above were
     * everything this module needed until the trial got a visible marker.
     *
     * REQUIRED RATHER THAN OPTIONAL, deliberately. Every existing fixture is a
     * free or pro player and means `false`, so an optional field would default
     * them all correctly — and would let a NEW test about the marker forget it
     * and silently assert the absence it was written to prove. tsc naming every
     * construction site is the point.
     *
     * NOT 'isPro'. The marker is gated on this and never on `layer2 === 'full'`,
     * which is equally true for a subscriber.
     */
    trialActive: boolean
  }
  boards: { puzzleDay: string; guesses: string[]; answer?: string }[]
}
```

- [ ] **Step 2: Run typecheck to enumerate every construction site**

```bash
pnpm typecheck > /tmp/t6-tsc.log 2>&1; echo "tsc exit=$?"; grep -c "error TS" /tmp/t6-tsc.log; grep "error TS" /tmp/t6-tsc.log | head -30
```

Expected: FAIL, with one error per `Boards` fixture missing `trialActive`. Most are in `src/routes/-insights.hook.test.ts` (~20 sites).

- [ ] **Step 3: Add `trialActive: false` at every site tsc names**

Every existing fixture is a free or pro player — none is a trialist — so `false` is the correct value at all of them. For example:

```ts
    access: { layer1: 'free' as const, layer2: 'none' as const, layer3: 'free' as const, trialActive: false },
```

and

```ts
      access: { layer1: 'full', layer2: 'full', layer3: 'full', trialActive: false },
```

Work from the tsc error list rather than by search-and-replace: the fixtures differ in whether they use `as const`, and a blanket substitution will corrupt the ones that do.

- [ ] **Step 4: Verify typecheck and the test suite pass**

```bash
pnpm typecheck > /tmp/t6-tsc.log 2>&1; echo "tsc exit=$?"
TZ=UTC pnpm test:once > /tmp/t6-test.log 2>&1; echo "test exit=$?"; tail -15 /tmp/t6-test.log
```

Expected: both exit=0, with no behaviour change — this task adds a field and asserts nothing new.

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights-panel.ts src/routes/-insights.hook.test.ts
git commit -m "refactor(insights): surface trialActive on the Boards type

The server has always sent it — myBenchmarkBoards returns insightsAccessFor's
whole InsightsAccess — and this type narrowed it away, which is why the trial
was unreachable from InsightsPanel.

Required rather than optional on purpose: every existing fixture means false,
so optional would default them all correctly AND let a new marker test forget
it and silently assert the absence it was written to prove.

Refs: wordle-teams-a6pz"
```

---

### Task 7: The marker, and its Layer 2 placement

**Files:**
- Create: `src/components/trial-marker.tsx`
- Modify: `src/routes/insights.tsx` (`InsightsPanel`, the `layer2 === 'full'` block)
- Test: `src/routes/-insights.hook.test.ts`

Spec §6.2.1: the Layer 2 block has two branches on `isThin(data.boards)`, and the route's own comment records that Layer 2 is empty for 368 of 392 accounts. The marker renders **above both branches**, on one condition, so it cannot drift from the branch beside it.

- [ ] **Step 1: Write the failing tests**

Append to `src/routes/-insights.hook.test.ts`. Follow the file's existing `panel({ ... })` helper:

`panel(data, teams?)` is at file scope and is used directly. **`history(n)` is
not** — it is declared locally inside two separate describe blocks (`Layer 2 —
personal history` and one below it), so the new block needs its own copy. That
duplication already exists in the file; this follows it rather than hoisting a
shared helper, which would be an unrelated refactor of two passing blocks.

```ts
describe('the trial marker on the personal block', () => {
  // Declared locally, matching the two existing blocks that each have their own.
  // MIN_BOARDS_FOR_STATS is 5, so 20 clears the isThin branch and 2 lands in it.
  const history = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      puzzleDay: `2026-09-${String(i + 1).padStart(2, '0')}`,
      guesses: i % 3 === 0 ? ['ORATE', 'SPEED'] : ['CRANE', 'MOIST', 'SPEED'],
    }))

  test('appears for a trialist who has enough boards for the panels', () => {
    panel({
      access: { layer1: 'free', layer2: 'full', layer3: 'full', trialActive: true },
      boards: history(20),
    })

    expect(screen.getByTestId('trial-marker-personal')).toBeTruthy()
  })

  test('appears for a trialist in the THIN state too, which is most of them', () => {
    // Layer 2 is empty for 368 of 392 accounts (this route's own comment), so
    // the thin branch is the common case and a marker only on the full branch
    // would be invisible to the majority. One condition above both branches is
    // also what stops it drifting from the isThin check beside it.
    panel({
      access: { layer1: 'free', layer2: 'full', layer3: 'full', trialActive: true },
      boards: history(2),
    })

    expect(screen.getByTestId('insights-personal-thin')).toBeTruthy()
    expect(screen.getByTestId('trial-marker-personal')).toBeTruthy()
  })

  test('is ABSENT for a pro player, whose layer2 is equally full', () => {
    // THE ASSERTION THE WHOLE DESIGN TURNS ON. `layer2 === 'full'` is true for a
    // subscriber, so a marker gated on the layer rather than on trialActive would
    // tell a paying customer their panels are "in your trial". This is the test
    // that fails if someone later "simplifies" the gate to the layer check.
    panel({
      access: { layer1: 'full', layer2: 'full', layer3: 'full', trialActive: false },
      boards: history(20),
    })

    expect(screen.queryByTestId('trial-marker-personal')).toBeNull()
  })

  test('is absent for a free player, who has no personal block at all', () => {
    panel({
      access: { layer1: 'free', layer2: 'none', layer3: 'free', trialActive: false },
      boards: history(20),
    })

    expect(screen.queryByTestId('trial-marker-personal')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
TZ=UTC pnpm vitest run src/routes/-insights.hook.test.ts > /tmp/t7.log 2>&1; echo "exit=$?"; tail -25 /tmp/t7.log
```

Expected: FAIL — `trial-marker-personal` is not in the document.

- [ ] **Step 3: Write the marker component**

Create `src/components/trial-marker.tsx`:

```tsx
import { Badge } from '#/components/ui/badge.tsx'
import { TRIAL_MARKER_LABEL } from '#/lib/trial-copy.ts'

/**
 * THE BADGE THAT SAYS WHICH BLOCKS THE TRIAL UNLOCKED.
 *
 * ONE COMPONENT, TWO PLACEMENTS — the Layer 2 group in routes/insights.tsx and
 * the team panel — because the two blocks are the whole of what
 * `paid = isPro || trialActive` grants (convex/lib/insightsAccess.ts) and they
 * must not describe themselves in two different ways.
 *
 * IT TAKES NO `trialActive` AND DECIDES NOTHING. Every caller gates the mount
 * itself, on `trialActive` and never on `layer2`/`layer3 === 'full'` — those are
 * equally true for a paying subscriber. A prop here would put that decision in
 * two places; a bare component keeps it at each call site where the access
 * object already is.
 *
 * `testId` IS PER PLACEMENT, so a test can say WHICH block it found rather than
 * that a badge exists somewhere on a page that has two.
 */
export function TrialMarker({ testId }: { testId: string }) {
  return (
    <div className="flex items-center" data-testid={testId}>
      <Badge variant="secondary">{TRIAL_MARKER_LABEL}</Badge>
    </div>
  )
}
```

- [ ] **Step 4: Place it in the Layer 2 block**

In `src/routes/insights.tsx`, add the import and render the marker as the first child inside the `layer2 === 'full'` fragment, above the `isThin` branch:

```tsx
import { TrialMarker } from '#/components/trial-marker.tsx'
```

```tsx
      {data.access.layer2 === 'full' && (
        <>
          {/*
            ABOVE BOTH BRANCHES, ON ONE CONDITION. Layer 2 is empty for 368 of
            392 accounts, so the thin branch below is the common case — a marker
            inside the full branch only would be invisible to most trialists.
            Gating it as `trialActive && !isThin(...)` would also create a second
            predicate that has to stay in step with the branch beside it, which
            is the class of drift hasFullTeamMonth was extracted to end.

            `trialActive`, NEVER `layer2 === 'full'`: that condition is already
            true here and is equally true for a subscriber.
          */}
          {data.access.trialActive && <TrialMarker testId="trial-marker-personal" />}
          {isThin(data.boards) ? (
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
TZ=UTC pnpm vitest run src/routes/-insights.hook.test.ts > /tmp/t7.log 2>&1; echo "exit=$?"; tail -25 /tmp/t7.log
```

Expected: exit=0, including the Pro row.

- [ ] **Step 6: Commit**

```bash
git add src/components/trial-marker.tsx src/routes/insights.tsx src/routes/-insights.hook.test.ts
git commit -m "feat(insights): mark the Layer 2 block as trial-granted

Renders above both branches of the isThin split on one condition: Layer 2 is
empty for 368 of 392 accounts, so a marker inside the full branch only would
be invisible to most trialists, and a second predicate beside the branch is
the drift hasFullTeamMonth was extracted to end.

Gated on trialActive and never on layer2 === 'full', which is equally true
for a subscriber — pinned by a test that fails on that simplification.

Refs: wordle-teams-a6pz"
```

---

### Task 8: The Layer 3 marker

**Files:**
- Modify: `src/components/insights/team-section.tsx` (forwards the flag)
- Modify: `src/components/insights/team-panel.tsx` (renders the marker)
- Modify: `src/routes/insights.tsx` (passes `data.access.trialActive` to `TeamSection`)
- Test: `src/routes/-insights.hook.test.ts`

`TeamSection` takes `layer3` as a bare prop rather than the access object, and `teamSection` reaches `InsightsPanel` as a prebuilt `ReactNode` — so this marker cannot be injected from inside `InsightsPanel` and the flag is threaded instead.

- [ ] **Step 1: Write the failing test**

The route builds `teamSection`, so this is asserted through the route's own test setup. Append to `src/routes/-insights.hook.test.ts`, inside or beside the existing team-section coverage:

```ts
describe('the trial marker on the team block', () => {
  test('appears for a trialist with the full team month', () => {
    // hasFullTeamMonth(layer3) includes trialActive, so a trialist gets the whole
    // month — convex/insights.test.ts pins that server-side. This is the client
    // saying so.
    render(
      createElement(TeamPanel, {
        ...teamPanelProps,
        trialActive: true,
      }),
    )

    expect(screen.getByTestId('trial-marker-team')).toBeTruthy()
  })

  test('is ABSENT for a pro player, whose team month is equally full', () => {
    render(
      createElement(TeamPanel, {
        ...teamPanelProps,
        trialActive: false,
      }),
    )

    expect(screen.queryByTestId('trial-marker-team')).toBeNull()
  })
})
```

`teamPanelProps` is whatever minimal prop set `TeamPanel` already requires — read `src/components/insights/team-panel.tsx`'s signature and the existing `team-section.hook.test.ts` for the fixture shape, and reuse that file's helper if it has one. If `TeamPanel` is more cheaply exercised through `TeamSection`, assert there instead; what must be pinned is the two rows above.

- [ ] **Step 2: Run the test to verify it fails**

```bash
TZ=UTC pnpm vitest run src/routes/-insights.hook.test.ts > /tmp/t8.log 2>&1; echo "exit=$?"; tail -25 /tmp/t8.log
```

Expected: FAIL — `trialActive` is not a prop of `TeamPanel`, and the testid is absent.

- [ ] **Step 3: Add the prop to `TeamPanel` and render the marker**

In `src/components/insights/team-panel.tsx`, add to the props type:

```tsx
  /**
   * WHETHER THIS MONTH IS VISIBLE ON A TRIAL RATHER THAN ON A SUBSCRIPTION.
   *
   * NOT DERIVABLE HERE. This component is already gated by its caller on
   * `access.layer3 === 'full'`, and that condition is true for a subscriber and a
   * trialist alike — hasFullTeamMonth deliberately includes trialActive. So the
   * distinction has to arrive as its own flag.
   *
   * OPTIONAL, so every existing test and the free branch render unchanged without
   * constructing one. Absent means "not a trial", which is the safe direction: a
   * missing flag shows no badge rather than showing one to a paying customer.
   */
  trialActive?: boolean
```

Render it in the header alongside the controls:

```tsx
        {trialActive && <TrialMarker testId="trial-marker-team" />}
```

with the import:

```tsx
import { TrialMarker } from '#/components/trial-marker.tsx'
```

Place it inside the existing `CardHeader` (the one carrying `CONTROLS_ONLY_HEADER`), after the controls, so it sits on the same row rather than displacing the sr-only title.

- [ ] **Step 4: Forward it through `TeamSection` and the route**

In `src/components/insights/team-section.tsx`, add `trialActive` to the destructured props and the props type (same `trialActive?: boolean` and a one-line comment pointing at `TeamPanel`'s), and pass it to `<TeamPanel ... trialActive={trialActive} />`.

In `src/routes/insights.tsx`, at the `<TeamSection ... />` mount, add:

```tsx
              trialActive={data.access.trialActive}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
TZ=UTC pnpm vitest run src/routes/-insights.hook.test.ts src/components/insights/team-section.hook.test.ts > /tmp/t8.log 2>&1; echo "exit=$?"; tail -25 /tmp/t8.log
```

Expected: exit=0.

- [ ] **Step 6: Commit**

```bash
git add src/components/insights/team-panel.tsx src/components/insights/team-section.tsx src/routes/insights.tsx src/routes/-insights.hook.test.ts
git commit -m "feat(insights): mark the team month as trial-granted

TeamPanel is already gated on layer3 === 'full', which hasFullTeamMonth makes
true for a subscriber and a trialist alike, so the distinction cannot be
derived there and arrives as its own flag from the route.

Optional, because absent means 'not a trial' — a missing flag shows no badge
rather than showing one to a paying customer.

Refs: wordle-teams-a6pz"
```

---

### Task 9: e2e coverage against a real seeded trial

**Files:**
- Modify: `e2e/insights.spec.ts`

That file already has `signInWithInsights(page, { boards, pro, trialEndsAt })` and a mid-trial case (`trialEndsAt: Date.now() + 10 * DAY`). E2E is **not** one of the four gates and is not run by them, so this is coverage rather than a gate — but `deploy-v2.yml` does run Playwright before deploying, so a failure here blocks a deploy.

- [ ] **Step 1: Write the spec**

Append to `e2e/insights.spec.ts`:

```ts
test.describe('the running trial says so', () => {
  test('a mid-trial player sees the card, the end date and both markers', async ({ page }) => {
    const endsAt = Date.now() + 10 * DAY
    await signInWithInsights(page, { boards: 20, pro: false, trialEndsAt: endsAt })
    await page.goto('/insights')

    await expect(page.getByTestId('trial-active')).toBeVisible()
    await expect(page.getByTestId('trial-marker-personal')).toBeVisible()
    // The raw timestamp reaching the screen is the failure worth catching: it
    // renders as a 13-digit number and reads as a bug.
    await expect(page.getByTestId('trial-active')).not.toContainText(String(endsAt))
    await expect(page.getByTestId('trial-ended')).toHaveCount(0)
  })

  test('a pro player sees neither the card nor the markers', async ({ page }) => {
    // THE CROSSING THAT ONLY e2e MAKES. Every layer predicate is identical
    // between a subscriber and a trialist here; what differs is trialActive, and
    // this is the assertion that it travelled over HTTP rather than being
    // reconstructed in a fixture.
    await signInWithInsights(page, { boards: 20, pro: true })
    await page.goto('/insights')

    await expect(page.getByTestId('insights-personal')).toBeVisible()
    await expect(page.getByTestId('trial-active')).toHaveCount(0)
    await expect(page.getByTestId('trial-marker-personal')).toHaveCount(0)
  })

  test('an expired trial still gets the ended card and not the running one', async ({ page }) => {
    await signInWithInsights(page, { boards: 20, pro: false, trialEndsAt: Date.now() - DAY })
    await page.goto('/insights')

    await expect(page.getByTestId('trial-ended')).toBeVisible()
    await expect(page.getByTestId('trial-active')).toHaveCount(0)
  })
})
```

- [ ] **Step 2: Run these three in the background**

The full suite takes ~10.7 minutes and exceeds the foreground limit, so scope the run and still background it:

```bash
CONVEX_AGENT_MODE=anonymous pnpm e2e e2e/insights.spec.ts -g "the running trial says so" > /tmp/t9-e2e.log 2>&1
```

**Kill any stale dev server on :3000 first.** Playwright attaches to whatever holds the port, and a days-old vite makes every assertion test stale code.

Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add e2e/insights.spec.ts
git commit -m "test(e2e): the running trial, over real HTTP

Every layer predicate is identical between a subscriber and a trialist, so
the pro row is the assertion that trialActive actually travelled rather than
being reconstructed in a fixture. Also pins that the raw 13-digit timestamp
never reaches the screen.

Refs: wordle-teams-a6pz"
```

---

### Task 10: All four gates, then close

**Files:** none

- [ ] **Step 1: Run all four gates separately and read each exit code**

They fail independently and routinely. Never pipe a gate into `tail` or `grep` to read its result — `PIPESTATUS` is empty in this zsh, so `$?` is the pipe's code and a red gate reads as green.

```bash
TZ=UTC pnpm test:once > /tmp/g-test.log 2>&1; echo "test exit=$?"
pnpm typecheck    > /tmp/g-tsc.log  2>&1; echo "tsc exit=$?"
pnpm lint         > /tmp/g-lint.log 2>&1; echo "lint exit=$?"
pnpm build        > /tmp/g-build.log 2>&1; echo "build exit=$?"
```

Expected: four zeros. Inspect the log of anything non-zero.

- [ ] **Step 2: Confirm nothing claims a trial grants more than it does**

```bash
grep -rn "month of Pro\|free month of Pro\|full Pro" src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\." || echo "clean"
```

Expected: `clean`. Any hit is the §2.2 claim this work exists to avoid.

- [ ] **Step 3: Close the epic and push**

```bash
bd close wordle-teams-a6pz
git add -A .beads/
git commit -m "chore(beads): close a6pz — the running trial now says so" || (git add -A .beads/ && git commit -m "chore(beads): close a6pz — the running trial now says so")
```

A `bd`-only commit aborts on the first attempt because `bd` writes Dolt and the hook exports afterwards — hence the single guarded retry. **Never run the commit twice unconditionally**, and never `--no-verify`.

```bash
git pull --rebase
git push
git status   # MUST read "up to date with origin"
```

- [ ] **Step 4: Verify the close actually recorded**

A close committed alongside code silently records the pre-close state, so confirm after pushing:

```bash
bd show wordle-teams-a6pz | head -5
grep -c "a6pz.*closed" .beads/issues.jsonl || echo "re-export and commit again"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §5 four populations | 4 (six silent rows), 7, 8 |
| §6.1 the card | 4, 5 |
| §6.2 the marker, two placements | 7, 8 |
| §6.2.1 thin state | 7 (step 1, second test) |
| §6.3 copy constants | 1 |
| §6.4 date formatter | 2 |
| §7.1 no price | 1 |
| §7.2 `COMPLETE_HISTORY_WORDS` | 1 |
| §7.3 none of the four excluded benefits | 1 (via `PRO_ONLY_WORDS`) |
| §8 testing | 1, 2, 3, 4, 7, 8, 9 |
| §8.1 timezone/hydration | 2 and 4 (recorded in both doc comments) |
| §9 the CTA and its origin | 3, 4 |
| §10 acceptance criteria 1–7 | 4, 7, 8, 1, 4, 10 |

**Two deviations from the spec, both found while reading the code and both narrowing the work:**

1. **§6.2 said the flag would be "threaded as a new prop" into `InsightsPanel`.** It is not: `data.access` is already in scope there, so Task 6 widens the `Boards` type instead — the field was being narrowed away, not missing. A prop would have created a second spelling of a fact the payload already carries. `TeamPanel`/`TeamSection` **do** take a new prop (Task 8), because `teamSection` arrives prebuilt as a `ReactNode` and `TeamSection` takes `layer3` rather than the access object.
2. **The card needs a Pro check the spec did not anticipate.** `trialActive` is a fact about the clock and stays true for a player who converts mid-trial, so `!access?.trialActive` alone would show the card to a new subscriber. `InsightsAccess` carries no `isPro`, so Task 4 uses `layer4 === 'full'`, which only `isPro` can produce. Both Pro rows are pinned in the test.

**Placeholder scan:** none. The two places a reader must look something up — `history(n)` in Task 7 and `teamPanelProps` in Task 8 — name the file and the existing helper to read, and the assertions that must hold are written out in full.

**Type consistency:** `trialActive: boolean` (required) on `Boards.access`; `trialActive?: boolean` (optional) on `TeamPanel` and `TeamSection` — deliberately different, and each place says why. `TrialMarker({ testId })` takes one prop at both call sites. `formatInstantLabel(instant: number): string` and `trialEndsOnLine(endsOn: string): string` are used with those signatures in Tasks 2, 4 and the card. Test ids: `trial-active`, `trial-marker-personal`, `trial-marker-team`, used identically in Tasks 4, 7, 8 and 9.
