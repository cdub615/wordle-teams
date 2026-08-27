/**
 * Tells "this player has no Polar billing account" apart from a real failure.
 *
 * wt-ksh.6 / wordle-teams-l1v. Ported from v1's `src/lib/polar/portal.ts:44-62`.
 * See docs/superpowers/specs/2026-08-26-v2-phase5-polar-design.md, decision I.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex, no network,
 * no env, no I/O. Here that extends to `@polar-sh/sdk` itself, which is what
 * makes this the one part of the Polar transport layer a unit test can actually
 * reach: the whole classifier is two fields read off an error, so every case
 * below is exercised against an object literal with no client to construct and
 * no HTTP to fake. `convex/polar.ts` holds everything that genuinely needs the
 * network, and that split is deliberate.
 */

/**
 * The two fields the classification reads, both `unknown` because the input is
 * whatever `catch` produced.
 */
type HttpErrorish = { statusCode?: unknown; body?: unknown }

/**
 * Whether this error means the customer does not exist, rather than that the
 * request was wrong or Polar was unwell.
 *
 * THIS TOOK v1 THREE ATTEMPTS, so the reasoning is written down rather than
 * rediscovered.
 *
 * Polar does NOT answer an unknown `external_customer_id` with a 404. It
 * answers **422** with a validation detail of "Customer does not exist." — v1
 * verified that against the sandbox API for a non-UUID id, a well-formed but
 * unknown UUID, and an empty string alike. v1's earlier versions tested
 * `instanceof ResourceNotFound` (never raised, because the SDK only maps typed
 * errors for responses the OpenAPI spec declares) and then `statusCode === 404`
 * (never matched, because Polar does not send one). Both left every
 * non-subscriber being told to try again later, forever.
 *
 * A BARE 422 IS NOT ENOUGH EITHER. Polar returns 422 for ordinary validation
 * failures too — a malformed success_url, an empty customer name — and
 * reporting one of those as "no billing account" would hide a real bug behind a
 * sentence the user cannot act on. So the detail has to match as well.
 *
 * The 404 branch is kept although Polar does not currently send one: it is the
 * status this condition SHOULD have, and accepting it costs nothing if Polar
 * ever starts.
 *
 * DUCK-TYPED, WHERE v1 GATED ON `instanceof PolarError` FIRST. Not an
 * oversight, and not laxity — `statusCode === 422` together with that specific
 * detail is already far more selective than the class check, which is why
 * dropping it widens nothing in practice. What it buys is this module staying
 * free of `@polar-sh/sdk`: the SDK ships parallel ESM and CommonJS builds of
 * every error class, so `instanceof` is a fact about which copy got loaded, and
 * a test would have to import the SDK and hand-construct a `Response` to
 * produce one. Reading the two fields the check actually uses is both narrower
 * to depend on and testable.
 *
 * Deliberately does NOT distinguish the SDK's `HTTPValidationError` subclass by
 * name: `body` is the raw response text, which is populated on every
 * `PolarError` (measured on 0.49.0 — `PolarError` sets `this.body` from
 * `httpMeta.body`, and `HTTPValidationError` extends it), whereas the parsed
 * `detail` field only survives when the body matches the schema the generated
 * client expects. Matching the raw text is what v1 shipped and what has been
 * live since 2026-08-03.
 */
export function isMissingCustomer(error: unknown): boolean {
  // `?? {}` rather than a typeof guard: a thrown string or null must fall
  // through to false, and destructuring an object literal gives that for free.
  const { statusCode, body } = (error ?? {}) as HttpErrorish

  if (statusCode === 404) return true
  if (statusCode !== 422) return false

  // A non-string body cannot carry the detail, and `.test(String(body))` would
  // be a way to match "[object Object]" by accident.
  return typeof body === 'string' && /customer does not exist/i.test(body)
}
