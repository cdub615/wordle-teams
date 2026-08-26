import { internalMutation, internalQuery } from './_generated/server'
import { v } from 'convex/values'
import { SYSTEM_FIELDS } from './lib/scoringSystem.ts'
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

// --- what the copy overwrites ------------------------------------------------

/**
 * THE COPY REPORTS WHAT IT CLOBBERS (wt-ksh.13).
 *
 * The copy is re-runnable by design and the cutover runbook runs it again inside
 * the cutover window. v2 has since become a writer of the same tables: Phase 2
 * dailyScores, Phase 3 teams and — through winners.ts — monthlyWinners, Phase 4
 * teams.invited and teams.playerIds via invites, joins, cancels and leaves. A
 * patch here reverts any of it.
 *
 * The owner's decision (2026-08-24) is that this deployment's state IS discarded
 * at cutover — that is the copy's job, and beta is permanently testing data,
 * including rows other testers create. What must stop is it happening SILENTLY.
 * So upsertPlayers, upsertTeams and upsertMonthlyWinners diff the doc they are
 * about to write against the row already stored, and return per-field counts of
 * the rows they overwrote.
 *
 * WHAT COUNTS AS A CLOBBER: a field the patch will actually write, carrying a
 * value different from the stored one. Two consequences worth stating outright,
 * because both are easy to get wrong in the other direction:
 *
 *   - A field ABSENT from the incoming doc is never counted. upsertTeams spreads
 *     `creator` conditionally, so when the creator was outside the copied scope
 *     the patch does not touch the stored creator at all. Nothing is written, so
 *     nothing is clobbered.
 *   - An identical re-copy must report zero across the board. A report that
 *     fires on a no-op is noise, and noise is indistinguishable from silence
 *     after the second run.
 *
 * WHICH ROWS ARE ACTUALLY AT RISK, stated precisely because it is easy to get
 * backwards: a row BORN in v2 is the SAFE one. It has no legacyId, and for
 * players and teams legacyId is the entire upsert key, so the copy can never
 * match it and never patches it. What this report is about is a COPIED row —
 * one that already carries its Supabase key — that v2 then edited.
 *
 * monthlyWinners IS THE EXCEPTION, and it is the reason that paragraph is worth
 * writing down. It matches on (teamId, year, month), not on legacyId, so a
 * winner row v2 computed itself IS matched, adopted and overwritten. The report
 * shows it: an adopted row differs in `legacyId` (undefined, now a Supabase id)
 * on top of whatever else moved.
 *
 * THE BLIND SPOTS, IN FULL. This list is meant to be complete as of Phase 4 —
 * `git grep -n "db\.patch(\|db\.delete(\|db\.insert(" convex/` is how to check
 * it, and the copied tables v2 writes at all are players, teams, dailyScores and
 * monthlyWinners.
 *
 *   - STRUCTURAL, and no diff-based report can ever see it: a row v2 DELETED. A
 *     deleted team, board or winner row has nothing left to diff against, so the
 *     copy takes the INSERT branch and puts it back reported as `inserted` —
 *     indistinguishable from a genuinely new v1 row. cascadeDeleteTeam (the team
 *     and its winner rows), recomputeTeamMonth (a month that stops having a
 *     winner) and upsertBoardFor (a cleared board) all hard-delete without
 *     regard to legacyId. wt-ksh.13.10; it needs a tombstone, not a diff.
 *   - MERELY UNWIRED: upsertDailyScores. Same clobber shape as the three below,
 *     and reachable the same way monthlyWinners is — upsertBoardFor keys on
 *     (playerId, puzzleDay), not legacyId, so it patches COPIED score rows. Left
 *     out because it is a decision about dual-running rules before it is code:
 *     if boards are only ever entered in v1 during the window, re-importing v1's
 *     truth is correct. wordle-teams-r9d.
 *   - NOT AT RISK TODAY: playerMembership and webhookEvents. Nothing in v2
 *     writes either table yet, so there is no edit for a re-copy to revert.
 *     Phase 5's Polar work is what would change that.
 */
type Clobbered = Record<string, number>

/**
 * Field equality for the diff. Arrays compare as MULTISETS — order-insensitive,
 * duplicate-sensitive.
 *
 * ORDER-INSENSITIVE because the copy rebuilds these arrays rather than reading
 * them back: upsertTeams resolves Supabase uuids into playerIds in source order
 * and lowercases `invited` into a fresh array, and upsertMonthlyWinners rebuilds
 * hasSeenCelebration the same way. None of those orders need match the one v2
 * left behind — a join appends, a leave splices. Comparing order-sensitively
 * would report a clobber on essentially every run, which trains everyone to
 * ignore the report, which is the exact failure this exists to prevent.
 *
 * DUPLICATE-SENSITIVE because `invited` really can hold the same address twice
 * (Phase 4 established it), so replacing ['a', 'a'] with ['a'] is an overwrite.
 * Comparing as Sets would hide it.
 *
 * WHY THE BARE `.sort()` IS SOUND, since it is the obvious thing to distrust:
 * not because these arrays happen to hold strings (they do — Convex Ids are
 * strings), but because BOTH SIDES ARE CANONICALISED BY THE SAME COMPARATOR.
 * Default sort orders by string conversion, which is a total order over any one
 * primitive type, so equal multisets canonicalise to equal sequences even where
 * that order is surprising: [10, 9] and [9, 10] both sort to [10, 9], and
 * comparing them still returns true. The schema fact is true; it is not the
 * reason this works.
 */
