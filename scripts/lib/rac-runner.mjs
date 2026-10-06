// WHAT scripts/rac-duplicate-scores.mjs DECIDES BEFORE IT TOUCHES ANYTHING
// (wordle-teams-rac.2).
//
// The runner drives migrate.ts's duplicateScoresProbe, duplicateScoresImpact and
// repairDuplicateScores against a real deployment with the migration key. Its
// target, its flags and where its report may land are decided here, purely, so
// rac-runner.test.mjs can drive the refusals — the script itself does its work at
// module scope and is untestable, like every runner in scripts/.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MODES = ['measure', 'impact', 'repair']
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * argv (without node and the script) -> { mode, apply, local, confirmHost, expect,
 * out } or { error }. `--apply` needs `--expect=<fingerprint>`, the one a dry run
 * printed (revision 2, I4). Unknown flags are refused rather than ignored: a mistyped
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
  let expect
  let out
  for (const flag of flags) {
    if (flag === '--apply') apply = true
    else if (flag === '--dry-run') dryRun = true
    else if (flag === '--local') local = true
    else if (flag.startsWith('--confirm-host=')) confirmHost = flag.slice('--confirm-host='.length)
    else if (flag.startsWith('--expect=')) expect = flag.slice('--expect='.length)
    else if (flag.startsWith('--out=')) out = flag.slice('--out='.length)
    else return { error: `Unknown flag ${flag}.` }
  }
  if (apply && mode !== 'repair') return { error: '--apply applies only to repair.' }
  if (apply && dryRun) return { error: 'Pass --apply or --dry-run, not both.' }
  if (apply && !expect) {
    return { error: '--apply needs --expect=<fingerprint>, as printed by `repair --dry-run`.' }
  }
  return { mode, apply, local, confirmHost, expect, out }
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
 *
 * SYMLINKS ARE RESOLVED (revision 2, M3): the file's real path is what is checked
 * — the file itself when it exists, else its directory's real path plus its name —
 * and the temp dir and repository are compared by their real paths too. A
 * directory that does not exist is refused rather than guessed at.
 */
export function outputPathAllowed(file, { tmpdir, repoRoot }) {
  const real = (p) => fs.realpathSync.native(p)
  const abs = path.resolve(file)
  let resolved
  try {
    resolved = real(abs)
  } catch {
    try {
      resolved = path.join(real(path.dirname(abs)), path.basename(abs))
    } catch {
      return false
    }
  }
  let tmp, repo
  try {
    tmp = real(tmpdir)
    repo = real(repoRoot)
  } catch {
    return false
  }
  const inside = (dir) => resolved.startsWith(dir + path.sep)
  return inside(tmp) && !inside(repo) && resolved !== repo
}

/**
 * Print each record and, with a file, APPEND it as one JSON line before returning
 * (revision 2, I2), so a run that dies halfway keeps the record of everything it
 * already did — above all, of every row it already deleted.
 */
export function recorder(file, print = console.log) {
  return (record) => {
    const line = JSON.stringify(record)
    if (file) fs.appendFileSync(file, line + '\n')
    print(line)
  }
}

/**
 * THE FINGERPRINT AN APPLY MUST QUOTE (revision 2, I4): sixteen hex characters of
 * SHA-256 over every month's deletionKey (see lib/duplicateScores.ts), sorted and
 * newline-separated. Any change to any row a repair would delete changes it.
 */
export function fingerprintOf(deletionKeys) {
  return createHash('sha256')
    .update([...deletionKeys].sort().join('\n'))
    .digest('hex')
    .slice(0, 16)
}

/** The months probe entries' groups fall in, each once, in order. */
export function monthsOf(affected) {
  return [...new Set(affected.flatMap((a) => a.groups.map((g) => g.puzzleDay.slice(0, 7))))].sort()
}

/**
 * Whether one month's impact pages together hold every (team, month) pair exactly
 * once (revision 2, M2): the total must not move between pages, and the entries
 * must add up to it. Counted rather than keyed, because two v2-born teams both
 * report as 'v2-native'.
 */
export function checkImpactPages(pages) {
  const totals = new Set(pages.map((p) => p.pairs))
  if (totals.size !== 1) return { ok: false, reason: `the pair total moved between pages: ${[...totals]}` }
  const [pairs] = totals
  const seen = pages.reduce((n, p) => n + p.entries.length, 0)
  if (seen !== pairs) return { ok: false, reason: `saw ${seen} entries for ${pairs} pairs` }
  return { ok: true }
}
