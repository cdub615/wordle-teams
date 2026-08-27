import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { getMyTeamsFor } from './teams.ts'
import { toPuzzleDay } from './lib/puzzleDay.ts'
import {
  cancelInviteFor,
  createTeamFor,
  deleteTeamFor,
  getTeamInvitesFor,
  invitePlayerFor,
  leaveTeamFor,
  removeMemberFor,
  updateTeamFor,
} from './teams.ts'
import { teamInviteEmail } from './inviteEmails.ts'
import { upgradeTeamInvitesFor } from './billing.ts'
import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'
import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')
const today = toPuzzleDay(new Date())

describe('getMyTeamsFor', () => {
  test('returns only the teams the caller belongs to', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const mine = await ctx.db.insert('teams', aTeam({ name: 'Mine', playerIds: [ada], owner: ada }))
      await ctx.db.insert('teams', aTeam({ legacyId: 207, name: 'Theirs', playerIds: [bob], owner: bob }))

      const teams = await getMyTeamsFor(ctx, ada)
      expect(teams.map((team) => team.id)).toEqual([mine])
    })
  })

  test('carries members, owner flag and settings', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob', lastName: 'Ross' }))
      await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, bob], owner: ada, playWeekends: false, showLetters: false }),
      )

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.isOwner).toBe(true)
      expect(team.playWeekends).toBe(false)
      expect(team.showLetters).toBe(false)
      expect(team.members.map((member) => member.firstName)).toEqual(['Ada', 'Bob'])
    })
  })

  test('isOwner is false for a member who did not create the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      const [team] = await getMyTeamsFor(ctx, bob)
      expect(team.isOwner).toBe(false)
    })
  })

  test('isOwner is false when the team is a scoped copy with no owner', async () => {
    // A scoped copy may omit `owner` entirely — see access.ts's
    // requireTeamOwnerFor and its "refuses everyone when the owner was
    // not copied" test. isOwner is a UI-trust boolean shipped to every
    // client and gates the team-management buttons, so this is pinned rather
    // than left to fall out of `undefined === playerId` by accident.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: undefined }))

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.isOwner).toBe(false)
    })
  })

  test('returns an empty array for a player on no teams', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [bob], owner: bob }))

      const teams = await getMyTeamsFor(ctx, ada)
      expect(teams).toEqual([])
    })
  })

  test('omits a roster entry whose player document is gone, as the scores table does', async () => {
    // Convex ids are not foreign keys, so a `playerIds` entry can outlive the
    // row it names. getMyTeamsFor answers for EVERY team the caller is on in a
    // single read, so without the guard one unresolvable member on one team
    // throws on `member.firstName` and empties the caller's whole dashboard.
    // Constructed by deleting the row out from under a live roster, which is
    // the only way to reach the state now that a nameless player is
    // unrepresentable — this test replaces the profile-completeness one that
    // Phase 4's schema narrowing made impossible to write.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const ghost = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, ghost], owner: ada }))
      await ctx.db.delete(ghost)

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.members).toHaveLength(1)
      expect(team.members[0].id).toBe(ada)
    })
  })

  test('does not leak the invite list onto the wire', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada], owner: ada, invited: ['someone@example.com'] }),
      )

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(JSON.stringify(team)).not.toContain('someone@example.com')
    })
  })

  test('orders by createdAt, oldest first', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ name: 'Second', playerIds: [ada], owner: ada, createdAt: 2000 }))
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 207, name: 'First', playerIds: [ada], owner: ada, createdAt: 1000 }),
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
      expect(team.owner).toBe(ada)
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
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

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
        aTeam({ playerIds: [ada, bob], owner: ada, playWeekends: true }),
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

  test('refuses a member who is not the owner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await expect(
        updateTeamFor(ctx, bob, {
          teamId,
          name: 'Hijacked',
          playWeekends: true,
          showLetters: true,
          today,
        }),
      ).rejects.toMatchObject({ data: { code: 'NOT_TEAM_OWNER' } })
    })
  })

  test('recomputes past winners when playWeekends flips', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, bob], owner: ada, playWeekends: true }),
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
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
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
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await deleteTeamFor(ctx, ada, teamId)

      expect(await ctx.db.get(teamId)).toBeNull()
    })
  })

  test('refuses a member who is not the owner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await expect(deleteTeamFor(ctx, bob, teamId)).rejects.toMatchObject({ data: { code: 'NOT_TEAM_OWNER' } })
      expect(await ctx.db.get(teamId)).not.toBeNull()
    })
  })

  test('does not touch another team’s winner rows', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const doomed = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const kept = await ctx.db.insert('teams', aTeam({ legacyId: 207, playerIds: [ada], owner: ada }))
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

describe('removeMemberFor', () => {
  test('removes the member from playerIds', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await removeMemberFor(ctx, ada, { teamId, playerId: bob, today })

      expect((await ctx.db.get(teamId))!.playerIds).toEqual([ada])
    })
  })

  test('recomputes EVERY month the team has a winner row for', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      // Bob won both June and July outright.
      for (const puzzleDay of ['2026-06-08', '2026-07-08']) {
        await ctx.db.insert('dailyScores', {
          playerId: bob,
          puzzleDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }
      for (const [year, month] of [
        [2026, 6],
        [2026, 7],
      ] as const) {
        await ctx.db.insert('monthlyWinners', {
          playerId: bob,
          teamId,
          year,
          month,
          hasSeenCelebration: [bob],
        })
      }

      await removeMemberFor(ctx, ada, { teamId, playerId: bob, today })

      // Ada has no scores at all, so a fresh compute gives her a total of 0 for
      // both months — but winnerOf (see its doc comment in lib/scoring.ts)
      // returns null only when the CANDIDATE LIST is empty, not when every
      // candidate scored zero. With Bob gone she is the only remaining
      // eligible member, so she wins both months outright. That is what this
      // test actually proves recomputed: if only June had been recomputed and
      // not July, July would still show Bob.
      const rows = await ctx.db.query('monthlyWinners').collect()
      expect(rows.map((row) => ({ month: row.month, playerId: row.playerId }))).toEqual([
        { month: 6, playerId: ada },
        { month: 7, playerId: ada },
      ])
      // The winner changed on both rows, so the celebration flag resets —
      // proof this is a genuine recompute, not the old rows left untouched.
      expect(rows.every((row) => row.hasSeenCelebration.length === 0)).toBe(true)
    })
  })

  test('refuses to remove the owner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await expect(
        removeMemberFor(ctx, ada, { teamId, playerId: ada, today }),
      ).rejects.toMatchObject({ data: { code: 'OWNER_NOT_REMOVABLE' } })
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([ada, bob])
    })
  })

  test('refuses a member who is not the owner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const carol = await ctx.db.insert('players', aPlayer({ email: 'carol@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob, carol], owner: ada }))

      await expect(
        removeMemberFor(ctx, bob, { teamId, playerId: carol, today }),
      ).rejects.toMatchObject({ data: { code: 'NOT_TEAM_OWNER' } })
    })
  })

  test('no-ops when the target player is not on the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const carol = await ctx.db.insert('players', aPlayer({ email: 'carol@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      // Deliberately stale — a fresh recompute would change this, since ada
      // has no scores and bob does. Left alone, it proves the recompute was
      // skipped rather than having run and coincidentally landed on the same
      // value.
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

      // carol is not on this team.
      await removeMemberFor(ctx, ada, { teamId, playerId: carol, today })

      expect((await ctx.db.get(teamId))!.playerIds).toEqual([ada, bob])
      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 6))
        .first()
      expect(row?.playerId).toBe(ada)
    })
  })

  test('bounds today BEFORE the owner guard, so a wrong clock gets INVALID_DATE here too', async () => {
    // The other half of leaveTeamFor's cross-surface parity claim: both helpers
    // check the clock before refusing an owner, so the same wrong clock gets
    // the same code from either. This surface had NO clock test at all before —
    // the bound could have been dropped from removeMemberFor entirely and
    // nothing would have noticed.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      // Removing the OWNER, which is what would otherwise throw
      // OWNER_NOT_REMOVABLE.
      await expect(
        removeMemberFor(ctx, ada, { teamId, playerId: ada, today: '1999-01-01' }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([ada, bob])
    })
  })

  test('leaves the removed player’s boards intact', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const scoreId = await ctx.db.insert('dailyScores', {
        playerId: bob,
        puzzleDay: '2026-06-08',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      await removeMemberFor(ctx, ada, { teamId, playerId: bob, today })

      expect(await ctx.db.get(scoreId)).not.toBeNull()
    })
  })
})

