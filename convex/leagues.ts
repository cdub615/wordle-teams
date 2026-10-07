import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'
import { accessError, requirePlayer } from './access.ts'
import { addMonths, isPlausibleToday, monthOf, toPuzzleDay } from './lib/puzzleDay.ts'
import { leaguesEnabled, standingsOf, yearMonthOf } from './lib/league.ts'
import type { PuzzleDay, PuzzleMonth } from './lib/puzzleDay.ts'
import type { Standing } from './lib/league.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server'

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

/** Run once per deployment: `pnpm exec convex run leagues:seedLeague '{"slug":"starting-words"}'`. */
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
export function readToday(today: string): PuzzleDay {
  const serverToday = toPuzzleDay(new Date())
  return isPlausibleToday(today as PuzzleDay, serverToday) ? (today as PuzzleDay) : serverToday
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
