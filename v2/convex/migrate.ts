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
  legacyId: v.string(),
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
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

/**
 * Delete every player with no first or last name, and clean up after them.
 *
 * ONE-OFF, run before players.firstName/lastName are narrowed to required —
 * Convex validates the schema against existing documents on push and rejects a
 * narrowing that any row violates. See the Phase 4 design's "Prerequisite"
 * section for the three-step sequence this is step 1 of.
 *
 * "Nameless" means falsy, so an EMPTY STRING counts as nameless and the player
 * is deleted — deliberately, and matching the filter Task 0c adds to the copy
 * script. An unnamed player is unnamed whether the field is missing or blank,
 * and `v.string()` would happily accept '' forever. One consequence worth
 * watching at run time: a dry-run count above the expected figure means
 * empty-string names exist in the data, since only missing ones were counted.
 *
 * Measured against production 2026-08-20: 151 of 533 players are nameless, and
 * NOT ONE of them owns a dailyScore or a monthlyWinners row. This mutation
 * ASSERTS that rather than trusting it — if the assumption is ever false the
 * right outcome is a refusal, not a silent deletion of somebody's history.
 *
 * Deleting a player doc does NOT touch the Id<'players'> values already sitting
 * in teams.playerIds, so this cleans those explicitly: drop them from every
 * roster, clear `creator` where it pointed at them, and delete a team left with
 * no members at all (cascading its monthlyWinners and scoringSystems the way
 * deleteTeamFor does; dailyScores belong to players and survive).
 *
 * DANGLING REFERENCES ARE LEFT BEHIND, KNOWINGLY. teams.playerIds and
 * teams.creator are the only ones cleaned. Deliberately not cleaned:
 *   - playerMembership.playerId and webhookEvents.playerId, for every deleted
 *     player. Both tables are only ever reached by an index lookup keyed on a
 *     LIVE player's id, so no read path can load an orphan or break on one. It
 *     is not invisible, though: parityProbe below maps an orphaned membership to
 *     `playerLegacyId: null`, so Phase 7's parity comparison will report it as a
 *     diff. Expect it there rather than treating it as a copy failure.
 *   - monthlyWinners.hasSeenCelebration on SURVIVING rows. The guard above
 *     refuses when a nameless player OWNS a winner row, not when they merely
 *     appear in someone else's array, so a deleted id can still sit in one. That
 *     field is a membership test, never a fetch.
 * All of it belongs to the deleted player and is inert. Cleaning it would be
 * more deletion for no reduction in risk.
 *
 * AN ALREADY-EMPTY TEAM WITH A NAMELESS CREATOR IS DELETED TOO, along with its
 * scoring history: `playerIds: []` makes remaining.length === 0, which is the
 * emptied branch, even though no nameless member was ever removed from it. That
 * is the intended reading — a team with nobody on it whose creator is being
 * deleted is not a team — but it is a wider blast radius than "cleans up after
 * nameless players" suggests, so it is stated rather than left to be discovered.
 * Production has zero such rows (measured 2026-08-20).
 *
 * SINGLE TRANSACTION, AND THE ONE WRITE PATH HERE THAT CARRIES NO
 * {@link chunkNote}. Do not "fix" that by batching it. The refusals above are
 * only worth anything if they can still abort EVERYTHING — a chunked version
 * could delete two hundred players, hit an unexpected score in a later chunk,
 * and leave the data in a state that is neither before nor after, with no
 * refusal to act on. At production's 2026-08-20 size this reads roughly a
 * thousand documents (533 players + 171 teams + two indexed lookups per nameless
 * player) and writes a few hundred, comfortably inside Convex's per-transaction
 * limits. Revisit only if those counts change by an order of magnitude, and
 * then by scoping the run, not by giving up atomicity.
 */
export const deleteNamelessPlayers = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const players = await ctx.db.query('players').collect()
    const nameless = players.filter((p) => !p.firstName || !p.lastName)
    const namelessIds = new Set(nameless.map((p) => p._id))

    for (const player of nameless) {
      const score = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', player._id))
        .first()
      if (score) throw new Error('Refusing: a nameless player owns dailyScores')

      const winner = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_player', (q) => q.eq('playerId', player._id))
        .first()
      if (winner) throw new Error('Refusing: a nameless player owns monthlyWinners')
    }

    const teams = await ctx.db.query('teams').collect()
    let teamsEmptied = 0
    let rostersCleaned = 0
    let creatorsCleared = 0
    let winnersDeleted = 0
    let systemsDeleted = 0

    for (const team of teams) {
      const remaining = team.playerIds.filter((id) => !namelessIds.has(id))
      const creatorGone = team.creator !== undefined && namelessIds.has(team.creator)
      if (remaining.length === team.playerIds.length && !creatorGone) continue

      if (remaining.length === 0) {
        teamsEmptied++

        // COLLECTED IN BOTH MODES, ON PURPOSE. Task 0b decides whether to commit
        // from the dry-run output alone, and "teamsEmptied: N" says nothing about
        // how much scoring history N teams are carrying with them. Counting these
        // only on the commit path would mean the number arrives exactly one step
        // too late to inform the decision. Costs two indexed reads per emptied
        // team in a dry run, and makes the dry run a faithful rehearsal of the
        // real one's reads as a side benefit.
        //
        // TODO(Task 5): this block is teams.ts's deleteTeamFor cascade, verbatim.
        // Task 5 extracts that into `cascadeDeleteTeam` in teams.ts — move this
        // to the shared helper then, or the two copies will drift and only one
        // will learn about the next team-scoped table.
        const winners = await ctx.db
          .query('monthlyWinners')
          .withIndex('by_team_year_month', (q) => q.eq('teamId', team._id))
          .collect()
        const systems = await ctx.db
          .query('scoringSystems')
          .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', team._id))
          .collect()
        winnersDeleted += winners.length
        systemsDeleted += systems.length

        if (!dryRun) {
          for (const row of winners) await ctx.db.delete(row._id)
          for (const row of systems) await ctx.db.delete(row._id)
          await ctx.db.delete(team._id)
        }
        continue
      }

      if (remaining.length !== team.playerIds.length) rostersCleaned++
      if (creatorGone) creatorsCleared++
      if (!dryRun) {
        await ctx.db.patch(team._id, {
          playerIds: remaining,
          ...(creatorGone ? { creator: undefined } : {}),
        })
      }
    }

    if (!dryRun) {
      for (const player of nameless) await ctx.db.delete(player._id)
    }

    // THE TEAM COUNTS DO NOT SUM TO A NUMBER OF TEAMS. Read them like this:
    //   - teamsEmptied is EXCLUSIVE of the other two. An emptied team hits
    //     `continue` before either is incremented, so a team that was emptied and
    //     also had a nameless creator is teamsEmptied only.
    //   - rostersCleaned and creatorsCleared OVERLAP FREELY. They are two
    //     independent `if`s over the same surviving team, and a team that lost a
    //     member and had a nameless creator increments both — the common case,
    //     since a creator is normally on their own roster.
    // So teams touched = teamsEmptied + (teams counted in rostersCleaned and/or
    // creatorsCleared), which those two counts alone cannot tell you.
    //
    // winnersDeleted/systemsDeleted are row counts from the emptied teams only,
    // and are reported in a dry run too — that is the blast radius the operator
    // is actually deciding about.
    //
    // Counts only. This output is pasted into design docs and issues, and the
    // repository is public.
    return {
      dryRun,
      namelessPlayers: nameless.length,
      teamsEmptied,
      rostersCleaned,
      creatorsCleared,
      winnersDeleted,
      systemsDeleted,
    }
  },
})
