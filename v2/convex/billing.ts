import { v } from 'convex/values'
import { internalMutation, internalQuery, query } from './_generated/server'
import { currentPlayer } from './access'
import { isAcknowledgedEvent, mapEventToTransition } from './lib/polarEvents.ts'
import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'
import { cascadeDeleteTeam } from './teams.ts'
import type { DataModel, Doc, Id } from './_generated/dataModel'
import type { GenericDatabaseReader } from 'convex/server'
import type { WriterCtx } from './winners.ts'

/**
 * Billing. Phase 5 (wt-ksh.6).
 *
 * THIS MODULE OWNS WHAT A MEMBERSHIP CHANGE DOES TO APPLICATION STATE — the
 * transitions between free and pro, and the free-tier limits that get applied
 * when a subscription ends. It is deliberately not the Polar module: talking to
 * Polar (checkout, the customer portal, webhook verification) is transport, and
 * this is the part that has to be true regardless of who the payment processor
 * is. That separation is why a webhook handler can be tested against a captured
 * payload while the rules below are tested against the database alone.
 *
 * EVERY RULE HERE LIVES IN A `...For` HELPER TAKING EXPLICIT ARGUMENTS — a
 * playerId, or the candidates that resolve TO one — never in a function that
 * reads the session. (This said "taking an explicit playerId" when the module
 * had a single export; resolvePlayerIdFor returns a playerId rather than taking
 * one, so the narrower wording became false of half of them. It then said
 * EVERYTHING here was such a helper, which myPendingInviteCount falsified.)
 * convex-test cannot stand up a Better Auth session (wordle-teams-obw), so logic
 * behind a mutation or query wrapper is logic no unit test can reach. The
 * wrappers that do read the session are thin and live next to the code that
 * needs them — myPendingInviteCount is the only one so far, and it resolves the
 * caller and delegates in three lines.
 */

/**
 * Anything with a `db` reader — a query, mutation, or a convex-test `ctx.run`.
 *
 * Mirrors access.ts's and scores.ts's ReaderCtx exactly, for the same reason:
 * resolvePlayerIdFor only ever touches `ctx.db`, and keeping the parameter type
 * to just that lets convex-test's `t.run` callback ctx (a real
 * GenericMutationCtx, structurally a `db: GenericDatabaseWriter`, itself a
 * GenericDatabaseReader) satisfy it with no cast.
 */
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

/**
 * Turn Polar identity candidates into a real player id, taking the first
 * candidate that names a LIVE player.
 *
 * Pairs with lib/polarIdentity.ts's extractIdentityCandidates, which produces
 * the ordered array this takes. That module is pure because it only reads a
 * webhook body; this half needs ctx.db, which is why the two are separate.
 *
 * TWO NAMESPACES, AND THE SECOND IS NOT AN EDGE CASE. v1's
 * `src/lib/polar/checkout.ts:22` set `externalCustomerId` to the v1 player id —
 * a Postgres uuid — and v2 stores that uuid as `players.legacyId`. So after
 * cutover EVERY existing subscriber's renewal, cancellation and revocation
 * arrives carrying a string that `normalizeId` rejects. That is the opposite of
 * the null-external-id failure: the id is populated and well formed, it just
 * belongs to the other namespace. Resolving only Convex ids would silently 202
 * every paying customer, on revocation.
 *
 * NO SHAPE CHECK. v1 gated every candidate on a uuid regex; see the note in
 * lib/polarIdentity.ts for why that cannot be ported in either direction. The
 * question "is this real" is answered here, by looking it up.
 *
 * RETURNS NULL RATHER THAN THROWING. The caller answers HTTP 202, because a
 * foreign or unknown external id is not a transient fault and retrying can
 * never fix it. Returning 500 there would put Polar into an endless redelivery
 * loop over an event this app can do nothing with — for instance one belonging
 * to a different integration on the same Polar organization. THE CALLER NOW
 * EXISTS and honours it: the webhook in convex/http.ts (Task 10,
 * wordle-teams-p8m) reaches this through `resolvePlayerId` below and answers
 * 202 on null.
 *
 * THE ONE EXCEPTION IS DELIBERATE: the `.unique()` below throws if two players
 * share a legacyId, and that SHOULD be a 500. Duplicate legacyIds mean the copy
 * has corrupted the table, which is transient in the only sense that matters —
 * someone can fix the data and Polar's redelivery then succeeds. Answering 202
 * would discard the event and hide the corruption. Unreachable today: the only
 * writer of players.legacyId is migrate.ts, whose byLegacyId (migrate.ts:31)
 * upserts through the same `.unique()` and so throws before it can create a
 * second one. This note stands ahead of any future native writer of the field,
 * which is what would make it reachable.
 *
 * NO ACCESS CHECK OF ITS OWN, like everything else in this module. The
 * authority is the verified Polar event; there is no session on a webhook.
 */
