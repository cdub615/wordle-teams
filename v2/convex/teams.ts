import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import {
  accessError,
  currentPlayer,
  isProFor,
  playerForEmail,
  requirePlausibleToday,
  requirePlayer,
  requireTeamCreatorFor,
} from './access'
import { resend } from './email'
import { teamInviteEmail } from './inviteEmails.ts'
import { normaliseInviteEmail } from './lib/invite.ts'
import { DEFAULT_SYSTEM } from './lib/scoringSystem.ts'
import { monthsWithWinners, recomputeTeamMonths } from './winners.ts'
import type { Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseReader } from 'convex/server'
import type { WriterCtx } from './winners.ts'
import type { PuzzleDay } from './lib/puzzleDay.ts'

/**
 * Team management. Phase 3 (wt-ksh.4).
 *
 * THIS MODULE OWNS TEAM IDENTITY AND MEMBERSHIP — name, playerIds, creator,
 * playWeekends, showLetters — and nothing else. A team's scoring system lives
 * in scoringSystems.ts, which touches the scoringSystems table exclusively and
 * never these fields (wt-ksh.4.32). Invites landed HERE in Phase 4, where this
 * comment said they would: adding and removing people is membership, and
 * removeMember is invitePlayer's nearest sibling. The invite COPY lives in
 * inviteEmails.ts, mirroring the authEmails.ts split.
 *
 * getMyTeams moved here from scores.ts and grew members, creator and settings,
 * so that ONE subscription drives the picker, the CurrentTeam card and the
 * MyTeams card.
 *
 * Splitting it into a thin picker query plus a scoped per-team detail query
 * would NOT have been cheaper: the read set is the entire teams table either
 * way, because Convex cannot index array membership (see the schema comment on
 * `teams`), so the split doubles subscriptions without shrinking what a write
 * invalidates. What is on the wire stays small — a player's own teams, one to
 * six of them.
 *
 * The cost that does exist: a write to ANY team invalidates this subscription
 * for EVERY connected client. Phase 3 raises team-write frequency, which is the
 * condition scores.ts flagged as the trigger to revisit. Acceptable at 171
 * teams and ~40 DAU; revisit if either number moves, not simply because the
 * table grows.
 */

type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

export async function getMyTeamsFor(ctx: ReaderCtx, playerId: Id<'players'>) {
  const allTeams = await ctx.db.query('teams').collect()
  const mine = allTeams
    .filter((team) => team.playerIds.includes(playerId))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))

  // Convex functions run inside a single snapshot-isolated transaction, so
  // this is about round trips, not correctness — the outer Promise.all over
  // teams and the inner one over each team's members both resolve inside the
  // same transaction regardless of how they're awaited. At the realistic
  // ceiling (six teams, ~eight members each, per the two-team-cap-for-free /
  // pro-team-count context) that's under 60 reads total, all against a single
  // snapshot. Ordering is deterministic despite the concurrency: `mine` is
  // sorted by createdAt before the outer Promise.all runs, and Promise.all
  // preserves input order in its resolved array regardless of which promise
  // settles first, so both team order and, within a team, member order
  // (`team.playerIds` order) survive untouched.
  return await Promise.all(
    mine.map(async (team) => {
      const resolved = await Promise.all(
        team.playerIds.map(async (memberId) => {
          const member = await ctx.db.get(memberId)
          // A ROSTER ENTRY WITH NO PLAYER ROW. Convex ids are not foreign keys
          // and the schema enforces no referential integrity, so nothing at the
          // database level guarantees that every id in `team.playerIds` still
          // resolves. Without this the read would throw on `member.firstName`
          // and take the whole team list down — every team the caller is on,
          // not just this one.
          //
          // NOT THE SAME CHECK as the profile-completeness filter that used to
          // sit beside it. That one is gone, because players.firstName/lastName
          // became required in Phase 4, so a name can no longer be ABSENT. It
          // can still be EMPTY — v.string() accepts '' — so "unnamed" is kept
          // out by the writers (isCompleteName in lib/invite.ts, isNamed in
          // scripts/lib/copy-filters.mjs), not by the schema. A missing
          // DOCUMENT is a third state again, and is still representable via a
          // scoped copy — do not read the deletion of the name filter as
          // evidence this null check is dead too.
          if (!member) return null
          return { id: member._id, firstName: member.firstName, lastName: member.lastName }
        }),
      )

      return {
        id: team._id,
        name: team.name,
        // Not `creator` itself: the caller only ever needs to know whether the
        // buttons are theirs, and a raw creator id is one more thing on the wire.
        isCreator: team.creator === playerId,
        playWeekends: team.playWeekends,
        showLetters: team.showLetters,
        // Fields are picked explicitly rather than spreading the doc, so the
        // wire payload cannot carry `invited`, which holds real email addresses.
        members: resolved.filter((member): member is NonNullable<typeof member> => member !== null),
      }
    }),
  )
}