function sameFieldValue(incoming: unknown, stored: unknown): boolean {
  if (Array.isArray(incoming) && Array.isArray(stored)) {
    if (incoming.length !== stored.length) return false
    const a = [...incoming].sort()
    const b = [...stored].sort()
    return a.every((value, i) => value === b[i])
  }
  return incoming === stored
}

/**
 * Count, into `into`, each field of `doc` that would overwrite a different value
 * on `existing`.
 *
 * ONE INCREMENT PER FIELD PER ROW, not one per row: a run that renames a team
 * AND rewrites its roster reports both, because they are two different things to
 * have lost. Grouped fields (see TEAM_FIELD_GROUPS) collapse to one increment
 * for the row, which is what the Set is for.
 *
 * `legacyId` is in every doc and can never differ — it is the key the row was
 * matched on — so it costs one comparison and never appears in the report.
 */
function recordClobbers<T extends object>(
  doc: Partial<T>,
  existing: T,
  into: Clobbered,
  groups: Record<string, string> = {},
): void {
  const stored = existing as Record<string, unknown>
  const fields = new Set<string>()
  for (const [field, value] of Object.entries(doc)) {
    if (sameFieldValue(value, stored[field])) continue
    fields.add(groups[field] ?? field)
  }
  for (const field of fields) into[field] = (into[field] ?? 0) + 1
}

/**
 * The eight base scoring fields report as one `scoring` count rather than eight.
 *
 * They move together or not at all — v1's team settings page writes all eight in
 * one save — so eight separate counts would say one thing eight times, and the
 * one thing that matters is that the copy rewrote a team's BASE system. That is
 * wordle-teams-1j3's retroactive rewrite: v2 resolves a month's scoring from the
 * scoringSystems version rows and falls back to these eight, so replacing them
 * re-scores every month before v2's first version row. Which of the numbers
 * moved does not change the answer to "did months just get rewritten".
 *
 * Note this is the one field group v2 itself never writes after createTeam —
 * setScoringSystem writes a scoringSystems row, not the team doc. A difference
 * here is a v1-side edit landing during dual-running, not a lost v2 edit.
 *
 * SYSTEM_FIELDS rather than eight names typed out here: it is derived from
 * DEFAULT_SYSTEM under `satisfies ScoringSystem`, so a ninth scoring field is a
 * compile error at the source until it is added there, and this grouping picks
 * it up with no edit. A hand-listed set would silently report the ninth field
 * on its own.
 */
const TEAM_FIELD_GROUPS: Record<string, string> = Object.fromEntries(
  SYSTEM_FIELDS.map((field) => [field, 'scoring']),
)

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
    // LATENT TODAY, ARMED BY PHASE 6. needsProfile is a row-existence check, so a
    // copied player never reaches /complete-profile, and v2 has no rename
    // surface — completeProfileFor's existing-row patch is idempotency defence
    // against a double submit, not a feature. Reminders & PWA (wt-ksh.7) makes
    // timeZone, reminderDeliveryMethods, reminderDeliveryTime and hasPwa
    // user-editable, and this report is what will show the copy taking them back.
    const clobbered: Clobbered = {}
    for (const row of rows) {
      // Defence in depth: auth stores addresses lowercased, and a mixed-case
      // player row would break the by_email lookup that links a signed-in user
      // to their copied data.
      const doc = { ...row, email: row.email.toLowerCase() }
      const existing = await byLegacyId(ctx, 'players', doc.legacyId)
      if (existing) {
        recordClobbers(doc, existing, clobbered)
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('players', doc)
        inserted++
      }
    }
    return { inserted, updated, clobbered }
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
    const clobbered: Clobbered = {}

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
        recordClobbers(doc, existing, clobbered, TEAM_FIELD_GROUPS)
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('teams', doc)
        inserted++
      }
    }
    return { inserted, updated, droppedMembers, clobbered }
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

/**
 * THE ONE UPSERT THAT CAN ADOPT A ROW v2 CREATED, because it is the one that
 * does not match on legacyId — see the clobber block at the top of this file.
 *
 * winners.ts's recomputeTeamMonth writes this table on every board entry, team
 * edit, membership change and scoring change, keyed on the same (teamId, year,
 * month). So the row this finds may well be one v2 computed minutes ago: the
 * copy then replaces the winner v2 calculated with v1's, clears
 * hasSeenCelebration, and stamps a Supabase legacyId onto a row that had none.
 * All three now show up in the report.
 *
 * NOT COVERED, and it is the worse half: recomputeTeamMonth DELETES the row when
 * a month has no winner, and cascadeDeleteTeam deletes a team's winner rows with
 * the team. A deleted row has nothing to diff against and comes back through the
 * insert branch. wt-ksh.13.10.
 */
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
    const clobbered: Clobbered = {}
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
        recordClobbers(doc, existing, clobbered)
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('monthlyWinners', doc)
        inserted++
      }
    }
    return { inserted, updated, skipped, clobbered }
  },
})

