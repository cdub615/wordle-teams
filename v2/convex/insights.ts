import { v } from 'convex/values'
import { query } from './_generated/server'
import { currentPlayer, insightsAccessFor, requireTeamMemberFor } from './access'
import { attemptsFor } from './lib/board.ts'
import { visibleSlice } from './lib/globalThreshold.ts'
import type { InsightsAccess } from './lib/insightsAccess.ts'

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

/**
 * The caller's own insights access, returned rather than merely applied.
 *
 * Every other query in this file computes access to gate its OWN payload and
 * returns none of it, so before this the client had no way to know a trial had
 * ended — only that Layer 2 had gone quiet. That is the difference between a
 * player who upgrades and a player who assumes the feature broke.
 *
 * DELIBERATELY TRIVIAL. convex-test cannot authenticate (wordle-teams-obw), so
 * anything decided in this body would be untestable by the unit suite. The one
 * decision — what counts as an expired trial — lives in lib/insightsAccess.ts
 * and is pinned there; this is a lookup and a forward, and e2e covers the wiring.
 *
 * NULL FOR A SIGNED-OUT CALLER, matching the rest of this file: an
 * unauthenticated read is an expected state on a route that renders before auth
 * resolves, not an error worth throwing over.
 */
export const myAccess = query({
  args: {},
  handler: async (ctx): Promise<InsightsAccess | null> => {
    const player = await currentPlayer(ctx)
    if (!player) return null
    return await insightsAccessFor(ctx, player._id)
  },
})

