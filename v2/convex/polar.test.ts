import { readFileSync } from 'node:fs'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import {
  assertPolarEnv,
  classifyPortalError,
  externalIdsFor,
  lookupPortal,
  polarEnvProblem,
  polarServer,
  proProductIds,
} from './polar.ts'
import type { PortalAttemptResult } from './polar.ts'

const modules = import.meta.glob('./**/*.ts')

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

/**
 * THE DEFECT wordle-teams-9fm WAS ABOUT: a Polar misconfiguration and a Polar
 * outage produced the same toast, so "please try again" was shown for the one
 * failure retrying can never fix. These pin the distinction at both ends of it —
 * the check that runs before any network call, and the classifier that runs on
 * what the network gave back.
 */
describe('polarEnvProblem', () => {
  test('is null when the deployment is fully configured', () => {
    setEnv(ALL_SET)
    expect(polarEnvProblem()).toBeNull()
  })

  // The SAME message assertPolarEnv throws, because it IS that message: a
  // second wording would be a second thing to keep true.
  test('names every missing variable', () => {
    setEnv({})
    expect(polarEnvProblem()).toBe('Missing required POLAR env variables: ' + REQUIRED.join(', '))
  })

  // THE CASE assertPolarEnv ALONE CANNOT SEE. All five are present, so the
  // variable check passes; the value is still nonsense, and sandbox and
  // production are separate Polar instances.
  test('catches a POLAR_SERVER that is set but wrong, and quotes it', () => {
    setEnv({ ...ALL_SET, POLAR_SERVER: 'prod' })
    expect(polarEnvProblem()).toBe("POLAR_SERVER must be 'production' or 'sandbox', not 'prod'")
  })

  // The two problems are separate facts and must not be reported as one.
  test('a missing variable and a bad server read differently', () => {
    setEnv({})
    const missing = polarEnvProblem()
    setEnv({ ...ALL_SET, POLAR_SERVER: 'prod' })
    expect(polarEnvProblem()).not.toBe(missing)
  })

  // IT ANSWERS RATHER THAN THROWING, which is the whole point: the actions call
  // it OUTSIDE their try, so nothing about the environment can arrive in a catch
  // written for Polar's HTTP errors and come out as a generic failure.
  test('never throws, whatever is set', () => {
    setEnv({})
    expect(() => polarEnvProblem()).not.toThrow()
    setEnv({ ...ALL_SET, POLAR_SERVER: '' })
    expect(() => polarEnvProblem()).not.toThrow()
  })
})

describe('classifyPortalError', () => {
  // Polar answers an unknown external_customer_id with 422 plus this detail —
  // see isMissingCustomer, which was three attempts in v1. Not a failure.
  test('a 422 naming a missing customer is no-customer', () => {
    expect(
      classifyPortalError({ statusCode: 422, body: '{"detail":"Customer does not exist."}' }),
    ).toBe('no-customer')
  })

  // A REJECTED CREDENTIAL IS A DEPLOYMENT FACT, not an outage: a sandbox token
  // against POLAR_SERVER=production, a revoked token, a token with the wrong
  // scopes. None of them clears by waiting, so none may be told to try again.
  test.each([401, 403])('a %i is not-configured', (statusCode) => {
    expect(classifyPortalError({ statusCode })).toBe('not-configured')
  })

  // AND EVERYTHING ELSE STAYS RETRYABLE, which is what keeps the retry sentence
  // honest where it survives. A bare 422 is here deliberately: Polar sends one
  // for ordinary validation failures too, and only the detail tells them apart.
  test.each<[string, unknown]>([
    ['a 500', { statusCode: 500 }],
    ['a 429', { statusCode: 429 }],
    ['a 422 with no matching detail', { statusCode: 422, body: '{"detail":"bad success_url"}' }],
    ['a network error with no status', new Error('fetch failed')],
    ['a thrown string', 'nope'],
    ['null', null],
  ])('%s is an operational error', (_label, error) => {
    expect(classifyPortalError(error)).toBe('error')
  })
})

/**
 * THE CLASSIFICATION END TO END, through the actions themselves.
 *
 * WORTH THE HARNESS BECAUSE THE HOIST IS THE FIX. `polarEnvProblem` being
 * correct proves nothing if the handler still asks it from inside the try — and
 * that placement is exactly what the bug was. Reaching `not-configured` here
 * with no authentication and no network proves the check runs FIRST: an
 * unconfigured deployment answers before `checkoutIdentity` is ever run, so
 * there is nothing left for a catch to swallow.
 *
 * NO SESSION IS NEEDED AND NONE COULD BE MADE — convex-test cannot stand up a
 * Better Auth session (wordle-teams-obw). That limits this to the branch that
 * returns before any identity lookup, which is the branch under test.
 */
