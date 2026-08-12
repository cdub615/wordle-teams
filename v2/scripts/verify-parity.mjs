#!/usr/bin/env node
/**
 * Asserts that what Convex holds matches what Supabase holds, for whatever scope
 * was copied. Exits non-zero on any mismatch.
 *
 *   ME_EMAIL=... CONVEX_URL=... CONVEX_MIGRATION_KEY=... \
 *     node --env-file=../.env.production.local scripts/verify-parity.mjs --scope=mine
 *
 * WHY THIS EXISTS. The copy runs three times — the owner's teams now, everyone
 * at the Phase 7 parity audit, and once more inside the cutover window. The last
 * of those happens with production in maintenance mode and a DNS flip waiting on
 * it. Discovering a silent undercount then is the worst possible moment, so the
 * check is written now, while there is time to be wrong about it.
 *
 * It compares row counts, the full monthly-winner set, membership statuses, team
 * composition, and a per-player daily-score fingerprint including the puzzleDay
 * histogram — which is what catches a board landing on the wrong day.
 *
 * PRINTS COUNTS AND IDS, NEVER ADDRESSES. This repo is public.
 */
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'
import { connect, readScoped, puzzleDayFor } from './lib/supabase-scope.mjs'

const args = process.argv.slice(2)
const scope = (args.find((a) => a.startsWith('--scope=')) ?? '--scope=mine').split('=')[1]
if (!['mine', 'all'].includes(scope)) {
  console.error(`Unknown --scope=${scope}. Use 'mine' or 'all'.`)
  process.exit(1)
}

const CONVEX_URL = process.env.CONVEX_URL
const CONVEX_MIGRATION_KEY = process.env.CONVEX_MIGRATION_KEY
const ME = (process.env.ME_EMAIL || '').toLowerCase()
if (!CONVEX_URL || !CONVEX_MIGRATION_KEY) {
  console.error('Set CONVEX_URL and CONVEX_MIGRATION_KEY.')
  process.exit(1)
}
if (scope === 'mine' && !ME) {
  console.error('Set ME_EMAIL for --scope=mine.')
  process.exit(1)
}