describe('leaveTeamFor', () => {
  test('a member removes themselves', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const owner = await ctx.db.insert('players', aPlayer({ email: 'owner@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [owner, bob], owner }))

      await leaveTeamFor(ctx, bob, { teamId, today })

      expect((await ctx.db.get(teamId))!.playerIds).toEqual([owner])
    })
  })

  test('refuses the owner, who reaches the owner guard rather than the membership one', async () => {
    // Their exit is deleteTeam. This keeps the Phase 3 invariant that a team
    // always has an administrator.
    //
    // THE CODE IS PINNED, not merely "it threw", and the reason is narrower than
    // it first looks. Under this fixture the owner IS on the roster and
    // `today` is valid, so nothing upstream can throw and even a bare
    // .rejects.toThrow() would kill a guard-deleted mutant — measured, not
    // assumed. What a bare toThrow() would NOT kill is a guard that throws the
    // wrong code: NOT_A_MEMBER instead of OWNER_NOT_REMOVABLE. That is the
    // mutant this pin exists for, and it matters because the design mandates
    // reusing OWNER_NOT_REMOVABLE here — this assertion is the only thing
    // tying the implementation to that decision.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const owner = await ctx.db.insert('players', aPlayer({ email: 'owner@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [owner, bob], owner }))

      await expect(leaveTeamFor(ctx, owner, { teamId, today })).rejects.toMatchObject({
        data: { code: 'OWNER_NOT_REMOVABLE' },
      })
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([owner, bob])
    })
  })

  test('a non-member is refused, and the roster is untouched', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const owner = await ctx.db.insert('players', aPlayer({ email: 'owner@example.test' }))
      const stranger = await ctx.db.insert('players', aPlayer({ email: 'stranger@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [owner], owner }))

      await expect(leaveTeamFor(ctx, stranger, { teamId, today })).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([owner])
    })
  })

  test('recomputes EVERY month the team has a winner row for', async () => {
    // TWO months, for the reason removeMemberFor's twin test gives: with a
    // single winner row this could not tell "recomputed every month in
    // monthsWithWinners" from "recomputed one of them". Both are fixed months
    // in 2025 — never the wall-clock month, or a mutant that ignored
    // monthsWithWinners and recomputed only `today`'s month would survive.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const owner = await ctx.db.insert('players', aPlayer({ email: 'owner@example.test' }))
      const bob = await ctx.db.insert(
        'players',
        aPlayer({ email: 'bob@example.test', firstName: 'Bob' }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [owner, bob], owner }))
      // Bob won both June and July 2025 outright.
      for (const puzzleDay of ['2025-06-02', '2025-07-02']) {
        await ctx.db.insert('dailyScores', {
          playerId: bob,
          puzzleDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }
      for (const [year, month] of [
        [2025, 6],
        [2025, 7],
      ] as const) {
        await ctx.db.insert('monthlyWinners', {
          playerId: bob,
          teamId,
          year,
          month,
          hasSeenCelebration: [bob],
        })
      }

      await leaveTeamFor(ctx, bob, { teamId, today })

      // The owner has no scores at all, so a fresh compute gives her 0 for
      // both months — but winnerOf returns null only when the CANDIDATE LIST is
      // empty, not when every candidate scored zero, so with Bob gone she wins
      // both outright. If only one month had been recomputed the other would
      // still name Bob.
      const rows = await ctx.db.query('monthlyWinners').collect()
      expect(rows.map((row) => ({ month: row.month, playerId: row.playerId }))).toEqual([
        { month: 6, playerId: owner },
        { month: 7, playerId: owner },
      ])
      // The winner changed on both rows, so the celebration flag resets — proof
      // this is a genuine recompute, not the old rows left untouched.
      expect(rows.every((row) => row.hasSeenCelebration.length === 0)).toBe(true)
    })
  })

  test('the last member of an owner-less team deletes it and cascades', async () => {
    // The scoped-copy case: `owner` is undefined, so nobody is refused and the
    // team can be emptied. Leaving an unreachable orphan would be worse.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [bob], owner: undefined }))
      await ctx.db.insert('monthlyWinners', {
        playerId: bob,
        teamId,
        year: 2025,
        month: 6,
        hasSeenCelebration: [],
      })
      await ctx.db.insert('scoringSystems', {
        teamId,
        effectiveFrom: '2025-06',
        oneGuess: 5,
        twoGuesses: 3,
        threeGuesses: 2,
        fourGuesses: 1,
        fiveGuesses: 0,
        sixGuesses: -1,
        failed: -3,
        nA: 0,
      })
      const scoreId = await ctx.db.insert('dailyScores', {
        playerId: bob,
        puzzleDay: '2025-06-02',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      await leaveTeamFor(ctx, bob, { teamId, today })

      expect(await ctx.db.get(teamId)).toBeNull()
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
      expect(await ctx.db.query('scoringSystems').collect()).toEqual([])
      // A board belongs to the player and is shared across every team.
      expect(await ctx.db.get(scoreId)).not.toBeNull()
    })
  })

  test('a pending invite is destroyed with the team, and that is the intended trade', async () => {
    // THE INVITE IS A THIRD PARTY'S, and it was live: completeProfileFor scans
    // every team for the joiner's address with NO owner check, so an entry
    // parked on an owner-less team really could still be claimed. `invited` is
    // copied wholesale from production, so this state is reachable with real
    // data rather than only by construction.
    //
    // Pinned so the choice is recorded rather than incidental. The alternative
    // is worse: the invitee claims it later and lands alone on a team nobody can
    // administer, which is the same dead end one step further on.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [bob], owner: undefined, invited: ['pending@example.test'] }),
      )

      await leaveTeamFor(ctx, bob, { teamId, today })

      expect(await ctx.db.get(teamId)).toBeNull()
      // Nowhere left to claim: no team parks that address any more.
      const teams = await ctx.db.query('teams').collect()
      expect(teams.flatMap((team) => team.invited)).toEqual([])
    })
  })

  test('deletes a team whose owner is not on its roster, when its last member leaves', async () => {
    // The branch is keyed on the ROSTER being empty afterwards, not on
    // `owner === undefined`. A team naming an owner who is not a member is
    // representable — the schema enforces no referential integrity between
    // `owner` and `playerIds` — and it is just as unadministrable, because
    // requireTeamOwnerFor goes through requireTeamMemberFor first. Pinned so
    // the cascade comment's claim about what reaches it is a tested one.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ghost = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [bob], owner: ghost }))
      await ctx.db.insert('monthlyWinners', {
        playerId: bob,
        teamId,
        year: 2025,
        month: 6,
        hasSeenCelebration: [],
      })

      await leaveTeamFor(ctx, bob, { teamId, today })

      expect(await ctx.db.get(teamId)).toBeNull()
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
    })
  })

  test('refuses a today the server clock cannot believe, and the roster survives', async () => {
    // `today` decides which missed days are already due and is written into a
    // monthlyWinners row the whole team reads — the same reason every other
    // mutation that feeds one into recomputation bounds it. Added because a
    // mutant that dropped requirePlausibleToday from leaveTeamFor survived every
    // one of the five tests this block was originally drafted with.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const owner = await ctx.db.insert('players', aPlayer({ email: 'owner@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [owner, bob], owner }))

      await expect(leaveTeamFor(ctx, bob, { teamId, today: '1999-01-01' })).rejects.toMatchObject({
        data: { code: 'INVALID_DATE' },
      })
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([owner, bob])
    })
  })

  test('bounds today BEFORE the owner guard, so an owner with a wrong clock gets INVALID_DATE', async () => {
    // The ordering promise in leaveTeamFor's comment, made testable. Both of the
    // other clock tests use a non-OWNER leaver, so neither can see the bound
    // move below the owner guard — measured: that reorder left every other
    // test in this file green. The twin assertion for the other surface is in
    // removeMemberFor's block, since the claim is cross-surface parity.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const owner = await ctx.db.insert('players', aPlayer({ email: 'owner@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [owner, bob], owner }))

      await expect(
        leaveTeamFor(ctx, owner, { teamId, today: '1999-01-01' }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })
    })
  })

  test('refuses an implausible today on the CASCADE path too, and the team survives', async () => {
    // The bound is checked before the branch, so the same call cannot be
    // accepted or refused depending on how many other people happen to be on the
    // team — and the path this pins is the one that DELETES a team. Separate
    // from the test above because only that ordering makes both true.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [bob], owner: undefined }))

      await expect(leaveTeamFor(ctx, bob, { teamId, today: '1999-01-01' })).rejects.toMatchObject({
        data: { code: 'INVALID_DATE' },
      })
      expect(await ctx.db.get(teamId)).not.toBeNull()
    })
  })

  test('does not touch another team when one is cascaded away', async () => {
    // cascadeDeleteTeam is now called from two places and both index-scan by
    // teamId. Un-scoping the scan outright is ALREADY caught, by deleteTeamFor's
    // "does not touch another team's winner rows" — this is not that. What only
    // this test can see is the two call paths DIVERGING: a cascade that keeps
    // its scoping on the delete path and loses it on the leave path.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const doomed = await ctx.db.insert('teams', aTeam({ playerIds: [bob], owner: undefined }))
      const kept = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 207, playerIds: [bob], owner: bob }),
      )
      for (const teamId of [doomed, kept]) {
        await ctx.db.insert('monthlyWinners', {
          playerId: bob,
          teamId,
          year: 2025,
          month: 6,
          hasSeenCelebration: [],
        })
      }

      await leaveTeamFor(ctx, bob, { teamId: doomed, today })

      expect(await ctx.db.get(kept)).not.toBeNull()
      const remaining = await ctx.db.query('monthlyWinners').collect()
      expect(remaining.map((row) => row.teamId)).toEqual([kept])
    })
  })
})