export async function resolvePlayerIdFor(
  ctx: ReaderCtx,
  candidates: readonly string[],
): Promise<Id<'players'> | null> {
  for (const raw of candidates) {
    // 1. A Convex id: a checkout this v2 created.
    //
    // THE `get` IS NOT REDUNDANT. normalizeId validates that the string is a
    // well-formed id FOR THIS TABLE; it says nothing about whether the document
    // is still there. Returning a deleted player's id would hand the caller an
    // id whose patch throws inside the transaction — a 500, and an endless
    // Polar retry over an event that can never succeed.
    const direct = ctx.db.normalizeId('players', raw)
    if (direct && (await ctx.db.get(direct))) return direct

    // 2. A v1 uuid: every customer that came across at cutover. by_legacyId is
    //    an index, so a miss here costs no scan.
    const legacy = await ctx.db
      .query('players')
      .withIndex('by_legacyId', (q) => q.eq('legacyId', raw))
      .unique()
    if (legacy) return legacy._id

    // A candidate that names nothing is skipped, not fatal: the happy-path
    // customer.external_id can be stale or foreign while the metadata we set
    // ourselves is still correct.
  }

  return null
}

/**
 * `resolvePlayerIdFor` for a caller with no `ctx.db`.
 *
 * THE WEBHOOK IS AN httpAction, AND ACTIONS CANNOT TOUCH THE DATABASE — the
 * same constraint that put `checkoutIdentity` in polar.ts. So the resolution the
 * handler needs before it can store anything has to cross a `ctx.runQuery`, and
 * this is the crossing. Internal because the webhook is its only caller and
 * because handing the public API a "turn these strings into a player id"
 * endpoint would let anyone probe which external ids name real players.
 *
 * A QUERY, NOT PART OF processPolarEvent, deliberately. Resolution has to
 * happen BEFORE the storing mutation runs, because an unresolvable event is
 * answered 202 and never stored at all — `webhookEvents.playerId` is
 * `v.id('players')` and there is no row to attribute it to. Folding it into the
 * mutation would mean either inventing a placeholder player or making the
 * mutation return a third outcome the transaction has no use for.
 *
 * THIN, so billing.ts's rule holds: the decision is `resolvePlayerIdFor`'s and
 * is unit-tested directly against ctx.db, with no wrapper in the way.
 */
export const resolvePlayerId = internalQuery({
  args: { candidates: v.array(v.string()) },
  handler: async (ctx, { candidates }): Promise<Id<'players'> | null> =>
    await resolvePlayerIdFor(ctx, candidates),
})

/**
 * An address reduced to what it can be COMPARED by, mirroring
 * normaliseInviteEmail's trim().toLowerCase() on write — the same read-side
 * normalisation invitePlayerFor, cancelInviteFor and completeProfileFor all
 * apply to this field.
 *
 * BOTH OPERATIONS EARN THEIR PLACE, and cancelInviteFor sets out why they are
 * not the same strength: toLowerCase is defence in depth against a future
 * writer, since both copy gates already lowercase, while trim is not covered by
 * anything — neither gate trims, so a padded v1 address survives the copy
 * intact.
 *
 * NOT normaliseInviteEmail ITSELF, which is lib/invite.ts's WRITE-boundary
 * validator and returns null for anything failing its shape regex. Both values
 * compared below are already stored — one off a player row, one out of
 * `teams.invited` — so there is no input to reject here, and refusing to match
 * on shape would strand an address the regex happens to dislike.
 *
 * NOT NAMED normaliseFor…: in this module that suffix means a helper taking an
 * explicit playerId, and this is a string function.
 */
const matchKey = (address: string) => address.trim().toLowerCase()

