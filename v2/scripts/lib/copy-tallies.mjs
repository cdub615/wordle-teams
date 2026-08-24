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
 * FLAT COUNTERS ONLY. The nested records — `clobbered`, today the only one — are
 * dropped here on purpose and rendered by formatClobberReport instead. Printing
 * them in both places would break the news quietly, in a column, one line above
 * the block that exists to make it impossible to miss.
 *
 * An empty tally means the mutation was never called, which the caller only ever
 * does when there were no rows for that table. That is a fact about the TALLY,
 * so it is read off the tally and not off what survived the filter: every
 * mutation returns at least `inserted` and `updated`, so a table that was
 * written to always has counters to show.
 *
 * @param {Record<string, unknown>} tallies as built by mergeTally, so the values
 *   are numbers or flat records of numbers and nothing else — mergeTally is what
 *   guarantees that, by refusing everything else.
 */
export function formatTally(tallies) {
  if (Object.keys(tallies).length === 0) return '(nothing to do)'
  return Object.entries(tallies)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
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
    `##  OVERWROTE v2 EDITS: ${overwritten.map(([label]) => label).join(', ')}`,
    '##  Counts are rows whose stored value this copy replaced. Deliberate before',
    '##  cutover, when beta state is discarded. After cutover it is live user data.',
    '##',
    ...overwritten.map(([label, fields]) => `##  ${label.padEnd(width)}${listFields(fields)}`),
  ]
  const notes = []
  if (clean.length) notes.push(`##  Overwrote nothing: ${clean.join(', ')}`)
  if (notDiffed.length) notes.push(`##  Not diffed: ${notDiffed.join(', ')}`)
  if (notes.length) lines.push('##', ...notes)
  lines.push(RULE)
  return lines.join('\n')
}

const RULE = '#'.repeat(80)

const listFields = (fields) =>
  fields.map(([field, rows]) => `${field} on ${rows} ${rows === 1 ? 'row' : 'rows'}`).join(', ')

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
