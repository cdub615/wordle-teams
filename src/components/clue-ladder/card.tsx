import { useId } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'

export type ClueLadderCardPlay =
  | { status: 'not-started' }
  | { status: 'playing'; cluesRevealed: number }
  | { status: 'solved'; lockedAtClue: number }
  | { status: 'failed' }

/**
 * "Today's clue ladder", below the Wordle entry on an opted-in team's
 * dashboard (spec section 6). Plan 3 mounts it and supplies `play` from the
 * `today` query.
 */
export function ClueLadderCard({
  play,
  onOpen,
  className,
}: {
  play: ClueLadderCardPlay
  onOpen: () => void
  className?: string
}) {
  const titleId = useId()
  const [line, action] =
    play.status === 'not-started'
      ? ['Five shapes, one order. Fewer clues, more points.', 'Play']
      : play.status === 'playing'
        ? [`Clue ${play.cluesRevealed}`, 'Continue']
        : play.status === 'solved'
          ? [`Solved on clue ${play.lockedAtClue}`, 'See the explanation']
          : ['X', 'See the explanation']

  return (
    <section
      aria-labelledby={titleId}
      className={cn('flex items-center justify-between gap-4 rounded-md border p-4', className)}
    >
      <div className="min-w-0">
        <h2 id={titleId} className="font-semibold">
          Today's clue ladder
        </h2>
        <p className="text-sm text-muted-foreground">{line}</p>
      </div>
      <Button type="button" onClick={onOpen}>
        {action}
      </Button>
    </section>
  )
}
