import { v } from 'convex/values'
import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server'
import { mutation, query } from './_generated/server'
import type { DataModel, Doc, Id } from './_generated/dataModel'
import { accessError, requirePlausibleToday, requirePlayer } from './access'
import { clueText } from './lib/clueLadder/clues.ts'
import { clueLadderSwitchOn } from './lib/clueLadder/flag.ts'
import type { Puzzle } from './lib/clueLadder/generate.ts'
import { ladderProblem, MAX_CLUES, survivors } from './lib/clueLadder/ladder.ts'
import { SLOT_COUNT, type Shape } from './lib/clueLadder/orders.ts'
import { GENERATOR_VERSION, puzzleForDate, seedSecretUsable } from './lib/clueLadder/seed.ts'
import { isPassedDate } from './lib/games.ts'
import { isPlausibleToday, toPuzzleDay, type PuzzleDay } from './lib/puzzleDay.ts'

/**
 * The clue ladder's puzzles and plays (wordle-teams-9j7o.2.3, spec sections 3
 * and 4). Plan 1 made the plays table and the scoreboard that reads it; this
 * module is everything that writes.
 */

type ReaderCtx = { db: GenericDatabaseReader<DataModel> }
type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

export async function puzzleOn(ctx: ReaderCtx, date: PuzzleDay): Promise<Doc<'clueLadderPuzzles'> | null> {
  return await ctx.db
    .query('clueLadderPuzzles')
    .withIndex('by_date', (q) => q.eq('date', date))
    .first()
}

/**
 * The puzzle for `date`, made the first time anyone asks (spec section 3).
 *
 * CALLERS BOUND THE DATE FIRST, with requirePlausibleToday, so a puzzle exists
 * only for a day some player could be on. Nothing here checks it again.
 *
 * `generate` is a parameter only so a test can hand in a ladder that breaks the
 * rules. Production always uses puzzleForDate.
 */
export async function ensurePuzzleFor(
  ctx: WriterCtx,
  date: PuzzleDay,
  generate: (secret: string, date: PuzzleDay) => Promise<Puzzle> = puzzleForDate,
): Promise<Doc<'clueLadderPuzzles'>> {
  const existing = await puzzleOn(ctx, date)
  if (existing) return existing

  const secret = process.env.CLUE_LADDER_SEED
  if (!seedSecretUsable(secret)) throw accessError('CLUE_LADDER_DISABLED')
  const puzzle = await generate(secret, date)

  // CHECKED BEFORE IT IS STORED, because a stored ladder is permanent: everyone
  // plays it that day. The generator's tests cover thousands of seeds; this
  // covers the one date being made. A plain Error, not an AccessCode: no player
  // did anything wrong, and the message is for the logs.
  const problem = ladderProblem(puzzle.answer, puzzle.clues)
  if (problem !== null) throw new Error(`clue ladder ${date}: generated ladder breaks rule '${problem}'`)

  const id = await ctx.db.insert('clueLadderPuzzles', {
    date,
    answer: [...puzzle.answer],
    clues: puzzle.clues,
    remaining: puzzle.remaining,
    generatorVersion: GENERATOR_VERSION,
    fallback: puzzle.fallback,
  })
  const row = await ctx.db.get(id)
  if (!row) throw new Error(`clue ladder ${date}: puzzle missing after insert`)
  return row
}

/**
 * Whether the clue ladder can be PLAYED here: the CLUE_LADDER_ENABLED switch
 * and a usable CLUE_LADDER_SEED. With no seed no puzzle can be made, so the game
 * answers as switched off instead of offering a Play button that always fails.
 */
export function clueLadderPlayable(): boolean {
  return clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED) && seedSecretUsable(process.env.CLUE_LADDER_SEED)
}

/**
 * Whether the player is on at least one team whose owner opted it in (spec
 * section 4, "Who can play"). A whole-table scan, as getMyTeamsFor does
 * (teams.ts): Convex cannot index array membership, and the table is small.
 */
