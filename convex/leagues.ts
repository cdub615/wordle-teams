import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import { accessError, isProFor, requirePlausibleToday, requirePlayer } from './access.ts'
import { isMonth } from './lib/monthWindow.ts'
import { attemptsFor } from './lib/board.ts'
import { addDays, addMonths, isPlausibleToday, monthOf, monthRange, toPuzzleDay } from './lib/puzzleDay.ts'
import { insightsAccess } from './lib/insightsAccess.ts'
import { isAnswerWord, normalizeWord } from './lib/answerWords.ts'
import { contributionOf, contributionUnlocked, groupAverageOf, groupDelta, isLargeLeague, largeLeagueSlice, leaguesEnabled, membershipOf, memberTotalsFor, monthToClose, PICKER_INLINE_MAX, planJoin, planLeave, planSwitch, standingsOf, winnerOf, yearMonthOf } from './lib/league.ts'
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
type GroupId = Id<'leagueGroups'>

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

/**
 * A word league's quick picks: its most-joined groups, highest memberCount
 * first. Ties at the cut fall to the index's own order (newest first); within
 * the picks, ties show in display order. Groups with memberCount 0 are kept: a
 * young league's picks are its seeded openers.
 */
export const POPULAR_GROUPS = PICKER_INLINE_MAX

async function popularGroupsOf(ctx: ReaderCtx, leagueId: Id<'leagues'>): Promise<Doc<'leagueGroups'>[]> {
  const top = await ctx.db
    .query('leagueGroups')
    .withIndex('by_league_and_memberCount', (q) => q.eq('leagueId', leagueId))
    .order('desc')
    .take(POPULAR_GROUPS)
  return top.sort((a, b) => b.memberCount - a.memberCount || a.order - b.order)
}

const groupView = (g: Doc<'leagueGroups'>) => ({ _id: g._id, slug: g.slug, name: g.name, memberCount: g.memberCount })

/**
 * Every league, with the groups its picker offers: a fixed league's groups in
 * order, a word league's POPULAR_GROUPS (never the dictionary).
 */
export async function leaguesFor(ctx: ReaderCtx) {
  const leagues = await ctx.db.query('leagues').collect()
  return await Promise.all(
    leagues.map(async (league) => {
      const groupSource = league.groupSource ?? ('fixed' as const)
      const groups = groupSource === 'answer-words' ? await popularGroupsOf(ctx, league._id) : await groupsOf(ctx, league._id)
      return {
        leagueId: league._id,
        slug: league.slug,
        name: league.name,
        featured: league.featured,
        groupSource,
        groups: groups.map(groupView),
      }
    }),
  )
}

/**
 * A large league's live month: ONLY groups with a row this month (no zero-fill,
 * spec v2 §4.5). One range read plus one point read per ACTIVE group, so the
 * cost grows with the groups played this month, never with the dictionary.
 */
async function activeStandings(ctx: ReaderCtx, leagueId: Id<'leagues'>, month: PuzzleMonth) {
  const { year, month: m } = yearMonthOf(month)
  const rows = await ctx.db
    .query('leagueGroupMonth')
    .withIndex('by_league_year_month', (q) => q.eq('leagueId', leagueId).eq('year', year).eq('month', m))
    .collect()
  const docs = await Promise.all(rows.map((r) => ctx.db.get(r.groupId)))
  const live: { groupId: GroupId; order: number; boards: number; attempts: number; contributors: number }[] = []
  const groups = new Map<GroupId, Doc<'leagueGroups'>>()
  for (const [i, row] of rows.entries()) {
    const group = docs[i]
    if (!group) {
      // A row naming a missing group is a broken invariant: skip it, never render a blank name.
      console.error(`leagues: group-month row ${row._id} names missing group ${row.groupId}`)
      continue
    }
    groups.set(group._id, group)
    live.push({ groupId: row.groupId, order: group.order, boards: row.boards, attempts: row.attempts, contributors: row.contributors })
  }
  return { standings: standingsOf(live), groups }
}

/**
 * The standings page. CLOSED MONTHS COME FROM leagueMonthResults ONLY — a live
 * row for a closed month can have been restated by backfill (§4.1).
 *
 * TWO SHAPES. A small fixed league keeps v1's (every group, zero-filled) plus
 * `large: false`, and ignores `viewerGroupId`. A large league (isLargeLeague)
 * returns the slice (spec v2 §4.5) with `large: true`; its `standings` is
 * shown + viewer, the rows the page lists, and `groups` names only the groups
 * the payload references. `viewerGroupId` is any group id the client passes:
 * group totals are public (§3.2), so a foreign id learns nothing new.
 */
