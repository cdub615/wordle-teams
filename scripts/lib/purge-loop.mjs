/**
 * Loop control for `internal.migrate.purgeCopiedData`.
 *
 * That mutation deletes a bounded slice per call — ~800 rows, stopping at one
 * batch rather than continuing to the next table — and reports `remaining:true`
 * when there is more. Running it ONCE leaves most of the data behind, and the
 * cutover runbook's §4.4 GATE A names exactly that mistake: a partially purged
 * deployment makes the next copy's insert report look like a resurrection, and
 * the operator goes hunting for rows to delete that the copy legitimately just
 * wrote.
 *
 * Lives here rather than inline in scripts/purge-copied-data.mjs because that
 * script runs against a live deployment at module scope, so nothing written
 * inline there can be executed by a test — the same reason copy-tallies.mjs
 * exists. This is the one piece with logic worth pinning.
 */

/** Adds one call's per-table counts into a running total, in place. */
export function mergeDeleted(totals, deleted) {
  for (const [table, n] of Object.entries(deleted ?? {})) {
    totals[table] = (totals[table] ?? 0) + n
  }
  return totals
}

const describe = (totals) =>
  Object.entries(totals)
    .map(([table, n]) => `${table}=${n}`)
    .join(' ') || 'nothing'

/**
 * Calls `call` until it stops reporting rows remaining.
 *
 * `maxCalls` is a guard against a server-side bug that never clears
 * `remaining` — without it this spins forever against production. On hitting
 * the cap it throws WITH the running totals, so the operator can see how far it
 * got and simply run the script again rather than starting from a blank.
 */
export async function purgeLoop(call, { maxCalls = 200 } = {}) {
  const totals = {}
  for (let calls = 1; calls <= maxCalls; calls++) {
    const { deleted, remaining } = await call()
    mergeDeleted(totals, deleted)
    if (!remaining) return { totals, calls }
  }
  throw new Error(
    `purgeCopiedData did not finish within ${maxCalls} calls — deleted so far: ${describe(totals)}. ` +
      `Re-run to continue; it resumes where it stopped. If the count is not moving, stop and investigate.`,
  )
}