/**
 * The invite fixtures. `.test` addresses only — this repository is public.
 *
 * ADA_AS_TYPED is the same address as ADA, padded and mixed-case, in the shape
 * an owner actually types or pastes one. STRANGER is nobody's account.
 */
const OWNER = 'owner@example.test'
const ADA = 'ada@example.test'
const ADA_AS_TYPED = '  Ada@Example.TEST '
const STRANGER = 'new.person@example.test'
const STRANGER_AS_TYPED = '  New.Person@Example.TEST  '

type TestCtx = GenericMutationCtx<DataModel>

/** A board scoring `guesses.length` attempts, mirroring players.test.ts. */
const aScore = (playerId: Id<'players'>, puzzleDay: string, guesses: Array<string>) => ({
  playerId,
  puzzleDay,
  date: 1_755_500_000_000,
  answer: 'SPEED',
  guesses,
})

/**
 * A team owned by Cara, with nobody else on it. `over` is spread over the team
 * so a test can pre-park an invite.
 */
const aTeamOwnedByCara = async (ctx: TestCtx, over: Record<string, unknown> = {}) => {
  const owner = await ctx.db.insert(
    'players',
    aPlayer({ email: OWNER, firstName: 'Cara', lastName: 'Owner' }),
  )
  const teamId = await ctx.db.insert(
    'teams',
    aTeam({ name: 'The Guessers', playerIds: [owner], owner, ...over }),
  )
  return { owner, teamId }
}

