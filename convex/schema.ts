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

// One side of a frozen challenge result. Defined out here because the result
// object uses it twice and an inline duplicate is how the two sides drift.
const challengeSideValidator = v.object({
  teamId: v.id('teams'),

  // THE TEAM'S NAME AT CLOSE, AND IT IS THE POINT OF A SNAPSHOT.
  //
  // `average` is stored though derivable because the rounding is
  // display-coupled — a record must not disagree with what was shown. The NAME
  // is display-coupled in exactly the same way and far more visible, so leaving
  // it out would make a rename silently rewrite who every closed challenge was
  // against, which is the precise failure storing `average` exists to prevent.
  //
  // AND IT IS WHAT MAKES DELETION SURVIVABLE. The design closes rather than
  // deletes a challenge "to keep the surviving team's record honest", and the
  // cascade closes BEFORE removing the team row because closing reads both
  // names. Without this field that care buys nothing: the outcome tally survives
  // and "who was it against" does not. A snapshot is the one shape that cannot
  // be backfilled.
  name: v.string(),

  boards: v.number(),
  attempts: v.number(),
  average: v.union(v.number(), v.null()),
  members: v.array(
    v.object({
      playerId: v.id('players'),
      // THE DISPLAY LABEL AT CLOSE, for the same reason the team's `name` is
      // frozen above: a rename or a departure must not relabel a finished
      // contest. Required — no teamChallenges row exists anywhere to migrate,
      // and optional would let a close freeze a row without it.
      name: v.string(),
      boards: v.number(),
      attempts: v.number(),
      average: v.union(v.number(), v.null()),
    }),
  ),
})

