/**
 * Arithmetic on puzzle days, which are 'YYYY-MM-DD' strings.
 *
 * The whole point of the format is that it sorts lexicographically, so day
 * comparison, month bounding and index ranges are all plain string operations.
 * That is why this module has no dependencies and must keep none: it is
 * imported by Convex functions, and dragging a date library into that bundle
 * for `a < b` would be absurd.
 *
 * See the schema note on dailyScores.puzzleDay for why a board belongs to a
 * PUZZLE rather than to a moment.
 */

/** A puzzle day, 'YYYY-MM-DD'. */
export type PuzzleDay = string
/** A puzzle month, 'YYYY-MM'. */
export type PuzzleMonth = string

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The puzzle day a Date falls on IN THE ZONE THE DATE IS RESOLVED IN — local in
 * a browser. Deliberately reads the local getters, never the getUTC* ones:
 * resolving "which day is this" in UTC is precisely v1's bug.
 */
export function toPuzzleDay(date: Date): PuzzleDay {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * A Date at LOCAL NOON on the given day. Noon rather than midnight because a
 * DST spring-forward can erase 00:00 entirely, which would silently shift the
 * day. Only for handing days to APIs that insist on Dates (react-day-picker).
 */
export function fromPuzzleDay(day: PuzzleDay): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12)
}

export function monthOf(day: PuzzleDay): PuzzleMonth {
  return day.slice(0, 7)
}

/**
 * Inclusive string bounds for an index range query over a month.
 *
 * `end` is '<month>-31' even in February. It is a lexicographic bound, not a
 * date: no real day string in the month can exceed it, and no day of the next
 * month can fall under it.
 */
export function monthRange(month: PuzzleMonth): { start: PuzzleDay; end: PuzzleDay } {
  return { start: `${month}-01`, end: `${month}-31` }
}

export function daysOfMonth(month: PuzzleMonth): Array<PuzzleDay> {
  const [year, monthNum] = month.split('-').map(Number)
  // Day 0 of the following month is the last day of this one.
  const count = new Date(year, monthNum, 0).getDate()
  return Array.from({ length: count }, (_, i) => `${month}-${pad(i + 1)}`)
}

export function isWeekendDay(day: PuzzleDay): boolean {
  const dayOfWeek = fromPuzzleDay(day).getDay()
  return dayOfWeek === 0 || dayOfWeek === 6
}

export function addMonths(month: PuzzleMonth, delta: number): PuzzleMonth {
  const [year, monthNum] = month.split('-').map(Number)
  const shifted = new Date(year, monthNum - 1 + delta, 1)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`
}
