import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, isProFor, requirePlausibleToday, requirePlayer, requireTeamMemberFor, requireTeamOwnerFor } from './access.ts'
import {
  challengesEnabled,
  MAX_ACTIVE_CHALLENGES,
  PROPOSAL_TTL_DAYS,
  outcomeOf,
  teamTotalsOver,
  windowFor,
  type ChallengeOutcome,
  type ChallengeTotals,
  type StatsDay,
} from './lib/challenge.ts'
import { meanAttemptsOf } from './lib/teamStats.ts'
import { displayNamesFor } from './lib/displayNames.ts'
import { addMonths, monthOf } from './lib/puzzleDay.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseWriter, GenericDatabaseReader } from 'convex/server'

/**
 * TEAM-VERSUS-TEAM CHALLENGES (wordle-teams-zic8.2).
 *
 * THE LOGIC LIVES IN THE `*For` HELPERS, NOT IN THE WRAPPERS, for the reason
 * lib/insightsAccess.ts gives: nothing in this repo can drive an authed Convex
 * wrapper (wordle-teams-obw), so a rule inside a `mutation({...})` is a rule no
 * test can execute. Every wrapper below is two lines — resolve the player, call
 * the helper.
 *
 * REFUSALS GO THROUGH accessError, never a bare `throw new Error`. A plain Error
 * message is REDACTED in production while convex-test never redacts, so a plain
 * throw is a message no test can see go missing.
 */

type WriterCtx = { db: GenericDatabaseWriter<DataModel> }
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

const TTL_MS = PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000

/** Statuses that occupy a slot against MAX_ACTIVE_CHALLENGES. */
const LIVE_STATUSES = ['pending', 'active'] as const

/**
 * Every live challenge this team is part of, on EITHER side.
 *
 * TWO QUERIES BECAUSE THERE ARE TWO INDEXES, and that is the schema's decision
 * rather than this function's: Convex cannot OR across indexes, and an array of
 * both ids would be unindexable. Four point lookups beats any scan.
 *
 * INVARIANT: no row ever has challengerTeamId === opponentTeamId. Such a row would
 * be returned TWICE, once per index, inflating that team's count. Unreachable today
 * because the self-challenge check refuses it, but this is where it is written down.
 */
export async function liveChallengesFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
): Promise<Array<Doc<'teamChallenges'>>> {
  const found: Array<Doc<'teamChallenges'>> = []
  for (const status of LIVE_STATUSES) {
    found.push(
      ...(await ctx.db
        .query('teamChallenges')
        .withIndex('by_challenger_and_status', (q) =>
          q.eq('challengerTeamId', teamId).eq('status', status),
        )
        .collect()),
      ...(await ctx.db
        .query('teamChallenges')
        .withIndex('by_opponent_and_status', (q) =>
          q.eq('opponentTeamId', teamId).eq('status', status),
        )
        .collect()),
    )
  }
  return found
}

/**
 * How many slots this team currently occupies against MAX_ACTIVE_CHALLENGES.
 *
 * COUNTS 'pending' AND 'active', which is why it is named "live" rather than
 * "active". A pending proposal must occupy a slot: otherwise a team could hold
 * five running challenges and an unbounded pile of outstanding proposals, and
 * the cap would bound nothing that matters. The constant keeps its name because
 * it is the user-facing idea; this function is honest about the set it counts.
 */
export async function liveChallengeCountFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
): Promise<number> {
  return (await liveChallengesFor(ctx, teamId)).length
}

/**
 * The four checks a challenge between a KNOWN pair must pass.
 *
 * SHARED BY PROPOSE AND BY ACCEPT, AND THAT SHARING IS THE POINT (design §8.1).
 * A link proposal has no opponent at creation, so these cannot all run at
 * propose time; running them only there would make a link a bypass for every
 * limit an owner set. One function, called from both places, is what keeps the
 * two paths from drifting.
 */
