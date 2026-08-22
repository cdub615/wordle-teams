import { internalMutation, internalQuery } from './_generated/server'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

// Write side of the Supabase -> Convex copy. The reader lives outside Convex, in
// scripts/copy-from-supabase.mjs, because pulling from Supabase would otherwise
// put a service-role key into the Convex deployment and couple the two systems.
//
// EVERY WRITE IS AN UPSERT KEYED ON legacyId. The copy is not a one-shot: it runs
// for the owner's teams now, for everyone at the Phase 7 parity audit, and once
// more inside the cutover window. Running it twice must be indistinguishable from
// running it once.
//
// These are internal functions, so nothing on the public API surface can write
// to them. The script reaches them with ConvexHttpClient.setAdminAuth and the
// deploy key.

// REFERENCED, JUST NOT IN A WAY no-unused-vars CAN SEE — the `@see {@link
// chunkNote}` tag below resolves to it, so deleting the constant would leave
// that tag dangling. The rule only reads value positions, not JSDoc.
//
// tsc gets this right where ESLint does not: noUnusedLocals is on, and it does
// NOT fire here, because it follows the @link. Remove the tag and tsc reports
// TS6133 on the next line. So the suppression is narrow and deliberate, not a
// workaround for dead code.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const chunkNote = 'Batched by the caller; Convex bounds how much one mutation may write.'

/** Find an existing doc by its Supabase primary key. */
async function byLegacyId<T extends 'players' | 'teams' | 'playerMembership' | 'dailyScores'>(
  ctx: MutationCtx,
  table: T,
  legacyId: string | number,
): Promise<Doc<T> | null> {
  return await ctx.db
    .query(table)
    .withIndex('by_legacyId', (q) => q.eq('legacyId', legacyId as never))
    .unique()
}

// --- players -----------------------------------------------------------------

const playerInput = v.object({
  // Still REQUIRED here even though players.legacyId became optional in Phase 4.
  // Every row reaching this mutation came out of Supabase by definition, so it
  // has a Supabase primary key; and byLegacyId below is the entire upsert key —
  // a row arriving without one could only ever insert a duplicate. The schema is
  // wider than this validator on purpose: the table must also hold players born
  // in v2, and none of those come through here.
  legacyId: v.string(),
  email: v.string(),

  // THE SECOND GATE ON THE NAME REQUIREMENT, AND IT CHANGES NO OUTCOME — say so
  // plainly, because it is easy to read more into it. copy-from-supabase.mjs
  // filters nameless players out before shaping rows for this mutation, and the
  // schema rejects them anyway if the filter ever regresses. Narrowing here moves
  // the refusal from the ctx.db.insert below up to argument validation, so the
  // handler never runs; it does not change what lands, and cannot, since a Convex
  // mutation that throws writes nothing either way.
  //
  // Measured, not assumed: with these widened back to v.optional, upsertPlayers
  // given a nameless row still throws, with the same error name, the same message
  // ('Validator error: Missing required field `firstName` in object') and the same
  // empty table. NO TEST CAN TELL THE TWO APART — see migrate.test.ts's
  // upsertPlayers block, which pins the behaviour and says which part of it this
  // line is not responsible for.
  //
  // What it is for, then: this validator is the copy's contract in one readable
  // place. Anyone reading playerInput to find out what the script must supply
  // learns that a name is not optional, and the diagnostic on a regression names
  // the argument rather than pointing at an insert inside a loop over a chunk of
  // 200.
  firstName: v.string(),
  lastName: v.string(),
  hasPwa: v.boolean(),
  timeZone: v.optional(v.string()),
  reminderDeliveryMethods: v.array(v.string()),
  reminderDeliveryTime: v.string(),
  lastBoardEntryReminder: v.optional(v.number()),
  createdAt: v.optional(v.number()),
})

/** @see {@link chunkNote} */
export const upsertPlayers = internalMutation({
  args: { rows: v.array(playerInput) },
  handler: async (ctx, { rows }) => {
    let inserted = 0
    let updated = 0
    for (const row of rows) {
      // Defence in depth: auth stores addresses lowercased, and a mixed-case
      // player row would break the by_email lookup that links a signed-in user
      // to their copied data.
      const doc = { ...row, email: row.email.toLowerCase() }
      const existing = await byLegacyId(ctx, 'players', doc.legacyId)
      if (existing) {
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('players', doc)
        inserted++
      }
    }
    return { inserted, updated }
  },
})

