import { fromPuzzleDay, type PuzzleDay, type PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * Day and month labels, matching v1's date-fns 'EE do' and 'MMM yyyy'.
 *
 * Intl rather than date-fns: nothing else in v2 needs a date library, and the
 * only thing Intl will not do is the ordinal suffix, which is six lines.
 * Locale is pinned to en-US because the labels are compared against v1's output
 * during the Phase 7 parity audit.
 */

const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })

export function ordinal(n: number): string {
  // 11th, 12th and 13th are the exceptions to the 1st/2nd/3rd pattern.
  const teen = n % 100
  if (teen >= 11 && teen <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/**
 * 'Mon' / '3rd' — the scores table's day column header, as two separate
 * pieces rather than one joined string.
 *
 * The caller (scores-table.tsx) renders these as two elements that stack
 * onto two lines below `md` and sit side by side at `md` and up, matching
 * v1's appearance without v1's mechanism (v1 relies on table-layout: auto
 * column compression to force the wrap; see the `w-max min-w-full` comment
 * on <Table> for why v2 deliberately doesn't use that mechanism). Splitting
 * here, in the pure formatter, keeps the join-vs-stack decision entirely a
 * markup/CSS concern in the component.
 */
export function formatDayHeaderParts(day: PuzzleDay): { weekday: string; ordinal: string } {
  const date = fromPuzzleDay(day)
  return { weekday: weekday.format(date), ordinal: ordinal(date.getDate()) }
}

/** 'Aug 2026' — the month picker's label. */
export function formatMonthLabel(month: PuzzleMonth): string {
  return monthYear.format(fromPuzzleDay(`${month}-01`))
}