describe('the misconfigured deployment, through the actions', () => {
  // The actions log the operator's detail; the harness prints it as a failure
  // otherwise, and the CONTENT of that log is asserted below rather than in the
  // noise of the run.
  let logged: unknown[][]

  beforeEach(() => {
    logged = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * The two ways a deployment can be misconfigured before it ever reaches
   * Polar, each with the operator detail that must survive into the log. They
   * are ONE user-facing outcome and TWO distinct server-side facts, which is the
   * split the whole fix is: the player is told the same true thing either way,
   * and the owner is told which of the two it is.
   */
  const MISCONFIGURED: Array<{ label: string; env: Record<string, string>; log: RegExp }> = [
    // Not anchored: each action prefixes the detail with what it was trying to
    // do, which is the half of the log line that says WHICH click failed.
    { label: 'a missing variable', env: {}, log: /Missing required POLAR env variables: POLAR_/ },
    {
      label: 'a POLAR_SERVER that is neither instance',
      env: { ...ALL_SET, POLAR_SERVER: 'prod' },
      log: /POLAR_SERVER must be 'production' or 'sandbox', not 'prod'/,
    },
  ]

  test.each(MISCONFIGURED)('the portal reports not-configured for $label', async ({ env, log }) => {
    setEnv(env)
    const t = convexTest(schema, modules)

    expect(await t.action(api.polar.getCustomerPortalUrl, {})).toEqual({
      url: null,
      reason: 'not-configured',
    })

    // THE OWNER'S ONLY DIAGNOSTIC. The reason returned is bare on purpose, so
    // the log is the only place the cause exists — losing it would trade one
    // undiagnosable failure for another.
    expect(logged.map((args) => args.join(' ')).join('\n')).toMatch(log)
  })

  test.each(MISCONFIGURED)(
    'the checkout reports not-configured for $label',
    async ({ env, log }) => {
      setEnv(env)
      const t = convexTest(schema, modules)

      expect(await t.action(api.polar.createProCheckout, {})).toEqual({
        url: null,
        reason: 'not-configured',
      })
      expect(logged.map((args) => args.join(' ')).join('\n')).toMatch(log)
    },
  )

  // WHAT MUST NEVER BE TRUE AGAIN. Before wordle-teams-9fm both of these
  // answered exactly what a Polar outage answers, and the UI could only offer
  // the retry that was guaranteed to fail.
  test('and it is not what an outage answers', async () => {
    setEnv({})
    const t = convexTest(schema, modules)

    expect(await t.action(api.polar.getCustomerPortalUrl, {})).not.toEqual({
      url: null,
      reason: 'error',
    })
    expect(await t.action(api.polar.createProCheckout, {})).not.toEqual({
      url: null,
      reason: 'error',
    })
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

describe('the URLs Polar returns the browser to', () => {
  // NEITHER HAD COVERAGE OF ANY KIND. Both are interpolated from SITE_URL at
  // call time inside an SDK call that no test drives, so changing either to
  // `/` was green on lint, typecheck, `vitest run` and build — and the Task 13
  // sandbox pass is the only thing that would ever have exercised them. They
  // are read as source, the pattern src/lib/sw-push.test.ts uses for the push
  // payload, because that literal is the artefact that ships.
  //
  // successUrl's other half is pinned from the consuming side, in
  // src/lib/checkout-return.test.ts, against that module's CHECKOUT_PARAM.
  const source = readFileSync(new URL('./polar.ts', import.meta.url), 'utf8')

  /**
   * The rest of the line the named URL is built on — `successUrl:` is a
   * property, `returnUrl =` a local, hence the two-character class. Bounded to
   * that one line, so a later, unrelated occurrence of the same path cannot
   * satisfy the assertion.
   */
  const urlLine = (name: string) => {
    const line = source.match(new RegExp(`\\b${name}\\s*[:=][^\\n]*`))
    expect(line, `${name} not found in convex/polar.ts`).not.toBeNull()
    return line![0]
  }

  test('checkout comes back to the dashboard, carrying its marker', () => {
    expect(urlLine('successUrl')).toContain('/app?checkout=success')
  })

  test('the customer portal comes back to the dashboard', () => {
    // `/app`, not the bare origin. Phase 7 Task 1 moved the dashboard off `/`
    // and gave `/` back to the marketing landing, so a player leaving the
    // portal would otherwise be dropped on a sales page.
    expect(urlLine('returnUrl')).toContain('/app')
    expect(urlLine('returnUrl')).toMatch(/\$\{siteUrl\(\)\}\/app`/)
  })
})