export const getMyTeams = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return []
    return await getMyTeamsFor(ctx, player._id)
  },
})

/**
 * Whether the caller is on the pro plan, for the two UI gates v1 has: the
 * scoring editor, and "New Team" swapping to "Upgrade for more" past two teams.
 * Nothing is enforced server-side — see isProFor.
 */
export const amIPro = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return false
    return await isProFor(ctx, player._id)
  },
})

function requireName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw accessError('INVALID_TEAM')
  return trimmed
}

export type TeamSettings = { name: string; playWeekends: boolean; showLetters: boolean }

/**
 * Create a team, with the caller as its only member and its creator.
 *
 * NO SERVER-SIDE TEAM CAP. v1 shows "Upgrade for more" once a free account has
 * two teams, but that is UI only — nothing stops a free account creating five
 * through the API. Phase 3 reproduces the gate where v1 has it. Phase 5 owns
 * whether it becomes real.
 */
export async function createTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  settings: TeamSettings,
): Promise<Id<'teams'>> {
  return await ctx.db.insert('teams', {
    name: requireName(settings.name),
    creator: playerId,
    playerIds: [playerId],
    invited: [],
    playWeekends: settings.playWeekends,
    showLetters: settings.showLetters,
    createdAt: Date.now(),
    // The ORIGINAL system. The editor writes scoringSystems rows from here on
    // and never touches these eight fields again — see lib/scoringSystem.ts.
    ...DEFAULT_SYSTEM,
  })
}

export const createTeam = mutation({
  args: { name: v.string(), playWeekends: v.boolean(), showLetters: v.boolean() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    return await createTeamFor(ctx, player._id, args)
  },
})

/**
 * Rename a team and set its two flags.
 *
 * RECOMPUTES EVERY MONTH WITH A WINNER ROW WHEN playWeekends FLIPS, and nothing
 * otherwise. playWeekends is an input to monthTotal — turning it off removes
 * every Saturday and Sunday from every month's total — so leaving the stored
 * winners alone would leave the card and the scoreboard disagreeing on the same
 * screen. A rename changes no total and triggers no recompute.
 */
export async function updateTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: TeamSettings & { teamId: Id<'teams'>; today: PuzzleDay },
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const today = requirePlausibleToday(args.today)
  const name = requireName(args.name)
  const weekendsChanged = team.playWeekends !== args.playWeekends

  await ctx.db.patch(team._id, {
    name,
    playWeekends: args.playWeekends,
    showLetters: args.showLetters,
  })

  if (!weekendsChanged) return
  const updated = (await ctx.db.get(team._id))!
  await recomputeTeamMonths(ctx, updated, await monthsWithWinners(ctx, team._id), today)
}

export const updateTeam = mutation({
  args: {
    teamId: v.id('teams'),
    name: v.string(),
    playWeekends: v.boolean(),
    showLetters: v.boolean(),
    today: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await updateTeamFor(ctx, player._id, args)
  },
})