/**
 * The teams holding an invite parked against this player's address, plus the
 * address that matched them.
 *
 * ONE SELECTION, TWO CALLERS, WHICH IS WHAT DECISION G BUYS. The release below
 * and the count below it must agree on WHICH ADDRESS MATCHES WHICH ENTRY, and
 * the only way they cannot disagree is by asking that question once, here.
 * v1's answer was a counter written from five call sites using two different
 * formulas, so it could drift from `teams.invited` even in v1. (The count then
 * narrows this set — it excludes teams the player is already on — but it cannot
 * widen it, so no team can be counted that the upgrade would not clear.)
 *
 * NULL RATHER THAN AN EMPTY LIST WHEN THE PLAYER ROW IS GONE, because the two
 * callers want different things from that case and neither of them wants "this
 * player has no invites" — one does nothing, the other answers 0. A missing row
 * is reachable: a deletion can race a Polar redelivery, and throwing there is a
 * 500 and an endless retry over an event that can never succeed.
 *
 * MATCHED BY KEY, NOT BY EQUALITY (see matchKey), because `invited` is lowercase
 * by schema rule only for rows v2 wrote — a copied v1 row predates that rule.
 * A missed entry is not strictly unclearable: invitePlayerFor's add branch and
 * cancelInviteFor normalise the same way and would clear it. But both of those
 * need the team's OWNER to act again, and nothing prompts them to — their invite
 * list still shows the address as outstanding. This is the only exit the invited
 * player can reach on their own.
 *
 * Collect-and-filter, because Convex cannot index array membership — the same
 * read getMyTeamsFor, myData and downgradeTeamRemovalFor already do, over the
 * 171 teams the schema comment on `teams` records.
 */
async function parkedInvitesFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
): Promise<{ email: string; teams: Doc<'teams'>[] } | null> {
  const player = await ctx.db.get(playerId)
  if (!player) return null

  const email = matchKey(player.email)
  const allTeams = await ctx.db.query('teams').collect()
  return {
    email,
    teams: allTeams.filter((team) => team.invited.some((entry) => matchKey(entry) === email)),
  }
}

/**
 * Release every invite parked against this player's address, on upgrade.
 *
 * Ports v1's handle_upgrade_team_invites (20240426190809): for every team whose
 * `invited` holds their email, remove the email and append their id.
 *
 * KEYS OFF `teams.invited`, NOT OFF A COUNTER, and that is what makes decision
 * D safe. v1's invites_pending_upgrade lives in auth.users.raw_app_meta_data,
 * which the copy script does not read and must not start reading. The parking
 * itself is in `teams.invited`, which IS copied — so a migrated v1 user with
 * parked invites is released correctly here even though v2 never saw their
 * counter.
 *
 * NO COUNTER TO ZERO. v1 follows the UPDATE with a second statement setting
 * invites_pending_upgrade to 0; v2 derives the count (pendingInviteCountFor),
 * so dropping the address IS the update and the two cannot disagree.
 *
 * ONE PATCH, TWO FIELDS, exactly as invitePlayerFor's add branch: the address
 * must leave `invited` in the same write that puts the player on the roster, or
 * they read as a member and as pending at the same time.
 *
 * THE DOUBLE-ADD GUARD IS A DIVERGENCE FROM v1, whose `array_append` is
 * unconditional. A team listing the same person in BOTH playerIds and `invited`
 * is exactly what the copy brings over, since v1 never removed an invite it
 * could not match, so the faithful port would put a copied member on their own
 * roster twice — invitePlayerFor documents the same hazard on its
 * already-a-member branch. Visiting the team is still correct: clearing the
 * stale address is the only thing left to do there.
 *
 * THE CAP NOW PARKS INVITES, AND FOR MOST OF THEM THIS IS THE ONLY EXIT. This
 * helper was built first, before the cap existed, because the release half is
 * what makes the cap safe to add; Task 8 (wordle-teams-qyd) then added the
 * parking half in BOTH the places v1 has it — teams.ts's invitePlayerFor and
 * players.ts's completeProfileFor. So the entries this finds come from three
 * places: the copy, invitePlayerFor parking an address with no account, and
 * invitePlayerFor parking a non-pro invitee already on FREE_TEAM_LIMIT teams.
 *
 * THE THIRD IS UNREACHABLE BY ANY OTHER EXIT, because a capped invitee already
 * HAS a player row and so never goes near completeProfileFor. THE FIRST TWO ARE
 * ONLY PARTLY REACHABLE BY IT: completeProfileFor claims them when the person
 * completes a profile at that address, but since Phase 5 it claims at most
 * FREE_TEAM_LIMIT of them and LEAVES THE SURPLUS PARKED — and a second submit
 * leaves the same surplus, because that cap counts teams already held. So an
 * address invited to more teams than the cap allows before signing up joins
 * FREE_TEAM_LIMIT of them and keeps the rest as entries nothing but an upgrade
 * will clear. Measured, not reasoned: players.test.ts's "the invites the cap
 * held back are released by the upgrade path" seeds FREE_TEAM_LIMIT + 2 such
 * teams, and the 2 left over are released HERE and only here.
 *
 * (This paragraph previously claimed the first two were always claimed by
 * completeProfileFor. Task 8 falsified that in the same commit that wrote it,
 * by capping completeProfileFor.)
 *
 * NO ACCESS CHECK OF ITS OWN, like everything else in this module: the
 * authority is the verified Polar event that activated the subscription.
 */
