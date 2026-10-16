import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { api } from '../../../convex/_generated/api'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { ClueLadderCard } from './card.tsx'
import { cardPlayOf } from './today.ts'

/**
 * "Today's clue ladder" on the dashboard (spec section 6), fed by `today`.
 *
 * NOTHING UNTIL IT KNOWS, and no skeleton: the game can be off, or the player
 * on no opted-in team, and a placeholder that then vanished would be worse than
 * a card that arrives a moment late. useQuery, not useSuspenseQuery, so it never
 * holds up the dashboard. The query waits for hydration so the server render and
 * the first client render agree (the player's day is a client clock).
 */
export function DashboardClueLadderCard({ teamId, className }: { teamId: string; className?: string }) {
  const hydrated = useHydrated()
  const today = hydrated ? toPuzzleDay(new Date()) : null
  const { data } = useQuery(convexQuery(api.clueLadder.today, today ? { today } : 'skip'))
  if (!data?.enabled) return null
  return (
    <ClueLadderCard
      play={cardPlayOf(data.play)}
      // A real link (the card wraps it in Button asChild), so it opens in a new
      // tab and is announced as a link.
      renderLink={(children) => (
        <Link to="/play/clue-ladder" search={{ team: teamId }}>
          {children}
        </Link>
      )}
      className={className}
    />
  )
}