describe('invitePlayerFor', () => {
  test('adds an existing player straight to the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })

      // toEqual, not toMatchObject: the ABSENCE of email/teamName is the thing
      // that stops the wrapper mailing anybody. v1 sends no mail when an
      // existing player is added directly — they simply find themselves on the
      // team next time they look — and that parity is kept deliberately.
      // firstName is Ada's, not the inviter's, which is why the two fixtures
      // have different names.
      expect(outcome).toEqual({ status: 'added', firstName: 'Ada' })

      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([owner, ada])
      // Added, not parked: nothing goes into `invited` on this branch.
      expect(team.invited).toEqual([])
    })
  })

  test('matches an existing player case-insensitively, and past the whitespace', async () => {
    // AMENDMENT A2 FROM THE WRITE SIDE. v1 stored the address exactly as typed
    // and matched it case-sensitively while auth lowercased everything, so
    // inviting `Ada@Example.TEST` parked a second, unclaimable invite for
    // somebody who already had an account.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: ADA_AS_TYPED, today })

      expect(outcome).toEqual({ status: 'added', firstName: 'Ada' })
      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([owner, ada])
      expect(team.invited).toEqual([])
    })
  })

  test('adding an existing player also retires their pending invite', async () => {
    // THE ORDINARY SEQUENCE, not a corner case: park an invite for someone with
    // no account, they sign up, invite them again. Without the cleanup they are
    // a member AND permanently pending — getTeamInvitesFor's pending list is
    // `team.invited` itself, so the owner would see them in both places, with
    // cancelInviteFor the only remedy and nothing telling them to press it.
    //
    // Reachable for the whole copied user base, not just for people who joined
    // in that order: completeProfileFor is the only other place an invite is
    // retired, and a copied v1 player never reaches it, because needsProfile is
    // a row-existence check and they already have a row. Production carries 44
    // pending invites across 33 teams.
    //
    // THIS ALSO PINS v2'S BRANCH PRECEDENCE. The fixture is the one case where
    // v1 and v2 genuinely disagree — an existing account that is ALSO on the
    // invite list — and v1 takes the resend branch there (divergence 11). Every
    // other test in this suite passes unchanged if the two conditions are
    // reordered to v1's precedence, so this is the only thing standing between
    // `added` and a silent regression to the branch that stranded the invitee.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA] })
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })

      expect(outcome).toEqual({ status: 'added', firstName: 'Ada' })
      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([owner, ada])
      expect(team.invited).toEqual([])
    })
  })

  test('retires a pending invite parked in a shape the write rule would not produce', async () => {
    // The cleanup filter has to mirror normaliseInviteEmail on read for the same
    // reason the resend scan does: an entry it fails to match is one that nothing
    // can ever clear, since this branch and completeProfileFor are the only two
    // places an invite is retired and both compare the same way.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA_AS_TYPED] })
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })

      expect(outcome).toEqual({ status: 'added', firstName: 'Ada' })
      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([owner, ada])
      expect(team.invited).toEqual([])
    })
  })

  test('leaves OTHER pending invites alone when a player is added', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [STRANGER, ADA] })
      await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))

      await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })

      // Only Ada's entry goes. Filtering to [] would cancel everybody else's
      // outstanding invite as a side effect of one person joining.
      expect((await ctx.db.get(teamId))!.invited).toEqual([STRANGER])
    })
  })

  test('reports already_member and changes nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      // Ada is on the roster AND still listed as invited — the state a copied v1
      // team arrives in, since v1 never removed an invite it could not match.
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA] })
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      await ctx.db.patch(teamId, { playerIds: [owner, ada] })

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: ADA_AS_TYPED, today })

      // Nothing happened, and it says so. v1 logged this branch and then told
      // the owner "Successfully invited player" — divergence 9.
      expect(outcome).toEqual({ status: 'already_member' })
      const team = (await ctx.db.get(teamId))!
      // Not appended a second time, which would show Ada twice on the team card
      // and enter her twice in the month's candidate list.
      expect(team.playerIds).toEqual([owner, ada])
      // AND NOT REPAIRED EITHER. This branch is documented as writing nothing,
      // because a write here costs a getMyTeams broadcast to every connected
      // client on the path whose whole point is that nothing happened.
      // cancelInviteFor is the remedy for a row already stuck like this.
      expect(team.invited).toEqual([ADA])
    })
  })

  test('does not recompute when the invitee is already a member', async () => {
    // The already_member branch returns BEFORE the patch and the recompute, so a
    // deliberately stale winner row survives untouched. Left alone it proves the
    // recompute was skipped rather than having run and coincidentally landed on
    // the same value — Cara has no boards and Ada does, so a real recompute here
    // would name Ada.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      await ctx.db.patch(teamId, { playerIds: [owner, ada] })
      await ctx.db.insert('dailyScores', aScore(ada, '2025-06-03', ['SPEED']))
      const stale = await ctx.db.insert('monthlyWinners', {
        playerId: owner,
        teamId,
        year: 2025,
        month: 6,
        hasSeenCelebration: [owner],
      })

      await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })

      const row = (await ctx.db.get(stale))!
      expect(row.playerId).toBe(owner)
      expect(row.hasSeenCelebration).toEqual([owner])
    })
  })

  test('parks an unknown address in invited, lowercased and trimmed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)

      const outcome = await invitePlayerFor(ctx, owner, {
        teamId,
        email: STRANGER_AS_TYPED,
        today,
      })

      // The three fields the wrapper composes the mail from, pinned: the
      // recipient, the team the copy names, and the inviter the subject line
      // names. `inviterName` is Cara's first name, not her full name and not the
      // team's.
      expect(outcome).toEqual({
        status: 'invited',
        email: STRANGER,
        teamName: 'The Guessers',
        inviterName: 'Cara',
      })
      const team = (await ctx.db.get(teamId))!
      // Stored normalised. The schema comment on `teams.invited` is what this
      // holds up: a mixed-case row is one completeProfileFor's scan has to work
      // around rather than one it can rely on.
      expect(team.invited).toEqual([STRANGER])
      // Parked, not added: an address with no account joins nobody's roster.
      expect(team.playerIds).toEqual([owner])
    })
  })

  test('reports resent for an address already invited, without duplicating it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [STRANGER] })

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: STRANGER, today })

      // Same payload as `invited` — the mail is identical, and the only thing
      // that differs is that there was nothing to write.
      expect(outcome).toEqual({
        status: 'resent',
        email: STRANGER,
        teamName: 'The Guessers',
        inviterName: 'Cara',
      })
      expect((await ctx.db.get(teamId))!.invited).toEqual([STRANGER])
    })
  })

  test('reports resent for an address parked in a shape the write rule would not produce', async () => {
    // The read half of amendment A2, mirroring completeProfileFor's invite scan.
    // NO WRITE PATH PRODUCES THIS ROW TODAY — normaliseInviteEmail lowercases and
    // trims, and both copy gates lowercase — so the fixture is deliberately
    // unrepresentable data. It pins the read-side normalisation, because the cost
    // of losing it is silent: a second, differently-cased entry for the same
    // person, which completeProfileFor's own normalisation would then claim and
    // remove anyway, leaving an owner staring at a pending invite for somebody
    // who has already joined.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [STRANGER_AS_TYPED] })

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: STRANGER, today })

      expect(outcome).toMatchObject({ status: 'resent', email: STRANGER })
      // Untouched — a resend writes nothing at all, so the odd row is neither
      // repaired nor duplicated.
      expect((await ctx.db.get(teamId))!.invited).toEqual([STRANGER_AS_TYPED])
    })
  })

  test('rejects a malformed address and writes nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)

      await expect(
        invitePlayerFor(ctx, owner, { teamId, email: 'not-an-email', today }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_EMAIL' } })

      const team = (await ctx.db.get(teamId))!
      expect(team.invited).toEqual([])
      expect(team.playerIds).toEqual([owner])
    })
  })

  test('falls back to an anonymous inviter when the owner’s row is gone', async () => {
    // Convex ids are not foreign keys, so a `playerIds` entry — including the
    // owner's — can outlive the row it names, the same state getMyTeamsFor and
    // recomputeTeamMonth both guard. requireTeamOwnerFor still passes, because
    // it only compares ids. Without the fallback the subject line would read
    // "undefined invited you"; with it the mail is merely anonymous, which is
    // what v1's Supabase template always was.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      await ctx.db.delete(owner)

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: STRANGER, today })

      expect(outcome).toMatchObject({ status: 'invited', inviterName: 'Someone' })
    })
  })

  test('refuses a today the server clock cannot believe', async () => {
    // `today` decides which missed days are already due, and this mutation
    // writes it into a monthlyWinners row the whole team reads — the same reason
    // every other mutation that feeds one into recomputation bounds it.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)

      await expect(
        invitePlayerFor(ctx, owner, { teamId, email: STRANGER, today: '1999-01-01' }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })

      expect((await ctx.db.get(teamId))!.invited).toEqual([])
    })
  })

  test('refuses a member who is not the owner', async () => {
    // Divergence 4: v1's RLS lets any member UPDATE the team, so any member can
    // invite. v2 makes the UI's owner-only rule the real one.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      await ctx.db.patch(teamId, { playerIds: [owner, bob] })

      await expect(
        invitePlayerFor(ctx, bob, { teamId, email: STRANGER, today }),
      ).rejects.toMatchObject({ data: { code: 'NOT_TEAM_OWNER' } })

      expect((await ctx.db.get(teamId))!.invited).toEqual([])
    })
  })

  test('recomputes EVERY month the team has a winner row for when a player is added', async () => {
    // The mirror of removeMember's recompute, and divergence 5 for the same
    // reason: v1's update_monthly_winners is a trigger on daily_scores, so a
    // membership change never fires it, and in v2 a board entry only recomputes
    // the month it is dated in. The player being added brings their whole
    // history, so every stored winner this team has can now be wrong.
    //
    // EVERYTHING IS DATED IN FIXED PAST MONTHS — 2025-06 and 2025-07, never
    // today's. That is the point of the fixture, not a detail. Dated in the
    // current month, an implementation that ignored monthsWithWinners and only
    // ever recomputed today's month would pass. TWO months, so "recompute the
    // first one" is distinguishable from "recompute every one".
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      // Cara solved in four (1 point) in each month; Ada solved in one (5).
      // Every other day of both months scores the team's nA, which is 0, so each
      // month is decided by these two boards alone whatever date this runs on.
      for (const puzzleDay of ['2025-06-03', '2025-07-03']) {
        await ctx.db.insert(
          'dailyScores',
          aScore(owner, puzzleDay, ['CRANE', 'SLATE', 'SPELL', 'SPEED']),
        )
        await ctx.db.insert('dailyScores', aScore(ada, puzzleDay, ['SPEED']))
      }
      // The stale rows: Cara won both months because Ada was not on the roster
      // when they were computed, and she has already dismissed the confetti.
      const stale = []
      for (const month of [6, 7]) {
        stale.push(
          await ctx.db.insert('monthlyWinners', {
            playerId: owner,
            teamId,
            year: 2025,
            month,
            hasSeenCelebration: [owner],
          }),
        )
      }

      await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })

      for (const rowId of stale) {
        const row = (await ctx.db.get(rowId))!
        // Ada wins both months now she is on the roster. This also fails if the
        // recompute ran against the PRE-PATCH team snapshot, which does not have
        // her on it and would therefore re-elect Cara.
        expect(row.playerId).toBe(ada)
        // The winner really changed, so the seen-list resets — proof this is a
        // genuine recompute rather than the old rows left untouched.
        expect(row.hasSeenCelebration).toEqual([])
      }
    })
  })

  /**
   * THE NON-PRO TEAM CAP — the parking half of the mechanism billing.ts's
   * upgradeTeamInvitesFor releases, ported from v1's handle_add_player_to_team.
   *
   * EVERY COUNT HERE IS DERIVED FROM FREE_TEAM_LIMIT, never written as a 2. The
   * whole reason the constant exists is that team-picker.tsx swaps "New Team"
   * for "Upgrade for more" off the same number; a test that hardcoded 2 would
   * keep passing while the two sides drifted apart.
   */
  const onNTeams = async (ctx: TestCtx, playerId: Id<'players'>, count: number) => {
    for (let i = 0; i < count; i += 1) {
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 300 + i, name: `theirs ${i}`, playerIds: [playerId], owner: playerId }),
      )
    }
  }

  test('parks a non-pro invitee already on FREE_TEAM_LIMIT teams instead of adding them', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      await onNTeams(ctx, ada, FREE_TEAM_LIMIT)

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })

      // toEqual, not toMatchObject: the ABSENCE of teamName/inviterName is what
      // stops the wrapper mailing anybody. There is nothing to mail — Ada has an
      // account already, so no sign-up link would help her; only an upgrade
      // clears this. v1 sends nothing here either.
      expect(outcome).toEqual({ status: 'parked_at_cap', email: ADA })

      const team = (await ctx.db.get(teamId))!
      // NOT ADDED. This is the assertion that v2 stopped being more permissive
      // than production (divergence 8).
      expect(team.playerIds).toEqual([owner])
      expect(team.playerIds).not.toContain(ada)
      // PARKED, normalised, exactly once.
      expect(team.invited).toEqual([ADA])
    })
  })

  test('adds a PRO invitee no matter how many teams they are on', async () => {
    // The isProFor check is the whole difference between a cap and a wall.
    // Deliberately well past the limit, so this fails for an off-by-one too.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      await ctx.db.insert('playerMembership', { playerId: ada, membershipStatus: 'pro' })
      await onNTeams(ctx, ada, FREE_TEAM_LIMIT + 3)

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })

      expect(outcome).toEqual({ status: 'added', firstName: 'Ada' })
      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([owner, ada])
      expect(team.invited).toEqual([])
    })
  })

  test('adds a non-pro invitee who is one team BELOW the cap', async () => {
    // THE BOUNDARY, from the other side. v1's condition is `team_count >= 2`
    // evaluated BEFORE the add, so a free player tops out at exactly
    // FREE_TEAM_LIMIT teams: this invite is their last one, and it succeeds.
    // A `>` here instead of `>=` passes this test and fails the parking one.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      await onNTeams(ctx, ada, FREE_TEAM_LIMIT - 1)

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })

      expect(outcome).toEqual({ status: 'added', firstName: 'Ada' })
      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([owner, ada])
    })
  })

  test('re-inviting an already-parked capped address does not duplicate the entry', async () => {
    // IDEMPOTENT. getTeamInvitesFor shows `team.invited` verbatim, so every
    // duplicate is another row the owner has to make sense of — and v1's
    // array_append is unconditional, so v1 really does accumulate them.
    //
    // The second attempt is typed the way an owner actually types one — padded
    // and mixed-case — which also pins that the duplicate guard normalises. A
    // guard comparing raw strings would append a second, differently-shaped copy
    // of the same address.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      await onNTeams(ctx, ada, FREE_TEAM_LIMIT)

      const first = await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })
      const second = await invitePlayerFor(ctx, owner, { teamId, email: ADA_AS_TYPED, today })

      // The SAME outcome both times, not a `resent`: nothing was mailed the
      // first time, so there is nothing to re-send.
      expect(first).toEqual({ status: 'parked_at_cap', email: ADA })
      expect(second).toEqual({ status: 'parked_at_cap', email: ADA })

      const team = (await ctx.db.get(teamId))!
      expect(team.invited).toEqual([ADA])
      expect(team.playerIds).toEqual([owner])
    })
  })

  test('already_member wins over the cap for someone already on this team', async () => {
    // BRANCH PRECEDENCE. Someone over the cap who is ALREADY on the target team
    // must get the idempotent no-op, not a park: parking them would put their
    // address in `invited` while they sit in `playerIds`, so getTeamInvitesFor
    // would show a pending invite for a member — the exact state the add branch
    // goes out of its way to clean up.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      await ctx.db.patch(teamId, { playerIds: [owner, ada] })
      await onNTeams(ctx, ada, FREE_TEAM_LIMIT)

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: ADA, today })

      expect(outcome).toEqual({ status: 'already_member' })
      expect((await ctx.db.get(teamId))!.invited).toEqual([])
    })
  })

  test('a capped invite is parked here and released by the upgrade path', async () => {
    // THE WHOLE MECHANISM, END TO END, in one transaction: Task 8 parks, Task 6
    // releases. Split across two tests it would still pass with the two halves
    // disagreeing about what a parked entry looks like — which is exactly how a
    // matcher that forgets to normalise strands somebody forever.
    //
    // The address is parked BY THE CAP, not seeded by hand, so the release is
    // proven against what invitePlayerFor actually writes.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      await onNTeams(ctx, ada, FREE_TEAM_LIMIT)

      const outcome = await invitePlayerFor(ctx, owner, { teamId, email: ADA_AS_TYPED, today })
      expect(outcome).toEqual({ status: 'parked_at_cap', email: ADA })
      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])

      // She upgrades.
      await ctx.db.insert('playerMembership', { playerId: ada, membershipStatus: 'pro' })
      await upgradeTeamInvitesFor(ctx, ada)

      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([owner, ada])
      // ONE PATCH, TWO FIELDS: she must not read as a member AND as pending.
      expect(team.invited).toEqual([])
    })
  })
})

