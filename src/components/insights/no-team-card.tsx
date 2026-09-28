import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'

/**
 * What a player who is on no team sees on the insights page, instead of nothing.
 *
 * THE GAP THIS FILLS: TeamSection used to do `if (!teamId || !data) return null`
 * for BOTH "not on a team" and "aggregate not resolved yet", so a team-less
 * player got a silently missing third of the page — not an empty state, just an
 * absence, with no explanation and no way out. wordle-teams-wty4.1.11.8 names this
 * gap explicitly: a v1 migrant who left every team lands in exactly this state,
 * and a third of a page a player is paying $49.99/yr for does not exist for them.
 *
 * NOT AN UnlockPrompt, and this is a deliberate distinction, not an oversight.
 * UnlockPrompt carries a progress bar because its floors (5, 10, 40 boards) are
 * reachable purely by entering boards the player already intends to enter — the
 * bar shows genuine, ongoing progress toward something that happens anyway.
 * Team membership is not that: a player does not creep toward having a team one
 * board at a time, and a 0/1 bar that only ever completes in one step would be
 * a progress indicator with nothing to indicate. What gets them there is a
 * single action taken once, so this gets a LINK, not a BAR — the same
 * distinction UnlockPrompt's own comment draws between what is reachable by
 * playing and what is not.
 *
 * NAMES WHAT TEAM INSIGHTS GIVE, CONCRETELY — head-to-head, averages, best and
 * worst days — rather than "team insights" as a label, for the same reason
 * UnlockPrompt's `value` prop is required to be one concrete clause: a floor
 * nobody can picture the reward for is not an invitation to cross it.
 */
export function NoTeamCard() {
  return (
    <Card data-testid="insights-no-team">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg md:text-xl">Your team</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          You are not on a team yet. Join or create one to see head-to-head records
          against your teammates, everyone's averages side by side, and the month's
          best and worst days.
        </p>
        <Button asChild>
          <Link to="/app">Find or create a team</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
