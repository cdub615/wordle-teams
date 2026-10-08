import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import { accessError, isProFor, requirePlausibleToday, requirePlayer } from './access.ts'
import { isMonth } from './lib/monthWindow.ts'
import { attemptsFor } from './lib/board.ts'
import { addDays, addMonths, isPlausibleToday, monthOf, monthRange, toPuzzleDay } from './lib/puzzleDay.ts'
import { insightsAccess } from './lib/insightsAccess.ts'
import { contributionOf, contributionUnlocked, groupDelta, leaguesEnabled, membershipOf, memberTotalsFor, monthToClose, planJoin, planLeave, planSwitch, standingsOf, winnerOf, yearMonthOf } from './lib/league.ts'
import type { PuzzleDay, PuzzleMonth } from './lib/puzzleDay.ts'
import type { MembershipPlan, Standing } from './lib/league.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseReader, GenericDatabaseWriter, Scheduler } from 'convex/server'

/**
 * PUBLIC LEAGUES (wordle-teams-zic8.3). Spec:
 * docs/superpowers/specs/2026-10-07-public-leagues-design.md.
 *
 * THIN BY DESIGN. Every rule is in lib/league.ts. The …For handlers read and
 * write; the public wrappers check LEAGUES_ENABLED and supply a player id —
 * nothing else, because a wrapper is code no test can reach (wordle-teams-obw).
 *
 * NO NAME EVER LEAVES THIS FILE. Strangers see group totals only (§3.2): no
 * function here returns a player's name, email or id belonging to anyone but
 * the caller.
 */

type WriterCtx = { db: GenericDatabaseWriter<DataModel> }
// Local, not imported from winners.ts: no edge, not even a type one, from here
// to a module that could grow a path back (scores.ts and teamStats.ts import us).
type SchedulingCtx = WriterCtx & { scheduler: Scheduler }
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

export type LeagueSpec = {
  slug: string
  name: string
  featured: boolean
  /** Absent leaves a stored value alone on re-seed; a stored absence means 'fixed'. */
  groupSource?: 'fixed' | 'answer-words'
  groups: { slug: string; name: string }[]
}

/** v1's one league (§1). Seeded per deployment by `seedLeague`. */
export const STARTING_WORDS: LeagueSpec = {
  slug: 'starting-words',
  name: 'Starting Words',
  featured: true,
  groupSource: 'answer-words',
  groups: ['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'].map((name) => ({ slug: name.toLowerCase(), name })),
}

const LEAGUE_SPECS: Record<string, LeagueSpec> = { [STARTING_WORDS.slug]: STARTING_WORDS }

/**
 * Create or update a league and its groups, matched by slug. IDEMPOTENT: a
 * re-run renames and reorders but never duplicates, and never moves createdAt
 * (monthToClose reads it, so moving it would skip or invent a close). It
 * NEVER REMOVES a group dropped from the spec: a re-seed only renames and
 * reorders.
 */
export async function seedLeagueFor(ctx: WriterCtx, spec: LeagueSpec, now: number): Promise<Id<'leagues'>> {
  const found = await ctx.db.query('leagues').withIndex('by_slug', (q) => q.eq('slug', spec.slug)).unique()
  const leagueId =
    found?._id ??
    (await ctx.db.insert('leagues', {
      slug: spec.slug,
      name: spec.name,
      featured: spec.featured,
      ...(spec.groupSource ? { groupSource: spec.groupSource } : {}),
      createdAt: now,
    }))
  if (found) {
    await ctx.db.patch(found._id, {
      name: spec.name,
      featured: spec.featured,
      ...(spec.groupSource ? { groupSource: spec.groupSource } : {}),
    })
  }

  const existing = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', leagueId)).collect()
  for (const [order, group] of spec.groups.entries()) {
    const row = existing.find((e) => e.slug === group.slug)
    if (row) await ctx.db.patch(row._id, { name: group.name, order })
    else await ctx.db.insert('leagueGroups', { leagueId, slug: group.slug, name: group.name, order, memberCount: 0 })
  }
  return leagueId
}

