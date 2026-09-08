import { Card, CardContent } from '#/components/ui/card.tsx'
import { dailyTeamFact, type TeamMonth } from '#/lib/insights-team.ts'

/**
 * Layer 3's FREE slice — one fact a day, and the hook to the paid surface.
 *
 * ONE FACT, PINNED. The spec rejects "one free fact per month" with the
 * arithmetic: the paid surface is six view types times teammates times months, so
 * a monthly fact is under a sixth of the view types, a rounding error of the data,
 * and not a cadence anybody notices. This recurs daily, is the most shareable
 * thing in the product, and is one read from the aggregate already computed.
 *
 * IT SAYS SO PLAINLY WHEN NOBODY ELSE HAS PLAYED. dailyTeamFact returns that as
 * its own outcome rather than a count of zero, and this renders it as its own
 * sentence — on a small team early in the day it is the COMMON state, and "you
 * beat 0 of 0 teammates" reads as a loss and a bug at the same time.
 *
 * THE "SEE THE FULL MONTH" TARGET IS A PLACEHOLDER AND MUST STAY ONE. Paywall
 * placement and copy are explicitly out of scope in the spec and belong to
 * wordle-teams-iht. What this task owes is the AFFORDANCE — that there is a hook
 * here, in the right place, at the right moment — not the pitch. Whoever owns iht
 * replaces the handler and the wording; nothing else here needs to move.
 */
export function DailyTeamFact({
  stats,
  viewerId,
  today,
  onSeeFullMonth,
}: {
  stats: TeamMonth | null
  viewerId: string
  today: string
  onSeeFullMonth?: () => void
}) {
  const fact = dailyTeamFact(stats, viewerId, today)

  // Nothing to say yet. Deliberately renders nothing at all rather than an empty
  // card: a player who has not entered today is being asked for a board, and the
  // dashboard already asks.
  if (fact.kind === 'no-board') return null

  return (
    <Card data-testid="insights-daily-fact">
      <CardContent className="space-y-2 pt-6 text-sm">
        <p data-testid="insights-daily-fact-text">{sentenceFor(fact)}</p>
        {fact.kind === 'beat' && (
          <button
            type="button"
            className="text-muted-foreground underline"
            onClick={onSeeFullMonth}
            data-testid="insights-see-full-month"
          >
            See the full month →
          </button>
        )}
      </CardContent>
    </Card>
  )
}

function sentenceFor(fact: ReturnType<typeof dailyTeamFact>): string {
  switch (fact.kind) {
    case 'alone':
      return 'You entered today’s board. Invite a teammate to compare scores.'
    case 'nobody-yet':
      return `You entered today’s board first — none of your ${fact.teammates} teammates have played yet.`
    case 'beat':
      return `You beat ${count(fact.beaten)} of ${count(fact.compared)} ${
        fact.compared === 1 ? 'teammate' : 'teammates'
      } who have played today.`
    default:
      return ''
  }
}

/** Small numbers read better as words in a sentence meant to be shared. */
function count(n: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] ?? String(n)
}
