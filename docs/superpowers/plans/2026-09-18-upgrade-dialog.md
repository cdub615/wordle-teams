# Upgrade Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No upgrade affordance reaches checkout without first saying what Pro includes.

**Architecture:** A price-only typed source (`src/lib/plans.ts`) joins the existing benefit inventory (`src/lib/pro-benefits.ts`). One `UpgradeDialogProvider` mounted at `__root` exposes `openUpgrade(origin)`; the six affordances call that instead of `startUpgrade()`, and the dialog's own CTA becomes the single remaining caller of `useStartUpgrade` — enforced by a source test.

**Tech Stack:** TanStack Start + React 19, Radix dialog via `src/components/ui/dialog.tsx`, vitest (edge-runtime by default, jsdom in `*.hook.test.ts`), Convex, Polar.

**Spec:** `docs/superpowers/specs/2026-09-18-marketing-pages-and-upgrade-dialog-design.md` (§4, §5.2, §8, §9)

**Working directory:** all paths are relative to `v2/`. Run every command from `v2/`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/plans.ts` (create) | Prices, plan order, price copy, per-origin headlines. The only module in the repo holding a price literal. |
| `src/lib/plans.test.ts` (create) | Pins annual-first, the price shapes, the six origins, and that no copy presents monthly as better value. |
| `src/components/upgrade-dialog.tsx` (create) | `UpgradeDialogProvider`, `useUpgrade()`, and the dialog itself. The only caller of `useStartUpgrade`. |
| `src/components/upgrade-dialog.hook.test.ts` (create) | jsdom: headline per origin, every benefit rendered, CTA reaches checkout, dismissal. |
| `src/routes/__root.tsx` (modify) | Mounts the provider around `<Outlet />`. |
| `src/components/Header.tsx` (modify) | Upgrade button opens the dialog. |
| `src/routes/app.tsx` (modify) | TeamPicker and MonthPicker `onUpgrade` open the dialog. |
| `src/components/board-entry/import-upsell.tsx` (modify) | Upgrade button opens the dialog. |
| `src/components/trial-ended-card.tsx` (modify) | CTA opens the dialog. |
| `src/routes/insights.tsx` (modify) | The locked card's `onUpgrade` opens the dialog. |
| `src/lib/trial-copy.test.ts` (modify) | Corrects the recorded reason annual leads. |
| `src/checkout-entry-point.test.ts` (create) | Graph test: exactly one importer of `use-start-upgrade.ts`. |

`src/lib/pro-benefits.ts` is **consumed and not modified**. `src/lib/use-start-upgrade.ts` is **not modified** — its behaviour is already correct; only its caller set changes.

---

### Task 1: The price source

**Files:**
- Create: `src/lib/plans.ts`
- Test: `src/lib/plans.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/plans.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  MONTHLY_FINE_PRINT,
  PLANS,
  PRO_PRICE_LINE,
  UPGRADE_HEADLINES,
  type UpgradeOrigin,
} from './plans.ts'

describe('PLANS', () => {
  test('leads with annual, which is how Polar presents it too', () => {
    // convex/polar.ts's proProductIds() returns annual first "so it presents
    // first", pinned in polar.test.ts. This is the display side of the same
    // decision, and the two must not drift apart.
    expect(PLANS.map((plan) => plan.id)).toEqual(['annual', 'monthly'])
  })

  test('every price is a whole dollars-and-cents literal', () => {
    for (const plan of PLANS) {
      expect(plan.price).toMatch(/^\$\d+\.\d{2}$/)
    }
  })

  test('the label is the price and its interval, not a bare number', () => {
    expect(PLANS[0].label).toBe('$49.99/year')
    expect(PLANS[1].label).toBe('$4.99/month')
  })
})

describe('the price copy', () => {
  test('the line we lead with names the annual price', () => {
    expect(PRO_PRICE_LINE).toContain('$49.99/year')
    expect(PRO_PRICE_LINE).not.toContain('$4.99')
  })

  test('monthly appears, as fine print, and is never sold as the better value', () => {
    // wordle-teams-iht's fee schedule is Polar Starter, 5.0% + $0.50 per
    // transaction: twelve charges a year cost $8.99 against annual's $3.00, and
    // annual nets more for any subscriber who lasts under 11.1 months. Monthly
    // stays available and undisparaged; what it must never be is the pitch.
    expect(MONTHLY_FINE_PRINT).toContain('$4.99/month')
    expect(MONTHLY_FINE_PRINT).not.toMatch(/best value|better value|save|cheaper|only/i)
  })
})

