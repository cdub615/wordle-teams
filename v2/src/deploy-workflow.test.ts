import { readFileSync } from 'node:fs'
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
  fileURLToPath(new URL('../../.github/workflows/deploy-v2.yml', import.meta.url)),
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
  test('runs after the Worker is deployed, and only on a push', () => {
    const step = /- name: The deployment's variables must match the environment[\s\S]{0,400}/.exec(
      WORKFLOW,
    )?.[0]
    expect(step, 'the assertion step is gone').toBeDefined()
    expect(step).toMatch(/if: github\.event_name == 'push'/)
    expect(step).toMatch(/check-deployment-env\.mjs/)
  })

  test('it is told which environment it is checking', () => {
    // Without CLOUDFLARE_ENV it would check every deployment against
    // production's rules, which would fail every dev deploy on E2E_TEST_MODE --
    // a check that is wrong in the loud direction, but wrong.
    expect(WORKFLOW).toMatch(/check-deployment-env\.mjs "\$\{CLOUDFLARE_ENV:-\}"/)
  })

  test('no COMMAND in the workflow runs `convex env list`', () => {
    // It prints every variable's value in plaintext, and this repository's CI
    // logs are public. The assertion step reads variables one at a time for
    // exactly that reason.
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
