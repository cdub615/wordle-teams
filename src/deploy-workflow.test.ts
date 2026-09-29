import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * WHICH BRANCH DEPLOYS WHERE, pinned (wordle-teams-qjh3.6).
 *
 * The mapping lives in two GitHub Actions expressions, and both fail SILENTLY
 * and in the worst direction if simplified wrongly: a run that resolves to
 * `production` when it meant `dev` picks up production's deploy key and pushes a
 * Convex schema to the deployment that becomes production. Nothing in the run
 * looks wrong — it deploys successfully, to the wrong place.
 *
 * ASSERTED AGAINST THE SOURCE, the way src/lib/sentry-config.test.ts is asserted
 * against vite.config.ts and src/pii-guard-wiring.test.ts against the hook
 * config. There is no YAML parser in this project's dependencies, and adding one
 * to read four expressions would be a worse trade than matching the strings that
 * carry the decision.
 *
 * THIS DOES NOT TEST THAT THE WORKFLOW RUNS. It tests that the decisions
 * wordle-teams-qjh3 made are still the ones written down.
 */
const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../.github/workflows/deploy-v2.yml', import.meta.url)),
  'utf8',
)

describe('branch to environment mapping', () => {
  test('only the dev branch selects the dev wrangler environment', () => {
    // CLOUDFLARE_ENV drives BOTH the wrangler environment and which vars block
    // scripts/print-build-env.mjs exports, so this one expression decides which
    // Convex deployment the bundle is built against.
    expect(WORKFLOW).toMatch(
      /CLOUDFLARE_ENV:\s*\$\{\{\s*\(github\.event_name == 'push' && github\.ref_name == 'dev'\)\s*&&\s*'dev'\s*\|\|\s*''\s*\}\}/,
    )
  })

  test('only the dev branch selects the dev GitHub environment, and everything else is production', () => {
    expect(WORKFLOW).toMatch(
      /environment:\s*\$\{\{\s*github\.event_name == 'push' && \(github\.ref_name == 'dev' && 'dev' \|\| 'production'\) \|\| ''\s*\}\}/,
    )
  })

  test('a pull request claims no environment', () => {
    // Both expressions above are guarded on `event_name == 'push'`. A PR that
    // claimed an environment would leave a deployment record reading as though
    // something had been deployed, and PRs deploy nothing.
    const cloudflareEnv = /CLOUDFLARE_ENV:.*$/m.exec(WORKFLOW)?.[0] ?? ''
    const ghEnvironment = /^\s*environment:.*$/m.exec(WORKFLOW)?.[0] ?? ''
    for (const expression of [cloudflareEnv, ghEnvironment]) {
      expect(expression).toMatch(/github\.event_name == 'push'/)
    }
  })
})

