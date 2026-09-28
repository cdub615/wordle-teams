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
 * IT DOES NOT COMPARE EVERY SCOPED ROW. The copy has skipped nameless players
 * and the teams left with none of their members since Phase 4, so the scoped
 * Supabase read is narrowed to what the copy would have written before anything
 * is compared — see lib/verify-filters.mjs. Exactly the same rules, imported from
 * the copier rather than restated, and applied ONCE below so that no comparison
 * downstream can walk a row that was never copied. The comparisons themselves
 * stay exact: a check that tolerated a delta could not tell a deliberate
 * exclusion from a lost row.
 *
 * PRINTS COUNTS AND IDS, NEVER ADDRESSES. This repo is public.
 */
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'
import { connect, readScoped, puzzleDayFor } from './lib/supabase-scope.mjs'
import { expectedMemberCount, narrowToCopied } from './lib/verify-filters.mjs'
import { readCounts } from './lib/count-tables.mjs'

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
const scoped = await readScoped(supabase, scope, ME)

// --- narrowing ----------------------------------------------------------------

// NARROWED ONCE, HERE, and every comparison below reads `src`. That is the whole
// design: a `.filter()` at each comparison site is one site away from being
// forgotten, and the failure mode is silent — the count checks agree while a
// field comparison still walks rows Convex was never given, so the verifier
// reports a mismatch on a row the copy correctly skipped.
//
// `scoped` is kept only for the "of N in scope" denominators just below.
//
// Reported unconditionally, zeroes included, for the same reason the copy script
// prints its Skipped block that way: a zero is the statement that the narrowing
// ran and found nothing, where silence could equally mean it never ran. At the
// Phase 7 audit someone has to be able to see that it ran, and by how much.
// Counts only — this repository is public and these rows carry names and email
// addresses.
const src = narrowToCopied(scoped)
console.log('\nNarrowed to what the copy writes (not compared):')
console.log(`  nameless players  ${src.skipped.players} of ${scoped.players.length} in scope`)
console.log(`  memberless teams  ${src.skipped.teams} of ${scoped.teams.length} in scope`)
console.log(
  `  their memberships ${src.skipped.memberships} of ${scoped.memberships.length} in scope`,
)

const convex = new ConvexHttpClient(CONVEX_URL)
convex.setAdminAuth(CONVEX_MIGRATION_KEY)
console.log('Reading Convex...')
// readCounts walks each table a page at a time and adds the pages up across
// separate transactions, because a single query may not scan a table larger than
// one transaction's budget (lib/count-tables.mjs). CONSEQUENCE WORTH KNOWING
// BEFORE YOU BELIEVE A FAILURE HERE: unlike its predecessor these six numbers
// are not one snapshot, so a row written to Convex WHILE this runs can be
// counted twice or not at all. Run the audit against a deployment nobody is
// writing to — which the cutover window already guarantees — and if a count is
// off by one or two, re-run before believing it.
const [counts, probe] = await Promise.all([
  readCounts(convex, internal),
  convex.query(internal.migrate.parityProbe, {}),
])

// --- row counts ---------------------------------------------------------------

// players, teams and playerMembership are the NARROWED counts — the copy leaves
// rows behind on purpose, so the un-narrowed lengths are not what Convex should
// hold. dailyScores, monthlyWinners and webhookEvents are the full scoped
// lengths, and staying that way is the point: the Phase 4 measurement found that
// nameless players own 0 boards and 0 monthly-winner rows, so a shortfall on one
// of these three is something to investigate rather than something to filter.
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
  // The roster gets the same narrowing at a finer grain — upsertTeams drops the
  // member uuids it cannot resolve, so a team that kept a nameless member
  // arrives one member lighter. The rule lives in lib/verify-filters.mjs, where
  // a test can execute it; see there for why this expects MORE precisely rather
  // than more loosely.
  check(`team ${t.id} member count`, expectedMemberCount(t, src.copiedPlayerIds), got.playerCount)
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
// Built from the NARROWED players, unlike the copier's map of the same name.
// That is not an inconsistency: this one is only ever read as .get(p.id) inside
// the loop below, which iterates the same narrowed list, so narrowing it changes
// no lookup. The copier's must stay un-narrowed because it computes a puzzleDay
// for every scoped score, including any owned by a player it is skipping.
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
  // The player and team numbers are the narrowed ones, so that this line agrees
  // with the checks above it rather than quoting a total none of them used. The
  // score count is the full scoped one, which is what its check compared.
  console.log(
    `  ${src.scores.length} daily scores in scope, across the ${src.players.length} players ` +
      `and ${src.teams.length} teams the copy writes,`,
  )
  console.log(`  every puzzleDay histogram agreeing (${dayMismatchTotal} differing days).`)
  process.exit(0)
}
console.log(`PARITY FAILED — ${failures.length} problem(s):`)
for (const f of failures) console.log(`  - ${f}`)
process.exit(1)
