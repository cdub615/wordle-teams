// How the copy adds up what its mutations report, and how it prints it.
//
// Extracted out of copy-from-supabase.mjs for the reason copy-filters.mjs was:
// that script cannot be imported, because it does its work at module scope
// against a live Supabase and a live deployment. Anything left inline there is
// untestable, and this is arithmetic that decides whether a cutover reader sees
// "the copy overwrote 12 team names" or sees nothing at all.
//
// THE SHAPE THIS EXISTS FOR. Every migrate.ts mutation returns flat counters —
// inserted, updated, skipped, droppedMembers. Since wt-ksh.13 upsertPlayers,
// upsertTeams and upsertMonthlyWinners ALSO return `clobbered`, a nested record
// of per-field counts. The old one-line accumulator was `(tallies[k] ?? 0) + v`,
// which on a nested record tallies the string '0[object Object]' and prints it —
// a silent report is what wt-ksh.13 is about, and a garbled one is no better.
//
// TWO BLOCKS ARE RENDERED HERE, NOT ONE, and they read the same tallies from
// opposite ends. formatClobberReport diffs the `clobbered` records: what the
// copy OVERWROTE. formatInsertReport reads `inserted`: what the copy PUT BACK.
// They share one frame, one gutter and one vocabulary because they print on the
// same screen and a reader should not have to learn two alarms — which is the
// reason they stayed in one module rather than becoming two (wt-ksh.13.10).
//
// formatInsertReport takes ONE INPUT THAT IS NOT A MUTATION RETURN: the
// deployment's own row counts, read before the writes. That is the whole of the
// widening — the header sentence above still describes the rest.

/**
 * Add one mutation result into a running tally, in place.
 *
 * Numbers sum. A nested record of numbers merges FIELD BY FIELD, because the
 * copy sends rows in chunks of 200 and each chunk reports only the fields that
 * chunk overwrote — two chunks that each renamed three teams must read as six,
 * and a chunk that overwrote nothing must contribute nothing.
 *
 * ONE LEVEL, AND IT REFUSES ANYTHING ELSE rather than guessing. `typeof v ===
 * 'object'` alone would swallow an array (merging `['a','b']` BY INDEX, printing
 * `{0=0aa 1=0bb}`) and would swallow a doubly-nested record, reproducing the
 * exact '[object Object]' bug one level down. No mutation returns either shape
 * today; both were mis-handled before this module existed, and the failure was
 * silent, so this throws instead. A summary line nobody can trust is worse than
 * a run that stops and names the key.
 *
 * @param {Record<string, unknown>} into the running tally, mutated
 * @param {Record<string, unknown>} result one mutation's return value
 * @returns {Record<string, unknown>} `into`, for convenience
 */
export function mergeTally(into, result) {
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number') {
      into[key] = (into[key] ?? 0) + value
      continue
    }
    if (!isRecordOfNumbers(value)) {
      throw new Error(
        `copy tally: '${key}' is neither a number nor a flat record of numbers ` +
          `(got ${describe(value)}). Teach mergeTally about it, or the summary will lie.`,
      )
    }
    const nested = (into[key] ??= {})
    for (const [field, n] of Object.entries(value)) nested[field] = (nested[field] ?? 0) + n
  }
  return into
}

/**
 * The one-line summary for a table: `inserted=3 updated=1 droppedMembers=0`.
 *
 * FLAT COUNTERS ONLY. `clobbered` is skipped BY NAME, because
 * formatClobberReport prints it in its own block below; printing it here too
 * would break the same news quietly, in a column, one line above the block that
 * exists to make it impossible to miss.
 *
 * ANY OTHER NESTED RECORD THROWS, rather than being dropped. mergeTally accepts
 * a new one happily — it is a flat record of numbers like any other — and
 * formatClobberReport reads only `clobbered`, so a silent drop here would be a
 * count that the run reports NOWHERE. That is the exact failure this module was
 * extracted to prevent, so it takes mergeTally's stance and names the key.
 *
 * An empty tally means the mutation was never called, which the caller only ever
 * does when there were no rows for that table. That is a fact about the TALLY,
 * so it is read off the tally and not off what survived the skip: every mutation
 * returns at least `inserted` and `updated`, so a table that was written to
 * always has counters to show. A tally holding ONLY `clobbered` would return the
 * empty string, and no mutation returns that shape.
 *
 * @param {Record<string, unknown>} tallies as built by mergeTally, so the values
 *   are numbers or flat records of numbers and nothing else — mergeTally is what
 *   guarantees that, by refusing everything else.
 */