export async function standingsFor(ctx: ReaderCtx, slug: string, today: PuzzleDay, viewerGroupId: GroupId | null = null) {
  const league = await ctx.db.query('leagues').withIndex('by_slug', (q) => q.eq('slug', slug)).unique()
  if (!league) return null
  const month = monthOf(today)

  const results = await ctx.db
    .query('leagueMonthResults')
    .withIndex('by_league_year_month', (q) => q.eq('leagueId', league._id))
    .collect()
  const previous = addMonths(month, -1)
  const prev = yearMonthOf(previous)
  const last = results.find((r) => r.year === prev.year && r.month === prev.month)

  // A word league never collects its groups: there may be thousands.
  const allGroups = league.groupSource === 'answer-words' ? null : await groupsOf(ctx, league._id)
  if (allGroups && !isLargeLeague(league.groupSource, allGroups.length)) {
    return {
      large: false as const,
      league: { slug: league.slug, name: league.name },
      month,
      groups: allGroups.map(groupView),
      standings: await currentStandings(ctx, league._id, allGroups, month),
      lastMonth: last ? { month: previous, winnerGroupId: last.winnerGroupId } : null,
      monthsWon: allGroups.map((g) => ({ groupId: g._id, count: results.filter((r) => r.winnerGroupId === g._id).length })),
    }
  }

  const { standings, groups } = await activeStandings(ctx, league._id, month)
  const { shown, viewer, unrankedCount } = largeLeagueSlice(standings, viewerGroupId)

  const won = new Map<GroupId, number>()
  for (const r of results) if (r.winnerGroupId) won.set(r.winnerGroupId, (won.get(r.winnerGroupId) ?? 0) + 1)
  const monthsWon = [...won].map(([groupId, count]) => ({ groupId, count }))

  // SNAPSHOTS ARE STORED IN RANKED ORDER (closeLeagueMonthFor writes standingsOf
  // output), and ranks are 1..n over the ranked rows, which come first.
  let viewerRank: number | null = null
  if (last && viewerGroupId) {
    const i = last.standings.findIndex((s) => s.groupId === viewerGroupId)
    if (i >= 0 && last.standings[i].average !== null) viewerRank = i + 1
  }

  // Names for every group referenced: winners inactive this month need a read each,
  // bounded by the number of distinct winners (at most one per closed month).
  const referenced = new Set<GroupId>([...shown.map((s) => s.groupId), ...(viewer ? [viewer.groupId] : []), ...won.keys()])
  const named: Doc<'leagueGroups'>[] = []
  for (const id of referenced) {
    const group = groups.get(id) ?? (await ctx.db.get(id))
    if (group) named.push(group)
  }

  return {
    large: true as const,
    league: { slug: league.slug, name: league.name },
    month,
    groups: named.map(groupView),
    shown,
    viewer,
    unrankedCount,
    standings: viewer ? [...shown, viewer] : shown,
    lastMonth: last ? { month: previous, winnerGroupId: last.winnerGroupId, viewerRank } : null,
    monthsWon,
  }
}

/**
 * Search (spec v2 §4.5): one group's live month by its word. Two point reads
 * after the league. NO RANK: that would need the whole month's rows. Null for a
 * malformed word or a word with no group in this league.
 */
export async function groupStandingFor(ctx: ReaderCtx, slug: string, today: PuzzleDay, word: string) {
  const slugWord = normalizeWord(word)
  if (slugWord === null) return null
  const league = await ctx.db.query('leagues').withIndex('by_slug', (q) => q.eq('slug', slug)).unique()
  if (!league) return null
  const group = await ctx.db
    .query('leagueGroups')
    .withIndex('by_league_and_slug', (q) => q.eq('leagueId', league._id).eq('slug', slugWord))
    .unique()
  if (!group) return null
  const { year, month } = yearMonthOf(monthOf(today))
  const row = await ctx.db
    .query('leagueGroupMonth')
    .withIndex('by_group_year_month', (q) => q.eq('groupId', group._id).eq('year', year).eq('month', month))
    .unique()
  const totals = { boards: row?.boards ?? 0, attempts: row?.attempts ?? 0 }
  return {
    group: { _id: group._id, name: group.name, memberCount: group.memberCount },
    ...totals,
    average: groupAverageOf(totals),
    contributors: row?.contributors ?? 0,
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

/** `groupId` is the viewer's group, for a large league's slice. Any id is safe: group totals are public. */
export const standings = query({
  args: { slug: v.string(), today: v.string(), groupId: v.optional(v.id('leagueGroups')) },
  handler: async (ctx, { slug, today, groupId }) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    await requirePlayer(ctx)
    return { enabled: true as const, view: await standingsFor(ctx, slug, readToday(today), groupId ?? null) }
  },
})

export const groupStanding = query({
  args: { slug: v.string(), today: v.string(), word: v.string() },
  handler: async (ctx, { slug, today, word }) => {
    if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }
    await requirePlayer(ctx)
    return { enabled: true as const, standing: await groupStandingFor(ctx, slug, readToday(today), word) }
  },
})

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

