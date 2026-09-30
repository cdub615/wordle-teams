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
 *
 * `error` RATHER THAN `body`, WHICH IS AN SDK-SHAPE CHANGE AND NOT A RENAME
 * (wordle-teams-y8to). `@polar-sh/sdk@0.49.0`'s `PolarError` carried the raw
 * response text on `body`. `1.0.0-alpha.21` has no `body` at all: its
 * `PolarClientError` carries `statusCode` and `error`, and what `error` HOLDS
 * depends on whether the endpoint declared that status —
 *   - declared:   `new ErrorClass(statusCode, await response.json())`, so a
 *                 PARSED OBJECT;
 *   - undeclared: `new PolarClientError(statusCode, await response.text())`, so
 *                 a RAW STRING.
 * Both shapes are live for the same status code depending on the endpoint,
 * which is why the matcher below normalises instead of picking one.
 */
type HttpErrorish = { statusCode?: unknown; error?: unknown }

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
 * name, and does not reach for a `detail` field either. On the alpha a 422 can
 * arrive as `HTTPValidationError` with `error` a parsed `{ detail: [...] }`, or
 * as a bare `PolarClientError` with `error` the raw response text, depending on
 * whether the endpoint's spec declares 422. Serialising whichever it is and
 * matching the sentence covers both, and is the same thing v1 shipped against
 * the raw text and has run since 2026-08-03.
 *
 * SERIALISING IS NOT `String(error)`. That yields "[object Object]" for the
 * parsed shape — a value the regex can never match, which would silently
 * restore exactly the bug this function exists to fix: every non-subscriber
 * told to try again later, forever. `JSON.stringify` is what actually reaches a
 * nested `detail`. Mutating `serialise` to `String(value)` fails two tests in
 * polarErrors.test.ts, which is the check that this paragraph is still true.
 */
export function isMissingCustomer(error: unknown): boolean {
  // `?? {}` rather than a typeof guard: a thrown string or null must fall
  // through to false, and destructuring an object literal gives that for free.
  const { statusCode, error: detail } = (error ?? {}) as HttpErrorish

  if (statusCode === 404) return true
  if (statusCode !== 422) return false

  return /customer does not exist/i.test(serialise(detail))
}

/**
 * The error body as text, whether the SDK handed over a string or a parsed
 * object, and '' for anything that cannot be represented.
 *
 * THE try/catch IS LOAD-BEARING: a circular value makes `JSON.stringify` THROW,
 * and this runs inside a `catch` on the portal's happy path, so the throw would
 * replace "no billing account" with an unhandled error for a user whose only
 * problem is that they have not paid. polarErrors.test.ts drives a circular
 * body for exactly that.
 *
 * `?? ''` IS FOR THE TYPE, NOT FOR BEHAVIOUR, and is called out because it
 * looks like a guard. `JSON.stringify(undefined)` returns `undefined`, which
 * this function's `string` return type forbids — but the only caller feeds the
 * result to `RegExp.test`, which would coerce it to the harmless "undefined".
 * Removing it changes no observable behaviour and no test fails, so nothing
 * here should be read as claiming otherwise.
 */
function serialise(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
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
 * 403 WAS INCLUDED BY JUDGMENT AND IS NOW MEASURED. It was classified with 401
 * on the reasoning that Polar's tokens are scoped, so a token with the wrong
 * scopes is the same operator mistake as a token from the wrong instance —
 * while noting that nothing here had seen Polar send one. Polar then sent one,
 * on the owner's first real portal click against the sandbox (2026-08-27):
 *
 *   403 {"error": "insufficient_scope", "error_description": "The request
 *   requires higher privileges than provided by the access token."}
 *   www-authenticate: Bearer realm="polar", scope="customer_sessions:write"
 *
 * A valid, authenticating token missing one scope. It needed a human to edit
 * the token in Polar; no amount of retrying would have helped. The judgment was
 * right, and the case it was guessing about is the one that actually happened
 * first.
 *
 * THE FOUR SCOPES THIS INTEGRATION NEEDS, one per SDK call in convex/polar.ts:
 * `checkouts:write` (checkouts.create), `customer_sessions:write`
 * (customerSessions.create), `checkouts:read` (checkouts.get) and
 * `customers:write` (customers.update). Only the second is reachable from the
 * portal button, so a token short of the others fails later and in rarer paths
 * — customers.update in particular only runs for an email-matched customer.
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
