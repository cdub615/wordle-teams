#!/usr/bin/env node
// DEV/sandbox verification for the Polar migration (wordle-teams-8sg).
//
// Covers the two things the offline suites deliberately could NOT verify, because both need a
// real Polar response:
//
//   1. The happy-path response mapping. A stubbed response cannot satisfy the SDK's zod schema
//      for a full Checkout or CustomerSession, so `checkout.url` and `session.customerPortalUrl`
//      were never asserted. Here they are, against the live sandbox API.
//   2. The portal's 404 branch against the REAL API. It was verified against a stubbed 404, but
//      nothing confirmed Polar actually returns 404 for a customer that does not exist. The whole
//      "you do not have a billing account yet" path depends on it.
//
// Read-only apart from creating checkout sessions, which are abandoned rather than paid and
// expire on their own. No app database is touched.
//
// Required env: POLAR_ACCESS_TOKEN, POLAR_PRO_MONTHLY_PRODUCT_ID, POLAR_PRO_ANNUAL_PRODUCT_ID
// Optional env: POLAR_SERVER (defaults to sandbox), POLAR_EXISTING_EXTERNAL_ID
import { Polar } from '@polar-sh/sdk'

const { POLAR_ACCESS_TOKEN, POLAR_PRO_MONTHLY_PRODUCT_ID, POLAR_PRO_ANNUAL_PRODUCT_ID } = process.env
const server = process.env.POLAR_SERVER ?? 'sandbox'

for (const [k, v] of Object.entries({
  POLAR_ACCESS_TOKEN,
  POLAR_PRO_MONTHLY_PRODUCT_ID,
  POLAR_PRO_ANNUAL_PRODUCT_ID,
})) {
  if (!v) {
    console.error(`Missing env ${k}`)
    process.exit(1)
  }
}

const polar = new Polar({ accessToken: POLAR_ACCESS_TOKEN, server })
const results = []
const pass = (m) => results.push(`PASS  ${m}`)
const fail = (m, d = '') => results.push(`FAIL  ${m}${d ? ' — ' + d : ''}`)
const check = (m, ok, d = '') => (ok ? pass(m) : fail(m, d))
const step = (m) => console.log(`\n▶ ${m}`)

// A player id that certainly has no Polar customer behind it.
const UNKNOWN_EXTERNAL_ID = `verify-${'0'.repeat(8)}-no-such-player`

