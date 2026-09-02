import { mutation } from './_generated/server'
import { v } from 'convex/values'
import { e2eTeamLegacyId, isE2eTraffic } from './lib/e2e.ts'

/**
 * Gives an e2e test account a team, so the dashboard clears its "not on a
 * team yet" empty state and shows the board-entry button (wt-ksh.3.11).
 *
 * A fresh signIn() account has no `players` row at all — access.ts links a
 * session to a player purely by email, and nothing in the login flow creates
 * one. board-entry.spec.ts needs both a player row AND a team that contains
 * it before the dashboard renders anything to click. This is committed
 * rather than a scratch mutation, per the same idempotent-seed shape as
 * testOtps.ts, so repeated e2e runs do not require hand-editing the backend.
 *
 * Guarded exactly like testOtps.takeFor: E2E_TEST_MODE must be 'true' (set
 * on the local dev deployment, never on production) and the email must match
 * the e2e+*@wordleteams.com pattern, so this can never create data outside a
 * throwaway test run.
 *
 * legacyId is a synthetic value here on purpose, and the schema is no longer
 * what forces it: `players.legacyId` (Phase 4) and `teams.legacyId` (Phase 3)
 * are both optional now, so omitting it would type-check. It is set anyway,
 * because ABSENCE ACQUIRED A MEANING when they were widened — schema.ts defines
 * `legacyId === undefined` as "born in v2, not copied", which is the bucket
 * Phase 7's row-count reconciliation against Supabase leans on. A seeded e2e
 * row is not a real v2 signup, so letting it fall into that bucket would
 * quietly inflate the count. A synthetic value marks the row as test data on
 * sight instead, and cannot be adopted by the copy: `e2e-<email>` is not a
 * Supabase uuid, and the teams' id comes from `e2eTeamLegacyId` in the 9e12
 * band, far outside v1's team-id range, so by_legacyId can never match either
 * one to a real Supabase row.
 *
 * THAT TEAM ID IS DERIVED FROM THE ADDRESS RATHER THAN FROM THE CLOCK, and it
 * used to be `Date.now()`. Deriving it is what lets the lookup below be an
 * indexed point read instead of a scan of the whole `teams` table — see the
 * comment at the lookup, and `wt-ksh.8.51`.
 */
export const ensureTeamFor = mutation({
  args: { email: v.string(), timeZone: v.optional(v.string()) },
  handler: async (ctx, { email, timeZone }) => {
    if (!isE2eTraffic(email, process.env.E2E_TEST_MODE)) {
      throw new Error('e2eSeed.ensureTeamFor is only available in E2E test mode for e2e+* addresses')
    }
    const lower = email.toLowerCase()

    const existingPlayer = await ctx.db
      .query('players')
      .withIndex('by_email', (q) => q.eq('email', lower))
      .first()
    const playerId =
      existingPlayer?._id ??
      (await ctx.db.insert('players', {
        legacyId: `e2e-${lower}`,
        email: lower,
        firstName: 'E2E',
        lastName: 'Tester',
        hasPwa: false,
        reminderDeliveryMethods: [],
        reminderDeliveryTime: '18:00:00',
        // Optional, and written directly rather than through
        // updateTimeZoneFor — this seed exists to put a row in a KNOWN
        // state before a test's sign-in, not to exercise that mutation's own
        // Intl validation (settings.test.ts already does). The one caller
        // that passes it (e2e/settings.spec.ts) uses it to seed a v1-style
        // Postgres spelling like 'Asia/Calcutta' — a value the settings UI's
        // own picker can never produce, since it only ever writes the IANA
        // spellings in time-zones.ts's TIME_ZONE_GROUPS, but a real COPIED
        // row carries exactly that (see time-zones.ts's timeZoneMapping).
        ...(timeZone !== undefined ? { timeZone } : {}),
      }))

    // AN INDEXED POINT READ, NOT A TABLE SCAN, AND THE DIFFERENCE IS THE FLAKE.
    // This used to be `ctx.db.query('teams').collect()` filtered in JS — fine at
    // e2e scale as a cost, but it put EVERY team in this mutation's read set, so
    // a concurrent insert by another Playwright worker invalidated it and Convex
    // retried; exhaust the retries and the mutation fails outright with
    // OptimisticConcurrencyControlFailure. Six specs call this seed, so the
    // collision rate is quadratic in callers and grew with the suite
    // (`wt-ksh.8.51`). Keying on the address makes the read set ONE document.
    //
    // IT IS ALSO THE CONTRACT THE CALLERS ALREADY ASSUMED. Every caller wants
    // "this account's OWN team" — e2e/invites.spec.ts:47 says so outright, since
    // being `owner` is what unlocks the invite controls. The old scan returned
    // ANY team whose playerIds contained the account, which after an invite flow
    // can be the INVITER's team, where this account is not the owner. So this is
    // a narrowing to what was meant, not only a cheaper lookup.
    const legacyId = e2eTeamLegacyId(lower)
    const existingTeam = await ctx.db
      .query('teams')
      .withIndex('by_legacyId', (q) => q.eq('legacyId', legacyId))
      .first()
    if (existingTeam) return existingTeam._id

    return await ctx.db.insert('teams', {
      legacyId,
      name: 'E2E Team',
      owner: playerId,
      playerIds: [playerId],
      invited: [],
      oneGuess: 5,
      twoGuesses: 3,
      threeGuesses: 2,
      fourGuesses: 1,
      fiveGuesses: 0,
      sixGuesses: -1,
      failed: -3,
      nA: 0,
      playWeekends: true,
      showLetters: true,
    })
  },
})

