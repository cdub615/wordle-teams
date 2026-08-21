import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { getMyTeamsFor } from './teams.ts'
import { toPuzzleDay } from './lib/puzzleDay.ts'
import {
  createTeamFor,
  deleteTeamFor,
  invitePlayerFor,
  removeMemberFor,
  updateTeamFor,
} from './teams.ts'
import { teamInviteEmail } from './inviteEmails.ts'
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
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, ghost], creator: ada }))
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

describe('removeMemberFor', () => {
  test('removes the member from playerIds', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      await removeMemberFor(ctx, ada, { teamId, playerId: bob, today })

      expect((await ctx.db.get(teamId))!.playerIds).toEqual([ada])
    })
  })

  test('recomputes EVERY month the team has a winner row for', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))
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

  test('refuses to remove the creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      await expect(
        removeMemberFor(ctx, ada, { teamId, playerId: ada, today }),
      ).rejects.toMatchObject({ data: { code: 'CREATOR_NOT_REMOVABLE' } })
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([ada, bob])
    })
  })

  test('refuses a member who is not the creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const carol = await ctx.db.insert('players', aPlayer({ email: 'carol@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob, carol], creator: ada }))

      await expect(
        removeMemberFor(ctx, bob, { teamId, playerId: carol, today }),
      ).rejects.toMatchObject({ data: { code: 'NOT_TEAM_CREATOR' } })
    })
  })

  test('no-ops when the target player is not on the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const carol = await ctx.db.insert('players', aPlayer({ email: 'carol@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))
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

  test('leaves the removed player’s boards intact', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))
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

/**
 * The invite fixtures. `.test` addresses only — this repository is public.
 *
 * ADA_AS_TYPED is the same address as ADA, padded and mixed-case, in the shape a
 * creator actually types or pastes one. STRANGER is nobody's account.
 */
const CREATOR = 'creator@example.test'
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
  const creator = await ctx.db.insert(
    'players',
    aPlayer({ email: CREATOR, firstName: 'Cara', lastName: 'Creator' }),
  )
  const teamId = await ctx.db.insert(
    'teams',
    aTeam({ name: 'The Guessers', playerIds: [creator], creator, ...over }),
  )
  return { creator, teamId }
}