export async function requireChallengeablePair(
  ctx: ReaderCtx,
  challengerTeamId: Id<'teams'>,
  opponentTeamId: Id<'teams'>,
  exceptId?: Id<'teamChallenges'>,
): Promise<void> {
  if (challengerTeamId === opponentTeamId) throw accessError('INVALID_TEAM')

  const opponent = await ctx.db.get(opponentTeamId)
  if (opponent === null) throw accessError('INVALID_TEAM')
  // ABSENT MEANS YES. Only an explicit false refuses.
  if (opponent.acceptsChallenges === false) throw accessError('CHALLENGES_REFUSED')

  // `exceptId` IS THE ROW BEING ACCEPTED. At acceptance that row is itself
  // pending with its opponent set, so without excluding it the pair check finds
  // it and throws CHALLENGE_EXISTS on every accept, and both cap counts include
  // it, so a proposal made in a team's last slot could never be activated.
  // Propose-time callers pass nothing: no row exists yet.
  const others = async (teamId: Id<'teams'>) =>
    (await liveChallengesFor(ctx, teamId)).filter((c) => c._id !== exceptId)

  if ((await others(challengerTeamId)).length >= MAX_ACTIVE_CHALLENGES) {
    throw accessError('CHALLENGE_LIMIT_REACHED')
  }
  if ((await others(opponentTeamId)).length >= MAX_ACTIVE_CHALLENGES) {
    throw accessError('CHALLENGE_LIMIT_REACHED')
  }

  // ONE LIVE CHALLENGE PER UNORDERED PAIR. Either team may have been the proposer.
  // The second clause of the predicate is redundant TODAY: the rows come from
  // liveChallengesFor(challengerTeamId), so a row whose challenger is the opponent
  // is in that list only because its opponent is the challenger. The guarantee is
  // where the array comes from. The clause is kept so the predicate stays correct
  // if anyone ever passes it a differently-sourced array.
  const existing = (await others(challengerTeamId)).find(
    (c) =>
      c.opponentTeamId === opponentTeamId ||
      (c.challengerTeamId === opponentTeamId && c.opponentTeamId === challengerTeamId),
  )
  if (existing !== undefined) throw accessError('CHALLENGE_EXISTS')
}

/**
 * Propose a challenge to a team the caller is also a member of.
 *
 * PRO IS REQUIRED TO INITIATE and deliberately NOT to accept. Gating acceptance
 * would make reach the square of Pro penetration and hide the feature from every
 * free team — and a challenged free team is this feature's best conversion
 * moment, since wordle-teams-0hx established that this product's
 * differentiators are discovered after arrival rather than searched for.
 */
export async function proposeToTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengerTeamId: Id<'teams'>,
  opponentTeamId: Id<'teams'>,
): Promise<Id<'teamChallenges'>> {
  await requireTeamMemberFor(ctx, playerId, challengerTeamId)
  if (!(await isProFor(ctx, playerId))) throw accessError('PRO_REQUIRED')

  // THE DUAL-MEMBERSHIP ENTRY POINT: you may name a team you are on. Naming a
  // team you are NOT on is the searchable-directory feature, which is out of
  // scope — the link path is how you reach a team you do not belong to.
  await requireTeamMemberFor(ctx, playerId, opponentTeamId)

  await requireChallengeablePair(ctx, challengerTeamId, opponentTeamId)

  // ONE CLOCK READ, so expiresAt - createdAt is exactly TTL_MS and a test can
  // assert it without a tolerance.
  const now = Date.now()
  return await ctx.db.insert('teamChallenges', {
    challengerTeamId,
    opponentTeamId,
    proposedBy: playerId,
    status: 'pending',
    expiresAt: now + TTL_MS,
    createdAt: now,
  })
}

export const proposeToTeam = mutation({
  args: { challengerTeamId: v.id('teams'), opponentTeamId: v.id('teams') },
  handler: async (ctx, { challengerTeamId, opponentTeamId }) => {
    if (!challengesEnabled(process.env.CHALLENGES_ENABLED)) throw accessError('CHALLENGES_DISABLED')
    const player = await requirePlayer(ctx)
    return await proposeToTeamFor(ctx, player._id, challengerTeamId, opponentTeamId)
  },
})

/**
 * An opaque, unguessable challenge token.
 *
 * THIS IS A CAPABILITY, NOT AN IDENTIFIER: anyone holding it can put one of
 * their own teams into a challenge, which is the whole difference between a link
 * and naming a team you are already on. It is looked up on a path reachable
 * before we know which team the holder acts for.
 *
 * crypto.getRandomValues, NOT Math.random. The "two tokens never collide" test
 * proves this call runs in this runtime; it does NOT prove unguessability, since
 * a counter would satisfy it just as well. If this line ever stops being
 * getRandomValues, no test will tell you — it is a code-review obligation, the
 * same one inviteLinks' newToken carries.
 */
function newToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Propose a challenge to whoever holds the link.
 *
 * THE OPPONENT IS UNKNOWN HERE, so only the checks that do not need one run:
 * membership, Pro, and the challenger's own cap. The pair checks run at claim
 * time instead — see claimChallengeLinkFor and design §8.1.
 *
 * WHY A LINK AT ALL: "someone you know on the other team" is a social fact the
 * app does not hold, and it has no friend graph outside team rosters. A link
 * leaves that fact where it actually lives — in whatever channel the friendship
 * already uses — rather than building a directory to approximate it.
 */
export async function proposeByLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengerTeamId: Id<'teams'>,
): Promise<string> {
  await requireTeamMemberFor(ctx, playerId, challengerTeamId)
  if (!(await isProFor(ctx, playerId))) throw accessError('PRO_REQUIRED')
  if ((await liveChallengeCountFor(ctx, challengerTeamId)) >= MAX_ACTIVE_CHALLENGES) {
    throw accessError('CHALLENGE_LIMIT_REACHED')
  }

  const token = newToken()
  // ONE CLOCK READ, so expiresAt - createdAt is exactly TTL_MS and a test can
  // assert it without a tolerance.
  const now = Date.now()
  await ctx.db.insert('teamChallenges', {
    challengerTeamId,
    proposedBy: playerId,
    status: 'pending',
    token,
    expiresAt: now + TTL_MS,
    createdAt: now,
  })
  return token
}

export const proposeByLink = mutation({
  args: { challengerTeamId: v.id('teams') },
  handler: async (ctx, { challengerTeamId }) => {
    if (!challengesEnabled(process.env.CHALLENGES_ENABLED)) throw accessError('CHALLENGES_DISABLED')
    const player = await requirePlayer(ctx)
    return await proposeByLinkFor(ctx, player._id, challengerTeamId)
  },
})

/**
 * Bring a pending challenge to life.
 *
 * `today` IS THE ACCEPTER'S OWN LOCAL DAY, bounded server-side by
 * requirePlausibleToday — the same treatment every other mutation that feeds a
 * client `today` into a dated computation gets. See the enumeration in
 * access.ts: this is a new member of that family and belongs in that list.
 *
 * WHY IT MUST BE THE CLIENT'S DAY RATHER THAN THE SERVER'S: the window the
 * player is agreeing to starts tomorrow in THEIR calendar, and a board belongs
 * to a puzzle day rather than to an instant.
 */
async function activate(
  ctx: WriterCtx,
  challengeId: Id<'teamChallenges'>,
  accepterId: Id<'players'>,
  today: string,
  // NARROWED ON PURPOSE: the spread below is last, so a wider type would let a
  // caller clobber status/acceptedBy/startDay/endDay, the fields this exists to set.
  extra: Partial<Pick<Doc<'teamChallenges'>, 'opponentTeamId'>> = {},
): Promise<void> {
  const { startDay, endDay } = windowFor(requirePlausibleToday(today))
  // THE ID, NOT THE DOC. The claim path patches opponentTeamId first, so a
  // doc-taking signature would be handed a stale copy — correct today only
  // because this function reads nothing but the id, and silently wrong the
  // moment it grows to read another field (a push body naming the opponent is
  // the obvious candidate). `extra` lets the claim path fold its own patch in
  // here, so there is one write rather than two.
  await ctx.db.patch(challengeId, {
    status: 'active',
    acceptedBy: accepterId,
    startDay,
    endDay,
    ...extra,
  })
}

export async function acceptChallengeFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengeId: Id<'teamChallenges'>,
  today: string,
): Promise<void> {
  // Bounded up front, so a wrong-clock caller is told so before anything else.
  // activate re-applies it; it is pure, so the repeat is free.
  requirePlausibleToday(today)
  const challenge = await ctx.db.get(challengeId)
  if (challenge === null) throw accessError('INVALID_TEAM')
  if (challenge.status !== 'pending') throw accessError('CHALLENGE_NOT_PENDING')
  if (challenge.expiresAt <= Date.now()) throw accessError('CHALLENGE_NOT_PENDING')
  if (challenge.opponentTeamId === undefined) throw accessError('INVALID_TEAM')

  // ANY MEMBER MAY ACCEPT, AND PRO IS NOT CHECKED HERE. See proposeToTeamFor.
  await requireTeamMemberFor(ctx, playerId, challenge.opponentTeamId)

  // RE-CHECKED AT ACCEPTANCE, not trusted from propose time: the pair may have
  // filled its slots or turned challenges off while this sat pending.
  await requireChallengeablePair(
    ctx,
    challenge.challengerTeamId,
    challenge.opponentTeamId,
    challenge._id,
  )

  await activate(ctx, challenge._id, playerId, today)
}