/**
 * A word league's group for `word`: the existing one, or a new one if `word`
 * is an answer word (spec v2 §4.2). An existing group is always joinable, even if
 * its word isn't on the list (grandfathered v1 groups), but a non-answer word
 * never creates one. CONCURRENCY: two first-joins of one word both read the
 * empty by_league_and_slug range; the second's read set is invalidated by the
 * first's insert, so Convex retries it and it finds the group. Never two groups.
 */
export async function resolveWordGroupFor(ctx: WriterCtx, league: Doc<'leagues'>, input: string): Promise<GroupId> {
  const word = normalizeWord(input)
  if (word === null) throw accessError('UNKNOWN_WORD')
  const found = await ctx.db
    .query('leagueGroups')
    .withIndex('by_league_and_slug', (q) => q.eq('leagueId', league._id).eq('slug', word))
    .unique()
  if (found) return found._id
  if (league.groupSource !== 'answer-words' || !isAnswerWord(word)) throw accessError('UNKNOWN_WORD')
  // ORDER IS CREATION TIME: no collect of the league's groups to find a max, and
  // order is only a display tiebreak among equals.
  return await ctx.db.insert('leagueGroups', {
    leagueId: league._id,
    slug: word,
    name: word.toUpperCase(),
    order: Date.now(),
    memberCount: 0,
  })
}

/**
 * THE PLAN IS CHECKED BEFORE THE WORD. Convex rolls back a refused mutation
 * entirely, so in production a refused join or switch can never leave a new,
 * empty group behind, pre-check or not (the joinWord wrapper test proves that end
 * to end). What the pre-check buys:
 *  (a) ERROR ORDER: a member who types a bad word hears ALREADY_IN_LEAGUE (or a
 *      non-member switching hears NOT_IN_LEAGUE), the thing actually stopping
 *      them, not UNKNOWN_WORD;
 *  (b) SAFETY for any future caller that catches the refusal inside the same
 *      transaction: nothing has been inserted yet, so nothing survives the catch.
 * PLACEHOLDER TARGET: planJoin refuses on liveOf(intervals, today) alone, and
 * planSwitch's NOT_IN_LEAGUE likewise precedes any read of its target, so the
 * target id cannot change whether either refuses. The real plan is made (again)
 * by joinGroupFor/switchGroupFor, which also re-validate today and re-read the
 * intervals: harmless duplication inside one transaction.
 */
const PRECHECK_TARGET = 'precheck-placeholder' as GroupId

async function requireLeague(ctx: ReaderCtx, leagueId: Id<'leagues'>) {
  const league = await ctx.db.get(leagueId)
  if (!league) throw accessError('UNKNOWN_LEAGUE')
  return league
}

type WordArgs = { leagueId: Id<'leagues'>; word: string; today: string }

/** Validation order as joinGroupFor's: today, the league, the plan, then the word. */
export async function joinWordFor(ctx: WriterCtx, playerId: Id<'players'>, args: WordArgs) {
  const today = requirePlausibleToday(args.today)
  const league = await requireLeague(ctx, args.leagueId)
  const plan = planJoin(await intervalsOf(ctx, playerId, league._id), today, PRECHECK_TARGET)
  if ('refused' in plan) throw accessError(plan.refused)
  const groupId = await resolveWordGroupFor(ctx, league, args.word)
  await joinGroupFor(ctx, playerId, { groupId, today: args.today })
}

export async function switchWordFor(ctx: WriterCtx, playerId: Id<'players'>, args: WordArgs) {
  const today = requirePlausibleToday(args.today)
  const league = await requireLeague(ctx, args.leagueId)
  const plan = planSwitch(await intervalsOf(ctx, playerId, league._id), today, PRECHECK_TARGET)
  if ('refused' in plan) throw accessError(plan.refused)
  const groupId = await resolveWordGroupFor(ctx, league, args.word)
  await switchGroupFor(ctx, playerId, { groupId, today: args.today })
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

const wordArgs = { leagueId: v.id('leagues'), word: v.string(), today: v.string() }

export const joinWord = mutation({
  args: wordArgs,
  handler: async (ctx, args) => {
    gate()
    const player = await requirePlayer(ctx)
    await joinWordFor(ctx, player._id, args)
  },
})

export const switchWord = mutation({
  args: wordArgs,
  handler: async (ctx, args) => {
    gate()
    const player = await requirePlayer(ctx)
    await switchWordFor(ctx, player._id, args)
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