export async function upgradeTeamInvitesFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
): Promise<void> {
  const parked = await parkedInvitesFor(ctx, playerId)
  if (!parked) return

  for (const team of parked.teams) {
    await ctx.db.patch(team._id, {
      playerIds: team.playerIds.includes(playerId)
        ? team.playerIds
        : [...team.playerIds, playerId],
      // EVERY matching entry, not the first, for the reason cancelInviteFor
      // gives: one address can be parked twice in two shapes, and the leftover
      // reads as an outstanding invite to a member.
      invited: team.invited.filter((entry) => matchKey(entry) !== parked.email),
    })
  }
}

/**
 * How many invites this player is actually waiting on.
 *
 * DERIVED, NOT STORED (decision G), and the difference is user-visible. v1's
 * counter is not vestigial — it drives a "N Invites Pending" badge, non-pro
 * only — but it is written from five call sites using two different formulas,
 * so it can drift from `teams.invited` even in v1, and it is not copied, so
 * every migrated user would read 0 while holding real parked invites. Derived,
 * it cannot drift, needs no backfill, and needs no `players` schema field.
 *
 * A TEAM THEY ARE ALREADY ON DOES NOT COUNT, and this is the one place the
 * count deliberately says something narrower than the release. The state is not
 * hypothetical — upgradeTeamInvitesFor's own note calls a member listed in both
 * `playerIds` and `invited` exactly what the copy brings over — and counting it
 * would show a non-pro migrated user "1 Invite Pending" for a team they are
 * already a member of, with nothing to accept and nothing to click. Replacing a
 * counter that could drift with a derivation that over-counts would leave
 * decision G ahead on provenance and level on outcome.
 *
 * THE EXCLUSION LIVES HERE AND MUST NOT MOVE INTO parkedInvitesFor. The release
 * has to visit precisely those teams in order to clear the stale address; a
 * shared filter would strand every one of them, which is the same bug seen from
 * the other end.
 *
 * COUNTS TEAMS, NOT ENTRIES. One address parked twice on one team in two shapes
 * is one pending invite to the person holding it.
 *
 * NO CONSUMER YET: the badge is Task 11 (wordle-teams-ksh), so this count is
 * stated ahead of the UI it feeds.
 */
export async function pendingInviteCountFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
): Promise<number> {
  const parked = await parkedInvitesFor(ctx, playerId)
  if (!parked) return 0
  return parked.teams.filter((team) => !team.playerIds.includes(playerId)).length
}

/**
 * The "N Invites Pending" badge for the signed-in caller.
 *
 * Ports v1's user-dropdown.tsx:182, which reads a counter out of the JWT's
 * app_metadata; v2 derives the number instead — see pendingInviteCountFor.
 *
 * THE ONE WRAPPER IN THIS MODULE, and it lives here rather than beside amIPro in
 * teams.ts for one measured reason: teams.ts would then have to import this
 * module, and billing.ts already imports cascadeDeleteTeam from teams.ts. That
 * is a cycle bought by six lines. The two edges are not equal — cascadeDeleteTeam
 * is a real dependency — and teams.ts's own amIPro shows the cycle-free shape,
 * calling isProFor from access.ts, a leaf.
 *
 * currentPlayer AND 0, NOT requirePlayer, mirroring amIPro: this is chrome, and
 * a signed-out or profile-less caller asking for a badge is not an error worth
 * throwing at them.
 *
 * NO CONSUMER YET: Task 11 (wordle-teams-ksh) adds the badge that reads
 * api.billing.myPendingInviteCount.
 */
export const myPendingInviteCount = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return 0
    return await pendingInviteCountFor(ctx, player._id)
  },
})

