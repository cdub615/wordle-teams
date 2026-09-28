# Pro Pricing — Annual-Led Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the trial's end visible to the player it happened to, so the upgrade prompt the pricing decision depends on can exist at all.

**Architecture:** The spec's "annual-led" behaviours turned out to be mostly built. What is missing is one fact: `insightsAccess` cannot tell a player whose trial ENDED from one who never had a trial, so no UI can say "your trial is over". This plan adds that distinction to the pure function, exposes the access object through a query, and renders one prompt from it.

**Tech Stack:** Convex (queries, pure helpers in `convex/lib/`), TanStack Start + React, vitest, convex-test.

---

## What this plan does NOT do, because it is already done

Verified in the working tree on 2026-09-10. Do not re-implement any of this.

- **Annual-first plan selection.** `convex/polar.ts`'s `proProductIds()` already
  returns `[annual, monthly]`, Polar renders a multi-product checkout in the
  order passed, and `convex/polar.test.ts:328` already pins the order with the
  reasoning. The spec's "annual is preselected" is satisfied by code that predates
  the spec.
- **The trial itself.** `insightsTrialEndsAt` exists on `convex/schema.ts:101`,
  `insightsAccessFor` reads it (`convex/access.ts:294`), `shouldStartTrial` and
  `trialEndsAtFor` are implemented and tested in
  `convex/lib/insightsAccess.test.ts`.
- **Setting the price.** An in-place edit on two existing Polar products, gated on
  `wordle-teams-418.1`. A dashboard action by the owner. No code, no deploy.

**The only code the pricing decision needs is the prompt, and the prompt needs a
fact that does not currently exist.**

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `v2/convex/lib/insightsAccess.ts` | The pure access decision. Gains `trialExpired`. | Modify |
| `v2/convex/lib/insightsAccess.test.ts` | Pins the decision, including the new distinction. | Modify |
| `v2/convex/insights.ts` | Adds `myAccess`, the query that hands access to the client. Deliberately untestable by unit tests — see Task 2. | Modify |
| `v2/src/components/trial-ended-card.tsx` | Renders the prompt. One component, one job. | Create |
| `v2/src/lib/trial-copy.ts` | The words. Separated from the component, as `billing-copy.ts` is. | Create |
| `v2/src/lib/trial-copy.test.ts` | Pins the copy decisions. | Create |
| `v2/src/routes/insights.tsx` | Mounts the card. | Modify |
| `v2/e2e/billing.spec.ts` | The only cover for `myAccess`'s wiring. | Modify |

---

## Task 1: `insightsAccess` distinguishes an expired trial from no trial