export async function onClueLadderTeam(ctx: ReaderCtx, playerId: Id<'players'>): Promise<boolean> {
  const teams = await ctx.db.query('teams').collect()
  return teams.some((team) => team.clueLadderEnabled === true && team.playerIds.includes(playerId))
}

async function requireClueLadderPlayer(ctx: ReaderCtx, playerId: Id<'players'>): Promise<void> {
  if (!clueLadderPlayable()) throw accessError('CLUE_LADDER_DISABLED')
  if (!(await onClueLadderTeam(ctx, playerId))) throw accessError('CLUE_LADDER_NOT_ON_TEAM')
}

export async function playOn(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  date: PuzzleDay,
): Promise<Doc<'clueLadderPlays'> | null> {
  return await ctx.db
    .query('clueLadderPlays')
    .withIndex('by_player_and_date', (q) => q.eq('playerId', playerId).eq('date', date))
    .first()
}

type Slot = Shape | null

const emptyScratch = (): Slot[] => Array.from({ length: SLOT_COUNT }, () => null)

/** Every field a writer sets. playerId, date and startedAt are fixed when the play is made. */
export type PlayWrite = {
  cluesRevealed: number
  status: 'playing' | 'solved' | 'failed'
  scratch: Slot[]
  lockedOrder?: Shape[]
  lockedAtClue?: number
  finishedAt?: number
}

const isClueCount = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_CLUES

/**
 * THE ONE WRITE PATH FOR A CLUE LADDER PLAY (spec section 5), the role
 * upsertBoardFor plays for Wordle. start, nextClue, saveScratch and lockIn all
 * write through here, and spec section 7's later hooks (stored winners, team
 * totals) attach here.
 *
 * It refuses what no writer should produce:
 * - A PASSED DATE, judged by the scoreboard's own isPassedDate (lib/games.ts),
 *   so a day already counted as X can never become a win. Today's callers
 *   cannot reach it, since they write only a `today` that requirePlausibleToday
 *   accepted, and that is never passed (clueLadder.test.ts pins the two rules
 *   together). It guards the next writer.
 * - A clue count outside 1..MAX_CLUES, or a lockedAtClue different from
 *   cluesRevealed: the registry scores lockedAtClue as the result.
 * - A finished status without a lock-in, or a lock-in on a play still playing;
 *   a lockedOrder that is not the five shapes once each; finishedAt set exactly
 *   when the status is finished.
 * - Rewriting a play that is not this player's on this date, one already
 *   finished, or one with fewer clues than it has shown.
 *
 * Those are plain Errors. They mean a bug in this module, not a player's
 * mistake, so there is no player-facing copy for them.
 */
export async function writePlayFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  date: PuzzleDay,
  existing: Doc<'clueLadderPlays'> | null,
  write: PlayWrite,
): Promise<void> {
  if (isPassedDate(date, toPuzzleDay(new Date()))) throw accessError('INVALID_DATE')
  if (!isClueCount(write.cluesRevealed)) {
    throw new Error(`clue ladder: cluesRevealed ${write.cluesRevealed} is outside 1..${MAX_CLUES}`)
  }
  if (write.scratch.length !== SLOT_COUNT) throw new Error(`clue ladder: scratch has ${write.scratch.length} slots`)
  const finished = write.status !== 'playing'
  if (finished !== (write.lockedAtClue !== undefined) || finished !== (write.lockedOrder !== undefined)) {
    throw new Error(`clue ladder: status ${write.status} with lockedAtClue ${write.lockedAtClue}`)
  }
  if (write.lockedAtClue !== undefined && write.lockedAtClue !== write.cluesRevealed) {
    throw new Error(`clue ladder: lockedAtClue ${write.lockedAtClue} differs from cluesRevealed ${write.cluesRevealed}`)
  }
  if (write.lockedOrder !== undefined && (write.lockedOrder.length !== SLOT_COUNT || new Set(write.lockedOrder).size !== SLOT_COUNT)) {
    throw new Error(`clue ladder: lockedOrder ${write.lockedOrder.join(',')} is not the five shapes once each`)
  }
  if (finished !== (write.finishedAt !== undefined)) {
    throw new Error(`clue ladder: status ${write.status} with finishedAt ${write.finishedAt}`)
  }
  if (existing) {
    // A caller handed the wrong row, or one that already finished, or a write that
    // would hide a clue the player has seen: all bugs in the caller, so plain Errors.
    // Public callers refuse a finished play with ALREADY_FINISHED before getting here.
    if (existing.playerId !== playerId || existing.date !== date) {
      throw new Error(`clue ladder: play ${existing._id} is not ${playerId}'s play for ${date}`)
    }
    if (existing.status !== 'playing') throw new Error(`clue ladder: play ${existing._id} is already ${existing.status}`)
    if (write.cluesRevealed < existing.cluesRevealed) {
      throw new Error(`clue ladder: cluesRevealed ${write.cluesRevealed} would go back from ${existing.cluesRevealed}`)
    }
    await ctx.db.patch(existing._id, write)
  } else await ctx.db.insert('clueLadderPlays', { playerId, date, startedAt: Date.now(), ...write })
}