/**
 * Run once per deployment with scripts/seed-league.mjs (CONVEX_URL and
 * CONVEX_MIGRATION_KEY set explicitly, plus --confirm-host=<host>). NOT
 * `convex run leagues:seedLeague`: on this machine `convex run` silently targets
 * the LOCAL backend, even with --prod, and has no permission on beta — it would
 * report success having seeded nothing that matters.
 *
 * SEED EARLY IN A MONTH. Seeding late on a month's last UTC day makes that month
 * closeable (joins count from tomorrow), so the sweep writes one empty "no
 * winner" snapshot for it.
 */
export const seedLeague = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const spec = LEAGUE_SPECS[slug]
    if (!spec) throw accessError('UNKNOWN_LEAGUE')
    return await seedLeagueFor(ctx, spec, Date.now())
  },
})

export async function groupsOf(ctx: ReaderCtx, leagueId: Id<'leagues'>): Promise<Doc<'leagueGroups'>[]> {
  const groups = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', leagueId)).collect()
  return groups.sort((a, b) => a.order - b.order)
}

/** The live month's standings for one league: one range read, zero-filled. */
export async function currentStandings(
  ctx: ReaderCtx,
  leagueId: Id<'leagues'>,
  groups: Doc<'leagueGroups'>[],
  month: PuzzleMonth,
): Promise<Standing<Id<'leagueGroups'>>[]> {
  const { year, month: m } = yearMonthOf(month)
  const rows = await ctx.db
    .query('leagueGroupMonth')
    .withIndex('by_league_year_month', (q) => q.eq('leagueId', leagueId).eq('year', year).eq('month', m))
    .collect()
  return standingsOf(
    groups.map((g) => {
      const row = rows.find((r) => r.groupId === g._id)
      return {
        groupId: g._id,
        order: g.order,
        boards: row?.boards ?? 0,
        attempts: row?.attempts ?? 0,
        contributors: row?.contributors ?? 0,
      }
    }),
  )
}

export async function leaguesFor(ctx: ReaderCtx) {
  const leagues = await ctx.db.query('leagues').collect()
  return await Promise.all(
    leagues.map(async (league) => ({
      slug: league.slug,
      name: league.name,
      featured: league.featured,
      groups: (await groupsOf(ctx, league._id)).map((g) => ({ _id: g._id, slug: g.slug, name: g.name, memberCount: g.memberCount })),
    })),
  )
}

/**
 * The standings page. CLOSED MONTHS COME FROM leagueMonthResults ONLY — a live
 * row for a closed month can have been restated by backfill (§4.1).
 */
export async function standingsFor(ctx: ReaderCtx, slug: string, today: PuzzleDay) {
  const league = await ctx.db.query('leagues').withIndex('by_slug', (q) => q.eq('slug', slug)).unique()
  if (!league) return null
  const groups = await groupsOf(ctx, league._id)
  const month = monthOf(today)
  const standings = await currentStandings(ctx, league._id, groups, month)

  const results = await ctx.db
    .query('leagueMonthResults')
    .withIndex('by_league_year_month', (q) => q.eq('leagueId', league._id))
    .collect()
  const previous = addMonths(month, -1)
  const prev = yearMonthOf(previous)
  const last = results.find((r) => r.year === prev.year && r.month === prev.month)

  return {
    league: { slug: league.slug, name: league.name },
    month,
    groups: groups.map((g) => ({ _id: g._id, slug: g.slug, name: g.name, memberCount: g.memberCount })),
    standings,
    lastMonth: last ? { month: previous, winnerGroupId: last.winnerGroupId } : null,
    monthsWon: groups.map((g) => ({ groupId: g._id, count: results.filter((r) => r.winnerGroupId === g._id).length })),
  }
}

/**
 * The day a league READ is for. Bounded like insights.ts's teamMonth: `today`
 * is a client-local fact, but unbounded it would let a client walk months. It
 * FALLS BACK to the server's day rather than throwing, because a reactive query
 * re-runs on every league board write, so a tab left open past midnight would
 * otherwise hit INVALID_DATE with no user action.
 */
export function readToday(today: PuzzleDay): PuzzleDay {
  const serverToday = toPuzzleDay(new Date())
  return isPlausibleToday(today, serverToday) ? today : serverToday
}

/** RETURNS rather than throws when dark, so a page never errors on a dark deployment. */
export const leagues = query({
  args: {},
  handler: async (ctx) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    await requirePlayer(ctx)
    return { enabled: true as const, leagues: await leaguesFor(ctx) }
  },
})

