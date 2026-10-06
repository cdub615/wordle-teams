// WHAT scripts/rac-duplicate-scores.mjs DECIDES BEFORE IT TOUCHES ANYTHING
// (wordle-teams-rac.2).
//
// The runner drives migrate.ts's duplicateScoresProbe, duplicateScoresImpact and
// repairDuplicateScores against a real deployment with the migration key. Its
// target, its flags and where its report may land are decided here, purely, so
// rac-runner.test.mjs can drive the refusals — the script itself does its work at
// module scope and is untestable, like every runner in scripts/.

import path from 'node:path'

const MODES = ['measure', 'impact', 'repair']
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * argv (without node and the script) -> { mode, apply, local, confirmHost, out }
 * or { error }. Unknown flags are refused rather than ignored: a mistyped
 * `--aply` must not quietly become a dry run that the operator believes wrote.
 */
export function parseRacArgs(argv) {
  const [mode, ...flags] = argv
  if (!MODES.includes(mode)) {
    return { error: `First argument must be one of: ${MODES.join(', ')}.` }
  }
  let apply = false
  let dryRun = false
  let local = false
  let confirmHost
  let out
  for (const flag of flags) {
    if (flag === '--apply') apply = true
    else if (flag === '--dry-run') dryRun = true
    else if (flag === '--local') local = true
    else if (flag.startsWith('--confirm-host=')) confirmHost = flag.slice('--confirm-host='.length)
    else if (flag.startsWith('--out=')) out = flag.slice('--out='.length)
    else return { error: `Unknown flag ${flag}.` }
  }
  if (apply && mode !== 'repair') return { error: '--apply applies only to repair.' }
  if (apply && dryRun) return { error: 'Pass --apply or --dry-run, not both.' }
  return { mode, apply, local, confirmHost, out }
}

function hostnameOf(url) {
  try {
    return new URL(String(url)).hostname
  } catch {
    return null
  }
}

/**
 * Whether the runner may proceed against `convexUrl`, and the host it prints.
 *
 * WITHOUT --local, ONLY THE EXPECTED CLOUD HOST: the deployment wrangler.jsonc
 * declares at its top level, which is production. A loopback backend is refused
 * (bd memory convex-env-and-key-scopes: `--prod` silently resolves to
 * 127.0.0.1, so a local reading must never pass for a production one), and so is
 * every other cloud host, dev included. If wrangler.jsonc could not be read the
 * expected host is unknown and the answer is no.
 *
 * WITH --local, ONLY A LOOPBACK BACKEND — for testing the runner end to end.
 *
 * --apply ALSO REQUIRES --confirm-host EQUAL TO THE PRINTED HOST, so a write has to
 * name the machine it writes to.
 */
export function decideRacTarget({ convexUrl, environments, local, apply, confirmHost }) {
  const host = hostnameOf(convexUrl)
  if (!host) return { ok: false, host: null, reason: 'CONVEX_URL is missing or not a URL.' }

  if (local) {
    if (!LOOPBACK.has(host)) {
      return { ok: false, host, reason: `--local was passed but ${host} is not a loopback backend.` }
    }
  } else {
    if (LOOPBACK.has(host)) {
      return {
        ok: false,
        host,
        reason: `${host} is a LOCAL backend. Pass --local to run against it deliberately.`,
      }
    }
    const top = (environments ?? []).find((e) => e.name === '(top level)')
    const expected = top ? hostnameOf(top.convexUrl) : null
    if (!expected) {
      return { ok: false, host, reason: 'Could not read the expected host from wrangler.jsonc.' }
    }
    if (host !== expected) {
      return { ok: false, host, reason: `${host} is not the expected deployment ${expected}.` }
    }
  }

  if (apply && confirmHost !== host) {
    return { ok: false, host, reason: `--apply writes. Confirm the target with --confirm-host=${host}` }
  }
  return { ok: true, host }
}

/**
 * A report names real players' legacy ids and boards, so it may go to stdout or
 * under the OS temp dir — never into the repository, even where the repository
 * itself sits under the temp dir.
 */
export function outputPathAllowed(file, { tmpdir, repoRoot }) {
  const resolved = path.resolve(file)
  const inside = (dir) => resolved.startsWith(path.resolve(dir) + path.sep)
  return inside(tmpdir) && !inside(repoRoot) && resolved !== path.resolve(repoRoot)
}

export function chunk(list, n) {
  const out = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

/** The months a probe entry's groups fall in, each once, in order. */
export function monthsToRepair({ groups }) {
  return [...new Set(groups.map((g) => g.puzzleDay.slice(0, 7)))].sort()
}

/**
 * Impact entries from several batches, each (team, month) once. Two batches can
 * both reach a team-month holding affected players from each; duplicateScoresImpact
 * collapses every member's duplicates whichever batch asks, so the two entries are
 * identical and one is dropped.
 */
export function dedupeEntries(entries) {
  const seen = new Set()
  return entries.filter((entry) => {
    const key = JSON.stringify(entry)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