const failures = []
const check = (label, expected, actual) => {
  const ok = expected === actual
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(42)} supabase=${expected} convex=${actual}`)
  if (!ok) failures.push(`${label}: supabase=${expected} convex=${actual}`)
}

const supabase = connect()
console.log(`Reading Supabase (scope=${scope})...`)
const src = await readScoped(supabase, scope, ME)

const convex = new ConvexHttpClient(CONVEX_URL)
convex.setAdminAuth(CONVEX_MIGRATION_KEY)
console.log('Reading Convex...')
const [counts, probe] = await Promise.all([
  convex.query(internal.migrate.counts, {}),
  convex.query(internal.migrate.parityProbe, {}),
])

// --- row counts ---------------------------------------------------------------

console.log('\nRow counts:')
check('players', src.players.length, counts.players)
check('teams', src.teams.length, counts.teams)
check('dailyScores', src.scores.length, counts.dailyScores)
check('monthlyWinners', src.winners.length, counts.monthlyWinners)
check('playerMembership', src.memberships.length, counts.playerMembership)
check('webhookEvents', src.webhooks.length, counts.webhookEvents)

// --- teams ---------------------------------------------------------------------

console.log('\nTeams:')
const convexTeams = new Map(probe.teams.map((t) => [t.legacyId, t]))
for (const t of src.teams) {
  const got = convexTeams.get(t.id)
  if (!got) {
    console.log(`  FAIL team ${t.id} missing from Convex`)
    failures.push(`team ${t.id} missing`)
    continue
  }
  check(`team ${t.id} name`, t.name, got.name)
  check(`team ${t.id} member count`, (t.player_ids || []).length, got.playerCount)
  // Invited addresses are normalised on write, so compare against the normalised
  // form — comparing raw would flag the repair as a mismatch.
  const expectedInvited = [...new Set((t.invited || []).map((e) => e.toLowerCase()))].sort()
  const actualInvited = [...new Set(got.invited)].sort()
  check(`team ${t.id} invited count`, expectedInvited.length, actualInvited.length)
  if (expectedInvited.join('|') !== actualInvited.join('|')) {
    failures.push(`team ${t.id} invited set differs`)
    console.log(`  FAIL team ${t.id} invited set differs`)
  }
}

// --- monthly winners ------------------------------------------------------------

console.log('\nMonthly winners (the design’s named aggregate):')
const key = (w) => `${w.team_id ?? w.teamLegacyId}|${w.year}|${w.month}`
const srcWinners = new Map(src.winners.map((w) => [key(w), w.player_id]))
const gotWinners = new Map(probe.winners.map((w) => [key(w), w.winnerLegacyId]))
check('distinct team/year/month keys', srcWinners.size, gotWinners.size)
let winnerMismatches = 0
for (const [k, playerId] of srcWinners) {
  if (gotWinners.get(k) !== playerId) winnerMismatches++
}
check('winners agreeing on the player', srcWinners.size, srcWinners.size - winnerMismatches)

// --- membership -----------------------------------------------------------------

console.log('\nMembership:')
const srcStatus = new Map(src.memberships.map((m) => [m.id, m.membership_status]))
const gotStatus = new Map(probe.memberships.map((m) => [m.legacyId, m.membershipStatus]))
let statusMismatches = 0
for (const [id, status] of srcStatus) {
  if (gotStatus.get(id) !== status) statusMismatches++
}
check('statuses agreeing', srcStatus.size, srcStatus.size - statusMismatches)

// --- daily scores, per player ------------------------------------------------------

console.log('\nDaily scores per player (count, guesses, and puzzleDay histogram):')
const tzByPlayerId = new Map(src.players.map((p) => [p.id, p.time_zone]))

let dayMismatchTotal = 0
for (const p of src.players) {
  const mine = src.scores.filter((s) => s.player_id === p.id)
  const expectedByDay = {}
  let expectedGuesses = 0
  for (const s of mine) {
    const day = puzzleDayFor(s.date, tzByPlayerId.get(p.id))
    expectedByDay[day] = (expectedByDay[day] ?? 0) + 1
    expectedGuesses += (s.guesses || []).length
  }

  const got = await convex.query(internal.migrate.playerScoreFingerprint, {
    playerLegacyId: p.id,
  })
  if (!got) {
    console.log(`  FAIL player ${p.id.slice(0, 8)} missing from Convex`)
    failures.push(`player ${p.id} missing`)
    continue
  }

  const label = `player ${p.id.slice(0, 8)}`
  check(`${label} score count`, mine.length, got.count)
  check(`${label} total guesses`, expectedGuesses, got.totalGuesses)

  // The check that actually proves the timezone fix held: every board on the day
  // the backfill rule says it belongs to, not the day a UTC read would give.
  const days = new Set([...Object.keys(expectedByDay), ...Object.keys(got.byDay)])
  let differing = 0
  for (const d of days) {
    if ((expectedByDay[d] ?? 0) !== (got.byDay[d] ?? 0)) differing++
  }
  if (differing > 0) {
    console.log(`  FAIL ${label} puzzleDay histogram differs on ${differing} day(s)`)
    failures.push(`${label} puzzleDay histogram differs on ${differing} day(s)`)
  }
  dayMismatchTotal += differing
}

// --- verdict ----------------------------------------------------------------------

console.log('\n' + '-'.repeat(64))
if (failures.length === 0) {
  console.log(`PARITY OK — Convex matches Supabase for scope=${scope}.`)
  console.log(`  ${src.scores.length} daily scores across ${src.players.length} players and ${src.teams.length} teams,`)
  console.log(`  every puzzleDay histogram agreeing (${dayMismatchTotal} differing days).`)
  process.exit(0)
}
console.log(`PARITY FAILED — ${failures.length} problem(s):`)
for (const f of failures) console.log(`  - ${f}`)
process.exit(1)
