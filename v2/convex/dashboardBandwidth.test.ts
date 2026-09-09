import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { getMyTeamsFor } from './teams'
import { unreadBadgeFor } from './chat'
import type { DataModel, Id } from './_generated/dataModel'
import type { GenericDatabaseWriter } from 'convex/server'

/**
 * WHAT AN AUTHENTICATED /app SESSION COSTS TO READ, PER EXECUTION — the GA
 * bandwidth gate of wordle-teams-qix.24, and the measurement wordle-teams-dcu has
 * wanted since Phase 3.
 *
 * WHY DOCUMENT COUNTS AND NOT THE DASHBOARD'S BYTES. qix.24 asks for the Convex
 * dashboard's database-I/O figure. It is not reachable from the CLI — `convex`
 * offers `dashboard` and `logs` and nothing else — so that number needs a human
 * with the dashboard open and belongs on the epic. What a test CAN hold still is
 * the per-execution READ COUNT, and that is the term worth holding: bytes are
 * (documents x row size x executions), and of those three only this one can
 * regress silently in a pull request.
 *
 * WHY A BOUND RATHER THAN A METER, WHICH IS THE REAL ANSWER TO qix.24's WORRY.
 * That note says unreadTeams executions are UNMETERED, so the degraded flag can
 * never trip from badge traffic and the meter reads healthy while the quota
 * drains. That is correct, and it CANNOT BE FIXED BY METERING: a Convex query's
 * `ctx.db` is a GenericDatabaseReader with no write methods, so a query
 * structurally cannot charge chargeBudget's row. chat.ts's header already argues
 * this for its other three query reads. Metering the read path is not a thing
 * that was forgotten; it is a thing the platform forbids.
 *
 * So the guard has to be a BOUNDED PER-EXECUTION COST instead, which turns an
 * unmeasurable meter into a calculable ceiling: sessions x executions x these
 * numbers. Holding these still is what makes that arithmetic trustworthy.
 *
 * EVERY NUMBER BELOW WAS MEASURED, by bisecting `transactionLimits.documentsRead`
 * until the call stopped throwing — the same method scores.test.ts's write-path
 * guard used. Each is asserted from BOTH SIDES: a ceiling alone would pass at any
 * number above the truth and would stop being a measurement.
 */

const modules = import.meta.glob('./**/*.ts')

/** The ceiling teams.ts's own comment cites: six teams, about eight members each. */
const CEILING_TEAMS = 6
const CEILING_MEMBERS = 8

/**
 * MEASURED. Six teams of eight: a six-row teams scan plus one player document per
 * member per team, 6 + 48 = 54.
 */
const ENUMERATION_READS = 54

/** MEASURED. Exactly one document per team, whatever the rosters hold. */
const BADGE_READS_PER_TEAM = 1

async function seedTeams(
  ctx: { db: GenericDatabaseWriter<DataModel> },
  teams: number,
  members: number,
): Promise<{ me: Id<'players'>; teamIds: Id<'teams'>[] }> {
  const me = await ctx.db.insert('players', aPlayer())
  const teamIds: Id<'teams'>[] = []
  for (let t = 0; t < teams; t++) {
    const roster: Id<'players'>[] = [me]
    for (let m = 1; m < members; m++) {
      roster.push(await ctx.db.insert('players', aPlayer({ email: `t${t}m${m}@example.com` })))
    }
    teamIds.push(await ctx.db.insert('teams', aTeam({ playerIds: roster })))
  }
  return { me, teamIds }
}

const withLimit = (documentsRead: number) => convexTest({ schema, modules, transactionLimits: { documentsRead } })

