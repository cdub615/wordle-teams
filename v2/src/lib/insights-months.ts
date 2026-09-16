import { addMonths, monthOf, toPuzzleDay, type PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/** How far back a team's insights can be viewed, in months, current month included. */
const CAP = 12

/**
 * Which months a team's insights can be viewed for, newest first, from the
 * team's creation month through `currentMonth`. THIS IS A DIFFERENT RULE FROM
 * WHAT month-picker.tsx's `monthOptions` COMMENT DEFERS. That comment
 * describes an eventual pro expansion back to the team's earliest SCORE; this
 * goes back to the team's earliest CREATION MONTH, which is not the same
 * thing in either direction -- most sharply, a player who joins an existing
 * team can bring boards that predate the team's own creation, and this window
 * would hide them. That is the right rule for the insights card this was
 * built for. It is not a drop-in for the scores picker, which still owes its
 * own score-based expansion.
 *
 * CAPPED AT 12 rather than left open-ended. v1's equivalent dropdown
 * (src/components/action-buttons/month-dropdown/utils.ts) wraps its long
 * month list in a ScrollArea with a computed height precisely because an
 * unbounded list needs one. Twelve months is generous enough to cover a full
 * year of a team's history while staying short enough to render as a plain
 * list -- no computed height, no scroll math, one fewer thing this dropdown
 * has to get right. A team older than a year cannot reach its earlier months
 * from this control -- v1 teams date back to 2023, so a three-year-old team
 * loses roughly two dozen months, not "a month or two" -- and that is an
 * accepted limitation of a free-form list, not a bug to route around here.
 *
 * `createdAt` IS OPTIONAL BECAUSE THE SCHEMA SAYS SO, not because it is
 * commonly absent. The schema field is `v.optional`, and getMyTeams
 * (convex/teams.ts) deliberately refuses to substitute a stand-in for a
 * missing value -- see its own comment on why a reflexive `?? 0` there would
 * be worse than the absence it papers over. That leaves a real, if rare, case
 * this module must not crash on: v1's `created_at` column was itself
 * nullable, so a NULL that slipped through migration, or any future row
 * written without a date, arrives here as `undefined` rather than a number.
 * Convex also strips undefined-valued object keys on the wire, so a browser
 * caller sees the key simply absent where a convex-test caller sees it
 * present with value `undefined`; keying off `createdAt === undefined` (or
 * the parameter being omitted) handles both, and is why this must never be
 * reimplemented as an `in` or `hasOwnProperty` check -- those would only ever
 * see the test shape. With no known creation month there is no floor to
 * clamp to, so the answer is the full cap: hiding months a team might
 * genuinely have data in would be worse than occasionally offering one
 * nobody used.
 *
 * TIMEZONE: `createdAt` is converted to a puzzle month in the VIEWER'S LOCAL
 * ZONE, via the same `toPuzzleDay` every other "what day/month is this"
 * question in the app already goes through -- see its own comment on why
 * local, not UTC, is the deliberate choice (Convex runs UTC; "what month is
 * it" is a question about the viewer's calendar, not the server's). Two
 * opposite consequences follow, and both are accepted rather than fixed:
 * a team created just after midnight UTC on the 1st, viewed from a zone west
 * of UTC, resolves to the PREVIOUS month locally -- one extra month appears
 * in the list, with boards from nobody (the team did not exist yet in that
 * viewer's own calendar), so it just renders the existing "Nobody on this
 * team has entered a board this month yet" empty state. The mirror case is
 * not harmless: a team created just BEFORE a UTC month boundary (say
 * 2026-08-31T23:30Z), viewed from a zone EAST of UTC (Tokyo, +9), resolves to
 * the NEXT month locally -- the list starts at September and that viewer
 * cannot select August, even though August can hold real boards from a
 * teammate who was still on 2026-08-31 local in that same window. That month
 * is unreachable from this control, not merely empty. Both are stated
 * outcomes of the local-time choice, not bugs.
 *
 * A `createdAt` in the future (clock skew, bad data, a team created between
 * `currentMonth` being computed and this running) is clamped to
 * `currentMonth` rather than producing a negative-length or empty list -- the
 * one sure thing about any team is that it can be viewed for the current
 * month.
 *
 * `currentMonth` IS ALWAYS ELEMENT 0 OF THE RESULT, FOR EVERY `createdAt` --
 * absent, ancient, this month, or in the future. Both clamps above bound
 * where the range STARTS, and the list is then built by counting BACK from
 * `currentMonth`, so the span is never less than one and the first element is
 * `currentMonth` itself.
 *
 * DO NOT BREAK THAT PROPERTY. insights-search.ts's termination depends on it
 * by name: resolveInsightsSearch falls back to `currentMonth` whenever a
 * `?month=` is not a member of this list, and that fallback settles -- rather
 * than the effect behind it navigating forever -- only because the fallback
 * value is itself always a member. A change like "do not offer the current
 * month until the team has a board in it" would read as entirely reasonable
 * here and reintroduce an infinite redirect in a file its author had no
 * reason to open. insights-months.test.ts pins this on its own; that test is
 * not decoration, and the property is this module's to keep.
 */
export function teamMonthOptions(
  currentMonth: PuzzleMonth,
  createdAt?: number,
): Array<PuzzleMonth> {
  const earliestUnderCap = addMonths(currentMonth, -(CAP - 1))
  const createdMonth =
    createdAt === undefined ? earliestUnderCap : monthOf(toPuzzleDay(new Date(createdAt)))

  // PuzzleMonth strings ('YYYY-MM') sort lexicographically in calendar order,
  // same as PuzzleDay -- see puzzleDay.ts's header comment. Plain string
  // comparison is enough to clamp in both directions at once: below the cap's
  // floor, and above the current month.
  const startMonth =
    createdMonth < earliestUnderCap
      ? earliestUnderCap
      : createdMonth > currentMonth
        ? currentMonth
        : createdMonth

  const span = monthIndex(currentMonth) - monthIndex(startMonth) + 1
  return Array.from({ length: span }, (_, i) => addMonths(currentMonth, -i))
}

/** Months since a fixed epoch, purely so two PuzzleMonths can be subtracted. */
function monthIndex(month: PuzzleMonth): number {
  const [year, monthNum] = month.split('-').map(Number)
  return year * 12 + monthNum
}
