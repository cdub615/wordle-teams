import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server'
import type { DataModel, Doc } from './_generated/dataModel'
import { accessError } from './access'
import type { Puzzle } from './lib/clueLadder/generate.ts'
import { ladderProblem } from './lib/clueLadder/ladder.ts'
import { GENERATOR_VERSION, puzzleForDate, seedSecretUsable } from './lib/clueLadder/seed.ts'
import type { PuzzleDay } from './lib/puzzleDay.ts'

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
