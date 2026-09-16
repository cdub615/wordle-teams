import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { CONTROLS_ONLY_HEADER } from '#/components/insights/team-scope-controls.tsx'
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
  teamName,
  onSeeFullMonth,
  controls,
}: {
  stats: TeamMonth | null
  viewerId: string
  today: string
  /**
   * The team this fact is about, for the card's SCREEN-READER-ONLY heading.
   *
   * THIS CARD HAS NO PAINTED TITLE AND IS NOT GETTING ONE — the design is one
   * sentence, and the dropdown above it already names the team on screen. What
   * it was missing is a heading in the DOCUMENT: a reader navigating by heading
   * skipped this region entirely and landed on a bare "Team: ..." button with
   * nothing to say what it belonged to. Same fix, and the same `h2`, as
   * team-panel.tsx — see PanelHeader there for why that level.
   *
   * Optional with the same `?? 'Your team'` fallback TeamPanel applies, so the
   * heading can never come out empty.
   */
  teamName?: string
  onSeeFullMonth?: () => void
  /**
   * The team dropdown (components/insights/team-scope-controls.tsx), as a node
   * rather than as its props — team-panel.tsx's `controls` states the reasoning
   * and it is the same here.
   *
   * THE TEAM DROPDOWN ONLY, NEVER A MONTH ONE. This card states a fact about
   * TODAY, so there is no month to choose; routes/insights.tsx builds the free
   * branch's controls without a month scope, and team-scope-controls.tsx's
   * `MonthScope` says the same thing from the other side.
   *
   * ABSENT IS THE COMMON CASE, which is why the header below is conditional
   * rather than always drawn. A player on ONE team has nothing to pick, so
   * there is no control, and a card whose only header was an empty padded row
   * would be worse than the card this has always been.
   */
  controls?: ReactNode
}) {
  const fact = dailyTeamFact(stats, viewerId, today)

  // Nothing to say yet. Deliberately renders nothing at all rather than an empty
  // card: a player who has not entered today is being asked for a board, and the
  // dashboard already asks.
  //
  // THIS NOW TAKES THE TEAM DROPDOWN WITH IT, which it did not when the rule was
  // written: the picker lives in this card's header, so a free player on two
  // teams who has not played today gets no card AND no way to switch teams. That
  // is wordle-teams-4b0m, filed rather than fixed here — undoing it means
  // deciding what this card SAYS to somebody who has not played, and the spec
  // pins this card to one fact about a board they have entered. Do not "fix" it
  // by rendering an empty card; that is the state this return exists to avoid.
  if (fact.kind === 'no-board') return null

  return (
    <Card data-testid="insights-daily-fact">
      {/* OUTSIDE THE HEADER, because the header is conditional and the heading
          must not be: a one-team account gets no controls, and a card with no
          heading at all is the defect this fixes. `sr-only` is out of flow, so
          it costs no layout wherever it sits. */}
      <CardTitle asChild className="sr-only">
        <h2>{teamName ?? 'Your team'}</h2>
      </CardTitle>
      {/* NO PAINTED TITLE TO SIT BESIDE, so the control takes the header on its
          own — and the header exists only when the control does, since an
          always-drawn one would be an empty padded row for a one-team account.
          CONTROLS_ONLY_HEADER is the shape team-panel.tsx's hidden-title header
          shares, so the two cards put the same dropdown in the same place. */}
      {controls && (
        <CardHeader className={`${CONTROLS_ONLY_HEADER} pb-3`}>{controls}</CardHeader>
      )}
      {/* CardContent's own `pt-0` IS CORRECT WHEN A HEADER IS ABOVE IT, and the
          `pt-6` that overrides it is what this card needed while it had none.
          Keeping the override in both cases would double the gap under the
          dropdown. */}
      <CardContent className={`space-y-2 text-sm ${controls ? '' : 'pt-6'}`}>
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