export const standings = query({
  args: { slug: v.string(), today: v.string() },
  handler: async (ctx, { slug, today }) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    await requirePlayer(ctx)
    return { enabled: true as const, view: await standingsFor(ctx, slug, readToday(today)) }
  },
})

type GroupId = Id<'leagueGroups'>

/** One player's intervals for one league, OLDEST FIRST — plan indexes refer to this order. */
async function intervalsOf(ctx: ReaderCtx, playerId: Id<'players'>, leagueId: Id<'leagues'>) {
  const rows = await ctx.db
    .query('leagueMemberships')
    .withIndex('by_player_and_league', (q) => q.eq('playerId', playerId).eq('leagueId', leagueId))
    .collect()
  return rows.sort((a, b) => a.fromDay.localeCompare(b.fromDay))
}

async function bumpCount(ctx: WriterCtx, groupId: GroupId | null, by: 1 | -1) {
  if (groupId === null) return
  const group = await ctx.db.get(groupId)
  if (!group) {
    console.error(`leagues: memberCount not moved, group ${groupId} is missing (by ${by})`)
    return
  }
  const next = group.memberCount + by
  // A negative count is drift (wordle-teams-jck4 reconciles); clamp, but say so.
  if (next < 0) console.error(`leagues: memberCount drift on group ${groupId}, attempted ${next}, clamped to 0`)
  await ctx.db.patch(groupId, { memberCount: Math.max(0, next) })
}

/**
 * Apply a plan's ops against `rows`, then move memberCount. `rows` is captured
 * before any write and never re-read or spliced: every plan index refers to it.
 */
async function applyPlan(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  leagueId: Id<'leagues'>,
  rows: Doc<'leagueMemberships'>[],
  plan: MembershipPlan<GroupId>,
) {
  if ('refused' in plan) throw accessError(plan.refused)
  for (const op of plan.ops) {
    if (op.op === 'insert') await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: op.groupId, fromDay: op.fromDay })
    else if (op.op === 'patch') await ctx.db.patch(rows[op.index]._id, { toDay: op.toDay })
    else if (op.op === 'reopen') await ctx.db.patch(rows[op.index]._id, { toDay: undefined })
    else if (op.op === 'retarget') await ctx.db.patch(rows[op.index]._id, { groupId: op.groupId })
    else await ctx.db.delete(rows[op.index]._id)
  }
  await bumpCount(ctx, plan.countFrom, -1)
  await bumpCount(ctx, plan.countTo, 1)
}

async function requireGroup(ctx: ReaderCtx, groupId: GroupId) {
  const group = await ctx.db.get(groupId)
  if (!group) throw accessError('UNKNOWN_GROUP')
  return group
}

export async function joinGroupFor(ctx: WriterCtx, playerId: Id<'players'>, args: { groupId: GroupId; today: string }) {
  const today = requirePlausibleToday(args.today)
  const group = await requireGroup(ctx, args.groupId)
  const rows = await intervalsOf(ctx, playerId, group.leagueId)
  await applyPlan(ctx, playerId, group.leagueId, rows, planJoin(rows, today, group._id))
  // "EVER JOINED" (spec §8.4), stamped once and never overwritten or cleared:
  // a leave before the interval opens DELETES the row, so the row alone cannot
  // remember the join. After applyPlan, so a refused join stamps nothing.
  const player = await ctx.db.get(playerId)
  if (player && player.leagueJoinedAt === undefined) await ctx.db.patch(playerId, { leagueJoinedAt: Date.now() })
  await recomputeAfterMembershipChange(ctx, playerId, today)
}

export async function switchGroupFor(ctx: WriterCtx, playerId: Id<'players'>, args: { groupId: GroupId; today: string }) {
  const today = requirePlausibleToday(args.today)
  const group = await requireGroup(ctx, args.groupId)
  const rows = await intervalsOf(ctx, playerId, group.leagueId)
  await applyPlan(ctx, playerId, group.leagueId, rows, planSwitch(rows, today, group._id))
  await recomputeAfterMembershipChange(ctx, playerId, today)
}