export function formatTally(tallies) {
  if (Object.keys(tallies).length === 0) return '(nothing to do)'
  const parts = []
  for (const [key, value] of Object.entries(tallies)) {
    if (typeof value === 'number') {
      parts.push(`${key}=${value}`)
      continue
    }
    if (key === 'clobbered') continue
    throw new Error(
      `copy tally: '${key}' is ${describe(value)}. This summary prints numbers, and ` +
        `skips 'clobbered' because formatClobberReport prints that instead; anything ` +
        `else the run reports nowhere. Teach one of them about it.`,
    )
  }
  return parts.join(' ')
}

/**
 * The clobber report: what this copy overwrote, per table, per field.
 *
 * WHAT IT IS FOR. The copy is re-runnable by design and runs again inside the
 * cutover window. What a re-run can revert is a COPIED row that v2 has since
 * edited — a row born in v2 carries no legacyId, and legacyId is the whole
 * upsert key for players and teams, so those rows are never matched at all.
 * Reverting is deliberate before cutover: beta state is discarded, and beta is
 * permanently testing data. The report exists so that a copy run at the WRONG
 * moment — after cutover, with real users on v2 — announces itself to the person
 * watching the run, who is watching for exactly this one thing.
 *
 * monthlyWinners IS THE EXCEPTION to the sentence above, and the report shows it:
 * that upsert matches on (teamId, year, month) rather than on legacyId, so a
 * winner row v2 computed ITSELF is matched, adopted and overwritten despite
 * being born in v2. It surfaces here as a `legacyId` count — undefined becoming
 * a Supabase id — on top of whatever else moved. See convex/migrate.ts.
 *
 * IT DOES NOT SAY WHO WROTE THE VALUE IT REPLACED, because it cannot know. A
 * `clobbered` entry means only that the incoming v1 value differs from the
 * stored one, and that is produced by a lost v2 edit OR by v1 drifting since the
 * last copy — the ordinary dual-running case this script exists to serve. For
 * the `scoring` group blaming v2 would be outright wrong: v2 never writes those
 * eight fields after createTeam (setScoringSystem writes a scoringSystems row,
 * not the team doc), so a scoring difference is always v1-side. Hence
 * OVERWROTE STORED VALUES in the headline, with the either/or in the body. A
 * banner that cries "lost v2 edits" over a routine v1 re-import is the false
 * alarm that trains everyone to ignore the report.
 *
 * LOUD WHEN NON-ZERO, ONE LINE WHEN ZERO. A banner on every clean run is noise,
 * and noise is indistinguishable from silence by the second run.
 *
 * COUNTS ONLY, NEVER VALUES. This repository is public and the fields that get
 * overwritten include team names and invited addresses. `clobbered`'s keys are
 * field NAMES and its values are row counts; that is the whole of what prints.
 *
 * IT DOES NOT CLAIM MORE THAN IT KNOWS. Only upsertPlayers, upsertTeams and
 * upsertMonthlyWinners return `clobbered` (see the clobber block at the top of
 * convex/migrate.ts). dailyScores is left undiffed on purpose — wordle-teams-r9d
 * — and nothing in v2 writes memberships or webhooks yet. A bare "overwrote
 * nothing" would quietly assert something about all six, so the clean line names
 * the tables it is speaking for and names the ones it is not. A table whose
 * tally is empty was never written to at all and belongs in neither list.
 *
 * @param {Record<string, Record<string, unknown>>} talliesByTable table label ->
 *   the tally mergeTally accumulated for it, in the order the copy wrote them.
 * @returns {string} either one indented line, or a multi-line banner. Already
 *   formatted for console.log; the caller supplies the leading blank line.
 */