try {
  step('Both Pro products resolve, and are the intervals we think they are')
  const monthly = await polar.products.get({ id: POLAR_PRO_MONTHLY_PRODUCT_ID })
  const annual = await polar.products.get({ id: POLAR_PRO_ANNUAL_PRODUCT_ID })
  console.log(`  monthly: ${monthly.name} (${monthly.recurringInterval})`)
  console.log(`  annual : ${annual.name} (${annual.recurringInterval})`)
  check('monthly product bills monthly', monthly.recurringInterval === 'month', String(monthly.recurringInterval))
  check('annual product bills yearly', annual.recurringInterval === 'year', String(annual.recurringInterval))
  check('the two products are distinct', monthly.id !== annual.id)
  check('neither product is archived', !monthly.isArchived && !annual.isArchived)

  step('Checkout returns a usable URL and offers BOTH products')
  const checkout = await polar.checkouts.create({
    products: [POLAR_PRO_ANNUAL_PRODUCT_ID, POLAR_PRO_MONTHLY_PRODUCT_ID],
    externalCustomerId: UNKNOWN_EXTERNAL_ID,
    // No customerEmail: Polar validates that the domain accepts mail, and reserved test
    // domains do not. The app always passes a real session email, so this is not a gap.
    customerName: 'Verify Script',
    successUrl: 'https://dev.wordleteams.com/me?checkout=success',
  })
  console.log(`  checkout url: ${checkout.url}`)
  check('checkout.url is a usable https URL', /^https:\/\//.test(checkout.url ?? ''), String(checkout.url))
  check(
    'the session carries both products so the customer can pick an interval',
    (checkout.products ?? []).length === 2,
    JSON.stringify((checkout.products ?? []).map((p) => p.recurringInterval))
  )
  check(
    'annual is first, so Polar presents it first',
    checkout.products?.[0]?.id === POLAR_PRO_ANNUAL_PRODUCT_ID,
    JSON.stringify(checkout.products?.map((p) => p.id))
  )
  check(
    'the external customer id round-trips',
    checkout.externalCustomerId === UNKNOWN_EXTERNAL_ID,
    String(checkout.externalCustomerId)
  )
  check('success_url points back at the app', (checkout.successUrl ?? '').includes('/me?checkout=success'))

  step('A scheme-less success_url is REJECTED — regression guard for the appOrigin bug')
  // VERCEL_URL is a Vercel system variable holding a bare hostname with no scheme. Building
  // success_url from it made every checkout on dev fail with "Failed to create checkout".
  // If this ever stops throwing, Polar has loosened validation and the guard is worthless.
  try {
    await polar.checkouts.create({
      products: [POLAR_PRO_ANNUAL_PRODUCT_ID],
      externalCustomerId: UNKNOWN_EXTERNAL_ID,
      successUrl: 'wordle-teams-deployment.vercel.app/me?checkout=success',
    })
    fail('Polar accepted a scheme-less success_url — this check no longer protects anything')
  } catch (error) {
    check('Polar rejects a success_url with no scheme', error?.statusCode === 422, `statusCode=${error?.statusCode}`)
  }

  step('The success_url we actually send is absolute')
  check(
    'checkout success_url starts with https://',
    /^https:\/\//.test(checkout.successUrl ?? ''),
    String(checkout.successUrl)
  )

  step('An unknown customer really does 404 — the no-customer branch depends on it')
  let status = null
  let errName = null
  let body = ''
  try {
    await polar.customerSessions.create({ externalCustomerId: UNKNOWN_EXTERNAL_ID })
    fail('expected a 404 for a customer that does not exist, got a session')
  } catch (error) {
    status = error?.statusCode ?? null
    errName = error?.constructor?.name ?? null
    body = String(error?.body ?? '')
    console.log(`  threw ${errName} with statusCode ${status}`)
    // Polar answers 422 with "Customer does not exist.", NOT 404. portal.ts matches on that
    // pair. Asserting the exact shape here so a future Polar change breaks this loudly rather
    // than silently reclassifying every non-subscriber as a generic failure.
    check(
      'a missing customer yields 422 (Polar does not send 404 here)',
      status === 422,
      `${errName} statusCode=${status}`
    )
    check(
      'the 422 detail says the customer does not exist, which is what portal.ts matches',
      /customer does not exist/i.test(body),
      body.slice(0, 160)
    )
  }

  if (process.env.POLAR_EXISTING_EXTERNAL_ID) {
    step('A real customer gets a portal URL')
    const session = await polar.customerSessions.create({
      externalCustomerId: process.env.POLAR_EXISTING_EXTERNAL_ID,
      returnUrl: 'https://dev.wordleteams.com/me',
    })
    check(
      'customerPortalUrl is a usable https URL',
      /^https:\/\//.test(session.customerPortalUrl ?? ''),
      String(session.customerPortalUrl)
    )
  } else {
    console.log('\n  (skipped the real-customer portal check — set POLAR_EXISTING_EXTERNAL_ID')
    console.log('   to a player id that has completed a sandbox checkout to exercise it)')
  }
} catch (error) {
  fail('script aborted', error?.message ?? String(error))
  console.error(error)
}

console.log('\n' + results.join('\n'))
const failures = results.filter((r) => r.startsWith('FAIL'))
console.log(failures.length ? `\nRESULT: ${failures.length} FAILURE(S)` : '\nRESULT: all passed')
process.exit(failures.length ? 1 : 0)