export async function leaveLeagueFor(ctx: WriterCtx, playerId: Id<'players'>, args: { leagueId: Id<'leagues'>; today: string }) {
  const today = requirePlausibleToday(args.today)
  if (!(await ctx.db.get(args.leagueId))) throw accessError('UNKNOWN_LEAGUE')
  const rows = await intervalsOf(ctx, playerId, args.leagueId)
  await applyPlan(ctx, playerId, args.leagueId, rows, planLeave(rows, today))
  await recomputeAfterMembershipChange(ctx, playerId, today)
}

/**
 * Every month a membership change can move a stored board in: this month AND,
 * near a month's end, the next. A board can be for up to the SERVER's today + 1
 * (requirePlausiblePuzzleDay) while `today` may be the server's today - 1
 * (requirePlausibleToday), so a board can sit as far as today + 2. A switch or
 * leave on the 30th or 31st therefore reaches a board already entered for the 1st.
 * monthOf(today + 2) is either this month or the next, never further.
 */
async function recomputeAfterMembershipChange(ctx: WriterCtx, playerId: Id<'players'>, today: PuzzleDay) {
  const thisMonth = monthOf(today)
  await recomputeLeagueMonthFor(ctx, playerId, thisMonth)
  const reach = monthOf(addDays(today, 2))
  if (reach !== thisMonth) await recomputeLeagueMonthFor(ctx, playerId, reach)
}

/**
 * Rebuild ONE player's league rows for ONE month from their own boards, and
 * move each group row by the difference. Called on every board write
 * (scores.ts) and after every membership change.
 *
 * WHICH LEAGUES: every league the player holds a membership row in, UNIONED
 * with every league they already have a member-month row in for THIS month.
 * The second half is not redundant: a leave before the interval opened DELETES
 * that row (planLeave), and a board for tomorrow (accepted up to the server's
 * today + 1) may already have counted for it. Without the union nothing would
 * name that league, and its member row and group contribution would be stranded.
 *
 * COST: for a player who has NEVER joined a league, two empty index reads and
 * nothing else — which is almost everyone. Both reads are bounded to the player
 * and (for member-month) to ONE month, never their history. A FORMER member
 * still pays the member cost, because a left interval survives a leave. For a
 * member, their month's boards plus one group row per league. Never O(group
 * size): the group row moves by delta (§7).
 *
 * WRITES NOTHING WHEN NOTHING CHANGED, so a board edit that does not move the
 * totals does not invalidate every standings subscription.
 */
export async function recomputeLeagueMonthFor(ctx: WriterCtx, playerId: Id<'players'>, month: PuzzleMonth): Promise<void> {
  const memberships = await ctx.db
    .query('leagueMemberships')
    .withIndex('by_player_and_league', (q) => q.eq('playerId', playerId))
    .collect()
  const { year, month: m } = yearMonthOf(month)
  // ONE MONTH's member rows, all leagues at once (by_player_year_month). Their
  // leagues join the set: membership rows CAN be deleted (a leave before the
  // interval opens), and a league named only here must still be recomputed —
  // to nothing — or its row and group contribution are stranded.
  const existing = await ctx.db
    .query('leagueMemberMonth')
    .withIndex('by_player_year_month', (q) => q.eq('playerId', playerId).eq('year', year).eq('month', m))
    .collect()
  const leagueIds = new Set([...memberships.map((r) => r.leagueId), ...existing.map((r) => r.leagueId)])
  if (leagueIds.size === 0) return

  const { start, end } = monthRange(month)
  const boards = (
    await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', playerId).gte('puzzleDay', start).lte('puzzleDay', end))
      .collect()
  ).map((b) => ({ puzzleDay: b.puzzleDay, attempts: attemptsFor(b.guesses, b.answer ?? '') }))

  for (const leagueId of leagueIds) {
    const after = memberTotalsFor(boards, memberships.filter((r) => r.leagueId === leagueId), month)
    const before = existing.find((r) => r.leagueId === leagueId) ?? null
    if (before && after && before.groupId === after.groupId && before.boards === after.boards && before.attempts === after.attempts) continue

    if (before && after && before.groupId === after.groupId) {
      await moveGroup(ctx, leagueId, after.groupId, year, m, groupDelta(before, after))
    } else {
      if (before) await moveGroup(ctx, leagueId, before.groupId, year, m, groupDelta(before, null))
      if (after) await moveGroup(ctx, leagueId, after.groupId, year, m, groupDelta(null, after))
    }

    if (before && after) await ctx.db.patch(before._id, { groupId: after.groupId, boards: after.boards, attempts: after.attempts })
    else if (after) await ctx.db.insert('leagueMemberMonth', { playerId, leagueId, groupId: after.groupId, year, month: m, boards: after.boards, attempts: after.attempts })
    else if (before) await ctx.db.delete(before._id)
  }
}

