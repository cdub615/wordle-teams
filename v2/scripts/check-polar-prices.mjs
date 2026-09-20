#!/usr/bin/env node
/**
 * DOES POLAR STILL CHARGE WHAT src/lib/plans.ts SAYS IT DOES?
 *
 * plans.ts holds the only price literals in this repo, and its banner argues
 * that departure from the "NO PRICE HERE" rule on the grounds that this script
 * backstops it. This is that script. If it does not run, that argument is
 * hollow and the prices are unguarded.
 *
 * IT READS POLAR, NOT A FIXTURE. The whole failure mode is someone editing a
 * price in Polar's dashboard — which is where prices are SUPPOSED to be
 * edited, and which changes nothing in this repo — so a test against a
 * committed snapshot would agree with itself forever.
 *
 * NOT A VITEST GATE, DELIBERATELY. CI holds no Polar credentials and the unit
 * suite must stay runnable offline; a gate that needs a secret is a gate that
 * fails for every contributor who does not have one. It runs on a schedule
 * instead — .github/workflows/check-prices.yml, weekly and on demand.
 *
 * EXIT CODES ARE THE INTERFACE: 0 agreement, 1 drift, 2 could not tell
 * (missing credentials, Polar unreachable, a response this does not
 * recognise). The third is not the second — a workflow that treats "could not
 * check" as "prices are wrong" gets muted, and a muted check is worse than
 * none. So EVERY way of failing to reach an answer exits 2, including the ones
 * that arrive as a thrown `fetch` rather than as a status code: an unhandled
 * rejection would exit 1 and be read as drift that is not there.
 *
 * NO DEPENDENCIES, NOT EVEN `@polar-sh/sdk`, WHICH THIS REPO ALREADY HAS.
 * `products.get` returns exactly the JSON read below — the field names here
 * were taken off the installed package's `Product` and `ProductPriceFixed`
 * types rather than from memory — but importing it puts `pnpm install` and a
 * lockfile-sized dependency tree in front of one GET. What the SDK does that a
 * bare fetch does not is send `Polar-Version`, and that is done by hand below,
 * from the same constant the app pins.
 *
 * WHAT IT DOES NOT COMPARE: the billing interval. plans.ts advertises
 * "$49.99/year", and a product whose `recurring_interval` changed under a
 * price that did not is drift this does not see. Swapped product ids DO show
 * up here, as both amounts disagreeing at once.
 */
import { readFileSync } from 'node:fs'

const TOKEN = process.env.POLAR_ACCESS_TOKEN
const ANNUAL = process.env.POLAR_PRO_ANNUAL_PRODUCT_ID
const MONTHLY = process.env.POLAR_PRO_MONTHLY_PRODUCT_ID

if (!TOKEN || !ANNUAL || !MONTHLY) {
  console.error('check-polar-prices: missing POLAR_ACCESS_TOKEN or a product id. Cannot check.')
  process.exit(2)
}

/**
 * Which Polar instance to ask.
 *
 * DEFAULTS TO PRODUCTION, WHICH IS THE OPPOSITE OF convex/polar.ts's
 * `polarServer` AND FOR THE SAME REASON. There, an unset or mistyped value must
 * not resolve to sandbox, because real subscribers would transact against an
 * instance holding none of their data. Here the stake is which prices get
 * checked, and the ones a customer actually pays are production's — so unset
 * means production and a typo is refused rather than quietly pointed at
 * sandbox, where a stale product would agree with plans.ts forever.
 *
 * The two instances are separate accounts with separate tokens and separate
 * product ids, so a sandbox run needs all four variables moved together.
 *
 * `||`, NOT `??`. GitHub Actions renders an unset `vars.POLAR_SERVER` as the
 * EMPTY STRING rather than leaving the variable out, and `??` would let that
 * through to the refusal below — so the default case would exit 2 on every
 * scheduled run, complaining about a value nobody set.
 */
function polarBaseUrl() {
  const server = process.env.POLAR_SERVER || 'production'
  if (server === 'production') return 'https://api.polar.sh'
  if (server === 'sandbox') return 'https://sandbox-api.polar.sh'

  console.error(
    `check-polar-prices: POLAR_SERVER must be 'production' or 'sandbox', not '${server}'. Cannot check.`,
  )
  process.exit(2)
}

/**
 * The API contract to ask for, read out of the constant the app already pins.
 *
 * AN UNVERSIONED REQUEST IS NOT A VERSIONLESS ONE. Polar resolves it to
 * whatever is Current, and Current moves at each quarterly release — so a
 * script that sent no header would silently start reading a different response
 * shape with no commit, no build failure and no test failure, which is the
 * exact class of bug this script exists to catch in prices. Copying the string
 * here instead would be a second source of truth for the version, which is
 * what convex/lib/polarVersion.ts's own banner exists to prevent.
 */