**Files:**
- Modify: `v2/convex/lib/insightsAccess.ts:86-99` (type), `:118-141` (function)
- Test: `v2/convex/lib/insightsAccess.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `v2/convex/lib/insightsAccess.test.ts`:

```ts
describe('trialExpired — the distinction a prompt cannot be written without', () => {
  // THE WHOLE POINT OF THIS FIELD. Before it, a player whose trial ended and a
  // player who never had one were indistinguishable: both got
  // trialActive:false, trialEndsAt:null. A prompt built on that would either
  // stay silent for the person it is for, or nag someone who never had a trial.
  test('a trial that has ended reads as expired', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: 1_000, now: 2_000 })
    expect(access.trialActive).toBe(false)
    expect(access.trialExpired).toBe(true)
  })

  test('never having had a trial is NOT expired', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: undefined, now: 2_000 })
    expect(access.trialActive).toBe(false)
    expect(access.trialExpired).toBe(false)
  })

  test('a running trial is neither active-and-expired nor expired', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: 3_000, now: 2_000 })
    expect(access.trialActive).toBe(true)
    expect(access.trialExpired).toBe(false)
  })

  // Strictly after, matching trialActive's own boundary rule, and tested on both
  // sides because a threshold tested in one direction is vacuous.
  test('the instant it ends, it is expired and not active', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: 2_000, now: 2_000 })
    expect(access.trialActive).toBe(false)
    expect(access.trialExpired).toBe(true)
  })

  // A PRO PLAYER IS NOT SHOWN AN UPGRADE PROMPT, even though their trial did
  // technically end. This is the field's one non-obvious rule and it is why the
  // prompt can render straight from it without a second condition.
  test('a pro player whose trial ended is not expired, because they upgraded', () => {
    const access = insightsAccess({ isPro: true, trialEndsAt: 1_000, now: 2_000 })
    expect(access.trialExpired).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd v2 && pnpm exec vitest run convex/lib/insightsAccess.test.ts`

Expected: FAIL. TypeScript reports `Property 'trialExpired' does not exist on type 'InsightsAccess'`.

- [ ] **Step 3: Add the field to the type**

In `v2/convex/lib/insightsAccess.ts`, inside the `InsightsAccess` type, after the
`trialActive` line:

```ts
  /**
   * A trial ran and is over, and the player did not upgrade.
   *
   * NOT simply `!trialActive`: someone who never started a trial has no trial to
   * be told about, and a Pro player who converted must not be nagged about the
   * trial they converted from. This field is the difference between a prompt
   * aimed at one person and a banner shown to everybody.
   */
  trialExpired: boolean
```

- [ ] **Step 4: Compute it**

In the same file, replace the `return { ... }` block of `insightsAccess` with:

```ts
  return {
    layer1: isPro ? 'full' : 'free',
    layer2: paid ? 'full' : 'none',
    layer3: paid ? 'full' : 'free',
    layer4: isPro ? 'full' : 'none',
    trialActive,
    trialEndsAt: trialActive ? (trialEndsAt ?? null) : null,
    trialExpired: !isPro && trialEndsAt !== undefined && !trialActive,
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd v2 && pnpm exec vitest run convex/lib/insightsAccess.test.ts`

Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add v2/convex/lib/insightsAccess.ts v2/convex/lib/insightsAccess.test.ts
git commit -m "feat(insights): distinguish an expired trial from never having had one"
```

---

## Task 2: Expose access to the client

`insightsAccessFor` is called only from inside other queries to gate their data.
Nothing returns the access object itself, so the client cannot know the trial
ended.

**THIS TASK HAS NO UNIT TEST, AND THAT IS A DELIBERATE CONSEQUENCE OF A KNOWN
GAP.** `wordle-teams-obw` records it: convex-test cannot stand up a Better Auth
session, so `authComponent.getAuthUser` never resolves and the BODY of every
authed query wrapper in this codebase is unreachable by the unit suite. A test
calling `t.query(api.insights.myAccess, {})` would not exercise the handler.

The repo's answer to that gap is the shape this task follows: keep the wrapper
trivial and push every decision into a helper that IS testable. The decision here
— `trialExpired` — was pushed into `insightsAccess` by Task 1 and is tested
there. `insightsAccessFor` is already tested directly in
`convex/insightsTrial.test.ts`, which calls it inside `t.run` with a real `ctx`
rather than through a query. What is left in the wrapper is a lookup and a
forward, and Task 6's e2e is what covers it.

**Files:**
- Modify: `v2/convex/insights.ts`

- [ ] **Step 1: Add the type import**

In `v2/convex/insights.ts`, beside the existing imports:

```ts
import type { InsightsAccess } from './lib/insightsAccess'
```

`currentPlayer` and `insightsAccessFor` are already imported on line 3.

- [ ] **Step 2: Add the query**

In `v2/convex/insights.ts`, before `myBenchmarkBoards`:

```ts
/**
 * The caller's own insights access, returned rather than merely applied.
 *
 * Every other query in this file computes access to gate its OWN payload and
 * returns none of it, so before this the client had no way to know a trial had
 * ended — only that Layer 2 had gone quiet. That is the difference between a
 * player who upgrades and a player who assumes the feature broke.
 *
 * DELIBERATELY TRIVIAL. convex-test cannot authenticate (wordle-teams-obw), so
 * anything decided in this body would be untestable by the unit suite. The one
 * decision — what counts as an expired trial — lives in lib/insightsAccess.ts
 * and is pinned there; this is a lookup and a forward, and e2e covers the wiring.
 *
 * NULL FOR A SIGNED-OUT CALLER, matching the rest of this file: an
 * unauthenticated read is an expected state on a route that renders before auth
 * resolves, not an error worth throwing over.
 */
export const myAccess = query({
  args: {},
  handler: async (ctx): Promise<InsightsAccess | null> => {
    const player = await currentPlayer(ctx)
    if (!player) return null
    return await insightsAccessFor(ctx, player._id)
  },
})
```

- [ ] **Step 3: Verify it compiles and the suite still passes**

```bash
cd v2
pnpm run typecheck; echo "TSC=$?"
pnpm exec vitest run convex/; echo "TEST=$?"
```

Expected: both `=0`.

- [ ] **Step 4: Commit**

```bash
git add v2/convex/insights.ts
git commit -m "feat(insights): return the caller's own access so the client can see a trial end"
```

---

## Task 3: The copy, separate from the component

`src/lib/billing-copy.ts` exists because "the copy is the deliverable, the
component is not". Same reasoning, same shape.

**Files:**
- Create: `v2/src/lib/trial-copy.ts`
- Test: `v2/src/lib/trial-copy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/trial-copy.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { TRIAL_ENDED_BODY, TRIAL_ENDED_CTA, TRIAL_ENDED_TITLE } from './trial-copy'

describe('the trial-ended prompt', () => {
  // THE POSITIONING LINE IS THE PRODUCT DECISION, chosen in
  // docs/superpowers/specs/2026-09-05-pro-tier-and-insights-design.md and
  // repeated in the pricing spec. If this drifts, the pricing page, the launch
  // email and this card stop agreeing with each other.
  test('says what Pro is, in the words the spec chose', () => {
    expect(TRIAL_ENDED_BODY).toContain('everything you have done')
  })

  test('does not disparage the monthly plan', () => {
    // The pricing spec is explicit: at $4.99 vs $49 monthly is worth MORE across
    // a fully retained year, so calling it the worse deal would be inaccurate.
    // Annual is led because it is certain, not because monthly is bad.
    const all = `${TRIAL_ENDED_TITLE} ${TRIAL_ENDED_BODY} ${TRIAL_ENDED_CTA}`.toLowerCase()
    for (const bad of ['only', 'just $', 'instead of monthly', 'better than monthly']) {
      expect(all, `copy disparages or diminishes a plan: ${bad}`).not.toContain(bad)
    }
  })

  test('carries no price, because the price lives in Polar', () => {
    // Verified 2026-09-10: no price literal exists anywhere in src/ or convex/.
    // Putting one here creates a second source of truth that drifts silently
    // when the Polar dashboard changes.
    const all = `${TRIAL_ENDED_TITLE} ${TRIAL_ENDED_BODY} ${TRIAL_ENDED_CTA}`
    expect(all).not.toMatch(/\$\d/)
  })

  test('the call to action is a verb, not a noun', () => {
    expect(TRIAL_ENDED_CTA).toMatch(/^(See|Get|Upgrade|Keep)/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd v2 && pnpm exec vitest run src/lib/trial-copy.test.ts`

Expected: FAIL — `Cannot find module './trial-copy'`.

- [ ] **Step 3: Write the copy module**

Create `v2/src/lib/trial-copy.ts`:

```ts
/**
 * What the trial-ended prompt SAYS, separated from where it says it.
 *
 * Sibling of billing-copy.ts, and here for the same reason: the copy is the
 * deliverable and the component is not. A sentence chosen in a spec and then
 * typed straight into JSX is a product decision no test can reach.
 *
 * NO PRICE HERE. The price lives in Polar and reaches the customer on Polar's
 * hosted checkout. A number in this file would be a second source of truth that
 * goes stale the moment the dashboard changes, silently, with every gate green.
 */

/** Names what happened, without alarm. */
export const TRIAL_ENDED_TITLE = 'Your Insights trial has ended'

/**
 * The positioning line, chosen in the Pro-tier spec and repeated in the pricing
 * spec: "free shows you today, Pro shows you everything you have done." The
 * pricing page, the launch email and this card must all say the same thing.
 */
export const TRIAL_ENDED_BODY =
  'You can still see today. Pro shows you everything you have done — your full ' +
  'history, your team’s season, and every board you have ever entered.'

/** A verb, so the button reads as an action rather than a label. */
export const TRIAL_ENDED_CTA = 'See your history'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd v2 && pnpm exec vitest run src/lib/trial-copy.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/src/lib/trial-copy.ts v2/src/lib/trial-copy.test.ts
git commit -m "feat(billing): the trial-ended copy, in a tested module"
```

---

## Task 4: The card

**Files:**
- Create: `v2/src/components/trial-ended-card.tsx`

- [ ] **Step 1: Write the component**

There is no unit test for this file: it is wiring, and the two decisions inside
it (what it says, when it renders) are already pinned by Task 3 and Task 1
respectively. That split is this repo's convention — see `billing-copy.ts`'s own
header.

Create `v2/src/components/trial-ended-card.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import { useStartUpgrade } from '#/lib/use-start-upgrade.ts'
import { TRIAL_ENDED_BODY, TRIAL_ENDED_CTA, TRIAL_ENDED_TITLE } from '#/lib/trial-copy.ts'
import { Button } from '#/components/ui/button.tsx'
import { Card } from '#/components/ui/card.tsx'

/**
 * Shown to exactly one population: a player whose trial ended and who did not
 * upgrade. `trialExpired` carries that whole condition — it is false for a Pro
 * player and false for someone who never had a trial — so there is no second
 * check here and no chance of the two drifting apart.
 *
 * useQuery, NOT useSuspenseQuery, deliberately: this card is an aside. Suspending
 * the insights route on a prompt would make the page wait to tell somebody they
 * cannot see it.
 */
export function TrialEndedCard() {
  const { data: access } = useQuery(convexQuery(api.insights.myAccess, {}))
  const { startUpgrade, pending } = useStartUpgrade()

  if (!access?.trialExpired) return null

  return (
    <Card className="md:col-span-3 flex flex-col gap-3 p-4">
      <h2 className="text-lg font-semibold">{TRIAL_ENDED_TITLE}</h2>
      <p className="text-muted-foreground text-sm">{TRIAL_ENDED_BODY}</p>
      <Button className="self-start" disabled={pending} onClick={() => void startUpgrade()}>
        {TRIAL_ENDED_CTA}
      </Button>
    </Card>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd v2 && pnpm run typecheck`

Expected: exit 0, no output beyond the `tsc --noEmit` line.

If `Card` is not exported from `#/components/ui/card.tsx` under that name, check
the file and use whatever the repo's other cards import — do not add a new UI
primitive for this.

- [ ] **Step 3: Commit**

```bash
git add v2/src/components/trial-ended-card.tsx
git commit -m "feat(billing): a card that appears only for an expired trial"
```

---

## Task 5: Mount it

**Files:**
- Modify: `v2/src/routes/insights.tsx`

- [ ] **Step 1: Import and render**

In `v2/src/routes/insights.tsx`, add the import beside the other component
imports:

```tsx
import { TrialEndedCard } from '#/components/trial-ended-card.tsx'
```

Render it as the first child of the insights route's main content grid, above the
benchmark panel, so the explanation precedes the thing it explains:

```tsx
<TrialEndedCard />
```

- [ ] **Step 2: Verify the gates**

Run each and confirm the exit code separately, without a pipe — a code read after
a pipe is the last command's, not the gate's:

```bash
cd v2
pnpm run lint;      echo "LINT=$?"
pnpm run typecheck; echo "TSC=$?"
pnpm run test:once; echo "TEST=$?"
pnpm run build;     echo "BUILD=$?"
```

Expected: all four report `=0`.

- [ ] **Step 3: Commit**

```bash
git add v2/src/routes/insights.tsx
git commit -m "feat(insights): show the trial-ended prompt on the insights route"
```

---

## Task 6: An e2e assertion that the prompt appears

This is the only test that covers Task 2's wrapper at all, for the reason that
task records. It is also the only place the card's condition is checked across
the Convex query, the pure helper and the component together.

**Files:**
- Modify: `v2/e2e/billing.spec.ts`

- [ ] **Step 1: Write the spec**

Append to `v2/e2e/billing.spec.ts`. It already imports `ConvexHttpClient`, `api`
and `signIn`, and already seeds with `api.e2eSeed.ensureTeamFor` (line 134) —
this uses the same two calls:

```ts
test('a player whose trial has ended is told, and offered the upgrade', async ({ page }) => {
  // THE WIRING NO UNIT TEST REACHES. convex-test cannot authenticate
  // (wordle-teams-obw), so api.insights.myAccess's handler is unreachable there;
  // this is what proves the query, insightsAccess's trialExpired and the card
  // agree with each other.
  const email = `e2e+trial-ended-${Date.now()}@example.test`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await convex.mutation(api.e2eSeed.seedInsightsFor, {
    email,
    boards: 3,
    lastDay: new Date().toISOString().slice(0, 10),
    pro: false,
    // A PAST timestamp is what makes the trial expired rather than absent —
    // seedInsightsFor's own arg comment says so.
    trialEndsAt: Date.now() - 24 * 60 * 60 * 1000,
  })

  await signIn(page, email)
  await page.goto('/insights')

  await expect(page.getByText('Your Insights trial has ended')).toBeVisible()
  await expect(page.getByRole('button', { name: 'See your history' })).toBeVisible()
})
```

The address must start with `e2e+`: `seedInsightsFor` throws unless
`isE2eTraffic(email, process.env.E2E_TEST_MODE)` passes.

- [ ] **Step 2: Run it**

Run: `cd v2 && pnpm e2e -- billing.spec.ts`

Expected: PASS.

**Two traps this repo has hit before.** Playwright will attach to whatever already
holds `:3000`, so a stale dev server means testing old code — confirm the server
is serving this branch before trusting either result. And e2e runs against a local
Convex backend with `E2E_TEST_MODE` set; it is not part of `pnpm test:once`, so a
green unit suite says nothing about this spec.

- [ ] **Step 3: Commit**

```bash
git add v2/e2e/billing.spec.ts
git commit -m "test(e2e): the trial-ended prompt reaches the player it is for"
```

---

## Not in this plan, and why

- **Setting the price.** An in-place edit on two existing Polar products, gated on
  `wordle-teams-418.1`'s GO/NO-GO: $49/$4.99 on GO, $39/$3.99 on NO-GO. A
  dashboard action with no code behind it.
- **Launch-email copy.** Owned by `wordle-teams-7e3c`, which already carries the
  terms-change notice obligation. It should reuse `TRIAL_ENDED_BODY`'s positioning
  line so the two agree, but the email is not built here.
- **A pricing page.** No `/pricing` route exists and the spec does not ask for one.
  The upgrade path is the checkout, and the positioning line now lives in a module
  any future page can import.
- **Stating the saving in the customer's terms** — the spec's second annual-led
  behaviour, "$49/year, or $4.99/month". It is NOT dropped: Polar's hosted
  checkout already renders both products side by side with their prices, annual
  first, which is where a customer actually chooses. Restating the figures in our
  own UI would put a price literal in the codebase, and Task 3's copy test exists
  specifically to forbid that — a second source of truth that goes stale silently
  when the dashboard changes. If a pricing PAGE is ever built, it should read the
  numbers from Polar rather than hard-code them.
- **Anything touching activation.** Worth more than everything in this plan — 87%
  of signups never enter a board — and it belongs to `wordle-teams-456` and `qt4`.
