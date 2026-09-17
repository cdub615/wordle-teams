import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { formatMonthLabel, ordinal } from '#/lib/format-day.ts'
import type { PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'
import type { TeamRankTeaser } from '../../../convex/lib/teamStats.ts'

/**
 * What a FREE member of a team is shown beneath their daily fact: the real shape
 * of the paid panel, with every figure redacted.
 *
 * REDACTED RATHER THAN BLURRED, AND THE DIFFERENCE IS NOT COSMETIC. The original
 * brief (wordle-teams-iht.2) asked for the real panel with its numbers blurred.
 * That assumed the numbers were on the client and merely hidden. Since
 * wordle-teams-iht.3 they are not sent at all — so a blur here would be blurring
 * fiction, which is the "invented team's head-to-head" that issue rejected,
 * wearing the viewer's own team's name. A redacted bar is the honest rendering
 * of a value that genuinely is not here.
 *
 * IT IS THE SHAPE OF THE THING BEING BOUGHT, which is why this beat a list of
 * section names with padlocks: after upgrading, the bars become numbers and
 * nothing else on the card moves.
 *
 * IT ALWAYS RENDERS, and only the headline changes. The owner's reason overrides
 * the tidier rule of hiding it when there is no rank: the players with too little
 * engagement to be ranked are the ones most at risk of never getting there, so
 * they are exactly the ones who need to see what is possible.
 *
 * PRESENTATIONAL ONLY. It calls no hooks and knows nothing about tiers —
 * team-section.tsx decides whether it renders at all.
 *
 * THE CALLBACKS ARE PROPS BECAUSE OF `onInvite`, NOT `onUpgrade`. Calling
 * useStartUpgrade in a component is fine and three components do it. useNavigate
 * is the one that cannot: without a RouterProvider it throws, and every component
 * test in this directory renders its component bare. Taking both as props keeps
 * the pair symmetrical.
 */
export function TeamLockedCard({
  teamName,
  month,
  roster,
  viewerId,
  rank,
  onUpgrade,
  onInvite,
}: {
  teamName: string
  month: PuzzleMonth
  roster: { playerId: string; firstName: string; lastName: string }[]
  viewerId: string
  /**
   * §3's tagged value, NEVER null here: this card renders only on the free
   * branch, and `null` is the pro/trial case that branch cannot reach.
   */
  rank: TeamRankTeaser
  onUpgrade: () => void
  onInvite: () => void
}) {
  const solo = rank.kind === 'solo'
  const headline = headlineFor(rank)
  const teammates = roster.filter((member) => member.playerId !== viewerId)

  return (
    <Card data-testid="insights-team-locked">
      <CardHeader className="pb-2">
        {/*
          A REAL <h2>, NOT A <p> (review finding). Every sibling card carries
          one — daily-team-fact.tsx and team-panel.tsx both give theirs an `h2`
          so the region has a name to navigate to, which is the defect
          wordle-teams-4b0m fixed on the card directly above this one. Here the
          scope line is already visible and already names the team, so it BECOMES
          the heading rather than an sr-only duplicate of itself.
        */}
        <CardTitle asChild className="text-muted-foreground text-xs font-normal">
          <h2 data-testid="insights-locked-scope">
            {teamName} · {formatMonthLabel(month)}
          </h2>
        </CardTitle>
        <p className="m-0 text-base font-semibold" data-testid="insights-locked-headline">
          {headline.title}
        </p>
        {headline.note && (
          <p className="text-muted-foreground m-0 text-xs" data-testid="insights-locked-note">
            {headline.note}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        <div data-testid="insights-locked-h2h">
          <h3 className="mb-1 font-medium">Head to head</h3>
          <ul className="m-0 list-none space-y-1 p-0">
            {solo || teammates.length === 0 ? (
              <LockedRow label="Your teammates" hidden="your record against each teammate" />
            ) : (
              teammates.map((member) => (
                <LockedRow
                  key={member.playerId}
                  label={`${member.firstName} ${member.lastName}`}
                  hidden={`your record against ${member.firstName}`}
                />
              ))
            )}
          </ul>
        </div>

        <div data-testid="insights-locked-averages">
          <h3 className="mb-1 font-medium">Averages</h3>
          <ul className="m-0 list-none space-y-1 p-0">
            <LockedRow label="You vs team" hidden="your average and the team's" />
          </ul>
        </div>

        <Button
          className="w-full"
          variant={solo ? 'outline' : 'default'}
          onClick={solo ? onInvite : onUpgrade}
          data-testid="insights-locked-cta"
        >
          {solo ? 'Invite a teammate' : 'Unlock team insights'}
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * One row: a real label, and a bar where the number is not.
 *
 * `hidden` IS NOT DECORATION. A grey bar conveys nothing without sight, so each
 * slot carries an sr-only sentence naming what is being withheld. The bar itself
 * is aria-hidden so a screen reader gets the sentence and not both.
 *
 * NOT `ui/skeleton.tsx`, WHICH WOULD BE THE OBVIOUS REACH. Skeleton is
 * `animate-pulse`: a shimmer reads as "this is loading and will arrive in a
 * moment", which is the opposite of what is true here.
 */
function LockedRow({ label, hidden }: { label: string; hidden: string }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid="insights-locked-value">
        <span className="sr-only">{hidden} — hidden until you upgrade</span>
        <span aria-hidden className="bg-muted inline-block h-3 w-16 rounded" />
      </span>
    </li>
  )
}

/**
 * The one line that changes, and it changes to say what would make the numbers
 * appear rather than merely that they are missing.
 *
 * `not-played` AND `nobody-else` ARE DELIBERATELY DIFFERENT SENTENCES. One asks
 * the reader for something; the other tells them it is not their fault.
 * Collapsing them would blame a diligent player for their teammates' silence,
 * and separating them is the entire reason teamRank returns a tag.
 */
function headlineFor(rank: TeamRankTeaser): { title: string; note?: string } {
  switch (rank.kind) {
    case 'ranked':
      return { title: `You’re ${ordinal(rank.rank)} of ${rank.of} this month` }
    case 'not-played':
      return {
        title: 'See where you rank this month',
        note: 'Enter a board and you’ll have a standing.',
      }
    case 'nobody-else':
      return {
        title: 'You’re the only one playing so far',
        note: 'When your teammates join in, you’ll have a standing.',
      }
    case 'solo':
      return {
        title: 'Team insights need a team',
        note: 'Invite someone and this fills in.',
      }
  }
}