/** Add a delta to one group-month row, creating it on first contribution. */
async function moveGroup(
  ctx: WriterCtx,
  leagueId: Id<'leagues'>,
  groupId: GroupId,
  year: number,
  month: number,
  d: { boards: number; attempts: number; contributors: number },
) {
  // DEFENSIVE: recomputeLeagueMonthFor, the only caller, never passes a zero
  // delta (equal totals `continue` first; an add or a remove moves contributors).
  // pruneLeagueRowsFor does not come here — it uses subtractGroup.
  if (d.boards === 0 && d.attempts === 0 && d.contributors === 0) return
  const row = await ctx.db
    .query('leagueGroupMonth')
    .withIndex('by_group_year_month', (q) => q.eq('groupId', groupId).eq('year', year).eq('month', month))
    .unique()
  if (row) {
    await ctx.db.patch(row._id, { boards: row.boards + d.boards, attempts: row.attempts + d.attempts, contributors: row.contributors + d.contributors })
  } else {
    await ctx.db.insert('leagueGroupMonth', { leagueId, groupId, year, month, ...d })
  }
}

/**
 * Take a member-month row's totals back out of its group-month row. Only ever
 * SUBTRACTS: a missing group row is drift to report, never to create (moveGroup
 * would insert a negative row).
 */
async function subtractGroup(ctx: WriterCtx, row: Doc<'leagueMemberMonth'>) {
  const group = await ctx.db
    .query('leagueGroupMonth')
    .withIndex('by_group_year_month', (q) => q.eq('groupId', row.groupId).eq('year', row.year).eq('month', row.month))
    .unique()
  if (!group) {
    console.error(`leagues: no group-month row to subtract from, group ${row.groupId} ${row.year}-${row.month} (member row ${row._id})`)
    return
  }
  const d = groupDelta(row, null)
  await ctx.db.patch(group._id, { boards: group.boards + d.boards, attempts: group.attempts + d.attempts, contributors: group.contributors + d.contributors })
}

/**
 * Remove every league row for a player being deleted, keeping group totals and
 * member counts exact. The only caller today is e2ePrune — the app has no
 * account deletion (spec §7). Whoever builds that must call this too.
 * Returns the number of membership + member-month rows removed (or, with
 * `execute: false`, that would be removed; nothing is written then).
 *
 * The memberCount decrement comes from planLeave's countFrom, so "which group
 * counts this player" keeps ONE definition.
 */
export async function pruneLeagueRowsFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  today: PuzzleDay,
  execute: boolean,
): Promise<number> {
  const memberships = await ctx.db
    .query('leagueMemberships')
    .withIndex('by_player_and_league', (q) => q.eq('playerId', playerId))
    .collect()
  const monthRows = await ctx.db
    .query('leagueMemberMonth')
    .withIndex('by_player_league_year_month', (q) => q.eq('playerId', playerId))
    .collect()
  if (execute) {
    for (const leagueId of new Set(memberships.map((r) => r.leagueId))) {
      const rows = memberships.filter((r) => r.leagueId === leagueId)
      const plan = planLeave(rows, today)
      if (!('refused' in plan)) await bumpCount(ctx, plan.countFrom, -1)
    }
    for (const row of monthRows) {
      await subtractGroup(ctx, row)
      await ctx.db.delete(row._id)
    }
    for (const row of memberships) await ctx.db.delete(row._id)
  }
  return memberships.length + monthRows.length
}

const gate = () => {
  if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) throw accessError('LEAGUES_DISABLED')
}

export const joinGroup = mutation({
  args: { groupId: v.id('leagueGroups'), today: v.string() },
  handler: async (ctx, args) => {
    gate()
    const player = await requirePlayer(ctx)
    await joinGroupFor(ctx, player._id, args)
  },
})

