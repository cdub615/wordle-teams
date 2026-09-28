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

export function addDays(day: PuzzleDay, delta: number): PuzzleDay {
  const date = fromPuzzleDay(day)
  date.setDate(date.getDate() + delta)
  return toPuzzleDay(date)
}

export function addMonths(month: PuzzleMonth, delta: number): PuzzleMonth {
  const [year, monthNum] = month.split('-').map(Number)
  const shifted = new Date(year, monthNum - 1 + delta, 1)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`
}

/**
 * Whether a client-supplied `today` is close enough to the server's clock to
 * trust.
 *
 * `today` is client-supplied, and the server has no viewer whose midnight it
 * could ask for instead. But the value is NOT confined to the caller: both
 * upsertBoard and updateTeam feed it to winner recomputation, which decides
 * which missed days are already due for every member of a team and writes the
 * result to `monthlyWinners` — a row the whole team reads. An unbounded value
 * is therefore shared-state corruption, not a personal view quirk.
 *
 * ±1 day of the server's date. Convex runs UTC, and UTC-12..UTC+14 spans 26
 * hours, so a legitimate client anywhere on earth is always within one
 * calendar day of it. Anything further is broken or hostile.
 *
 * Takes `serverToday` as a PARAMETER rather than reading the clock itself, so
 * this stays a pure function of its inputs and is directly testable — callers
 * compute it once via `toPuzzleDay(new Date())` and pass it in.
 */
export function isPlausibleToday(today: PuzzleDay, serverToday: PuzzleDay): boolean {
  return today >= addDays(serverToday, -1) && today <= addDays(serverToday, 1)
}

/**
 * Wordle's own day zero — the date the game's solution list indexes puzzle 0 to.
 *
 * THE FLOOR ON A STORED puzzleDay, and it is a fact about the game rather than a
 * number picked for roundness. No board can be a board for a puzzle that did not
 * exist, and this is the earliest day that can honestly be called a Wordle
 * puzzle. It is EARLIER than the public launch (October 2021) deliberately:
 * refusing a day the game itself numbers would be this module inventing a rule,
 * and the floor's job is to reject fabrication, not to adjudicate how someone
 * came by an early puzzle.
 *
 * COMFORTABLY BELOW ANY REAL ROW HERE. v1's oldest teams date to 2023
 * (lib/monthWindow.ts's MAX_MONTHS note), so this refuses nothing a migrating
 * player owns — and migrate.ts does not write through the check at all.
 */
export const FIRST_PUZZLE_DAY: PuzzleDay = '2021-06-19'

/**
 * Whether a string is a REAL CALENDAR DAY in 'YYYY-MM-DD' form.
 *
 * STRICTER THAN lib/monthWindow.ts's `isMonth`, WHICH IS SHAPE-ONLY, and the
 * asymmetry is deliberate rather than an oversight in one of them. `isMonth`
 * guards a READ: it admits '2026-00' and '2026-99' because every month that
 * module hands out is `addMonths`-derived, so a nonsense month costs a
 * cosmetically odd dropdown and never reaches a label. A puzzleDay is the
 * opposite kind of value on every axis that matters:
 *
 *   - IT IS STORED, FOREVER, as half of dailyScores' `by_player_and_puzzleDay`
 *     key. A read gate's mistake lasts one request; a write gate's mistake is a
 *     row every later feature has to defend against — which is exactly the
 *     history this check closes (wordle-teams-qvqi).
 *   - IT IS READ AS A DATE, not only as a sortable string. `fromPuzzleDay` hands
 *     it to `new Date(year, month - 1, date, 12)`, which ROLLS OVER rather than
 *     failing: '2026-02-30' becomes March 2nd and '2026-13-01' becomes January
 *     2027. `isWeekendDay` then reads a weekday off that rolled date, and
 *     `pickDefaultDay` (board-entry) decides playability from it — so a merely
 *     well-shaped day can render on a different day from the one it is keyed on.
 *   - IT IS CHECKED ONCE PER WRITE, so strictness is free here in a way it is
 *     not on a query the dashboard mounts on every load.
 *
 * THE ROUND TRIP IS THE CHECK, not a table of month lengths. `fromPuzzleDay`'s
 * rollover is precisely what makes it a decision procedure: a day that is not
 * real comes back as a different string. Leap years come out right for free
 * ('2024-02-29' round-trips, '2026-02-29' does not), which a hand-written
 * `daysInMonth` is one off-by-one from getting wrong every four years.
 *
 * WHAT THE REGEX ADDS, MEASURED RATHER THAN ASSUMED, because most of what it
 * looks like it catches the round trip already catches on its own: '2026-8-18'
 * comes back '2026-08-18', '2026-09-18-00' comes back '2026-09-18', '' comes
 * back 'NaN-NaN-NaN', and '50-03-01' comes back '1950-03-01' — all rejected with
 * no pattern at all. THE ONE THING ONLY THE PATTERN CATCHES IS THE YEAR'S WIDTH.
 * `toPuzzleDay` pads the month and the day but writes `getFullYear()` raw, so
 * '100-01-01' and '20260-01-01' round-trip to themselves EXACTLY and would be
 * accepted. A three- or five-digit year breaks the one property this whole
 * module is built on — that 'YYYY-MM-DD' sorts lexicographically in
 * chronological order — because '999-12-31' sorts ABOVE every day of this
 * century. So the anchored `\d{4}` is the load-bearing half of this line, and
 * the rest of the pattern is a cheap early-out. Both halves are pinned by tests.
 */
export function isPuzzleDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return toPuzzleDay(fromPuzzleDay(value)) === value
}

/**
 * Whether a day is one a board could plausibly be FOR.
 *
 * THE SIBLING OF `isPlausibleToday` ABOVE, and it takes `serverToday` for the
 * same reason: a pure function of its inputs, directly testable, with the clock
 * read once by the caller. `requirePlausiblePuzzleDay` in ../access.ts is the
 * throwing wrapper, beside `requirePlausibleToday`.
 *
 * NOT BOUNDED TO TODAY, AND THAT IS THE WHOLE DIFFERENCE FROM ITS SIBLING.
 * Backfill is a supported feature — the entry form's date picker offers any past
 * day, and `myBenchmarkBoards` calls filling in last Tuesday out by name — so a
 * ±1 day window would refuse the ordinary case. What the two bounds actually
 * rule out is different things: `isPlausibleToday` is asking "is this client's
 * CLOCK honest", and this is asking "could a puzzle have existed on this day".
 *
 * THE CEILING CARRIES THE SAME ONE DAY OF SLACK, for `isPlausibleToday`'s own
 * reason. Convex runs UTC and offsets span UTC−12..UTC+14, so a client east of
 * the runtime is legitimately a calendar day ahead of it; refusing their own
 * today's board would break entry for them for several hours a day. One day is
 * exactly sufficient and has no margin.
 *
 * THERE IS NO SLACK ON THE FLOOR because it needs none — `FIRST_PUZZLE_DAY` is
 * years away from any live board, so a day either side of it changes nothing
 * about which real entries are accepted.
 */
export function isPlausiblePuzzleDay(day: string, serverToday: PuzzleDay): boolean {
  if (!isPuzzleDay(day)) return false
  return day >= FIRST_PUZZLE_DAY && day <= addDays(serverToday, 1)
}

/**
 * Does the viewed month contain this day?
 *
 * EXTRACTED RATHER THAN WRITTEN TWICE. scores-table.tsx used this inline to
 * decide whether to auto-centre today's column; the dashboard's Today panel
 * needs the same question to decide whether to render at all. Two copies of a
 * date predicate is how the two surfaces come to disagree about what "today"
 * means on the 1st of a month.
 *
 * `today` is passed in, never read from a clock here: "today" is a
 * client-only fact, so a pure function must take it as an argument rather
 * than reach for one itself, and stay deterministic.
 */
export function monthContainsToday(month: PuzzleMonth, today: PuzzleDay): boolean {
  return monthOf(today) === month
}
