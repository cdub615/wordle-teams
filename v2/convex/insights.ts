import { v } from 'convex/values'
import { query } from './_generated/server'
import { currentPlayer, insightsAccessFor, requireTeamMemberFor } from './access'
import { attemptsFor } from './lib/board.ts'
import { teamRank, type TeamRankTeaser } from './lib/teamStats.ts'
import { visibleSlice } from './lib/globalThreshold.ts'
import { hasFullTeamMonth, type InsightsAccess } from './lib/insightsAccess.ts'
import { isPlausibleToday, monthOf, toPuzzleDay, type PuzzleDay } from './lib/puzzleDay.ts'

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

/**
 * WHY A PLAYER'S OWN PAST BOARDS ARE RATIONED HERE AND NOT IN scores.getMyMonth
 * (wordle-teams-byft, resolved). Both queries return the CALLER'S OWN rows from
 * `dailyScores`; this one hands a free player exactly one of them and that one
 * serves every board of whatever month it is asked for. That looks like an
 * accident and is not, but the reason cannot be "your own data is free" — if it
 * were, the layer check below would be indefensible. THE RULE IS:
 *
 *     EDITING YOUR OWN ENTRY IS FREE.
 *     BROWSING YOUR OWN HISTORY AS ANALYSIS IS LAYER 2.
 *
 * THIS QUERY IS THE ANALYSIS SIDE. Its only caller is routes/insights.tsx, where
 * the boards are joined against the static benchmark corpus and rendered as a
 * personal-history panel. That panel IS the Insights product; a player reading
 * their own past boards through it is doing the thing Layer 2 sells, which is
 * what the block comment below means by "HISTORY IS WHAT LAYER 2 IS".
 *
 * scores.getMyMonth IS THE EDITING SIDE, and its own header carries the same rule
 * from the other end: it feeds `SoloBoardEntryForm`'s prefill, so a floor there
 * would refuse a player the form for an entry they own. The two are allowed to
 * disagree about months BECAUSE they answer different questions, and the
 * disagreement is bounded by what each one is wired to — the day this query stops
 * feeding a panel, or that one starts feeding one, the rule has moved and both
 * comments are wrong together.
 */
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
 *
 * GATED BY LAYER, NOT BY MONTH, AND THAT IS THE ANSWER THE CALLER-SUPPLIED-MONTH
 * AUDIT REACHED (wordle-teams-kusd's task 4). `month` here is an unbounded
 * `v.string()`, exactly like getTeamMonthFor's and getLastMonthWinner's, and this
 * is the one of the three that ends the audit with a reason instead of a month
 * gate. Written out because "it takes a raw month, therefore it leaks" is the
 * reading that has already been wrong about this function once — wordle-teams-7uv8
 * was filed claiming a free leak here and has been corrected.
 *
 * FOR A FREE MEMBER IT IS CLOSED BY `stats: null`, AND THAT — NOT ANYTHING ABOUT
 * MONTHS — IS THE WHOLE REASON. `hasFullTeamMonth(access.layer3)` below withholds
 * the paid payload for every month, ancient or current, so asking for an old one
 * reaches nothing a current one would not. The plan that commissioned this audit
 * said exactly that and was right; task 4 briefly replaced it with a better-
 * sounding reason that was false (see the floor paragraph below), which is the
 * more expensive kind of mistake and is therefore recorded rather than quietly
 * reverted.
 *
 * FOR A TRIAL MEMBER IT IS DELIBERATELY OPEN, AND MUST STAY OPEN. `layer3` is
 * `paid ? 'full' : 'free'` with `paid = isPro || trialActive`
 * (lib/insightsAccess.ts), while the scoreboard's window keys off access.ts's
 * `isProFor`, which a trial does NOT satisfy. So a trialist gets their team's
 * full stats for any month here and three months of scoreboard on /app. The
 * spec's §4 states that split in those words — "The trial does not widen this
 * window" (docs/superpowers/specs/2026-09-17-pro-month-window-design.md) — and
 * accepts it: the trial was specified as an Insights grant, not a scoreboard
 * grant, and honouring it on /app would make that rule take an InsightsAccess
 * tier rather than a boolean and let the trial's expiry silently withdraw
 * history. DO NOT CLOSE IT HERE. scores.test.ts's "refuses a caller inside the
 * Insights trial the pro window" pins the /app half on purpose.
 *
 * A MONTH FLOOR WOULD TAKE SOMETHING FROM THE TRIALIST, which is the difference
 * that decided this the opposite way from winners.ts's getLastMonthWinner — and
 * it is the TRIAL tier, not the free one. An earlier draft of this paragraph
 * claimed the FREE surface is offered twelve months by `teamMonthOptions`
 * (lib/insights-months.ts) and would therefore breach lib/insightsAccess.ts's
 * "NOTHING PREVIOUSLY FREE MOVES BEHIND THE PAYWALL". That is false, and the
 * proof is in this query's only caller: team-section.tsx computes `queryMonth =
 * hasFullTeamMonth(layer3) ? month : monthOf(today)` and builds the
 * teamMonthOptions dropdown only inside the paid branch. A free viewer's browser
 * never sends any month but the current one, so a floor would cost them nothing.
 *
 * THE TRIALIST IS WHO IT WOULD COST. `hasFullTeamMonth` is true for them, so they
 * do get the twelve-month dropdown, while `isProFor` — the predicate any floor
 * here would have to key off, since it is the one the scoreboard uses — is false.
 * So a floor would cut a trial player from twelve months to three in the middle
 * of the month they are being asked to judge whether this is worth paying for.
 * getLastMonthWinner has no analogue: no tier is offered a month its gate
 * refuses, which is why it could be gated at no cost and this cannot.
 *
 * ONE THING ON THE FREE BRANCH IS MONTH-BOUNDED AFTER ALL, AND IT IS THE ONLY
 * THING THAT IS: `rank`. wordle-teams-g03s asked whether a position computed from
 * a month's aggregate belongs with the `stats` that month's gate withholds, and
 * the answer is yes for every month but the current one — a rank you cannot see
 * the numbers behind is a conclusion about a month you have not bought, while
 * "where do I stand this month" is the free tier's own figure and stays free. The
 * gate is a `monthOf(day) !== month` check on the BOUNDED day, written out in
 * full at the point it is applied. It binds the FREE tier only: `hasFullTeamMonth`
 * is true for a trialist, so they take the paid branch and derive their standing
 * from `stats` for any month via src/lib/insights-team.ts's `memberAverages`,
 * which is the trial/pro seam the two paragraphs above accept in the spec's own
 * words.
 */
export const teamMonth = query({
  args: { teamId: v.id('teams'), month: v.string(), today: v.string() },
  handler: async (ctx, { teamId, month, today }) => {
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

    /*
      THE PAYWALL, AND IT IS A PAYLOAD RULE RATHER THAN A RENDERING ONE
      (wordle-teams-iht.3.2).

      WHAT IT REPLACED: this used to return `stats` unconditionally, having
      resolved `access` and consulted it for nothing. Every paid Layer 3 view is
      a pure client function over that one object (lib/insights-team.ts), so a
      free viewer's browser already held everything needed to compute the entire
      paid surface — head-to-heads, member averages, best and worst days, the
      lot. Layer 3 was a presentation tier wearing a paywall's clothes.

      TWO FIELDS, NOT ONE UNION. `stats` is the paid payload and `teaser` is the
      free one, and exactly one of them is ever non-null. A discriminated union
      would have been the tidier type and is deliberately not used: two fields
      mean TeamPanel keeps reading `stats` with its existing type and needs no
      narrowing, and — the part that matters — a free viewer's `stats` is `null`,
      so if some future branch renders the paid panel to the wrong tier it gets
      the empty state rather than the month. IT FAILS CLOSED BY CONSTRUCTION,
      which a union would leave to whoever writes the narrowing.

      NOTHING PREVIOUSLY VISIBLE IS TAKEN AWAY, which is a hard constraint in the
      spec (see lib/insightsAccess.ts: "NOTHING PREVIOUSLY FREE MOVES BEHIND THE
      PAYWALL"). The free surface is DailyTeamFact — one fact about today — and
      dailyTeamFact reads exactly two things: today's entry, and how many members
      there are. Both are still here. What leaves the wire is the other thirty
      days and every member's boards/attempts/solved/failed, none of which was
      ever rendered to a free viewer.
    */
    if (!hasFullTeamMonth(access.layer3)) {
      /*
        `today` COMES FROM THE CLIENT AND IS BOUNDED HERE, rather than being read
        off the server's clock and imposed.

        WHY NOT JUST USE THE SERVER'S. "Today" is a client-local fact — the
        repo's convention throughout (puzzleDay.ts's own note: "a pure function
        must take it as an argument rather than reach for one itself"). A player
        far enough east or west of the backend is on a different puzzle day for
        hours at a time, and serving them the server's day would blank their one
        free fact with 'no-board' for no reason they could see.

        WHY IT IS BOUNDED ANYWAY. Unbounded, a free client could walk the month a
        day at a time and reassemble exactly what this gate exists to withhold.
        `isPlausibleToday` is the same +/-1 day tolerance requirePlausibleToday
        uses, so the most a lying client can reach is three days of entries — of
        boards it can already read one by one on the dashboard.

        IT FALLS BACK RATHER THAN THROWING, unlike requirePlausibleToday. This
        query is a READ on a page, not a write: refusing it would take the
        insights page away from someone whose device clock is wrong, which is a
        worse failure than showing them the server's day.
      */
      const serverToday = toPuzzleDay(new Date())
      const day = isPlausibleToday(today as PuzzleDay, serverToday) ? today : serverToday

      /*
        THE ONE REAL FIGURE THE FREE TIER GAINS (wordle-teams-iht.3.3), now
        carrying its own reason when there is no figure (wordle-teams-iht.2).

        A SIBLING OF `teaser`, NOT A FIELD INSIDE IT, so `teaser` stays exactly
        the reduced STATS that dailyTeamFact consumes and keeps satisfying
        TeamMonthTeaser. A rank is a conclusion, not an aggregate.

        COMPUTED HERE BECAUSE IT CANNOT BE COMPUTED THERE. Ranking needs every
        member's totals, which is precisely what the branch above stops
        sending — so a client-side rank would undo the gate it sits beside.

        `solo` IS DECIDED FROM `roster` (ABOVE), NOT THE AGGREGATE, and the two
        can disagree: teamMonthStats.members is written at rollup time, so a
        teammate who joined since the last rollup is absent from it, while
        `roster` reflects team.playerIds right now (trimmed only of an id whose
        player document is gone). "Is this a team of one" is a question about
        the team, not about who has played — and it is checked BEFORE the
        aggregate for exactly that reason: a lone player who HAS played this
        month still reads `solo`, not `nobody-else` (see the response test
        that pins this in insights.test.ts).

        A MISSING AGGREGATE IS `not-played` rather than `nobody-else`. Nobody
        has played the month, the viewer included, so the ask is on them.
      */
      /*
        THE RANK IS PART OF THE PAID MONTH FOR EVERY MONTH BUT THIS ONE
        (wordle-teams-g03s, resolved). `stats` is null above for every month a
        free member asks for, so serving a POSITION derived from the same
        aggregate for an arbitrary past month was incoherent: a conclusion about
        a month whose numbers the caller is not allowed to see. A rank for last
        March is analysis — the thing Layer 3 sells — rather than a fact about
        today, and nothing free is meant to reach it.

        THE CURRENT MONTH STAYS FREE, AND THAT IS THE POINT RATHER THAN AN
        EXEMPTION. The free tier's product here is one fact about today
        (DailyTeamFact) plus "where do I stand this month" — wordle-teams-iht.3.3
        added the second deliberately as the one real figure the free tier gains,
        and lib/insightsAccess.ts's hard constraint is that NOTHING PREVIOUSLY
        FREE MOVES BEHIND THE PAYWALL. Withholding it for the current month would
        breach that; withholding it for March takes nothing anyone ever had.

        `monthOf(day)`, NOT `monthOf(today)`, AND THE DIFFERENCE IS THE WHOLE
        GATE. `day` is the value already bounded by isPlausibleToday just above.
        Comparing against the raw `today` would make the check self-certifying:
        a caller wanting March's rank would send `today: '2026-03-14'` alongside
        `month: '2026-03'` and pass. Against `day`, an implausible `today`
        collapses to the server's own, so the furthest a lying client can move
        the accepted month is the ±1 day of slack — which reaches a second month
        only at a month boundary, and only the one adjacent to it. That is the
        same tolerance requirePlausibleToday grants every mutation.

        A FREE CALLER WITH A GENUINELY WRONG CLOCK LOSES THE RANK, and it is
        worth naming rather than discovering. If their `today` is days adrift,
        `day` falls back to the server's and `monthOf(day)` stops matching the
        month their browser asked for, so this returns null. Their free card is
        already degraded in exactly that case — the teaser filters `stats.days`
        for `day`, which is not in the month that was fetched, so the fact reads
        'no-board' — so this withholds nothing that was still working.

        NO UI REGRESSION, VERIFIED RATHER THAN ASSUMED: team-section.tsx's free
        branch computes `queryMonth = hasFullTeamMonth(layer3) ? month :
        monthOf(today)` from the same `toPuzzleDay(new Date())` it sends as
        `today`, and never passes `?month=` on that branch. So a browser on this
        path always satisfies this check, and `data.rank` is non-null there as
        that component's own comment claims.

        THE TRIAL KEEPS ITS RANK FOR EVERY MONTH, DELIBERATELY, AND THAT IS NOT
        AN OVERSIGHT IN THIS GATE — it never reaches it. `hasFullTeamMonth`
        includes `trialActive`, so a trialist takes the paid branch below, gets
        `stats` in full, and src/lib/insights-team.ts's `memberAverages` puts them
        in order on the client from it. Nothing here could withhold that without withholding
        `stats`, and the spec forbids exactly that: §4 states "The trial does not
        widen this window" (docs/superpowers/specs/2026-09-17-pro-month-window-design.md)
        and accepts the resulting trial/pro seam in those words. So the honest
        statement of this gate's reach is: it binds the FREE tier only.

        null, NOT A NEW TeamRankTeaser TAG. `TeamRankTeaser`'s four kinds are
        reasons a player HAS no standing, each with its own copy in
        team-locked-card.tsx's exhaustive `headlineFor`; "you may not see this
        month's" is not one of those and would need copy for a state no browser
        can reach. The paid branch already returns `rank: null`, so both branches
        keep the same keys and the client needs no new narrowing.
      */
      const rank: TeamRankTeaser | null =
        monthOf(day) !== month
          ? null
          : roster.length < 2
            ? { kind: 'solo' }
            : stats
              ? teamRank(stats.members, player._id)
              : { kind: 'not-played' }

      return {
        access,
        viewerId: player._id,
        roster,
        stats: null,
        teaser: stats
          ? {
              // IDENTITIES ONLY. dailyTeamFact counts these to know how many
              // teammates there are; it never reads a total, and the totals are
              // what memberAverages and the rest are built from.
              members: stats.members.map(({ playerId }) => ({ playerId })),
              days: stats.days.filter((entry) => entry.puzzleDay === day),
            }
          : null,
        rank,
      }
    }

    return {
      access,
      viewerId: player._id,
      roster,
      stats: stats ? { members: stats.members, days: stats.days } : null,
      // Pro and trial read `stats`; these are here so both branches return the
      // same KEYS and the client never has to test for a missing field. The
      // rank is a teaser for a panel they already have in full.
      teaser: null,
      rank: null,
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