export default defineSchema({
  players: defineTable({
    // OPTIONAL SINCE PHASE 4, for the reason teams.legacyId is optional since
    // Phase 3 and dailyScores.legacyId since Phase 2: a player who signs up in
    // v2 has no Supabase identity to carry, and inventing a sentinel would fake
    // one. Absence is meaningful — `legacyId === undefined` means "born in v2,
    // not copied", which is what Phase 7's row-count reconciliation needs. The
    // copy is unaffected: it matches on by_legacyId, and native rows correctly
    // never match.
    //
    // Before this, v2 could not create a person AT ALL — the only writers were
    // the Supabase copy and e2eSeed, so both cold signup and the invite flow
    // dead-ended. See wt-ksh.5.1.
    legacyId: v.optional(v.string()),
    email: v.string(), // always lowercase; auth stores it that way

    // REQUIRED SINCE PHASE 4, so a name can never be ABSENT.
    //
    // IT CAN STILL BE EMPTY. v.string() accepts '' and Convex has no minLength,
    // so the schema cannot express "non-empty" — the writers do: isCompleteName
    // (lib/invite.ts) trims and rejects, and isNamed (scripts/lib/copy-filters.mjs)
    // treats '' as nameless. Do not read "required" as "non-empty"; a '' name
    // would reach the scoreboard, the team card AND the winner computation,
    // where it can win a month, and scores-table.tsx renders lastName[0], which
    // is undefined for ''. Every writer must go through one of those two guards.
    //
    // v1 created the row at signup from a Postgres trigger, nameless, and filled
    // the name in later at /complete-profile — so 151 of production's 533
    // players have no name (measured 2026-08-20). Not one of them has ever
    // entered a board or won a month, and all 29 teams they created are dead, so
    // nothing of value is refused. Narrowing this field still meant clearing the
    // way first, because Convex validates this schema against every existing
    // document on push and rejects a narrowing that any row violates. A one-off
    // mutation existed to clear any deployment already holding such rows; run
    // against beta on 2026-08-21 it reported zero, so none needed clearing, and
    // it was deleted afterwards — this narrowing made its input unconstructible,
    // so it could never be tested again either. The copy's `isNamed` filter
    // (scripts/lib/copy-filters.mjs) is what stops the next copy putting such
    // rows back, and is the durable half of that pair.
    //
    // HOW MANY ROWS THIS TABLE ACTUALLY HOLDS: ~393, the figure the per-player
    // reminder design measures and the one every I/O estimate in convex/
    // reminders.ts uses. DO NOT DERIVE IT FROM THE 533 ABOVE. A note once
    // claimed 393 was 533 minus the 151 nameless rows; that subtraction gives
    // 382. The Supabase count has moved between measurements — 533 on
    // 2026-08-20, 535 on 2026-08-24, and "151 of 543" in copy-filters.mjs's own
    // explainTeamMemberDrops note — and this table also gains natively-signed-up
    // players the copy never saw. The two are separate measurements and neither
    // implies the other.
    //
    // This is also what retired lib/player.ts's hasCompleteProfile predicate.
    // Its three call sites — the scoreboard (scores.ts), the team card
    // (teams.ts) and the winner computation (winners.ts) — had to agree or the
    // three views of "who is on this team" would disagree, and three copies of
    // one boolean kept in sync by comment were one edit from drifting. They
    // cannot drift if the state cannot exist. All three now guard only against a
    // roster id whose player DOCUMENT is missing, which is a different condition
    // and still representable.
    firstName: v.string(),
    lastName: v.string(),
    hasPwa: v.boolean(),
    timeZone: v.optional(v.string()),
    reminderDeliveryMethods: v.array(v.string()),
    reminderDeliveryTime: v.string(), // wall-clock 'HH:MM:SS' in the player's own zone
    lastBoardEntryReminder: v.optional(v.number()),

    // THE PENDING REMINDER JOB, and the instant it is due. Absent means this
    // player has no reminder scheduled — which is the state every existing row
    // is in, and is exactly why `maintain` needs no migration to bootstrap
    // them: "never scheduled" and "chain broke" are the same case to it.
    //
    // nextReminderAt IS THE SOURCE OF TRUTH, NOT reminderJobId. Every scheduled
    // job carries the instant it was scheduled for as an argument, and refuses
    // to act if it does not match this field. That is what makes
    // `ctx.scheduler.cancel` best-effort rather than load-bearing: Convex
    // documents cancel as able to FAIL once a job has committed, and a stale
    // job that cannot be cancelled would otherwise deliver at the old time.
    // Here it reads this field, sees it has been superseded, and retires.
    //
    // DO NOT ADD AN INDEX ON nextReminderAt. It would narrow a query nothing
    // makes: `maintain` already collects the whole table to derive
    // playsWeekends below, and reads the repair set from that same scan.
    reminderJobId: v.optional(v.id('_scheduled_functions')),
    nextReminderAt: v.optional(v.number()),

    // WHETHER THIS PLAYER IS ON ANY TEAM WITH playWeekends, DERIVED — never set
    // by a user and never authoritative. `teams` is the truth; this is a cache
    // of it, recomputed by `maintain` daily and by nothing else.
    //
    // ONE WRITER, DELIBERATELY, AND THE ALTERNATIVE WAS MEASURED. teams.playerIds
    // and teams.playWeekends have NINE write paths across four modules
    // (teams.ts x5 -- createTeamFor, updateTeamFor, removeMemberFor, leaveTeamFor,
    // invitePlayerFor -- plus players.ts, inviteLinks.ts and billing.ts x2).
    // COUNTED, and corrected once: this first said eight across six, which was
    // wrong in both numbers and omitted updateTeamFor -- the ONLY path that writes
    // playWeekends itself, and so the most relevant one to a cache derived from it.
    // Thirteen across seven if the non-production writers are included
    // (migrate.ts's upsertTeams, e2eSeed x2, e2ePrune) -- that figure counts
    // FUNCTIONS, not call sites: upsertTeams itself writes in two places
    // (migrate.ts:358 and 361), so a call-site census gives fourteen; the nine
    // production paths are nine either way. Maintaining this
    // from all of them is the drift shape this schema keeps warning about, and
    // drift here is silent and permanent. A daily recompute cannot drift for
    // more than a day, and the bound is AT MOST ONE missed or one extra weekend
    // day, not two, because `maintain` reschedules a player whose derived flag
    // has changed rather than only when the chain is broken -- a flag flip
    // invalidates the pending job the same way a settings change does. Without
    // that reschedule, a player whose flag was false when Friday's delivery
    // pointed nextReminderAt at Monday, and who then joins a weekend team on
    // Saturday, would read as healthy on Monday and have missed both Saturday
    // and Sunday. This is the same trade teamStats.sweep took when it went
    // daily.
    //
    // WHY IT IS DENORMALISED AT ALL: the reminder is delivered by a per-player
    // scheduled job, and Convex cannot index array membership, so asking `teams`
    // the question at delivery time costs a 171-row scan PER PLAYER. That scales
    // with ACTIVE users — roughly 200 MB/month at 500 active players, larger
    // than the hourly sweep this replaced. See lib/reminders.ts's nextOccurrence.
    //
    // ABSENT MEANS "not yet derived", which `maintain` treats as false. False is
    // the safe answer: it suppresses a weekend reminder rather than sending one
    // to somebody whose team does not play weekends.
    playsWeekends: v.optional(v.boolean()),
    createdAt: v.optional(v.number()), // the ORIGINAL creation time; _creationTime is when we copied it

    // WHEN THIS PLAYER'S INSIGHTS TRIAL RUNS OUT, absent if it never started.
    //
    // STAMPED FROM THE FIRST BOARD ENTERED AFTER LAUNCH, NOT FROM LAUNCH, and
    // that distinction is the entire reason the field exists rather than a
    // calendar window computed on read. A window anchored to launch expires while
    // a dormant player is still dormant, and dormant returners are exactly who
    // the launch email is aimed at. See lib/insightsAccess.ts, which holds the
    // rule, the trial length and the LAUNCH_AT constant.
    //
    // WRITTEN ONCE. upsertBoardFor stamps it only when it is absent, so a second
    // board cannot extend the trial — the check on absence is the only thing
    // between a daily player and a permanent free tier.
    //
    // ABSENT MEANS TWO DIFFERENT THINGS and neither grants anything: the player
    // has not entered a board since launch, or LAUNCH_AT is still its placeholder
    // and nobody has. Both read as "no trial", which is the safe answer.
    insightsTrialEndsAt: v.optional(v.number()),

    // WHEN THE PLAYER DISMISSED THE ONBOARDING CARD, absent if they never did.
    //
    // SERVER-SIDE, NOT localStorage, matching the monthly-winner dialog's
    // hasSeen (lib/celebration.ts): the flag has to follow one person across
    // their phone and their laptop, and it has to be readable by whatever
    // measures activation later. A per-device flag would do neither.
    //
    // A TIMESTAMP RATHER THAN A BOOLEAN, because "when did they give up on
    // onboarding" is a question the activation review will actually ask, and a
    // boolean cannot answer it. Nothing reads the value yet; absence is the
    // only thing the UI tests.
    onboardingDismissedAt: v.optional(v.number()),

    // WHEN THIS PLAYER FIRST JOINED A PUBLIC LEAGUE, absent if they never have
    // (zic8.3, spec §8.4). Stamped by leagues.joinGroupFor after a successful
    // join, ONLY WHEN ABSENT, and NEVER CLEARED: switchGroupFor and
    // leaveLeagueFor do not touch it, and a rejoin keeps the first stamp.
    //
    // WHY IT EXISTS: "ever joined" (onboarding.getStatus's inLeague, which
    // decides whether the picker is offered again) used to be "any membership
    // row". But planLeave DELETES a membership that has not started yet, so a
    // player who joined (counting from tomorrow) and left the same day had no
    // row left and was offered the picker again. A row cannot remember what
    // was deleted; this can. inLeague still ORs in the row read, so members
    // who joined before this field existed need no backfill.
    leagueJoinedAt: v.optional(v.number()),

    // WHEN THE PLAYER DISMISSED THE DASHBOARD'S LEAGUE OFFER ("Not now"),
    // absent if they never did. Written by leagues.dismissLeagueOffer, which
    // just rewrites the stamp on a repeat; nothing clears it. Server-side and a
    // timestamp for the same reasons as onboardingDismissedAt above, and
    // SEPARATE from it: hiding the league offer is not giving up on
    // onboarding. The Leagues menu item stays either way.
    leagueOfferDismissedAt: v.optional(v.number()),

    /**
     * THE PROVIDER'S OWN URL, mirrored from Better Auth's `user.image` by
     * players.syncSocialImage. Never bytes we host: this is
     * lh3.googleusercontent.com, and the browser fetches it from Google, which
     * is why the social path costs this deployment nothing at all.
     *
     * MIRRORED RATHER THAN JOINED because chat has to show OTHER players'
     * avatars, and another player's Better Auth user record is reachable only
     * from their own session. The mirror is what makes it readable here.
     */
    socialImage: v.optional(v.string()),

    /**
     * AN UPLOADED AVATAR, AND IT ALWAYS WINS OVER socialImage.
     *
     * TWO FIELDS RATHER THAN ONE, AND THIS IS LOAD-BEARING.
     * `overrideUserInfoOnSignIn: true` (auth.ts, wordle-teams-wdp1) rewrites
     * `user.image` on EVERY social sign-in. Collapsing these into a single URL
     * column would mean the next Google sign-in silently overwrites an avatar
     * the player deliberately uploaded. Do not "simplify" this pair.
     */
    imageId: v.optional(v.id('_storage')),

    /**
     * generateAvatarUploadUrl's rate-limit window. Both absent until a player's
     * first upload.
     *
     * ON THE PLAYER ROW BECAUSE requirePlayer HAS ALREADY READ IT, which is
     * chatReads' reasoning one table over: counting a player's recent uploads
     * instead would pay database I/O to protect database I/O. Enforcing the
     * limit therefore costs one extra write and no extra read.
     *
     * See AVATAR_UPLOAD_LIMIT in lib/avatar.ts for what the limit bounds — the
     * count of files, not their size — and for why a sweep of unreferenced
     * storage was considered and not taken (wordle-teams-wty4.1.8).
     */
    avatarWindowStartedAt: v.optional(v.number()),
    avatarUploadsInWindow: v.optional(v.number()),
  })
    .index('by_legacyId', ['legacyId'])
    .index('by_email', ['email']),

  teams: defineTable({
    // OPTIONAL SINCE PHASE 3, for the reason dailyScores.legacyId is optional
    // since Phase 2: a team created natively in v2 has no Supabase identity to
    // carry, and inventing a sentinel would fake one. Absence is meaningful —
    // `legacyId === undefined` means "born in v2, not copied", which is what
    // Phase 7's row-count reconciliation against Supabase needs. The copy is
    // unaffected: it matches on by_legacyId, and native rows correctly never
    // match, because the copy must not adopt them.
    legacyId: v.optional(v.number()),
    name: v.string(),

    // WHO CONTROLS THIS TEAM: the one player who can rename it, change its
    // scoring system, invite and remove members, and delete it — see
    // requireTeamOwnerFor in access.ts, which is the only place that check
    // lives.
    //
    // Optional because a scoped copy may not include that player's row, so
    // upsertTeams omits the field rather than inventing one. Such a team has
    // NOBODY who can edit it; that is honest, and it is asserted in the tests so
    // it stays a known property rather than a beta surprise.
    //
    // A ROLE, NOT HISTORY. This is emphatically not "the person who created the
    // team": Phase 5's softened downgrade reassigns it to the earliest-joined
    // remaining member, so reading it as authorship is plainly false.
    owner: v.optional(v.id('players')),
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
    /**
     * WHETHER THIS TEAM ACCEPTS INCOMING CHALLENGES (wordle-teams-zic8.2).
     *
     * OPTIONAL-BY-OMISSION, exactly as inviteLinks.revokedAt and
     * players.onboardingDismissedAt are: ABSENT MEANS YES. That is what lets
     * 171 existing teams need no backfill, and Convex validates this schema
     * against every existing document on push.
     *
     * THE OWNER'S CONTROL, AND IT IS NOT ADVISORY. It is re-checked when a
     * challenge LINK is claimed as well as when a direct proposal is made —
     * see challenges.ts — because a link proposal does not know its opponent at
     * creation, so a check only at propose time would make this bypassable by
     * anyone holding a link.
     */
    acceptsChallenges: v.optional(v.boolean()),
  }).index('by_legacyId', ['legacyId']),
  // No index for "teams containing player X": Convex cannot index array
  // membership. Production has 171 teams in total, so the later phases can
  // collect and filter without it being worth a join table. Revisit only if
  // that count changes by an order of magnitude.

  // Versioned scoring systems (wordle-teams-1j3). A team's `teams` doc still
  // carries eight point values; those are now THE ORIGINAL SYSTEM, and the
  // editor never writes them again. Resolution for a month is "the row with the
  // greatest effectiveFrom <= month, else the team doc's own fields" — see
  // lib/scoringSystem.ts.
  //
  // NO legacyId, and that is not an oversight: this table has no Supabase
  // counterpart, so nothing is ever copied into it. The fallback to the team
  // doc is what lets that be true — existing teams need no backfill, and the
  // copy script needs no change, because "no version rows" already means "it
  // has always been this".
  scoringSystems: defineTable({
    teamId: v.id('teams'),
    effectiveFrom: v.string(), // 'YYYY-MM'
    oneGuess: v.number(),
    twoGuesses: v.number(),
    threeGuesses: v.number(),
    fourGuesses: v.number(),
    fiveGuesses: v.number(),
    sixGuesses: v.number(),
    failed: v.number(),
    nA: v.number(),
  }).index('by_team_and_effectiveFrom', ['teamId', 'effectiveFrom']),

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

  /**
   * ONE DOCUMENT PER TEAM PER MONTH — Layer 3's whole cost model.
   *
   * Team analytics is six view types multiplied by teammates and months, and
   * bandwidth is the binding limit (wordle-teams-dcu). Reading a month of every
   * member's boards once per view is the most read-heavy thing the product could
   * do; reading one precomputed document is not. See lib/teamStats.ts for what it
   * holds and why it keeps per-day detail rather than only totals.
   *
   * INDEXED EXACTLY LIKE monthlyWinners, because it is the same access pattern —
   * a point lookup by (teamId, year, month) — and copying a shape that already
   * works beats inventing a second one.
   *
   * DERIVED DATA, NEVER A SOURCE OF TRUTH. Every field is recomputable from
   * dailyScores, so a lost or stale row costs a recompute and never data. That is
   * what lets the rollup skip writing an unchanged month and lets the cascade
   * delete these rows without ceremony.
   */
  teamMonthStats: defineTable({
    teamId: v.id('teams'),
    year: v.number(),
    month: v.number(), // 1-12, matching monthlyWinners
    members: v.array(
      v.object({
        playerId: v.id('players'),
        boards: v.number(),
        attempts: v.number(),
        solved: v.number(),
        failed: v.number(),
      }),
    ),
    days: v.array(
      v.object({
        puzzleDay: v.string(),
        entries: v.array(v.object({ playerId: v.id('players'), attempts: v.number() })),
      }),
    ),
    computedAt: v.number(),
  }).index('by_team_year_month', ['teamId', 'year', 'month']),

  // Was player_customer. SMALLER THAN THE 2026-07-16 DESIGN ASSUMED: the Lemon
  // Squeezy -> Polar migration dropped customer_id and membership_variant.
  // Polar identifies customers by external_customer_id — the player id — and
  // nothing ever branched on the variant, since every gate is just "are they
  // pro". Do not port the dropped columns back into existence.
  playerMembership: defineTable({
    // OPTIONAL SINCE PHASE 5, for the reason players.legacyId is optional since
    // Phase 4: Phase 5 is the first phase in which v2 WRITES this table, and a
    // membership row for a player born in v2 has no Supabase identity to carry.
    // Absence is meaningful — `legacyId === undefined` means "born in v2, not
    // copied", which is what Phase 7's row-count reconciliation needs. No
    // synthesised value: the copy matches on by_legacyId, so a fake one would
    // silently never match.
    legacyId: v.optional(v.string()),
    playerId: v.id('players'),
    membershipStatus,
  })
    .index('by_legacyId', ['legacyId'])
    .index('by_player', ['playerId']),

  webhookEvents: defineTable({
    // OPTIONAL SINCE PHASE 5, for the same reason as playerMembership.legacyId
    // above. Every webhook v2 receives is native and has no Supabase row behind
    // it; the rows that DO carry a legacyId are the copied ones — the Lemon
    // Squeezy era, and, since v1 migrated to Polar in place on 2026-08-03, v1's
    // own Polar events too. The copy filters by neither provider nor date
    // (scripts/copy-from-supabase.mjs), so do not read "copied" as "pre-Polar":
    // a copied row and a native one can describe the same Polar delivery.
    legacyId: v.optional(v.number()),

    // A STRING, NOT A UUID. Polar follows Standard Webhooks, whose ids look like
    // 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W'. v1 lost a day to a uuid column that
    // rejected them, returned 500, and put Polar into an infinite retry loop
    // against an event that could never be stored. Optional because legacy Lemon
    // Squeezy rows predate it.
    //
    // Convex has no unique constraints, so the replay guard lives in the
    // mutation: `processPolarEvent` in billing.ts looks up by_webhookId first.
    //
    // IT RETURNS EARLY ON `processed`, NOT ON THE ROW EXISTING, and the
    // difference is decision E / divergence 13. (This comment said "return
    // early if it is already there" until Task 10 built the handler it was
    // describing.) A row that exists but never completed is a delivery this app
    // still owes: v1 treats it as a duplicate, answers 200 to the redelivery,
    // and loses the event permanently while this row claims it was handled.
    // So an unprocessed row CARRYING AN ERROR is a normal state here — it is
    // what sits between a failure and the redelivery that finishes it — where
    // in v1 the same two fields can only ever be seen set together.
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

  // WEB PUSH ENDPOINTS. Phase 6, and NOT copied from anywhere: v1 never stored
  // one. Its subscribe route returns before doing anything
  // (src/app/api/subscribe/route.ts:5), its button ships the literal string
  // 'YOUR_PUBLIC_VAPID_KEY', and the push workflow was never registered with
  // Novu. So this table has no legacyId, for the same reason scoringSystems has
  // none — there is no Supabase counterpart for the copy to match against.
  //
  // ONE PLAYER, MANY ROWS. A subscription belongs to a browser profile on a
  // device, not to a person: phone, laptop and a second browser are three
  // endpoints, and all three should buzz.
  //
  // THE ENDPOINT IS THE IDENTITY, not a surrogate. It is what the push service
  // returns 410 for once the browser has thrown the subscription away, and
  // by_endpoint is how that response finds the row to delete.
  //
  // p256dh AND auth ARE WHAT THE PAYLOAD IS ENCRYPTED AGAINST. If either is
  // stored wrong, delivery fails SILENTLY — the push service answers 201
  // without decrypting anything, and the browser drops a message it cannot
  // read. Task 11 carries that warning; it is repeated here because this is
  // where the values live.
  pushSubscriptions: defineTable({
    playerId: v.id('players'),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  })
    .index('by_player', ['playerId'])
    .index('by_endpoint', ['endpoint']),

  // TEAM CHAT (wordle-teams-qix). Phase 7.5, and native to v2 — there is no
  // Supabase counterpart, so no legacyId on any of these four, for the same
  // reason scoringSystems and pushSubscriptions have none.
  //
  // AN EXPLICIT createdAt, WHERE _creationTime WOULD HAVE BEEN FREE. Every
  // client wake range-scans "messages since T" on by_team_createdAt, which is
  // the hot path of the entire feature. Relying on _creationTime as an implicit
  // trailing index field may well work; this is not the place to find out.
  //
  // createdAt IS UNIQUE WITHIN A TEAM, AND BOTH PAGING READS DEPEND ON IT
  // (wordle-teams-isw5). They walk this index with STRICT inequalities against
  // a timestamp the client took off a message it already holds — `lt` going
  // back, `gt` coming forward — so two messages sharing a createdAt means one
  // of them is skipped, and skipped permanently, because the cursor only ever
  // moves away from it. The uniqueness is not enforced by the schema (Convex
  // has no unique constraint and could not express "per team" if it did); it is
  // established at the only place messages are written, by sendMessageFor via
  // lib/chat.ts's nextMessageTime, which clamps the clock past the team's
  // newest message. ANYTHING ELSE THAT INSERTS HERE — a seed script, a
  // migration — must stamp its rows the same way.
  chatMessages: defineTable({
    teamId: v.id('teams'),
    playerId: v.id('players'),
    body: v.string(),
    createdAt: v.number(),
  }).index('by_team_createdAt', ['teamId', 'createdAt']),

  // THE POINTER. Clients subscribe to THIS, not to messages. A wake reads two
  // small documents — this row and the month's chatDegraded row, which is how
  // `degraded` reaches the client — instead of a whole message window. See
  // chatPointerFor in chat.ts, and section 4 of the design.
  //
  // IT USED TO BE THIS ROW AND THE MONTH'S chatBudget ROW, and that was
  // wordle-teams-0lg2: chatBudget is written by every send, delete and
  // scrollback page in EVERY team, so having it in the pointer's read set made
  // one message in one team re-fire every connected client's subscription
  // across the whole app. See chatDegraded below.
  //
  // IT IS NOT ON THE TEAM DOC, AND THAT IS THE POINT. Denormalising
  // lastMessageAt onto `teams` would make every chat message invalidate every
  // query watching that team — posting a message would re-run the SCOREBOARD
  // for everyone reading it.
  //
  // `revision` EXISTS BECAUSE DELETES DO NOT MOVE lastMessageAt. A client
  // watching only the timestamp would never notice a deleted message and would
  // go on showing it. Any mutation to a team's history bumps revision.
  chatMeta: defineTable({
    teamId: v.id('teams'),
    lastMessageAt: v.number(),
    revision: v.number(),
  }).index('by_team', ['teamId']),

  // PER-PLAYER, PER-TEAM read cursor. Also carries the rate-limit window,
  // because the send mutation already reads and writes this row — counting a
  // player's recent messages instead would pay database I/O to protect
  // database I/O.
  chatReads: defineTable({
    playerId: v.id('players'),
    teamId: v.id('teams'),
    lastReadAt: v.number(),
    lastNotifiedAt: v.optional(v.number()),
    postWindowStartedAt: v.optional(v.number()),
    postsInWindow: v.optional(v.number()),
    // The scrollback rate-limit window — same row, same shape as the post
    // window above, kept as separate fields rather than reused ones because
    // a scroll page and a post are priced and limited differently. See
    // RATE_LIMIT_SCROLLS in lib/chat.ts.
    scrollWindowStartedAt: v.optional(v.number()),
    scrollsInWindow: v.optional(v.number()),
  })
    .index('by_player_team', ['playerId', 'teamId'])
    .index('by_player', ['playerId'])
    .index('by_team', ['teamId']),

  // THE BANDWIDTH BUDGET, one row per calendar month. Convex's free tier caps
  // database I/O at 1GB/month and the cap is HARD — mutations start failing
  // rather than generating a bill, which would take board entry down with it.
  // This meter degrades chat to manual refresh first. See lib/chat.ts.
  //
  // Grows by one row per calendar month, forever — about twelve rows a year.
  // Nothing prunes it, and nothing needs to; a cleanup job is not worth
  // writing for a table this small.
  chatBudget: defineTable({
    month: v.string(), // 'YYYY-MM'
    estimatedBytes: v.number(),
    // THE COUNTER ROW'S OWN RECORD OF ITS STATE, read by nothing. What reaches
    // a client is chatDegraded below; this is written on the same line, from
    // the same isOverBudget call, because the row is being patched anyway. It
    // is kept rather than dropped because Convex validates EXISTING documents
    // against a pushed schema, so removing a required field needs a data
    // migration to buy nothing. See chargeBudget in chat.ts.
    degraded: v.boolean(),
  }).index('by_month', ['month']),

  // THE DEGRADATION SIGNAL, SPLIT OFF THE COUNTER ROW ON PURPOSE
  // (wordle-teams-0lg2). Same key, one row per month, and it holds the single
  // boolean chatPointerFor reads.
  //
  // WHY A SECOND DOCUMENT RATHER THAN A FIELD ON chatBudget. A Convex
  // subscription re-fires when any document it READ changes, and chatBudget's
  // `estimatedBytes` changes on every send, delete and scrollback page in every
  // team — it is the one hot document in this schema, deliberately. A pointer
  // that read it therefore woke every connected client in the app on every
  // message anywhere in the app. This row carries the same answer with none of
  // that churn: chargeBudget writes it ONLY when the boolean actually changes,
  // so in a month that never crosses the threshold the row is never written and
  // never even created. Absent means not degraded.
  //
  // WHEN IT IS WRITTEN, EVERY CLIENT DOES WAKE — and that is the point rather
  // than a leak: crossing the line is exactly the event every connected client
  // has to learn about, since what `degraded` asks them to do is drop their
  // live subscriptions. Once or twice a month, when it matters, instead of
  // continuously.
  chatDegraded: defineTable({
    month: v.string(), // 'YYYY-MM'
    degraded: v.boolean(),
  }).index('by_month', ['month']),

  /**
   * SHAREABLE TEAM INVITES. wordle-teams-qt4.
   *
   * WHY A TABLE RATHER THAN A FIELD ON `teams`. Revoking and rotating are the
   * operations that matter here — a link is a capability that anyone holding
   * it can use, so being able to kill one without disturbing the team document
   * is the point. A single token column on `teams` makes "revoke" mean
   * "overwrite", which silently breaks any link already shared.
   *
   * THE TOKEN IS THE SECRET AND THE KEY. It is looked up by `by_token` on the
   * unauthenticated join path, so it must be unguessable; see createLink.
   *
   * NOT NULLABLE-BY-OMISSION: `revokedAt` absent means live, exactly as
   * players.onboardingDismissedAt does.
   */
  inviteLinks: defineTable({
    teamId: v.id('teams'),
    token: v.string(),
    createdBy: v.id('players'),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_token', ['token'])
    .index('by_team', ['teamId']),

  // --- Phase 0 scaffolding, still in use ---

  /**
   * EVERY TILE BOARD IMPORT GOT WRONG, as the player corrected it.
   *
   * NOT ANALYTICS. wordle-teams-418 asks for a labelled corpus of real
   * screenshots to measure the parse against, and there is no way to collect
   * one from seventy players of whom ten are most of the activity. This table
   * IS that corpus: every confirm-before-save that changed something writes the
   * tile, what Stage 3 read and what was actually there, which is exactly the
   * label a template reader can be scored on.
   *
   * PER TILE, NOT PER ROW. A wrong row is usually one wrong glyph — FLUNX for
   * FLUNK — and a row-level record would say "one row wrong" and lose the only
   * part that could ever be learned from.
   *
   * NO IMAGE IS STORED, and none ever should be. The parse runs entirely in the
   * browser, nothing is uploaded, and the whole privacy argument for the
   * feature rests on that staying true. A letter and a tile position carry
   * everything the measurement needs.
   */
  boardImportCorrections: defineTable({
    playerId: v.id('players'),
    puzzleDay: v.string(),

    // 'guess' for a tile on the board; 'answer' for the answer field, which the
    // parse also fills in and the player can also correct.
    target: v.union(v.literal('guess'), v.literal('answer')),
    // Guess row, 0-5. Always 0 when target is 'answer'.
    row: v.number(),
    column: v.number(),

    // A single letter, or '' where the reader had nothing for that tile / the
    // player cleared it. Both directions are meaningful.
    read: v.string(),
    actual: v.string(),

    createdAt: v.number(),
  })
    // By day, because that is how a measurement run wants to fetch them: all
    // the corrections for the boards people entered on a given puzzle.
    .index('by_puzzleDay', ['puzzleDay'])
    .index('by_player_and_puzzleDay', ['playerId', 'puzzleDay']),

  /**
   * A CHALLENGE BETWEEN TWO TEAMS (wordle-teams-zic8.2).
   *
   * NOT DERIVED DATA, unlike teamMonthStats beside it. A challenge is a social
   * agreement and cannot be recomputed from boards, which is why team deletion
   * CLOSES one rather than deleting it — WIRED IN TASK 11, not here.
   *
   * THAT HEDGE IS NOT PEDANTRY. teams.ts's cascadeDeleteTeam banner records that
   * teamMonthStats was added to the cascade "in the same commit as the table
   * itself, which is the whole lesson of wordle-teams-2c1u — that bug's entire
   * cause was a table added the day AFTER this function was written", leaving
   * every invite link a deleted team ever issued orphaned forever. This is
   * another team-keyed table arriving without the cascade, so the present tense
   * would tell a reader of schema.ts that it is already covered. It is not,
   * until Task 11.
   *
   * TWO STATUS INDEXES RATHER THAN ONE, because a team sits on either side and
   * Convex cannot OR across indexes. "My team's challenges" is two point
   * queries, never a scan. An array field holding both ids would be
   * unindexable — the same limitation this file already records for "teams
   * containing player X".
   */
  teamChallenges: defineTable({
    challengerTeamId: v.id('teams'),

    // ABSENT UNTIL A LINK IS CLAIMED. A direct proposal names its opponent at
    // creation; a link proposal cannot know who will claim it. Absence is
    // meaningful, as with inviteLinks.revokedAt — it means "not yet bound",
    // never "missing".
    opponentTeamId: v.optional(v.id('teams')),

    proposedBy: v.id('players'),

    status: v.union(
      v.literal('pending'),
      v.literal('active'),
      v.literal('declined'),
      v.literal('withdrawn'),
      v.literal('expired'),
      v.literal('closed'),
    ),

    // LINK PROPOSALS ONLY, and THE TOKEN IS THE SECRET AND THE KEY exactly as
    // inviteLinks.token is: it is looked up on a path the claimant reaches
    // before we know which team they act for, so guessability is the only thing
    // standing between a stranger and a challenge. See newToken in
    // challenges.ts, which must stay crypto.getRandomValues.
    //
    // ⚠️ NEVER PROBE by_token WITH A POSSIBLY-UNDEFINED TOKEN. This field is
    // OPTIONAL, unlike inviteLinks.token which is v.string() — so every DIRECT
    // proposal keys on `undefined`, and
    // `withIndex('by_token', q => q.eq('token', undefined)).unique()` would
    // match all of them at once and throw "not unique", a confusing failure a
    // long way from its cause. Guard with `if (!token)` before any lookup.
    token: v.optional(v.string()),

    expiresAt: v.number(), // the PROPOSAL's TTL; see PROPOSAL_TTL_DAYS
    acceptedBy: v.optional(v.id('players')),

    // SET ON ACCEPTANCE, both 'YYYY-MM-DD'. startDay is the day AFTER
    // acceptance; see windowFor.
    startDay: v.optional(v.string()),
    endDay: v.optional(v.string()),

    /**
     * FROZEN AT CLOSE, AND THE FREEZE IS FORCED RATHER THAN CHOSEN.
     * convex/teamStats.ts states that backfill is a free feature — a player can
     * edit a month from last year and the rollup recomputes that exact (team,
     * month) pair on the spot. A closed challenge re-derived from teamMonthStats
     * would therefore silently restate itself whenever anyone edited an old
     * board, turning "we won March" into "we lost March".
     *
     * `average` IS STORED THOUGH IT IS DERIVABLE from boards and attempts. The
     * rounding is display-coupled, so storing it is what makes it impossible for
     * a historical record to disagree with what was shown at the time.
     *
     * NO solved/failed FIELDS, and that is not an omission: the window
     * projection reads days[], where a failure is already folded into attempts
     * as 7 by attemptsFor. Nothing needs a separate failure count.
     */
    result: v.optional(
      v.object({
        challenger: challengeSideValidator,
        opponent: challengeSideValidator,
        outcome: v.union(
          v.literal('challenger'),
          v.literal('opponent'),
          v.literal('tie'),
          v.literal('void'),
        ),
        closedAt: v.number(),
      }),
    ),

    createdAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_challenger_and_status', ['challengerTeamId', 'status'])
    .index('by_opponent_and_status', ['opponentTeamId', 'status'])
    // THE DAILY SWEEP'S TWO READS (Task 10b, owner decision D5), so it touches
    // only live rows rather than walking a table that only ever grows: active
    // challenges whose window has ended, and pending proposals past their TTL.
    // STATUS FIRST in both: it is the equality, the date is the range.
    .index('by_status_and_endDay', ['status', 'endDay'])
    .index('by_status_and_expiresAt', ['status', 'expiresAt']),

  // PUBLIC LEAGUES (wordle-teams-zic8.3). Spec:
  // docs/superpowers/specs/2026-10-07-public-leagues-design.md §4. Rules live in
  // lib/league.ts. Nothing here is ever shown to another player with a name
  // attached: strangers see group totals only (§3.2).
  leagues: defineTable({
    slug: v.string(),
    name: v.string(),
    // The league onboarding and the empty home card offer. Starting Words today.
    featured: v.boolean(),
    createdAt: v.number(),
  }).index('by_slug', ['slug']),

  leagueGroups: defineTable({
    leagueId: v.id('leagues'),
    slug: v.string(),
    name: v.string(),
    order: v.number(),
    // MAINTAINED at join/switch/leave from lib/league.ts's countFrom/countTo,
    // never counted on read. A pending switcher counts for their NEW group.
    memberCount: v.number(),
  }).index('by_league', ['leagueId']),

  // ONE ROW PER INTERVAL, both bounds inclusive. toDay ABSENT MEANS OPEN.
  // Switches only ever land on a month boundary, so a player is in exactly one
  // group per league per month (§4.1) — leagueMemberMonth relies on that.
  // Which rows are LIVE (including a closed row kept live by its pending switch
  // successor) is decided in ONE place: lib/league.ts liveOf / isSwitchSuccessor.
  // A same-day leave DELETES a not-yet-started row (planLeave).
  leagueMemberships: defineTable({
    playerId: v.id('players'),
    leagueId: v.id('leagues'),
    groupId: v.id('leagueGroups'),
    fromDay: v.string(),
    toDay: v.optional(v.string()),
  })
    .index('by_player_and_league', ['playerId', 'leagueId']),

  // DERIVED. Rebuilt from the player's own boards on every board write.
  leagueMemberMonth: defineTable({
    playerId: v.id('players'),
    leagueId: v.id('leagues'),
    groupId: v.id('leagueGroups'),
    year: v.number(),
    month: v.number(), // 1-12, matching teamMonthStats
    boards: v.number(),
    attempts: v.number(),
  })
    .index('by_player_league_year_month', ['playerId', 'leagueId', 'year', 'month'])
    // recomputeLeagueMonthFor's read of every league a player HAS a row in this
    // month: a left league may have no membership row left to name it.
    .index('by_player_year_month', ['playerId', 'year', 'month']),

  // DERIVED BY DELTA from leagueMemberMonth (lib/league.ts groupDelta), so a
  // board write costs O(1) however large the group is.
  leagueGroupMonth: defineTable({
    leagueId: v.id('leagues'),
    groupId: v.id('leagueGroups'),
    year: v.number(),
    month: v.number(),
    boards: v.number(),
    attempts: v.number(),
    // Members with boards > 0 this month.
    contributors: v.number(),
  })
    .index('by_league_year_month', ['leagueId', 'year', 'month'])
    .index('by_group_year_month', ['groupId', 'year', 'month']),

  // THE FROZEN SNAPSHOT, and authoritative for every closed month. Never
  // rewritten: a board backfilled into a closed month must not restate who won
  // (§4.1, the zic8.2 §6 reason).
  leagueMonthResults: defineTable({
    leagueId: v.id('leagues'),
    year: v.number(),
    month: v.number(),
    standings: v.array(
      v.object({
        groupId: v.id('leagueGroups'),
        boards: v.number(),
        attempts: v.number(),
        // null below MIN_LEAGUE_BOARDS (lib/league.ts).
        average: v.union(v.number(), v.null()),
        contributors: v.number(),
      }),
    ),
    // null = no group qualified OR an exact tie.
    winnerGroupId: v.union(v.id('leagueGroups'), v.null()),
    closedAt: v.number(),
  }).index('by_league_year_month', ['leagueId', 'year', 'month']),

  statusMessages: defineTable({
    message: v.string(),
  }),

  testOtps: defineTable({
    email: v.string(),
    otp: v.string(),
  }).index('by_email', ['email']),
})
