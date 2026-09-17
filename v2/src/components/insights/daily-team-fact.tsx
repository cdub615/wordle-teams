import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { CONTROLS_ONLY_HEADER } from '#/components/insights/team-scope-controls.tsx'
import { dailyTeamFact } from '#/lib/insights-team.ts'
import type { TeamMonthTeaser } from '../../../convex/lib/teamStats.ts'

/**
 * Layer 3's free slice, above the locked card — one fact a day.
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
 * THE PAYWALL HOOK LEFT THIS FILE (wordle-teams-iht.2). It used to render a
 * "See the full month →" button whose handler was deliberately never wired —
 * the affordance was this card's to own and the destination was iht's. iht
 * answered with a card instead: team-locked-card.tsx now renders beneath this
 * one on the free branch and shows the paid panel's shape for the month,
 * redacted. Two calls to action in one region is why the link went rather than
 * gained a handler.
 */
export function DailyTeamFact({
  stats,
  viewerId,
  today,
  teamName,
  controls,
}: {
  stats: TeamMonthTeaser | null
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
  /**
   * The team dropdown (components/insights/team-scope-controls.tsx), as a node
   * rather than as its props — team-panel.tsx's `controls` states the reasoning
   * and it is the same here.
   *
   * THE TEAM DROPDOWN ONLY, NEVER A MONTH ONE. This card states a fact about
   * TODAY, so there is no month to choose; components/insights/team-section.tsx
   * builds the free branch's controls without a month scope, and
   * team-scope-controls.tsx's
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

  // NOTHING TO SAY YET, AND — WHEN THERE IS NOTHING TO CHOOSE EITHER — NOTHING
  // DRAWN. A player who has not entered today is being asked for a board, and
  // the dashboard already asks; a card whose whole content is that same request
  // is a second nag in a worse place.
  //
  // `controls` IS WHAT SUSPENDS THAT RULE, and it is the only thing that does
  // (wordle-teams-4b0m). The team dropdown lives in this card's HEADER, so
  // returning null took it with the sentence — and a free player on two or more
  // teams could not change which team the page was scoped to until they had
  // played. That is the default state every morning, not an edge case, and on
  // the free tier nothing else on the page is team-scoped, so `?team=` and the
  // localStorage key /insights writes were both frozen for the whole window.
  //
  // SO THE CARD IS DRAWN EXACTLY WHEN IT CARRIES A CONTROL, and team-section.tsx
  // passes one exactly when `showsTeamDropdown` is true. A player
  // on ONE team still gets nothing at all, which keeps the original rule wherever
  // it still applies: there is no picker to strand, so the card would be a bare
  // request for a board and nothing else. The asymmetry is deliberate and was
  // the decision 4b0m asked for rather than a patch.
  //
  // WHAT IT SAYS IN THAT WINDOW is `sentenceFor`'s 'no-board' case — an empty
  // state, not a fact, and emphatically not a reduced version of the paid
  // surface, which the spec rules out for the free tier.
  if (fact.kind === 'no-board' && !controls) return null

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
      </CardContent>
    </Card>
  )
}

/**
 * THE MOST-SHARED STRING IN THE PRODUCT, which is the whole reason the count
 * agreement below is fussed over (wordle-teams-f441). Two of these sentences
 * used to disagree with themselves at a count of ONE:
 *
 *     You beat zero of one teammate who have played today.
 *     You entered today’s board first — none of your 1 teammates have played yet.
 *
 * The first switched the NOUN on `compared === 1` and left the verb plural; the
 * second phrased a count of one as a plural with a numeral. One teammate is the
 * COMMON case on a two-person team, not a corner of the input space.
 *
 * NUMBERS ARE WORDS THROUGHOUT, which is `count`'s rule below and now applies to
 * every branch rather than two of three — a bare `1` in a sentence meant to be
 * pasted into a group chat was the other half of what read as broken.
 */
function sentenceFor(fact: ReturnType<typeof dailyTeamFact>): string {
  switch (fact.kind) {
    // The empty state, drawn only when this card is also carrying the team
    // dropdown — see the guard above. It asks for the board rather than
    // describing the absence of one, because the only thing that ends this
    // window is playing.
    case 'no-board':
      return 'Enter today’s board to see how you compare.'
    case 'alone':
      return 'You entered today’s board. Invite a teammate to compare scores.'
    // ONE TEAMMATE IS NOT "none of your one teammates". The singular drops the
    // quantifier entirely rather than trying to inflect it, which is what every
    // attempt to keep "none of" at a count of one reads like.
    case 'nobody-yet':
      return fact.teammates === 1
        ? 'You entered today’s board first — your teammate has not played yet.'
        : `You entered today’s board first — none of your ${count(fact.teammates)} teammates have played yet.`
    // The noun AND the verb move together. Switching only the noun is the bug
    // this replaces.
    case 'beat':
      return `You beat ${count(fact.beaten)} of ${count(fact.compared)} ${
        fact.compared === 1 ? 'teammate who has' : 'teammates who have'
      } played today.`
    default:
      return ''
  }
}

/** Small numbers read better as words in a sentence meant to be shared. */
function count(n: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] ?? String(n)
}