/**
 * Claim a challenge link on behalf of one of your own teams.
 *
 * EVERY PAIR CHECK RUNS HERE, and this is the function design §8.1 was written
 * about. A link proposal has no opponent at creation, so acceptsChallenges, the
 * cap and the one-per-pair rule could not have been checked earlier. Checking
 * them only at propose time would make a link a bypass for all three.
 *
 * acceptsChallenges: false BLOCKS A CLAIM TOO, even though the claimant is
 * consenting for their own team. It is the owner's setting; a member routing
 * around it through a link would make it advisory rather than a control.
 */
export async function claimChallengeLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  token: string,
  opponentTeamId: Id<'teams'>,
  today: string,
): Promise<Id<'teamChallenges'>> {
  // GUARD BEFORE THE LOOKUP, and schema.ts's banner on teamChallenges.token says
  // why: the field is OPTIONAL, so eq('token', undefined) matches every DIRECT
  // proposal at once and .unique() throws "not unique" — a failure a long way
  // from its cause. An empty token is also not a token. Task 13 adds a ROUTE
  // PARAM feeding this, which is exactly how an empty string gets here.
  if (!token) throw accessError('CHALLENGE_LINK_INVALID')
  requirePlausibleToday(today)

  // MEMBERSHIP BEFORE THE TOKEN LOOKUP, DELIBERATELY. After it, NOT_A_MEMBER
  // would mean "the token is real, live and unclaimed" and CHALLENGE_LINK_INVALID
  // "it is not", which is exactly the distinction the answers below exist to hide.
  await requireTeamMemberFor(ctx, playerId, opponentTeamId)

  const challenge = await ctx.db
    .query('teamChallenges')
    .withIndex('by_token', (q) => q.eq('token', token))
    .unique()

  // AN UNKNOWN TOKEN AND AN EXPIRED ONE ANSWER THE SAME WAY, so holding a dead
  // token tells you nothing about whether it was ever real.
  if (challenge === null) throw accessError('CHALLENGE_LINK_INVALID')
  if (challenge.status !== 'pending') throw accessError('CHALLENGE_LINK_INVALID')
  if (challenge.expiresAt <= Date.now()) throw accessError('CHALLENGE_LINK_INVALID')

  await requireChallengeablePair(ctx, challenge.challengerTeamId, opponentTeamId, challenge._id)

  // ONE PATCH, via activate's `extra` — see its comment on why it takes an id.
  await activate(ctx, challenge._id, playerId, today, { opponentTeamId })
  return challenge._id
}

export const acceptChallenge = mutation({
  args: { challengeId: v.id('teamChallenges'), today: v.string() },
  handler: async (ctx, { challengeId, today }) => {
    if (!challengesEnabled(process.env.CHALLENGES_ENABLED)) throw accessError('CHALLENGES_DISABLED')
    const player = await requirePlayer(ctx)
    await acceptChallengeFor(ctx, player._id, challengeId, today)
  },
})

export const claimChallengeLink = mutation({
  args: { token: v.string(), opponentTeamId: v.id('teams'), today: v.string() },
  handler: async (ctx, { token, opponentTeamId, today }) => {
    if (!challengesEnabled(process.env.CHALLENGES_ENABLED)) throw accessError('CHALLENGES_DISABLED')
    const player = await requirePlayer(ctx)
    return await claimChallengeLinkFor(ctx, player._id, token, opponentTeamId, today)
  },
})

export async function declineChallengeFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengeId: Id<'teamChallenges'>,
): Promise<void> {
  const challenge = await ctx.db.get(challengeId)
  if (challenge === null) throw accessError('INVALID_TEAM')
  if (challenge.status !== 'pending') throw accessError('CHALLENGE_NOT_PENDING')
  if (challenge.opponentTeamId === undefined) throw accessError('INVALID_TEAM')
  await requireTeamMemberFor(ctx, playerId, challenge.opponentTeamId)
  await ctx.db.patch(challengeId, { status: 'declined' })
}

