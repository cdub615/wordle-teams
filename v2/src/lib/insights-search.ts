import type { PuzzleMonth } from '../../convex/lib/puzzleDay.ts'
import { teamMonthOptions } from './insights-months.ts'

/**
 * Deciding what `/insights?team=&month=` should say, with no router and no
 * clock.
 *
 * THE THIRD MEMBER OF THE dashboard-search.ts FAMILY, IN ITS OWN FILE SO THAT
 * THE INSIGHTS MONTH RULE STAYS IN ONE PLACE. Which months are selectable is
 * not this module's rule to state: it belongs to `teamMonthOptions` next door
 * in insights-months.ts, along with the 12-month cap, the creation-month
 * floor, and several paragraphs of timezone reasoning behind them. The only
 * caller of that rule sits beside it, so changing the window means reading
 * two adjacent files rather than one here and one across the directory.
 *
 * Keeping it out of dashboard-search.ts has a second benefit: that file's own
 * header asks to be kept import-free, because its two resolvers take every
 * fact they need as a plain argument and two components import it for
 * `STORAGE_KEY` alone. This function cannot honour that — it reaches
 * `teamMonthOptions` and through it puzzleDay's date arithmetic — so it would
 * have been the first thing to break the rule.
 *
 * `STORAGE_KEY` STAYS IN dashboard-search.ts — it is one key with one home,
 * and the consuming route imports it from there exactly as routes/team.tsx
 * already does.
 *
 * The reason for extracting the decision at all is the same one stated at the
 * top of dashboard-search.ts: this is built to feed a `useEffect` that calls
 * `navigate()` to fill in URL state while racing hydration, which is the shape
 * an infinite redirect takes. Pulling the decision out of the effect means the
 * termination property can be a test rather than a comment — feed this
 * function its own output and it must return null.
 */

export type InsightsSearchInput = {
  /** `?team=` as it stands, or undefined. */
  teamParam: string | undefined
  /**
   * `?month=` as it stands, or undefined. Any string is safe to pass: this
   * module checks membership of the team's window rather than trusting the
   * value to be a well-formed month, so it needs no shape validation from
   * whoever calls it.
   */
  monthParam: string | undefined
  /** The teams the viewer actually belongs to, with creation dates where known. */
  teams: Array<{ id: string; createdAt?: number }>
  /** localStorage's remembered team, or null. */
  storedTeam: string | null
  /** The viewer's local current month, 'YYYY-MM'. */
  currentMonth: PuzzleMonth
}

/**
 * The search params `/insights` should navigate to, or null when there is
 * nothing to do — which covers two cases the caller does not need to tell
 * apart: the URL is already correct, OR there is no team to select at all, so
 * there is nothing to navigate TO.
 *
 * IDEMPOTENT BY CONSTRUCTION, AND THAT IS THE POINT OF THE MODULE. Feeding
 * this its own output must return null, or the effect that consumes it
 * navigates forever. Two facts make it hold, and an editor must not break
 * either:
 *
 * 1. The returned team is always one of `teams`, so on the next pass
 *    `teamValid` is true.
 * 2. `currentMonth` IS ALWAYS A MEMBER OF `teamMonthOptions(currentMonth, x)`
 *    FOR EVERY x — including an absent and a future `createdAt`. So the month
 *    fallback is always itself a member of the very window used to judge it,
 *    and the next pass finds nothing to change. THAT IS insights-months.ts'S
 *    PROPERTY, NOT THIS MODULE'S: it is stated as a rule in that file's header
 *    and pinned by a test in insights-months.test.ts, because this module can
 *    depend on it but cannot enforce it.
 *
 * A rewrite that fell back to something other than a member of the team's own
 * window — the team's creation month, say, or a month from a different team's
 * window — would break (2) and reintroduce the redirect loop.
 */
export function resolveInsightsSearch({
  teamParam,
  monthParam,
  teams,
  storedTeam,
  currentMonth,
}: InsightsSearchInput): { team: string; month: PuzzleMonth } | null {
  const teamValid = teamParam !== undefined && teams.some((team) => team.id === teamParam)

  // The fallback order as one chain: the URL's team, then the remembered one,
  // then the first. Neither miss needs a guard of its own — no team id is
  // `undefined` or `null`, so an absent param and an absent stored team both
  // simply fail to match. A `teamParam` naming a team the viewer has LEFT
  // fails to match for the same reason, which is the point: a stale bookmark
  // or a shared link is treated exactly like a missing param, rather than
  // being handed on to the pickers and to real Convex calls.
  const selectedTeam =
    teams.find((team) => team.id === teamParam) ??
    teams.find((team) => team.id === storedTeam) ??
    teams[0]
  // An empty `teams` is the only way to get here with nothing selected: no
  // team to show and nowhere to navigate.
  if (!selectedTeam) return null

  // MEMBERSHIP OF THE TEAM'S OWN WINDOW IS THE WHOLE MONTH RULE. Malformed,
  // future, and older-than-the-team (or older than the 12-month cap) are all
  // just "not in the list", so none of them needs its own branch — and the
  // window is the SELECTED team's, not the requested one's, since that is the
  // team whose insights are about to be shown.
  const teamMonths = teamMonthOptions(currentMonth, selectedTeam.createdAt)
  const monthValid = monthParam !== undefined && teamMonths.includes(monthParam)

  if (teamValid && monthValid) return null
  return { team: selectedTeam.id, month: monthValid ? monthParam : currentMonth }
}
