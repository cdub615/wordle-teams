import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import { useUpgrade } from '#/components/upgrade-dialog.tsx'
import { TRIAL_ENDED_BODY, TRIAL_ENDED_CTA, TRIAL_ENDED_TITLE } from '#/lib/trial-copy.ts'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'

/**
 * Shown to exactly one population: a player whose trial ended and who did not
 * upgrade. `trialExpired` carries that whole condition — it is false for a Pro
 * player and false for someone who never had a trial — so there is no second
 * check here and no chance of the two drifting apart.
 *
 * useQuery, NOT useSuspenseQuery, deliberately: this card is an aside. Suspending
 * the insights route on a prompt would make the page wait in order to tell
 * somebody they cannot see it.
 *
 * ITS CTA OPENS THE UPGRADE DIALOG, NOT CHECKOUT (wordle-teams-iht.1). The
 * card keeps its own title, body and CTA — they are written for this one
 * population and say something the dialog does not — and the dialog opens in
 * front of it under the 'trial-ended' headline. There is no `pending` here any
 * more because opening a dialog is synchronous; the round trip, and the
 * disabled state that goes with it, belong to the dialog's own CTA.
 */
export function TrialEndedCard() {
  const { data: access } = useQuery(convexQuery(api.insights.myAccess, {}))
  const { openUpgrade } = useUpgrade()

  if (!access?.trialExpired) return null

  return (
    <Card className="mb-4" data-testid="trial-ended">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{TRIAL_ENDED_TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{TRIAL_ENDED_BODY}</p>
        <Button onClick={() => openUpgrade('trial-ended')}>{TRIAL_ENDED_CTA}</Button>
      </CardContent>
    </Card>
  )
}