/**
 * Take back a proposal that has not been accepted.
 *
 * WITHDRAW IS FOR 'pending' AND CANCEL IS FOR 'active'. They are separate verbs
 * because they mean different things to the other team: a withdrawn proposal was
 * never agreed to and leaves no result, while a cancelled challenge was live and
 * freezes whatever its window held. Collapsing them would let one side end a
 * running contest as though it had never happened.
 */
export async function withdrawChallengeFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengeId: Id<'teamChallenges'>,
): Promise<void> {
  const challenge = await ctx.db.get(challengeId)
  if (challenge === null) throw accessError('INVALID_TEAM')
  if (challenge.status !== 'pending') throw accessError('CHALLENGE_NOT_PENDING')

  // THE PROPOSER, OR THE CHALLENGING TEAM'S OWNER. The owner is the backstop
  // that replaces the vote the design rejected; they are not in the happy path.
  if (challenge.proposedBy !== playerId) {
    await requireTeamOwnerFor(ctx, playerId, challenge.challengerTeamId)
  } else {
    await requireTeamMemberFor(ctx, playerId, challenge.challengerTeamId)
  }

  await ctx.db.patch(challengeId, { status: 'withdrawn' })
}

export async function setAcceptsChallengesFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  accepts: boolean,
): Promise<void> {
  await requireTeamOwnerFor(ctx, playerId, teamId)
  await ctx.db.patch(teamId, { acceptsChallenges: accepts })
}

export const declineChallenge = mutation({
  args: { challengeId: v.id('teamChallenges') },
  handler: async (ctx, { challengeId }) => {
    const player = await requirePlayer(ctx)
    await declineChallengeFor(ctx, player._id, challengeId)
  },
})

export const withdrawChallenge = mutation({
  args: { challengeId: v.id('teamChallenges') },
  handler: async (ctx, { challengeId }) => {
    const player = await requirePlayer(ctx)
    await withdrawChallengeFor(ctx, player._id, challengeId)
  },
})

export const setAcceptsChallenges = mutation({
  args: { teamId: v.id('teams'), accepts: v.boolean() },
  handler: async (ctx, { teamId, accepts }) => {
    const player = await requirePlayer(ctx)
    await setAcceptsChallengesFor(ctx, player._id, teamId, accepts)
  },
})

export type ChallengeMemberRow = {
  playerId: Id<'players'>
  /** Display label: first name, `First L` on a roster collision, else 'Former member'. */
  name: string
  boards: number
  attempts: number
  average: number | null
}

export type ChallengeSide = {
  teamId: Id<'teams'>
  teamName: string
  boards: number
  attempts: number
  average: number | null
  members: Array<ChallengeMemberRow>
}

export type ChallengeScoreboard = {
  /** The window, narrowed: an active row always has both. */
  startDay: string
  endDay: string
  challenger: ChallengeSide
  opponent: ChallengeSide
  outcome: ChallengeOutcome
}

/**
 * Every monthly document a window touches, for one team, flattened to days[].
 *
 * ONE DOCUMENT IN THE ORDINARY CASE AND TWO UNDER THE SHORT-WINDOW RULE, which
 * is the only way a window crosses a month boundary. Months are enumerated from
 * the window rather than guessed, so a window that grows later cannot silently
 * read a month short.
 *
 * THE RETURN TYPE NAMES Id<'players'> AND MUST. StatsDay's PlayerId defaults to
 * `string`, so a bare Array<StatsDay> compiles here and then erases the branding
 * for everything downstream — teamTotalsOver infers PlayerId from this array,
 * and sideFrom's playerId stops being an Id. The doc's own days[] type is
 * already branded; this annotation is what keeps it so.
 */
