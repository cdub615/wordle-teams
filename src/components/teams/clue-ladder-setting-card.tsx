import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'

/**
 * The owner switches the team's clue ladder off, or back on (wordle-teams-9j7o.3.2).
 * It is on by default (wordle-teams-9j7o.2.11), so for most teams this is an opt-out.
 *
 * HIDDEN WHILE THE DEPLOYMENT SWITCH IS OFF, not shown disabled: until the
 * pilot ships there is nothing to explain. useQuery, not useSuspenseQuery, so
 * this card never holds up the rest of /team; it simply appears once the
 * switch answers.
 *
 * `enabled` is getMyTeams' clueLadderEnabled, which is the switch AND the
 * team's flag. This renders only while the switch is on, so here it is the
 * team's flag.
 */
export function ClueLadderSettingCard({
  teamId,
  isOwner,
  enabled,
}: {
  teamId: Id<'teams'>
  isOwner: boolean
  enabled: boolean
}) {
  const { data: deployment } = useQuery(convexQuery(api.games.clueLadderSwitch, {}))
  const helpId = useId()
  const setClueLadder = useMutation({ mutationFn: useConvexMutation(api.games.setTeamClueLadder) })

  if (!isOwner || !deployment?.enabled) return null

  return (
    <Card role="region" aria-label="Games">
      <CardHeader>
        <CardTitle asChild>
          <h2>Games</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="clue-ladder-enabled">Clue ladder</Label>
          <Switch
            id="clue-ladder-enabled"
            checked={enabled}
            disabled={setClueLadder.isPending}
            aria-describedby={helpId}
            onCheckedChange={() =>
              setClueLadder.mutate(
                { teamId, enabled: !enabled, today: toPuzzleDay(new Date()) },
                { onError: (error) => toast.error(mutationErrorMessage(error, 'Could not change that setting')) },
              )
            }
          />
        </div>
        <p id={helpId} className="text-sm text-muted-foreground">
          A daily logic puzzle with its own scoreboard, on the dashboard. It's on for every team unless you turn it
          off. Turning it off hides it. Scores are kept. If you turn it back on, days before that don't count as
          missed.
        </p>
      </CardContent>
    </Card>
  )
}
