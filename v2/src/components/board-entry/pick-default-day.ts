import { daysOfMonth, isWeekendDay, monthOf } from '../../../convex/lib/puzzleDay.ts'
import type { PuzzleDay, PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'

/**
 * Which day board entry opens to.
 *
 * Extracted as a pure function (quality review, wt-ksh.3.10) after the first
 * cut inlined this in an effect and got it wrong: it set `today` as the
 * current-month default with no regard for `playWeekends`, so a
 * `playWeekends: false` team opening board entry on a Saturday landed on a day
 * the date picker itself renders disabled. `playWeekends` only excludes
 * weekends from SCORING — nothing downstream rejects a weekend puzzleDay — so
 * this was a confusing UI state, not data corruption, but confusing every
 * weekend for a supported configuration is still a real bug.
 *
 * Today, if it's in the requested month AND playable, is the fast path (this
 * is what the vast majority of opens hit). Otherwise — a different month, or
 * today itself is a disabled weekend — falls back to the first unplayed,
 * playable day in the month; if every playable day is already played, the
 * last playable day; if `playWeekends` is false and the month has no playable
 * day at all (never actually possible for a real month, but this must still
 * return something rather than throw), the month's literal last day.
 */
export function pickDefaultDay({
  month,
  today,
  playedDays,
  playWeekends,
}: {
  month: PuzzleMonth
  today: PuzzleDay
  playedDays: ReadonlySet<PuzzleDay>
  playWeekends: boolean
}): PuzzleDay {
  const isPlayable = (day: PuzzleDay) => playWeekends || !isWeekendDay(day)

  if (monthOf(today) === month && isPlayable(today)) return today

  const days = daysOfMonth(month)
  const playableDays = days.filter(isPlayable)
  const unplayed = playableDays.filter((day) => !playedDays.has(day))
  return unplayed[0] ?? playableDays[playableDays.length - 1] ?? days[days.length - 1]
}
