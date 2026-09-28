import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { consumeLinkFor, createLinkFor, revokeLinkFor } from './inviteLinks.ts'
import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'
import { toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')

/**
 * `consumeLinkFor` recomputes the joined team's months, so it needs a date the
 * same way every other membership change does. The helper itself does not bound
 * it — `consumeLink`, the mutation, does that with requirePlausibleToday — so
 * these tests hand it whatever day they mean.
 */
const today = toPuzzleDay(new Date())

describe('createLinkFor', () => {
  test('stores a live row and returns its token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      const token = await createLinkFor(ctx, ada, teamId)
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThanOrEqual(32)

      const rows = await ctx.db.query('inviteLinks').collect()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ teamId, token, createdBy: ada })
      expect(rows[0].revokedAt).toBeUndefined()
      expect(rows[0].expiresAt).toBeGreaterThan(Date.now())
    })
  })

  test('two links never collide', async () => {
    // THIS TEST IS THE POINT OF THE TASK. Nothing else in convex/ uses randomness,
    // so nothing in this repo demonstrates what the runtime permits inside a
    // mutation. If the generator is not actually random, this fails loudly here
    // rather than shipping guessable capability URLs.
    //
    // WHAT IT DOES NOT PROVE: distinctness is not unguessability. A counter
    // (`token = String(i++)`) passes this test — verified by planting exactly
    // that mutant — and would be catastrophic here, because the token is a
    // capability read on a pre-auth path. No test in this file can prove
    // unguessability; that property rests on crypto.getRandomValues being the
    // source, which is a code review obligation, not a covered assertion.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      const tokens = new Set<string>()
      for (let i = 0; i < 25; i++) tokens.add(await createLinkFor(ctx, ada, teamId))
      expect(tokens.size).toBe(25)
    })
  })

  test('a member who does not own the team cannot create one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await expect(createLinkFor(ctx, bob, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  test('a stranger to the team cannot create one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await expect(createLinkFor(ctx, outsider, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})

describe('revokeLinkFor', () => {
  test('stamps revokedAt', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      await revokeLinkFor(ctx, ada, token)
      const [row] = await ctx.db.query('inviteLinks').collect()
      expect(row.revokedAt).toBeGreaterThan(0)
    })
  })

  test('a non-owner cannot revoke', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      await expect(revokeLinkFor(ctx, bob, token)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  test('an unknown token is refused as INVITE_LINK_INVALID', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await expect(revokeLinkFor(ctx, ada, 'nosuchtoken')).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
    })
  })
})

