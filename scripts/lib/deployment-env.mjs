// WHAT A DEPLOYMENT'S ENVIRONMENT VARIABLES MUST LOOK LIKE, PER ENVIRONMENT
// (wordle-teams-qjh3.7).
//
// Three cutover checklist items become things the pipeline refuses to get wrong
// rather than things somebody remembers at 6am. The decision logic is here so it
// can be tested and mutated; scripts/check-deployment-env.mjs is the shell that
// reads the real values and turns this into workflow annotations.
//
// IT IS A DEPLOY-TIME CHECK AND DELIBERATELY NOT A MODULE-SCOPE THROW. A
// module-scope throw in convex/auth.ts is what made the Better Auth component
// unpushable until a5d5c3f0 moved it into createAuth — component code receives no
// deployment environment variables, so the push died analysing the adapter. Do not
// "strengthen" any of this by moving it into convex/.
//
// ERRORS AND WARNINGS ARE A REAL DISTINCTION HERE, not a severity gradient. An
// error fails the job. A warning is for a state that is WRONG-LATER or
// EXPECTED-FOR-NOW, where failing the deploy would either invent an ordering
// constraint or block the deploy that fixes an incident. Each one below says which.

/**
 * The value of a variable from `convex env get`, or null when it is not set.
 *
 * THE ENTIRE REASON THIS PARSES TEXT: `convex env get` EXITS 0 WHETHER OR NOT THE
 * VARIABLE EXISTS. docs/runbooks/2026-cutover.md section 0 records the
 * measurement and states the rule — match the text, never the exit code. A check
 * built on `$?` here would report every absent variable as present-and-empty,
 * which for E2E_TEST_MODE is the exact wrong answer.
 */
export function parseEnvGet(output) {
  const text = String(output ?? '').trim()
  if (text === '') return null
  if (text.includes('not found')) return null
  return text
}

const POLAR_SERVERS = ['production', 'sandbox']

/**
 * Check one deployment's variables. `environmentName` is the wrangler environment
 * this deploy targeted: '' (or undefined) is the top level, which is production.
 *
 * Returns { errors, warnings }, both arrays of strings.
 */
export function checkDeploymentEnv(environmentName, values) {
  const errors = []
  const warnings = []
  const name = environmentName || ''
  const isProduction = name === ''

  if (!isProduction && name !== 'dev') {
    // A typo in the workflow would otherwise produce a green step that checked
    // nothing, which is worse than having no step at all.
    errors.push(
      `Unknown environment "${name}". This check knows about the top level (production) and "dev"; ` +
        `it has asserted NOTHING about this deployment.`,
    )
    return { errors, warnings }
  }

  const get = (key) => values[key] ?? null

  // SITE_URL — both environments. convex/auth.ts throws without it on every
  // request that builds auth, so a deployment missing it serves errors.
  if (!get('SITE_URL')) {
    errors.push('SITE_URL is not set. createAuth throws without it on every authenticated request.')
  }

  if (isProduction) {
    // E2E_TEST_MODE — wordle-teams-7az. ABSENT, not merely not-'true'. The gate in
    // convex/lib/e2e.ts keys on === 'true', so 'false' is harmless today; it is
    // still an error, because nothing should be setting this on production at all
    // and a value of 'false' means somebody tried.
    const e2e = get('E2E_TEST_MODE')
    if (e2e !== null) {
      errors.push(
        `E2E_TEST_MODE is set to "${e2e}" on production. It must be ABSENT. ` +
          `Set, it exposes an unauthenticated write path and silently suppresses ` +
          `sign-in and invite mail to e2e+*@wordleteams.com.`,
      )
    }

    const polar = get('POLAR_SERVER')
    if (polar === null || !POLAR_SERVERS.includes(polar)) {
      errors.push(
        `POLAR_SERVER is ${polar === null ? 'not set' : `"${polar}"`}; it must be ` +
          `"production" or "sandbox".`,
      )
    } else if (polar === 'sandbox') {
      // WARNING, NOT ERROR, AND THE DATE MATTERS. Measured 2026-09-28: the
      // prod-to-be deployment is on sandbox, which is correct while it is beta and
      // wrong the moment the domain flips. An error would fail every deploy
      // between now and cutover; a warning on every deploy is a standing reminder
      // that outlives whoever read the runbook.
      warnings.push(
        `POLAR_SERVER is "sandbox" on the deployment that becomes production. ` +
          `Correct while this is beta; FLIP IT TO "production" AT CUTOVER.`,
      )
    }

    // SWEEPS_ENABLED — an incident brake, so never an error. A brake pulled during
    // an incident must not block the deploy that fixes the incident. Unset is the
    // correct, silent state: unset means the sweeps run.
    if (get('SWEEPS_ENABLED') === 'false') {
      warnings.push(
        'SWEEPS_ENABLED is "false" on production: chatNotify.sweep and ' +
          'teamStats.sweep are NOT running. Intentional during an I/O incident; ' +
          'otherwise the team aggregates are going stale.',
      )
    }
    return { errors, warnings }
  }

  // --- dev -----------------------------------------------------------------
  const e2e = get('E2E_TEST_MODE')
  if (e2e !== 'true') {
    // Dev is the deployment that carries this flag openly, which is what lets
    // production be the one that never had it.
    errors.push(
      `E2E_TEST_MODE is ${e2e === null ? 'not set' : `"${e2e}"`} on dev; it must be "true".`,
    )
  }

  const polar = get('POLAR_SERVER')
  if (polar === 'production') {
    // THE ONLY POLAR STATE ON DEV THAT CAN COST REAL MONEY, and the reason this
    // check exists at all.
    errors.push('POLAR_SERVER is "production" on dev. Dev must never take real checkouts.')
  } else if (polar === null) {
    // Unset means Polar is unconfigured and billing degrades visibly. It is the
    // state dev is in until wordle-teams-qjh3.11 lands; failing the deploy for it
    // would invent an ordering constraint that does not exist.
    warnings.push('POLAR_SERVER is not set on dev, so billing is unconfigured (wordle-teams-qjh3.11).')
  }

  if (get('SWEEPS_ENABLED') !== 'false') {
    // Cost, not safety — dev draws on the same team-scoped free-tier meter as
    // production (wordle-teams-dcu).
    warnings.push(
      'SWEEPS_ENABLED is not "false" on dev, so the background sweeps are drawing ' +
        'on the same team-scoped Convex quota as production.',
    )
  }

  return { errors, warnings }
}
