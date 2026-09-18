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
  // `pro: false` regardless of the viewer, because the whole point is the floor
  // every account is entitled to. monthWindowFor ignores `pro` when
  // `earliestMonth` is null anyway — see spanFor — so this is what it would
  // return either way; naming it false says the floor is deliberate rather than
  // an accident of the null.
  const free = monthWindowFor({ currentMonth, earliestMonth: null, pro: false })

  // PuzzleMonth is 'YYYY-MM', so a lexical sort IS chronological (see
  // puzzleDay.ts's header) and `.reverse()` gives monthWindowFor's own
  // newest-first order back. The Set is what stops `monthParam` appearing twice
  // when it is already inside the free window, which is the common case.
  return [...new Set([...free, monthParam])].sort().reverse()
}