export function formatClobberReport(talliesByTable) {
  const { overwritten, clean, notDiffed } = partition(talliesByTable)

  if (overwritten.length === 0) {
    // `clean` empty here means no table that diffs had any rows — not that they
    // all came back clean. Different facts, and the line has to say which.
    const clauses = scopeClauses(clean, notDiffed)
    if (clean.length === 0)
      clauses.unshift(`${OVERWROTE_NOTHING} — no table that diffs had rows to write`)
    return `  ${clauses.join('. ')}.`
  }

  const width = Math.max(...overwritten.map(([label]) => label.length)) + 3
  const lines = [
    RULE,
    `${GUTTER}OVERWROTE STORED VALUES: ${overwritten.map(([label]) => label).join(', ')}`,
    `${GUTTER}Rows whose stored value this copy replaced: a v2 edit lost, or a v1-side`,
    `${GUTTER}edit arriving during dual-running. Deliberate before cutover, when beta`,
    `${GUTTER}state is discarded; after cutover it is live user data.`,
    BLANK,
    ...overwritten.flatMap(([label, fields]) => detailLines(label, fields, width)),
  ]
  const notes = scopeClauses(clean, notDiffed).map((clause) => `${GUTTER}${clause}`)
  if (notes.length) lines.push(BLANK, ...notes)
  lines.push(RULE)
  return lines.join('\n')
}

/**
 * Sort the tables into the three things the report can say about one.
 *
 * The invariants live here rather than inline in the renderer, because they are
 * about the DATA and are easy to get subtly wrong:
 *
 *   - An empty tally means the mutation was never called, which the copy only
 *     does when that table had no rows in scope. It neither overwrote anything
 *     nor failed to diff, so it belongs in NEITHER list — listing it would be a
 *     zero that reads as a checked, clean table.
 *   - `clobbered` absent means the mutation does not diff at all. That is a
 *     different fact from `clobbered` present and empty, which is a real "this
 *     table was checked and nothing moved", and conflating them is exactly the
 *     overclaim the clean line exists to avoid.
 *
 * @returns {{ overwritten: Array<[string, Array<[string, number]>]>, clean: string[], notDiffed: string[] }}
 *   `overwritten` carries each table's field entries and always has at least one.
 */
const partition = (talliesByTable) => {
  const overwritten = []
  const clean = []
  const notDiffed = []
  for (const [label, tallies] of Object.entries(talliesByTable)) {
    if (Object.keys(tallies).length === 0) continue
    const clobbered = tallies.clobbered
    if (clobbered === undefined) notDiffed.push(label)
    else if (Object.keys(clobbered).length === 0) clean.push(label)
    else overwritten.push([label, Object.entries(clobbered)])
  }
  return { overwritten, clean, notDiffed }
}

const OVERWROTE_NOTHING = 'Overwrote nothing'

/**
 * The two standing clauses, in ONE vocabulary for both branches.
 *
 * The quiet line and the banner's footer state the same two facts, so both build
 * them from here rather than from literals that would have to move in lockstep.
 *
 * `Not diffed:` rather than "x does not diff", so the phrasing reads the same
 * whether the list has one entry or three.
 */
const scopeClauses = (clean, notDiffed) => {
  const clauses = []
  if (clean.length) clauses.push(`${OVERWROTE_NOTHING}: ${clean.join(', ')}`)
  if (notDiffed.length) clauses.push(`Not diffed: ${notDiffed.join(', ')}`)
  return clauses
}

const FRAME = 80
const RULE = '#'.repeat(FRAME)
const GUTTER = '##  '
const BLANK = '##'

/**
 * One table's fields, wrapped to stay inside the frame.
 *
 * THE FRAME IS THE POINT. Being visually distinct from the routine output around
 * it is this block's whole job, and the `#` border is what supplies that. A
 * player row can differ in nine fields at once, which runs a single line past
 * 220 columns — and the terminal's own wrap breaks it without the `##` gutter,
 * so the overflow reads as unrelated output escaping the block. Wrapping here
 * keeps every line framed and indented under its label.
 *
 * ONE FIELD STILL OVERFLOWS IF IT MUST. Nothing truncates, because a truncated
 * field name is a name the reader cannot act on, so a single field wider than
 * the frame takes the whole line and runs over. Stated as a bound rather than as
 * arithmetic that would go stale: the indent tracks the longest label that
 * reports `clobbered`, so the threshold moves — it sits near 48 columns of field
 * name today, and would tighten to about 46 if playerMembership ever starts
 * reporting, which convex/migrate.ts anticipates for Phase 5. The widest field
 * name in play is reminderDeliveryMethods at 23, so the margin is comfortable
 * either way, and no plausible schema field closes a gap that size.
 */
