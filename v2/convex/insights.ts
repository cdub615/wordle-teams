import { query } from './_generated/server'
import { currentPlayer, insightsAccessFor } from './access'

/**
 * The boards Layer 1 benchmarks, and what this player is allowed to see of them.
 *
 * ONE QUERY RETURNS BOTH THE DATA AND THE ACCESS, rather than the client asking
 * separately and deciding for itself. The server decides how many boards to send;
 * a client that decided would be a client that could be asked for more.
 *
 * NO BENCHMARK IS COMPUTED HERE. The corpus is a static artifact the CDN serves
 * (wordle-teams-dcu, and see lib/insightsAccess.ts's sibling in public/insights/):
 * joining it in the database would put a 14,855-row constant behind the scarcest
 * resource. This returns the player's own rows and the browser does the join.
 */

/** A pro player's history is bounded rather than unbounded — see below. */
const PRO_BOARD_LIMIT = 400

export const myBenchmarkBoards = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    // Not a throw: this is a read surface, and the route already redirects a
    // visitor with no session. Returning null lets the panel render its own
    // empty state rather than the router's error boundary.
    if (!player) return null

    const access = await insightsAccessFor(ctx, player._id)

    if (access.layer1 === 'full') {
      /**
       * BOUNDED, AND THE BOUND IS DELIBERATE. dailyScores grows one row per
       * player per day forever, and the largest holding in production is already
       * in the low thousands. An unbounded collect() here is the same dated bug
       * migrate.ts's countTable comment describes at length — it works until it
       * does not, and it fails on the account with the most history, which is the
       * account most likely to be paying.
       *
       * 400 is a bit over a year. Layer 2's aggregates are what answer questions
       * spanning more than that, and they are A5's job rather than a longer list
       * here.
       */
      const boards = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', player._id))
        .order('desc')
        .take(PRO_BOARD_LIMIT)
      return { access, boards: boards.map(visible) }
    }

    /**
     * THE MOST RECENTLY ENTERED BOARD, WHICH IS NOT THE SAME AS THE LATEST
     * PUZZLE DAY, and the difference is the whole reason the spec words it this
     * way. Backfill is a free feature: a player filling in last Tuesday must get
     * the benchmark for last Tuesday, not an empty panel and not today's board.
     * Ordering by puzzleDay would hand them the wrong one every time they
     * backfilled.
     *
     * SO THIS USES by_player_and_date, WHICH THE SCHEMA WARNS AGAINST — and the
     * warning does not cover this. It forbids deriving a puzzle DAY from the raw
     * instant, which is v1's timezone bug and is precisely what puzzleDay exists
     * to prevent. Nothing here derives a day from `date`: it orders rows by when
     * they were written, which is a question `puzzleDay` genuinely cannot answer
     * and the only question that matches "most recently entered". The day shown
     * still comes from `puzzleDay`.
     */
    const latest = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_date', (q) => q.eq('playerId', player._id))
      .order('desc')
      .first()

    return { access, boards: latest ? [visible(latest)] : [] }
  },
})

/**
 * What the client needs and nothing else. `playerId` and the legacy ids stay on
 * the server: the browser already knows whose boards these are.
 */
function visible(board: { puzzleDay: string; guesses: string[]; answer?: string }) {
  return { puzzleDay: board.puzzleDay, guesses: board.guesses, answer: board.answer }
}