export const myBenchmarkBoards = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    // Not a throw: this is a read surface, and the route already redirects a
    // visitor with no session. Returning null lets the panel render its own
    // empty state rather than the router's error boundary.
    if (!player) return null

    const access = await insightsAccessFor(ctx, player._id)

    /**
     * HISTORY IS WHAT LAYER 2 IS, so the size of the read is driven by BOTH
     * layers rather than by Layer 1 alone.
     *
     * THIS IS A BUG A4 SHIPPED AND A5 FOUND. Layer 1 is 'full' only for pro,
     * while the trial grants Layer 2 and not Layer 1 (see lib/insightsAccess.ts,
     * which takes the spec's "one month of Layers 2 and 3" literally). Keyed on
     * layer1 alone, a player mid-trial was handed their single most recent board
     * and a personal-history panel computed from it — every statistic technically
     * correct and the whole feature worthless, on exactly the month they are
     * being asked to judge whether it is worth paying for.
     */
    if (access.layer1 === 'full' || access.layer2 === 'full') {
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

/**
 * One team's month, for Layer 3.
 *
 * ONE DOCUMENT READ. That is the entire reason teamMonthStats exists — see its
 * schema comment and lib/teamStats.ts. This query resolves access, reads the
 * aggregate by its index, and returns it with just enough roster to label the
 * rows. It never touches dailyScores.
 *
 * MEMBERSHIP IS CHECKED BEFORE ACCESS, and the order matters: requireTeamMemberFor
 * throws NOT_A_MEMBER for a team that does not exist as well as for one that is
 * not yours, so a probe cannot use this to discover which team ids are real.
 *
 * THE >=30 THRESHOLD DOES NOT APPLY HERE AND MUST NOT BE ADDED. It belongs to
 * Layer 4. The spec establishes by measurement that getTeamMonth already returns
 * every teammate's guesses and answer to every member, and team-boards.tsx renders
 * them — so this summarises data the viewer can already read board by board.
 * Applying a k-anonymity rule here would suppress a five-person team's own numbers
 * from itself, which is both wrong and the opposite of the feature.
 *
 * A MISSING AGGREGATE IS AN EMPTY MONTH, NOT AN ERROR. The rollup writes on the
 * first board of a month, so a month nobody has played has no row — which is a
 * real and common state, not a failure, and the caller renders it as one.
 */
export const teamMonth = query({
  args: { teamId: v.id('teams'), month: v.string() },
  handler: async (ctx, { teamId, month }) => {
    const player = await currentPlayer(ctx)
    if (!player) return null

    const team = await requireTeamMemberFor(ctx, player._id, teamId)
    const access = await insightsAccessFor(ctx, player._id)

    const [year, monthNum] = month.split('-').map(Number)
    const stats = await ctx.db
      .query('teamMonthStats')
      .withIndex('by_team_year_month', (q) =>
        q.eq('teamId', teamId).eq('year', year).eq('month', monthNum),
      )
      .unique()

    // Names for the rows. Bounded by the roster, and it is the roster the viewer
    // can already see on the dashboard.
    const roster = []
    for (const memberId of team.playerIds) {
      const member = await ctx.db.get(memberId)
      if (!member) continue
      roster.push({
        playerId: memberId,
        firstName: member.firstName,
        lastName: member.lastName,
      })
    }

    return {
      access,
      viewerId: player._id,
      roster,
      stats: stats ? { members: stats.members, days: stats.days } : null,
    }
  },
})

/**
 * LAYER 4 — global comparison. Built, and dark by construction.
 *
 * "SWITCHED OFF" IS THE THRESHOLD ITSELF, NOT A SEPARATE FLAG. With 70 activated
 * players and ten holding most of the 7,602 boards, essentially no slice reaches
 * 30 distinct contributors — so every view below returns null today, and each one
 * lights up on its own as the corpus grows. There is nothing to remember to turn
 * on, and no flag that can be left in the wrong position.
 *
 * IF THE OWNER ALSO WANTS AN EXPLICIT KILL SWITCH THAT IS A SEPARATE DECISION and
 * is deliberately not assumed here. The plan chose this reading; it is recorded
 * rather than hidden so it can be overruled.
 *
 * THE LAYER WAS MIS-SPECIFIED, NOT BLOCKED, and that distinction is worth keeping
 * because this reads like a deferral and is not one. Benchmarking against computed
 * optimality — Layer 1 — is public, free, and just as true at 70 players as at
 * 70,000. Benchmarking against other HUMANS needs a corpus only Wordle Teams has
 * and which is not yet deep enough. The public alternative is thinner still: the
 * Wordle Observatory holds 26 games across 22 puzzles, most rows suppressed for
 * low sample size, and no source publishes per-player human guess data.
 *
 * NO VIEW CAN RENDER A PERCENTILE WITHOUT PASSING THROUGH visibleSlice, which
 * does not even COMPUTE the number below the threshold. That is the property worth
 * having: there is no percentile in memory for a caller to mishandle.
 *
 * PRO ONLY, WITH NO FREE SLICE — checked here rather than in the component, since
 * a gate in a component is a gate a second caller can walk around.
 */
export const globalComparison = query({
  args: { puzzleDay: v.string(), opener: v.optional(v.string()) },
  handler: async (ctx, { puzzleDay, opener }) => {
    const player = await currentPlayer(ctx)
    if (!player) return null

    const access = await insightsAccessFor(ctx, player._id)
    if (access.layer4 !== 'full') return { access, day: null, opener: null }

    // THE DAY SLICE. Every board entered on that puzzle day, by anyone. Indexed —
    // by_puzzleDay exists for exactly this — and bounded by the number of players
    // who played one day, which is the smallest cohort Layer 4 has.
    const dayBoards = await ctx.db
      .query('dailyScores')
      .withIndex('by_puzzleDay', (q) => q.eq('puzzleDay', puzzleDay))
      .collect()

    const mine = dayBoards.find((board) => board.playerId === player._id)
    const daySlice = visibleSlice(dayBoards, () =>
      mine === undefined
        ? null
        : percentileOf(
            attemptsFor(mine.guesses, mine.answer ?? ''),
            dayBoards.map((board) => attemptsFor(board.guesses, board.answer ?? '')),
          ),
    )

    return {
      access,
      day: { percentile: daySlice.value, contributors: daySlice.contributors },
      // The opener slice is deliberately not implemented as a scan: there is no
      // index on guesses[0], and the cohort is "everyone who ever used this word",
      // which is the whole table. It waits for an aggregate of its own, on the
      // shape teamMonthStats already demonstrates — and it is dark either way at
      // today's data volumes, so nothing is lost by not building the scan first.
      opener: opener === undefined ? null : { percentile: null, contributors: 0 },
    }
  },
})

/**
 * What share of `population` this player did BETTER than, as a whole percent.
 *
 * FEWER ATTEMPTS IS BETTER, so this counts strictly higher attempt counts. Ties
 * are not beaten — the same reasoning as head-to-head, and it keeps a player who
 * matched the field from being told they led it.
 */
function percentileOf(mine: number, population: number[]): number {
  if (population.length === 0) return 0
  return Math.round((population.filter((n) => n > mine).length / population.length) * 100)
}