/**
 * Delete a team, CASCADING BY HAND.
 *
 * Postgres has ON DELETE CASCADE on monthly_winners.team_id; Convex has no such
 * thing, so the rows have to go explicitly or they become unreachable orphans
 * that still count against the free tier and still turn up in a parity
 * reconciliation.
 *
 * dailyScores are NOT deleted. A board belongs to a player and is shared across
 * every team they are on — daily_scores has no team foreign key in Postgres
 * either — so deleting a team must never destroy anybody's history.
 */
export async function deleteTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, teamId)

  const winners = await ctx.db
    .query('monthlyWinners')
    .withIndex('by_team_year_month', (q) => q.eq('teamId', team._id))
    .collect()
  for (const row of winners) await ctx.db.delete(row._id)

  const systems = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', team._id))
    .collect()
  for (const row of systems) await ctx.db.delete(row._id)

  await ctx.db.delete(team._id)
}

export const deleteTeam = mutation({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    await deleteTeamFor(ctx, player._id, teamId)
  },
})

/**
 * Take a member off a team.
 *
 * RECOMPUTES EVERY MONTH WITH A WINNER ROW. This is divergence 5 in
 * V2-ADDENDUM 7a: v1's update_monthly_winners is a trigger on daily_scores, and
 * removing a player touches `teams`, so it never fires — a removed player stays
 * named as the winner of months they are no longer in, and production is
 * carrying stale rows today.
 *
 * The creator cannot be removed, matching v1's UI, which hides the remove
 * button on your own row. Since only the creator can reach this at all, that
 * makes "remove yourself" unreachable rather than merely hidden — v1 has no
 * leave-team affordance and neither does this.
 */
export async function removeMemberFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; playerId: Id<'players'>; today: PuzzleDay },
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const today = requirePlausibleToday(args.today)
  if (args.playerId === team.creator) throw accessError('CREATOR_NOT_REMOVABLE')

  // Idempotent no-op, not an error: the postcondition ("that player is not on
  // this team") already holds. A throw here would surface a confusing error
  // toast for an action that already achieved its goal — the realistic trigger
  // is two tabs, or a double-click racing the reactive update that removes the
  // member's row from the UI. Returning early also skips the recompute and the
  // team write, which matters because ANY team write invalidates getMyTeams for
  // EVERY connected client (see this file's module comment) — paying that
  // broadcast for a change that never happened would be pure waste.
  if (!team.playerIds.includes(args.playerId)) return

  await ctx.db.patch(team._id, {
    playerIds: team.playerIds.filter((memberId) => memberId !== args.playerId),
  })

  const updated = (await ctx.db.get(team._id))!
  await recomputeTeamMonths(ctx, updated, await monthsWithWinners(ctx, team._id), today)
}

export const removeMember = mutation({
  args: { teamId: v.id('teams'), playerId: v.id('players'), today: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await removeMemberFor(ctx, player._id, args)
  },
})

/**
 * What an invite actually did.
 *
 * A DISCRIMINATED RESULT RATHER THAN void, because four different things can
 * happen and v1 reports all of them as "Successfully invited player" — including
 * the case where nothing happened at all, which is an outright lie. Divergence 9
 * in V2-ADDENDUM 7a.
 *
 * `added` carries firstName because it confirms the address matched a real
 * account, which is the most useful thing to learn after inviting by email.
 * `invited` and `resent` carry what the mutation wrapper needs to compose the
 * mail; `already_member` and `added` send nothing, so they carry nothing.
 */
export type InviteOutcome =
  | { status: 'already_member' }
  | { status: 'added'; firstName: string }
  | { status: 'invited'; email: string; teamName: string; inviterName: string }
  | { status: 'resent'; email: string; teamName: string; inviterName: string }

