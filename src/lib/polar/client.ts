import 'server-only'

import { canonicalOrigin } from '@/lib/app-origin'
import { Polar } from '@polar-sh/sdk'

// Single source of truth for the Polar SDK client and the environment variables it needs.
// See docs/superpowers/specs/2026-07-31-polar-migration-design.md.
//
// Polar's sandbox is a completely separate instance from production — its own accounts,
// organizations, products, and tokens. A production token will not authenticate against
// sandbox or vice versa, so the server and the credentials always have to move together.
// The mapping mirrors the ENVIRONMENT ternary the Lemon Squeezy module used before it:
// only 'prod' is live, and everything else (dev and local) points at sandbox.

const REQUIRED_ENV_VARS = [
  'POLAR_ACCESS_TOKEN',
  'POLAR_WEBHOOK_SECRET',
  'POLAR_PRO_MONTHLY_PRODUCT_ID',
  'POLAR_PRO_ANNUAL_PRODUCT_ID',
] as const

export function polarServer(): 'production' | 'sandbox' {
  return process.env.ENVIRONMENT === 'prod' ? 'production' : 'sandbox'
}

// Validates all three variables together rather than one per call site, so a partially
// configured environment fails loudly and identically everywhere instead of only on the
// first code path that happens to need the missing one.
function assertPolarEnv() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name])

  if (missing.length > 0) {
    throw new Error(`Missing required POLAR env variables: ${missing.join(', ')}. Please set them in your .env file.`)
  }
}

// Instantiated lazily and memoized rather than built at module scope: a module-scope client
// would construct during `next build`, where these variables are not necessarily present, and
// turn a missing env var into a failed build instead of a failed request. Memoizing is safe
// because the client is stateless config, and it lets warm function instances reuse it.
let client: Polar | undefined

export function polar(): Polar {
  assertPolarEnv()

  client ??= new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    server: polarServer(),
  })

  return client
}

// Polar has no variants — each product carries a single pricing model and its billing cycle is
// locked at creation — so Pro monthly and Pro annual are two separate products. A checkout
// session takes both and renders them side by side on Polar's hosted page, in the order passed,
// which is why the customer never picks an interval inside this app.
//
// Annual is first so it is presented first.
export function proProductIds(): string[] {
  assertPolarEnv()
  return [process.env.POLAR_PRO_ANNUAL_PRODUCT_ID!, process.env.POLAR_PRO_MONTHLY_PRODUCT_ID!]
}

// Canonical origin for URLs Polar redirects back to.
//
// The reasoning that made this stop using VERCEL_URL — and the second production bug that the
// same mistake caused in the email auth links — now lives with the shared implementation in
// src/lib/app-origin.ts. Kept as a named re-export so Polar call sites still read as Polar code.
export const appOrigin = canonicalOrigin

export function polarWebhookSecret(): string {
  assertPolarEnv()
  return process.env.POLAR_WEBHOOK_SECRET!
}
