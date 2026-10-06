/**
 * THE COLLAPSE RULE FOR DUPLICATE DAILY SCORES (wordle-teams-rac).
 *
 * v1 had no uniqueness constraint on (player, date) and its upsertBoard inserted a
 * fresh row whenever the client had no score id yet, so a double submit made two
 * rows. The copy carried them into v2 faithfully, by design (migrate.ts's
 * upsertDailyScores). v2 cannot create new ones, so this is a one-time repair, and
 * this function is the whole of its decision: every row the repair deletes is a
 * row this function put in the `drop` list of a group it did not hold.
 *
 * PURE, AND OVER ONE PLAYER'S ROWS. Groups are keyed on `puzzleDay` alone, so rows
 * from two players must never be mixed in one call. Nothing here imports beyond
 * convex/lib.
 *
 * THE SURVIVOR IS THE ROW v2 EDITS (owner's decision, revision 2, 2026-10-06):
 * the FIRST row in `by_player_and_puzzleDay` order, which for one player and day
 * is ascending `_creationTime`. upsertBoardFor patches whatever `.first()`
 * returns and never touches `createdAt`, so every edit made in v2 since the
 * cutover landed on this row. Keeping the "later-written" row instead — the
 * revision-1 rule — could delete a row a player had since edited.
 *
 * HELD, NEVER DELETED, AND REPORTED WITH THE REASON:
 *   answers-differ  two different non-empty answers are two different PUZZLES.
 *                   Days were derived from v1 instants in the player's CURRENT
 *                   zone (copy-from-supabase.mjs), so two real boards can land on
 *                   one day. That needs re-dating, not deleting.
 *   dates-apart     `date` instants more than ten minutes apart are not the
 *                   double-submit signature (v1's pairs were 1-40 s apart).
 *   v2-row          a row with no `legacyId` was written by v2, which can only
 *                   happen if something other than a v1 double submit made it.
 *
 * `differing` is true when any dropped row's guesses or answer differ from the
 * survivor's, compared strictly (an absent answer and '' differ): it tells the
 * owner a delete loses information, so it errs towards saying so.
 */

export type CollapseRow<Id extends string = string> = {
  _id: Id
  _creationTime: number
  puzzleDay: string
  date: number
  guesses: string[]
  answer?: string
  createdAt?: number
  legacyId?: number
}

export type HoldReason = 'answers-differ' | 'dates-apart' | 'v2-row'

export type CollapseGroup<Row> = {
  puzzleDay: string
  keep: Row
  /** Every other row for the day, in index order. NOT deleted when `held` is non-empty. */
  drop: Row[]
  differing: boolean
  /** Why this group must not be collapsed. Empty means it may be. */
  held: HoldReason[]
  /** Largest minus smallest `date` instant in the group. */
  dateGapMs: number
}

/** Ten minutes: v1's double submits were seconds apart (wordle-teams-rac). */
export const DATE_GAP_LIMIT_MS = 10 * 60 * 1000

function sameContent(a: CollapseRow, b: CollapseRow): boolean {
  return (
    a.answer === b.answer &&
    a.guesses.length === b.guesses.length &&
    a.guesses.every((guess, i) => guess === b.guesses[i])
  )
}

function holdReasons(rows: readonly CollapseRow[], dateGapMs: number): HoldReason[] {
  const held: HoldReason[] = []
  const answers = new Set(rows.map((row) => row.answer).filter((answer) => !!answer))
  if (answers.size > 1) held.push('answers-differ')
  if (dateGapMs > DATE_GAP_LIMIT_MS) held.push('dates-apart')
  if (rows.some((row) => row.legacyId === undefined)) held.push('v2-row')
  return held
}

/**
 * One group per `puzzleDay` holding more than one row, ordered by day. A day with
 * a single row produces nothing.
 */
export function planCollapse<Row extends CollapseRow>(rows: readonly Row[]): CollapseGroup<Row>[] {
  const byDay = new Map<string, Row[]>()
  for (const row of rows) {
    const day = byDay.get(row.puzzleDay) ?? []
    day.push(row)
    byDay.set(row.puzzleDay, day)
  }

  const groups: CollapseGroup<Row>[] = []
  for (const [puzzleDay, dayRows] of byDay) {
    if (dayRows.length < 2) continue
    const ordered = [...dayRows].sort((a, b) => a._creationTime - b._creationTime)
    const [keep, ...drop] = ordered
    const dates = ordered.map((row) => row.date)
    const dateGapMs = Math.max(...dates) - Math.min(...dates)
    groups.push({
      puzzleDay,
      keep,
      drop,
      differing: drop.some((row) => !sameContent(row, keep)),
      held: holdReasons(ordered, dateGapMs),
      dateGapMs,
    })
  }
  return groups.sort((a, b) => a.puzzleDay.localeCompare(b.puzzleDay))
}

/** The rows a repair of these groups deletes: every `drop` of every group not held. */
export function rowsToDelete<Row extends CollapseRow>(groups: readonly CollapseGroup<Row>[]): Row[] {
  return groups.filter((group) => group.held.length === 0).flatMap((group) => group.drop)
}

/**
 * EXACTLY WHAT A REPAIR OF ONE MONTH WOULD DELETE, as a string the dry run hands
 * the operator and the apply must match: `YYYY-MM:` and the deleted rows' legacy
 * ids in ascending numeric order. Every deletable row has a legacyId — a group
 * holding a row without one is held.
 */
export function deletionKey<Row extends CollapseRow>(
  month: string,
  groups: readonly CollapseGroup<Row>[],
): string {
  const ids = rowsToDelete(groups)
    .map((row) => row.legacyId as number)
    .sort((a, b) => a - b)
  return `${month}:${ids.join(',')}`
}
