import { useState } from 'react'
import { ConfirmPopover } from '#/components/confirm-popover.tsx'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'

/**
 * The revealed clues, and the day's two decisions. Next clue is irreversible
 * and costs a point; Lock in is the one try. Presentational: plan 3's route
 * owns the mutations and passes `pending` while one is in flight.
 */
export function ClueLadderControls({
  clues,
  canRevealMore,
  canLockIn,
  pending,
  onNextClue,
  onLockIn,
  className,
}: {
  clues: ReadonlyArray<string>
  canRevealMore: boolean
  /** True once all five slots are filled. */
  canLockIn: boolean
  pending: boolean
  onNextClue: () => void
  onLockIn: () => void
  className?: string
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <ol aria-label="Clues" className="flex flex-col gap-2">
        {clues.map((clue, i) => (
          <li key={i} className="rounded-md border p-3">
            <span className="block text-xs text-muted-foreground">Clue {i + 1}</span>
            {clue}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" disabled={!canRevealMore || pending} onClick={onNextClue}>
          Next clue
        </Button>
        <ConfirmPopover
          open={confirming}
          onOpenChange={setConfirming}
          trigger={
            <Button type="button" className="flex-1" disabled={!canLockIn || pending}>
              Lock in
            </Button>
          }
          message="One try. If it's wrong, today is an X."
          confirmLabel="Yes, lock in"
          pending={pending}
          onConfirm={() => {
            setConfirming(false)
            onLockIn()
          }}
        />
      </div>
    </div>
  )
}