async function statsDaysFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
  startDay: string,
  endDay: string,
): Promise<Array<StatsDay<Id<'players'>>>> {
  // EVERY MONTH FROM START TO END, not just the two ends. Today that is one or
  // two; walking the range is what makes the comment above true if a window
  // ever grows. 'YYYY-MM' compares lexicographically in calendar order.
  const months: Array<string> = []
  for (let m = monthOf(startDay); m <= monthOf(endDay); m = addMonths(m, 1)) months.push(m)
  const days: Array<StatsDay<Id<'players'>>> = []
  for (const month of months) {
    const [year, monthNum] = month.split('-').map(Number)
    const doc = await ctx.db
      .query('teamMonthStats')
      .withIndex('by_team_year_month', (q) =>
        q.eq('teamId', teamId).eq('year', year).eq('month', monthNum),
      )
      .unique()
    // A MISSING DOCUMENT IS ZERO BOARDS, NEVER A THROW. teamMonthStats is
    // derived data — the rollup skips writing an unchanged month and a team that
    // has never played has no row at all. Treating absence as an error would
    // make a brand-new team's scoreboard crash rather than read 0.
    //
    // THE SAME PROPERTY IS A HAZARD FOR TEAM DELETION (Task 11): a cascade that
    // removes teamMonthStats before closing the team's challenges gets a
    // silently ZEROED, 'void' snapshot from here, never an error.
    if (doc !== null) days.push(...doc.days)
  }
  return days
}

/**
 * ORDER THE MEMBER ROWS HERE, because teamTotalsOver does not.
 *
 * Its `members` come out of a Map in first-seen order across days[] —
 * deterministic, but meaningless to a reader: whoever happened to play earliest
 * in the window lands first. Sort ascending by average so the best performer
 * leads, and break ties on boards played to match the outcome rule.
 *
 * THE NULL BRANCHES ARE UNREACHABLE TODAY: teamTotalsOver creates a member only
 * from an entry, so every member has boards >= 1 and a non-null average. They
 * are kept because meanAttemptsOf's type says null, and a null must never sort
 * as 0 — a member who did not play would appear to have won. Their mutants
 * SURVIVE the suite, as outcomeOf's identical null guard does; that is expected.
 */
function sideFrom(
  teamId: Id<'teams'>,
  teamName: string,
  totals: ChallengeTotals<Id<'players'>>,
  names: Map<string, string>,
): ChallengeSide {
  return {
    teamId,
    teamName,
    boards: totals.boards,
    attempts: totals.attempts,
    average: meanAttemptsOf(totals),
    // NO `as Id<'players'>` CAST, and none is needed: `totals` is
    // ChallengeTotals<Id<'players'>> because statsDaysFor's return type says so.
    // If you find yourself adding a cast here, that annotation has been lost —
    // fix it there, because a cast is where an Id for the wrong table slips in.
    members: totals.members
      .map((m) => ({
        playerId: m.playerId,
        name: names.get(m.playerId) ?? FORMER_MEMBER,
        boards: m.boards,
        attempts: m.attempts,
        average: meanAttemptsOf(m),
      }))
      .sort((a, b) => {
        if (a.average === null) return b.average === null ? 0 : 1
        if (b.average === null) return -1
        if (a.average !== b.average) return a.average - b.average
        return b.boards - a.boards
      }),
  }
}

/**
 * Display labels for one team's roster, by player id.
 *
 * THE COLLISION SET IS THE WHOLE ROSTER, so a scoreboard calls a player what the
 * scores table on the same page does. One players read per roster member.
 */
async function rosterNamesFor(ctx: ReaderCtx, team: Doc<'teams'>): Promise<Map<string, string>> {
  const players = []
  for (const id of team.playerIds) {
    const player = await ctx.db.get(id)
    if (player !== null) players.push({ id, firstName: player.firstName, lastName: player.lastName })
  }
  return displayNamesFor(players)
}

/** A row whose player is not on the roster: they left mid-window. */
const FORMER_MEMBER = 'Former member'

/**
 * The live scoreboard for an active challenge.
 *
 * READS AT MOST TWO teamMonthStats DOCUMENTS PER SIDE and never touches
 * dailyScores. That is the whole cost model: the aggregate this projects is
 * already maintained incrementally on board write by winners.ts, which is the
 * shape the parent epic's hygiene note asks for.
 *
 * ACTIVE ONLY. A closed challenge's numbers are its frozen `result`; recomputing
 * one live would let a backfilled board restate a finished contest. Task 10's
 * close calls this on a row that is still 'active', immediately before freezing.
 */
