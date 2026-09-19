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
        document; the 390px check in a later task confirms the CTA is reachable.
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
