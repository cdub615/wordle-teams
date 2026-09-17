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
 * section names with padlocks: the rows that are here stay put, and their bars
 * become numbers. THAT IS NOT THE WHOLE STORY ON UPGRADE, though (an earlier
 * draft of this comment claimed it was, and the spec's Decision 2 was corrected
 * on the same finding) — team-panel.tsx expands the single "You vs team" row
 * into one row per member, turns a two-person head-to-head into a `VersusBlock`
 * of display figures rather than a row, and adds two further sections below
 * (Best & worst days, Consistency). What is on THIS card does not reshape
 * itself; what surrounds it does.
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
 * useStartUpgrade in a component is fine and three components do it. A
 * router-dependent hook is not literally impossible here either —
 * no-team-card.tsx calls one directly (`Link`), and team-section.hook.test.ts
 * copes with it by mocking `@tanstack/react-router`. But every test in THIS
 * file renders the card bare, so a prop avoids adding that module mock just to
 * route on click. Taking `onUpgrade` as a prop too, and not only `onInvite`,
 * keeps the pair symmetrical instead of splitting them over an implementation
 * detail.
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
  // SOLO GETS A DIFFERENT PROMISE, BECAUSE "UPGRADE" ISN'T WHAT FIXES IT FOR
  // THEM. In the other three states the numbers really are one upgrade away.
  // A solo team's numbers are missing because there is nobody to compare
  // against — upgrading buys them nothing until that changes, which is the
  // same reason the CTA below offers them Invite instead of Upgrade. A
  // screen reader hearing "hidden until you upgrade" on every slot while the
  // sighted card says "Team insights need a team" and offers no upgrade
  // button would be told something the card does not deliver.
  const revealedBy = solo ? 'once you have a teammate' : 'hidden until you upgrade'

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
        <p className="text-base font-semibold" data-testid="insights-locked-headline">
          {headline.title}
        </p>
        {headline.note && (
          <p className="text-muted-foreground text-xs" data-testid="insights-locked-note">
            {headline.note}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        <div data-testid="insights-locked-h2h">
          <h3 className="mb-1 font-medium">Head to head</h3>
          <ul className="space-y-1">
            {solo || teammates.length === 0 ? (
              <LockedRow
                label="Your teammates"
                hidden="your record against each teammate"
                suffix={revealedBy}
              />
            ) : (
              teammates.map((member) => (
                <LockedRow
                  key={member.playerId}
                  label={`${member.firstName} ${member.lastName}`}
                  hidden={`your record against ${member.firstName}`}
                  suffix={revealedBy}
                />
              ))
            )}
          </ul>
        </div>

        <div data-testid="insights-locked-averages">
          <h3 className="mb-1 font-medium">Averages</h3>
          <ul className="space-y-1">
            <LockedRow
              label="You vs team"
              hidden="your average and the team’s"
              suffix={revealedBy}
            />
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
 * slot carries an sr-only sentence naming what is being withheld, and `suffix`
 * says WHY it is withheld — TeamLockedCard varies that by state, because
 * "upgrade" is not the answer for a solo team (see `revealedBy` there).
 *
 * `aria-hidden="true"` ON THE BAR IS CHEAP INSURANCE, NOT A FIX FOR SOMETHING
 * IT WOULD OTHERWISE ANNOUNCE. The bar is an empty span with no text node, so
 * a screen reader has nothing to read from it either way. team-panel.tsx marks
 * its own averages bar the same way, but for a different reason — there the
 * bar duplicates a number already visible a line above it. Here there is no
 * number for it to duplicate; the attribute is worn anyway because it costs
 * nothing and guards against the day this bar gains content of its own.
 *
 * NOT `ui/skeleton.tsx`, WHICH WOULD BE THE OBVIOUS REACH. Skeleton is
 * `animate-pulse`: a shimmer reads as "this is loading and will arrive in a
 * moment", which is the opposite of what is true here.
 */
function LockedRow({
  label,
  hidden,
  suffix,
}: {
  label: string
  hidden: string
  suffix: string
}) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid="insights-locked-value">
        <span className="sr-only">
          {hidden} — {suffix}
        </span>
        <span aria-hidden="true" className="bg-muted inline-block h-3 w-16 rounded" />
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