// --- teams -------------------------------------------------------------------

const teamInput = v.object({
  legacyId: v.number(),
  name: v.string(),
  creatorLegacyId: v.optional(v.string()),
  playerLegacyIds: v.array(v.string()),
  invited: v.array(v.string()),
  oneGuess: v.number(),
  twoGuesses: v.number(),
  threeGuesses: v.number(),
  fourGuesses: v.number(),
  fiveGuesses: v.number(),
  sixGuesses: v.number(),
  failed: v.number(),
  nA: v.number(),
  playWeekends: v.boolean(),
  showLetters: v.boolean(),
  createdAt: v.optional(v.number()),
})

/**
 * Teams arrive carrying Supabase uuids; they are stored as Convex references.
 * A uuid with no corresponding player is DROPPED rather than failing the row —
 * a scoped copy legitimately contains teams whose other members were not copied,
 * and refusing the team would lose the owner's own data. The script reports the
 * count so a silent drop cannot be mistaken for a clean run.
 */
export const upsertTeams = internalMutation({
  args: { rows: v.array(teamInput) },
  handler: async (ctx, { rows }) => {
    let inserted = 0
    let updated = 0
    let droppedMembers = 0

    for (const row of rows) {
      const { creatorLegacyId, playerLegacyIds, ...rest } = row

      const playerIds: Id<'players'>[] = []
      for (const legacyId of playerLegacyIds) {
        const player = await byLegacyId(ctx, 'players', legacyId)
        if (player) playerIds.push(player._id)
        else droppedMembers++
      }

      const creatorDoc = creatorLegacyId
        ? await byLegacyId(ctx, 'players', creatorLegacyId)
        : null

      const doc = {
        ...rest,
        playerIds,
        ...(creatorDoc ? { creator: creatorDoc._id } : {}),
        // The whole point of §4.3: v1 matched this case-sensitively while auth
        // lowercased addresses, so mixed-case invitees never joined. Normalised
        // here as well as in the script, because this is the last gate before
        // the data lands.
        invited: row.invited.map((e) => e.toLowerCase()),
      }

      const existing = await byLegacyId(ctx, 'teams', row.legacyId)
      if (existing) {
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('teams', doc)
        inserted++
      }
    }
    return { inserted, updated, droppedMembers }
  },
})

// --- daily scores ------------------------------------------------------------