/**
 * Two e2e accounts, both profile-complete, on one shared team.
 *
 * wt-ksh.4.1 — the deferred Phase 2 acceptance criterion — needs two
 * authenticated sessions on the same team to prove a board entered by one
 * player pushes to another connected client's scores table with no refresh
 * (e2e/teams.spec.ts). ensureTeamFor above cannot seed this: it is called by
 * the same account that then signs in, so calling it twice — once per email —
 * creates two separate single-player teams with nothing joining them.
 *
 * Both players get firstName AND lastName up front, which as of Phase 4 the
 * schema requires anyway — players.firstName/lastName are v.string(), so a
 * nameless seed would be refused at insert rather than quietly producing a
 * team whose members never reach the scores table.
 *
 * Idempotent the same way ensureTeamFor is: found-or-created player rows, and
 * an existing team reused if one already holds both players, so repeated
 * local runs do not pile up teams.
 */
export const ensureSharedTeamFor = mutation({
  args: { emailA: v.string(), emailB: v.string() },
  handler: async (ctx, { emailA, emailB }) => {
    if (
      !isE2eTraffic(emailA, process.env.E2E_TEST_MODE) ||
      !isE2eTraffic(emailB, process.env.E2E_TEST_MODE)
    ) {
      throw new Error(
        'e2eSeed.ensureSharedTeamFor is only available in E2E test mode for e2e+* addresses',
      )
    }

    const ensurePlayer = async (email: string, firstName: string) => {
      const lower = email.toLowerCase()
      const existing = await ctx.db
        .query('players')
        .withIndex('by_email', (q) => q.eq('email', lower))
        .first()
      if (existing) return existing._id
      return await ctx.db.insert('players', {
        legacyId: `e2e-${lower}`,
        email: lower,
        firstName,
        lastName: 'E2E',
        hasPwa: false,
        reminderDeliveryMethods: [],
        reminderDeliveryTime: '18:00:00',
      })
    }

    const playerA = await ensurePlayer(emailA, 'PlayerA')
    const playerB = await ensurePlayer(emailB, 'PlayerB')

    // Indexed for the same reason ensureTeamFor above is — this is the SECOND
    // full-table read that was feeding `wt-ksh.8.51`'s OptimisticConcurrency
    // failures, and fixing only the first would have left the flake in place via
    // e2e/teams.spec.ts.
    //
    // KEYED ON THE PAIR, SORTED, so that the shared team is the same document
    // whichever order the two addresses arrive in and a caller cannot seed two
    // rival "shared" teams by swapping its arguments.
    const legacyId = e2eTeamLegacyId([emailA.toLowerCase(), emailB.toLowerCase()].sort().join('|'))
    const existing = await ctx.db
      .query('teams')
      .withIndex('by_legacyId', (q) => q.eq('legacyId', legacyId))
      .first()
    if (existing) return existing._id

    return await ctx.db.insert('teams', {
      legacyId,
      name: 'E2E Live Update Team',
      owner: playerA,
      playerIds: [playerA, playerB],
      invited: [],
      oneGuess: 5,
      twoGuesses: 3,
      threeGuesses: 2,
      fourGuesses: 1,
      fiveGuesses: 0,
      sixGuesses: -1,
      failed: -3,
      nA: 0,
      playWeekends: true,
      showLetters: true,
    })
  },
})