// --- membership --------------------------------------------------------------

export const upsertMemberships = internalMutation({
  args: {
    rows: v.array(
      v.object({
        // Still REQUIRED even though playerMembership.legacyId became optional in
        // Phase 5 — the same reason playerInput above keeps it, and Convex
        // enforces arg validators at runtime, so `undefined` cannot reach
        // byLegacyId below even from a malformed caller.
        //
        // The stakes rose in Phase 5. Once Phase 5's Polar handler writes native
        // membership rows — none exists yet, so this guard stands ahead of the
        // writer it guards against — `q.eq('legacyId', undefined)` would MATCH
        // one, and the copy would adopt and overwrite a row it did not create
        // (wt-ksh.13), through a table previously immune to that.
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
        // Still REQUIRED, guarding a different mechanism from upsertMemberships
        // above: there is no by_legacyId index here, so this upsert keys on a
        // by_webhookId RANGE and narrows it with the `.filter` below.
        //
        // THAT FILTER IS LOAD-BEARING TODAY, not only once Polar is wired up.
        // Copied rows whose Postgres webhook_id is null all arrive as
        // `webhookId: undefined`, so the range returns every one of them at once
        // and the `.unique()` would throw; the legacyId filter is what reduces it
        // to the single intended row. Those rows demonstrably exist — the Polar
        // migration leaves them exempt from its partial unique index
        // (20260731120000_polar_migration_drop_lemonsqueezy_columns.sql:103).
        //
        // ANTICIPATED, NOT YET REACHABLE: v1 and v2 both live and both
        // receiving, with one delivery stored on each side — v1's arriving
        // through the copy with a legacyId, v2's native row without. That
        // assumes Polar stamps one webhook-id per delivery across endpoints,
        // which is expected but UNVERIFIED against Polar's docs. If it holds the
        // range returns both rows, and a legacyId of `undefined` would make the
        // filter select the NATIVE one — the copy overwriting an event it did
        // not create (wt-ksh.13).
        legacyId: v.number(),

        // Optional for an unrelated reason, worth not conflating with the above:
        // the column was added NULLABLE on 2024-03-23
        // (supabase/migrations/20240323195151_webhook_events_add_webhook_id.sql),
        // so only rows older than that carry none — copied rows are "may or may
        // not have one", since copy-from-supabase.mjs's `opt` preserves any real
        // id. NOTHING enforces that a native row has one either, so absence here
        // does NOT mean a row was copied.
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

// --- creator -> owner rename -------------------------------------------------

/**
 * Backfill for the `creator` → `owner` rename (Phase 5, Task 1 — deploy step 2
 * of 5). The two numbering schemes run one apart on purpose: this code SHIPS in
 * Task 0 (deploy step 1) and is RUN in Task 1 (deploy step 2), so every
 * reference below names the task and the step together rather than picking one.
 *
 * Sets `owner = creator` for every team that has a creator and no owner yet.
 * Idempotent, so re-running it reports `updated: 0` — UNLESS A TEAM WAS CREATED
 * IN BETWEEN. createTeamFor (teams.ts:163) still writes `creator` alone until
 * Task 2 (deploy step 3) switches the writers and readers over, so a non-zero
 * confirming dry run means a NEW team, not a failed backfill; the fix is to run
 * it again. That cannot silently reach the schema drop: Task 2b's
 * clearTeamCreator is specified to throw on any team holding a creator with no
 * owner, so an incomplete backfill fails loudly one step before `creator`
 * leaves the schema.
 *
 * DOES NOT CLEAR `creator`, deliberately. At the point this runs, the deployed
 * code still READS `creator`; blanking it here would render every team
 * owner-less on beta until the next deploy landed. Clearing is a separate
 * mutation that ships later, once nothing reads the field.
 *
 * DELETED IN TASK 2c (deploy step 5), along with
 * scripts/backfill-team-owner.mjs. Once
 * `creator` leaves the schema this can never find a team to update and can
 * never be tested again — its fixtures become unconstructable — so keeping it
 * would mean permanently untested live code that cannot do anything.
 *
 * Counts only. It never returns or logs a team name or an address.
 */
export const backfillTeamOwner = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    // Unbounded collect, and it is fine at this scale: ~171 teams in
    // production, well inside the per-execution read cap — the same measurement
    // as the note at schema.ts:138. Contrast wordle-teams-b31, which is
    // dailyScores at ~7000 and does need bounding.
    const teams = await ctx.db.query('teams').collect()
    let updated = 0

    for (const team of teams) {
      if (!team.creator || team.owner) continue
      updated += 1
      if (!dryRun) await ctx.db.patch(team._id, { owner: team.creator })
    }

    return { scanned: teams.length, updated }
  },
})