export async function challengeScoreboardFor(
  ctx: ReaderCtx,
  challenge: Doc<'teamChallenges'>,
): Promise<ChallengeScoreboard> {
  if (challenge.status !== 'active') throw accessError('CHALLENGE_NOT_ACTIVE')
  // NARROWING, NOT A GUARD: an active row always has all three (activate sets
  // them in one patch). Unreachable past the status check, and its mutant
  // survives for that reason.
  if (
    challenge.startDay === undefined ||
    challenge.endDay === undefined ||
    challenge.opponentTeamId === undefined
  ) {
    throw accessError('CHALLENGE_NOT_ACTIVE')
  }

  const { startDay, endDay } = challenge
  const challengerTeam = await ctx.db.get(challenge.challengerTeamId)
  const opponentTeam = await ctx.db.get(challenge.opponentTeamId)
  if (challengerTeam === null || opponentTeam === null) throw accessError('INVALID_TEAM')

  // ONE players READ PER ROSTER MEMBER PER SIDE, including for free viewers
  // whose rows challengesForTeamFor then strips. Bounded by roster size.
  const challengerNames = await rosterNamesFor(ctx, challengerTeam)
  const opponentNames = await rosterNamesFor(ctx, opponentTeam)

  const challengerTotals = teamTotalsOver(
    await statsDaysFor(ctx, challengerTeam._id, startDay, endDay),
    startDay,
    endDay,
  )
  const opponentTotals = teamTotalsOver(
    await statsDaysFor(ctx, opponentTeam._id, startDay, endDay),
    startDay,
    endDay,
  )

  return {
    startDay,
    endDay,
    challenger: sideFrom(challengerTeam._id, challengerTeam.name, challengerTotals, challengerNames),
    opponent: sideFrom(opponentTeam._id, opponentTeam.name, opponentTotals, opponentNames),
    // ARGUMENT ORDER MATTERS AND THE COMPILER CANNOT SEE IT: outcomeOf's two
    // parameters are structurally identical, so a transposed call compiles and
    // names the wrong winner. The two "the lower average wins" tests run both
    // directions through THIS line and are what pin it.
    outcome: outcomeOf(challengerTotals, opponentTotals),
  }
}

export type HeadToHeadRecord = { won: number; lost: number; tied: number; noResult: number }

export type HeadToHead = {
  opponentTeamId: Id<'teams'>
  opponentName: string
  record: HeadToHeadRecord
}

/**
 * One team's record against every team it has finished a challenge with, from
 * the VIEWING team's side, most recently played first.
 *
 * READS THE CLOSED SET ONCE — two index queries — and tallies per opponent in
 * memory. Never one scan per opponent. Reads ZERO teamMonthStats documents: the
 * snapshot is the record.
 *
 * 'void' IS NEITHER A WIN NOR A LOSS. It is counted as noResult and shown as
 * "no result", because a void means the boards were never there to judge —
 * folding it into either column would invent an outcome nobody played for.
 *
 * THE LABEL IS THE OPPONENT'S NAME AT ITS MOST RECENT CLOSE, read from the
 * snapshot rather than the live team row. That keeps a deleted opponent
 * labelled, and costs no extra read.
 *
 * A 'closed' ROW WITH NO `result` IS SKIPPED. result-present <=> closed is an
 * invariant the schema cannot express (spec §13); a row breaking it must not
 * appear as an opponent with an all-zero tally.
 *
 * UNBOUNDED OVER A TEAM'S LIFETIME: closed rows are never deleted. At one
 * challenge per pair at a time and five at once, that is a few dozen a year per
 * team. If that ever stops being true, this is the read to bound.
 */
export async function headToHeadFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
): Promise<Array<HeadToHead>> {
  const closed = [
    ...(await ctx.db
      .query('teamChallenges')
      .withIndex('by_challenger_and_status', (q) =>
        q.eq('challengerTeamId', teamId).eq('status', 'closed'),
      )
      .collect()),
    ...(await ctx.db
      .query('teamChallenges')
      .withIndex('by_opponent_and_status', (q) =>
        q.eq('opponentTeamId', teamId).eq('status', 'closed'),
      )
      .collect()),
  ]

  const byOpponent = new Map<Id<'teams'>, HeadToHead & { lastClosedAt: number }>()
  for (const challenge of closed) {
    const result = challenge.result
    if (result === undefined) continue

    const viewerIsChallenger = challenge.challengerTeamId === teamId
    const other = viewerIsChallenger ? result.opponent : result.challenger
    const entry = byOpponent.get(other.teamId) ?? {
      opponentTeamId: other.teamId,
      opponentName: other.name,
      record: { won: 0, lost: 0, tied: 0, noResult: 0 },
      lastClosedAt: -Infinity,
    }
    if (result.closedAt > entry.lastClosedAt) {
      entry.lastClosedAt = result.closedAt
      entry.opponentName = other.name
    }

    switch (result.outcome) {
      case 'void':
        entry.record.noResult += 1
        break
      case 'tie':
        entry.record.tied += 1
        break
      case 'challenger':
        if (viewerIsChallenger) entry.record.won += 1
        else entry.record.lost += 1
        break
      case 'opponent':
        if (viewerIsChallenger) entry.record.lost += 1
        else entry.record.won += 1
        break
    }
    byOpponent.set(other.teamId, entry)
  }

  return [...byOpponent.values()]
    .sort((a, b) => b.lastClosedAt - a.lastClosedAt)
    .map(({ opponentTeamId, opponentName, record }) => ({ opponentTeamId, opponentName, record }))
}

