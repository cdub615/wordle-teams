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
 * NOT EVERY ROW IN SCOPE IS COPIED, since Phase 4. Nameless players and teams
 * left with no members are skipped — see lib/copy-filters.mjs for both rules and
 * why they are safe. The run summary reports both counts.
 *
 * verify-parity.mjs KNOWS ABOUT THIS, as of wt-ksh.13.7. It narrows its own
 * scoped read through lib/verify-filters.mjs — which calls the same
 * selectCopyable, so the two cannot drift — and prints what it left out. Changing
 * either rule below therefore changes what the verifier expects, in the same
 * commit, which is the point of them sharing one implementation.
 *
 * PRINTS COUNTS, NEVER ADDRESSES. This repository is public.
 */
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'
import { connect, readScoped, puzzleDayFor } from './lib/supabase-scope.mjs'
import { selectCopyable } from './lib/copy-filters.mjs'
import {
  formatClobberReport,
  formatInsertReport,
  formatTally,
  mergeTally,
} from './lib/copy-tallies.mjs'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const scope = (args.find((a) => a.startsWith('--scope=')) ?? '--scope=mine').split('=')[1]
const dryRun = has('--dry-run')

if (!['mine', 'all'].includes(scope)) {
  console.error(`Unknown --scope=${scope}. Use 'mine' or 'all'.`)
  process.exit(1)
}

const CONVEX_URL = process.env.CONVEX_URL
const CONVEX_MIGRATION_KEY = process.env.CONVEX_MIGRATION_KEY
const ME = (process.env.ME_EMAIL || '').toLowerCase()

if (scope === 'mine' && !ME) {
  console.error('Set ME_EMAIL for --scope=mine. Kept out of source: this repo is public.')
  process.exit(1)
}
if (!dryRun && (!CONVEX_URL || !CONVEX_MIGRATION_KEY)) {
  console.error('Set CONVEX_URL and CONVEX_MIGRATION_KEY, or pass --dry-run.')
  process.exit(1)
}

const supabase = connect()

const ms = (t) => (t ? new Date(t).getTime() : undefined)
const opt = (s) => (s === null || s === undefined || s === '' ? undefined : s)

console.log(`Reading Supabase (scope=${scope})...`)
const src = await readScoped(supabase, scope, ME)
const {
  players: scopedPlayers,
  teams: scopedTeams,
  scores: scopedScores,
  winners: scopedWinners,
  memberships: scopedMemberships,
  webhooks: scopedWebhooks,
  totals,
} = src

console.log('\nIn scope:')
console.log(`  players          ${scopedPlayers.length} of ${totals.players}`)
console.log(`  teams            ${scopedTeams.length} of ${totals.teams}`)
console.log(`  dailyScores      ${scopedScores.length} of ${totals.dailyScores}`)
console.log(`  monthlyWinners   ${scopedWinners.length} of ${totals.monthlyWinners}`)
console.log(`  playerMembership ${scopedMemberships.length} of ${totals.playerMembership}`)
console.log(`  webhookEvents    ${scopedWebhooks.length} of ${totals.webhookEvents}`)

// --- exclusions ---------------------------------------------------------------

// SINCE PHASE 4, NOT EVERY SCOPED ROW IS COPIED. players.firstName/lastName are
// required now, so a nameless player is a row the schema cannot hold, and a team
// left with none of its members is a row nobody could reach. See
// lib/copy-filters.mjs for both rules and the evidence they are safe to apply.
//
// Reported unconditionally, zero included: a zero is the statement that the
// filters ran and found nothing, rather than silence that could equally mean
// they never ran. Counts only — this repository is public.
//
// Only players and teams are narrowed here. Scores, winners, memberships and
// webhooks belonging to a skipped player or team need no filter of their own:
// each upsert mutation resolves its parent by legacyId first and counts the row
// into its `skipped` tally when the parent is not there. Deliberately left to
// them, so that one mechanism reports every orphan — including the ones a scoped
// copy produces, which have nothing to do with these two rules.
//
// verify-parity.mjs additionally narrows MEMBERSHIPS by player, because it has
// to predict the row count upsertMemberships will produce rather than merely
// report what it skipped. That narrowing lives in lib/verify-filters.mjs and is
// not wanted here: nothing in this script would read it.
const copyable = selectCopyable(scopedPlayers, scopedTeams)
console.log('\nSkipped (not copied):')
console.log(`  nameless players ${copyable.skippedPlayers} of ${scopedPlayers.length} in scope`)
console.log(`  memberless teams ${copyable.skippedTeams} of ${scopedTeams.length} in scope`)

