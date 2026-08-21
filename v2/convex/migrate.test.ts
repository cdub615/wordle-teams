import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

describe('deleteNamelessPlayers', () => {
  test('dry run reports counts and writes nothing', async () => {
    const t = convexTest(schema, modules)
    // Both branches of the team loop are represented, because a dry run has to
    // skip BOTH writes: `team` would be deleted outright, `shared` would be
    // patched. One emptied team alone would leave the patch unguarded and
    // unnoticed.
    const { ada, live, team, shared } = await t.run(async (ctx) => {
      const nameless = await ctx.db.insert(
        'players',
        aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }),
      )
      const live = await ctx.db.insert('players', aPlayer({ email: 'live@a.test' }))
      const team = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [nameless], creator: nameless }),
      )
      const shared = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 999, playerIds: [live, nameless], creator: nameless }),
      )
      return { ada: nameless, live, team, shared }
    })

    const report = await t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: true })
    expect(report).toEqual({
      dryRun: true,
      namelessPlayers: 1,
      teamsEmptied: 1,
      rostersCleaned: 1,
      creatorsCleared: 1,
    })

    // Every write the commit path would perform is asserted absent, not just the
    // player delete. A dry run that emptied this team would ALSO cascade away
    // its monthlyWinners and scoringSystems, and Task 0b runs this against a
    // live deployment on the strength of the dry-run output alone — so "wrote
    // nothing" has to be pinned write-for-write.
    await t.run(async (ctx) => {
      expect(await ctx.db.get(ada)).not.toBeNull()

      const untouched = await ctx.db.get(team)
      expect(untouched).not.toBeNull()
      expect(untouched!.playerIds).toEqual([ada])
      expect(untouched!.creator).toEqual(ada)

      const unpatched = (await ctx.db.get(shared))!
      expect(unpatched.playerIds).toEqual([live, ada])
      expect(unpatched.creator).toEqual(ada)
    })
  })

  test('removes the player from rosters, clears creator, and deletes an emptied team', async () => {
    const t = convexTest(schema, modules)
    const { nameless, live, sharedTeam, deadTeam } = await t.run(async (ctx) => {
      const nameless = await ctx.db.insert(
        'players',
        aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }),
      )
      const live = await ctx.db.insert('players', aPlayer({ email: 'live@a.test' }))
      const sharedTeam = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [live, nameless], creator: nameless }),
      )
      const deadTeam = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 999, playerIds: [nameless], creator: nameless }),
      )
      return { nameless, live, sharedTeam, deadTeam }
    })

    await t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(nameless)).toBeNull()
      expect(await ctx.db.get(deadTeam)).toBeNull()
      const shared = (await ctx.db.get(sharedTeam))!
      expect(shared.playerIds).toEqual([live])
      expect(shared.creator).toBeUndefined()
    })
  })

  test('refuses to run when a nameless player owns a score', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const nameless = await ctx.db.insert(
        'players',
        aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }),
      )
      await ctx.db.insert('dailyScores', {
        playerId: nameless,
        puzzleDay: '2026-08-01',
        date: 0,
        guesses: [],
      })
    })

    await expect(
      t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false }),
    ).rejects.toThrow(/owns dailyScores/)
  })

  // The second half of the same guard. Both tables are asserted rather than
  // trusted, so both refusals need a test — production says no nameless player
  // owns either, and the whole point is to find out if that ever stops being
  // true rather than to delete somebody's history on the assumption it holds.
  test('refuses to run when a nameless player owns a monthlyWinners row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const nameless = await ctx.db.insert(
        'players',
        aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }),
      )
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [nameless] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: nameless,
        teamId: team,
        year: 2026,
        month: 7,
        hasSeenCelebration: [],
      })
    })

    await expect(
      t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false }),
    ).rejects.toThrow(/owns monthlyWinners/)
  })

  // The cascade is scoped to rows that belong to the TEAM. dailyScores belong to
  // players and must survive it — a dailyScore has no teamId, so a cascade can
  // only reach one by going through a field that NAMES a player. Enumerated from
  // the schema, those fields are: on the team doc, creator, playerIds and invited
  // (an address, but players are indexed by_email); on the rows this cascade
  // collects, monthlyWinners.playerId and monthlyWinners.hasSeenCelebration.
  // scoringSystems names no player. That list is the whole reachable surface as
  // the schema stands today — if a field naming a player is added to teams or to
  // either collected table, this test stops being exhaustive and a route opens
  // that nothing here would catch.
  //
  // Every one of those five is represented below by a player who owns a score,
  // except playerIds, where it is impossible: a team is emptied exactly when
  // every id in playerIds is nameless, and a nameless player owning a score is
  // refused outright above, so an emptied team's roster provably never holds a
  // score-owner. That route is covered in its patched form instead — `live` is a
  // real member of keptTeam, which the migration edits rather than deletes.
  //
  // Concretely: `founder` is the emptied foundedTeam's surviving creator, and
  // `live` is deadTeam's monthlyWinners winner, is named in that row's
  // hasSeenCelebration, sits on deadTeam's invited list, and is a member of
  // keptTeam. Both own a dailyScore, and both scores must still be there after.
  test("deletes an emptied team's monthlyWinners and scoringSystems, and no dailyScores at all", async () => {
    const t = convexTest(schema, modules)
    const { live, liveScore, founderScore, deadTeam, foundedTeam, keptTeam } = await t.run(
      async (ctx) => {
        const nameless = await ctx.db.insert(
          'players',
          aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }),
        )
        const live = await ctx.db.insert('players', aPlayer({ email: 'live@a.test' }))
        const founder = await ctx.db.insert('players', aPlayer({ email: 'founder@a.test' }))

        const deadTeam = await ctx.db.insert(
          'teams',
          // `invited` is the one player reference on a team that is an ADDRESS
          // rather than an id, and players are indexed by_email, so it resolves
          // to a player as easily as the id fields do.
          aTeam({ playerIds: [nameless], creator: nameless, invited: ['live@a.test'] }),
        )
        // Emptied even though its creator survives — nothing on its roster does.
        const foundedTeam = await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 998, playerIds: [nameless], creator: founder }),
        )
        const keptTeam = await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 999, playerIds: [live, nameless], creator: live }),
        )

        await ctx.db.insert('monthlyWinners', {
          playerId: live,
          teamId: deadTeam,
          // NOT empty: this array names players on a row the cascade already
          // collects, so it is the closest player reference to hand for anyone
          // editing that block. An empty one silently excuses a cascade that
          // walks it.
          hasSeenCelebration: [live],
          year: 2026,
          month: 7,
        })
        await ctx.db.insert('scoringSystems', {
          teamId: deadTeam,
          effectiveFrom: '2026-07',
          oneGuess: 5,
          twoGuesses: 3,
          threeGuesses: 2,
          fourGuesses: 1,
          fiveGuesses: 0,
          sixGuesses: -1,
          failed: -3,
          nA: 0,
        })

        const liveScore = await ctx.db.insert('dailyScores', {
          playerId: live,
          puzzleDay: '2026-07-01',
          date: 0,
          guesses: [],
        })
        const founderScore = await ctx.db.insert('dailyScores', {
          playerId: founder,
          puzzleDay: '2026-07-02',
          date: 0,
          guesses: [],
        })
        return { live, liveScore, founderScore, deadTeam, foundedTeam, keptTeam }
      },
    )

    await t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false })

    await t.run(async (ctx) => {
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
      expect(await ctx.db.query('scoringSystems').collect()).toEqual([])
      expect(await ctx.db.get(deadTeam)).toBeNull()
      expect(await ctx.db.get(foundedTeam)).toBeNull()

      // The winner's score, the surviving creator's score, and the roster of the
      // team that was only patched.
      expect(await ctx.db.get(liveScore)).not.toBeNull()
      expect(await ctx.db.get(founderScore)).not.toBeNull()
      expect((await ctx.db.get(keptTeam))!.playerIds).toEqual([live])
    })
  })
})