/**
 * A pending proposal as the team page may see it.
 *
 * AN EXPLICIT PROJECTION, NEVER THE DOC. The doc carries the link `token` —
 * a capability that would otherwise reach every member of the challenging
 * team, Pro or not — and carries no team names. proposeByLink returns the token
 * once, to the person who made it. AND NOTHING NUMERIC: AC3 says nothing about
 * either team's scores renders before acceptance.
 */
export type PendingChallengeView = {
  challengeId: Id<'teamChallenges'>
  /** 'incoming': this team was challenged and may accept or decline. */
  direction: 'incoming' | 'outgoing'
  /** null for a link proposal nobody has claimed yet. */
  otherTeamName: string | null
  isLink: boolean
  /** The client renders "expired" against its own clock; see AC5. */
  expiresAt: number
  /** The proposer may withdraw; so may the challenging team's owner. */
  proposedByViewer: boolean
}

/**
 * Everything the team page needs about challenges.
 *
 * THE PRO GATE IS APPLIED HERE, SERVER-SIDE, AND NOT IN THE COMPONENT. Free
 * members get both teams' averages, both board counts and the outcome — the
 * whole result, honestly — and NOT the per-member rows. That is the same line
 * insights already draws: teamRank sends the free tier a position while
 * memberAverages is the paid panel. Withholding the rows in the client would
 * ship them to the browser and hide them with CSS, which is not a gate.
 *
 * IN A *For HELPER rather than the query wrapper, because a rule inside
 * `query({...})` is a rule no test here can execute (wordle-teams-obw).
 */
export async function challengesForTeamFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
) {
  await requireTeamMemberFor(ctx, playerId, teamId)
  const pro = await isProFor(ctx, playerId)

  const live = await liveChallengesFor(ctx, teamId)

  const active = []
  for (const challenge of live.filter((c) => c.status === 'active')) {
    const board = await challengeScoreboardFor(ctx, challenge)
    active.push({
      challengeId: challenge._id,
      startDay: board.startDay,
      endDay: board.endDay,
      viewerIsChallenger: challenge.challengerTeamId === teamId,
      challenger: pro ? board.challenger : { ...board.challenger, members: [] },
      opponent: pro ? board.opponent : { ...board.opponent, members: [] },
      outcome: board.outcome,
    })
  }

  const pending: Array<PendingChallengeView> = []
  for (const challenge of live.filter((c) => c.status === 'pending')) {
    const incoming = challenge.opponentTeamId === teamId
    const otherTeamId = incoming ? challenge.challengerTeamId : challenge.opponentTeamId
    const otherTeam = otherTeamId === undefined ? null : await ctx.db.get(otherTeamId)
    pending.push({
      challengeId: challenge._id,
      direction: incoming ? 'incoming' : 'outgoing',
      otherTeamName: otherTeam?.name ?? null,
      isLink: challenge.token !== undefined,
      expiresAt: challenge.expiresAt,
      proposedByViewer: challenge.proposedBy === playerId,
    })
  }

  return { pro, active, pending, records: await headToHeadFor(ctx, teamId) }
}

export const challengesForTeam = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    // RETURNS rather than throws, so a page that renders the section never
    // errors on a dark deployment.
    if (!challengesEnabled(process.env.CHALLENGES_ENABLED)) return { enabled: false as const }
    const player = await requirePlayer(ctx)
    return { enabled: true as const, ...(await challengesForTeamFor(ctx, player._id, teamId)) }
  },
})
