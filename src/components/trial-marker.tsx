import { Badge } from '#/components/ui/badge.tsx'
import { TRIAL_MARKER_LABEL } from '#/lib/trial-copy.ts'

/**
 * THE BADGE THAT SAYS WHICH BLOCKS THE TRIAL UNLOCKED.
 *
 * ONE COMPONENT, TWO PLACEMENTS — the Layer 2 group in routes/insights.tsx and
 * the team panel — because the two blocks are the whole of what
 * `paid = isPro || trialActive` grants (convex/lib/insightsAccess.ts) and they
 * must not describe themselves in two different ways.
 *
 * IT TAKES NO `trialActive` AND DECIDES NOTHING. Every caller gates the mount
 * itself, on `trialActive` and never on `layer2`/`layer3 === 'full'` — those are
 * equally true for a paying subscriber. A prop here would put that decision in
 * two places; a bare component keeps it at each call site where the access
 * object already is.
 *
 * `testId` IS PER PLACEMENT, so a test can say WHICH block it found rather than
 * that a badge exists somewhere on a page that has two.
 */
export function TrialMarker({ testId }: { testId: string }) {
  return (
    <div className="flex items-center" data-testid={testId}>
      <Badge variant="secondary">{TRIAL_MARKER_LABEL}</Badge>
    </div>
  )
}