/**
 * Invite someone to a team by email address. Creator-only.
 *
 * Ports v1's invitePlayer (src/app/me/actions.ts), which nests FOUR branches,
 * not three: player-on-team, player-not-on-team-but-already-invited,
 * player-not-on-team, and no-player. Three are kept and their reporting is
 * replaced by InviteOutcome above.
 *
 * THE FOURTH IS DELIBERATELY REPLACED, and that is divergence 11. v1 answered
 * "already has an account AND an outstanding invite" by resending the invite and
 * NOT adding them — but its resend went through Supabase's inviteUserByEmail,
 * which does nothing for an address that already has an account. So v1 mailed
 * nobody, added nobody, and told the creator it had succeeded; the invitee stayed
 * off the team indefinitely. v2 routes that case into `added` instead, which is
 * the outcome v1 was trying and failing to reach. Reproducing it faithfully would
 * mean reproducing a dead end.
 *
 * EVERY RULE LIVES HERE, NOT IN THE WRAPPER, matching completeProfileFor,
 * updateTeamFor and removeMemberFor — the exported Convex function resolves the
 * caller's identity, sends the mail, and nothing else. That is not only
 * consistency: no test in this repo can drive a `mutation` wrapper, because
 * doing so needs a real Better Auth session in the harness, so a rule stated in
 * the wrapper would be a rule nothing could prove.
 *
 * THE SEND IS THE ONE THING THAT CANNOT LIVE HERE. resend.sendEmail needs a real
 * MutationCtx, and this helper is typed against the narrow WriterCtx (`{ db }`)
 * precisely so convex-test's `t.run` callback satisfies it with no cast. So the
 * DB work and the outcome happen here, and the wrapper composes the mail from
 * what it returns. That split is deliberate.
 *
 * NO EMAIL IS SENT WHEN AN EXISTING PLAYER IS ADDED DIRECTLY. That is v1's
 * behaviour — they simply find themselves on the team next time they look — and
 * it is kept deliberately as parity rather than being quietly improved.
 */
