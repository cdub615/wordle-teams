import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { assertPolarEnv, polarServer, proProductIds } from './polar.ts'

/**
 * WHAT THIS FILE CAN AND CANNOT COVER.
 *
 * `convex/polar.ts` is the phase's transport layer, so most of it is one SDK
 * call wrapped in a try/catch. A test that stubbed `@polar-sh/sdk` and then
 * asserted the stub had been called would prove only that the test knows what
 * the file says — it would pass just as happily against a checkout with the
 * wrong products, and it would go on passing if Polar changed the shape it
 * returns. Those paths are covered by the sandbox pass in Task 13
 * (wordle-teams-02c) instead, which is what decision C is for.
 *
 * So what is here is the part that is genuinely logic: the environment
 * contract, and the product ordering. The other genuinely-logic piece, telling
 * "no billing account" apart from a real failure, lives in
 * `lib/polarErrors.test.ts` — it was extracted precisely so it could be tested
 * without constructing a Polar client.
 *
 * `checkoutIdentity` is NOT covered: it resolves the caller through
 * `currentPlayer`, and convex-test cannot stand up a Better Auth session
 * (wordle-teams-obw). It is four lines with no branch worth proving for exactly
 * that reason.
 */

// Named here rather than imported so this list is an INDEPENDENT statement of
// the contract. Importing the module's own array would let a variable be
// dropped from the deployment checklist and from the test in one edit.
const REQUIRED = [
  'POLAR_ACCESS_TOKEN',
  'POLAR_WEBHOOK_SECRET',
  'POLAR_SERVER',
  'POLAR_PRO_MONTHLY_PRODUCT_ID',
  'POLAR_PRO_ANNUAL_PRODUCT_ID',
]

const ALL_SET: Record<string, string> = {
  POLAR_ACCESS_TOKEN: 'polar_oat_test',
  POLAR_WEBHOOK_SECRET: 'whsec_test',
  POLAR_SERVER: 'sandbox',
  POLAR_PRO_MONTHLY_PRODUCT_ID: 'prod_monthly',
  POLAR_PRO_ANNUAL_PRODUCT_ID: 'prod_annual',
}

const saved: Record<string, string | undefined> = {}

/** Leaves exactly `present` set and every other required variable absent. */
const setEnv = (present: Record<string, string>) => {
  for (const name of REQUIRED) delete process.env[name]
  for (const [name, value] of Object.entries(present)) process.env[name] = value
}

beforeEach(() => {
  for (const name of REQUIRED) saved[name] = process.env[name]
})

afterEach(() => {
  for (const name of REQUIRED) {
    const value = saved[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('assertPolarEnv', () => {
  // THE POINT OF VALIDATING THE SET RATHER THAN ONE VARIABLE PER CALL SITE: an
  // operator sees everything they still have to set, in one message, from
  // whichever Polar path they happened to touch first.
  test('names every missing variable when none is set', () => {
    setEnv({})
    expect(() => assertPolarEnv()).toThrow(
      'Missing required POLAR env variables: ' + REQUIRED.join(', '),
    )
  })

  test('names exactly the missing ones when the set is partial', () => {
    setEnv({
      POLAR_ACCESS_TOKEN: ALL_SET.POLAR_ACCESS_TOKEN,
      POLAR_SERVER: ALL_SET.POLAR_SERVER,
      POLAR_PRO_ANNUAL_PRODUCT_ID: ALL_SET.POLAR_PRO_ANNUAL_PRODUCT_ID,
    })
    expect(() => assertPolarEnv()).toThrow(
      'Missing required POLAR env variables: POLAR_WEBHOOK_SECRET, POLAR_PRO_MONTHLY_PRODUCT_ID',
    )
  })

  // The webhook secret is checked although this module never reads it: a
  // deployment that can create a checkout but cannot verify the webhook it
  // produces is misconfigured, and the first Polar call is a cheaper place to
  // learn that than the first delivery.
  test('the webhook secret alone is enough to fail', () => {
    setEnv({ ...ALL_SET, POLAR_WEBHOOK_SECRET: '' })
    expect(() => assertPolarEnv()).toThrow(
      'Missing required POLAR env variables: POLAR_WEBHOOK_SECRET',
    )
  })

  test('passes when all five are set', () => {
    setEnv(ALL_SET)
    expect(() => assertPolarEnv()).not.toThrow()
  })
})

describe('polarServer', () => {
  test.each(['sandbox', 'production'] as const)('accepts %s', (server) => {
    setEnv({ ...ALL_SET, POLAR_SERVER: server })
    expect(polarServer()).toBe(server)
  })

  // SANDBOX AND PRODUCTION ARE SEPARATE POLAR INSTANCES with separate accounts,
  // products and tokens, so a value that is neither must stop rather than pick
  // one. v1's ternary defaulted anything unrecognised to sandbox, which would
  // send real subscribers to an instance holding none of their data.
  test.each(['prod', 'Production', 'live', ''])('refuses %o', (server) => {
    setEnv({ ...ALL_SET, POLAR_SERVER: server })
    expect(() => polarServer()).toThrow("POLAR_SERVER must be 'production' or 'sandbox'")
  })

  test('refuses an unset value', () => {
    setEnv({})
    expect(() => polarServer()).toThrow("POLAR_SERVER must be 'production' or 'sandbox'")
  })
})

describe('proProductIds', () => {
  // ANNUAL FIRST, BECAUSE POLAR RENDERS A MULTI-PRODUCT CHECKOUT IN THE ORDER
  // PASSED. This is the whole reason no caller picks an interval, and it is a
  // product decision that reads like an implementation detail — exactly the
  // sort of line a later edit would reorder without noticing.
  test('puts annual before monthly', () => {
    setEnv(ALL_SET)
    expect(proProductIds()).toEqual(['prod_annual', 'prod_monthly'])
  })

  test('fails with the same message as the rest of the module', () => {
    setEnv({ POLAR_PRO_ANNUAL_PRODUCT_ID: ALL_SET.POLAR_PRO_ANNUAL_PRODUCT_ID })
    expect(() => proProductIds()).toThrow(/^Missing required POLAR env variables: /)
  })
})