/**
 * Apply the free-tier team limit after a subscription is revoked.
 *
 * SOFTENED — DELIBERATELY NOT A FAITHFUL PORT. Divergence 12.
 *
 * v1's handle_downgrade_team_removal keeps 2 teams, removes the player from the
 * rest, and then DELETES the teams they created beyond the keep list — taking
 * every other member's scores and monthly-winner history with them. A billing
 * event on one account destroying a third party's data is not behaviour worth
 * porting, so v2 reassigns instead and deletes only a team nobody is left on.
 *
 * PORTED FROM 20240501193430, NOT 20240501191728. The latter is the version the
 * Phase 5 epic named, and it carries a real defect: `id != any(teams_to_keep)`
 * is true whenever id differs from AT LEAST ONE element, so with two kept ids
 * every id qualifies and it deletes the teams it just decided to keep. The
 * later migration replaces both occurrences with NOT IN (SELECT UNNEST(...)).
 *
 * THE KEEP-2 ORDERING, MEASURED RATHER THAN TRANSLITERATED. v1's query is
 * `select unnest(array_agg(id)) ... group by creator, created_at
 *  order by (case when creator = player then 0 else 1 end), created_at limit 2`.
 * Whether LIMIT bounds groups or expanded rows decides whether it can keep
 * three teams. Measured against PostgreSQL 15.1: it bounds EXPANDED ROWS, so
 * this keeps exactly two — owned first, then oldest.
 *
 * NO ACCESS CHECK OF ITS OWN. The authority is the verified Polar event that
 * revoked the subscription, not the caller's session; there is no session on a
 * webhook. Every caller owes the verification that establishes it.
 */
export async function downgradeTeamRemovalFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
): Promise<void> {
  // Collect-and-filter, because Convex cannot index array membership — the
  // schema comment on `teams` records the production count that makes this
  // fine, and getMyTeamsFor reads the table the same way.
  const allTeams = await ctx.db.query('teams').collect()
  const mine = allTeams.filter((team) => team.playerIds.includes(playerId))

  // Owned first, then oldest. Mirrors getMyTeamsFor's `createdAt ?? 0`, which
  // is how a copied row with no timestamp sorts.
  const ordered = [...mine].sort((a, b) => {
    const owned = Number(b.owner === playerId) - Number(a.owner === playerId)
    if (owned !== 0) return owned
    return (a.createdAt ?? 0) - (b.createdAt ?? 0)
  })

  // FREE_TEAM_LIMIT, never a literal 2: team-picker.tsx reads the same constant
  // to swap "New Team" for "Upgrade for more", and a second literal is how the
  // client-side swap and this server-side check drift apart.
  for (const team of ordered.slice(FREE_TEAM_LIMIT)) {
    const remaining = team.playerIds.filter((id) => id !== playerId)

    // NOBODY LEFT. Only here is a delete correct, and it must cascade — a bare
    // db.delete orphans the team's monthlyWinners and scoringSystems rows.
    // copy-filters.mjs already establishes that a team with nobody on it is not
    // a team.
    if (remaining.length === 0) {
      await cascadeDeleteTeam(ctx, team)
      continue
    }

    await ctx.db.patch(team._id, {
      playerIds: remaining,
      // Reassign only if they owned it. playerIds is append-ordered, so [0] of
      // the remainder is the earliest-joined member — v2 has no joinedAt, and
      // inventing one to answer this would be a schema change for a tiebreak.
      //
      // RULED OUT: leaving the team owner-less. V2-ADDENDUM records that an
      // owner-less team cannot be edited by anyone, so manufacturing that state
      // deliberately is worse than reassigning.
      //
      // This only ever fires for a player who owns THREE OR MORE teams — the
      // keep-2 ordering puts every owned team ahead of every other one, so an
      // owner of two or fewer never reaches the slice.
      ...(team.owner === playerId ? { owner: remaining[0] } : {}),
    })
  }
}

/**
 * What a stored-and-applied delivery can come back as.
 *
 * TWO, WHERE v1's `WebhookOutcome` HAS FOUR, and the two missing ones are
 * missing because this mutation cannot be the thing that decides them. v1's
 * `ignored` (no such player) is settled BEFORE the mutation runs — an
 * unresolvable event never reaches here, because `webhookEvents.playerId` is
 * `v.id('players')` and there is nobody to attribute the row to; the webhook
 * answers 202. v1's `failed` is a THROW here rather than a value, which is the
 * whole of divergence 13: a returned failure would leave the partial writes in
 * place, and a throw rolls them back. convex/http.ts maps these onto status
 * codes.
 */
