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
 * for the next one to be added without it. One mount at __root
 * (`wordle-teams-iht.1.4`), one `openUpgrade(origin)`, and — the part that
 * matters — the CTA below is meant to be the app's ONE route to checkout.
 * `wordle-teams-iht.1.5` and `.6` point the remaining affordances — Header.tsx,
 * routes/app.tsx, board-entry/import-upsell.tsx, trial-ended-card.tsx and
 * routes/insights.tsx — at `openUpgrade` rather than at useStartUpgrade, and
 * `.7` then adds the graph test that pins this file as that hook's only
 * importer. The test is the load-bearing half: a second unguarded path would
 * defeat the whole thing and would type-check, lint and build clean.
 *
 * THE HEADLINE IS THE ONLY THING THAT VARIES. The benefits list is PRO_BENEFITS
 * in full for every origin: one inventory, six openings. Nothing here writes a
 * benefit of its own, and the test fails if the inventory grows an entry this
 * does not render — title AND body, so five bare headings do not satisfy it.
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
  /**
   * NULL UNTIL THE FIRST OPEN, AND THEN AN ORIGIN THAT OUTLIVES THE CLOSE. Two
   * separate decisions, both about state that is not what it looks like.
   *
   * CLOSING DOES NOT CLEAR THE ORIGIN, BECAUSE OF THE EXIT ANIMATION. Radix
   * keeps DialogContent mounted through `data-[state=closed]:animate-out`
   * (ui/dialog.tsx sets it, with `duration-200`), so dropping the origin on
   * close blanks the TITLE for the length of the fade while the price line, the
   * five benefits and the footer are all still on screen — the dialog appears
   * to lose its headline as it leaves. Flipping only `open` means it renders
   * what it was opened with, all the way out. REASONING, NOT A TEST, HOLDS
   * THIS: jsdom runs no animations, so Radix unmounts immediately there and
   * nothing in upgrade-dialog.hook.test.ts can tell the two versions apart.
   *
   * AND THE WHOLE THING IS NULL BEFORE THE FIRST OPEN RATHER THAN SEEDED WITH
   * AN ARBITRARY ORIGIN. A seed would be a value that is never a real answer,
   * and nothing in the type could say so — the dialog would mount at app start
   * (this provider wraps the whole tree in routes/__root.tsx) holding a
   * `'header'` nobody asked for, so any mount effect or `useRef` added inside
   * it later would capture the fiction instead of a real origin. Null is a
   * state TypeScript can enforce, and it also means a player who never asks
   * about Pro never mounts this dialog at all.
   */
  const [state, setState] = useState<{ origin: UpgradeOrigin; open: boolean } | null>(null)
  const value = useMemo(
    () => ({ openUpgrade: (origin: UpgradeOrigin) => setState({ origin, open: true }) }),
    [],
  )

  return (
    <UpgradeContext.Provider value={value}>
      {children}
      {state !== null && (
        <UpgradeDialog
          origin={state.origin}
          open={state.open}
          onClose={() => setState((current) => (current === null ? null : { ...current, open: false }))}
        />
      )}
    </UpgradeContext.Provider>
  )
}

function UpgradeDialog({
  origin,
  open,
  onClose,
}: {
  origin: UpgradeOrigin
  open: boolean
  onClose: () => void
}) {
  const { startUpgrade, abandonUpgrade, pending } = useStartUpgrade()

  /**
   * EVERY EXIT IS A CANCELLATION (wordle-teams-iht.1.10). Dismissing while a
   * checkout is in flight used to do nothing to the checkout: `onClose` flips
   * `open`, `state` stays non-null so this component stays mounted, and the
   * hook's promise resolved into `window.location.href` — the player was put on
   * Polar's payment page after explicitly declining it. `abandonUpgrade` is the
   * hook's own cancellation (the argument for it living there, not here, is in
   * use-start-upgrade.ts); this is the half that says WHEN.
   *
   * ONE FUNCTION FOR ALL FOUR WAYS OUT, which is the only reason this is
   * correct rather than nearly correct. "Not now" is the exit that gets thought
   * about; the X is the one most players reach for, Escape is the one a
   * keyboard user has, and the overlay click is the one nothing in jsdom can
   * drive. The last three share `onOpenChange`, so routing both it and the
   * button through here is what makes "dismissed" mean the same thing however
   * the player spelled it.
   *
   * IT IS NOT CONDITIONAL ON `pending`. Abandoning when no checkout is running
   * is a no-op by construction — the flag is re-armed by the next
   * `startUpgrade` — and a guard here would be a second copy of the hook's idea
   * of "in flight", kept in step by hand.
   */
  const dismiss = () => {
    abandonUpgrade()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      {/*
        THE WHOLE PANEL SCROLLS, AND THE CTA SCROLLS WITH IT. The spec asked for
        a pinned footer; DialogContent is why this does not do that. That
        component already bounds its own height against the safe-area insets and
        sets `overflow-y-auto` on itself (wordle-teams-8h2p) — pinning a footer
        would mean overriding that with `overflow-hidden` plus a flex column —
        and `cn` is `twMerge(clsx(...))`, which is deterministic LAST-WINS with
        the caller's classes last, so a className passed here does not merely
        risk beating the component's `overflow-y-auto`, it reliably does. That
        is worse than a coin toss, not better: it means one caller can switch
        off wordle-teams-8h2p's safe-area scrolling for its own dialog silently,
        which is the class of failure ui/dialog.hook.test.ts exists to catch.
        Five benefits is not a long document, and Task 8's 390px pass is what
        would catch it if the CTA ever stopped being reachable.

        AND IT PASSES NO className AT ALL, which is the second half of the same
        argument. The two it used to carry were both wrong: `space-y-4` stacks
        margins ON TOP OF DialogContent's own `grid gap-4`, separating the
        header, the list and the footer by 2rem rather than the 1rem every other
        dialog in this app uses, and `sm:max-w-lg` re-states a `max-w-lg` that
        is already in the base class list. If the component's defaults are
        right, say nothing.
      */}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{UPGRADE_HEADLINES[origin]}</DialogTitle>
          <DialogDescription>{PRO_PRICE_LINE}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-3 text-sm">
          {PRO_BENEFITS.map((benefit) => (
            <li key={benefit.id} className="space-y-1">
              <p className="font-medium text-foreground">{benefit.title}</p>
              <p className="text-muted-foreground">{benefit.body}</p>
            </li>
          ))}
        </ul>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{MONTHLY_FINE_PRINT}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={dismiss}>
              Not now
            </Button>
            <Button
              disabled={pending}
              aria-disabled={pending}
              // THE SPINNER IS DECORATION; THIS IS THE ANNOUNCEMENT — the same
              // reasoning settings/security-tab.tsx spells out over its own
              // removal button, and it applies harder here: from task 5 this
              // CTA owns the checkout round trip that Header.tsx's Upgrade
              // button used to, and a screen reader cannot perceive a swapped
              // icon. It is also what the test asserts on, because pinning
              // `.animate-spin` would couple the suite to a Tailwind class.
              aria-busy={pending}
              onClick={() => void startUpgrade()}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Upgrade
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