export async function invitePlayerFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; email: string; today: PuzzleDay },
): Promise<InviteOutcome> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const today = requirePlausibleToday(args.today)
  // NORMALISED ON THE WAY IN, once, and every comparison and write below uses
  // the result rather than args.email. Lowercasing is the fix for a real v1 bug
  // — see lib/invite.ts and amendment A2 — and trimming is what makes a pasted
  // address with a trailing space find the account it names.
  const email = normaliseInviteEmail(args.email)
  if (!email) throw accessError('INVALID_EMAIL')

  // playerForEmail lowercases for itself; `email` is already normalised.
  const existing = await playerForEmail(ctx, email)
  if (existing) {
    // Idempotent no-op, and reported as one. v1 logged this branch and then told
    // the creator the invite succeeded.
    //
    // WRITES NOTHING, INCLUDING NO INVITE CLEANUP. A team that lists this person
    // in BOTH playerIds and invited is reachable — it is exactly what the copy
    // brings over, since v1 never removed an invite it could not match — but
    // repairing it here would pay a team write, and therefore a getMyTeams
    // broadcast to every connected client, on the path whose whole point is that
    // nothing happened. cancelInviteFor, below, is the remedy for a row already
    // in that state; the branch below is what stops this function creating new
    // ones.
    if (team.playerIds.includes(existing._id)) return { status: 'already_member' }

    // ONE PATCH, TWO FIELDS. The address must leave `invited` in the same write
    // that puts the player on the roster, or the entry survives forever: this
    // branch and completeProfileFor are the only two places an invite is ever
    // retired, and a copied v1 player never reaches that one, because
    // needsProfile is a row-existence check and they already have a row. So for
    // the entire copied user base this is the only exit — which matters because
    // getTeamInvitesFor's pending list is `team.invited` itself, and the person
    // would read as a member AND as pending at the same time.
    //
    // The filter mirrors normaliseInviteEmail's trim().toLowerCase() on write,
    // for the same reason the resend scan below does: an entry this fails to
    // match is one nothing can ever clear.
    await ctx.db.patch(team._id, {
      playerIds: [...team.playerIds, existing._id],
      invited: team.invited.filter((entry) => entry.trim().toLowerCase() !== email),
    })

    // THE NEW MEMBER IS IMMEDIATELY ELIGIBLE TO HAVE WON PAST MONTHS, and they
    // bring their whole board history with them, so every month this team
    // already has a winner row for can now be wrong. The exact mirror of
    // removeMember's recompute, and divergence 5 for the same reason: v1's
    // update_monthly_winners is a trigger on daily_scores, and a membership
    // change never fires it.
    //
    // Against the POST-PATCH document: recomputeTeamMonth reads playerIds off
    // the doc it is handed, and `team` is the pre-patch snapshot, which does not
    // have the new member on it.
    const updated = (await ctx.db.get(team._id))!
    await recomputeTeamMonths(ctx, updated, await monthsWithWinners(ctx, team._id), today)
    return { status: 'added', firstName: existing.firstName }
  }

  // NORMALISED ON READ, MIRRORING normaliseInviteEmail'S trim().toLowerCase() ON
  // WRITE — the same defence in depth completeProfileFor applies when it scans
  // for invites to claim, and for the same reason. Every write path lowercases
  // today, so this is not a claim that abnormal rows exist; it is that the cost
  // of one future writer forgetting is a duplicate invite row that can never be
  // claimed and that nobody sees an error for.
  const alreadyInvited = team.invited.some((entry) => entry.trim().toLowerCase() === email)
  // A resend writes NOTHING. The address is already parked, and re-parking it
  // would either duplicate the entry or pay a team write — which invalidates
  // getMyTeams for every connected client (see this file's module comment) — for
  // a change that never happened.
  if (!alreadyInvited) {
    await ctx.db.patch(team._id, { invited: [...team.invited, email] })
  }

  // The inviter's own row, for the "Ada invited you" line — read only on the two
  // branches that actually mail. `?? 'Someone'` is not dead:
  // requireTeamCreatorFor only proves this id is in playerIds and equals
  // `creator`, and a roster entry can outlive the player row it names (Convex
  // ids are not foreign keys — the same state getMyTeamsFor and
  // recomputeTeamMonth both guard). An anonymous invite beats a crashed one, and
  // v1's Supabase template was anonymous anyway.
  const inviter = await ctx.db.get(playerId)

  return {
    status: alreadyInvited ? 'resent' : 'invited',
    email,
    teamName: team.name,
    inviterName: inviter?.firstName ?? 'Someone',
  }
}

/**
 * Invite someone to a team, and mail them if there is anybody to mail.
 *
 * `today` is client-supplied and bounded server-side by requirePlausibleToday
 * inside the helper, for the reason every other mutation that feeds one into
 * winner recomputation bounds it: the value decides which missed days are
 * already due and is written into a monthlyWinners row the whole team reads.
 */
export const invitePlayer = mutation({
  args: { teamId: v.id('teams'), email: v.string(), today: v.string() },
  handler: async (ctx, args): Promise<InviteOutcome> => {
    const player = await requirePlayer(ctx)
    const outcome = await invitePlayerFor(ctx, player._id, args)

    if (outcome.status === 'invited' || outcome.status === 'resent') {
      // Read here rather than at module scope, but checked with the same reflex
      // auth.ts uses: a missing SITE_URL must fail loudly, not silently mail
      // somebody a link to 'undefined/login'.
      const siteUrl = process.env.SITE_URL
      if (!siteUrl) throw new Error('SITE_URL is not set on this deployment')
      const { subject, text, html } = teamInviteEmail({
        teamName: outcome.teamName,
        inviterName: outcome.inviterName,
        // NO TOKEN. The invite is the row in teams.invited, and completing a
        // profile at that address is what claims it — see completeProfileFor.
        signInUrl: `${siteUrl}/login`,
      })
      // resend.sendEmail accepts a MutationCtx, so this enqueues inside the same
      // transaction as the `invited` write — no action hop, and the write and
      // the send commit together: an address cannot be parked without its invite
      // going out, and no mail can go out for a write that rolled back.
      await resend.sendEmail(ctx, {
        from: 'Wordle Teams <invites@wordleteams.com>',
        to: outcome.email,
        subject,
        text,
        html,
      })
    }

    return outcome
  },
})