export type WebhookOutcome = 'processed' | 'duplicate'

/**
 * Store and apply one verified Polar webhook. ONE TRANSACTION, START TO FINISH.
 *
 * Ports v1's `handlePolarEvent` (src/lib/polar/webhook.ts), whose retry design
 * is decorative. v1 inserts the row, then updates membership, then calls an
 * RPC, as three separate statements — so a failure half way leaves the row
 * behind, and `markProcessed` then stamps `processed: true` ALONGSIDE the error
 * string. The route answers 500, Polar redelivers, the redelivery's INSERT hits
 * the partial unique index, the code maps that to `duplicate` and answers 200,
 * and the event is lost permanently while the audit row claims it was handled.
 *
 * A CONVEX MUTATION REMOVES THAT FAILURE MODE STRUCTURALLY. The insert, the
 * membership write and the team changes are one transaction, so a throw
 * anywhere rolls back all of it and the row simply is not there — or, if it was
 * already there from an earlier failed attempt, is unchanged and still
 * unprocessed. There is no state in which this leaves `processed: true` next to
 * an error.
 *
 * THE REPLAY GUARD KEYS ON `processed`, NOT ON ROW EXISTENCE. Decision E,
 * divergence 13, and the second half of the phase's acceptance criterion 3. A
 * row that EXISTS but never completed is a delivery this app still owes, so it
 * is picked up and finished; only a row that completed is a replay. Guarding on
 * existence instead is precisely v1's bug, and it is what CONTROL A of this
 * task's mutation testing reintroduces to prove the tests can see it.
 *
 * THE ROW IS REUSED, NOT RE-INSERTED, on that retry. Convex has no unique
 * constraints — the by_webhookId index is not one — so nothing but this lookup
 * stops one delivery from accumulating a row per attempt.
 *
 * NO ACCESS CHECK, like everything else in this module: the authority is the
 * signature the webhook verified, and there is no session on a webhook. Every
 * caller owes that verification. Internal so that authority cannot be
 * bypassed — a public mutation taking `{ playerId, eventName }` would be a
 * grant-yourself-Pro endpoint, which is wordle-teams-8uk in v1 and the reason
 * v1's module carries its "MUST NOT CARRY 'use server'" warning.
 */
