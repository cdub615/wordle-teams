import { useId, type ReactElement, type ReactNode } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'

/**
 * The one-time heads-up above the dashboard's clue ladder card
 * (wordle-teams-9j7o.2.11). The clue ladder is on for every team by default,
 * so each player is told once what it is; "Got it" hides it for good.
 *
 * THE OWNER ALSO LEARNS THEY CAN SWITCH IT OFF, since nobody asked them before
 * turning it on. `renderTeamLink` makes that a real link to the Team page, as
 * the card's renderLink does for the play route.
 */
export function ClueLadderNotice({
  isOwner,
  onDismiss,
  renderTeamLink,
  className,
}: {
  isOwner: boolean
  onDismiss: () => void
  renderTeamLink: (children: ReactNode) => ReactElement
  className?: string
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className={cn('flex flex-col gap-2 rounded-md border border-dashed p-4', className)}>
      <h2 id={titleId} className="text-sm font-semibold md:text-base">
        New: the clue ladder
      </h2>
      <p className="text-sm">
        A daily logic puzzle with its own scoreboard. Put five shapes in order using as few clues as you can.
      </p>
      {isOwner && (
        <p className="text-sm text-muted-foreground">
          It's on for your team. You can switch it off on the {renderTeamLink('Team page')}.
        </p>
      )}
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onDismiss}>
        Got it
      </Button>
    </section>
  )
}