// How many invited addresses production stores in a form that would never have
// matched. Reported because it quantifies the v1 bug this copy silently repairs.
// Counted over the teams that will actually be written, not every scoped team —
// an invite on a team the copy is skipping is not going to be normalised, and
// claiming otherwise would overstate the repair.
const mixedCaseInvites = copyable.teams
  .flatMap((t) => t.invited || [])
  .filter((e) => e !== e.toLowerCase()).length
if (mixedCaseInvites > 0) {
  console.log(`\n  ${mixedCaseInvites} invited address(es) are mixed-case and will be normalised.`)
}

// --- shaping -----------------------------------------------------------------

const playerRows = copyable.players.map((p) => ({
  legacyId: p.id,
  email: (p.email || '').toLowerCase(),
  // Still through opt(), even though selectCopyable has already guaranteed both
  // are truthy. opt('') is undefined, which migrate.ts's now-required firstName
  // rejects by name; a bare `p.first_name` would hand an empty string to a
  // v.string() that accepts it, and an empty-string name is exactly the state
  // this whole change exists to make unrepresentable. If the filter ever
  // regresses, this is what makes it fail loudly instead of quietly.
  firstName: opt(p.first_name),
  lastName: opt(p.last_name),
  hasPwa: !!p.has_pwa,
  timeZone: opt(p.time_zone),
  reminderDeliveryMethods: p.reminder_delivery_methods || [],
  reminderDeliveryTime: p.reminder_delivery_time,
  lastBoardEntryReminder: ms(p.last_board_entry_reminder),
  createdAt: ms(p.created_at),
}))

