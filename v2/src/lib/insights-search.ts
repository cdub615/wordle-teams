import type { PuzzleMonth } from '../../convex/lib/puzzleDay.ts'
import { teamMonthOptions } from './insights-months.ts'

/**
 * Deciding what `/insights?team=&month=` should say, with no router and no
 * clock.
 *
 * THE THIRD MEMBER OF THE dashboard-search.ts FAMILY, AND IT LIVES IN ITS OWN
 * FILE ON PURPOSE. `resolveDashboardSearch` and `resolveTeamSettingsSearch`
 * share a file because they share a shape AND a property: that module imports
 * nothing at all — every fact it needs arrives as a plain argument, which is
 * what "no router and no clock" in its header buys. This one cannot have that
 * property: which months it accepts depends on the selected team's creation
 * date, through `teamMonthOptions` and in turn puzzleDay's date arithmetic.
 * Adding it there would make that shared module a non-leaf, and two
 * components (app-menu.tsx, dashboard-error.tsx) import it for `STORAGE_KEY`
 * and nothing else. Bundlers tree-shake, so this is not an argument about
 * bytes; it is about keeping the insights month rule in one place next to the
 * module that defines the window, rather than splitting it across the file
 * everything reaches for a localStorage key.
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
  /** `?month=` as it stands, not yet known to be a month at all, or undefined. */
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
 *    FOR EVERY x — the list is built by counting back from `currentMonth`,
 *    and its start month is clamped to never exceed `currentMonth`, so the
 *    list always has at least one element and that element is `currentMonth`.
 *    Even the future-`createdAt` case (clock skew, bad data) returns exactly
 *    `[currentMonth]`. So the month fallback is itself always a valid member
 *    of the same window that is used to judge it, and the next pass finds
 *    nothing to change.
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
  // A teamParam that isn't one of the viewer's teams is treated the same as a
  // missing one — a bookmarked or shared URL for a team you've since left.
  // Same fallback order as resolveDashboardSearch: the param, then the
  // remembered team, then the first team.
  const teamValid = teamParam !== undefined && teams.some((team) => team.id === teamParam)
  // A null `storedTeam` needs no guard of its own: no team id is null, so the
  // find simply misses and the `?? teams[0]` behind it takes over.
  const selected = teamValid
    ? teams.find((team) => team.id === teamParam)
    : (teams.find((team) => team.id === storedTeam) ?? teams[0])
  // The only way to reach this with nothing selected is an empty `teams` —
  // there is no team to show and nowhere to navigate, so say so.
  if (!selected) return null

  // MEMBERSHIP OF THE TEAM'S OWN WINDOW IS THE WHOLE MONTH RULE. Malformed,
  // future, and older-than-the-team (or older than the 12-month cap) are all
  // just "not in the list", so none of them needs its own branch — and the
  // window is the SELECTED team's, not the requested one's, since that is the
  // team whose insights are about to be shown.
  const months = teamMonthOptions(currentMonth, selected.createdAt)
  const monthValid = monthParam !== undefined && months.includes(monthParam)

  if (teamValid && monthValid) return null
  return { team: selected.id, month: monthValid ? monthParam : currentMonth }
}
