import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { consumeLinkFor, createLinkFor, revokeLinkFor } from './inviteLinks.ts'
import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'

const modules = import.meta.glob('./**/*.ts')

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

      await consumeLinkFor(ctx, joiner, token)

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
      await consumeLinkFor(ctx, ada, token)
      await consumeLinkFor(ctx, ada, token)

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

      await consumeLinkFor(ctx, ada, token)

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

      await consumeLinkFor(ctx, returner, token)

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

      await expect(consumeLinkFor(ctx, late, token)).rejects.toMatchObject({
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

      await expect(consumeLinkFor(ctx, who, token)).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada])
    })
  })

  test('refuses an unknown token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const nobody = await ctx.db.insert('players', aPlayer({ email: 'nobody@example.com' }))
      await expect(consumeLinkFor(ctx, nobody, 'deadbeef')).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
    })
  })

  test('refuses a link whose team is gone', async () => {
    // A FOURTH DEAD STATE, and it is reachable: cascadeDeleteTeam (teams.ts)
    // does not collect inviteLinks rows, so deleting a team leaves every link
    // it issued dangling. Folded into the same refusal as the other three — it
    // gives the holder nothing different to do, and answering differently
    // would tell a stranger that this team once existed.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      await ctx.db.delete(teamId)
      const who = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.com' }))

      await expect(consumeLinkFor(ctx, who, token)).rejects.toMatchObject({
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
          await consumeLinkFor(ctx, stranger, token)
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

      await expect(consumeLinkFor(ctx, capped, token)).rejects.toMatchObject({
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

      await consumeLinkFor(ctx, joiner, token)
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

      await consumeLinkFor(ctx, pro, token)
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada, pro])
    })
  })
})