function polarApiVersion() {
  const source = readFileSync(new URL('../convex/lib/polarVersion.ts', import.meta.url), 'utf8')
  const match = source.match(/^export const POLAR_API_VERSION = '(\d{4}-\d{2})'$/m)
  if (!match) {
    console.error(
      'check-polar-prices: could not read POLAR_API_VERSION out of convex/lib/polarVersion.ts. Cannot check.',
    )
    process.exit(2)
  }
  return match[1]
}

/**
 * The literals, read out of the SOURCE rather than imported, IN CENTS.
 *
 * plans.ts is TypeScript and this is a plain node script run without a
 * bundler, exactly as scripts/build-splash-screens.mjs treats
 * src/lib/splash-screens.ts. A regex over two lines is the smaller dependency;
 * it fails loudly below if the shape changes.
 *
 * Cents because that is the unit Polar quotes and because it makes the
 * comparison integer equality. Dollars would work — `Number('49.99')` and
 * `4999 / 100` are the same double — but "the same double" is a fact about
 * this pair of values, not a property anyone should have to re-derive when the
 * price changes.
 */
function pricesFromSource() {
  const source = readFileSync(new URL('../src/lib/plans.ts', import.meta.url), 'utf8')
  const found = {}
  for (const [, id, price] of source.matchAll(
    /id:\s*'(annual|monthly)'[^}]*price:\s*'\$([\d.]+)'/g,
  )) {
    found[id] = Math.round(Number(price) * 100)
  }
  if (found.annual === undefined || found.monthly === undefined) {
    console.error('check-polar-prices: could not read both prices out of src/lib/plans.ts.')
    process.exit(2)
  }
  return found
}

const BASE_URL = polarBaseUrl()
const API_VERSION = polarApiVersion()

async function polarProduct(productId) {
  let res
  try {
    res = await fetch(`${BASE_URL}/v1/products/${productId}`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Polar-Version': API_VERSION,
      },
      // A hung connection must end as "could not tell" rather than as a job
      // that sits until the runner's own timeout kills it with no verdict.
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    console.error(
      `check-polar-prices: could not reach Polar for ${productId} — ${error instanceof Error ? error.message : String(error)}. Cannot check.`,
    )
    process.exit(2)
  }

  if (!res.ok) {
    console.error(`check-polar-prices: Polar answered ${res.status} for ${productId}. Cannot check.`)
    process.exit(2)
  }

  try {
    return await res.json()
  } catch {
    console.error(`check-polar-prices: Polar's answer for ${productId} was not JSON. Cannot check.`)
    process.exit(2)
  }
}

/**
 * What Polar charges for one product, as cents and a currency.
 *
 * ONE ACTIVE PRICE, AND IT HAS TO BE A FIXED AMOUNT. Polar's `prices` array
 * also carries pay-what-you-want, seat-based, unit-based and metered shapes,
 * and NONE of those has a `price_amount` at all. Reading one blind yields
 * `undefined / 100`, which is `NaN`, which is unequal to everything — so the
 * script would report confident drift against a number it never had. That is a
 * response this cannot interpret, so it is a 2.
 */
function livePrice(productId, product) {
  const prices = (product?.prices ?? []).filter((price) => !price.is_archived)
  if (prices.length !== 1) {
    console.error(
      `check-polar-prices: ${productId} has ${prices.length} active prices; expected exactly 1. Cannot check.`,
    )
    process.exit(2)
  }

  const [price] = prices
  if (price.amount_type !== 'fixed' || !Number.isFinite(price.price_amount)) {
    console.error(
      `check-polar-prices: ${productId}'s active price is '${price.amount_type}', not a fixed amount this can compare. Cannot check.`,
    )
    process.exit(2)
  }

  return { cents: price.price_amount, currency: String(price.price_currency).toLowerCase() }
}

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`

const source = pricesFromSource()
const live = {
  annual: livePrice(ANNUAL, await polarProduct(ANNUAL)),
  monthly: livePrice(MONTHLY, await polarProduct(MONTHLY)),
}

// The currency is part of the claim. plans.ts writes a dollar sign, so a
// product repriced into another currency is a customer charged something the
// site never said, even when the digits happen to match.
const drifted = ['annual', 'monthly'].filter(
  (id) => source[id] !== live[id].cents || live[id].currency !== 'usd',
)

if (drifted.length === 0) {
  console.log(
    `check-polar-prices: OK — annual ${dollars(live.annual.cents)}, monthly ${dollars(live.monthly.cents)}.`,
  )
  process.exit(0)
}

for (const id of drifted) {
  console.error(
    `check-polar-prices: DRIFT on ${id} — src/lib/plans.ts says ${dollars(source[id])}, Polar charges ${dollars(live[id].cents)} ${live[id].currency.toUpperCase()}.`,
  )
}
console.error(
  'The customer sees Polar. Fix src/lib/plans.ts, or fix Polar, but do not leave them disagreeing.',
)
process.exit(1)
