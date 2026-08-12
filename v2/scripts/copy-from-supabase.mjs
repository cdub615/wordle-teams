#!/usr/bin/env node
/**
 * Copies real data out of Supabase into Convex. Read-only against Supabase.
 *
 * This is not a one-shot. It runs for the owner's teams now, for everyone at the
 * Phase 7 parity audit, and once more inside the cutover window — so every write
 * is an upsert keyed on the Supabase primary key, and running it twice must be
 * indistinguishable from running it once.
 *
 *   node --env-file=../.env.production.local scripts/copy-from-supabase.mjs --scope=mine --dry-run
 *
 * Required environment:
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (or PROD_URL / PROD_KEY)
 *   CONVEX_URL                                             the target deployment
 *   CONVEX_MIGRATION_KEY                                   admin auth for internal functions
 *   ME_EMAIL                                               only for --scope=mine
 *
 * The migration key is deliberately NOT the everyday deploy key. It needs
 * deployment:functions:runInternalMutations and :runInternalQueries — the power
 * to rewrite every table — which the day-to-day key has no business carrying.
 * Keep it until cutover, since this script runs again at the Phase 7 parity
 * audit and inside the cutover window, then revoke it in Phase 9.
 *
 * Scope:
 *   --scope=mine  (default) teams ME_EMAIL belongs to, and everyone in them.
 *   --scope=all             every team and player.
 *
 * PRINTS COUNTS, NEVER ADDRESSES. This repository is public.
 */
import { createClient } from '@supabase/supabase-js'
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const scope = (args.find((a) => a.startsWith('--scope=')) ?? '--scope=mine').split('=')[1]
const dryRun = has('--dry-run')

if (!['mine', 'all'].includes(scope)) {
  console.error(`Unknown --scope=${scope}. Use 'mine' or 'all'.`)
  process.exit(1)
}

const SUPABASE_URL = process.env.PROD_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.PROD_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const CONVEX_URL = process.env.CONVEX_URL
const CONVEX_MIGRATION_KEY = process.env.CONVEX_MIGRATION_KEY
const ME = (process.env.ME_EMAIL || '').toLowerCase()

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set PROD_URL/PROD_KEY, or pass --env-file=../.env.production.local')
  process.exit(1)
}
// Same guard the other prod scripts carry: refuse to run against anything but
// the known production project, so a stale env file cannot point this somewhere
// unexpected.
if (!SUPABASE_URL.includes('dcfqzbdusxhrfgvnpwqc')) {
  console.error(`Refusing to run: ${SUPABASE_URL} is not the prod project.`)
  process.exit(1)
}
if (scope === 'mine' && !ME) {
  console.error('Set ME_EMAIL for --scope=mine. Kept out of source: this repo is public.')
  process.exit(1)
}
if (!dryRun && (!CONVEX_URL || !CONVEX_MIGRATION_KEY)) {
  console.error('Set CONVEX_URL and CONVEX_MIGRATION_KEY, or pass --dry-run.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function readAll(table, select = '*') {
  const rows = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + size - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < size) break
  }
  return rows
}

const ms = (t) => (t ? new Date(t).getTime() : undefined)
const opt = (s) => (s === null || s === undefined || s === '' ? undefined : s)

console.log(`Reading Supabase (scope=${scope})...`)
const [players, teams, scores, winners, memberships, webhooks] = await Promise.all([
  readAll('players'),
  readAll('teams'),
  readAll('daily_scores'),
  readAll('monthly_winners'),
  readAll('player_customer'),
  readAll('webhook_events'),
])

// --- scope resolution --------------------------------------------------------

let scopedTeams = teams
let scopedPlayerIds = new Set(players.map((p) => p.id))

if (scope === 'mine') {
  const me = players.find((p) => (p.email || '').toLowerCase() === ME)
  if (!me) {
    console.error('ME_EMAIL does not match any player in production.')
    process.exit(1)
  }
  scopedTeams = teams.filter((t) => (t.player_ids || []).includes(me.id) || t.creator === me.id)
  // Everyone in those teams, so scoreboards have real opponents rather than a
  // single player talking to themselves.
  scopedPlayerIds = new Set([me.id, ...scopedTeams.flatMap((t) => t.player_ids || [])])
}

const scopedTeamIds = new Set(scopedTeams.map((t) => t.id))
const scopedPlayers = players.filter((p) => scopedPlayerIds.has(p.id))
const scopedScores = scores.filter((s) => scopedPlayerIds.has(s.player_id))
const scopedWinners = winners.filter((w) => scopedTeamIds.has(w.team_id))
const scopedMemberships = memberships.filter((m) => scopedPlayerIds.has(m.player_id))
const scopedWebhooks = webhooks.filter((w) => scopedPlayerIds.has(w.player_id))

