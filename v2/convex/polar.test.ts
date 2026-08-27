import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  assertPolarEnv,
  externalIdsFor,
  lookupPortal,
  polarServer,
  proProductIds,
} from './polar.ts'
import type { PortalAttemptResult } from './polar.ts'

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
 * contract, the product ordering, and the portal's two-namespace lookup — which
 * identities are tried, in what order, and when the walk stops. That last one
 * is not a stub-and-assert-called test in disguise: `lookupPortal` takes the
 * attempt as a parameter, so the tests below drive REAL sequencing logic and
 * assert on its answers, and would fail against a wrong order, a wrong stopping
 * rule, or a wrong report of which identity won. The `attempt` they pass is the
 * boundary, not the thing under test.
 *
 * The other genuinely-logic piece, telling "no billing account" apart from a
 * real failure, lives in `lib/polarErrors.test.ts` — it was extracted precisely
 * so it could be tested without constructing a Polar client.
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

// A Convex player id and a v1 Supabase uuid. The two namespaces decision F is
// about; see billing.ts's resolvePlayerIdFor for the inbound half.
const PLAYER_ID = 'k57abc123def456'
const LEGACY_ID = '3f8a1c2e-9b4d-4e7a-8c1f-2d3e4b5a6c7d'

describe('externalIdsFor', () => {
  // THE BUG THIS EXISTS FOR (wordle-teams-1m6). A migrated subscriber's Polar
  // customer carries their v1 uuid, so asking only by Convex id answers
  // "Customer does not exist." and the portal tells a PAYING SUBSCRIBER they
  // have no billing account.
  test('tries the Convex id first, then the v1 uuid', () => {
    expect(externalIdsFor({ playerId: PLAYER_ID, legacyId: LEGACY_ID })).toEqual([
      PLAYER_ID,
      LEGACY_ID,
    ])
  })

  // AND THE POINT OF THE ORDER: everything this v2 creates is stamped with the
  // Convex id, so the common case must not pay for the migration.
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['absent', undefined],
  ])('a v2-native player (legacyId %s) makes only one call', (_label, legacyId) => {
    expect(externalIdsFor({ playerId: PLAYER_ID, legacyId })).toEqual([PLAYER_ID])
  })

  // legacyId is v.optional(v.string()), so '' is storable, and a candidate that
  // can name nobody buys a wasted round trip and an ambiguous log line.
  test('drops an empty legacy id rather than asking about it', () => {
    expect(externalIdsFor({ playerId: PLAYER_ID, legacyId: '' })).toEqual([PLAYER_ID])
  })

  test('never asks the same question twice', () => {
    expect(externalIdsFor({ playerId: PLAYER_ID, legacyId: PLAYER_ID })).toEqual([PLAYER_ID])
  })
})

describe('lookupPortal', () => {
  /** Records what was asked, and answers from a script. */
  const scripted = (answers: Record<string, PortalAttemptResult>) => {
    const asked: string[] = []
    const attempt = async (externalId: string): Promise<PortalAttemptResult> => {
      asked.push(externalId)
      return answers[externalId] ?? { url: null, reason: 'no-customer' }
    }
    return { asked, attempt }
  }

  const session = (customerId: string) => ({ url: 'https://polar.sh/portal/x', customerId })

  test('stops at the first identity that resolves, and asks no more', async () => {
    const { asked, attempt } = scripted({ [PLAYER_ID]: session('cus_1') })

    const lookup = await lookupPortal([PLAYER_ID, LEGACY_ID], attempt)

    expect(lookup).toEqual({
      found: true,
      url: 'https://polar.sh/portal/x',
      customerId: 'cus_1',
      externalId: PLAYER_ID,
    })
    expect(asked).toEqual([PLAYER_ID])
  })

  // THE MIGRATED SUBSCRIBER. The winning externalId is reported because it is
  // the entire input to the repair decision: it differs from the Convex id, so
  // the caller schedules repairCustomerExternalId with the customer id found
  // here, and the next visit takes the fast path.
  test('falls through to the v1 uuid and reports which identity won', async () => {
    const { asked, attempt } = scripted({ [LEGACY_ID]: session('cus_migrated') })

    const lookup = await lookupPortal([PLAYER_ID, LEGACY_ID], attempt)

    expect(lookup).toEqual({
      found: true,
      url: 'https://polar.sh/portal/x',
      customerId: 'cus_migrated',
      externalId: LEGACY_ID,
    })
    expect(asked).toEqual([PLAYER_ID, LEGACY_ID])
  })

  // THE ANSWER THAT MUST SURVIVE THE FALLBACK. A genuinely new subscriber is
  // most of the callers, and telling them plainly is the whole reason
  // no-customer is distinct from error.
  test('every identity exhausted is still no-customer, not an error', async () => {
    const { asked, attempt } = scripted({})

    const lookup = await lookupPortal([PLAYER_ID, LEGACY_ID], attempt)

    expect(lookup).toEqual({ found: false, result: { url: null, reason: 'no-customer' } })
    expect(asked).toEqual([PLAYER_ID, LEGACY_ID])
  })

  // THE WORST WAY TO GET THIS WRONG, and it would hit everyone rather than only
  // migrated users: treating a real failure as "try the next name" turns an
  // outage into "you have no subscription" for a paying customer.
  test('a real error stops the walk and stays an error', async () => {
    const { asked, attempt } = scripted({
      [PLAYER_ID]: { url: null, reason: 'error' },
      [LEGACY_ID]: session('cus_migrated'),
    })

    const lookup = await lookupPortal([PLAYER_ID, LEGACY_ID], attempt)

    expect(lookup).toEqual({ found: false, result: { url: null, reason: 'error' } })
    expect(asked).toEqual([PLAYER_ID])
  })

  test('no candidates at all is no-customer, and asks nothing', async () => {
    const { asked, attempt } = scripted({})

    expect(await lookupPortal([], attempt)).toEqual({
      found: false,
      result: { url: null, reason: 'no-customer' },
    })
    expect(asked).toEqual([])
  })
})
