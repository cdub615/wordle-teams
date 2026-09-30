#!/usr/bin/env node
// Asserts that a Convex deployment's environment variables match the environment
// it is meant to be (wordle-teams-qjh3.7).
//
//   node scripts/check-deployment-env.mjs ''    fabulous-goldfish-949   # production
//   node scripts/check-deployment-env.mjs dev   successful-canary-135
//
// A CONVEX DEPLOY KEY CANNOT RUN THIS, which is the first thing to know and cost a
// CI run to find out. It was wired into the deploy workflow and failed on its only
// run (36474279805):
//
//     ✖ You do not have permission to perform this operation (deployment:env:view).
//       This is determined by the permissions granted to CONVEX_DEPLOY_KEY.
//
// Deploy keys deploy; they do not read environment variables, and `convex
// deployment token create` exposes no permission scopes to widen. So this runs
// under an ACCOUNT LOGIN (`npx convex login`) and takes an explicit deployment
// name, because there is no deploy key to imply one.
//
// IT BUILDS ITS OWN CLEAN WORKING DIRECTORY, and that is the whole trick rather
// than a detail. The convex CLI needs a package.json naming convex as a
// dependency, which makes v2/ the obvious place to run it from — but v2/.env.local
// holds a CONVEX_DEPLOY_KEY, and that key MASKS the account login completely:
// `convex login status` reports "Not logged in" from v2/ and "Logged in" from a
// clean directory, with the same token on disk (wordle-teams-ldm8). Telling the
// operator to cd somewhere else is an instruction that gets forgotten; making the
// script do it is a mechanism that cannot be. The CLI binary is resolved from this
// repository's node_modules, so the temporary directory needs no install.
//
// THE DECISION LOGIC IS IN scripts/lib/deployment-env.mjs, where its tests are.
// This file reads values and prints annotations.
//
// NEVER `convex env list`: it prints every variable's value in plaintext.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { checkDeploymentEnv, parseEnvGet } from './lib/deployment-env.mjs'

const environmentName = process.argv[2] ?? ''
const deployment = process.argv[3]
const KEYS = ['SITE_URL', 'E2E_TEST_MODE', 'POLAR_SERVER', 'SWEEPS_ENABLED']

// TWO WAYS TO SAY WHICH DEPLOYMENT, and the difference is who is running this.
//
// BY NAME, for a human with an account login: the name is explicit and the
// credential can reach any deployment, so it has to be told which one.
//
// BY DEPLOY KEY, for CI: CONVEX_DEPLOY_KEY is scoped to exactly one deployment
// and is the same key `convex deploy` just used, so the deployment asserted about
// and the deployment just deployed to are the same BY CONSTRUCTION. There is no
// name to pass and therefore none to get wrong. Do not "improve" the CI call by
// adding one — a name that disagreed with the key would be silently ignored.
if (!deployment && !process.env.CONVEX_DEPLOY_KEY) {
  console.error(
    "Pass the environment and the deployment, e.g.\n" +
      "  node scripts/check-deployment-env.mjs ''  fabulous-goldfish-949\n" +
      '  node scripts/check-deployment-env.mjs dev successful-canary-135\n' +
      '\nOr set CONVEX_DEPLOY_KEY to let the key name its own deployment.',
  )
  process.exit(2)
}

// RESOLVED VIA package.json RATHER THAN THE SUBPATH DIRECTLY. `convex/bin/main.js`
// is a `bin` entry but is NOT listed in the package's `exports`, so
// require.resolve on it throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolving the
// manifest and joining from its directory sidesteps that, and unlike
// node_modules/.bin/convex it does not depend on the package manager's shim layout.
const convexBin = join(
  dirname(createRequire(import.meta.url).resolve('convex/package.json')),
  'bin',
  'main.js',
)
const workdir = mkdtempSync(join(tmpdir(), 'convex-env-check-'))
writeFileSync(
  join(workdir, 'package.json'),
  JSON.stringify({ name: 'convex-env-check', private: true, dependencies: { convex: '*' } }),
)

/**
 * One variable's value, or null when it is not set.
 *
 * `convex env get` EXITS 0 WHETHER OR NOT THE VARIABLE EXISTS (cutover runbook
 * section 0), so a non-zero exit here means the CLI itself failed — bad
 * credentials, no network — which must never be mistaken for "the variable is
 * absent". That distinction is the difference between a check that failed and a
 * check that passed vacuously.
 */
function readVar(key) {
  try {
    // THE FLAG IS CONDITIONAL AND MUST STAY SO. `convex env get` REFUSES
    // `--deployment` when CONVEX_DEPLOY_KEY is set — "The `--deployment` flag
    // cannot be used with CONVEX_DEPLOY_KEY" — because the key already names one
    // deployment and two answers would be ambiguous. Passing it unconditionally
    // broke run 36496923726, which is how this comment came to exist.
    const args = [convexBin, 'env', 'get', key]
    if (deployment) args.push('--deployment', deployment)

    const output = execFileSync(process.execPath, args, {
      cwd: workdir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return parseEnvGet(output)
  } catch (error) {
    const stderr = String(error?.stderr ?? '')
    if (stderr.includes('not found')) return null
    if (stderr.includes('deployment:env:view')) {
      throw new Error(
        `Cannot read ${key}: this credential lacks deployment:env:view.\n` +
          `A deploy key created before ~2026-09 cannot read environment variables. A key ` +
          `minted since can (measured 2026-09-28). If this is CI, regenerate ` +
          `CONVEX_DEPLOY_KEY with \`convex deployment token create\`; if this is a person, ` +
          `run under an account login (npx convex login).`,
        { cause: error },
      )
    }
    throw new Error(`convex env get ${key} failed: ${stderr || error?.message}`, { cause: error })
  }
}

try {
  const label = environmentName === '' ? 'production (top level)' : environmentName
  console.log(`checking ${deployment ?? "the deploy key's deployment"} against the rules for: ${label}`)

  const values = {}
  for (const key of KEYS) values[key] = readVar(key)

  // The VALUES are deliberately not printed. These four are not secrets, but the
  // habit of echoing a deployment's environment is how the next variable added
  // gets echoed too.
  const { errors, warnings } = checkDeploymentEnv(environmentName, values)

  for (const warning of warnings) console.log(`::warning::${warning}`)
  for (const message of errors) console.log(`::error::${message}`)

  if (errors.length > 0) {
    console.log(`${errors.length} environment problem(s) on ${deployment ?? "this deployment"}.`)
    process.exitCode = 1
  } else {
    console.log(`ok: ${deployment ?? "this deployment"} is consistent with the ${label} rules.`)
  }
} finally {
  rmSync(workdir, { recursive: true, force: true })
}
