import 'server-only'

import { Polar } from '@polar-sh/sdk'

// Single source of truth for the Polar SDK client and the environment variables it needs.
// See docs/superpowers/specs/2026-07-31-polar-migration-design.md.
//
// Polar's sandbox is a completely separate instance from production — its own accounts,
// organizations, products, and tokens. A production token will not authenticate against
// sandbox or vice versa, so the server and the credentials always have to move together.
// The mapping mirrors the ENVIRONMENT ternary the Lemon Squeezy module used before it:
// only 'prod' is live, and everything else (dev and local) points at sandbox.

const REQUIRED_ENV_VARS = ['POLAR_ACCESS_TOKEN', 'POLAR_WEBHOOK_SECRET', 'POLAR_PRO_PRODUCT_ID'] as const

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

export function proProductId(): string {
  assertPolarEnv()
  return process.env.POLAR_PRO_PRODUCT_ID!
}

export function polarWebhookSecret(): string {
  assertPolarEnv()
  return process.env.POLAR_WEBHOOK_SECRET!
}
