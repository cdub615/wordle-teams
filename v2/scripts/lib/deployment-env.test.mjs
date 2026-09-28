import { describe, expect, test } from 'vitest'
import { checkDeploymentEnv, parseEnvGet } from './deployment-env.mjs'

// The post-deploy assertion on a Convex deployment's environment variables
// (wordle-teams-qjh3.7). Pure decision logic here; scripts/check-deployment-env.mjs
// is the shell around it that actually shells out to `convex env get`.

describe('parseEnvGet — matching TEXT, never an exit code', () => {
  // THE RULE THIS FILE EXISTS FOR. docs/runbooks/2026-cutover.md section 0:
  // `convex env get` exits 0 whether or not the variable exists. Any check whose
  // evidence is an exit status is not evidence. Both strings below are verbatim
  // CLI output captured on 2026-09-28.
  test('a missing variable reads as absent, despite a zero exit', () => {
    expect(
      parseEnvGet(
        '✖ Environment variable "E2E_TEST_MODE" not found (on prod deployment fabulous-goldfish-949)',
      ),
    ).toBeNull()
  })

  test('a present variable reads as its value', () => {
    expect(parseEnvGet('https://dev.wordleteams.com')).toBe('https://dev.wordleteams.com')
    expect(parseEnvGet('true')).toBe('true')
  })

  test('surrounding whitespace is not part of the value', () => {
    expect(parseEnvGet('  false \n')).toBe('false')
  })

  test('empty output reads as absent rather than as an empty value', () => {
    expect(parseEnvGet('')).toBeNull()
    expect(parseEnvGet('   ')).toBeNull()
  })
})

/** Convenience: just the messages, so assertions read as prose. */
const errorsOf = (env, values) => checkDeploymentEnv(env, values).errors.join(' | ')
const warningsOf = (env, values) => checkDeploymentEnv(env, values).warnings.join(' | ')

const PROD_OK = { SITE_URL: 'https://beta.wordleteams.com', POLAR_SERVER: 'production' }
const DEV_OK = {
  SITE_URL: 'https://dev.wordleteams.com',
  E2E_TEST_MODE: 'true',
  POLAR_SERVER: 'sandbox',
  SWEEPS_ENABLED: 'false',
}

describe('production', () => {
  test('a correct deployment raises nothing', () => {
    expect(checkDeploymentEnv('', PROD_OK)).toEqual({ errors: [], warnings: [] })
  })

  test('E2E_TEST_MODE present at all is an ERROR', () => {
    // wordle-teams-7az. With it set, anyone reaching the deployment can mint an
    // OTP for any e2e+*@wordleteams.com address — and isE2eTraffic silently
    // suppresses sign-in codes and team invites to that domain, with no error
    // raised anywhere.
    expect(errorsOf('', { ...PROD_OK, E2E_TEST_MODE: 'true' })).toMatch(/E2E_TEST_MODE/)
  })

  test('E2E_TEST_MODE set to something OTHER than true is still an error', () => {
    // The gate in convex/lib/e2e.ts keys on === 'true', so 'false' is harmless
    // today. It is still an error here: nothing should be setting this variable
    // on production at all, and a value of 'false' means someone tried.
    expect(errorsOf('', { ...PROD_OK, E2E_TEST_MODE: 'false' })).toMatch(/E2E_TEST_MODE/)
  })

  test('POLAR_SERVER on sandbox is a WARNING, not an error', () => {
    // MEASURED 2026-09-28: the prod-to-be deployment is on 'sandbox' today, which
    // is right while it is beta and wrong the moment the domain flips. An error
    // would fail every deploy between now and cutover; a warning on every deploy
    // is a standing reminder that survives until someone flips it.
    expect(errorsOf('', { ...PROD_OK, POLAR_SERVER: 'sandbox' })).toBe('')
    expect(warningsOf('', { ...PROD_OK, POLAR_SERVER: 'sandbox' })).toMatch(/POLAR_SERVER/)
  })

  test('POLAR_SERVER unset or nonsense is an error', () => {
    expect(errorsOf('', { SITE_URL: PROD_OK.SITE_URL })).toMatch(/POLAR_SERVER/)
    expect(errorsOf('', { ...PROD_OK, POLAR_SERVER: 'prod' })).toMatch(/POLAR_SERVER/)
  })

  test('SWEEPS_ENABLED=false is a WARNING and never an error', () => {
    // It is an incident brake. A brake pulled during an incident must not block
    // the deploy that fixes the incident.
    expect(errorsOf('', { ...PROD_OK, SWEEPS_ENABLED: 'false' })).toBe('')
    expect(warningsOf('', { ...PROD_OK, SWEEPS_ENABLED: 'false' })).toMatch(/SWEEPS_ENABLED/)
  })

  test('SWEEPS_ENABLED unset is correct and silent, because unset means ON', () => {
    expect(checkDeploymentEnv('', PROD_OK)).toEqual({ errors: [], warnings: [] })
  })

  test('a missing SITE_URL is an error', () => {
    // convex/auth.ts throws without it on every request that builds auth.
    expect(errorsOf('', { POLAR_SERVER: 'production' })).toMatch(/SITE_URL/)
  })
})

describe('dev', () => {
  test('a correct deployment raises nothing', () => {
    expect(checkDeploymentEnv('dev', DEV_OK)).toEqual({ errors: [], warnings: [] })
  })

  test('E2E_TEST_MODE must be true, because dev is the deployment that carries it openly', () => {
    expect(errorsOf('dev', { ...DEV_OK, E2E_TEST_MODE: undefined })).toMatch(/E2E_TEST_MODE/)
    expect(errorsOf('dev', { ...DEV_OK, E2E_TEST_MODE: 'false' })).toMatch(/E2E_TEST_MODE/)
  })

  test('POLAR_SERVER=production on dev is an ERROR — the actual hazard', () => {
    // A dev environment taking REAL checkouts is the thing qjh3.11 exists to
    // prevent. This is the only Polar state on dev that can cost real money.
    expect(errorsOf('dev', { ...DEV_OK, POLAR_SERVER: 'production' })).toMatch(/POLAR_SERVER/)
  })

  test('POLAR_SERVER unset on dev is a WARNING, not an error', () => {
    // Unset means Polar is simply unconfigured and billing degrades visibly. It
    // is the state dev is in until qjh3.11 lands, and failing the deploy for it
    // would invent an ordering constraint that does not exist.
    expect(errorsOf('dev', { ...DEV_OK, POLAR_SERVER: undefined })).toBe('')
    expect(warningsOf('dev', { ...DEV_OK, POLAR_SERVER: undefined })).toMatch(/POLAR_SERVER/)
  })

  test('SWEEPS_ENABLED not being false on dev is a warning about cost, not safety', () => {
    expect(errorsOf('dev', { ...DEV_OK, SWEEPS_ENABLED: undefined })).toBe('')
    expect(warningsOf('dev', { ...DEV_OK, SWEEPS_ENABLED: undefined })).toMatch(/SWEEPS_ENABLED/)
  })

  test('a missing SITE_URL is an error on dev too', () => {
    expect(errorsOf('dev', { ...DEV_OK, SITE_URL: undefined })).toMatch(/SITE_URL/)
  })
})

describe('an unknown environment name', () => {
  test('is an error rather than silently checking nothing', () => {
    // A typo in the workflow would otherwise produce a green step that asserted
    // nothing at all, which is worse than having no step.
    expect(errorsOf('stagng', DEV_OK)).toMatch(/stagng/)
  })
})