export const switchGroup = mutation({
  args: { groupId: v.id('leagueGroups'), today: v.string() },
  handler: async (ctx, args) => {
    gate()
    const player = await requirePlayer(ctx)
    await switchGroupFor(ctx, player._id, args)
  },
})

export const leaveLeague = mutation({
  args: { leagueId: v.id('leagues'), today: v.string() },
  handler: async (ctx, args) => {
    gate()
    const player = await requirePlayer(ctx)
    await leaveLeagueFor(ctx, player._id, args)
  },
})

/**
 * "Not now" on the dashboard's league offer (spec §8.4). IDEMPOTENT: a repeat
 * just rewrites the stamp, like onboarding.dismiss. HERE rather than in
 * onboarding.ts because it is a league fact behind the league gate: the
 * dashboard card is a league surface, and onboarding.ts's own step already
 * hides itself through inLeague. getStatus reads it back as leagueOfferDismissed.
 */
export async function dismissLeagueOfferFor(ctx: WriterCtx, playerId: Id<'players'>) {
  await ctx.db.patch(playerId, { leagueOfferDismissedAt: Date.now() })
}

export const dismissLeagueOffer = mutation({
  args: {},
  handler: async (ctx) => {
    gate()
    const player = await requirePlayer(ctx)
    await dismissLeagueOfferFor(ctx, player._id)
  },
})

/**
 * Freeze one league-month. IDEMPOTENT: a snapshot that exists is never
 * rewritten, so a retried or duplicated job cannot restate who won, and a board
 * backfilled after close changes the live rows but never this.
 */
export async function closeLeagueMonthFor(ctx: WriterCtx, leagueId: Id<'leagues'>, month: PuzzleMonth): Promise<boolean> {
  if (!isMonth(month)) {
    console.error(`leagues.closeLeagueMonthFor: malformed month ${JSON.stringify(month)}; nothing written`)
    return false
  }
  const { year, month: m } = yearMonthOf(month)
  // .first(), NOT .unique(): a duplicate snapshot must not throw (see the sweep note below).
  const existing = await ctx.db
    .query('leagueMonthResults')
    .withIndex('by_league_year_month', (q) => q.eq('leagueId', leagueId).eq('year', year).eq('month', m))
    .first()
  if (existing) return false
  if (!(await ctx.db.get(leagueId))) return false

  const standings = await currentStandings(ctx, leagueId, await groupsOf(ctx, leagueId), month)
  await ctx.db.insert('leagueMonthResults', {
    leagueId,
    year,
    month: m,
    standings: standings.map(({ groupId, boards, attempts, average, contributors }) => ({ groupId, boards, attempts, average, contributors })),
    winnerGroupId: winnerOf(standings),
    closedAt: Date.now(),
  })
  return true
}

/**
 * Called by teamStats.sweep. SCHEDULES, never closes inline (zic8.2's D5): a
 * close that throws fails its own job and cannot roll the sweep back. Returns
 * how many jobs it queued.
 */
export async function scheduleLeagueClosesFor(ctx: SchedulingCtx, today: PuzzleDay): Promise<number> {
  let queued = 0
  for (const league of await ctx.db.query('leagues').collect()) {
    const month = monthToClose(today, toPuzzleDay(new Date(league.createdAt)))
    if (!month) continue
    const { year, month: m } = yearMonthOf(month)
    // .first(), NOT .unique(): this runs INLINE in teamStats.sweep, so a throw on a
    // (manually created) duplicate snapshot would roll back every team rollup and
    // challenge close that day.
    const done = await ctx.db
      .query('leagueMonthResults')
      .withIndex('by_league_year_month', (q) => q.eq('leagueId', league._id).eq('year', year).eq('month', m))
      .first()
    if (done) continue
    await ctx.scheduler.runAfter(0, internal.leagues.closeLeagueMonth, { leagueId: league._id, month })
    queued += 1
  }
  return queued
}

