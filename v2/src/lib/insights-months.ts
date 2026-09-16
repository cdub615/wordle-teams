import { addMonths, monthOf, toPuzzleDay, type PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/** How far back a team's insights can be viewed, in months, current month included. */
const CAP = 12

/**
 * Which months a team's insights can be viewed for, newest first, from the
 * team's creation month through `currentMonth` -- the pro expansion that
 * month-picker.tsx's `monthOptions` comment deferred.
 *
 * CAPPED AT 12 rather than left open-ended. v1's equivalent dropdown
 * (src/components/action-buttons/month-dropdown/utils.ts) wraps its long
 * month list in a ScrollArea with a computed height precisely because an
 * unbounded list needs one. Twelve months is generous enough to cover a full
 * year of a team's history while staying short enough to render as a plain
 * list -- no computed height, no scroll math, one fewer thing this dropdown
 * has to get right. A team older than the cap simply cannot see its very
 * first month or two from this control; that is an accepted limitation of a
 * free-form list, not a bug to route around here.
 *
 * `createdAt` IS OPTIONAL BECAUSE UNDEFINED IS A REAL, COMMON STATE, not a
 * defensive fallback. v1's `created_at` column was nullable, so every team
 * migrated from v1 arrives here with no creation date at all -- that is most
 * of the install base, not an edge case. Convex also strips undefined-valued
 * object keys on the wire, so a browser caller sees the key simply absent
 * where a convex-test caller sees it present with value `undefined`; keying
 * off `createdAt === undefined` (or the parameter being omitted) handles both,
 * and is why this must never be reimplemented as an `in` or
 * `hasOwnProperty` check -- those would only ever see the test shape. With no
 * known creation month there is no floor to clamp to, so the answer is the
 * full cap: hiding months a migrated team might genuinely have data in would
 * be worse than occasionally offering one nobody used.
 *
 * TIMEZONE: `createdAt` is converted to a puzzle month in the VIEWER'S LOCAL
 * ZONE, via the same `toPuzzleDay` every other "what day/month is this"
 * question in the app already goes through -- see its own comment on why
 * local, not UTC, is the deliberate choice (Convex runs UTC; "what month is
 * it" is a question about the viewer's calendar, not the server's). The
 * consequence: a team created just after midnight UTC on the 1st, viewed
 * from a zone west of UTC, resolves to the PREVIOUS month locally -- one
 * extra month appears in the list. That extra month has boards from nobody,
 * since the team did not exist yet in that viewer's own calendar, so it just
 * renders the existing "Nobody on this team has entered a board this month
 * yet" empty state. That is a stated outcome, not a bug.
 *
 * A `createdAt` in the future (clock skew, bad data, a team created between
 * `currentMonth` being computed and this running) is clamped to
 * `currentMonth` rather than producing a negative-length or empty list -- the
 * one sure thing about any team is that it can be viewed for the current
 * month.
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
