import { monthWindowFor } from '../../convex/lib/monthWindow.ts'
import type { PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * What the dashboard should do about `?month=` once it knows the team's window,
 * and what to drive the two month controls with before it does.
 *
 * IN ITS OWN MODULE RATHER THAN IN dashboard-search.ts, which that file's header
 * asks for by name: "A new rule that needs a date library, a Convex call, or the
 * insights month window belongs in its own module beside what it depends on, the
 * way insights-search.ts does." This one needs a window that only a Convex query
 * can supply the input for, and it imports convex/lib/monthWindow.ts to build it
 * — two things dashboard-search.ts's "KEEP THIS FILE IMPORT-FREE" rules out.
 *
 * IT IS ALSO THE WRONG SHAPE FOR resolveDashboardSearch, and that is a hard
 * constraint rather than a preference. useSearchSync's `resolve` parameter must
 * be a module-level function — its own doc says so, and the sibling requirement
 * on its `navigate` parameter is what wordle-teams-1ubk fixed after a call-site
 * closure re-ran that effect on every render — so the resolver cannot be handed
 * per-team data. resolveInsightsSearch escapes this only because `createdAt`
 * rides along on every entry of the `teams` array it already receives;
 * `earliestMonth` does not.
 *
 * EVERY OUT-OF-WINDOW MONTH IS CORRECTED, AND THE SPEC USED TO SPLIT THEM. An
 * earlier design corrected a team switch but let a bookmark kept across a
 * downgrade reach the server's typed MONTH_OUT_OF_WINDOW, so it could explain
 * itself. That is not implementable here: both arrive as "?month= is not in this
 * window", and telling them apart means threading the previous teamParam through
 * an effect that navigates — the riskiest code in the feature. It would also
 * race: six components call useSuspenseQuery(api.scores.getTeamMonth) during
 * render (scores-table, scoring-legend, scoring-system-card, today-panel,
 * teams/team-boards and board-entry/form) while this correction only runs after
 * commit, so whichever resolved first would decide what the player saw.
 * Intermittent behaviour is worse than either branch. The server gate stays and
 * still makes the tier real; a browser user simply is not expected to meet it.
 *
 * THE PURE FUNCTION IS THE POINT. The caller navigates from an effect, which is
 * the shape an infinite redirect takes; pulling the decision out means the
 * termination property is a test rather than a comment. Feed `correctedMonth`
 * its own output and it must return null.
 */
export function correctedMonth({
  monthParam,
  months,
}: {
  /** `?month=` as it stands, or undefined before useSearchSync has filled it. */
  monthParam: string | undefined
  /** The selected team's window, or undefined while the query is in flight. */
  months: Array<PuzzleMonth> | undefined
}): PuzzleMonth | null {
  if (monthParam === undefined) return null
  if (months === undefined || months.length === 0) return null
  if (months.includes(monthParam)) return null

  // Element 0, which monthWindowFor guarantees is `currentMonth` for every input.
  // That guarantee is what makes this terminate: the value returned here is itself
  // always a member of the window this function judges against, so a second pass
  // returns null.
  return months[0]
}

/**
 * What to drive the two month controls with while `api.scores.monthWindow` is
 * still in flight — and on every render before hydration, where the viewer's
 * clock may not be read at all.
 *
 * THE FREE WINDOW, PLUS THE MONTH ALREADY ON SCREEN. Not `[currentMonth]`, which
 * an earlier draft used: team-boards.tsx derives its DatePicker's `minDay` from
 * the OLDEST entry of the `months` array it is handed, so a one-element array
 * would set minDay to the first of the current month — after every day of a past
 * month a Pro viewer might be looking at — and react-day-picker would disable the
 * entire visible grid and both step arrows for the length of one round trip.
 * Including `monthParam` keeps the control alive on the month actually being
 * viewed.
 *
 * THE FREE WINDOW IS THE SAFE FLOOR because every account is entitled to it, so
 * this can only ever WIDEN when the query lands — never take a month away that
 * was briefly offered.
 *
 * A `monthParam` NEWER THAN `currentMonth` LANDS AT ELEMENT 0 AND LEAVES A GAP,
 * and that is accepted rather than guarded. `validateSearch` in routes/app.tsx
 * admits any well-formed 'YYYY-MM', so a hand-typed '2030-01' briefly renders a
 * four-entry dropdown with three years missing from the middle. It survives
 * exactly one round trip: the query lands, `correctedMonth` finds '2030-01'
 * outside the real window and sends the reader to element 0 of THAT list, which
 * is the current month. Adding a bound here would duplicate monthWindow.ts's own
 * reasoning about why it has no upper bound (a future month simply holds no
 * boards) for a case that self-heals.
 */
export function fallbackMonths(
  currentMonth: PuzzleMonth,
  monthParam: PuzzleMonth,
): Array<PuzzleMonth> {
  const free = freeMonths(currentMonth)

  // PuzzleMonth is 'YYYY-MM', so a lexical sort IS chronological (see
  // puzzleDay.ts's header) and `.reverse()` gives monthWindowFor's own
  // newest-first order back. The Set is what stops `monthParam` appearing twice
  // when it is already inside the free window, which is the common case.
  return [...new Set([...free, monthParam])].sort().reverse()
}

/**
 * Whether the dashboard body may be rendered for `?month=` yet, or whether
 * routes/app.tsx must hold it on a skeleton until the answer is known
 * (wordle-teams-alr7).
 *
 * THE RACE THIS EXISTS TO CLOSE. `correctedMonth` above runs from an EFFECT, and
 * the six `useSuspenseQuery(api.scores.getTeamMonth)` call sites this file's own
 * header lists run during RENDER. So on any render where `?month=` is outside the
 * selected team's window and `loadedWindow` has not arrived, all six go out with a
 * month `getTeamMonthFor` refuses, and MONTH_OUT_OF_WINDOW reaches the route's
 * error boundary before the correction can possibly have fired. Two different
 * paths reach that render, and only one of them was reported:
 *
 *   A TEAM SWITCH. routes/app.tsx's TeamPicker `onChange` preserves `?month=`
 *   deliberately, so a reader comparing two teams stays on the month they were
 *   looking at. The switch changes `monthWindowArgs`, so `api.scores.monthWindow`
 *   becomes a new query key, `monthWindowInputs` goes undefined, and `loadedWindow`
 *   with it. Reachable by a Pro viewer leaving a team with years of history for one
 *   that does not go back that far.
 *
 *   A FIRST LOAD, WHICH THE ISSUE DID NOT NAME AND WHICH IS THE WIDER DOOR. A
 *   bookmarked or shared `?team=&month=` arrives with `monthWindowInputs`
 *   undefined for exactly the same reason — the query has not answered yet — so
 *   the FIRST render of the dashboard body is already the racing one, with no team
 *   switch anywhere in it. It needs no Pro subscription either: routes/app.tsx's
 *   `validateSearch` admits any well-formed 'YYYY-MM' without consulting a window,
 *   so a free viewer who hand-types or is sent `?month=2020-01` lands on it. A fix
 *   scoped to the picker's `onChange` would have left this path open.
 *
 * THE FREE WINDOW IS SAFE FOR EVERY TEAM AND EVERY TIER, which is what lets this
 * answer true before the query has said anything — and so what keeps an ordinary
 * load off the skeleton entirely. Two halves, both in convex/lib/monthWindow.ts:
 *
 *   ON THE CLIENT, EVERY WINDOW CONTAINS THE FREE ONE. `monthWindowFor` is
 *   `countBack(currentMonth, spanFor(...))` and `spanFor` returns
 *   `Math.min(Math.max(span, FREE_MONTHS), MAX_MONTHS)`, so the list always starts
 *   at `currentMonth` and is always at least FREE_MONTHS long — whatever the team's
 *   `earliestMonth` and whatever the tier. That `Math.max` is the line
 *   monthWindow.ts calls the most important in the file.
 *
 *   ON THE SERVER, THE FREE FLOOR DOES NOT DEPEND ON THE TEAM. `getTeamMonthFor`
 *   tests `month < serverFloorFor({ currentMonth: serverMonth, earliestMonth: null,
 *   pro: false })` FIRST and, for anything above it, returns without reading a
 *   membership row, a roster or an `earliestMonth` at all. The two clocks cannot
 *   disagree enough to matter: SERVER_SLACK_MONTHS puts that floor a month below
 *   the oldest month a client free window offers, and UTC offsets span
 *   UTC-12..UTC+14, so the two sides are at most one month apart.
 *
 * NOT `keepPreviousData` ON THE WINDOW QUERY, which was the first remedy recorded
 * on the issue and does not work: the PREVIOUS team's window contains the month on
 * screen by construction, so `correctedMonth` would still return null and the six
 * bad queries would still go out. It hides the symptom in `loadedWindow` without
 * preventing the request. The only placeholder that is known-safe for a team whose
 * window has not loaded is the free one, which is the first disjunct below.
 *
 * TERMINATION, which is what a caller rendering a skeleton on false depends on.
 * Once `loadedWindow` arrives, either it contains `?month=` and this returns true,
 * or `correctedMonth` returns element 0 of it — `currentMonth`, which
 * `monthWindowFor` guarantees for every input — the effect navigates there, and
 * `currentMonth` is in the free window, so the next render returns true by the
 * first disjunct. The skeleton lasts one round trip at most, and the case that
 * would otherwise hang — a `?team=` the viewer is not a member of, where
 * `monthWindowArgs` is 'skip' and `loadedWindow` never arrives — is settled from
 * the other side by `resolveDashboardSearch`, which replaces that param.
 *
 * PRE-HYDRATION IT IS ALWAYS TRUE, SO SSR IS UNCHANGED. routes/app.tsx passes
 * `clockMonth ?? monthParam` as `currentMonth`, and `clockMonth` is undefined on
 * every render that has to match the server — so before hydration the free window
 * is built AROUND `?month=` and therefore contains it. That is not a loophole, it
 * is the only shape available: the viewer's clock cannot be read on a render that
 * has to match the server (the hydration-mismatch class wordle-teams-uc5 was), so
 * a guard that held on those renders would hold on EVERY /app load and the
 * dashboard would stop server-rendering altogether.
 *
 * WHICH LEAVES ONE RESIDUE, AND IT IS SERVER-SIDE ONLY. On a bookmarked load
 * carrying an out-of-window month the six queries still go out DURING SSR and
 * still take a MONTH_OUT_OF_WINDOW there — observed in the dev server's log while
 * e2e/month-window.spec.ts passes. React streams the Suspense fallbacks, flags
 * those boundaries for client rendering, and the browser starts the queries
 * again over the websocket; `useHydrated`'s passive effect flips on the hydration
 * commit, this guard returns false on the re-render that follows, and the six
 * subtrees are discarded while still suspended — so they never reach the throw
 * and the route's boundary never catches. The margin is a React passive-effect
 * flush against a network round trip, which is not close.
 *
 * SO THE READER IS FIXED AND THE LOG IS NOT: those SSR rejections are still
 * logged where the Worker's console goes. That is not a regression — the same
 * queries threw in the same place before this guard existed, and the reader saw
 * DashboardError as well. Closing it would mean deciding the month on the SERVER,
 * whose clock is UTC and the reader's is not, which is the disagreement
 * SERVER_SLACK_MONTHS exists to absorb rather than to relitigate here.
 */
export function isServableMonth({
  monthParam,
  currentMonth,
  loadedWindow,
}: {
  /** `?month=`. Always set — routes/app.tsx has already returned without it. */
  monthParam: PuzzleMonth
  /** The month the caller treats as current: the viewer's clock, or `?month=` before hydration. */
  currentMonth: PuzzleMonth
  /** The selected team's window, or undefined while `api.scores.monthWindow` is in flight. */
  loadedWindow: Array<PuzzleMonth> | undefined
}): boolean {
  return (
    freeMonths(currentMonth).includes(monthParam) || (loadedWindow?.includes(monthParam) ?? false)
  )
}

/**
 * The window every account is entitled to, around the month given.
 *
 * ONE SPELLING OF THE FREE WINDOW FOR THE TWO CALLERS ABOVE rather than the
 * `earliestMonth: null, pro: false` incantation written twice. Both lean on the
 * same property — that this is the SAFE FLOOR, the list no team and no tier can
 * fail to cover — and a second copy is how one of them quietly acquires an
 * `earliestMonth` and the other does not.
 *
 * `pro: false` IS NAMED EVEN THOUGH IT CHANGES NOTHING. `spanFor` ignores `pro`
 * entirely when `earliestMonth` is null, so monthWindowFor would return this list
 * either way; writing it false says the floor is the point rather than an accident
 * of the null.
 */
function freeMonths(currentMonth: PuzzleMonth): Array<PuzzleMonth> {
  return monthWindowFor({ currentMonth, earliestMonth: null, pro: false })
}