const detailLines = (label, fields, width) => {
  const indent = GUTTER + ' '.repeat(width)
  // The separator rides on the item BEFORE the break, so a continuation line
  // never opens with a comma and a continued list never looks finished.
  const items = fields.map(
    ([field, rows], i) =>
      `${field} on ${rows} ${rows === 1 ? 'row' : 'rows'}${i === fields.length - 1 ? '' : ','}`,
  )
  // The first item joins the label; it has nowhere else to go, so it is seeded
  // rather than measured. Every later item is measured against the frame.
  const lines = [`${GUTTER}${label.padEnd(width)}${items[0]}`]
  for (const item of items.slice(1)) {
    const open = lines.length - 1
    if (lines[open].length + 1 + item.length <= FRAME) lines[open] += ` ${item}`
    else lines.push(indent + item)
  }
  return lines
}

/**
 * The insert report: a DETECTOR for rows a re-run put back. Not a fix for them.
 *
 * WHAT THE CLOBBER REPORT ABOVE STRUCTURALLY CANNOT SEE. It diffs an incoming v1
 * doc against the row already stored. When v2 DELETED that row there is nothing
 * left to diff: byLegacyId finds no match, the copy takes the insert branch, and
 * the row comes back counted as `inserted` — indistinguishable from a genuinely
 * new v1 row. Confirmed for teams (cascadeDeleteTeam, convex/teams.ts) and for
 * boards (upsertBoardFor, convex/scores.ts). wt-ksh.13.10.
 *
 * SO THIS ONE DOES NOT DIFF. It rests on a different property: a re-copy against
 * unchanged v1 data should insert NOTHING. A non-zero insert count on a re-run
 * is therefore either a new v1 row or a resurrected one, and both are worth a
 * look. No schema change and no tombstone: every one of the six mutations
 * already returns `inserted` (convex/migrate.ts, lines 266, 341, 388, 466, 508
 * and 553).
 *
 * IT DOES NOT SAY WHICH INSERT IS WHICH, and saying otherwise here or in the
 * block would be a lie. Resurrection is ONE of the reasons a re-run inserts, and
 * the block must not name it against a closed list of alternatives, because that
 * list is not closed: rows new in v1 since the last copy (ordinary — players
 * enter boards daily), a widened --scope, a previous copy that died partway, a
 * first copy into a deployment that already held v2-born rows, and a row that
 * used to fail selectCopyable and now passes are all innocent, and there is no
 * argument that the list ends there. So the block says "several innocent ones"
 * and sends the reader to wt-ksh.9 step 2, which enumerates and orders them.
 * This block firing is a prompt to read, not a stop signal on its own.
 *
 * IT COVERS ALL SIX TABLES, which the clobber report cannot: `clobbered` comes
 * back from three mutations, `inserted` from all six. dailyScores is the one
 * that matters most, being both deliberately undiffed (wordle-teams-r9d) and one
 * of the two confirmed resurrection paths.
 *
 * THE TRIGGER IS MEASURED, NOT FLAGGED. `countsBefore` is what readCounts
 * (scripts/lib/count-tables.mjs) reported BEFORE the writes, and a deployment
 * that already holds rows is what makes the run a re-run. A --expect-no-inserts
 * flag would be a thing the operator forgets at the one moment it matters.
 *
 * SILENT ON A FIRST COPY, and that is what decides whether the detector is
 * usable at all. Every row is an insert into an empty deployment, legitimately;
 * a report that cries wolf on the first copy is one nobody trusts on the third.
 * The blind spot that buys is narrow and worth naming: a deployment can only be
 * empty because it was never copied to, or because purgeCopiedData emptied it
 * (convex/migrate.ts) — an explicit operator wipe, after which every row IS new.
 * No v2 code path can empty it unattended, and the check is
 * `git grep -c "db\.delete(" convex/`.
 *
 * THE NUMBER IS DATED BECAUSE IT KEEPS MOVING: fourteen hits on 2026-08-25,
 * twenty-one on 2026-08-26 (`wordle-teams-c68`), and TWENTY-SIX on 2026-09-01.
 * Run the command; do not trust the figure. What follows is the 2026-09-01
 * breakdown, and the shape of it is what matters rather than the total.
 *
 * SIXTEEN ARE PRODUCTION CODE, ten are *.test.ts (winners, teams, e2ePrune and
 * billing two each; scores and access one each).
 *
 * FOUR PRODUCTION SITES TOUCH A COPIED TABLE, not three — and the fourth is the
 * correction this paragraph exists to make. It used to say the three were
 * winners.ts, scores.ts and teams.ts and that "none of the three touches
 * players, playerMembership or webhookEvents". `convex/e2ePrune.ts` has since
 * landed and it deletes from BOTH of the first two: dailyScores (:338),
 * monthlyWinners (:351), playerMembership (:361), pushSubscriptions (:372) and
 * players (:378). webhookEvents is still touched by no delete anywhere.
 *
 * IT STILL CANNOT EMPTY A DEPLOYMENT, and that is a guarantee with two
 * independent halves rather than an observation: `pruneBatch` is an
 * `internalMutation`, so nothing public can reach it, and it throws outright
 * unless `E2E_TEST_MODE === 'true'` (`convex/e2ePrune.ts:183`), which is unset
 * on beta — measured 2026-09-01, `wordle-teams-cd8`. Even running, it deletes
 * only rows matching `e2e+*@wordleteams.com` (`isE2ePlayerRow`, `lib/e2e.ts`).
 * If that flag is ever set on the deployment that becomes production, this
 * paragraph's guarantee is void — which is one more reason `wordle-teams-7az`
 * puts a re-confirm step in the cutover runbook.
 *
 * The remaining production sites touch nothing the copy writes: testOtps.ts
 * (three, including the exported `takeFor`, all against `testOtps`), push.ts
 * (one, pruning a subscription on 404/410) and migrate.ts (purgeCopiedData
 * itself, the explicit operator wipe).
 *
 * LOUD WHEN NON-ZERO, ONE LINE WHEN ZERO, following formatClobberReport and the
 * skip report: a zero states the check ran, where silence could equally mean it
 * never did. The same reasoning is why a FAILED pre-write read prints a line
 * rather than nothing — see `countsBefore`.
 *
 * COUNTS ONLY, NEVER VALUES. This repository is public. What prints is table
 * names, row counts, and the deployment's own row count.
 *
 * @param {Record<string, Record<string, unknown>>} talliesByTable table label ->
 *   the tally mergeTally accumulated for it, in the order the copy wrote them.
 * @param {Record<string, number> | null} countsBefore what readCounts
 *   (scripts/lib/count-tables.mjs) reported before the writes: table -> rows the
 *   deployment already held. NULL MEANS THE READ FAILED and the caller carried
 *   on writing anyway, which it must — readCounts walks six tables a page at a
 *   time, about nine round trips at production's size, and any one of them can
 *   fail; a report about the copy may not be what kills the copy. Null is a
 *   state the report has to SPEAK about: with no trigger there is no way to tell
 *   a first copy from a re-run, and staying silent would be the first-copy
 *   answer, i.e. an all-clear this run did not earn. Anything else non-record
 *   still throws, because it is a programming error rather than an outage.
 * @returns {string | null} null when the deployment was empty and this report has
 *   nothing to say; one indented line when it was not and nothing was inserted,
 *   and one when the trigger could not be read at all; a framed block otherwise.
 *   null rather than '' so a caller cannot print an empty frame and mistake it
 *   for a deliberate silence.
 */
