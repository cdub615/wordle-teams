// How the scripts ask a deployment how many rows it holds.
//
// The loop is HERE, in the caller, and that is the whole point of the module.
// internal.migrate.countTable returns ONE PAGE of a count; adding the pages up
// across separate transactions is what keeps a count of a table larger than a
// single transaction may scan possible at all. Paginating inside the Convex
// query would not have done it — every page would still be scanned by the same
// transaction, against the same limit (wordle-teams-b31, and see countTable's
// own comment in convex/migrate.ts for the real numbers: 32,000 documents
// scanned, 16 MiB read, and 4,096 INDEX RANGES, which is calls to db.get and
// db.query rather than rows).
//
// Lifted out of the scripts for the reason lib/copy-filters.mjs was: neither
// copy-from-supabase.mjs nor verify-parity.mjs can be imported — both do their
// work at module scope against a live deployment — so a loop left inline in
// either is a loop no test can execute. This one has three call sites and an
// off-by-one in it would misreport the parity audit's row counts, which is the
// one number the audit cannot get wrong quietly.
//
// THE RESULT IS NOT A CONSISTENT SNAPSHOT. Every page is its own transaction and
// the six tables are read at six different instants, so a row written mid-count
// can land twice or not at all. The predecessor, internal.migrate.counts, was a
// single transaction and did not have that property. It is an acceptable trade
// here and only here: the verifier runs against a deployment nobody is writing
// to, and the copy script is itself the only writer. Do not reach for this when
// two counts have to agree with each other.

/**
 * The six tables the Supabase copy writes, and therefore the six the copy report
 * and the parity verifier both count. Named once so the three readCounts callers
 * cannot disagree about the set.
 *
 * THAT IS THE ONLY DRIFT IT CLOSES, and the list is not the only copy of this
 * set: `TABLES` in copy-from-supabase.mjs, the `table` union in countTable, and
 * purgeCopiedData's array in convex/migrate.ts each carry their own. A SEVENTH
 * COPIED TABLE ADDED TO SOME BUT NOT THIS ONE drops silently out of the parity
 * audit, and count-tables.test.mjs would not catch it — its fixture is derived
 * from this list, so the list is always self-consistent. Deliberately not worth
 * machinery for a set that has changed once; worth not pretending otherwise.
 *
 * NOR IS A TYPO HERE A COMPILE ERROR. Every caller is .mjs, tsconfig.json covers
 * only *.ts/*.tsx with no checkJs, so nothing type-checks these strings — an
 * earlier version of this comment claimed otherwise and was measured wrong. What
 * the literal union in countTable buys is that a bad name fails LOUDLY, as a
 * Convex ArgumentValidationError, instead of silently counting nothing; and what
 * pins this list against that union is count-tables.test.mjs, not the compiler.
 */
export const COUNTED_TABLES = [
  'players',
  'teams',
  'dailyScores',
  'monthlyWinners',
  'playerMembership',
  'webhookEvents',
]

// At countTable's page size (numItems, convex/migrate.ts — 2,000 as of writing)
// a table would have to hold 20 million rows to reach this, against production's
// ~8,700. So it is not a size limit, it is a liveness one: if a deployment ever
// answered with isDone false and a cursor that does not advance, the alternative
// to this is a script that hangs at cutover with no output. Halving the page
// size there does not invalidate it; only a four-order-of-magnitude change to
// either number would.
const MAX_PAGES = 10_000

/**
 * Row counts for all six copied tables, in the same
 * `{ players, teams, dailyScores, monthlyWinners, playerMembership, webhookEvents }`
 * shape the callers already consume.
 *
 * @param convex a connected ConvexHttpClient, already given admin auth
 * @param internal the generated `internal` API object
 */
export async function readCounts(convex, internal) {
  const counts = {}
  for (const table of COUNTED_TABLES) {
    let count = 0
    let cursor = null
    let pages = 0
    for (;;) {
      const page = await convex.query(internal.migrate.countTable, { table, cursor })
      count += page.count
      // Threaded into the NEXT request. Dropping this is the failure mode worth
      // naming: the loop re-reads page one forever, or terminates on a first
      // page that says it is done, and either way the number it prints is wrong
      // rather than absent.
      cursor = page.cursor
      if (page.isDone) break
      if (++pages >= MAX_PAGES) {
        throw new Error(`countTable did not finish ${table} after ${MAX_PAGES} pages`)
      }
    }
    counts[table] = count
  }
  return counts
}