/**
 * A ctx whose `db.patch` calls are recorded, for the assertions that a helper
 * wrote NOTHING.
 *
 * Needed because "no write happened" is otherwise unobservable: a patch that
 * rewrites a field to an identical value leaves the document equal to what it
 * was, and Convex documents carry no update timestamp to tell the two apart.
 *
 * Works because WriterCtx is the structural type `{ db }` — the same choice
 * that lets convex-test's callback ctx satisfy these helpers with no cast lets
 * a wrapper stand in for it. Methods are bound to the real db so `this` inside
 * convex-test is never the proxy.
 */
const spyOnPatch = (ctx: TestCtx) => {
  const patches: Array<unknown> = []
  const db = new Proxy(ctx.db, {
    get: (target, prop) => {
      const value = Reflect.get(target, prop) as unknown
      if (typeof value !== 'function') return value
      const bound = (value as (...args: Array<unknown>) => unknown).bind(target)
      if (prop !== 'patch') return bound
      return (...args: Array<unknown>) => {
        patches.push(args[0])
        return bound(...args)
      }
    },
  })
  return { ctx: { db }, patches }
}

describe('cancelInviteFor / getTeamInvitesFor', () => {
  test('the owner sees pending invites EXACTLY as they are stored', async () => {
    // STRANGER_AS_TYPED is padded, and it comes back padded. Task 7 renders
    // these strings verbatim, and recognising a bad entry — telling a typo from
    // a slow responder, which is the whole point of divergence 6 — means seeing
    // the odd shape rather than a tidied copy of it. Seeded with one normal
    // entry and one odd one so a `.map(normalise)` on the way out is visible.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, {
        invited: [ADA, STRANGER_AS_TYPED],
      })

      expect(await getTeamInvitesFor(ctx, owner, teamId)).toEqual([ADA, STRANGER_AS_TYPED])
    })
  })

  test('a member who is not the owner is refused by the QUERY', async () => {
    // NOT MERELY A HIDDEN BUTTON. These are real email addresses, so the refusal
    // has to be the read itself — divergence 6 exists to give the owner a
    // surface v1 lacks, not to give every member a roster of who else was asked.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA] })
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      await ctx.db.patch(teamId, { playerIds: [owner, bob] })

      await expect(getTeamInvitesFor(ctx, bob, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  test('cancel removes the address, case-insensitively', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA, STRANGER] })

      await cancelInviteFor(ctx, owner, { teamId, email: STRANGER_AS_TYPED })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
    })
  })

  test('cancels an entry parked in a shape no write gate would strip', async () => {
    // THE TRIM HALF OF THE READ-SIDE NORMALISE, which is the half nothing else
    // guards. Both copy gates lowercase and neither trims — they map
    // `e.toLowerCase()` and nothing more — so a padded v1 address survives the
    // copy intact and reaches this filter as ' New.Person@Example.TEST '.
    // Compare the raw stored string and that invite can never be cancelled.
    //
    // The lowercase half is defence in depth rather than a live hazard, for the
    // reasons completeProfileFor sets out for this same field; the fixture is
    // mixed-case as well because it costs nothing and pins both.
    //
    // Note what the previous test does NOT prove: there the SUBMITTED address is
    // the odd one and normaliseInviteEmail has already flattened it before the
    // comparison, so a filter written `entry !== email` passes it. This fixture
    // puts the oddness on the STORED side, where only the read-side normalise
    // can reach it.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, {
        invited: [ADA, STRANGER_AS_TYPED],
      })

      await cancelInviteFor(ctx, owner, { teamId, email: STRANGER })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
    })
  })

  test('cancels EVERY entry for the address, not just the first', async () => {
    // A team can carry one address twice in two shapes: parked once before v1's
    // wordle-teams-5no fix and once after. Cancelling the first and leaving the
    // second makes the button look broken.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, {
        invited: [STRANGER_AS_TYPED, ADA, STRANGER],
      })
      const spy = spyOnPatch(ctx)

      await cancelInviteFor(spy.ctx, owner, { teamId, email: STRANGER })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
      // Doing the work in ONE patch, and — read with the next test — proof that
      // the spy sees a write when there is one to see. A spy that recorded
      // nothing either way would make the next test pass against any code at
      // all, so the two assertions are a matched pair.
      expect(spy.patches).toEqual([teamId])
    })
  })

  test('writes NOTHING when the address is not parked', async () => {
    // The mirror of removeMemberFor's early return, and for the reason that one
    // gives: any team write invalidates getMyTeams for EVERY connected client,
    // so paying that broadcast for a change that never happened is pure waste.
    // Reachable without a UI bug — cancelInvite is a public mutation and an
    // owner can submit any string — and by a double-click on a row the
    // reactive update has already removed.
    //
    // COUNTS PATCHES RATHER THAN COMPARING THE DOCUMENT, because comparing it
    // proves nothing here: the unguarded version rewrites `invited` to an
    // identical array, and Convex has no update timestamp, so the before and
    // after documents are equal whether or not a write happened. The call is
    // the only observable difference. The test above is what proves the spy is
    // not simply blind.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA] })
      const spy = spyOnPatch(ctx)

      await cancelInviteFor(spy.ctx, owner, { teamId, email: STRANGER })

      expect(spy.patches).toEqual([])
      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
    })
  })

  test('refuses an address that is not a usable one, and cancels nothing', async () => {
    // normaliseInviteEmail returns null rather than throwing, so without this
    // guard the filter would compare every entry against null and match
    // nothing. The early return then swallows it completely: no write, no
    // error, and a caller told its cancel succeeded when nothing happened.
    // The two guards have to be read together — the early return is what turns
    // a missing INVALID_EMAIL from a wasted write into a silent lie.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA] })

      await expect(
        cancelInviteFor(ctx, owner, { teamId, email: '   ' }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_EMAIL' } })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
    })
  })

  test('a member who is not the owner cannot cancel', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA] })
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      await ctx.db.patch(teamId, { playerIds: [owner, bob] })

      await expect(cancelInviteFor(ctx, bob, { teamId, email: ADA })).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
    })
  })
})

