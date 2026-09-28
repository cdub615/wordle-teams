import { useEffect } from 'react'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { STORAGE_KEY } from '#/lib/dashboard-search.ts'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'

/**
 * Keeps `?team=` and `?month=` filled in, and remembers the team.
 *
 * ONE HOOK FOR /app AND /insights (wordle-teams-1ubk). The effect existed twice,
 * and the second half of it was byte-identical in both — the localStorage write
 * below. The first halves differed only in which resolver they called and a
 * `teams ?? []`, so the resolver is a parameter and everything else is shared.
 *
 * AFTER HYDRATION ONLY, AND THIS IS NOW THE ONLY PLACE THAT RULE IS STATED. The
 * current month has to come from the browser's local clock, and reading it
 * during render would make the server (UTC) and the client (local) disagree on
 * the last and first days of a month — the hydration-mismatch class that
 * 45e3cd6 fixed in v1 and that wordle-teams-uc5 was. The URL is the source of
 * truth; localStorage only supplies the default. It used to be stated in three
 * files (here, routes/insights.tsx, and routes/team.tsx as the negative case);
 * two statements of a rule is a cross-reference, three is drift waiting to
 * happen. routes/team.tsx's effect still says why it needs no such guard — it
 * reads localStorage and never the clock — and that one is a genuine contrast
 * rather than a third copy.
 *
 * THE DECISION ITSELF IS PURE AND LIVES IN THE RESOLVER, each of which has a
 * test asserting it is idempotent — feed it its own output and it returns null.
 * That property is the only thing standing between this effect and an infinite
 * redirect. Read the resolver's header before changing what it is fed.
 */
export function useSearchSync({
  teamParam,
  monthParam,
  teams,
  resolve,
  navigate,
  to,
}: {
  teamParam: string | undefined
  monthParam: string | undefined
  /**
   * The teams the viewer belongs to, or `undefined` while the query is in
   * flight. `createdAt` is optional because only the insights resolver reads it.
   */
  teams: Array<{ id: string; createdAt?: number }> | undefined
  /**
   * resolveDashboardSearch or resolveInsightsSearch. A MODULE-LEVEL FUNCTION IN
   * BOTH CASES, which is what keeps it out of trouble in the dependency array
   * below — the same requirement `navigate` carries, for the same reason.
   */
  resolve: (input: {
    teamParam: string | undefined
    monthParam: string | undefined
    teams: Array<{ id: string; createdAt?: number }>
    storedTeam: string | null
    currentMonth: string
  }) => { team: string; month: string } | null
  /**
   * useNavigate's OWN RESULT, PASSED RAW — never a closure built at the call
   * site, and this is the trap wordle-teams-1ubk existed to fix rather than
   * inherit.
   *
   * routes/app.tsx used to pass `navigate: (search) => void navigate({ ... })`.
   * That is a fresh function on every render, sitting in this effect's
   * dependency array, so the sync effect re-ran on EVERY render of the
   * dashboard. routes/insights.tsx never had the flaw, because it passed
   * useNavigate's result directly and that result is useCallback-stable
   * (memoised on `_defaultOpts?.from`, a stable string).
   *
   * So the hook takes the stable function plus a `to`, and builds the argument
   * itself. A generalised hook that kept the closure shape would have handed
   * /app's per-render effect to /insights rather than taking it off /app.
   */
  navigate: (options: {
    to: string
    search: { team: string; month: string }
    replace: boolean
    resetScroll: boolean
  }) => unknown
  /** The route to navigate within — `Route.fullPath` at both call sites. */
  to: string
}): void {
  const hydrated = useHydrated()

  useEffect(() => {
    if (!hydrated) return
    const next = resolve({
      teamParam,
      monthParam,
      /*
        `teams ?? []` RATHER THAN AN EARLY RETURN. With the team list still in
        flight the resolver has nothing to select and returns null, which is
        exactly the "do nothing" an early return would produce. The DEPENDENCY
        stays `teams` itself — the reference react-query hands back, which holds
        while the data is unchanged — because `teams ?? []` in the dependency
        array would be a fresh array on every render and re-run the effect on
        each one.
      */
      teams: teams ?? [],
      storedTeam: localStorage.getItem(STORAGE_KEY),
      currentMonth: monthOf(toPuzzleDay(new Date())),
    })
    /*
      `resetScroll: false` BECAUSE THIS NAVIGATION IS A CORRECTION NOBODY ASKED
      FOR (wordle-teams-wty4.1.16). The router's `scrollRestoration: true`
      (router.tsx) scrolls to top on every navigation, and throwing a reader to
      the top of the page is a reasonable thing to do when they asked to go
      somewhere — but this effect fires when the URL they arrived with, or the
      one a team change just produced, names a month the selected team's window
      does not reach. They did not ask for it and should not be moved by it.

      IT IS WHAT MAKES THE /insights FIX COMPLETE rather than a separate tidy-up.
      A team change there already passes `resetScroll: false`, but switching to a
      YOUNGER team while viewing an old month invalidates `?month=` and lands
      here, so without this the reader is thrown to the top anyway on exactly
      the case the fix was about.

      ON /app THIS IS ALL BUT INVISIBLE, which is why one flag serves both
      callers: its team and month pickers sit at the top of the grid, so a
      reader operating them is already at the top and has no scroll to keep.
    */
    if (next) void navigate({ to, search: next, replace: true, resetScroll: false })
  }, [hydrated, teamParam, monthParam, teams, resolve, navigate, to])

  /*
    THE REMEMBERED TEAM, WRITTEN BY BOTH PAGES THAT HAVE A TEAM CONTROL.
    `/team` only READS and CLEARS it, deliberately: it has no control of its own
    to keep the key in sync with. STORAGE_KEY's own doc in lib/dashboard-search.ts
    says which page does what.

    NOT CONDITIONAL ON THE PARAM BEING VALID. A stale or foreign `?team=` is
    written for the render or two before the effect above replaces it — EXCEPT
    for a viewer with no teams at all, where the resolver returns null, nothing
    navigates, and the foreign id stays. Harmless: every reader of this key
    re-validates it against the roster before selecting anything
    (resolveDashboardSearch, resolveTeamSettingsSearch and resolveInsightsSearch
    all do), so a value nobody can use is inert.
  */
  useEffect(() => {
    if (teamParam) localStorage.setItem(STORAGE_KEY, teamParam)
  }, [teamParam])
}
