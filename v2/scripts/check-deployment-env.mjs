#!/usr/bin/env node
// Asserts, AFTER a deploy, that the deployment's environment variables match the
// environment it is (wordle-teams-qjh3.7).
//
//   node scripts/check-deployment-env.mjs          # the top level: production
//   node scripts/check-deployment-env.mjs dev
//
// IT TARGETS THE DEPLOYMENT VIA CONVEX_DEPLOY_KEY, ON PURPOSE, and this is the one
// place in the repository where that key's dominance is a FEATURE rather than the
// hazard wordle-teams-ldm8 describes. The key is the same one `convex deploy` just
// used, so "the deployment this asserts about" and "the deployment that was just
// deployed to" are the same thing by construction — there is no name to pass, and
// therefore no name to get wrong. Do not "improve" this by adding --deployment.
//
// THE DECISION LOGIC IS IN scripts/lib/deployment-env.mjs, where its tests are.
// This file reads values and prints annotations.
//
// NEVER `convex env list`: it prints every variable's value in plaintext, and CI
// logs on this repository are public.
import { execFileSync } from 'node:child_process'
import { checkDeploymentEnv, parseEnvGet } from './lib/deployment-env.mjs'

const environmentName = process.argv[2] ?? ''
const KEYS = ['SITE_URL', 'E2E_TEST_MODE', 'POLAR_SERVER', 'SWEEPS_ENABLED']

/**
 * One variable's value, or null.
 *
 * `convex env get` EXITS 0 WHETHER OR NOT THE VARIABLE EXISTS, so a non-zero exit
 * here means the CLI itself failed — bad credentials, no network — which must not
 * be mistaken for "the variable is absent". That distinction is the difference
 * between a check that failed and a check that passed vacuously.
 */
function readVar(key) {
  let output
  try {
    output = execFileSync('pnpm', ['exec', 'convex', 'env', 'get', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stderr = String(error?.stderr ?? '')
    // The CLI writes "not found" to stderr and may exit non-zero depending on
    // version; that IS an answer and means absent.
    if (stderr.includes('not found')) return null
    // `cause` kept rather than flattened into the message: when this fires it is
    // a CLI or credentials failure, and the original is the only thing that says
    // which.
    throw new Error(`convex env get ${key} failed: ${stderr || error?.message}`, { cause: error })
  }
  return parseEnvGet(output)
}

const label = environmentName === '' ? 'production (top level)' : environmentName
console.log(`checking the Convex deployment for environment: ${label}`)

const values = {}
for (const key of KEYS) values[key] = readVar(key)

// The VALUES are deliberately not printed. SITE_URL and the flags are not
// secrets, but the habit of echoing a deployment's environment into a public log
// is how the next variable to be added gets echoed too.
const { errors, warnings } = checkDeploymentEnv(environmentName, values)

for (const warning of warnings) console.log(`::warning::${warning}`)
for (const message of errors) console.log(`::error::${message}`)

if (errors.length > 0) {
  console.log(`${errors.length} environment problem(s) on the ${label} deployment.`)
  process.exit(1)
}
console.log(`ok: ${label} environment variables are consistent with the environment.`)
