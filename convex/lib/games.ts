import { v } from 'convex/values'
import type { GenericDatabaseReader } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'
import { accessError } from '../access.ts'
import { clueLadderSwitchOn } from './clueLadder/flag.ts'
import { addDays, toPuzzleDay, type PuzzleDay } from './puzzleDay.ts'
import { wordleDays, type AttemptDay } from './scoring.ts'

/**
 * The game registry (wordle-teams-9j7o.2.2, spec section 5).
 *
 * Each game answers three questions about ONE player, so the team scoreboard,
 * and later reminders, onboarding, challenges and leagues (spec section 7), can
 * ask them without knowing which table holds the answer. Results are attempts,
 * 1–6 or 7 for a failure, which is what monthTotal and pointsFor understand.
 */

type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

export const GAME_IDS = ['wordle', 'clueLadder'] as const
export type GameId = (typeof GAME_IDS)[number]
export const gameValidator = v.union(v.literal('wordle'), v.literal('clueLadder'))

/** The attempt count for an X, the same number a failed Wordle board scores. */
export const FAILED_ATTEMPTS = 7

export type Game = {
  id: GameId
  name: string
  /** Results with puzzleDay in [fromDay, toDay], in index order. */
  resultsFor(ctx: ReaderCtx, playerId: Id<'players'>, fromDay: PuzzleDay, toDay: PuzzleDay): Promise<AttemptDay[]>
  /** Whether the player has FINISHED this day. Used by reminders and onboarding later. */
  hasPlayed(ctx: ReaderCtx, playerId: Id<'players'>, day: PuzzleDay): Promise<boolean>
  /** The first day the player has a row for, or null; feeds the Pro month window. */
  firstDay(ctx: ReaderCtx, playerId: Id<'players'>): Promise<PuzzleDay | null>
}

const wordle: Game = {
  id: 'wordle',
  name: 'Wordle',
  async resultsFor(ctx, playerId, fromDay, toDay) {
    const rows = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', playerId).gte('puzzleDay', fromDay).lte('puzzleDay', toDay),
      )
      .collect()
    return wordleDays(rows)
  },
  async hasPlayed(ctx, playerId, day) {
    const row = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', playerId).eq('puzzleDay', day))
      .first()
    return row !== null
  },
  async firstDay(ctx, playerId) {
    // Ascending by default, so the index range's first row is the earliest day.
    const row = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', playerId))
      .first()
    return row?.puzzleDay ?? null
  },
}

/**
 * Whether no player anywhere can still be on `date`.
 *
 * requirePlausibleToday (access.ts) accepts a client's today within one day of
 * the server's, so a date is live down to server-today minus one. Below that,
 * every time zone has moved on and an unfinished play can never finish.
 */
export function isPassedDate(date: PuzzleDay, serverToday: PuzzleDay): boolean {
  return date < addDays(serverToday, -1)
}

/**
 * One play's attempts, or null while it can still be finished (spec section 4).
 *
 * A solved play scores the clue it locked in on. `lockedAtClue` is set by the
 * one writer that solves a play (plan 3's lockIn) and equals `cluesRevealed`
 * from then on, so falling back to `cluesRevealed` only ever covers a row that
 * writer did not produce.
 */
export function clueLadderAttempts(
  play: Pick<Doc<'clueLadderPlays'>, 'status' | 'lockedAtClue' | 'cluesRevealed' | 'date'>,
  serverToday: PuzzleDay,
): number | null {
  if (play.status === 'solved') return play.lockedAtClue ?? play.cluesRevealed
  if (play.status === 'failed') return FAILED_ATTEMPTS
  return isPassedDate(play.date, serverToday) ? FAILED_ATTEMPTS : null
}

const clueLadder: Game = {
  id: 'clueLadder',
  name: 'Clue ladder',
  async resultsFor(ctx, playerId, fromDay, toDay) {
    const serverToday = toPuzzleDay(new Date())
    const plays = await ctx.db
      .query('clueLadderPlays')
      .withIndex('by_player_and_date', (q) => q.eq('playerId', playerId).gte('date', fromDay).lte('date', toDay))
      .collect()
    const results: AttemptDay[] = []
    for (const play of plays) {
      const attempts = clueLadderAttempts(play, serverToday)
      if (attempts !== null) results.push({ puzzleDay: play.date, attempts })
    }
    return results
  },
  async hasPlayed(ctx, playerId, day) {
    const play = await ctx.db
      .query('clueLadderPlays')
      .withIndex('by_player_and_date', (q) => q.eq('playerId', playerId).eq('date', day))
      .first()
    return play !== null && play.status !== 'playing'
  },
  async firstDay(ctx, playerId) {
    const play = await ctx.db
      .query('clueLadderPlays')
      .withIndex('by_player_and_date', (q) => q.eq('playerId', playerId))
      .first()
    return play?.date ?? null
  },
}

export const GAMES: Record<GameId, Game> = { wordle, clueLadder }

/**
 * Refuses a game this team cannot see. Wordle is every team's; the clue ladder
 * needs the CLUE_LADDER_ENABLED deployment switch AND the owner's opt-in.
 * The switch is checked first, so turning it off answers the same way for
 * every team: it is the kill switch (spec section 8).
 */
export function requireGameOnTeam(team: Pick<Doc<'teams'>, 'clueLadderEnabled'>, game: GameId): void {
  if (game === 'wordle') return
  if (!clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED)) throw accessError('CLUE_LADDER_DISABLED')
  if (team.clueLadderEnabled !== true) throw accessError('CLUE_LADDER_NOT_ON_TEAM')
}