export const upsertDailyScores = internalMutation({
  args: {
    rows: v.array(
      v.object({
        legacyId: v.number(),
        playerLegacyId: v.string(),
        puzzleDay: v.string(),
        date: v.number(),
        guesses: v.array(v.string()),
        answer: v.optional(v.string()),
        createdAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    let inserted = 0
    let updated = 0
    let skipped = 0
    for (const { playerLegacyId, ...rest } of rows) {
      const player = await byLegacyId(ctx, 'players', playerLegacyId)
      if (!player) {
        skipped++ // score for a player outside the copied scope
        continue
      }
      const doc = { ...rest, playerId: player._id }
      // Keyed on legacyId, NOT on player+date. v1 has no uniqueness constraint
      // on that pair — upsertBoard inserts a fresh row whenever the client has
      // no scoreId yet, so a double submit produces two rows, and production
      // holds 5 of them. Keying on the pair would silently collapse those and
      // make the Phase 7 parity check report a difference it could not explain.
      // Copy faithfully; fix the duplicates as their own decision
      // (wordle-teams-rac).
      const existing = await byLegacyId(ctx, 'dailyScores', rest.legacyId)
      if (existing) {
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('dailyScores', doc)
        inserted++
      }
    }
    return { inserted, updated, skipped }
  },
})

// --- monthly winners ---------------------------------------------------------

export const upsertMonthlyWinners = internalMutation({
  args: {
    rows: v.array(
      v.object({
        legacyId: v.number(),
        playerLegacyId: v.string(),
        teamLegacyId: v.number(),
        year: v.number(),
        month: v.number(),
        hasSeenCelebrationLegacyIds: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    let inserted = 0
    let updated = 0
    let skipped = 0
    for (const row of rows) {
      const player = await byLegacyId(ctx, 'players', row.playerLegacyId)
      const team = await byLegacyId(ctx, 'teams', row.teamLegacyId)
      if (!player || !team) {
        skipped++
        continue
      }

      const seen: Id<'players'>[] = []
      for (const legacyId of row.hasSeenCelebrationLegacyIds) {
        const p = await byLegacyId(ctx, 'players', legacyId)
        if (p) seen.push(p._id)
      }

      const doc = {
        legacyId: row.legacyId,
        playerId: player._id,
        teamId: team._id,
        year: row.year,
        month: row.month,
        hasSeenCelebration: seen,
      }

      const existing = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) =>
          q.eq('teamId', team._id).eq('year', row.year).eq('month', row.month),
        )
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('monthlyWinners', doc)
        inserted++
      }
    }
    return { inserted, updated, skipped }
  },
})

// --- membership --------------------------------------------------------------

export const upsertMemberships = internalMutation({
  args: {
    rows: v.array(
      v.object({
        legacyId: v.string(),
        playerLegacyId: v.string(),
        membershipStatus: v.union(
          v.literal('new'),
          v.literal('free'),
          v.literal('pro'),
          v.literal('cancelled'),
          v.literal('expired'),
        ),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    let inserted = 0
    let updated = 0
    let skipped = 0
    for (const { playerLegacyId, ...rest } of rows) {
      const player = await byLegacyId(ctx, 'players', playerLegacyId)
      if (!player) {
        skipped++
        continue
      }
      const doc = { ...rest, playerId: player._id }
      const existing = await byLegacyId(ctx, 'playerMembership', rest.legacyId)
      if (existing) {
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('playerMembership', doc)
        inserted++
      }
    }
    return { inserted, updated, skipped }
  },
})

// --- webhook events ----------------------------------------------------------

export const upsertWebhookEvents = internalMutation({
  args: {
    rows: v.array(
      v.object({
        legacyId: v.number(),
        webhookId: v.optional(v.string()),
        playerLegacyId: v.string(),
        eventName: v.string(),
        body: v.any(),
        processed: v.boolean(),
        processingError: v.optional(v.string()),
        createdAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    let inserted = 0
    let updated = 0
    let skipped = 0
    for (const { playerLegacyId, ...rest } of rows) {
      const player = await byLegacyId(ctx, 'players', playerLegacyId)
      if (!player) {
        skipped++
        continue
      }
      const doc = { ...rest, playerId: player._id }
      const existing = await ctx.db
        .query('webhookEvents')
        .withIndex('by_webhookId', (q) => q.eq('webhookId', rest.webhookId))
        .filter((q) => q.eq(q.field('legacyId'), rest.legacyId))
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('webhookEvents', doc)
        inserted++
      }
    }
    return { inserted, updated, skipped }
  },
})

// --- purge -------------------------------------------------------------------

/**
 * Deletes every copied row. Internal-only, and deliberately requires an explicit
 * confirm argument so it cannot be triggered by a mistyped function name.
 *
 * Needed because the copy's shape can change while the copy is being built —
 * changing dailyScores.date from a string to a number, for instance, leaves rows
 * the new schema will not validate. Also the honest way to re-run a copy from
 * scratch rather than trusting upserts to have converged.
 *
 * Never point this at a deployment holding data that was not copied. It does not
 * touch the Better Auth component's tables, so it cannot sign anyone out.
 */
export const purgeCopiedData = internalMutation({
  args: {
    confirm: v.literal('yes-delete-all-copied-data'),
    // Convex caps a single function execution at 4096 reads, and the copied
    // scope alone is ~7000 daily scores. So this deletes a bounded slice per
    // call and reports whether more remains; the caller loops until done.
    batch: v.optional(v.number()),
  },
  handler: async (ctx, { batch = 800 }) => {
    const deleted: Record<string, number> = {}
    let remaining = false

    // Children before parents, so an interrupted purge never leaves a score
    // pointing at a player that no longer exists.
    for (const table of [
      'dailyScores',
      'monthlyWinners',
      'webhookEvents',
      'playerMembership',
      'teams',
      'players',
    ] as const) {
      const rows = await ctx.db.query(table).take(batch)
      for (const row of rows) await ctx.db.delete(row._id)
      deleted[table] = rows.length
      if (rows.length === batch) {
        remaining = true
        break // stay well inside the read limit; the next call continues here
      }
    }
    return { deleted, remaining }
  },
})

// --- verification ------------------------------------------------------------

/**
 * Row counts per table. Used by the copy script to report what it produced, and
 * by the Phase 7 parity spot-check (wt-ksh.2.9) to compare against Supabase.
 * Collecting whole tables is fine at this size — production is ~530 players and
 * ~171 teams — and will need revisiting only if that changes by an order of
 * magnitude.
 */
/**
 * Everything the parity check needs from the small tables in one call.
 * Deliberately excludes daily scores: there are ~7000 of them in the scoped copy
 * alone, and Convex bounds reads per execution. Those go through
 * playerScoreFingerprint, one player at a time.
 */
export const parityProbe = internalQuery({
  args: {},
  handler: async (ctx) => {
    const teams = await ctx.db.query('teams').collect()
    const winners = await ctx.db.query('monthlyWinners').collect()
    const memberships = await ctx.db.query('playerMembership').collect()
    const players = await ctx.db.query('players').collect()

    const playerLegacyById = new Map(players.map((p) => [p._id, p.legacyId]))
    const teamLegacyById = new Map(teams.map((t) => [t._id, t.legacyId]))

    return {
      players: players.map((p) => ({ legacyId: p.legacyId, email: p.email })),
      teams: teams.map((t) => ({
        legacyId: t.legacyId,
        name: t.name,
        playerCount: t.playerIds.length,
        invited: t.invited,
      })),
      // The design's named example of a known aggregate: a specific month's
      // winner. Compared as a whole set rather than one sample.
      winners: winners.map((w) => ({
        teamLegacyId: teamLegacyById.get(w.teamId) ?? null,
        year: w.year,
        month: w.month,
        winnerLegacyId: playerLegacyById.get(w.playerId) ?? null,
      })),
      memberships: memberships.map((m) => ({
        legacyId: m.legacyId,
        playerLegacyId: playerLegacyById.get(m.playerId) ?? null,
        membershipStatus: m.membershipStatus,
      })),
    }
  },
})

/**
 * Per-player daily-score fingerprint. One player at a time so a big copy cannot
 * blow the per-execution read limit — production's heaviest player has a few
 * hundred boards, and the scoped set as a whole has ~7000.
 *
 * Returns a puzzleDay histogram rather than raw rows: it is small, it catches a
 * board landing on the wrong day (which is the whole point of puzzleDay), and it
 * catches duplicates, which a bare count would hide.
 */
export const playerScoreFingerprint = internalQuery({
  args: { playerLegacyId: v.string() },
  handler: async (ctx, { playerLegacyId }) => {
    const player = await ctx.db
      .query('players')
      .withIndex('by_legacyId', (q) => q.eq('legacyId', playerLegacyId))
      .unique()
    if (!player) return null

    const scores = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', player._id))
      .collect()

    const byDay: Record<string, number> = {}
    let totalGuesses = 0
    for (const s of scores) {
      byDay[s.puzzleDay] = (byDay[s.puzzleDay] ?? 0) + 1
      totalGuesses += s.guesses.length
    }
    return { count: scores.length, totalGuesses, byDay }
  },
})

export const counts = internalQuery({
  args: {},
  handler: async (ctx) => ({
    players: (await ctx.db.query('players').collect()).length,
    teams: (await ctx.db.query('teams').collect()).length,
    dailyScores: (await ctx.db.query('dailyScores').collect()).length,
    monthlyWinners: (await ctx.db.query('monthlyWinners').collect()).length,
    playerMembership: (await ctx.db.query('playerMembership').collect()).length,
    webhookEvents: (await ctx.db.query('webhookEvents').collect()).length,
  }),
})
