/**
 * Deciding what the dashboard URL should say, with no router and no clock.
 *
 * Extracted from routes/app.tsx (wordle-teams-lb9). The effect that consumed
 * this inline was the highest-risk code in the Phase 2 UI — it navigates to
 * fill in URL state while racing hydration, which is the shape an infinite
 * redirect takes. Pulling the decision out means the termination property can
 * be a test rather than a comment: feed this function its own output and it
 * must return null.
 *
 * `resolveTeamSettingsSearch` BELOW IS THE SAME IDEA, ONE PARAM NARROWER.
 * routes/team.tsx (wordle-teams-5jcn.29) needs `?team=` resolved exactly the
 * way this file already does it — an invalid or missing id falls back to the
 * stored team, then the first one — but has no `?month=` of its own to carry,
 * so it is its own function rather than a partial application of
 * `resolveDashboardSearch`, which returns `null` only when BOTH params are
 * settled and would never return null for `/team` on a valid team with no
 * month to check.
 */

/**
 * The localStorage key that remembers the caller's last-selected team.
 *
 * Single source of truth — import this rather than repeating the string.
 * Read and written by useDashboardSearchSync (fills `?team=` from it, then
 * keeps it in sync with the URL); also READ (never written) by routes/team.tsx's
 * own fallback effect, through resolveTeamSettingsSearch — that route has no
 * team picker of its own to keep this in sync with, so it only ever consults
 * the dashboard's preference, never sets it. Cleared by DashboardError's retry
 * button (so a stale team can't immediately repopulate the URL after a throw).
 */
export const STORAGE_KEY = 'selectedTeam'

export type DashboardSearchInput = {
  /** `?team=` as it stands, or undefined. */
  teamParam: string | undefined
  /** `?month=`, already shape-validated by the route, or undefined. */
  monthParam: string | undefined
  /** The teams the caller actually belongs to. */
  teams: Array<{ id: string }>
  /** localStorage's remembered team, or null. */
  storedTeam: string | null
  /** The viewer's local current month, 'YYYY-MM'. */
  currentMonth: string
}

/**
 * The search params to navigate to, or null when there is nothing to do —
 * which covers two distinct cases the caller doesn't currently need to tell
 * apart: the URL is already correct, OR there is no team to select at all
 * (`teams` is empty and `storedTeam` doesn't help).
 */
export function resolveDashboardSearch({
  teamParam,
  monthParam,
  teams,
  storedTeam,
  currentMonth,
}: DashboardSearchInput): { team: string; month: string } | null {
  // A teamParam that isn't one of the caller's teams is treated the same as a
  // missing one — a bookmarked or shared URL for a team you've since left.
  // Falling through unvalidated would hand that id straight to the pickers and
  // to real Convex calls.
  const teamValid = teamParam !== undefined && teams.some((team) => team.id === teamParam)
  if (teamValid && monthParam) return null

  const team =
    (teamValid ? teamParam : undefined) ??
    (storedTeam && teams.some((t) => t.id === storedTeam) ? storedTeam : teams[0]?.id)
  if (!team) return null

  return { team, month: monthParam ?? currentMonth }
}

/**
 * The team id `/team` should navigate to, or null when the current `?team=`
 * is already one of the caller's teams — there is nothing to do.
 *
 * SAME FALLBACK ORDER AS resolveDashboardSearch's team half: a param that
 * names a team the caller has since left is treated as absent (a stale
 * bookmark), then the remembered team, then the first team. routes/team.tsx's
 * own loader has already redirected away with zero teams, so `teams` here is
 * never empty in practice — but an empty result is handled the same way
 * regardless, returning null rather than navigating to `?team=undefined`.
 */
export function resolveTeamSettingsSearch({
  teamParam,
  teams,
  storedTeam,
}: {
  teamParam: string | undefined
  teams: Array<{ id: string }>
  storedTeam: string | null
}): string | null {
  const teamValid = teamParam !== undefined && teams.some((team) => team.id === teamParam)
  if (teamValid) return null

  const team = storedTeam && teams.some((t) => t.id === storedTeam) ? storedTeam : teams[0]?.id
  return team ?? null
}
