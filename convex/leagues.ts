import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import { accessError, isProFor, requirePlausibleToday, requirePlayer } from './access.ts'
import { isMonth } from './lib/monthWindow.ts'
import { attemptsFor } from './lib/board.ts'
import { addMonths, isPlausibleToday, monthOf, monthRange, toPuzzleDay } from './lib/puzzleDay.ts'
import { contributionOf, groupDelta, leaguesEnabled, membershipOf, memberTotalsFor, monthToClose, planJoin, planLeave, planSwitch, standingsOf, winnerOf, yearMonthOf } from './lib/league.ts'
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

export type LeagueSpec = { slug: string; name: string; featured: boolean; groups: { slug: string; name: string }[] }

/** v1's one league (§1). Seeded per deployment by `seedLeague`. */
export const STARTING_WORDS: LeagueSpec = {
  slug: 'starting-words',
  name: 'Starting Words',
  featured: true,
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
    (await ctx.db.insert('leagues', { slug: spec.slug, name: spec.name, featured: spec.featured, createdAt: now }))
  if (found) await ctx.db.patch(found._id, { name: spec.name, featured: spec.featured })

  const existing = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', leagueId)).collect()
  for (const [order, group] of spec.groups.entries()) {
    const row = existing.find((e) => e.slug === group.slug)
    if (row) await ctx.db.patch(row._id, { name: group.name, order })
    else await ctx.db.insert('leagueGroups', { leagueId, slug: group.slug, name: group.name, order, memberCount: 0 })
  }
  return leagueId
}

/**
 * Run once per deployment: `pnpm exec convex run leagues:seedLeague '{"slug":"starting-words"}'`.
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
  await recomputeLeagueMonthFor(ctx, playerId, monthOf(today))
}

export async function switchGroupFor(ctx: WriterCtx, playerId: Id<'players'>, args: { groupId: GroupId; today: string }) {
  const today = requirePlausibleToday(args.today)
  const group = await requireGroup(ctx, args.groupId)
  const rows = await intervalsOf(ctx, playerId, group.leagueId)
  await applyPlan(ctx, playerId, group.leagueId, rows, planSwitch(rows, today, group._id))
  await recomputeLeagueMonthFor(ctx, playerId, monthOf(today))
}

export async function leaveLeagueFor(ctx: WriterCtx, playerId: Id<'players'>, args: { leagueId: Id<'leagues'>; today: string }) {
  const today = requirePlausibleToday(args.today)
  if (!(await ctx.db.get(args.leagueId))) throw accessError('UNKNOWN_LEAGUE')
  const rows = await intervalsOf(ctx, playerId, args.leagueId)
  await applyPlan(ctx, playerId, args.leagueId, rows, planLeave(rows, today))
  await recomputeLeagueMonthFor(ctx, playerId, monthOf(today))
}

/**
 * Rebuild ONE player's league rows for ONE month from their own boards, and
 * move each group row by the difference. Called on every board write
 * (scores.ts) and after every membership change.
 *
 * COST: for a player who has NEVER joined a league, one index read and nothing
 * else — which is almost everyone. A FORMER member still pays the member cost,
 * because membership rows survive a leave. For a member, their month's boards plus one group row per
 * league. Never O(group size): the group row moves by delta (§7).
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
  // MEMBERSHIP ROWS ARE NEVER DELETED outside pruneLeagueRowsFor (leave patches,
  // it does not delete), so every league this player has a member-month row in
  // is already named here — and a point read per league keeps this write's read
  // set to ONE month rather than the player's whole history.
  const leagueIds = new Set(memberships.map((r) => r.leagueId))
  if (leagueIds.size === 0) return
  const existing: Doc<'leagueMemberMonth'>[] = []
  for (const leagueId of leagueIds) {
    const row = await ctx.db
      .query('leagueMemberMonth')
      .withIndex('by_player_league_year_month', (q) => q.eq('playerId', playerId).eq('leagueId', leagueId).eq('year', year).eq('month', m))
      .unique()
    if (row) existing.push(row)
  }

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
export async function moveGroup(
  ctx: WriterCtx,
  leagueId: Id<'leagues'>,
  groupId: GroupId,
  year: number,
  month: number,
  d: { boards: number; attempts: number; contributors: number },
) {
  // recomputeLeagueMonthFor never reaches this (equal totals `continue` first),
  // but Task 9's prune and any other caller may.
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
    const intervals = rows.filter((r) => r.leagueId === leagueId).sort((a, b) => a.fromDay.localeCompare(b.fromDay))
    const membership = membershipOf(intervals, today)
    const league = await ctx.db.get(leagueId)
    if (!membership || !league) continue
    const groups = await groupsOf(ctx, leagueId)
    const nameOf = (id: GroupId) => ({ _id: id, name: groups.find((g) => g._id === id)?.name ?? '' })
    const standing = (await currentStandings(ctx, leagueId, groups, monthOf(today))).find((s) => s.groupId === membership.groupId)
    out.push({
      league: { slug: league.slug, name: league.name },
      leagueId,
      group: nameOf(membership.groupId),
      since: membership.since,
      pending: membership.pendingGroupId ? { group: nameOf(membership.pendingGroupId), from: membership.pendingFrom! } : null,
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
  return contributionOf(mine, group ?? mine)
}

export const myLeagues = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    const player = await requirePlayer(ctx)
    return { enabled: true as const, leagues: await myLeaguesFor(ctx, player._id, readToday(today)) }
  },
})

/** Free callers get `locked: true` rather than an error, so the page can render the teaser. */
export const myContribution = query({
  args: { slug: v.string(), today: v.string() },
  handler: async (ctx, { slug, today }) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    const player = await requirePlayer(ctx)
    if (!(await isProFor(ctx, player._id))) return { enabled: true as const, locked: true as const }
    return {
      enabled: true as const,
      locked: false as const,
      contribution: await myContributionFor(ctx, player._id, slug, readToday(today)),
    }
  },
})