describe('consumeLinkFor', () => {
  test('puts the holder on the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      const joiner = await ctx.db.insert('players', aPlayer({ email: 'joiner@example.com' }))

      await consumeLinkFor(ctx, joiner, token, today)

      const team = await ctx.db.get(teamId)
      expect(team?.playerIds).toEqual([ada, joiner])
    })
  })

  test('is idempotent for someone already on the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      // The owner following their own link must not be added twice — a duplicate
      // id shows the person twice on the team card and enters them twice in the
      // month recompute. teams.ts:266 records the same hazard on the email path.
      await consumeLinkFor(ctx, ada, token, today)
      await consumeLinkFor(ctx, ada, token, today)

      const team = await ctx.db.get(teamId)
      expect(team?.playerIds).toEqual([ada])
    })
  })

  test('an already-member pass leaves a live chat cursor alone', async () => {
    // The other half of idempotence, and the one no roster assertion can see.
    // resetChatCursorFor DELETES the row, so running it on a current member
    // would mark a conversation they have been reading all along unread —
    // exactly the line players.ts draws with its `if (!alreadyMember)`.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      await ctx.db.insert('chatReads', { playerId: ada, teamId, lastReadAt: 1234 })

      await consumeLinkFor(ctx, ada, token, today)

      const cursors = await ctx.db.query('chatReads').collect()
      expect(cursors).toHaveLength(1)
      expect(cursors[0].lastReadAt).toBe(1234)
    })
  })

  test('clears a returning member stale chat cursor', async () => {
    // A previous stint on this team leaves a chatReads row behind — removal
    // never cleans one up, deliberately — and it says they have read everything
    // up to the day they left. Rejoining on top of it means no unread badge for
    // anything said while they were gone. players.ts:262 does the same on the
    // email path; this is the fourth add path and owes the same.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      const returner = await ctx.db.insert('players', aPlayer({ email: 'back@example.com' }))
      await ctx.db.insert('chatReads', { playerId: returner, teamId, lastReadAt: 1234 })

      await consumeLinkFor(ctx, returner, token, today)

      expect(await ctx.db.query('chatReads').collect()).toHaveLength(0)
    })
  })

  test('refuses an expired link', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      const [link] = await ctx.db.query('inviteLinks').collect()
      await ctx.db.patch(link._id, { expiresAt: Date.now() - 1 })
      const late = await ctx.db.insert('players', aPlayer({ email: 'late@example.com' }))

      await expect(consumeLinkFor(ctx, late, token, today)).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada])
    })
  })

  test('refuses a revoked link', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      await revokeLinkFor(ctx, ada, token)
      const who = await ctx.db.insert('players', aPlayer({ email: 'revoked@example.com' }))

      await expect(consumeLinkFor(ctx, who, token, today)).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada])
    })
  })

  test('refuses an unknown token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const nobody = await ctx.db.insert('players', aPlayer({ email: 'nobody@example.com' }))
      await expect(consumeLinkFor(ctx, nobody, 'deadbeef', today)).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
    })
  })

  test('refuses a link whose team is gone', async () => {
    // A FOURTH DEAD STATE, folded into the same refusal as the other three: it
    // gives the holder nothing different to do, and answering differently would
    // tell a stranger that this team once existed.
    //
    // IT IS NO LONGER REACHABLE THROUGH THE PRODUCT, and this test is written
    // so that it does not care. It used to be: cascadeDeleteTeam did not
    // collect inviteLinks, so deleting a team left every link dangling
    // (wordle-teams-2c1u). It sweeps them now. The `ctx.db.delete(teamId)`
    // below is therefore deliberately RAW rather than a call to deleteTeamFor —
    // it manufactures the orphan directly, which is what keeps this a test of
    // consumeLinkFor's guard rather than a second, weaker test of the cascade.
    // teams.test.ts owns the cascade itself.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      await ctx.db.delete(teamId)
      const who = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.com' }))

      await expect(consumeLinkFor(ctx, who, token, today)).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
    })
  })

  test('answers every dead-link state with one indistinguishable refusal', async () => {
    // THE PROPERTY ITSELF, asserted as an equality rather than as four separate
    // literals, because the literals are what a future edit changes one of.
    // This path is reachable BEFORE sign-in, so distinguishing "revoked" from
    // "expired" from "the team is gone" from "never existed" tells a stranger
    // which tokens once existed. It does NOT inherit this from revokeLinkFor,
    // whose two refusals ARE distinguishable — see the comment there.
    //
    // The cap refusal is deliberately NOT in this set: a legitimate holder
    // blocked by the free-tier cap can act on it, and telling them to upgrade
    // is the point.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const stranger = await ctx.db.insert('players', aPlayer({ email: 's@example.com' }))
      const mkTeam = async () =>
        await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      const expiredTeam = await mkTeam()
      const expired = await createLinkFor(ctx, ada, expiredTeam)
      const expiredRow = await ctx.db
        .query('inviteLinks')
        .withIndex('by_token', (q) => q.eq('token', expired))
        .unique()
      await ctx.db.patch(expiredRow!._id, { expiresAt: Date.now() - 1 })

      const revokedTeam = await mkTeam()
      const revoked = await createLinkFor(ctx, ada, revokedTeam)
      await revokeLinkFor(ctx, ada, revoked)

      const goneTeam = await mkTeam()
      const gone = await createLinkFor(ctx, ada, goneTeam)
      await ctx.db.delete(goneTeam)

      const refusalFor = async (token: string) => {
        try {
          await consumeLinkFor(ctx, stranger, token, today)
        } catch (error) {
          return (error as { data: unknown }).data
        }
        throw new Error(`consumeLinkFor unexpectedly accepted ${token}`)
      }

      // ANCHORED FIRST. Without this line the three equalities below are
      // satisfied by four IDENTICAL non-refusals — `undefined === undefined`
      // passes just as well, and did: this test was green against a
      // consumeLinkFor that did not exist yet, because every call threw the
      // same TypeError. Pinning the baseline to the real code is what makes
      // the equalities mean what they say.
      const unknown = await refusalFor('nosuchtokenatall')
      expect(unknown).toEqual({ code: 'INVITE_LINK_INVALID' })
      expect(await refusalFor(expired)).toEqual(unknown)
      expect(await refusalFor(revoked)).toEqual(unknown)
      expect(await refusalFor(gone)).toEqual(unknown)
    })
  })

  test('REFUSES a non-pro joiner already at the free team cap', async () => {
    // THE HOLE THIS CLOSES. completeProfileFor enforces FREE_TEAM_LIMIT during
    // its invited-scan and invitePlayerFor enforces it when parking an address.
    // A link join runs NEITHER, so without this check the link bypasses the cap
    // entirely.
    //
    // And note the behavioural difference from the email path, which is
    // deliberate: an email invite over the cap PARKS the address for a later
    // upgrade. A link cannot park, so it must refuse.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      const capped = await ctx.db.insert('players', aPlayer({ email: 'capped@example.com' }))
      // DERIVED FROM THE CONSTANT, never a literal 2: a test written against a
      // literal keeps passing straight through a change to the cap, which
      // lib/teamLimits.ts calls out explicitly.
      for (let i = 0; i < FREE_TEAM_LIMIT; i++) {
        await ctx.db.insert('teams', aTeam({ name: `existing ${i}`, playerIds: [capped] }))
      }

      await expect(consumeLinkFor(ctx, capped, token, today)).rejects.toMatchObject({
        data: { code: 'TEAM_LIMIT_REACHED' },
      })
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada])
    })
  })

  test('lets a non-pro joiner one team below the cap in', async () => {
    // THE OTHER SIDE OF THE SAME BOUNDARY. Without this, `mine >= 0` would pass
    // the refusal test above just as well and lock everybody out.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      const joiner = await ctx.db.insert('players', aPlayer({ email: 'nearly@example.com' }))
      for (let i = 0; i < FREE_TEAM_LIMIT - 1; i++) {
        await ctx.db.insert('teams', aTeam({ name: `existing ${i}`, playerIds: [joiner] }))
      }

      await consumeLinkFor(ctx, joiner, token, today)
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada, joiner])
    })
  })

  test('lets a PRO joiner past the free cap in', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      const pro = await ctx.db.insert('players', aPlayer({ email: 'pro@example.com' }))
      await ctx.db.insert('playerMembership', { playerId: pro, membershipStatus: 'pro' })
      for (let i = 0; i < FREE_TEAM_LIMIT + 1; i++) {
        await ctx.db.insert('teams', aTeam({ name: `existing ${i}`, playerIds: [pro] }))
      }

      await consumeLinkFor(ctx, pro, token, today)
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada, pro])
    })
  })
})

