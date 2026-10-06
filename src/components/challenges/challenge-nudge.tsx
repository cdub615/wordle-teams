import { Link } from '@tanstack/react-router'
import { Swords } from 'lucide-react'
import { cn } from '#/lib/utils.ts'

/**
 * The dashboard's one-line "you were challenged" signal (owner decision D9).
 *
 * WHY IT EXISTS: nothing pushes on a proposal, so without this a challenged
 * team learns about it only by happening to open /team. It links there, with
 * the team in the URL, and says nothing else — no names, no numbers (AC3).
 *
 * RENDERS NOTHING UNLESS `incoming` IS TRUE, and `undefined` (in flight, or
 * skipped) is not true: the dashboard must never flash it on a cold load.
 */
export function ChallengeNudge({
  teamId,
  incoming,
  className,
}: {
  teamId: string
  incoming: boolean | undefined
  className?: string
}) {
  if (incoming !== true) return null
  return (
    <Link
      to="/team"
      search={{ team: teamId }}
      className={cn(
        'flex items-center gap-2 rounded-md border p-4 text-sm font-semibold md:text-base',
        className,
      )}
    >
      <Swords className="h-4 w-4 shrink-0" aria-hidden="true" />
      Your team has been challenged
    </Link>
  )
}
