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

/**
 * Whether Polar rejected the credential this deployment is holding, rather than
 * failing to answer.
 *
 * THE POINT IS THAT RETRYING CANNOT FIX IT, which is the same line
 * `isMissingCustomer` draws and the reason `PortalResult` has more than two
 * shapes. A rejected token stays rejected until an operator changes something,
 * so telling the player to try again is untrue in exactly the way
 * wordle-teams-9fm is about.
 *
 * 401 IS THE MEASURED-SHAPE CASE. `PolarError` sets `statusCode` from the
 * response status (`dist/esm/models/errors/polarerror.js:8`) and every error
 * class extends it, and the generated `customerSessionsCreate` matches only
 * 201 and 422 before falling through to a bare `M.fail("4XX")` — so a 401
 * arrives here as an untyped error whose `statusCode` is the only thing worth
 * reading. That is the same duck-typing `isMissingCustomer` justifies at
 * length.
 *
 * 403 IS INCLUDED BY JUDGMENT, NOT BY MEASUREMENT: Polar's tokens are scoped,
 * and a token with the wrong scopes is the same operator mistake as a token
 * from the wrong instance. Nothing in this repo has seen Polar send one. It is
 * classified with 401 because the alternative — "please try again" at somebody
 * whose retry is guaranteed to fail — is the worse answer to be wrong with.
 *
 * WHY A CREDENTIAL FAILURE IS "NOT CONFIGURED" AND NOT "POLAR IS UNWELL", which
 * is the one genuinely arguable call here. A token can be revoked at runtime by
 * someone who never touched this deployment, so it is not strictly a fact
 * knowable before the call, the way a missing variable is. But the question the
 * classification answers is not "whose fault is it", it is "can the player do
 * anything". Both a sandbox token pointed at production and a token revoked
 * this morning need a human to change a variable before the next attempt can
 * succeed; neither clears on its own. Grouping them with the outage would put
 * the one failure that never resolves behind the sentence that promises it
 * will.
 */
export function isCredentialProblem(error: unknown): boolean {
  const { statusCode } = (error ?? {}) as HttpErrorish

  // Strictly, for the reason isMissingCheckout gives: a hand-rolled wrapper's
  // '401' string is not a Polar status.
  return statusCode === 401 || statusCode === 403
}

/**
 * Whether this error means the CHECKOUT cannot be read no matter how often we
 * ask, rather than that the call failed.
 *
 * THE DISTINCTION IS A STATUS CODE ON THE WEBHOOK, which is why it is a
 * classifier and not a `catch (e) { return null }`. `fetchCheckoutExternalId`
 * is identity's last resort; a null from it means "the checkout names nobody",
 * and convex/http.ts turns that into 202 — an answer that tells Polar NEVER to
 * redeliver. Letting a Polar 500, a 429, a network blip or a missing
 * POLAR_ACCESS_TOKEN produce that same null would discard the delivery
 * permanently, and it would do it to exactly the customers the fallback exists
 * for: the email-matched ones whose customer carries no external id. Anything
 * this returns false for is rethrown and becomes a 500, so Polar redelivers.
 *
 * A DIFFERENT SHAPE FROM isMissingCustomer, and the difference is real rather
 * than an inconsistency. That one asks about a value in a request BODY, which
 * Polar answers with 422 plus a detail string. This one asks about a PATH
 * parameter, and `checkouts.get` declares 404 `ResourceNotFound` and 422
 * `HTTPValidationError` in the generated client (measured:
 * `@polar-sh/sdk@0.49.0`, `dist/esm/funcs/checkoutsGet.js:87`, which matches
 * exactly `200`, `404`, `422`, then fails 4XX and 5XX). So the status alone
 * carries the meaning here and no body needs reading.
 *
 * 422 COUNTS AS "CANNOT BE READ", not as a failure: it means Polar rejected the
 * id we sent as malformed, and a redelivery carries the same id. Retrying that
 * forever is the infinite loop the 202 exists to prevent — the same reasoning
 * as an unresolvable external id, reached one step later.
 *
 * NO 404-IS-GENEROUS BRANCH, unlike isMissingCustomer's: here the SDK's own
 * matcher says 404 is what this endpoint sends.
 */
export function isMissingCheckout(error: unknown): boolean {
  const { statusCode } = (error ?? {}) as HttpErrorish

  // Strictly, so a hand-rolled wrapper's '404' string does not classify — the
  // same reflex isMissingCustomer's tests pin.
  return statusCode === 404 || statusCode === 422
}
