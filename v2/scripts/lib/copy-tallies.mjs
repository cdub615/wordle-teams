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
      `copy tally: '${key}' is a nested record, and the only one anything knows how ` +
        `to print is 'clobbered'. This summary skips it and formatClobberReport ` +
        `never looks at it, so the run prints it nowhere. Teach one of them about it.`,
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
 * @param {Record<string, Record<string, unknown>>} byTable table label -> the
 *   tally mergeTally accumulated for it, in the order the copy wrote them.
 * @returns {string} either one indented line, or a multi-line banner. Already
 *   formatted for console.log; the caller supplies the leading blank line.
 */
export function formatClobberReport(byTable) {
  const overwritten = [] // [label, [[field, rows], ...]] — at least one field
  const clean = [] // reported `clobbered`, and it was empty
  const notDiffed = [] // written to, but this mutation returns no `clobbered`

  for (const [label, tallies] of Object.entries(byTable)) {
    if (Object.keys(tallies).length === 0) continue
    const clobbered = tallies.clobbered
    if (clobbered === undefined) {
      notDiffed.push(label)
    } else if (Object.keys(clobbered).length === 0) {
      clean.push(label)
    } else {
      overwritten.push([label, Object.entries(clobbered)])
    }
  }

  if (overwritten.length === 0) {
    // With nothing overwritten, `clean` IS every table that reported.
    const scope = clean.length
      ? `Overwrote nothing in ${clean.join(', ')}`
      : 'Overwrote nothing: no table that diffs had rows to write'
    // `not diffed:` rather than "X does not diff", so the phrasing reads the
    // same whether the list has one entry or three.
    const caveat = notDiffed.length ? `; not diffed: ${notDiffed.join(', ')}` : ''
    return `  ${scope}${caveat}.`
  }

  const width = Math.max(...overwritten.map(([label]) => label.length)) + 3
  const lines = [
    RULE,
    `##  OVERWROTE STORED VALUES: ${overwritten.map(([label]) => label).join(', ')}`,
    '##  Rows whose stored value this copy replaced: a v2 edit lost, or a v1-side',
    '##  edit arriving during dual-running. Deliberate before cutover, when beta',
    '##  state is discarded; after cutover it is live user data.',
    '##',
    ...overwritten.flatMap(([label, fields]) => detailLines(label, fields, width)),
  ]
  const notes = []
  if (clean.length) notes.push(`##  Overwrote nothing: ${clean.join(', ')}`)
  if (notDiffed.length) notes.push(`##  Not diffed: ${notDiffed.join(', ')}`)
  if (notes.length) lines.push('##', ...notes)
  lines.push(RULE)
  return lines.join('\n')
}

const FRAME = 80
const RULE = '#'.repeat(FRAME)

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
 * A field name long enough to overflow on its OWN would still overflow, since
 * nothing truncates — a truncated field name is a name the reader cannot act on.
 * Nothing comes close today: the longest is reminderDeliveryMethods, which at
 * the widest gutter the report can produce measures 56 columns.
 */
const detailLines = (label, fields, width) => {
  const gutter = `##  ${' '.repeat(width)}`
  const lines = []
  let current = `##  ${label.padEnd(width)}`
  for (const [i, [field, rows]] of fields.entries()) {
    // The separator rides on the item BEFORE the break, so a continuation line
    // never opens with a comma and a continued list never looks finished.
    const last = i === fields.length - 1
    const item = `${field} on ${rows} ${rows === 1 ? 'row' : 'rows'}${last ? '' : ','}`
    if (i === 0) {
      current += item
    } else if (current.length + 1 + item.length <= FRAME) {
      current += ` ${item}`
    } else {
      lines.push(current)
      current = gutter + item
    }
  }
  lines.push(current)
  return lines
}

const isRecordOfNumbers = (value) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((n) => typeof n === 'number')

const describe = (value) => {
  if (Array.isArray(value)) return 'an array'
  if (value === null) return 'null'
  if (typeof value !== 'object') return `a ${typeof value}`
  // `find` misses when every value IS a number, which happens one level down:
  // describing { scoring: { oneGuess: 1 } } recurses into a perfectly valid
  // record of numbers whose only sin is its depth.
  const bad = Object.entries(value).find(([, n]) => typeof n !== 'number')
  return bad ? `an object whose '${bad[0]}' is ${describe(bad[1])}` : 'an object'
}
