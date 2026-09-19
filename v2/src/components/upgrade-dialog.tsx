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
 * ONLY remaining caller of useStartUpgrade in the app. A graph test asserts
 * that as a source property, because a second unguarded path would defeat the
 * whole thing and would type-check, lint and build clean.
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
   * TWO FIELDS, NOT A NULLABLE ORIGIN, AND THE REASON IS THE EXIT ANIMATION.
   * Radix keeps DialogContent mounted through `data-[state=closed]:animate-out`
   * (ui/dialog.tsx sets it, with `duration-200`), so an `origin: null` on close
   * blanks the TITLE for the length of the fade while the price line, the five
   * benefits and the footer are all still on screen — the dialog appears to
   * lose its headline as it leaves. Keeping the origin and flipping only `open`
   * means it renders what it was opened with, all the way out.
   *
   * REASONING, NOT A TEST, IS WHAT HOLDS THIS. jsdom runs no animations, so
   * Radix unmounts immediately there and nothing in upgrade-dialog.hook.test.ts
   * can tell the two versions apart — which is exactly why it is written down
   * here rather than left to the suite.
   *
   * THE SEED ORIGIN IS NEVER DISPLAYED. `open` is false until something calls
   * openUpgrade, and every call sets both fields together, so no render with
   * `open: true` ever shows 'header' unless 'header' is where it was asked from.
   */
  const [state, setState] = useState<{ origin: UpgradeOrigin; open: boolean }>({
    origin: 'header',
    open: false,
  })
  const value = useMemo(
    () => ({ openUpgrade: (origin: UpgradeOrigin) => setState({ origin, open: true }) }),
    [],
  )

  return (
    <UpgradeContext.Provider value={value}>
      {children}
      <UpgradeDialog
        origin={state.origin}
        open={state.open}
        onClose={() => setState((current) => ({ ...current, open: false }))}
      />
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
  const { startUpgrade, pending } = useStartUpgrade()

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/*
        THE WHOLE PANEL SCROLLS, AND THE CTA SCROLLS WITH IT. The spec asked for
        a pinned footer; DialogContent is why this does not do that. That
        component already bounds its own height against the safe-area insets and
        sets `overflow-y-auto` on itself (wordle-teams-8h2p) — pinning a footer
        would mean overriding that with `overflow-hidden` plus a flex column, and
        `cn`'s tailwind-merge silently drops whichever of two conflicting
        overflow utilities it likes less, which is exactly the failure
        ui/dialog.hook.test.ts exists to catch. Five benefits is not a long
        document; the 390px check in a later task confirms the CTA is reachable.

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