/** NOT gated on LEAGUES_ENABLED: switching the feature off must not leave a played month unclosed. */
export const closeLeagueMonth = internalMutation({
  args: { leagueId: v.id('leagues'), month: v.string() },
  handler: async (ctx, { leagueId, month }) => {
    try {
      await closeLeagueMonthFor(ctx, leagueId, month)
    } catch (error) {
      console.error(`leagues.closeLeagueMonth: ${leagueId} ${month} did not close`)
      throw error
    }
  },
})

/** The home card and the standings header: one row per league the caller is in. */
export async function myLeaguesFor(ctx: ReaderCtx, playerId: Id<'players'>, today: PuzzleDay) {
  const rows = await ctx.db
    .query('leagueMemberships')
    .withIndex('by_player_and_league', (q) => q.eq('playerId', playerId))
    .collect()
  const out = []
  for (const leagueId of new Set(rows.map((r) => r.leagueId))) {
    const intervals = rows.filter((r) => r.leagueId === leagueId)
    const membership = membershipOf(intervals, today)
    const league = await ctx.db.get(leagueId)
    if (!membership || !league) continue
    const groups = await groupsOf(ctx, leagueId)
    const nameOf = (id: GroupId) => {
      const g = groups.find((x) => x._id === id)
      return g ? { _id: id, name: g.name } : null
    }
    const group = nameOf(membership.groupId)
    const pendingGroup = membership.pendingGroupId ? nameOf(membership.pendingGroupId) : null
    if (!group || (membership.pendingGroupId && !pendingGroup)) {
      // A membership naming a group the league does not have: a broken invariant. Skip, never render a blank name.
      console.error('myLeaguesFor: membership names a group missing from its league', { playerId, leagueId, groupId: membership.groupId, pendingGroupId: membership.pendingGroupId })
      continue
    }
    const standing = (await currentStandings(ctx, leagueId, groups, monthOf(today))).find((s) => s.groupId === membership.groupId)
    out.push({
      league: { slug: league.slug, name: league.name },
      leagueId,
      group,
      since: membership.since,
      pending: pendingGroup ? { group: pendingGroup, from: membership.pendingFrom! } : null,
      rank: standing?.rank ?? null,
      average: standing?.average ?? null,
      boards: standing?.boards ?? 0,
    })
  }
  return out
}

/**
 * Pro view: the caller's month against their group's. Null if they have no
 * boards counted this month. Only the caller's own numbers and group totals
 * leave here (§3.2).
 */
export async function myContributionFor(ctx: ReaderCtx, playerId: Id<'players'>, slug: string, today: PuzzleDay) {
  const league = await ctx.db.query('leagues').withIndex('by_slug', (q) => q.eq('slug', slug)).unique()
  if (!league) return null
  const { year, month } = yearMonthOf(monthOf(today))
  const mine = await ctx.db
    .query('leagueMemberMonth')
    .withIndex('by_player_league_year_month', (q) => q.eq('playerId', playerId).eq('leagueId', league._id).eq('year', year).eq('month', month))
    .unique()
  if (!mine) return null
  const group = await ctx.db
    .query('leagueGroupMonth')
    .withIndex('by_group_year_month', (q) => q.eq('groupId', mine.groupId).eq('year', year).eq('month', month))
    .unique()
  return contributionOf(mine, group ?? { boards: 0, attempts: 0 })
}

export const myLeagues = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    const player = await requirePlayer(ctx)
    return { enabled: true as const, leagues: await myLeaguesFor(ctx, player._id, readToday(today)) }
  },
})

/** Callers with neither Pro nor an active Insights trial get `locked: true` rather than an error, so the page can render the teaser. */
export const myContribution = query({
  args: { slug: v.string(), today: v.string() },
  handler: async (ctx, { slug, today }) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    const player = await requirePlayer(ctx)
    // Pro OR an active Insights trial (owner decision 2026-10-08, spec §3). lib/insightsAccess.ts
    // owns the trial arithmetic; requirePlayer already returned the player, so no second read.
    const isPro = await isProFor(ctx, player._id)
    const { trialActive } = insightsAccess({ isPro, trialEndsAt: player.insightsTrialEndsAt, now: Date.now() })
    if (!contributionUnlocked({ isPro, trialActive })) return { enabled: true as const, locked: true as const }
    return {
      enabled: true as const,
      locked: false as const,
      contribution: await myContributionFor(ctx, player._id, slug, readToday(today)),
    }
  },
})
