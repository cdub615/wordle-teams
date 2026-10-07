/**
 * THE RE-DATE RULE FOR MISDATED BOARDS (wordle-teams-c442).
 *
 * The v1 → v2 copy derived each board's puzzleDay from v1's `date` instant in the
 * player's CURRENT time zone (copy-from-supabase.mjs), so a backfilled or
 * travelling entry can land on a neighbouring day. Where it landed on a day the
 * player had also played, one (player, puzzleDay) holds two boards with
 * DIFFERENT answers: two puzzles, not a duplicate. The rac repair held them
 * (answers-differ) rather than delete either. This module decides where the
 * misplaced one really belongs, and it is the whole of that decision: every
 * board the repair re-dates is the `move` of a plan this function returned.
 *
 * PURE. No ctx, nothing imported beyond convex/lib. The caller gathers the
 * boards; this only judges them.
 *
 * THE ANSWER IDENTIFIES THE PUZZLE, AND THE OTHER PLAYERS IDENTIFY THE DAY.
 * There is no answer corpus to consult (the insights CSV has no answers), but on
 * any day nearly every player solved the same puzzle, so the CONSENSUS answer of
 * a day's boards names that day's puzzle. The affected player's own boards never
 * vote: their misplaced board would otherwise vote for the wrong answer on the
 * very day in question.
 *
 * THE CONSENSUS MUST BE TRUSTED, OR NOTHING MOVES:
 *   MIN_CONSENSUS_BOARDS (3)  counted boards (others', with an answer). One
 *                             stranger could be misdated the same way; three
 *                             agreeing strangers is already strong evidence on a
 *                             site where a day's real players nearly all agree.
 *   strict majority           the top answer must be MORE than half the counted
 *                             boards, so a tie can never choose a puzzle.
 *
 * THE BOARD MATCHING THE DAY STAYS; the other moves to the NEAREST day within ±2
 * (distance 1 both ways before distance 2) whose trusted consensus is its answer.
 * ±2 because a zone shift moves a board by at most one day, and the window
 * leaves room for one more without reaching for a coincidence.
 *
 * HELD, NEVER WRITTEN, AND REPORTED WITH THE REASON — checked in this order:
 *   v2-row            a board with no `legacyId` was written by v2, on a day the
 *                     player picked themselves, so it is not a copy artefact.
 *                     The pairs this repairs are v1 copies; holding the whole
 *                     pair is the conservative answer, and it lets redateKey
 *                     name every move by legacyId, as rac's deletionKey does.
 *   no-answer         either board has no answer to identify its puzzle by.
 *   no-consensus      the pair's own day has no trusted consensus.
 *   both-match        both answers ARE the consensus. Not impossible: the pair
 *                     reaches here because rac compared answers strictly, and
 *                     'crane' vs 'CRANE ' differ there but normalise to one
 *                     puzzle here. That is rac's business (a duplicate), not
 *                     a re-date, so it is held.
 *   neither-matches   the day agrees on a third answer; nothing says which
 *                     board is at home.
 *   no-target         no day within ±2 has a trusted consensus on the moving
 *                     board's answer.
 *   ambiguous-target  two days equally near both match. Real Wordle answers do
 *                     not repeat that close, so this is bad data; hold rather
 *                     than guess.
 *   target-occupied   the nearest matching day already holds a board for this
 *                     player (owner's decision, 2026-10-07: report and skip).
 *                     It never falls through to a farther match.
 */

import type { CollapseRow } from './duplicateScores.ts'
import { addDays, monthOf, type PuzzleDay, type PuzzleMonth } from './puzzleDay.ts'

/** See the header: three agreeing strangers is strong; fewer is untrusted. */
export const MIN_CONSENSUS_BOARDS = 3
/** The furthest a misplaced board is moved, in days either way. */
export const MAX_REDATE_DISTANCE = 2

export type Consensus = {
  /** Normalised: trimmed and uppercased. */
  answer: string
  /** Boards giving `answer`. */
  count: number
  /** Boards counted: others' boards that have an answer. */
  total: number
}

export type ConsensusBoard = { playerId: string; answer?: string }

export type RedatePair<Row> = {
  playerId: string
  puzzleDay: PuzzleDay
  /** Exactly two boards for one player and day, in any order. */
  boards: readonly [Row, Row]
}

export type RedateHoldReason =
  | 'v2-row'
  | 'no-answer'
  | 'no-consensus'
  | 'both-match'
  | 'neither-matches'
  | 'no-target'
  | 'ambiguous-target'
  | 'target-occupied'

export type RedateMove<Row> = {
  kind: 'move'
  playerId: string
  stay: Row
  move: Row
  from: PuzzleDay
  to: PuzzleDay
}