describe('teamInviteEmail', () => {
  const SIGN_IN_URL = 'https://beta.wordleteams.test/login'

  test('has all three parts, and the link in both readable ones', async () => {
    const { subject, text, html } = teamInviteEmail({
      teamName: 'The Guessers',
      inviterName: 'Cara',
      signInUrl: SIGN_IN_URL,
    })

    expect(subject).toBe('Cara invited you to The Guessers on Wordle Teams')
    // A plain-text part is not optional: some clients render it by preference,
    // and a mail with no text alternative scores worse with spam filters.
    expect(text).toContain('Cara invited you to join The Guessers')
    expect(text).toContain(SIGN_IN_URL)
    expect(html).toContain('The Guessers')
    // The link is the whole payload — there is no token, so this URL is the only
    // thing that gets the recipient anywhere.
    expect(html).toContain(`href="${SIGN_IN_URL}"`)
  })

  test('escapes the href, which is how a URL is written into HTML', async () => {
    // signInUrl is server-built from SITE_URL, so it is not user-controlled —
    // but `&` in an href is `&amp;` in HTML, and pinning it keeps the escape on
    // all three interpolations rather than two.
    const { html, text } = teamInviteEmail({
      teamName: 'The Guessers',
      inviterName: 'Cara',
      signInUrl: 'https://beta.wordleteams.test/login?next=/me&from=invite',
    })

    expect(html).toContain('href="https://beta.wordleteams.test/login?next=/me&amp;from=invite"')
    // The text part is not markup, so the reader gets a URL they can paste.
    expect(text).toContain('https://beta.wordleteams.test/login?next=/me&from=invite')
  })

  test('escapes the two user-controlled names into the HTML', async () => {
    // `teamName` is whatever the owner typed into the team form and
    // `inviterName` whatever they typed into the profile form. Both land in
    // somebody else's inbox, so neither may become markup.
    const { html } = teamInviteEmail({
      teamName: '</h1><script>alert(1)</script>',
      inviterName: '<img src=x onerror=alert(2)>',
      signInUrl: SIGN_IN_URL,
    })

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;')
  })

  test('escapes ampersands and quotes in the HTML, and leaves the text part raw', async () => {
    // TWO of each escapable character, not one. A `.replace` that lost its /g
    // flag escapes the first occurrence and leaves the rest as markup, which a
    // single-occurrence fixture cannot tell apart from a correct escape.
    const { subject, text, html } = teamInviteEmail({
      teamName: 'Ada & Bob & the "Best" "Team"',
      inviterName: "O'Hara-O'Neill",
      signInUrl: SIGN_IN_URL,
    })

    expect(html).toContain('Ada &amp; Bob &amp; the &quot;Best&quot; &quot;Team&quot;')
    expect(html).toContain('O&#39;Hara-O&#39;Neill')
    // The `&` ordering inside escapeHtml, pinned: escape it last and this reads
    // `&amp;quot;`, which renders as the literal text `&quot;`.
    expect(html).not.toContain('&amp;quot;')
    // Escaping is for the HTML part ONLY. The subject and the text part are not
    // markup, and escaping them would show the reader a literal `&amp;`.
    expect(subject).toContain('Ada & Bob & the "Best" "Team"')
    expect(text).toContain('Ada & Bob & the "Best" "Team"')
    expect(text).toContain("O'Hara-O'Neill")
  })
})