export function formatInsertReport(talliesByTable, countsBefore) {
  if (countsBefore === null)
    return (
      `  ${INSERT_CHECK} DID NOT RUN — the pre-write row counts could not be read, ` +
      `so a resurrected row would be unseen. wt-ksh.9 step 2.`
    )

  const held = totalHeld(countsBefore)
  const inserts = insertsByTable(talliesByTable)

  // AFTER the two reads, not before: an empty deployment still gets its inputs
  // checked, so a mutation that quietly stopped reporting `inserted` fails on
  // the first copy rather than waiting for the run where it matters.
  if (held === 0) return null

  if (inserts.length === 0)
    return (
      `  ${INSERTED_NOTHING} on a re-run — the deployment already held ${held} rows, ` +
      `so nothing v2 deleted came back.`
    )

  const rows = inserts.reduce((sum, [, n]) => sum + n, 0)
  const width = Math.max(...inserts.map(([label]) => label.length)) + 3
  return [
    RULE,
    `${GUTTER}${INSERT_HEADLINE}: ${plural(rows, 'row')} across ${plural(inserts.length, 'table')}`,
    // The count sits on a line of its own rather than inside the prose, so that
    // a deployment an order of magnitude larger cannot push a wrapped sentence
    // out through the right-hand edge of the frame.
    `${GUTTER}Trigger: the deployment already held ${held} rows before this run.`,
    // NOT AN EITHER/OR. An earlier draft read "either new in v1, or one v2
    // DELETED", which is the one exhaustive claim in this block and it is false:
    // a widened --scope, a previous copy that died partway, a first copy into a
    // deployment holding v2-born rows and a row that used to fail selectCopyable
    // all insert innocently too. This is the text that actually gets read at
    // cutover, so it names resurrection as ONE reason and hands off the list.
    `${GUTTER}A re-run against unchanged v1 data inserts nothing, so every row below`,
    `${GUTTER}needs a reason. One possible reason is a row v2 DELETED that this copy`,
    `${GUTTER}put back; there are several innocent ones. These counts cannot tell them`,
    `${GUTTER}apart — wt-ksh.9 step 2 is the list to work through, in order.`,
    `${GUTTER}Every table the copy writes is counted, including those it cannot diff.`,
    BLANK,
    // Only the tables that inserted. The zeros are already on screen: every
    // table's own line above it reads `inserted=0 ...` from formatTally, so
    // repeating them here would cost the block six lines and push the clobber
    // block off a short terminal to say something already said.
    ...inserts.map(([label, n]) => `${GUTTER}${label.padEnd(width)}${plural(n, 'row')}`),
    RULE,
  ].join('\n')
}

