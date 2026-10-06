/**
 * THE COLLAPSE RULE FOR DUPLICATE DAILY SCORES (wordle-teams-rac).
 *
 * v1 had no uniqueness constraint on (player, date) and its upsertBoard inserted a
 * fresh row whenever the client had no score id yet, so a double submit made two
 * rows. The copy carried them into v2 faithfully, by design (migrate.ts's
 * upsertDailyScores). v2 cannot create new ones, so this is a one-time repair, and
 * this function is the whole of its decision: every row the repair deletes is a
 * row this function put in a `drop` list.
 *
 * PURE, AND OVER ONE PLAYER'S ROWS. Callers pass rows they have just read from
 * `by_player_and_puzzleDay` for a single player; the groups are keyed on
 * `puzzleDay` alone, so rows from two players must never be mixed in one call.
 * Nothing here imports beyond convex/lib, so the rule is a unit test over
 * fixtures rather than something only a live deployment could demonstrate.
 *
 * THE SURVIVOR IS THE LATER-WRITTEN ROW — the owner's decision of 2026-10-05.
 * "Later" is decided, in order, by:
 *   1. `createdAt` (v1's created_at, carried by the copy). A row WITHOUT one sorts
 *      before every row with one.
 *   2. `legacyId` (v1's serial id). A row without one sorts before every row with
 *      one, for the same reason as (1): absence is never evidence of being newer.
 *   3. `_creationTime`, which is unique per document and so makes the order total.
 *
 * A CONSEQUENCE WORTH KNOWING: a row v2 itself wrote (upsertBoardFor) carries
 * neither `createdAt` nor `legacyId`, so it would LOSE to a copied row for the same
 * day. Unreachable after the cutover's purge-and-copy — upsertBoardFor patches the
 * existing row rather than inserting beside it — and the probe reports a row's
 * missing legacyId, so such a pair would be visible before anything is deleted.
 *
 * `differing` is true when any dropped row's guesses or answer differ from the
 * survivor's, compared strictly (an absent answer and '' differ). Strict on
 * purpose: this flag is what tells the owner a delete loses information, so it
 * errs towards saying so.
 */

export type CollapseRow<Id extends string = string> = {
  _id: Id
  _creationTime: number
  puzzleDay: string
  guesses: string[]
  answer?: string
  createdAt?: number
  legacyId?: number
}

export type CollapseGroup<Row> = {
  puzzleDay: string
  keep: Row
  /** Every other row for the day, earliest-written first. */
  drop: Row[]
  differing: boolean
}

/** Absent sorts first: absence is never evidence of being the later row. */
function compareOptional(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0
  if (a === undefined) return -1
  if (b === undefined) return 1
  return a - b
}

/** Negative when `a` was written before `b`. Total over distinct documents. */
function writtenOrder(a: CollapseRow, b: CollapseRow): number {
  return (
    compareOptional(a.createdAt, b.createdAt) ||
    compareOptional(a.legacyId, b.legacyId) ||
    a._creationTime - b._creationTime
  )
}

function sameContent(a: CollapseRow, b: CollapseRow): boolean {
  return (
    a.answer === b.answer &&
    a.guesses.length === b.guesses.length &&
    a.guesses.every((guess, i) => guess === b.guesses[i])
  )
}

/**
 * One collapse group per `puzzleDay` holding more than one row, ordered by day.
 * A day with a single row produces nothing.
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
    const ordered = [...dayRows].sort(writtenOrder)
    const keep = ordered[ordered.length - 1]
    const drop = ordered.slice(0, -1)
    groups.push({
      puzzleDay,
      keep,
      drop,
      differing: drop.some((row) => !sameContent(row, keep)),
    })
  }
  return groups.sort((a, b) => a.puzzleDay.localeCompare(b.puzzleDay))
}
