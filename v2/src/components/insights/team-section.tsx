import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { DailyTeamFact } from '#/components/insights/daily-team-fact.tsx'
import { NoTeamCard } from '#/components/insights/no-team-card.tsx'
import { TeamPanel } from '#/components/insights/team-panel.tsx'
import {
  showsTeamDropdown,
  TeamScopeControls,
} from '#/components/insights/team-scope-controls.tsx'
import { teamMonthOptions } from '#/lib/insights-months.ts'
import { hasFullTeamMonth } from '../../../convex/lib/insightsAccess.ts'
import { onATeamFrom } from '#/lib/insights-panel.ts'
import { monthOf, toPuzzleDay, type PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Layer 3, for the team and month the URL names — both settled by
 * routes/insights.tsx and handed down, so this component asks no question of
 * its own about which team it is showing.
 *
 * ITS OWN FILE SINCE wordle-teams-kkhj. It was the last 235 lines of a 747-line
 * route, and five of the six props InsightsPanel took existed only to carry
 * values down to it. It is fully prop-driven, owns exactly one query, and has
 * its own test file, so the move was mechanical — and InsightsPanel now receives
 * it as a node, the same shape TeamPanel and DailyTeamFact already use for their
 * `controls`.
 *
 * THE SELECTED TEAM ARRIVES AS AN OBJECT OR NOT AT ALL, which is what keeps
 * `teamMonth` from being asked for a team the viewer is not on — see the route's
 * own note on the lookup, and why an id that misses it must never reach Convex.
 *
 * `today` IS READ FROM THE CLOCK HERE, AND ONLY `today`. The month comes from
 * `?month=` now, but the daily fact is a fact about TODAY and has no month to
 * choose; it stays the viewer's own day, never the server's, the rule winners.ts
 * states for the celebration dialog.
 *
 * WHICH IS WHY THE TWO BRANCHES READ DIFFERENT MONTHS — see `queryMonth` below.
 * The free card asks only about today, so it must always be handed TODAY'S
 * month; the pro card is showing whichever month `?month=` names, and showing
 * that month is the entire feature.
 */
export function TeamSection({
  layer3,
  teams,
  team,
  month,
  onTeamChange,
  onMonthChange,
}: {
  layer3: 'none' | 'free' | 'full'
  /**
   * THE ROSTER, WHICH IS ALSO THE ANSWER TO "IS THIS PLAYER ON A TEAM" — and
   * since wordle-teams-kkhj it is the only spelling of it that reaches here.
   *
   * This used to arrive twice: as `teams`, and as an `onATeam` boolean the route
   * computed two lines from the same query. Nothing enforced that the two agreed
   * — the route test's helper hardcoded `onATeam: true` while varying `teams`,
   * so they were independent in test — and the guard below argues at length that
   * the roster question must be asked of the three-valued answer and never of
   * `team`. One derivation, `onATeamFrom`, now serves both that guard and the
   * upsell in InsightsPanel.
   *
   * `undefined` while getMyTeams is in flight, which is the third value.
   */
  teams: Array<{ id: Id<'teams'>; name: string }> | undefined
  team: { id: Id<'teams'>; name: string; createdAt?: number } | undefined
  month: string | undefined
  onTeamChange: (teamId: string) => void
  onMonthChange: (month: PuzzleMonth) => void
}) {
  const today = toPuzzleDay(new Date())
  /*
    THREE-VALUED, AND DERIVED RATHER THAN PASSED. `onATeamFrom` is the one
    expression (lib/insights-panel.ts, next to the upsell that is its other
    caller); the guard below compares its result to `false` explicitly, never for
    truthiness, for the reason that guard states at length.
  */
  const onATeam = onATeamFrom(teams)

  /*
    THE FREE BRANCH ALWAYS READS THE CURRENT MONTH, NEVER `?month=`, AND THAT IS
    A BUG FIX RATHER THAN A PREFERENCE.

    ONE QUERY SERVES BOTH BRANCHES, and it used to be keyed on the selected month
    for both of them. But DailyTeamFact only ever asks about TODAY: `dailyTeamFact`
    (lib/insights-team.ts) looks for `today` in `stats.days` and returns
    'no-board' when it is not there. So `/insights?month=2026-08` fetched August's
    aggregate, today was of course absent from it, and the free card rendered
    `null` — AND WITH IT THE TEAM PICKER, which lives in that card's header and
    only exists when the card does. A free player arriving on a shared link, or
    whose trial ended while a past month sat in the URL, got a blank region with
    nothing to click to get out of it.

    IT MIRRORS THE RENDER BRANCH BELOW AND MUST KEEP MIRRORING IT. Both now ask
    `hasFullTeamMonth` (convex/lib/insightsAccess.ts) rather than comparing
    `layer3` themselves, which is what makes them mirror BY CONSTRUCTION instead
    of by everyone remembering to — the failure this comment used to only warn
    about was a card rendered from a month it did not ask for
    (wordle-teams-iht.3.1).

    THE PRO BRANCH IS DELIBERATELY UNTOUCHED. A pro player picking a past month
    and getting that month's card is the feature, and they have the month
    dropdown to come back with.
  */
  const queryMonth = hasFullTeamMonth(layer3) ? month : monthOf(today)

  /*
    'skip' IS THE ONLY THING THAT ACTUALLY STOPS THIS QUERY, WHICH IS WHY THE
    `enabled` THAT USED TO SIT BESIDE IT IS GONE RATHER THAN WIDENED TO COVER THE
    MONTH. @convex-dev/react-query opens the Convex watch from the query CACHE's
    `added` event (ConvexQueryClient#subscribeInner), which TanStack fires for a
    disabled query too. That handler ignores keys that are not Convex queries at
    all, and then, for one that is, bails on exactly one thing: a query key whose
    args are the string 'skip'. It never consults `enabled`. Measured at the
    websocket on this project — under `enabled` alone the browser still sent
    ModifyQuerySet and took a refusal back, and the refusal is invisible in the
    console because the adapter writes it into query state instead of throwing.

    BOTH HALVES HAVE TO BE RESOLVED, not just the team. `queryMonth` is
    `undefined` on the PRO branch until the route's post-hydration effect fills
    `?month=` in, so a team-only check would issue a read with no month at all. A
    month that is shaped right but outside the team's window needs no guard of
    its own, unlike the team: `teamMonth` finds no aggregate row for it and
    returns `stats: null`, which is the same "nobody played this month" the
    panels already state, and the effect replaces it on the next pass anyway.

    ON THE FREE BRANCH THE MONTH HALF IS ALWAYS SATISFIED, because `monthOf`
    returns `day.slice(0, 7)` of a clock reading and can never be `undefined`. So
    that branch waits on the TEAM alone and its fact can render a beat earlier
    than it used to, before `?month=` has settled. THE TEAM HALF IS NOT
    NEGOTIABLE AND MUST STAY THE FIRST OPERAND: `teamMonth` rejects a team the
    viewer is not on, and the route's own note explains why such an id must never
    reach Convex at all.

    A SECOND CONSEQUENCE, AND IT IS A SAVING: `?month=` is no longer part of the
    free branch's query key, so a navigation that changes it — the effect settling
    the param on first load, most commonly — can no longer re-issue this read for
    a month that branch does not use.
  */
  const { data } = useQuery(
    convexQuery(
      api.insights.teamMonth,
      /*
        `today` IS AN ARG NOW (wordle-teams-iht.3.2): the server needs it to know
        WHICH day to keep in the free tier's payload, and "today" is a
        client-local fact the backend cannot read off its own clock without
        blanking the fact for anyone in a distant timezone. The server bounds it
        to +/-1 day and falls back to its own, so a wrong device clock costs a
        stale fact rather than the page.

        IT IS SENT ON BOTH BRANCHES even though only the free one uses it, so
        there is one set of query args rather than two shapes to keep in step.
        It re-keys the query at midnight, which is correct rather than merely
        harmless: the fact is about today.
      */
      team && queryMonth ? { teamId: team.id, month: queryMonth, today } : 'skip',
    ),
  )

  /*
    THREE STATES, THREE LINES, AND THEY MUST NOT BE FOLDED INTO FEWER — nor
    REORDERED, which is the same defect by another route (see below). The
    original defect (wordle-teams-wty4.1.11.8) was one shared `!teamId || !data`
    guard rendering an unexplained blank for a player on no team. Taking the team
    from `?team=` opened a SECOND door onto that same conflation, because a
    missing team now means either "this player has no team" or "we do not know
    which team yet". So the question the no-team card answers is asked of
    `onATeam`, which is THREE-VALUED, and never of `team`, which is not.

    NOBODY TO SHOW — `onATeam === false`: the roster has loaded and is EMPTY. A
    state, not a wait: the player has nothing here to load, ever, until they act,
    and that is common enough (a v1 migrant can have left every team) that
    wordle-teams-wty4.1.11.8 requires it be said rather than silently absent. See
    no-team-card.tsx's own comment on why it is a card with a link, not an
    UnlockPrompt with a bar. COMPARED TO `false`, NEVER TESTED FOR TRUTHINESS:
    `!onATeam` is also true while the roster is UNKNOWN, which is the conflation
    itself.

    WE DO NOT KNOW YET — no `team`: the roster is still in flight, or `?team=`
    has not been settled by the effect above, or it names a team this player has
    left. THE NO-TEAM CARD WOULD BE A FALSE STATEMENT IN ALL THREE: it tells a
    player who has teams that they have none and links them away to go join one.
    So this renders nothing. It closes on its own within a render or two — the
    roster lands, the effect navigates — and it deliberately gets no spinner or
    skeleton of its own: nothing is what the loading frame below has always
    rendered here, and a spinner that flashes for two renders is worse than
    nothing at all.

    ORDER IS LOAD-BEARING. The roster question must be asked BEFORE the team
    question, because an empty roster also leaves `team` undefined — swap these
    two lines and the card becomes unreachable, which is wty4.1.11.8's blank page
    again, reached by reordering instead of by recombining.

    NO DATA YET, with a real `team` — the loading frame it always was:
    `teamMonth` is in flight and resolves shortly. Not a state worth narrating,
    so it renders nothing, exactly as it always did.

    THE FREE SLICE IS COVERED BY THE SAME THREE LINES. DailyTeamFact is only
    reached with `data` in hand, so a free player mid-resolution sees nothing
    rather than an empty or a wrong fact card.
  */
  if (onATeam === false) return <NoTeamCard />
  if (!team) return null
  if (!data) return null

  /*
    THE SCOPE CONTROLS ARE BUILT HERE AND HANDED TO WHICHEVER CARD RENDERS,
    because this is the one place that knows WHICH BRANCH it is — and the branch
    is what decides whether there is a month to choose. Neither card may ask for
    itself: team-panel.tsx's `teamName` header states the bandwidth rule, and
    both `controls` props follow it.

    BELOW ALL THREE GUARDS, DELIBERATELY. A control needs a resolved `team` to
    say which team is selected and to name the id a change navigates AWAY from,
    and the no-team card has nothing to scope at all.
  */
  const teamOptions = teams ?? []

  /*
    THE FREE SLICE IS A DIFFERENT COMPONENT, NOT A CUT-DOWN PANEL. The spec pins
    the free tier to one daily fact rather than a reduced version of the paid
    surface, so there is nothing here to "unlock" — the two render different
    things from the same one aggregate read.
  */
  if (!hasFullTeamMonth(layer3)) {
    return (
      <DailyTeamFact
        /*
          `teaser`, NOT `stats`. The server sends this branch identities and
          today's entry only, and leaves `stats` null for a free viewer
          (wordle-teams-iht.3.2) — so reading `stats` here would render the
          empty state rather than the fact.
        */
        stats={data.teaser}
        viewerId={data.viewerId}
        today={today}
        /* For the card's sr-only heading — it has no painted title. */
        teamName={team.name}
        /*
          NO MONTH SCOPE ON THIS BRANCH — a fact about today has no month to
          choose (see this component's own note on `today`).

          AND NO HEADER AT ALL WHEN THERE IS NO TEAM TO PICK, which is why this
          is `undefined` rather than a TeamScopeControls that would render
          nothing: that card has no title, so an always-drawn header would be
          an empty padded row for an account on a single team. TeamPanel needs
          no such check — its header holds the title either way.
        */
        controls={
          showsTeamDropdown(teamOptions) ? (
            <TeamScopeControls teams={teamOptions} teamId={team.id} onTeamChange={onTeamChange} />
          ) : undefined
        }
      />
    )
  }

  return (
    <TeamPanel
      data={data}
      teamName={team.name}
      /*
        THE SAME QUESTION THE FREE BRANCH ASKS ABOVE, AND IT MUST STAY THE SAME
        CALL. When the team dropdown renders it shows the team's name, so the
        panel drops its VISIBLE title and keeps an `sr-only` heading instead —
        otherwise the header reads "Ada's Analysts  [Ada's Analysts v]". A
        second spelling of "more than one team" here could drift from
        `showsTeamDropdown` and put the duplicate back, or hide the title on a
        one-team account where it is the card's only identifier.

        THIS LINE IS PINNED IN -insights-team-scope.hook.test.ts, NOT IN
        team-panel.hook.test.ts. That distinction is worth the sentence: the
        component test hands TeamPanel the boolean itself, so it covers both
        shapes thoroughly and covers this call site not at all. Replacing this
        expression with either constant once left the entire suite green — one
        of them reinstating the duplicated name this prop exists to remove. The
        route test renders this branch at one team and at two and asserts on the
        header that actually came out.
      */
      titleVisuallyHidden={showsTeamDropdown(teamOptions)}
      controls={
        <TeamScopeControls
          teams={teamOptions}
          teamId={team.id}
          onTeamChange={onTeamChange}
          /*
            THE `undefined` ARM IS UNREACHABLE TODAY, AND IS KEPT ONLY BECAUSE
            `month` IS TYPED OPTIONAL. Trace it: an undefined `month` makes
            `queryMonth` undefined on this branch, which makes the query args
            'skip', which leaves `data` undefined, which returns at
            `if (!data) return null` well above here. So this is a type
            obligation, not a live case — do not cite it as the reason anything
            renders, and do not delete it without narrowing the prop.

            THE WINDOW IS THIS TEAM'S OWN, from its `createdAt` — the rule and
            every one of its edges (the 12-month cap, the absent creation date,
            the timezone consequences) live in lib/insights-months.ts, which is
            also where resolveInsightsSearch reads it from. One list, judged and
            offered by the same function, so the dropdown cannot offer a month
            the resolver would navigate straight back out of.
          */
          month={
            month === undefined
              ? undefined
              : {
                  value: month,
                  options: teamMonthOptions(monthOf(today), team.createdAt),
                  onChange: onMonthChange,
                }
          }
        />
      }
    />
  )
}
