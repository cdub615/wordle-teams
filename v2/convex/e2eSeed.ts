import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { e2eTeamLegacyId, isE2eTraffic } from './lib/e2e.ts'
import { rollupTeamMonth } from './teamStats.ts'

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

/**
 * The timeZone stored on an e2e account's `players` row, or null if it has none
 * yet. A READ, and the only one in this file.
 *
 * WHY IT EXISTS (wordle-teams-h1rg). useLocalCapture writes the browser's zone
 * after mount, and it is SILENT BY DESIGN — no toast, no spinner, no disabled
 * control — so a test has nothing in the UI to wait on and must instead absorb
 * the whole chain (auth handshake, mySettings resolving, the mutation, the
 * invalidation, the re-render) inside one assertion's timeout. That assertion
 * flaked about one CI run in four and, once e2e became a deploy gate, blocked
 * deploys for changes that could not have caused it.
 *
 * This makes the precondition WAITABLE: poll until the row actually has a zone,
 * then assert what the picker shows. The race is gone rather than padded, and
 * the assertion it protects stays at the suite's strict default.
 *
 * IT DOES NOT WEAKEN THE TEST IT SERVES. The thing that test exists to catch is
 * `useLocalCapture()` being deleted from Header.tsx — after which nothing ever
 * writes a zone, this query returns null forever, and the poll fails instead of
 * the assertion. The failure simply arrives with the right name on it.
 *
 * Guarded exactly like ensureTeamFor above and testOtps.takeFor: E2E_TEST_MODE
 * must be 'true' AND the address must be e2e+*@wordleteams.com, so it can never
 * read a real person's row — and on production, where the flag is not set, it is
 * inert whatever it is called with.
 */
export const timeZoneFor = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (!isE2eTraffic(email, process.env.E2E_TEST_MODE)) {
      throw new Error('e2eSeed.timeZoneFor is only available in E2E test mode for e2e+* addresses')
    }
    const player = await ctx.db
      .query('players')
      .withIndex('by_email', (q) => q.eq('email', email.toLowerCase()))
      .first()
    return player?.timeZone ?? null
  },
})

/**
 * Gives an e2e account the boards, tier and trial clock the insights specs need.
 *
 * WHY THIS EXISTS AT ALL: the four gates do not cross HTTP, and the insights
 * paywall is precisely a boundary crossing (the spec's testing section says so).
 * Proving it needs an account that is really pro, or really mid-trial, on a real
 * deployment — and until now nothing here could make one. billing.spec.ts records
 * the absence: "no comp-pro seed mutation convex/e2eSeed.ts does not have".
 *
 * Guarded identically to ensureTeamFor above: E2E_TEST_MODE must be 'true' and
 * the address must match e2e+*@wordleteams.com, so it can never touch a real
 * account. Read that function's comment for why that pair is sufficient.
 *
 * IT SETS THE TRIAL DIRECTLY RATHER THAN ENTERING BOARDS TO EARN ONE, and that
 * is deliberate rather than a shortcut. LAUNCH_AT is a 2099 placeholder
 * (lib/insightsAccess.ts), so no board a test could enter would ever start a
 * trial — and a spec that reached through upsertBoardFor would silently assert
 * nothing the day the owner sets the real date. The clock's own rules are proven
 * against real documents in convex/insightsTrial.test.ts; what this exists to set
 * up is the STATE, so the paywall can be crossed at HTTP.
 *
 * IDEMPOTENT, like every seed here: boards are keyed on (player, puzzleDay) and
 * patched rather than inserted twice, so a re-run does not manufacture the
 * duplicate pairs wordle-teams-rac describes.
 */