export type RedateHold<Row> = {
  kind: 'hold'
  playerId: string
  puzzleDay: PuzzleDay
  reason: RedateHoldReason
  boards: readonly [Row, Row]
  /**
   * The nearest matching days, ascending: two for ambiguous-target, the occupied
   * one for target-occupied, otherwise empty.
   */
  targets: PuzzleDay[]
}

export type RedatePlan<Row> = RedateMove<Row> | RedateHold<Row>

/** Trimmed and uppercased; empty or missing is no answer at all. */
export function normalizeAnswer(answer: string | undefined): string | undefined {
  const normalized = (answer ?? '').trim().toUpperCase()
  return normalized === '' ? undefined : normalized
}

/**
 * The trusted answer of ONE day's boards from every player, or null when it is
 * too thin (fewer than MIN_CONSENSUS_BOARDS counted) or split (no strict majority).
 */
export function consensusOf(
  boards: readonly ConsensusBoard[],
  { excludePlayerId }: { excludePlayerId: string },
): Consensus | null {
  const counts = new Map<string, number>()
  let total = 0
  for (const board of boards) {
    if (board.playerId === excludePlayerId) continue
    const answer = normalizeAnswer(board.answer)
    if (answer === undefined) continue
    counts.set(answer, (counts.get(answer) ?? 0) + 1)
    total += 1
  }
  if (total < MIN_CONSENSUS_BOARDS) return null
  let top: Consensus | null = null
  for (const [answer, count] of counts) if (top === null || count > top.count) top = { answer, count, total }
  if (top === null || top.count * 2 <= total) return null
  return top
}

/**
 * Where, if anywhere, one held pair's misplaced board belongs.
 *
 * `consensusByDay` covers puzzleDay ±2; an absent day is untrusted, like null.
 * `occupiedDays` is the days within ±2 (not puzzleDay) that ALREADY hold a board
 * for this player.
 */
export function planRedate<Row extends CollapseRow>(
  pair: RedatePair<Row>,
  consensusByDay: ReadonlyMap<PuzzleDay, Consensus | null>,
  occupiedDays: ReadonlySet<PuzzleDay>,
): RedatePlan<Row> {
  const { playerId, puzzleDay, boards } = pair
  const hold = (reason: RedateHoldReason, targets: PuzzleDay[] = []): RedateHold<Row> => ({
    kind: 'hold',
    playerId,
    puzzleDay,
    reason,
    boards,
    targets,
  })

  if (boards.some((board) => board.legacyId === undefined)) return hold('v2-row')
  const [a, b] = boards
  const answerA = normalizeAnswer(a.answer)
  const answerB = normalizeAnswer(b.answer)
  if (answerA === undefined || answerB === undefined) return hold('no-answer')

  const home = consensusByDay.get(puzzleDay)
  if (!home) return hold('no-consensus')
  const aMatches = answerA === home.answer
  const bMatches = answerB === home.answer
  if (aMatches && bMatches) return hold('both-match')
  if (!aMatches && !bMatches) return hold('neither-matches')

  const [stay, move] = aMatches ? [a, b] : [b, a]
  const moving = aMatches ? answerB : answerA

  for (let distance = 1; distance <= MAX_REDATE_DISTANCE; distance++) {
    const matches = [addDays(puzzleDay, -distance), addDays(puzzleDay, distance)].filter(
      (day) => consensusByDay.get(day)?.answer === moving,
    )
    if (matches.length === 0) continue
    if (matches.length > 1) return hold('ambiguous-target', matches)
    const [to] = matches
    if (occupiedDays.has(to)) return hold('target-occupied', [to])
    return { kind: 'move', playerId, stay, move, from: puzzleDay, to }
  }
  return hold('no-target')
}

/**
 * The months a plan writes to, sorted: a move's source and target month (one
 * month if they agree), nothing for a hold. The repair rolls up stats for each.
 */
export function monthsTouched(plan: RedatePlan<unknown>): PuzzleMonth[] {
  if (plan.kind === 'hold') return []
  return [...new Set([monthOf(plan.from), monthOf(plan.to)])].sort()
}

/**
 * EXACTLY WHAT AN APPLY OF THESE PLANS WOULD WRITE, as a string the dry run hands
 * the operator and the apply must match: each moved board as
 * `legacyId:from>to`, in ascending numeric legacyId order, comma-joined. Holds
 * contribute nothing. Every moved board has a legacyId — a pair with a row
 * lacking one is held as v2-row — so, as with rac's deletionKey, the key names
 * rows by their stable Supabase identity rather than by a Convex _id.
 */
export function redateKey<Row extends CollapseRow>(plans: readonly RedatePlan<Row>[]): string {
  return plans
    .filter((plan): plan is RedateMove<Row> => plan.kind === 'move')
    .map((plan) => ({ id: plan.move.legacyId as number, from: plan.from, to: plan.to }))
    .sort((x, y) => x.id - y.id)
    .map(({ id, from, to }) => `${id}:${from}>${to}`)
    .join(',')
}
