import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * THE PII GUARD IS ACTUALLY WIRED INTO THE HOOK GIT WILL RUN.
 *
 * WHY THIS EXISTS. scripts/check-no-pii.mjs blocks third-party addresses from
 * this PUBLIC repo. It was installed into .git/hooks/pre-commit — and beads sets
 * `core.hooksPath` to .beads/hooks, which OVERRIDES .git/hooks ENTIRELY. From
 * the moment beads installed its hooks the guard ran for nobody, silently. Not
 * a theory: on 2026-09-02 a commit carrying a third-party address succeeded with
 * exit 0, while the same file failed the script directly (wordle-teams-q79o).
 *
 * THE FIX WAS ONE LINE IN A FILE NOBODY LOOKS AT, which is exactly the shape of
 * thing that comes undone without anyone noticing — a `bd hooks install`, a
 * beads upgrade, a fresh clone with different config. So the wiring is asserted
 * here rather than trusted.
 *
 * IT READS `git config core.hooksPath` RATHER THAN ASSUMING A PATH. Assuming
 * .beads/hooks would pass on a machine where the setting had moved, which is
 * the case most worth catching: the guard would be as unwired as it was before,
 * and this test would say it was fine.
 */
const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()

/**
 * A shell script with its COMMENTS STRIPPED, and this is not a nicety.
 *
 * The first version of this file asserted `contents.toContain('check-no-pii.mjs')`
 * against the raw hook — and removing the actual call left the test GREEN,
 * because the hook's own comment says "See scripts/check-no-pii.mjs". It matched
 * the prose explaining the guard while the guard was gone, which is precisely
 * the failure mode this file exists to catch, reproduced inside the catcher.
 * Found by mutation; it would not have been found by reading.
 */
const codeOnly = (shell: string) =>
  shell
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')

/** Where git will actually look, which is not necessarily .git/hooks. */
const hooksPath = (() => {
  try {
    const configured = execSync('git config --get core.hooksPath', {
      encoding: 'utf8',
      cwd: repoRoot,
    }).trim()
    if (!configured) return `${repoRoot}/.git/hooks`
    return configured.startsWith('/') ? configured : `${repoRoot}/${configured}`
  } catch {
    // `git config --get` exits 1 when the key is unset, which is the default
    // and means .git/hooks is live.
    return `${repoRoot}/.git/hooks`
  }
})()

/**
 * WHETHER THIS MACHINE HAS COMMIT HOOKS AT ALL.
 *
 * CI DOES NOT, AND MUST NOT FAIL FOR IT. A fresh checkout has no
 * `core.hooksPath` and no `.git/hooks/pre-commit` — git does not check hooks
 * out — and a CI runner never commits, so there is nothing for this file to
 * protect there. The first version of this test asserted unconditionally and
 * broke the beta deploy on exactly that: green locally, where hooks exist, red
 * on the runner where they cannot.
 *
 * IT DOES NOT SKIP ON "THE HOOK IS MISSING", which would skip the very failure
 * it exists to catch. The distinction is whether hooks were INSTALLED:
 *   - `core.hooksPath` set  -> beads (or something) has taken hooks over, which
 *                              is the situation the guard was silently unwired
 *                              by. Assert.
 *   - `.git/hooks/pre-commit` present -> stock hooks are in use. Assert.
 *   - neither -> no hooks on this machine. Nothing to say.
 */
const hooksInstalled = existsSync(`${hooksPath}/pre-commit`)

describe.skipIf(!hooksInstalled)('the PII guard runs on commit', () => {
  test('the script itself still exists where the hook expects it', () => {
    // A guard wired to a deleted file fails open just as quietly.
    expect(existsSync(`${repoRoot}/scripts/check-no-pii.mjs`)).toBe(true)
  })

  test('THE pre-commit GIT WILL RUN INVOKES check-no-pii', () => {
    /**
     * The assertion the whole file is for. Note it checks the hook in the
     * CONFIGURED directory — if `core.hooksPath` moves and the new directory's
     * hook does not call the guard, this goes red, which is precisely the
     * failure that shipped undetected once.
     */
    const preCommit = `${hooksPath}/pre-commit`
    expect(existsSync(preCommit), `${preCommit} does not exist — nothing runs on commit`).toBe(true)

    const contents = codeOnly(readFileSync(preCommit, 'utf8'))
    expect(
      contents,
      `${preCommit} does not invoke scripts/check-no-pii.mjs. beads' core.hooksPath ` +
        'overrides .git/hooks entirely, so wiring the guard there does nothing. Add the call ' +
        "AFTER beads' own END marker so `bd hooks install` cannot overwrite it.",
    ).toContain('check-no-pii.mjs')
  })

  test('the call is OUTSIDE the beads-managed block, so an upgrade cannot eat it', () => {
    // beads rewrites only the region between its markers. A call placed inside
    // survives until the next `bd hooks install` and then vanishes — the same
    // silent unwiring, arriving later.
    // Raw here, not comment-stripped: the END marker IS a comment, so stripping
    // them removes the boundary this test measures against.
    const contents = readFileSync(`${hooksPath}/pre-commit`, 'utf8')
    const end = contents.indexOf('END BEADS INTEGRATION')
    if (end === -1) return // no beads block here; nothing to be inside of
    // The CALL's position, found by searching for an invocation rather than a
    // mention — the comment above the call sits after the marker too, so an
    // indexOf on the bare filename would pass on a hook with no call at all.
    const call = contents.search(/^\s*node\s+scripts\/check-no-pii\.mjs/m)
    expect(call, 'no `node scripts/check-no-pii.mjs` invocation in the hook').toBeGreaterThan(-1)
    expect(
      call,
      'the guard is inside the beads-managed block and will be overwritten',
    ).toBeGreaterThan(end)
  })
})