export const processPolarEvent = internalMutation({
  args: {
    webhookId: v.string(),
    eventName: v.string(),
    body: v.any(),
    playerId: v.id('players'),
  },
  handler: async (ctx, { webhookId, eventName, body, playerId }): Promise<WebhookOutcome> => {
    const existing = await ctx.db
      .query('webhookEvents')
      .withIndex('by_webhookId', (q) => q.eq('webhookId', webhookId))
      .first()

    // A GENUINE REPLAY, and only this is one. Standard Webhooks redelivers
    // anything non-2xx, so replays are routine and must cost nothing and change
    // nothing.
    //
    // `.first()` rather than `.unique()`: two rows for one delivery should be
    // impossible — every writer of this table goes through the lookup above or
    // recordWebhookFailure's — but if one ever appeared, `.unique()` would
    // throw, and this event would then answer 500 to every redelivery forever.
    if (existing?.processed) return 'duplicate'

    // THE EXISTING ROW IS REUSED AS IT STANDS: `body`, `eventName` and
    // `playerId` are not rewritten from this attempt's arguments. A redelivery
    // carries the same delivery id and the same bytes, so they agree — unless
    // identity resolved DIFFERENTLY between the two attempts, which needs a
    // player row to have appeared or vanished in between. The cost of that is
    // an audit row naming the first attempt's player while the membership write
    // below goes to this one's; the membership write itself is never wrong,
    // because it uses the argument and not the row. Left alone deliberately:
    // patching them would make the audit trail describe the last attempt rather
    // than the delivery, and it is the delivery that Polar redelivers.
    const rowId =
      existing?._id ??
      (await ctx.db.insert('webhookEvents', {
        webhookId,
        playerId,
        eventName,
        body,
        processed: false,
        createdAt: Date.now(),
      }))

    const transition = mapEventToTransition(eventName)

    if (transition) {
      const membership = await ctx.db
        .query('playerMembership')
        .withIndex('by_player', (q) => q.eq('playerId', playerId))
        .first()

      if (membership) {
        await ctx.db.patch(membership._id, { membershipStatus: transition.status })
      } else {
        // A PLAYER BORN IN v2 HAS NO MEMBERSHIP ROW UNTIL THEY PAY, and this is
        // where the first one comes from. Legal only since Task 3
        // (wordle-teams-h9k) made `legacyId` optional on this table; before
        // that, every row had to name a Supabase one. No legacyId is written
        // here on purpose — its absence is what says "born in v2, not copied",
        // which Phase 7's reconciliation reads.
        await ctx.db.insert('playerMembership', {
          playerId,
          membershipStatus: transition.status,
        })
      }

      // A SWITCH, NOT AN if/else ON ONE EFFECT. With two effects the two shapes
      // behave identically; they diverge the moment a third is added, where
      // `else downgradeTeamRemovalFor(...)` would silently strip the teams of
      // whoever the new effect was meant for.
      switch (transition.effect) {
        case 'release-invites':
          await upgradeTeamInvitesFor(ctx, playerId)
          break
        case 'apply-team-limit':
          await downgradeTeamRemovalFor(ctx, playerId)
          break
        default: {
          // THE ASSIGNMENT IS THE POINT, not the throw: a third member of
          // MembershipEffect makes this line stop compiling (measured, by
          // adding one), which is the only version of "the switch is
          // exhaustive" that a later editor cannot walk past. Bare cases with
          // no default compile fine and do nothing, which is the silent
          // failure this exists to prevent.
          const unhandled: never = transition.effect
          throw new Error(`Unhandled membership effect: ${String(unhandled)}`)
        }
      }
    } else if (!isAcknowledgedEvent(eventName)) {
      // NULL MEANS TWO THINGS and only one of them is worth a log line.
      // `subscription.canceled` and `subscription.past_due` are recognised and
      // deliberately inert — the customer keeps paid access to the end of the
      // period they bought, so downgrading here would strip a paying customer's
      // teams weeks early. Anything else is an event nobody taught this app
      // about, and a quiet no-op would be how a real Polar event goes unhandled
      // for a month. Both still store the row: the audit trail is the point.
      console.warn('[polar] unhandled webhook event', { eventName, webhookId })
    }

    // `processingError: undefined` REMOVES the field rather than storing an
    // undefined — the one state v1 can reach and this must not, a row that is
    // processed and still carries the error from the attempt before it.
    await ctx.db.patch(rowId, { processed: true, processingError: undefined })
    return 'processed'
  },
})

/**
 * Record that a delivery failed — OUTSIDE the transaction that failed.
 *
 * NO v1 PRECEDENT, AND IT IS THE PRICE OF divergence 13. v1 can write the error
 * onto the row from inside its own handler because its statements are not
 * transactional; that same property is what loses the event. Here the rollback
 * is what makes the retry correct, and the rollback would take the evidence
 * with it — so the audit row is written by a SEPARATE mutation, which
 * convex/http.ts calls from the catch block after `processPolarEvent` has
 * already thrown and rolled back.
 *
 * `processed` STAYS FALSE, which is not incidental bookkeeping: it is exactly
 * what lets the redelivery pick the event up and finish it. A row written here
 * and a row written by a rolled-back attempt are the same thing to the guard in
 * processPolarEvent.
 *
 * IT WILL NOT UN-PROCESS AN ALREADY-PROCESSED ROW. The normal path cannot reach
 * one — a processed row returns `duplicate` and never throws — but a mutation
 * that COMMITTED and then failed to report back to the action would, and
 * flipping that row to `processed: false` would replay a membership change that
 * already happened. So the patch touches the error alone and leaves `processed`
 * as it found it.
 */
export const recordWebhookFailure = internalMutation({
  args: {
    webhookId: v.string(),
    eventName: v.string(),
    body: v.any(),
    playerId: v.id('players'),
    processingError: v.string(),
  },
  handler: async (ctx, { webhookId, eventName, body, playerId, processingError }) => {
    const existing = await ctx.db
      .query('webhookEvents')
      .withIndex('by_webhookId', (q) => q.eq('webhookId', webhookId))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, { processingError })
      return
    }

    await ctx.db.insert('webhookEvents', {
      webhookId,
      playerId,
      eventName,
      body,
      processed: false,
      processingError,
      createdAt: Date.now(),
    })
  },
})
