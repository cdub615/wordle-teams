/**
 * The Polar API version this app is written against, in BOTH directions.
 *
 * wordle-teams-rpc0 / wordle-teams-jn7m, moved to 2026-10 by wordle-teams-y8to
 * and wordle-teams-3mpq (epic wordle-teams-acmm).
 *
 * POLAR VERSIONS THE CONTRACT BY DATE, AND AN UNPINNED REQUEST IS NOT
 * VERSIONLESS — it resolves to whatever is Current, and Current CHANGES at each
 * quarterly release (January, April, July, October). 2026-10 became Current on
 * 2026-10-01, so leaving this unset would change the shape of every response
 * convex/polar.ts reads with no code change, no build failure and no test
 * failure. 2026-10 goes Deprecated at the January 2027 release and is REMOVED
 * roughly two quarters later; moving off it is a hard deadline, because Polar
 * answers an unknown or removed version with 404 rather than a fallback. See
 * wordle-teams-shdx, which carries that date alongside the prerelease it is
 * entangled with.
 *
 * 2026-10 IS NOT A PREFERENCE, IT IS THE IMPORT PATH convex/polar.ts USES.
 * `@polar-sh/sdk@1.0.0-alpha.21` ships one entry point per API version, and
 * `createPolar` from '@polar-sh/sdk/2026-10' bakes that version into the client
 * and sends it as `Polar-Version` on every request. So the subpath IS the
 * contract selection, and this constant only DESCRIBES it — which is why
 * `polarVersion.test.ts` asserts the two agree by reading the import statement
 * rather than trusting them to be kept in step by hand.
 *
 * MOVING TO IT COST NOTHING IN SHAPE, WHICH IS WORTH RECORDING BECAUSE IT
 * SOUNDS UNLIKELY. Diffing the two model sets the prerelease ships — 21710
 * lines each, 2026-04 against 2026-10 — yields three hunks: two doc-comment
 * strings and a sourcemap filename. No field is renamed, removed or retyped,
 * and `external_id`, `customer_id` and `checkout_id` occur 212 times in each.
 * The migration was a client-API change (camelCase bodies to snake_case,
 * `new Polar` to `createPolar`), not a data-shape change.
 *
 * A CONSTANT, NOT AN ENV VAR, and the reasoning is `polarServer`'s inverted.
 * That value is checked rather than coerced because a deployment genuinely has
 * to change it and a typo must not resolve to something plausible. This one a
 * deployment must NOT change: the version is chosen by an import path that is
 * fixed at build time, so a deployment variable could only ever disagree with
 * the code — and Polar answers an unknown version with 404.
 *
 * DEPENDENCY-FREE, LIKE EVERYTHING ELSE IN convex/lib/ — and here that is the
 * whole reason this is a file of its own rather than an export from
 * convex/polar.ts. The constant has TWO readers on opposite sides of a boundary
 * this tree keeps deliberately: the outbound pin in `convex/polar.ts`, which is
 * built on `@polar-sh/sdk`, and the inbound drift check in `convex/http.ts`,
 * which is not and must not become so — that router also serves the Better Auth
 * routes, and http.ts's header spells out what it costs to pull SDK machinery
 * into that isolate. A shared string with no imports lets both read the same
 * value and neither reach the other. `polarErrors.ts` was split out for exactly
 * the same reason.
 *
 * THE TWO SIDES ARE NOT THE SAME MECHANISM, AND THEY AGREE ONLY BY CURRENT
 * COINCIDENCE. One constant serves both today because both happen to be
 * 2026-10; that is a fact about this moment, NOT a rule, and the next quarterly
 * release can separate them again:
 *   - OUTBOUND is chosen by the '@polar-sh/sdk/2026-10' import path in
 *     convex/polar.ts. It changes when the code changes.
 *   - INBOUND is pinned per WEBHOOK ENDPOINT, by an `api_version` fixed when the
 *     endpoint is created (and PATCHable at /v1/webhooks/endpoints/{id} with a
 *     `webhooks:write` token). It lives in a Polar dashboard this repo cannot
 *     read, on each instance separately, and it changes when a HUMAN changes it
 *     — or when an endpoint is replaced, which is exactly what happened on
 *     2026-09-14.
 *
 * SO IF THEY EVER DIVERGE, SPLIT THIS INTO TWO CONSTANTS RATHER THAN PICKING A
 * WINNER. convex/http.ts warns when a delivery arrives at a version other than
 * this one, which is the only signal this repo gets that somebody moved the
 * endpoint side; docs/runbooks/2026-cutover.md §1.6 says what to do about it.
 */
export const POLAR_API_VERSION = '2026-10'