const INSERTED_NOTHING = 'Inserted nothing'
const INSERT_HEADLINE = 'INSERTED INTO A NON-EMPTY DEPLOYMENT'
const INSERT_CHECK = 'Insert check'

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * The tables that inserted at least one row, in write order.
 *
 * An empty tally means the mutation was never called — the copy only does that
 * when the table had no rows in scope — so it inserted nothing and is not a
 * table that "gained zero rows" either. Same rule partition() applies, for the
 * same reason.
 *
 * A NON-EMPTY TALLY WITHOUT A NUMERIC `inserted` THROWS rather than counting as
 * zero. All six mutations return one today; if one stopped, treating the absence
 * as zero would turn this report — the only thing watching for a resurrected row
 * — into a permanent, silent all-clear. That is the failure mode the whole
 * module exists to refuse.
 *
 * @returns {Array<[string, number]>}
 */
const insertsByTable = (talliesByTable) => {
  const inserts = []
  for (const [label, tallies] of Object.entries(talliesByTable)) {
    if (Object.keys(tallies).length === 0) continue
    const n = tallies.inserted
    if (typeof n !== 'number')
      throw new Error(
        `copy tally: '${label}' was written but its 'inserted' is ${describe(n)}. ` +
          `Every migrate.ts upsert returns an insert count, and this report is the only ` +
          `thing watching for a row v2 deleted coming back; it will not assume zero.`,
      )
    if (n > 0) inserts.push([label, n])
  }
  return inserts
}

/**
 * How many rows the deployment held before the writes — the re-run signal.
 *
 * Validated rather than summed blindly: a non-numeric value makes the sum NaN,
 * `NaN === 0` is false, and the detector would silently switch from "silent on a
 * first copy" to "loud on every copy" — the false alarm that trains the reader
 * to skip the block.
 */
const totalHeld = (countsBefore) => {
  if (typeof countsBefore !== 'object' || countsBefore === null || Array.isArray(countsBefore))
    throw new Error(
      `copy tally: the pre-write counts are ${describe(countsBefore)}, not a record of row ` +
        `counts. Without them there is no way to tell a first copy from a re-run.`,
    )
  let held = 0
  for (const [table, n] of Object.entries(countsBefore)) {
    if (typeof n !== 'number')
      throw new Error(
        `copy tally: pre-write count for '${table}' is ${describe(n)}, not a number. ` +
          `A NaN total reads as non-empty and would make every copy print the block.`,
      )
    held += n
  }
  return held
}

const isRecordOfNumbers = (value) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((n) => typeof n === 'number')

const describe = (value) => {
  if (Array.isArray(value)) return 'an array'
  if (value === null) return 'null'
  // Not `a undefined`. Absence is the case insertsByTable reports on — a
  // mutation that stopped returning `inserted` — and the message has to read as
  // a sentence for the person who has to act on it.
  if (value === undefined) return 'missing'
  if (typeof value !== 'object') return `a ${typeof value}`
  // `find` misses when every value IS a number, which happens one level down:
  // describing { scoring: { oneGuess: 1 } } recurses into a perfectly valid
  // record of numbers whose only sin is its depth.
  const bad = Object.entries(value).find(([, n]) => typeof n !== 'number')
  return bad ? `an object whose '${bad[0]}' is ${describe(bad[1])}` : 'an object'
}