const teamRows = copyable.teams.map((t) => ({
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

// scopedPlayers, NOT copyable.players, and that is load-bearing: the map is read
// once per SCOPED score below, including any owned by a player this run is
// skipping. Narrowing it would silently fall back to HOME_TZ for those rows and
// compute a puzzleDay in the wrong timezone. (verify-parity.mjs builds the same
// map from its narrowed list, which is safe there because it only ever looks up
// players it is already iterating.)
const tzByPlayerId = new Map(scopedPlayers.map((p) => [p.id, p.time_zone]))

const scoreRows = scopedScores.map((s) => ({
  legacyId: s.id,
  playerLegacyId: s.player_id,
  puzzleDay: puzzleDayFor(s.date, tzByPlayerId.get(s.player_id)),
  date: ms(s.date),
  guesses: s.guesses || [],
  answer: opt(s.answer),
  createdAt: ms(s.created_at),
}))

// How many rows the backfill rule places on a different day than a naive UTC
// read would. Reported because it is the size of the bug being repaired, and
// because a sudden change in this number means the rule or the data moved.
const utcDay = (iso) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
const movedByBackfill = scopedScores.filter(
  (s) => puzzleDayFor(s.date, tzByPlayerId.get(s.player_id)) !== utcDay(s.date),
).length
console.log(
  `\n  puzzleDay backfill: ${movedByBackfill} of ${scopedScores.length} rows resolve to a different day in the player's own timezone than in UTC.`,
)

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
  // Named `tallies`, not `totals`: `totals` is already the Supabase row counts
  // destructured above, and shadowing it here would be quietly confusing.
  const tallies = {}
  for (let i = 0; i < rows.length; i += CHUNK) {
    // The adding-up lives in scripts/lib/copy-tallies.mjs, and is tested there:
    // this script runs against a live deployment at module scope, so nothing
    // written inline here can be executed by a test. It is not bookkeeping any
    // more either — three of these mutations now return a nested `clobbered`
    // record (wt-ksh.13), and getting the merge wrong prints garbage instead of
    // reporting an overwrite.
    mergeTally(tallies, await convex.mutation(fn, { rows: rows.slice(i, i + CHUNK) }))
  }
  // formatTally prints the flat counters only. The `clobbered` records the three
  // diffing mutations return are held back for the block after all six writes.
  console.log(`  ${label.padEnd(17)} ${formatTally(tallies)}`)
  return tallies
}

// THE TEAM FILTER HAS NO SECOND GATE, so it gets one here.
//
// A nameless PLAYER that slipped past selectCopyable would still be refused at
// the boundary — migrate.ts's playerInput requires firstName/lastName, so the
// run fails loudly. A memberless TEAM has no such backstop: `playerIds: []` is a
// perfectly valid teams document, so a regression that shaped these rows from
// the unscoped list would silently copy 29 dead teams, at cutover, with nobody
// watching a diff. Reverting either `.map` below to scopedPlayers/scopedTeams
// passes every test, tsc and build — this assertion is what makes that visible.
if (teamRows.length !== copyable.teams.length || playerRows.length !== copyable.players.length) {
  console.error(
    `\nRefusing: shaped ${playerRows.length} players / ${teamRows.length} teams, but the ` +
      `filter selected ${copyable.players.length} / ${copyable.teams.length}. ` +
      `The rows being written are not the rows that were selected.`,
  )
  process.exit(1)
}

// ORDER MATTERS, and this list is what pins it: teams reference players, and
// everything else references both. Written sequentially, top to bottom.
//
// Each label is written ONCE, and is both what prints in the per-table line and
// the key its tally is stored under, so the two cannot drift apart. The `teams`
// lookup below is the one place that still names a table independently of this
// list; the clobber report itself just reads whatever keys are here.
const TABLES = [
  ['players', internal.migrate.upsertPlayers, playerRows],
  ['teams', internal.migrate.upsertTeams, teamRows],
  ['dailyScores', internal.migrate.upsertDailyScores, scoreRows],
  ['monthlyWinners', internal.migrate.upsertMonthlyWinners, winnerRows],
  ['playerMembership', internal.migrate.upsertMemberships, membershipRows],
  ['webhookEvents', internal.migrate.upsertWebhookEvents, webhookRows],
]

// THE DEPLOYMENT'S ROW COUNTS, READ BEFORE ANYTHING IS WRITTEN. This is the
// trigger for the insert report at the bottom: a copy into a deployment that
// already holds rows is a RE-RUN, and a re-run against unchanged v1 data should
// insert nothing. Measured rather than flagged on purpose — a --expect-no-inserts
// flag is a thing the operator forgets at the one moment it matters, and this
// costs one query. Same query the "Convex now holds:" block runs at the end;
// counts only, no values. Not reached under --dry-run, which exits above.
const countsBefore = await convex.query(internal.migrate.counts, {})

console.log('\nWriting to Convex...')
const talliesByTable = {}
for (const [label, fn, rows] of TABLES) {
  talliesByTable[label] = await writeAll(label, fn, rows)
}

if (talliesByTable.teams.droppedMembers > 0) {
  console.log(
    `\n  note: ${talliesByTable.teams.droppedMembers} team membership(s) referenced a player outside the copied scope and were dropped.`,
  )
  console.log('  Expected with --scope=mine. It would be a real problem with --scope=all.')
}

// WHAT THIS COPY OVERWROTE — first of the run's two report blocks, and near the
// end because it is what the person running this at cutover is watching for. The
// insert block below it and the counts block are both short, so it stays on
// screen. Rendered in lib/copy-tallies.mjs and tested there; loud when non-zero,
// one line when zero. Counts only: this repository is public and the overwritten
// fields include team names and invited addresses.
console.log(`\n${formatClobberReport(talliesByTable)}`)

// WHAT THIS COPY PUT BACK — a DETECTOR, not a fix, and the comment says so
// because the block does. A row v2 DELETED leaves nothing for the block above to
// diff against, so it returns counted as an insert, indistinguishable from a new
// v1 row (wt-ksh.13.10). This cannot tell those two apart either. What it does is
// make the insert VISIBLE on a re-run, which is the thing a diff-based report
// structurally cannot do, and it covers all six tables where the clobber report
// covers three. Silent on a first copy into an empty deployment, where every row
// is an insert legitimately. Rendered and tested in lib/copy-tallies.mjs.
//
// PRINTED AFTER THE CLOBBER BLOCK, deliberately, as two separate frames with one
// blank line between them. They share the `#` frame because the frame means
// "stop and read" and a second border style would be a second alarm to learn;
// each carries its own ALL-CAPS headline so neither reads as the other's footer.
// This one goes last — closest to the counts, hardest to scroll past — because a
// resurrected board or team rewrites scoring history where an overwritten name is
// cosmetic, which is why 13.10 is P1. It also puts the pair on screen in the same
// order as the cutover runbook's steps 1 and 2 (wt-ksh.9).
const insertReport = formatInsertReport(talliesByTable, countsBefore)
if (insertReport) console.log(`\n${insertReport}`)

const counts = await convex.query(internal.migrate.counts, {})
console.log('\nConvex now holds:')
for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(17)} ${n}`)