describe('invitePlayerFor', () => {
  test('adds an existing player straight to the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))

      const outcome = await invitePlayerFor(ctx, creator, { teamId, email: ADA, today })

      // toEqual, not toMatchObject: the ABSENCE of email/teamName is the thing
      // that stops the wrapper mailing anybody. v1 sends no mail when an
      // existing player is added directly — they simply find themselves on the
      // team next time they look — and that parity is kept deliberately.
      // firstName is Ada's, not the inviter's, which is why the two fixtures
      // have different names.
      expect(outcome).toEqual({ status: 'added', firstName: 'Ada' })

      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([creator, ada])
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
      const { creator, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))

      const outcome = await invitePlayerFor(ctx, creator, { teamId, email: ADA_AS_TYPED, today })

      expect(outcome).toEqual({ status: 'added', firstName: 'Ada' })
      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([creator, ada])
      expect(team.invited).toEqual([])
    })
  })

  test('reports already_member and changes nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      await ctx.db.patch(teamId, { playerIds: [creator, ada] })

      const outcome = await invitePlayerFor(ctx, creator, { teamId, email: ADA_AS_TYPED, today })

      // Nothing happened, and it says so. v1 logged this branch and then told
      // the creator "Successfully invited player" — divergence 9.
      expect(outcome).toEqual({ status: 'already_member' })
      const team = (await ctx.db.get(teamId))!
      // Not appended a second time, which would show Ada twice on the team card
      // and enter her twice in the month's candidate list.
      expect(team.playerIds).toEqual([creator, ada])
      expect(team.invited).toEqual([])
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
      const { creator, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      await ctx.db.patch(teamId, { playerIds: [creator, ada] })
      await ctx.db.insert('dailyScores', aScore(ada, '2025-06-03', ['SPEED']))
      const stale = await ctx.db.insert('monthlyWinners', {
        playerId: creator,
        teamId,
        year: 2025,
        month: 6,
        hasSeenCelebration: [creator],
      })

      await invitePlayerFor(ctx, creator, { teamId, email: ADA, today })

      const row = (await ctx.db.get(stale))!
      expect(row.playerId).toBe(creator)
      expect(row.hasSeenCelebration).toEqual([creator])
    })
  })

  test('parks an unknown address in invited, lowercased and trimmed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx)

      const outcome = await invitePlayerFor(ctx, creator, {
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
      expect(team.playerIds).toEqual([creator])
    })
  })

  test('reports resent for an address already invited, without duplicating it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx, { invited: [STRANGER] })

      const outcome = await invitePlayerFor(ctx, creator, { teamId, email: STRANGER, today })

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
    // remove anyway, leaving a creator staring at a pending invite for somebody
    // who has already joined.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx, { invited: [STRANGER_AS_TYPED] })

      const outcome = await invitePlayerFor(ctx, creator, { teamId, email: STRANGER, today })

      expect(outcome).toMatchObject({ status: 'resent', email: STRANGER })
      // Untouched — a resend writes nothing at all, so the odd row is neither
      // repaired nor duplicated.
      expect((await ctx.db.get(teamId))!.invited).toEqual([STRANGER_AS_TYPED])
    })
  })

  test('rejects a malformed address and writes nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx)

      await expect(
        invitePlayerFor(ctx, creator, { teamId, email: 'not-an-email', today }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_EMAIL' } })

      const team = (await ctx.db.get(teamId))!
      expect(team.invited).toEqual([])
      expect(team.playerIds).toEqual([creator])
    })
  })

  test('falls back to an anonymous inviter when the creator’s row is gone', async () => {
    // Convex ids are not foreign keys, so a `playerIds` entry — including the
    // creator's — can outlive the row it names, the same state getMyTeamsFor and
    // recomputeTeamMonth both guard. requireTeamCreatorFor still passes, because
    // it only compares ids. Without the fallback the subject line would read
    // "undefined invited you"; with it the mail is merely anonymous, which is
    // what v1's Supabase template always was.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx)
      await ctx.db.delete(creator)

      const outcome = await invitePlayerFor(ctx, creator, { teamId, email: STRANGER, today })

      expect(outcome).toMatchObject({ status: 'invited', inviterName: 'Someone' })
    })
  })

  test('refuses a today the server clock cannot believe', async () => {
    // `today` decides which missed days are already due, and this mutation
    // writes it into a monthlyWinners row the whole team reads — the same reason
    // every other mutation that feeds one into recomputation bounds it.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx)

      await expect(
        invitePlayerFor(ctx, creator, { teamId, email: STRANGER, today: '1999-01-01' }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })

      expect((await ctx.db.get(teamId))!.invited).toEqual([])
    })
  })

  test('refuses a member who is not the creator', async () => {
    // Divergence 4: v1's RLS lets any member UPDATE the team, so any member can
    // invite. v2 makes the UI's creator-only rule the real one.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx)
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      await ctx.db.patch(teamId, { playerIds: [creator, bob] })

      await expect(
        invitePlayerFor(ctx, bob, { teamId, email: STRANGER, today }),
      ).rejects.toMatchObject({ data: { code: 'NOT_TEAM_CREATOR' } })

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
      const { creator, teamId } = await aTeamOwnedByCara(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA, firstName: 'Ada' }))
      // Cara solved in four (1 point) in each month; Ada solved in one (5).
      // Every other day of both months scores the team's nA, which is 0, so each
      // month is decided by these two boards alone whatever date this runs on.
      for (const puzzleDay of ['2025-06-03', '2025-07-03']) {
        await ctx.db.insert(
          'dailyScores',
          aScore(creator, puzzleDay, ['CRANE', 'SLATE', 'SPELL', 'SPEED']),
        )
        await ctx.db.insert('dailyScores', aScore(ada, puzzleDay, ['SPEED']))
      }
      // The stale rows: Cara won both months because Ada was not on the roster
      // when they were computed, and she has already dismissed the confetti.
      const stale = []
      for (const month of [6, 7]) {
        stale.push(
          await ctx.db.insert('monthlyWinners', {
            playerId: creator,
            teamId,
            year: 2025,
            month,
            hasSeenCelebration: [creator],
          }),
        )
      }

      await invitePlayerFor(ctx, creator, { teamId, email: ADA, today })

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
    // `teamName` is whatever the creator typed into the team form and
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