describe('consumeLinkFor — the joined team’s aggregate (wordle-teams-c5ry)', () => {
  /** A board scoring `guesses.length` attempts, on the given day. */
  const aScore = (playerId: string, puzzleDay: string, guesses: Array<string>) => ({
    playerId: playerId as never,
    puzzleDay,
    date: 1_755_500_000_000,
    answer: 'SPEED',
    guesses,
  })

  test('a board entered BEFORE the join is in the team’s aggregate immediately after it', async () => {
    // THE USER-VISIBLE SHAPE OF THE BUG, and the reason this is a join-then-read
    // test rather than a sweep test. A free player enters today's board, then
    // follows an invite link. /insights resolves to the new team, reads exactly
    // one document — teamMonthStats — and dailyTeamFact answers 'no-board' if
    // the joiner is not in it, so DailyTeamFact renders NOTHING: no card, and
    // therefore no team picker either, on a brand-new member's first visit.
    //
    // It used to heal on the next board write by any member, or at the 00:45 UTC
    // teamStats.sweep. Neither is a fix; both are a window that can last most of
    // a day.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      const joiner = await ctx.db.insert('players', aPlayer({ email: 'joiner@example.com' }))
      await ctx.db.insert('dailyScores', aScore(joiner, today, ['CRANE', 'SPEED']))

      await consumeLinkFor(ctx, joiner, token, today)

      const month = today.slice(0, 7)
      const [year, monthNum] = month.split('-').map(Number)
      const stats = await ctx.db
        .query('teamMonthStats')
        .withIndex('by_team_year_month', (q) =>
          q.eq('teamId', teamId).eq('year', year).eq('month', monthNum),
        )
        .unique()

      expect(stats).not.toBeNull()
      expect(stats!.members.map((m) => m.playerId)).toContain(joiner)
      const day = stats!.days.find((d) => d.puzzleDay === today)
      expect(day?.entries.map((e) => e.playerId)).toContain(joiner)
    })
  })

  test('a month the team has NO winner row for still gets its aggregate', async () => {
    // monthsWithWinners alone does not answer this, which is why the join
    // recompute carries a second, wider bound. A team that never crowned a month
    // has no row to enumerate, so a joiner who played all of that month would
    // have stayed invisible in it forever — and insights.ts's teamMonth treats a
    // missing aggregate as an EMPTY MONTH, so it reads as "nobody played".
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      const joiner = await ctx.db.insert('players', aPlayer({ email: 'history@example.com' }))
      await ctx.db.insert('dailyScores', aScore(joiner, '2026-03-04', ['CRANE', 'SPEED']))

      expect(await ctx.db.query('monthlyWinners').collect()).toHaveLength(0)

      await consumeLinkFor(ctx, joiner, token, today)

      const stats = await ctx.db
        .query('teamMonthStats')
        .withIndex('by_team_year_month', (q) =>
          q.eq('teamId', teamId).eq('year', 2026).eq('month', 3),
        )
        .unique()
      expect(stats).not.toBeNull()
      const day = stats!.days.find((d) => d.puzzleDay === '2026-03-04')
      expect(day?.entries.map((e) => e.playerId)).toEqual([joiner])
    })
  })

  test('does NOT crown the joiner in a month the team never had a winner for', async () => {
    // THE OTHER HALF OF THAT ASYMMETRY, and the one that keeps this a bug fix
    // rather than a product change. Statistics are recomputed wide because the
    // stored total is simply wrong; WINNERS keep the narrow monthsWithWinners
    // bound the email path has always had, so a brand-new member does not walk
    // in holding last March's trophy. players.ts records the same rule.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      const joiner = await ctx.db.insert('players', aPlayer({ email: 'ringer@example.com' }))
      await ctx.db.insert('dailyScores', aScore(joiner, '2026-03-04', ['SPEED']))

      await consumeLinkFor(ctx, joiner, token, today)

      expect(await ctx.db.query('monthlyWinners').collect()).toHaveLength(0)
    })
  })

  test('recomputes a month the team DOES have a winner row for, joiner included', async () => {
    // The narrow bound is not nothing: a month already crowned is recomputed in
    // full, winner and statistics both, because the joiner was excluded from
    // every computation that produced the existing row.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      // Ada owns March with a four-guess solve (1 point).
      await ctx.db.insert('dailyScores', aScore(ada, '2026-03-04', ['CRANE', 'SLATE', 'SPELL', 'SPEED']))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 3,
        hasSeenCelebration: [],
      })

      // The joiner solved the same day in one (5 points), so the recompute must
      // hand them the month once they are on the roster.
      const joiner = await ctx.db.insert('players', aPlayer({ email: 'better@example.com' }))
      await ctx.db.insert('dailyScores', aScore(joiner, '2026-03-04', ['SPEED']))

      await consumeLinkFor(ctx, joiner, token, today)

      const rows = await ctx.db.query('monthlyWinners').collect()
      expect(rows).toHaveLength(1)
      expect(rows[0].playerId).toBe(joiner)
    })
  })

  test('an already-member pass recomputes nothing', async () => {
    // The idempotent early return is ABOVE the recompute, and has to stay there:
    // the owner following their own link must not pay a full month rollup per
    // click. A stale aggregate planted here survives untouched.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      await ctx.db.insert('dailyScores', aScore(ada, '2026-03-04', ['SPEED']))
      const stale = await ctx.db.insert('teamMonthStats', {
        teamId,
        year: 2026,
        month: 3,
        members: [],
        days: [],
        computedAt: 1,
      })

      await consumeLinkFor(ctx, ada, token, today)

      expect(await ctx.db.get(stale)).toMatchObject({ members: [], days: [], computedAt: 1 })
    })
  })
})
