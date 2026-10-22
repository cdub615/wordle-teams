import { useId, type ReactElement, type ReactNode } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'

export type ClueLadderCardPlay =
  | { status: 'not-started' }
  | { status: 'playing'; cluesRevealed: number }
  | { status: 'solved'; lockedAtClue: number }
  | { status: 'failed' }

/**
 * "Today's clue ladder", below the Wordle entry on the
 * dashboard (spec section 6). Plan 3 mounts it, supplies `play` from the
 * `today` query, and passes `renderLink` so the action is a real link, e.g.
 * `(c) => <Link to="/play/clue-ladder">{c}</Link>`. The card wraps the result
 * in a `Button asChild`, so `renderLink` must return a single link element
 * that renders its children.
 */
export function ClueLadderCard({
  play,
  renderLink,
  className,
}: {
  play: ClueLadderCardPlay
  renderLink: (children: ReactNode) => ReactElement
  className?: string
}) {
  const titleId = useId()
  const [line, action] =
    play.status === 'not-started'
      ? [<>Five shapes, one order. Fewer clues, more points.</>, 'Play']
      : play.status === 'playing'
        ? [<>Clue {play.cluesRevealed}</>, 'Continue']
        : play.status === 'solved'
          ? [<>Solved on clue {play.lockedAtClue}</>, 'See the explanation']
          : [
              <>
                X<span className="sr-only">: not solved</span>
              </>,
              'See the explanation',
            ]
  const finished = play.status === 'solved' || play.status === 'failed'

  return (
    <section
      aria-labelledby={titleId}
      className={cn('flex flex-wrap items-center justify-between gap-3 rounded-md border p-4', className)}
    >
      <div className="min-w-0">
        <h2 id={titleId} className="text-sm font-semibold md:text-base">
          Today's clue ladder
        </h2>
        <p className="text-sm text-muted-foreground">{line}</p>
      </div>
      <Button asChild variant={finished ? 'secondary' : 'default'}>
        {renderLink(action)}
      </Button>
    </section>
  )
}
