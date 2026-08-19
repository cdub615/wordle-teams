import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { getMyTeamsFor } from './teams.ts'
import { toPuzzleDay } from './lib/puzzleDay.ts'
import { createTeamFor, deleteTeamFor, updateTeamFor } from './teams.ts'

const modules = import.meta.glob('./**/*.ts')
const today = toPuzzleDay(new Date())

describe('getMyTeamsFor', () => {
  test('returns only the teams the caller belongs to', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const mine = await ctx.db.insert('teams', aTeam({ name: 'Mine', playerIds: [ada], creator: ada }))
      await ctx.db.insert('teams', aTeam({ legacyId: 207, name: 'Theirs', playerIds: [bob], creator: bob }))

      const teams = await getMyTeamsFor(ctx, ada)
      expect(teams.map((team) => team.id)).toEqual([mine])
    })
  })

  test('carries members, creator flag and settings', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob', lastName: 'Ross' }))
      await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, bob], creator: ada, playWeekends: false, showLetters: false }),
      )

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.isCreator).toBe(true)
      expect(team.playWeekends).toBe(false)
      expect(team.showLetters).toBe(false)
      expect(team.members.map((member) => member.firstName)).toEqual(['Ada', 'Bob'])
    })
  })

  test('isCreator is false for a member who did not create the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      const [team] = await getMyTeamsFor(ctx, bob)
      expect(team.isCreator).toBe(false)
    })
  })

  test('isCreator is false when the team is a scoped copy with no creator', async () => {
    // A scoped copy may omit `creator` entirely — see access.ts's
    // requireTeamCreatorFor and its "refuses everyone when the creator was
    // not copied" test. isCreator is a UI-trust boolean shipped to every
    // client and gates the team-management buttons, so this is pinned rather
    // than left to fall out of `undefined === playerId` by accident.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: undefined }))

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.isCreator).toBe(false)
    })
  })

  test('returns an empty array for a player on no teams', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [bob], creator: bob }))

      const teams = await getMyTeamsFor(ctx, ada)
      expect(teams).toEqual([])
    })
  })

  test('excludes profile-incomplete members, as the scores table does', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const invitee = await ctx.db.insert(
        'players',
        aPlayer({ email: 'new@example.com', firstName: undefined, lastName: undefined }),
      )
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, invitee], creator: ada }))

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.members).toHaveLength(1)
    })
  })

  test('does not leak the invite list onto the wire', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada], creator: ada, invited: ['someone@example.com'] }),
      )

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(JSON.stringify(team)).not.toContain('someone@example.com')
    })
  })

  test('orders by createdAt, oldest first', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ name: 'Second', playerIds: [ada], creator: ada, createdAt: 2000 }))
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 207, name: 'First', playerIds: [ada], creator: ada, createdAt: 1000 }),
      )

      const teams = await getMyTeamsFor(ctx, ada)
      expect(teams.map((team) => team.name)).toEqual(['First', 'Second'])
    })
  })
})

describe('createTeamFor', () => {
  test('creates a team owned by the caller, with the default scoring system', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await createTeamFor(ctx, ada, {
        name: 'New Team',
        playWeekends: true,
        showLetters: false,
      })

      const team = (await ctx.db.get(teamId))!
      expect(team.name).toBe('New Team')
      expect(team.creator).toBe(ada)
      expect(team.playerIds).toEqual([ada])
      expect(team.invited).toEqual([])
      expect(team.showLetters).toBe(false)
      expect(team.oneGuess).toBe(5)
      expect(team.failed).toBe(-3)
      // Born in v2: no Supabase identity to carry.
      expect(team.legacyId).toBeUndefined()
      expect(typeof team.createdAt).toBe('number')
    })
  })

  test('trims the name and refuses an empty one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await createTeamFor(ctx, ada, {
        name: '  Padded  ',
        playWeekends: true,
        showLetters: true,
      })
      expect((await ctx.db.get(teamId))!.name).toBe('Padded')

      await expect(
        createTeamFor(ctx, ada, { name: '   ', playWeekends: true, showLetters: true }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_TEAM' } })
    })
  })

  test('does NOT enforce a team cap — v1 gates that in the UI only', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      for (const name of ['one', 'two', 'three']) {
        await createTeamFor(ctx, ada, { name, playWeekends: true, showLetters: true })
      }
      expect(await getMyTeamsFor(ctx, ada)).toHaveLength(3)
    })
  })
})