console.log('\nIn scope:')
console.log(`  players          ${scopedPlayers.length} of ${players.length}`)
console.log(`  teams            ${scopedTeams.length} of ${teams.length}`)
console.log(`  dailyScores      ${scopedScores.length} of ${scores.length}`)
console.log(`  monthlyWinners   ${scopedWinners.length} of ${winners.length}`)
console.log(`  playerMembership ${scopedMemberships.length} of ${memberships.length}`)
console.log(`  webhookEvents    ${scopedWebhooks.length} of ${webhooks.length}`)

// How many invited addresses production stores in a form that would never have
// matched. Reported because it quantifies the v1 bug this copy silently repairs.
const mixedCaseInvites = scopedTeams
  .flatMap((t) => t.invited || [])
  .filter((e) => e !== e.toLowerCase()).length
if (mixedCaseInvites > 0) {
  console.log(`\n  ${mixedCaseInvites} invited address(es) are mixed-case and will be normalised.`)
}

// --- shaping -----------------------------------------------------------------

const playerRows = scopedPlayers.map((p) => ({
  legacyId: p.id,
  email: (p.email || '').toLowerCase(),
  firstName: opt(p.first_name),
  lastName: opt(p.last_name),
  hasPwa: !!p.has_pwa,
  timeZone: opt(p.time_zone),
  reminderDeliveryMethods: p.reminder_delivery_methods || [],
  reminderDeliveryTime: p.reminder_delivery_time,
  lastBoardEntryReminder: ms(p.last_board_entry_reminder),
  createdAt: ms(p.created_at),
}))

const teamRows = scopedTeams.map((t) => ({
  legacyId: t.id,
  name: t.name,
  creatorLegacyId: opt(t.creator),
  playerLegacyIds: t.player_ids || [],
  invited: (t.invited || []).map((e) => e.toLowerCase()),
  oneGuess: t.one_guess,
  twoGuesses: t.two_guesses,
  threeGuesses: t.three_guesses,
  fourGuesses: t.four_guesses,
  fiveGuesses: t.five_guesses,
  sixGuesses: t.six_guesses,
  failed: t.failed,
  nA: t.n_a,
  playWeekends: !!t.play_weekends,
  showLetters: !!t.show_letters,
  createdAt: ms(t.created_at),
}))

const scoreRows = scopedScores.map((s) => ({
  legacyId: s.id,
  playerLegacyId: s.player_id,
  date: ms(s.date),
  guesses: s.guesses || [],
  answer: opt(s.answer),
  createdAt: ms(s.created_at),
}))

const winnerRows = scopedWinners.map((w) => ({
  legacyId: w.id,
  playerLegacyId: w.player_id,
  teamLegacyId: w.team_id,
  year: w.year,
  month: w.month,
  hasSeenCelebrationLegacyIds: w.has_seen_celebration || [],
}))

const membershipRows = scopedMemberships.map((m) => ({
  legacyId: m.id,
  playerLegacyId: m.player_id,
  membershipStatus: m.membership_status,
}))

const webhookRows = scopedWebhooks.map((w) => ({
  legacyId: w.id,
  webhookId: opt(w.webhook_id),
  playerLegacyId: w.player_id,
  eventName: w.event_name,
  body: w.body,
  processed: !!w.processed,
  processingError: opt(w.processing_error),
  createdAt: ms(w.created_at),
}))

if (dryRun) {
  console.log('\n--dry-run: nothing written.')
  process.exit(0)
}

// --- writing -----------------------------------------------------------------

const convex = new ConvexHttpClient(CONVEX_URL)
convex.setAdminAuth(CONVEX_MIGRATION_KEY)

// Convex bounds how much a single mutation may write, so batch. Small enough to
// stay well inside the limit even for the widest rows (webhook bodies).
const CHUNK = 200
async function writeAll(label, fn, rows) {
  const totals = {}
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await convex.mutation(fn, { rows: rows.slice(i, i + CHUNK) })
    for (const [k, v] of Object.entries(res)) totals[k] = (totals[k] ?? 0) + v
  }
  const summary = Object.entries(totals)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  console.log(`  ${label.padEnd(17)} ${summary || '(nothing to do)'}`)
  return totals
}

console.log('\nWriting to Convex...')
// Order matters: teams reference players, and everything else references both.
await writeAll('players', internal.migrate.upsertPlayers, playerRows)
const teamTotals = await writeAll('teams', internal.migrate.upsertTeams, teamRows)
await writeAll('dailyScores', internal.migrate.upsertDailyScores, scoreRows)
await writeAll('monthlyWinners', internal.migrate.upsertMonthlyWinners, winnerRows)
await writeAll('playerMembership', internal.migrate.upsertMemberships, membershipRows)
await writeAll('webhookEvents', internal.migrate.upsertWebhookEvents, webhookRows)

if (teamTotals.droppedMembers > 0) {
  console.log(
    `\n  note: ${teamTotals.droppedMembers} team membership(s) referenced a player outside the copied scope and were dropped.`,
  )
  console.log('  Expected with --scope=mine. It would be a real problem with --scope=all.')
}

const counts = await convex.query(internal.migrate.counts, {})
console.log('\nConvex now holds:')
for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(17)} ${n}`)
