import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { api } from '../../../convex/_generated/api'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { ClueLadderCard } from './card.tsx'
import { ClueLadderNotice } from './notice.tsx'
import { cardPlayOf } from './today.ts'

/**
 * "Today's clue ladder" on the dashboard (spec section 6), fed by `today`.
 *
 * NOTHING UNTIL IT KNOWS, and no skeleton: the game can be off, or the player
 * on no opted-in team, and a placeholder that then vanished would be worse than
 * a card that arrives a moment late. useQuery, not useSuspenseQuery, so it never
 * holds up the dashboard. The query waits for hydration so the server render and
 * the first client render agree (the player's day is a client clock).
 *
 * `notice` is passed while the player has not yet dismissed the heads-up
 * (wordle-teams-9j7o.2.11). It shows above the card, and only when the card
 * itself does, so nobody is told about a game they cannot see.
 */
export function DashboardClueLadderCard({
  teamId,
  notice,
  className,
}: {
  teamId: string
  notice?: { isOwner: boolean; onDismiss: () => void }
  className?: string
}) {
  const hydrated = useHydrated()
  const today = hydrated ? toPuzzleDay(new Date()) : null
  const { data } = useQuery(convexQuery(api.clueLadder.today, today ? { today } : 'skip'))
  if (!data?.enabled) return null
  const card = (
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
  if (!notice) return card
  return (
    <>
      <ClueLadderNotice
        isOwner={notice.isOwner}
        onDismiss={notice.onDismiss}
        renderTeamLink={(children) => (
          <Link to="/team" search={{ team: teamId }} className="underline">
            {children}
          </Link>
        )}
        className={className}
      />
      {card}
    </>
  )
}
