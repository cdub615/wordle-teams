import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// The six tables ported from Supabase. See
// docs/superpowers/plans/2026-08-11-v2-phase1-auth-and-data-copy.md §4.
//
// EVERY COPIED ROW CARRIES legacyId — its Supabase primary key. That is what
// makes the copy idempotent and re-runnable, which matters because the copy runs
// at least three times: now for the owner's teams, again at the Phase 7 parity
// audit for everyone, and once more inside the cutover window. Rows created
// natively in v2 (Phase 2 onward) have no legacyId; see dailyScores.
//
// Timestamps are stored as epoch milliseconds rather than strings so they sort
// and compare without parsing — including dailyScores.date, which despite its
// name is a `timestamp with time zone` in Supabase rather than a calendar day.

// Mirrors the Postgres member_status enum exactly. 'cancelled' survives for
// pre-existing rows even though nothing writes it any more — the Polar
// migration downgrades on subscription.revoked, which maps to 'expired'.
const membershipStatus = v.union(
  v.literal('new'),
  v.literal('free'),
  v.literal('pro'),
  v.literal('cancelled'),
  v.literal('expired'),
)

export default defineSchema({
  players: defineTable({
    legacyId: v.string(), // Supabase auth user uuid — also the players.id pk
    email: v.string(), // always lowercase; auth stores it that way
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    hasPwa: v.boolean(),
    timeZone: v.optional(v.string()),
    reminderDeliveryMethods: v.array(v.string()),
    reminderDeliveryTime: v.string(), // wall-clock 'HH:MM:SS' in the player's own zone
    lastBoardEntryReminder: v.optional(v.number()),
    createdAt: v.optional(v.number()), // the ORIGINAL creation time; _creationTime is when we copied it
  })
    .index('by_legacyId', ['legacyId'])
    .index('by_email', ['email']),

  teams: defineTable({
    legacyId: v.number(),
    name: v.string(),
    creator: v.optional(v.id('players')), // optional: the creator may be outside a scoped copy
    playerIds: v.array(v.id('players')),

    // INVITED ADDRESSES ARE ALWAYS LOWERCASE. v1 matched this array
    // case-sensitively while auth lowercased addresses, so anyone invited at a
    // mixed-case address silently never joined their team. That is a data-model
    // bug, not a platform one, and a faithful port reproduces it. The invite
    // FLOW is Phase 4; the storage rule belongs here so Phase 4 inherits a table
    // that cannot hold a mixed-case invite.
    invited: v.array(v.string()),

    // Points awarded per outcome. Configurable per team in v1.
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
  }).index('by_legacyId', ['legacyId']),
  // No index for "teams containing player X": Convex cannot index array
  // membership. Production has 171 teams in total, so the later phases can
  // collect and filter without it being worth a join table. Revisit only if
  // that count changes by an order of magnitude.

  dailyScores: defineTable({
    // OPTIONAL SINCE PHASE 2. Copied rows carry their Supabase pk; rows created
    // natively in v2 have no Supabase identity to carry, and inventing a
    // sentinel would fake one. Absence is meaningful: `legacyId === undefined`
    // means "born in v2, not copied", which is exactly the distinction Phase 7's
    // row-count reconciliation against Supabase needs. The copy is unaffected —
    // it matches on by_legacyId, and native rows correctly never match.
    legacyId: v.optional(v.number()),
    playerId: v.id('players'),

    // THE PUZZLE DAY, 'YYYY-MM-DD'. This is the field everything groups and
    // compares by, and storing it is the fix for v1's cross-timezone bug.
    //
    // v1 never stored a day at all — only the instant below — and decided which
    // day a board belonged to with isSameDay(new Date(s.date), day)
    // (src/lib/types.ts:179), which resolves that instant in whatever timezone
    // the VIEWER happens to be in. So a board entered while travelling showed up
    // on a different day for a teammate than for the person who entered it.
    // Measured across production: 733 of 7468 rows land on a different calendar
    // day in UTC than in America/Chicago, and 581 differ from the player's own
    // zone, across 57 distinct player timezones.
    //
    // Wordle has one global puzzle per day, so a board belongs to a PUZZLE, not
    // to a moment. Recording the day the player was living in when they entered
    // it makes every viewer agree, everywhere, forever. Never re-derive this
    // from `date`.
    puzzleDay: v.string(),

    // The original Supabase instant, kept for audit and so the backfill rule can
    // be revisited without another trip to Postgres. NOT for grouping — that is
    // exactly the mistake above.
    date: v.number(),

    guesses: v.array(v.string()),
    answer: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    // Keyed on legacyId like every other table. NOT on player+date: v1 has no
    // uniqueness constraint on that pair and actively creates duplicates —
    // upsertBoard inserts a fresh row whenever the client has no scoreId yet, so
    // a double submit makes two. Production holds 5 such pairs. Deduplicating
    // during the copy would silently drop rows and make the parity check lie.
    // See wordle-teams-rac.
    .index('by_legacyId', ['legacyId'])
    // Deliberately indexed on puzzleDay and NOT on `date`: there is no correct
    // way to group by an instant across 57 timezones, so the wrong thing is left
    // hard to do.
    .index('by_player_and_puzzleDay', ['playerId', 'puzzleDay'])
    .index('by_puzzleDay', ['puzzleDay'])

    // DO NOT USE EITHER OF THE TWO BELOW. They index the raw instant, and
    // grouping by an instant across 57 player timezones is precisely the v1 bug
    // that puzzleDay exists to fix. They are still here only because DROPPING an
    // index requires deployment:data:view, which neither the CI key nor the
    // local key carries — adding indexes is permitted, removing them is not.
    // Tracked for removal once a key has that permission.
    .index('by_player_and_date', ['playerId', 'date'])
    .index('by_date', ['date']),

  monthlyWinners: defineTable({
    legacyId: v.optional(v.number()), // see the note on dailyScores.legacyId
    playerId: v.id('players'),
    teamId: v.id('teams'),
    year: v.number(),
    month: v.number(),
    hasSeenCelebration: v.array(v.id('players')),
  })
    .index('by_team_year_month', ['teamId', 'year', 'month'])
    .index('by_player', ['playerId']),

  // Was player_customer. SMALLER THAN THE 2026-07-16 DESIGN ASSUMED: the Lemon
  // Squeezy -> Polar migration dropped customer_id and membership_variant.
  // Polar identifies customers by external_customer_id — the player id — and
  // nothing ever branched on the variant, since every gate is just "are they
  // pro". Do not port the dropped columns back into existence.
  playerMembership: defineTable({
    legacyId: v.string(),
    playerId: v.id('players'),
    membershipStatus,
  })
    .index('by_legacyId', ['legacyId'])
    .index('by_player', ['playerId']),

  webhookEvents: defineTable({
    legacyId: v.number(),

    // A STRING, NOT A UUID. Polar follows Standard Webhooks, whose ids look like
    // 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W'. v1 lost a day to a uuid column that
    // rejected them, returned 500, and put Polar into an infinite retry loop
    // against an event that could never be stored. Optional because legacy Lemon
    // Squeezy rows predate it.
    //
    // Convex has no unique constraints, so the replay guard lives in the
    // mutation: look up by_webhookId first and return early if it is already
    // there. Phase 5 owns that handler.
    webhookId: v.optional(v.string()),

    playerId: v.id('players'),
    eventName: v.string(),
    body: v.any(),
    processed: v.boolean(),
    processingError: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    .index('by_webhookId', ['webhookId'])
    .index('by_player', ['playerId']),

  // --- Phase 0 scaffolding, still in use ---

  statusMessages: defineTable({
    message: v.string(),
  }),

  testOtps: defineTable({
    email: v.string(),
    otp: v.string(),
  }).index('by_email', ['email']),
})