export const seedInsightsFor = mutation({
  args: {
    email: v.string(),
    /** How many consecutive boards to seed, ending on `lastDay`. */
    boards: v.number(),
    /** The most recent puzzle day to seed, 'YYYY-MM-DD'. */
    lastDay: v.string(),
    pro: v.boolean(),
    /** Epoch ms, or omitted for no trial. Past values make an EXPIRED trial. */
    trialEndsAt: v.optional(v.number()),
  },
  handler: async (ctx, { email, boards, lastDay, pro, trialEndsAt }) => {
    if (!isE2eTraffic(email, process.env.E2E_TEST_MODE)) {
      throw new Error(
        'e2eSeed.seedInsightsFor is only available in E2E test mode for e2e+* addresses',
      )
    }
    const lower = email.toLowerCase()
    const player = await ctx.db
      .query('players')
      .withIndex('by_email', (q) => q.eq('email', lower))
      .first()
    if (!player) throw new Error('seedInsightsFor: call ensureTeamFor first')

    await ctx.db.patch(player._id, { insightsTrialEndsAt: trialEndsAt })

    const membership = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', player._id))
      .first()
    const membershipStatus = pro ? 'pro' : 'new'
    if (membership) await ctx.db.patch(membership._id, { membershipStatus })
    else await ctx.db.insert('playerMembership', { playerId: player._id, membershipStatus })

    const end = Date.UTC(...isoParts(lastDay))
    for (let i = 0; i < boards; i++) {
      const puzzleDay = isoOf(end - i * 86_400_000)
      // Two openers, so the Layer 2 headline has something to compare against —
      // headlineComparison returns null with one, by design.
      const guesses = i % 3 === 0 ? ['ORATE', 'SPEED'] : ['CRANE', 'MOIST', 'SPEED']
      const existing = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) =>
          q.eq('playerId', player._id).eq('puzzleDay', puzzleDay),
        )
        .first()
      // `date` ASCENDS WITH THE PUZZLE DAY so the newest board is also the most
      // recently ENTERED one — which is what the free view selects on, and what
      // these specs are asserting.
      const date = end - i * 86_400_000
      if (existing) await ctx.db.patch(existing._id, { guesses, answer: 'SPEED', date })
      else
        await ctx.db.insert('dailyScores', {
          playerId: player._id,
          puzzleDay,
          date,
          answer: 'SPEED',
          guesses,
        })
    }

    return { playerId: player._id, boards }
  },
})

function isoParts(day: string): [number, number, number] {
  const [year, month, date] = day.split('-').map(Number)
  return [year, month - 1, date]
}

function isoOf(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10)
}

/**
 * A board on one specific day for one e2e account, so the free team fact has
 * something to say.
 *
 * SEPARATE FROM seedInsightsFor because the two answer different questions.
 * That one gives a player a HISTORY — a run of consecutive boards ending on a
 * chosen day — which is what Layers 1 and 2 need. This one places a SINGLE board
 * on a single day at a chosen score, which is what a comparison between teammates
 * needs: the fact under test is "you beat two of three teammates today", and
 * producing it means controlling who played today and how well.
 *
 * IT ALSO ROLLS THE MONTH UP, because the fact reads B1's aggregate rather than
 * dailyScores — a seeded board that never reached the aggregate would leave the
 * panel correctly saying nothing, and the spec would pass while proving the
 * opposite of what it claims. rollupTeamMonth is idempotent, so calling it once
 * per seeded board is free beyond the first.
 *
 * Guarded exactly like the seeds above: E2E_TEST_MODE and an e2e+* address.
 */
export const seedTeamDayFor = mutation({
  args: { email: v.string(), puzzleDay: v.string(), attempts: v.number() },
  handler: async (ctx, { email, puzzleDay, attempts }) => {
    if (!isE2eTraffic(email, process.env.E2E_TEST_MODE)) {
      throw new Error('e2eSeed.seedTeamDayFor is only available in E2E test mode for e2e+* addresses')
    }
    const lower = email.toLowerCase()
    const player = await ctx.db
      .query('players')
      .withIndex('by_email', (q) => q.eq('email', lower))
      .first()
    if (!player) throw new Error('seedTeamDayFor: call ensureTeamFor first')

    // `attempts` guesses ending on the answer, so attemptsFor reports exactly it.
    const guesses = ['CRANE', ...Array.from({ length: attempts - 2 }, () => 'MOIST'), 'SPEED'].slice(
      0,
      attempts,
    )
    const existing = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', player._id).eq('puzzleDay', puzzleDay),
      )
      .first()
    if (existing) await ctx.db.patch(existing._id, { guesses, answer: 'SPEED' })
    else
      await ctx.db.insert('dailyScores', {
        playerId: player._id,
        puzzleDay,
        date: Date.now(),
        answer: 'SPEED',
        guesses,
      })

    const month = puzzleDay.slice(0, 7)
    for (const team of await ctx.db.query('teams').collect()) {
      if (team.playerIds.includes(player._id)) await rollupTeamMonth(ctx, team, month)
    }

    return { puzzleDay, attempts }
  },
})