describe('updateTeamFor', () => {
  test('renames without touching the scoring system', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))

      await updateTeamFor(ctx, ada, {
        teamId,
        name: 'Renamed',
        playWeekends: true,
        showLetters: true,
        today,
      })

      const team = (await ctx.db.get(teamId))!
      expect(team.name).toBe('Renamed')
      expect(team.oneGuess).toBe(5)
    })
  })

  test('does not recompute when playWeekends is unchanged, even with a stale winner row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, bob], creator: ada, playWeekends: true }),
      )
      // Bob has a decisive win; Ada has no scores at all this month. A fresh
      // recompute would name Bob. The stored row deliberately names Ada
      // instead, so an accidental recompute is observable as the row changing
      // — the rename test alone can't tell "correctly skipped" from "there was
      // nothing to recompute", because it never seeds a winner row at all.
      await ctx.db.insert('dailyScores', {
        playerId: bob,
        puzzleDay: '2026-06-08',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 6,
        hasSeenCelebration: [],
      })

      // Only the name changes; playWeekends stays true.
      await updateTeamFor(ctx, ada, {
        teamId,
        name: 'Renamed Again',
        playWeekends: true,
        showLetters: true,
        today,
      })

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 6))
        .first()
      // Still Ada — wrong per a fresh compute, but untouched, which is the
      // proof no recompute ran.
      expect(row?.playerId).toBe(ada)
    })
  })

  test('refuses a member who is not the creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      await expect(
        updateTeamFor(ctx, bob, {
          teamId,
          name: 'Hijacked',
          playWeekends: true,
          showLetters: true,
          today,
        }),
      ).rejects.toMatchObject({ data: { code: 'NOT_TEAM_CREATOR' } })
    })
  })

  test('recomputes past winners when playWeekends flips', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, bob], creator: ada, playWeekends: true }),
      )
      // 2026-06-06 is a Saturday, 2026-06-08 a Monday.
      // With weekends on, Ada (weekend win) leads; with weekends off she scores nothing.
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: '2026-06-06',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('dailyScores', {
        playerId: bob,
        puzzleDay: '2026-06-08',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['CRANE', 'SLATE', 'SPELL', 'SPEED'],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 6,
        hasSeenCelebration: [ada],
      })

      await updateTeamFor(ctx, ada, {
        teamId,
        name: 'team 206',
        playWeekends: false,
        showLetters: true,
        today,
      })

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 6))
        .first()
      expect(row?.playerId).toBe(bob)
    })
  })
})

describe('deleteTeamFor', () => {
  test('deletes the team and cascades to winners and scoring versions, but not to boards', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))
      const scoreId = await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: '2026-06-08',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 6,
        hasSeenCelebration: [],
      })
      await ctx.db.insert('scoringSystems', {
        teamId,
        effectiveFrom: '2026-06',
        oneGuess: 9,
        twoGuesses: 3,
        threeGuesses: 2,
        fourGuesses: 1,
        fiveGuesses: 0,
        sixGuesses: -1,
        failed: -3,
        nA: 0,
      })

      await deleteTeamFor(ctx, ada, teamId)

      expect(await ctx.db.get(teamId)).toBeNull()
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
      expect(await ctx.db.query('scoringSystems').collect()).toEqual([])
      // A board belongs to a player and is shared across all their teams, so it
      // survives — exactly as in Postgres, where daily_scores has no team fkey.
      expect(await ctx.db.get(scoreId)).not.toBeNull()
    })
  })

  test('deletes a team with no winners and no scoring versions — the two collect-and-loop cascades are no-ops', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))

      await deleteTeamFor(ctx, ada, teamId)

      expect(await ctx.db.get(teamId)).toBeNull()
    })
  })

  test('refuses a member who is not the creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))
      await expect(deleteTeamFor(ctx, bob, teamId)).rejects.toMatchObject({ data: { code: 'NOT_TEAM_CREATOR' } })
      expect(await ctx.db.get(teamId)).not.toBeNull()
    })
  })

  test('does not touch another team’s winner rows', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const doomed = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))
      const kept = await ctx.db.insert('teams', aTeam({ legacyId: 207, playerIds: [ada], creator: ada }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId: doomed,
        year: 2026,
        month: 6,
        hasSeenCelebration: [],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId: kept,
        year: 2026,
        month: 6,
        hasSeenCelebration: [],
      })

      await deleteTeamFor(ctx, ada, doomed)

      const remaining = await ctx.db.query('monthlyWinners').collect()
      expect(remaining.map((row) => row.teamId)).toEqual([kept])
    })
  })
})