describe('the decisions that are easy to undo by tidying', () => {
  test('feat/v2-replatform still deploys, and therefore still deploys to production', () => {
    // EPIC DECISION 11. The working branch keeps updating the deployment that
    // BECOMES production, because that is what cutover is rehearsed against.
    // Dropping it from the triggers would leave prod-to-be going stale with
    // nothing failing, which is the kind of thing found on cutover morning.
    expect(WORKFLOW).toMatch(/branches:\s*\[dev, main, feat\/v2-replatform\]/)
    // ...and it must NOT be named in either mapping expression, or it would stop
    // falling through to production.
    expect(/CLOUDFLARE_ENV:.*$/m.exec(WORKFLOW)?.[0]).not.toMatch(/feat/)
  })

  test('the concurrency group is per environment, not one shared queue', () => {
    // A single group made a dev push queue behind a production deploy. The race
    // the group exists to prevent is two runs at the SAME deployment.
    const group = /^\s*group:.*$/m.exec(WORKFLOW)?.[0] ?? ''
    expect(group).toMatch(/\$\{\{/)
    expect(group).not.toMatch(/group:\s*deploy-v2\s*$/)
  })

  test('the smoke test reads its hostname from the build output, never a literal', () => {
    // dist/server/wrangler.json is the resolved config the Worker was deployed
    // from, so its route is by construction the name that deployment claims. A
    // literal would be a fourth place the environment mapping lives — and the
    // one nobody would think to update.
    expect(WORKFLOW).toMatch(/require\('\.\/dist\/server\/wrangler\.json'\)\.routes\[0\]\.pattern/)
    // No curl in the file may name a deployment host directly.
    for (const line of WORKFLOW.split('\n').filter((l) => l.includes('curl'))) {
      expect(line, `a curl names a host literally: ${line.trim()}`).not.toMatch(
        /wordleteams\.com/,
      )
    }
  })
})

describe('the post-deploy environment assertion', () => {
  /**
   * THE STEP, BOUNDED AT THE NEXT `- name:` RATHER THAN BY A CHARACTER COUNT.
   *
   * The first version of this helper grabbed a fixed 400-character window, which
   * ran past the end of the step and into the one after it — so deleting this
   * step's own `if: github.event_name == 'push'` still matched, against the NEXT
   * step's guard. Caught by mutation: the mutant that dropped the push guard
   * survived. A windowed regex over structured text reads whatever happens to be
   * adjacent.
   */
  function stepNamed(name: string): string | undefined {
    const lines = WORKFLOW.split('\n')
    const start = lines.findIndex((l) => l.includes(`- name: ${name}`))
    if (start === -1) return undefined
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((l) => /^\s*- name: /.test(l))
    return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n')
  }

  test('runs, and only on a push', () => {
    const step = stepNamed("The deployment's variables must match the environment")
    expect(step, 'the assertion step is gone').toBeDefined()
    // THE PUBLIC-REPO GUARD. Without it a pull request from a branch of this
    // repository would run this against production with a live deploy key.
    expect(step).toMatch(/if: github\.event_name == 'push'/)
    expect(step).toMatch(/check-deployment-env\.mjs/)
  })

  test('is told which environment it is checking', () => {
    // Without CLOUDFLARE_ENV it would check every deployment against
    // production's rules, which would fail every dev deploy on E2E_TEST_MODE —
    // wrong in the loud direction, but wrong.
    expect(WORKFLOW).toMatch(/check-deployment-env\.mjs "\$\{CLOUDFLARE_ENV:-\}"/)
  })

  test('runs BEFORE the Worker deploy, so a bad environment stops the ship', () => {
    // THE ORDER IS THE POINT, and it is the one thing about this step that a
    // reader would not think to preserve. The variables belong to the Convex
    // deployment `convex deploy` has just updated, so this is the last moment a
    // bad one can stop the Worker going live. An earlier draft sat after the
    // Worker deploy and would have reported the problem only once it was serving.
    const assertion = WORKFLOW.indexOf("- name: The deployment's variables must match")
    const worker = WORKFLOW.indexOf('- name: Deploy the Worker')
    const convex = WORKFLOW.indexOf('- name: Deploy Convex and build the client')
    expect(assertion).toBeGreaterThan(convex)
    expect(assertion).toBeLessThan(worker)
  })

  test('the permission failure that removed it once is still explained', () => {
    // Run 36474279805 died here on deployment:env:view because the repository
    // secret was a deploy key from 2026-08-03. Keeping the account of it in the
    // file is what stops the next person debugging the script instead of the key.
    expect(WORKFLOW).toMatch(/deployment:env:view/)
  })

  test('no COMMAND in the workflow runs `convex env list`', () => {
    // It prints every variable's value in plaintext, and this repository's CI
    // logs are public.
    //
    // COMMENT LINES ARE EXCLUDED, and the distinction is load-bearing rather
    // than pedantic: the e2e step's comment legitimately DISCUSSES `convex env
    // list`, as the thing that silently revives a dead local backend and makes
    // provisioning look healthy. A test that fired on prose would be weakened
    // the first time someone hit it, and the weakening would be right — so it
    // has to be precise now.
    const commands = WORKFLOW.split('\n').filter((line) => !/^\s*#/.test(line))
    expect(commands.join('\n')).not.toMatch(/convex env list/)
  })
})

/**
 * NO WORKFLOW MAY STILL POINT AT A v2 DIRECTORY (wordle-teams-4m96.4).
 *
 * THIS TEST EXISTS BECAUSE ITS ABSENCE COST A CI RUN. After the move, every
 * workflow was swept for stale paths with a grep for `v2/` — anchored on the
 * slash. `cloudflare/wrangler-action@v4` takes its path as a bare token,
 * `workingDirectory: v2`, so the sweep walked straight past it. The run then
 * deployed Convex, built the client, and died on "Directory v2 does not exist"
 * at the Worker step, with every gate green beforehand.
 *
 * IT CHECKS EVERY WORKFLOW, not just this one, because the file that broke was
 * not the file being edited at the time. And it matches a BARE token as well as
 * a path prefix, which is the whole lesson.
 *
 * COMMENT LINES ARE EXCLUDED. Several workflows legitimately discuss the old
 * layout in prose — refresh-insights-corpus.yml's argument about main is written
 * in those terms on purpose, and deploy-v2.yml explains why a pnpm workaround
 * used to be needed. A test that fired on prose would be weakened the first time
 * it was hit.
 */
describe('no workflow still points at a v2 directory', () => {
  const dir = fileURLToPath(new URL('../.github/workflows/', import.meta.url))

  test.each(readdirSync(dir))('%s', (file) => {
    const commands = readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n')
    // `v2` as a path, bare or prefixed — but not inside an action version like
    // `novuhq/actions-novu-sync@v2`, and not in this repo's own workflow name.
    expect(commands).not.toMatch(/(working[-_]?[Dd]irectory|cache-dependency-path|package_json_file|paths?):\s*\[?'?v2\b/)
    expect(commands, 'a v2/ path survives in a command').not.toMatch(/\bv2\//)
  })
})
