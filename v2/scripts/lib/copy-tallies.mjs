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
 * The one-line summary for a table: `inserted=3 updated=1 clobbered={name=2}`.
 *
 * A nested record prints inline, and `none` when it is empty — `clobbered={}`
 * reads like a bug, and "the copy overwrote nothing" is exactly the thing this
 * report has to be able to say out loud.
 *
 * DELIBERATELY QUIET FOR NOW. Making the clobber report loud — its own block,
 * ahead of the counts, impossible to scroll past — is wt-ksh.13.5. This line's
 * job in the meantime is only to be true.
 *
 * An empty tally means the mutation was never called, which the caller only ever
 * does when there were no rows for that table.
 *
 * @param {Record<string, unknown>} tallies as built by mergeTally, so the values
 *   are numbers or flat records of numbers and nothing else — mergeTally is what
 *   guarantees that, by refusing everything else.
 */
export function formatTally(tallies) {
  const parts = Object.entries(tallies).map(([key, value]) => `${key}=${format(value)}`)
  return parts.length ? parts.join(' ') : '(nothing to do)'
}

const format = (value) => {
  if (typeof value === 'number') return String(value)
  const fields = Object.entries(value).map(([field, n]) => `${field}=${n}`)
  return fields.length ? `{${fields.join(' ')}}` : 'none'
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
