#!/usr/bin/env node
/**
 * Rebuilds teamMonthStats for every (team, month) that actually has boards.
 *
 *   node --env-file=.env.local scripts/backfill-team-month-stats.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-team-month-stats.mjs
 *
 * Required environment (same set the copy uses):
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (or PROD_URL / PROD_KEY)
 *   CONVEX_URL                                             the target deployment
 *   CONVEX_MIGRATION_KEY                                   admin auth for internal functions
 *
 * WHY THIS EXISTS (wordle-teams-px45). teamMonthStats is a derived cache keyed by
 * team DOCUMENT ID. The cutover purge does not clear it and the copy re-inserts
 * every team under a NEW id, so after a purge+copy every row is orphaned and
 * convex/insights.ts — one `.unique()` lookup, no fallback — renders "Nobody on
 * this team has entered a board this month yet" for teams that plainly did.
 *
 * AND THE DAILY SWEEP CANNOT REPAIR IT. teamStats.sweep rebuilds
 * `monthOf(toPuzzleDay(new Date()))` and nothing else. The 2026-09-30 cutover
 * landed in the last hours of September UTC; the next sweep fired at 00:45 UTC on
 * October 1 and rebuilt OCTOBER. September was skipped and would never have been
 * revisited — the month boundary closed the repair window.
 *
 * WHY THE MONTHS COME FROM SUPABASE RATHER THAN FROM CONVEX. Only pairs that have
 * boards may be rebuilt: a team with no boards in a month still produces an
 * aggregate, and storeTeamMonthStats would INSERT it, so a blanket rebuild
 * manufactures thousands of zero rows — and a zero row is worse than no row,
 * because the panel renders an empty scoreboard where the absent-row path renders
 * an honest empty state. Deciding which pairs qualify means reading every board,
 * which is exactly the unbounded read Convex caps at 4,096 documents per
 * execution. Supabase has no such cap and is the source the copy came from.
 *
 * THE puzzleDay MUST BE COMPUTED THE WAY THE COPY COMPUTED IT, or a board near a
 * month boundary lands in a different month here than it did in Convex and the
 * month is missed. copy-from-supabase.mjs uses
 * `puzzleDayFor(s.date, tzByPlayerId.get(s.player_id))`; so does this. 593 of
 * 7,750 rows resolved to a different day than UTC on the 2026-09-30 copy, so this
 * is not hypothetical.
 *
 * SCOPED THROUGH selectCopyable, the same filter the copy writes through, so this
 * can never name a team the copy did not create.
 *
 * IDEMPOTENT. storeTeamMonthStats compares before writing and skips when the
 * numbers have not moved, so a second run is free.
 */
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'
import { connect, readAll, puzzleDayFor, HOME_TZ } from './lib/supabase-scope.mjs'
import { selectCopyable } from './lib/copy-filters.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const CONVEX_URL = process.env.CONVEX_URL
const CONVEX_MIGRATION_KEY = process.env.CONVEX_MIGRATION_KEY
if (!dryRun && (!CONVEX_URL || !CONVEX_MIGRATION_KEY)) {
  console.error('Set CONVEX_URL and CONVEX_MIGRATION_KEY, or pass --dry-run.')
  process.exit(1)
}

const supabase = connect()

console.log('\nReading Supabase...')
const [players, teams, scores] = await Promise.all([
  readAll(supabase, 'players', 'id,first_name,last_name,time_zone'),
  readAll(supabase, 'teams', 'id,name,player_ids'),
  readAll(supabase, 'daily_scores', 'player_id,date'),
])

const copyable = selectCopyable(players, teams)
const copyableTeamIds = new Set(copyable.teams.map((t) => t.id))
const tzByPlayerId = new Map(players.map((p) => [p.id, p.time_zone]))

// player -> the teams that hold them, restricted to teams the copy wrote.
const teamsByPlayer = new Map()
for (const team of copyable.teams) {
  for (const playerId of team.player_ids || []) {
    if (!teamsByPlayer.has(playerId)) teamsByPlayer.set(playerId, [])
    teamsByPlayer.get(playerId).push(team.id)
  }
}

// month -> Set(team legacy id). One entry per (team, month) that HAS a board.
const teamsByMonth = new Map()
let scoresConsidered = 0
for (const score of scores) {
  const teamIds = teamsByPlayer.get(score.player_id)
  if (teamIds === undefined) continue
  const month = puzzleDayFor(score.date, tzByPlayerId.get(score.player_id) || HOME_TZ).slice(0, 7)
  scoresConsidered += 1
  for (const teamId of teamIds) {
    if (!copyableTeamIds.has(teamId)) continue
    if (!teamsByMonth.has(month)) teamsByMonth.set(month, new Set())
    teamsByMonth.get(month).add(teamId)
  }
}

const months = [...teamsByMonth.keys()].sort()
const pairs = months.reduce((n, m) => n + teamsByMonth.get(m).size, 0)

console.log(`\n  teams in scope        ${copyable.teams.length} of ${teams.length}`)
console.log(`  boards considered     ${scoresConsidered} of ${scores.length}`)
console.log(`  months with boards    ${months.length}  (${months[0]} .. ${months[months.length - 1]})`)
console.log(`  (team, month) pairs   ${pairs}`)

if (dryRun) {
  console.log('\n  per month:')
  for (const m of months) console.log(`    ${m}  ${String(teamsByMonth.get(m).size).padStart(4)} teams`)
  console.log('\n  --dry-run: nothing written.\n')
  process.exit(0)
}

const convex = new ConvexHttpClient(CONVEX_URL)
convex.setAdminAuth(CONVEX_MIGRATION_KEY)

console.log(`\nWriting to ${CONVEX_URL}\n`)
let scheduled = 0
const missingByMonth = new Map()
for (const month of months) {
  const teamLegacyIds = [...teamsByMonth.get(month)]
  const res = await convex.mutation(internal.teamStats.backfillMonth, { month, teamLegacyIds })
  scheduled += res.scheduled
  if (res.missing.length > 0) missingByMonth.set(month, res.missing)
  console.log(`  ${month}  asked ${String(teamLegacyIds.length).padStart(4)}  scheduled ${String(res.scheduled).padStart(4)}`)
}

console.log(`\n  scheduled ${scheduled} rollups across ${months.length} months.`)

// A legacy id with no team in the deployment is the SHAPE OF THE BUG being
// repaired, so it is reported rather than swallowed.
if (missingByMonth.size > 0) {
  console.log('\n  !! team legacy ids with no team in this deployment:')
  for (const [month, ids] of missingByMonth) console.log(`    ${month}  ${ids.join(', ')}`)
} else {
  console.log('  every team asked for was found.')
}

console.log('\n  Rollups run as scheduled mutations; allow a moment before checking the panel.\n')