describe('getMyTeamsFor — the enumeration every authenticated session holds', () => {
  /**
   * THE SCAN IS UNAVOIDABLE AND IS NOT WHAT THIS GUARDS. Convex cannot index array
   * membership, so finding a player's teams means reading every team — teams.ts,
   * players.ts and winners.ts all pay it and all say so. What this holds is the
   * SHAPE of the cost: a teams scan plus the rosters, and nothing else. A change
   * that added a per-team message or score read would move it to "scan + rosters +
   * history" with no other gate noticing.
   */
  test(`costs ${ENUMERATION_READS} documents at the six-by-eight ceiling`, async () => {
    await withLimit(ENUMERATION_READS).run(async (ctx) => {
      const { me } = await seedTeams(ctx, CEILING_TEAMS, CEILING_MEMBERS)
      expect(await getMyTeamsFor(ctx, me)).toHaveLength(CEILING_TEAMS)
    })
  })

  test('and one fewer read is not enough, so the number is measured not guessed', async () => {
    await expect(
      withLimit(ENUMERATION_READS - 1).run(async (ctx) => {
        const { me } = await seedTeams(ctx, CEILING_TEAMS, CEILING_MEMBERS)
        await getMyTeamsFor(ctx, me)
      }),
    ).rejects.toThrow()
  })

  /**
   * IT SCALES WITH MEMBERS, NOT WITH TEAMS ALONE, which is the fact that decides
   * whether the ceiling above is the right one to reason about. Tripling the
   * rosters triples the reads: 6 + 144.
   */
  test('scales with total roster size', async () => {
    await withLimit(150).run(async (ctx) => {
      const { me } = await seedTeams(ctx, CEILING_TEAMS, 24)
      await getMyTeamsFor(ctx, me)
    })
    await expect(
      withLimit(149).run(async (ctx) => {
        const { me } = await seedTeams(ctx, CEILING_TEAMS, 24)
        await getMyTeamsFor(ctx, me)
      }),
    ).rejects.toThrow()
  })
})

describe('unreadBadgeFor — the live subscription /app holds open', () => {
  /**
   * THE ONE wordle-teams-w7g2 FIXED, AND THIS IS WHAT KEEPS IT FIXED. The badge
   * used to be built on getMyTeamsFor, so it inherited the whole scan plus a
   * document per member — roughly 48 player reads and a table scan to answer a
   * question whose entire output is an array of ids. It now takes the ids the
   * client already holds.
   *
   * qix.24 GUESSED THIS WAS THE DOMINANT COST — "plausibly more than everything
   * chat itself does". MEASURED, IT IS THE OPPOSITE: one document per team against
   * the enumeration's nine per team beside it. The badge is not the problem; the
   * enumeration it sits next to is, and that one predates chat entirely.
   */
  test('costs exactly one document per team', async () => {
    for (const teams of [1, 6, 12]) {
      await withLimit(teams * BADGE_READS_PER_TEAM).run(async (ctx) => {
        const { me, teamIds } = await seedTeams(ctx, teams, CEILING_MEMBERS)
        const badge = await unreadBadgeFor(ctx, me, teamIds)
        expect(badge.unread).toEqual([])
        expect(badge.degraded).toBe(false)
      })
    }
  })

  test('and one fewer is not enough at each of those sizes', async () => {
    for (const teams of [6, 12]) {
      await expect(
        withLimit(teams * BADGE_READS_PER_TEAM - 1).run(async (ctx) => {
          const { me, teamIds } = await seedTeams(ctx, teams, CEILING_MEMBERS)
          await unreadBadgeFor(ctx, me, teamIds)
        }),
      ).rejects.toThrow()
    }
  })

  /**
   * THE w7g2 REGRESSION, STATED AS A PROPERTY. If the badge ever enumerates
   * members again this is the test that fails: same team count, rosters three
   * times larger, identical budget.
   */
  test('does not grow with team SIZE, only with team COUNT', async () => {
    await withLimit(CEILING_TEAMS * BADGE_READS_PER_TEAM).run(async (ctx) => {
      const { me, teamIds } = await seedTeams(ctx, CEILING_TEAMS, 24)
      expect(await unreadBadgeFor(ctx, me, teamIds)).toMatchObject({ unread: [] })
    })
  })
})