/**
 * The addresses invited to a team but not yet joined. CREATOR-ONLY.
 *
 * Deliberately NOT folded into getMyTeams. That query picks its fields
 * explicitly so `invited` cannot reach the wire (see getMyTeamsFor), it is
 * fetched by every connected client, and these are real email addresses. This
 * is a separate, creator-scoped read of ONE team.
 *
 * RETURNS THE STORED ENTRIES AS THEY ARE STORED, unnormalised, and Task 7
 * renders these strings verbatim. The creator is being shown what is actually
 * parked on their team: a copied row can carry padding no gate ever stripped
 * (see cancelInviteFor), and telling a typo from a slow responder — the whole
 * point of divergence 6 — means being able to SEE the odd entry rather than
 * being handed a tidied copy of it.
 *
 * v1 exposes this nowhere — a creator cannot see who they invited, tell a typo
 * from a slow responder, or cancel. Divergence 6.
 */
export async function getTeamInvitesFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<Array<string>> {
  const team = await requireTeamCreatorFor(ctx, playerId, teamId)
  return team.invited
}

export const getTeamInvites = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await getTeamInvitesFor(ctx, player._id, teamId)
  },
})

/**
 * Withdraw a pending invite. Creator-only.
 *
 * NORMALISED ON READ — trim().toLowerCase(), mirroring normaliseInviteEmail on
 * write — exactly as invitePlayerFor's two scans and completeProfileFor's do.
 * THE TWO HALVES ARE NOT THE SAME STRENGTH, and it is worth being precise:
 *
 * - toLowerCase() is DEFENCE IN DEPTH, not a claim that abnormal rows exist —
 *   the framing completeProfileFor uses at length for this same field. Both
 *   copy gates lowercase (scripts/copy-from-supabase.mjs and again migrate.ts,
 *   "the last gate before the data lands"), all 44 pending production invites
 *   were measured lowercase, and schema.ts says the table cannot hold a
 *   mixed-case invite. It stays for the reason players.ts gives: the cost of
 *   one future writer forgetting is silent and asymmetric.
 * - trim() is NOT covered by any of that. Neither copy gate trims — both map
 *   `e.toLowerCase()` and nothing more — so a padded v1 address survives the
 *   copy intact.
 *
 * Either way the failure this prevents is the same: an entry the filter cannot
 * match is an invite that cannot be cancelled, which is precisely the trap this
 * surface exists to remove.
 *
 * REMOVES EVERY MATCHING ENTRY, not the first. One address can be parked twice
 * in two shapes, so leaving the duplicate behind would make cancelling look
 * broken.
 *
 * EARLY-RETURNS WHEN NOTHING MATCHED, like removeMemberFor, and for the reason
 * that one gives: any team write invalidates getMyTeams for EVERY connected
 * client (see this file's module comment), and paying that broadcast for a
 * change that never happened is pure waste. This is a public mutation — an
 * authenticated creator can submit any string, so it is not reachable only by
 * pressing a button for a row they can see — and a double-click on a row that
 * is already gone is the same trigger removeMemberFor cites.
 */
export async function cancelInviteFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; email: string },
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const email = normaliseInviteEmail(args.email)
  if (!email) throw accessError('INVALID_EMAIL')

  // One filter does both jobs: it computes the new array AND, by its length,
  // decides whether anything actually changed. completeProfileFor pairs a
  // `some` guard with the same filter; here the filter's own result is the
  // cheaper answer to the identical question.
  const remaining = team.invited.filter((entry) => entry.trim().toLowerCase() !== email)
  if (remaining.length === team.invited.length) return

  await ctx.db.patch(team._id, { invited: remaining })
}

export const cancelInvite = mutation({
  args: { teamId: v.id('teams'), email: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await cancelInviteFor(ctx, player._id, args)
  },
})
