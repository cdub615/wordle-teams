import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import { useUpgrade } from '#/components/upgrade-dialog.tsx'
import { formatInstantLabel } from '#/lib/format-day.ts'
import { trialRatherThanPro } from '../../convex/lib/insightsAccess.ts'
import {
  TRIAL_ACTIVE_BODY,
  TRIAL_ACTIVE_CTA,
  TRIAL_ACTIVE_TITLE,
  trialEndsOnLine,
} from '#/lib/trial-copy.ts'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'

/**
 * Shown to exactly one population: a player whose Insights trial is running.
 *
 * THE SIBLING OF trial-ended-card.tsx, and the two are mutually exclusive by
 * construction — insightsAccess cannot report `trialActive` and `trialExpired`
 * at once, since the second requires `!trialActive`. They mount side by side in
 * routes/insights.tsx and at most one ever renders.
 *
 * `trialActive && !isPro` IS TWO CONDITIONS AND BOTH ARE LOAD-BEARING, which is
 * the one place this card is NOT a mirror of its sibling. `trialExpired` already
 * excludes a Pro player itself; `trialActive` does not — it is a fact about the
 * CLOCK, not about who is paying, so it stays true for somebody who converted
 * mid-trial. Keyed on `trialActive` alone this card would tell a paying customer
 * that Pro is "yours while your trial runs".
 *
 * BOTH CONDITIONS NOW LIVE IN `trialRatherThanPro`
 * (convex/lib/insightsAccess.ts), which is the one definition of "is the trial
 * why this player has these blocks" and the only place the `layer4 === 'full'`
 * isPro proxy is spelled. This card used to hand-write that comparison, and the
 * two TrialMarker mounts did not — which is exactly how a paying customer came to
 * be told Pro was "yours while your trial runs" (wordle-teams-cpqf). The
 * `proMidTrial` row in this card's test is what holds the behaviour; the predicate
 * is what stops the next surface getting it wrong.
 *
 * THE `trialEndsAt === null` CLAUSE IS A TYPE OBLIGATION, NOT A LIVE CASE:
 * insightsAccess returns the timestamp whenever `trialActive` is true, but types
 * it `number | null` for the inactive case, and the date is the whole point of
 * the card — so it is narrowed here rather than rendered as 'Invalid Date'.
 *
 * useQuery, NOT useSuspenseQuery, deliberately, for the reason the sibling gives:
 * this card is an aside, and suspending the insights route on it would make the
 * page wait in order to tell somebody about a trial.
 *
 * THAT CHOICE IS ALSO WHAT MAKES THE DATE SAFE. `formatInstantLabel` reads the
 * runtime's zone, so it must never run during SSR — a date formatted on the
 * server and reformatted in the browser is the minified React #418 that
 * routes/pricing.tsx, components/today-panel.tsx and components/scores-table.tsx
 * each record at length. Rendering from client-only useQuery data means Intl only
 * ever runs in the browser. DO NOT promote this to a loader-fed banner.
 */
export function TrialActiveCard() {
  const { data: access } = useQuery(convexQuery(api.insights.myAccess, {}))
  const { openUpgrade } = useUpgrade()

  if (!access || !trialRatherThanPro(access) || access.trialEndsAt === null) return null

  return (
    <Card className="mb-4" data-testid="trial-active">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{TRIAL_ACTIVE_TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{TRIAL_ACTIVE_BODY}</p>
        <p className="text-foreground font-medium">
          {trialEndsOnLine(formatInstantLabel(access.trialEndsAt))}
        </p>
        <Button variant="link" className="h-auto p-0" onClick={() => openUpgrade('trial-active')}>
          {TRIAL_ACTIVE_CTA}
        </Button>
      </CardContent>
    </Card>
  )
}
