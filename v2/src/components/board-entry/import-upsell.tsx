import { ImageDown, Loader2, Lock } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { useStartUpgrade } from '#/lib/use-start-upgrade.ts'

/**
 * What a player without Pro sees where the import controls would be.
 *
 * IT IS HERE BECAUSE THIS IS THE MOMENT IT MEANS SOMETHING. They have opened
 * board entry and are being asked how they want to enter a board — which is the
 * one point in the app where "you could have pasted a screenshot instead" is an
 * answer to the question actually in front of them, rather than an ad. Every
 * other route to checkout in v2 is reached from a menu or a bar, and 87% of
 * production signups never enter a board at all.
 *
 * IT ALSO EARNS STEP ONE FOR A NON-PRO PLAYER. Without it that step is a date
 * and a single button, which is thin enough to argue for skipping it — and
 * skipping it would mean two flows to keep in step for the sake of one tap.
 *
 * ONE MORE CALLER OF useStartUpgrade, not a second checkout route. That hook
 * already owns createProCheckout, its failure shapes and its copy, and is
 * already used by the app bar and the account menu.
 */
export function ImportUpsell() {
  const { startUpgrade, pending } = useStartUpgrade()

  return (
    <div
      data-testid="board-import-upsell"
      className="mx-2 flex flex-col gap-2 rounded-md border border-dashed border-input p-3 md:mx-0"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <ImageDown className="h-4 w-4 text-muted-foreground" />
        Import from a screenshot
        <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <Lock className="h-3 w-3" />
          Pro
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Paste or upload a screenshot of your Wordle and we&apos;ll fill the board in for you. Check it
        and submit.
      </p>
      <Button
        type="button"
        size="sm"
        className="w-fit"
        disabled={pending}
        aria-disabled={pending}
        onClick={() => void startUpgrade()}
      >
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Upgrade to Pro
      </Button>
    </div>
  )
}

export default ImportUpsell