describe('UPGRADE_HEADLINES', () => {
  const ORIGINS: UpgradeOrigin[] = [
    'header',
    'teams',
    'months',
    'import',
    'insights',
    'trial-ended',
  ]

  test('has a line for every origin and no others', () => {
    expect(Object.keys(UPGRADE_HEADLINES).sort()).toEqual([...ORIGINS].sort())
  })

  test('every line is a short sentence, so it fits a dialog title at 390px', () => {
    for (const origin of ORIGINS) {
      const line = UPGRADE_HEADLINES[origin]
      expect(line.length).toBeGreaterThan(0)
      expect(line.length).toBeLessThanOrEqual(60)
    }
  })

  test('uses typographic apostrophes and no typewriter ones', () => {
    // Same rule pro-benefits.test.ts pins for its own copy.
    for (const line of Object.values(UPGRADE_HEADLINES)) {
      expect(line).not.toContain("'")
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `TZ=UTC pnpm vitest run src/lib/plans.test.ts`
Expected: FAIL — `Failed to resolve import "./plans.ts"`.

- [ ] **Step 3: Write the module**

Create `src/lib/plans.ts`:

```ts
/**
 * WHAT PRO COSTS — the one module in this repo that holds a price.
 *
 * Sibling of pro-benefits.ts, and the division between them is deliberate:
 * that file is WHAT Pro includes and is forbidden to quote a price (its own
 * test pins "quotes no price, in any of the shapes a price takes"); this file
 * is what it costs and quotes nothing about what it does.
 *
 * IT KNOWINGLY DEPARTS FROM "NO PRICE HERE", which trial-copy.ts and
 * pro-benefits.ts both state. That rule was written when the price reached the
 * customer only on Polar's hosted checkout, so a number in the codebase was a
 * second source of truth with no reader. A public /pricing page changes that:
 * a pricing page with no prices is not one. The departure is confined to this
 * module and backstopped by scripts/check-polar-prices.mjs, which compares
 * these literals against Polar's products. The rule stands everywhere else.
 *
 * ANNUAL LEADS, AND THE REASON IS THE FEE SCHEDULE RATHER THAN THE HEADLINE
 * NUMBER. wordle-teams-iht records Polar Starter at 5.0% + $0.50 per
 * transaction. Per subscriber per year: monthly is $59.88 gross less $8.99 in
 * twelve fees, annual is $49.99 gross less $3.00 in one. Monthly's fee share is
 * 15.0% against annual's 6.0%, and the net gap that still favours monthly
 * exists only at FULL retention — annual nets more the moment a monthly
 * subscriber lasts under 11.1 months, which for a $5 consumer subscription is
 * the common case. Annual also removes eleven further chances a year at
 * involuntary churn on an expired card.
 *
 * MONTHLY IS NEVER DISPARAGED AND NEVER PROMOTED. It is a real choice for
 * someone who will not commit a year. What no surface may do is present it as
 * the better value; plans.test.ts pins that as a property of the copy.
 */

export type PlanId = 'annual' | 'monthly'

export type Plan = {
  id: PlanId
  /** The billing interval, as the customer reads it. */
  interval: 'year' | 'month'
  /** Dollars and cents, with the sign. Compared against Polar by the drift script. */
  price: string
  /** Price and interval together — what a surface renders. */
  label: string
}

/**
 * ORDER IS THE PRODUCT DECISION, not a list of two things. convex/polar.ts's
 * proProductIds() returns annual first so Polar's hosted checkout presents it
 * first; this is the same decision on the display side, and plans.test.ts pins
 * it here exactly as polar.test.ts pins it there.
 */
export const PLANS: ReadonlyArray<Plan> = [
  { id: 'annual', interval: 'year', price: '$49.99', label: '$49.99/year' },
  { id: 'monthly', interval: 'month', price: '$4.99', label: '$4.99/month' },
]

const annual = PLANS[0]
const monthly = PLANS[1]

/** The price line every surface leads with. Derived, so there is one source. */
export const PRO_PRICE_LINE = `Pro is ${annual.label}`

/** Monthly, stated plainly and quietly. Never a comparison. */
export const MONTHLY_FINE_PRINT = `or ${monthly.label}`

/**
 * Where an upgrade was asked for. Six affordances, six lines.
 *
 * THE HEADLINE VARIES AND THE BODY DOES NOT. Someone who clicked "Import from a
 * screenshot" has demonstrated interest in import specifically, and a generic
 * Pro pitch wastes the one moment they created. The benefits list beneath is
 * PRO_BENEFITS in full for every origin — one inventory, six openings.
 */
export type UpgradeOrigin = 'header' | 'teams' | 'months' | 'import' | 'insights' | 'trial-ended'

export const UPGRADE_HEADLINES: Record<UpgradeOrigin, string> = {
  header: 'Everything you have played, not just today',
  teams: 'Join as many teams as you like',
  months: 'Every month your team has ever played',
  import: 'Let a screenshot fill the board in for you',
  insights: 'See your team’s whole month, not just today',
  'trial-ended': 'Pick up where your trial left off',
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `TZ=UTC pnpm vitest run src/lib/plans.test.ts`
Expected: PASS, 8 tests.

(Executed 2026-09-19: review added three more guards — the free-tier constant
pin, the label/price invariant and the benefit-title collision check — so the
finished file has 11. See `05b21cf0`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/plans.ts src/lib/plans.test.ts
git commit -F - <<'EOF'
feat(plans): the price source, annual-led, with the fee arithmetic recorded

wordle-teams-iht.1. pro-benefits.ts is forbidden to quote a price and its
test pins that; a public pricing surface needs one. This is the single
module that holds it, with the departure from the "NO PRICE HERE" rule
argued in its banner rather than left for a reader to find twice.
EOF
```

---

### Task 2: Correct the recorded reason annual leads

**Files:**
- Modify: `src/lib/trial-copy.test.ts:14-16`

The comment there reads *"at $4.99/mo against $49.99/yr, monthly is worth MORE across a fully retained year ($59.88 vs $49.99), so calling it…"*. That is gross revenue with no mention of Polar's per-transaction fee and no mention of the retention assumption it depends on. Left alone, the next person designs against it — which is what happened while writing this plan's spec.

**A SECOND STALE COMMENT IN THE SAME FILE**, found by Task 1's code review: around
line 25 it reads *"Verified 2026-09-10: no price literal exists anywhere in src/
or convex/."* Task 1 made that false. It is a dated factual claim rather than a
rule, so it needs a carve-out naming `src/lib/plans.ts`, not deletion.

- [ ] **Step 1: Read the surrounding assertion**

Run: `sed -n '1,30p' src/lib/trial-copy.test.ts`
The assertion itself does not change — only the comment explaining why it is what it is.

- [ ] **Step 2: Replace the comment**

Replace the two comment lines quoted above with:

```ts
    // The pricing spec led with gross revenue — $59.88 against $49.99 across a
    // fully retained year — which is true and is not the reason. On Polar
    // Starter (5.0% + $0.50, recorded on wordle-teams-iht) monthly pays TWELVE
    // fixed fees a year: $8.99 in fees against annual's $3.00, a 15.0% fee
    // share against 6.0%. The net gap that still favours monthly survives only
    // at full retention — annual nets more below 11.1 months of tenure. So
    // monthly is a real choice and must not be disparaged, but it is never the
    // better value and no copy may imply it is. See src/lib/plans.ts.
```

- [ ] **Step 3: Run the suite for that file**

Run: `TZ=UTC pnpm vitest run src/lib/trial-copy.test.ts`
Expected: PASS, unchanged count — this step changes no behaviour.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trial-copy.test.ts
git commit -F - <<'EOF'
docs(trial-copy): record why annual leads, fees included

The comment recorded gross revenue only, so it read as "monthly is worth
more" with no fee and no retention assumption attached. Corrected against
the Starter schedule on wordle-teams-iht. No assertion changed.
EOF
```

---

### Task 3: The dialog and its provider

**Files:**
- Create: `src/components/upgrade-dialog.tsx`
- Test: `src/components/upgrade-dialog.hook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/upgrade-dialog.hook.test.ts`:

```ts
// @vitest-environment jsdom
//
// jsdom and `.hook.test.ts` with createElement, matching every other component
// test here — vitest.config.ts's glob is `src/**/*.test.ts`, so .tsx would not run.
//
// useStartUpgrade is mocked because it calls useConvexAction, which needs a
// provider this test has no reason to stand up: what is under test is what the
// dialog SAYS and that the CTA reaches the one checkout path, not the checkout
// itself, which use-start-upgrade.ts already owns.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { PRO_BENEFITS } from '#/lib/pro-benefits.ts'
import { MONTHLY_FINE_PRINT, PRO_PRICE_LINE, UPGRADE_HEADLINES } from '#/lib/plans.ts'
import type { UpgradeOrigin } from '#/lib/plans.ts'

const startUpgrade = vi.fn()
vi.mock('#/lib/use-start-upgrade.ts', () => ({
  useStartUpgrade: () => ({ startUpgrade, pending: false }),
}))

const { UpgradeDialogProvider, useUpgrade } = await import('./upgrade-dialog.tsx')

afterEach(() => {
  cleanup()
  startUpgrade.mockClear()
})

/** A consumer that opens the dialog from a given origin on click. */
function Opener({ origin }: { origin: UpgradeOrigin }) {
  const { openUpgrade } = useUpgrade()
  return createElement('button', { onClick: () => openUpgrade(origin) }, 'open')
}

const open = (origin: UpgradeOrigin) => {
  render(createElement(UpgradeDialogProvider, null, createElement(Opener, { origin })))
  fireEvent.click(screen.getByText('open'))
}

describe('the upgrade dialog', () => {
  test('opens with the headline for the origin it was asked from', () => {
    open('import')
    expect(screen.getByText(UPGRADE_HEADLINES.import)).toBeTruthy()
  })

  test('has a headline for every origin, and renders it', () => {
    for (const origin of Object.keys(UPGRADE_HEADLINES) as UpgradeOrigin[]) {
      open(origin)
      expect(screen.getByText(UPGRADE_HEADLINES[origin])).toBeTruthy()
      cleanup()
    }
  })

  /**
   * THE DRIFT GATE, AND THE REASON THIS WORK EXISTS. A sixth entry added to
   * PRO_BENEFITS fails here until the dialog names it, which is what stops the
   * product growing a feature its own paywall never mentions.
   */
  test('names every benefit in the inventory, whatever the origin', () => {
    open('header')
    for (const benefit of PRO_BENEFITS) {
      expect(screen.getByText(benefit.title)).toBeTruthy()
    }
  })

  test('leads with the annual price and carries monthly as fine print', () => {
    open('header')
    expect(screen.getByText(PRO_PRICE_LINE)).toBeTruthy()
    expect(screen.getByText(MONTHLY_FINE_PRINT)).toBeTruthy()
  })

  /**
   * PROMINENCE, NOT WORDING, IS WHERE "MONTHLY IS NEVER THE BETTER VALUE" LIVES
   * (added after Task 1's review). plans.test.ts can only pin the two strings;
   * whether monthly reads as the pitch is a question of where each one sits.
   * The annual line is the dialog's description — directly under the title —
   * and monthly is muted fine print in the footer.
   */
  test('leads with annual by placement, not only by wording', () => {
    open('header')
    const description = screen.getByText(PRO_PRICE_LINE)
    const finePrint = screen.getByText(MONTHLY_FINE_PRINT)

    expect(description.id).toBe(
      screen.getByRole('dialog').getAttribute('aria-describedby'),
    )
    expect(finePrint.className).toContain('text-muted-foreground')
    expect(finePrint.className).toContain('text-xs')
  })

  test('the CTA reaches the one checkout path', () => {
    open('insights')
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(startUpgrade).toHaveBeenCalledTimes(1)
  })

  test('dismissing it starts no checkout', () => {
    open('teams')
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(startUpgrade).not.toHaveBeenCalled()
    expect(screen.queryByText(UPGRADE_HEADLINES.teams)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `TZ=UTC pnpm vitest run src/components/upgrade-dialog.hook.test.ts`
Expected: FAIL — `Failed to resolve import "./upgrade-dialog.tsx"`.

- [ ] **Step 3: Write the component**

Create `src/components/upgrade-dialog.tsx`:

```tsx
import { createContext, useContext, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { PRO_BENEFITS } from '#/lib/pro-benefits.ts'
import { MONTHLY_FINE_PRINT, PRO_PRICE_LINE, UPGRADE_HEADLINES } from '#/lib/plans.ts'
import type { UpgradeOrigin } from '#/lib/plans.ts'
import { useStartUpgrade } from '#/lib/use-start-upgrade.ts'

/**
 * WHAT PRO INCLUDES, SAID BEFORE ANYBODY IS ASKED TO PAY (wordle-teams-iht.1).
 *
 * Before this, every upgrade affordance called startUpgrade() and the player
 * arrived at Polar's checkout having been told nothing — and the one place Pro
 * WAS described, the landing page's feature cards, is a page a signed-in player
 * never sees, because routes/index.tsx redirects them to /app.
 *
 * A PROVIDER, NOT SIX MOUNTS. Six affordances in five files need this surface;
 * mounting it beside each would be six dialogs to keep in step and six chances
 * for the next one to be added without it. One mount at __root, one
 * `openUpgrade(origin)`, and — the part that matters — the CTA below is the
 * ONLY remaining caller of useStartUpgrade in the app. routes.test.ts asserts
 * that as a source property, because a second unguarded path would defeat the
 * whole thing and would type-check, lint and build clean.
 *
 * THE HEADLINE IS THE ONLY THING THAT VARIES. The benefits list is PRO_BENEFITS
 * in full for every origin: one inventory, six openings. Nothing here writes a
 * benefit of its own, and the test fails if the inventory grows an entry this
 * does not render.
 *
 * NO SKIP-TO-CHECKOUT PATH. The CTA below IS the checkout, so skipping saves
 * exactly one click, and the thing being skipped is the only statement of what
 * is being bought.
 */
type UpgradeContextValue = { openUpgrade: (origin: UpgradeOrigin) => void }

const UpgradeContext = createContext<UpgradeContextValue | null>(null)

export function useUpgrade(): UpgradeContextValue {
  const value = useContext(UpgradeContext)
  // A THROW RATHER THAN A NO-OP DEFAULT: a silently dead upgrade button is
  // indistinguishable from a working one until someone tries to pay.
  if (!value) throw new Error('useUpgrade must be used inside UpgradeDialogProvider')
  return value
}

export function UpgradeDialogProvider({ children }: { children: React.ReactNode }) {
  const [origin, setOrigin] = useState<UpgradeOrigin | null>(null)
  const value = useMemo(() => ({ openUpgrade: setOrigin }), [])

  return (
    <UpgradeContext.Provider value={value}>
      {children}
      <UpgradeDialog origin={origin} onClose={() => setOrigin(null)} />
    </UpgradeContext.Provider>
  )
}

function UpgradeDialog({
  origin,
  onClose,
}: {
  origin: UpgradeOrigin | null
  onClose: () => void
}) {
  const { startUpgrade, pending } = useStartUpgrade()

  return (
    <Dialog open={origin !== null} onOpenChange={(next) => !next && onClose()}>
      {/*
        THE WHOLE PANEL SCROLLS, AND THE CTA SCROLLS WITH IT. The spec asked for
        a pinned footer; DialogContent is why this does not do that. That
        component already bounds its own height against the safe-area insets and
        sets `overflow-y-auto` on itself (wordle-teams-8h2p) — pinning a footer
        would mean overriding that with `overflow-hidden` plus a flex column, and
        `cn`'s tailwind-merge silently drops whichever of two conflicting
        overflow utilities it likes less, which is exactly the failure
        ui/dialog.hook.test.ts exists to catch. Five benefits is not a long
        document; the 390px check in Task 8 confirms the CTA is reachable.
      */}
      <DialogContent className="space-y-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{origin ? UPGRADE_HEADLINES[origin] : ''}</DialogTitle>
          <DialogDescription>{PRO_PRICE_LINE}</DialogDescription>
        </DialogHeader>
        <ul className="m-0 list-none space-y-3 p-0 text-sm">
          {PRO_BENEFITS.map((benefit) => (
            <li key={benefit.id} className="space-y-1">
              <p className="m-0 font-medium text-foreground">{benefit.title}</p>
              <p className="m-0 text-muted-foreground">{benefit.body}</p>
            </li>
          ))}
        </ul>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-xs text-muted-foreground">{MONTHLY_FINE_PRINT}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Not now
            </Button>
            <Button disabled={pending} aria-disabled={pending} onClick={() => void startUpgrade()}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Upgrade
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `TZ=UTC pnpm vitest run src/components/upgrade-dialog.hook.test.ts`
Expected: PASS, 6 tests.

If `DialogContent` requires a description for accessibility and warns, the
`DialogDescription` above satisfies it — do not remove it to silence a lint.

- [ ] **Step 5: Commit**

```bash
git add src/components/upgrade-dialog.tsx src/components/upgrade-dialog.hook.test.ts
git commit -F - <<'EOF'
feat(upgrade): a dialog that says what Pro includes, before checkout

wordle-teams-iht.1. One provider, one mount, one openUpgrade(origin). The
headline varies by where it was asked from; the body is PRO_BENEFITS in
full, so a sixth benefit fails the test until this names it.
EOF
```

---

### Task 4: Mount the provider

**Files:**
- Modify: `src/routes/__root.tsx:269-271`

- [ ] **Step 1: Wrap the Outlet**

The current subtree is:

```tsx
      <Header />
      <Outlet />
      {hidesSiteFooter(pathname) ? null : <Footer />}
```

Replace with:

```tsx
      {/*
        THE PROVIDER WRAPS HEADER TOO, not only the Outlet: Header.tsx's own
        Upgrade button is one of the six affordances, so it has to be inside.
        One mount for the whole app is the point — see upgrade-dialog.tsx.
      */}
      <UpgradeDialogProvider>
        <Header />
        <Outlet />
        {hidesSiteFooter(pathname) ? null : <Footer />}
      </UpgradeDialogProvider>
```

Add the import beside the existing component imports:

```tsx
import { UpgradeDialogProvider } from '#/components/upgrade-dialog.tsx'
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0, no output beyond the command echo.

- [ ] **Step 3: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "feat(upgrade): mount the upgrade dialog once, at the root"
```

---

### Task 5: Rewire the Header and the two pickers

**Files:**
- Modify: `src/components/Header.tsx:76` and `:255-275`
- Modify: `src/routes/app.tsx:323` and `:1220`, `:1227`

- [ ] **Step 1: Header — swap the hook for the opener**

Replace line 76's `const { startUpgrade, pending: upgradePending } = useStartUpgrade()` with:

```tsx
  const { openUpgrade } = useUpgrade()
```

Replace the button's `disabled={upgradePending}` and `onClick={() => void startUpgrade()}` with:

```tsx
              onClick={() => openUpgrade('header')}
```

and replace the spinner ternary with the plain icon, since nothing is pending here any more:

```tsx
              <Sparkles className="h-4 w-4" aria-hidden="true" />
```

Update the imports: drop `useStartUpgrade` and `Loader2` if `Loader2` has no other use in the file (check with `grep -n "Loader2" src/components/Header.tsx`), and add:

```tsx
import { useUpgrade } from '#/components/upgrade-dialog.tsx'
```

Update the comment at `:74` — it currently reads "Shared with routes/app.tsx's 'Upgrade for more' — one copy of the outcome". Replace with:

```tsx
  // Opens the dialog rather than checkout (wordle-teams-iht.1). The spinner
  // this button used to own went with the hook: opening a dialog is
  // synchronous, and the pending state now lives on the dialog's own CTA.
```

- [ ] **Step 2: app.tsx — the two pickers**

Replace line 323's `const { startUpgrade } = useStartUpgrade()` with:

```tsx
  const { openUpgrade } = useUpgrade()
```

Replace TeamPicker's `onUpgrade={() => void startUpgrade()}` with:

```tsx
          onUpgrade={() => openUpgrade('teams')}
```

Replace MonthPicker's with:

```tsx
          onUpgrade={() => openUpgrade('months')}
```

Swap the import of `useStartUpgrade` for `useUpgrade` as in step 1.

- [ ] **Step 3: Update `src/components/Header.hook.test.ts`, which this breaks**

Two things break it, and both are the change working as intended.

**(a) Every render needs the provider.** `useUpgrade()` throws without one — a
deliberate choice, since a silently dead upgrade button is indistinguishable
from a working one until someone tries to pay. Add to the imports:

```ts
import { UpgradeDialogProvider } from './upgrade-dialog.tsx'
```

and add `within` to the existing `@testing-library/react` import. Then add this
helper beside `buttons()` and replace every `render(createElement(Header))` in
the file with `bar()`:

```ts
/**
 * Header inside the provider it now depends on. useUpgrade() throws without
 * one by design (see upgrade-dialog.tsx), and the closed dialog renders
 * nothing, so `buttons()` below is unaffected by the wrapper.
 */
const bar = () => render(createElement(UpgradeDialogProvider, null, createElement(Header)))
```

**(b) The three tests in `describe('Upgrade reaches the action its label
promises')` now describe a two-step journey.** Header's button opens the dialog;
the dialog's CTA reaches checkout. They keep their value — they are the only
CI-runnable cover on the checkout outcomes — so they click through rather than
moving. Note the scoping: once the dialog is open there are two buttons named
"Upgrade", so the second click must be scoped with `within`.

```ts
  /** Opens the dialog from the bar, and returns its CTA. */
  const ctaFromBar = () => {
    bar()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    return within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Upgrade',
    }) as HTMLButtonElement
  }

  test('Upgrade starts a CHECKOUT and navigates to Polar', async () => {
    isPro = false
    createCheckout.mockResolvedValue({ url: 'https://polar.example/checkout/abc' })

    fireEvent.click(ctaFromBar())

    await waitFor(() => expect(location.href).toBe('https://polar.example/checkout/abc'))
    expect(createCheckout).toHaveBeenCalledWith({})
  })

  test('and reports its own misconfiguration', async () => {
    // The checkout and the portal have separate sentences so a player can tell
    // which affordance failed; the portal half of that pair is asserted in
    // app-menu.hook.test.ts, against the same two constants.
    isPro = false

    fireEvent.click(ctaFromBar())

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(CHECKOUT_NOT_CONFIGURED))
    expect(toastError).not.toHaveBeenCalledWith(PORTAL_NOT_CONFIGURED)
    expect(location.href).toBe('http://localhost:3000/app')
  })

  test('the CTA is disabled for the round trip and comes back afterwards', async () => {
    // THE BUTTON THAT PENDS MOVED WITH THE CHECKOUT. Header's button now opens
    // a dialog, which is synchronous and has nothing to wait for; the dialog's
    // CTA is what owns the round trip, so it is what must not strand a player
    // on a dead control. e2e/billing.spec.ts makes the identical assertion
    // about the portal, and this is the half CI can actually run.
    isPro = false
    let release: (result: { url: null; reason: 'error' }) => void = () => {}
    createCheckout.mockReturnValue(new Promise((resolve) => (release = resolve)))

    // `.disabled`, not a jest-dom matcher: @testing-library/jest-dom is not
    // installed in this repo and no suite here sets one up.
    const cta = ctaFromBar()
    expect(cta.disabled).toBe(false)

    fireEvent.click(cta)
    await waitFor(() => expect(cta.disabled).toBe(true))

    release({ url: null, reason: 'error' })
    await waitFor(() => expect(cta.disabled).toBe(false))
  })
```

Update that describe's title to `'Upgrade reaches the dialog, and the dialog
reaches checkout'`, and the file's header comment where it says Header offers
"the checkout" — it now offers the explanation, and the checkout is one click
further on.

- [ ] **Step 4: Run the full suite**

Run: `TZ=UTC pnpm test:once; echo "EXIT=$?"`
Expected: `EXIT=0`. `app.tsx`'s own hook tests pass `onUpgrade` as a prop and do
not touch the context, so nothing there should need changing — if something
does, read it before editing: it is recording behaviour this task deliberately
changed, or it is a genuine break.

- [ ] **Step 5: Commit**

```bash
git add src/components/Header.tsx src/components/Header.hook.test.ts src/routes/app.tsx
git commit -m "feat(upgrade): header and both pickers open the dialog"
```

---

### Task 6: Rewire the three in-context affordances

**Files:**
- Modify: `src/components/board-entry/import-upsell.tsx`
- Modify: `src/components/trial-ended-card.tsx`
- Modify: `src/routes/insights.tsx:119`

- [ ] **Step 1: import-upsell**

Replace `const { startUpgrade, pending } = useStartUpgrade()` with `const { openUpgrade } = useUpgrade()`, the button's `disabled={pending} aria-disabled={pending}` with nothing, its `onClick` with `onClick={() => openUpgrade('import')}`, and drop the `Loader2` spinner and its import. Swap the hook import. Replace the "ONE MORE CALLER OF useStartUpgrade" paragraph in the header comment with:

```tsx
 * IT OPENS THE UPGRADE DIALOG, NOT CHECKOUT (wordle-teams-iht.1), and passes
 * 'import' as the origin so the headline names the thing they just reached for
 * rather than Pro in general.
```

- [ ] **Step 2: trial-ended-card**

Replace `const { startUpgrade, pending } = useStartUpgrade()` with `const { openUpgrade } = useUpgrade()`, and the button with:

```tsx
        <Button onClick={() => openUpgrade('trial-ended')}>{TRIAL_ENDED_CTA}</Button>
```

`TRIAL_ENDED_TITLE`, `TRIAL_ENDED_BODY` and `TRIAL_ENDED_CTA` are unchanged — this card keeps its own copy and the dialog opens behind it with the `trial-ended` headline.

- [ ] **Step 3: insights.tsx**

Replace `const { startUpgrade } = useStartUpgrade()` with `const { openUpgrade } = useUpgrade()` and every `onUpgrade={() => void startUpgrade()}` in the file with `onUpgrade={() => openUpgrade('insights')}`.

Run `grep -n "startUpgrade" src/routes/insights.tsx` and confirm no occurrences remain.

- [ ] **Step 4: Run the full suite**

Run: `TZ=UTC pnpm test:once`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/board-entry/import-upsell.tsx src/components/trial-ended-card.tsx src/routes/insights.tsx
git commit -m "feat(upgrade): import, trial-ended and insights open the dialog"
```

---

### Task 7: Pin the single checkout path

**Files:**
- Modify: `src/routes.test.ts` (append a describe block beside the chat roster one at `:917`)

- [ ] **Step 1: Write the failing test**

Create `src/checkout-entry-point.test.ts`. It walks the source graph rather than
grepping, because `#/lib/use-start-upgrade.ts` appears in prose in at least two
component banners and a text match would fail on a correct file:

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { runtimeImportsOf } from './test-support/source-ast'

/**
 * ONE CALLER OF useStartUpgrade, WHICH IS THE WHOLE OF wordle-teams-iht.1.
 *
 * That issue was six affordances reaching Polar's checkout with nothing said
 * about what Pro is. The fix routes all six through components/upgrade-dialog.tsx
 * — and the fix is worth only as much as the guarantee that a SEVENTH cannot be
 * added the old way. It could: a new button calling useStartUpgrade() compiles,
 * lints, builds and passes every behavioural test in this repo, because each of
 * those renders one component and none can see the set of callers.
 *
 * ASSERTED OVER THE IMPORT GRAPH, NOT THE TEXT. `runtimeImportsOf` is the same
 * AST helper frontend-import-graph.test.ts walks with: it ignores type-only
 * imports and, more to the point here, ignores prose. import-upsell.tsx and
 * use-start-upgrade.ts both DISCUSS this hook in their banners, and a
 * `toMatch(/use-start-upgrade/)` over raw source would fail on both.
 *
 * THE WALKER IS A THIRD COPY of the one in styles.test.ts and
 * frontend-import-graph.test.ts. Left as a copy deliberately: eight lines
 * against a shared helper that would make three suites share a dependency for
 * a directory listing. Consolidate when a fourth appears.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
  })
}

describe('checkout has exactly one entry point', () => {
  test('only the upgrade dialog imports use-start-upgrade', () => {
    const importers = sourceFiles(SRC)
      .filter((path) => !path.endsWith('.test.ts') && !path.endsWith('use-start-upgrade.ts'))
      .filter((path) =>
        runtimeImportsOf(path, readFileSync(path, 'utf8')).some((specifier) =>
          specifier.includes('use-start-upgrade'),
        ),
      )
      .map((path) => path.slice(SRC.length))

    expect(importers).toEqual(['components/upgrade-dialog.tsx'])
  })
})
```

- [ ] **Step 2: Run it and watch it pass, then prove it can fail**

Run: `TZ=UTC pnpm vitest run src/checkout-entry-point.test.ts`
Expected: PASS — Tasks 5 and 6 already removed every other importer.

A test that has never failed is not yet a test. Temporarily add
`import { useStartUpgrade } from '#/lib/use-start-upgrade.ts'` to
`src/components/Header.tsx`, re-run, confirm it FAILS listing two importers,
then remove the import and re-run to green.

- [ ] **Step 3: Commit**

```bash
git add src/checkout-entry-point.test.ts
git commit -m "test(upgrade): pin the dialog as the only route to checkout"
```

---

### Task 8: The gates, and the 390px check

- [ ] **Step 1: Run all four gates**

Each separately, and read each exit code — a piped check reports a false green in zsh, where `PIPESTATUS` is empty:

```bash
TZ=UTC pnpm test:once; echo "EXIT=$?"
pnpm typecheck; echo "EXIT=$?"
pnpm lint; echo "EXIT=$?"
pnpm build; echo "EXIT=$?"
```

Expected: `EXIT=0` four times.

- [ ] **Step 2: Look at the dialog at 390px**

Run `pnpm dev`, open `http://localhost:3000/app` at a 390px viewport as a non-Pro
account, click Upgrade in the header, and confirm: the benefits list scrolls
inside the dialog, the CTA row stays visible without scrolling, and nothing
overflows horizontally.

Kill any dev server already holding :3000 first — Playwright and vite both
attach to whatever is there, and a stale one serves stale code.

- [ ] **Step 3: Run the e2e billing spec**

The quality gates do not run Playwright, and `e2e/billing.spec.ts` drives the
upgrade affordances directly — it is the one suite this change can break.

```bash
pnpm e2e billing --reporter=line
```

Expected: PASS. Any step that clicked Upgrade and expected a Polar navigation
now needs the dialog's CTA clicked first; update those steps, since the flow
changed deliberately.

- [ ] **Step 4: Commit any e2e updates**

```bash
git add e2e/billing.spec.ts
git commit -m "test(e2e): the upgrade affordances now open the dialog first"
```

---

## What this plan does not do

- `/pricing`, the landing page and `/about` — plan 2, `wordle-teams-wty4.1.14`.
- `scripts/check-polar-prices.mjs`, the drift check referenced in `plans.ts`'s
  banner. It belongs with the pricing page that makes the literals public, and
  spec §10 lists where it runs as unresolved. Until it exists, the banner names
  a script that is not there — the first task of plan 2 either creates it or
  amends the banner.
- Any change to what is gated. `wordle-teams-iht.3` owns that.