/** Makes the puzzle if needed, then the play with clue 1 revealed. Idempotent (spec section 4). */
export async function startFor(ctx: WriterCtx, playerId: Id<'players'>, today: string): Promise<void> {
  await requireClueLadderPlayer(ctx, playerId)
  const date = requirePlausibleToday(today)
  await ensurePuzzleFor(ctx, date)
  if (await playOn(ctx, playerId, date)) return
  await writePlayFor(ctx, playerId, date, null, { cluesRevealed: 1, status: 'playing', scratch: emptyScratch() })
}

/**
 * The player's game on `date`, for the play page and the dashboard card.
 *
 * WHILE PLAYING IT HOLDS ONLY THE REVEALED CLUES, as text, and no answer, no
 * `remaining` and no clue count (spec section 3: the ladder's length is
 * hidden). Once finished it adds the answer, the ladder and the orders that
 * still fitted when the player locked in, for the explanation.
 */
export async function todayFor(ctx: ReaderCtx, playerId: Id<'players'>, date: PuzzleDay) {
  const play = await playOn(ctx, playerId, date)
  if (!play) return { status: 'not-started' as const, date }
  const puzzle = await puzzleOn(ctx, date)
  if (!puzzle) throw new Error(`clue ladder: a play for ${date} has no puzzle`)

  const base = {
    date,
    cluesRevealed: play.cluesRevealed,
    clues: puzzle.clues.slice(0, play.cluesRevealed).map(clueText),
    scratch: play.scratch,
  }
  if (play.status === 'playing') return { status: 'playing' as const, ...base }

  const { lockedAtClue, lockedOrder } = play
  if (lockedAtClue === undefined || lockedOrder === undefined) {
    throw new Error(`clue ladder: finished play for ${date} has no lock-in`)
  }
  return {
    status: play.status,
    ...base,
    lockedAtClue,
    lockedOrder,
    answer: puzzle.answer,
    remaining: puzzle.remaining,
    possibleAtLockIn: survivors(puzzle.clues.slice(0, lockedAtClue)),
  }
}

export const today = query({
  args: { today: v.string() },
  handler: async (ctx, args) => {
    // RETURNS rather than throws when off, so the card and the play page never
    // error on a dark deployment (challenges.ts's convention). A player on no
    // opted-in team gets the same answer: there is nothing for them to see.
    if (!clueLadderPlayable()) return { enabled: false as const }
    const player = await requirePlayer(ctx)
    if (!(await onClueLadderTeam(ctx, player._id))) return { enabled: false as const }
    // A LIVE QUERY FALLS BACK TO THE SERVER'S DAY instead of refusing, as
    // leagues.ts's readToday does: a tab left open past midnight re-runs this on
    // every write, and must not start throwing with no action from the player.
    const serverToday = toPuzzleDay(new Date())
    const date = isPlausibleToday(args.today, serverToday) ? args.today : serverToday
    return { enabled: true as const, play: await todayFor(ctx, player._id, date) }
  },
})

export const start = mutation({
  args: { today: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await startFor(ctx, player._id, args.today)
  },
})
