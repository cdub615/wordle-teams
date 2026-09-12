/**
 * The Polar API version this app is written against.
 *
 * wordle-teams-rpc0 / wordle-teams-jn7m.
 *
 * POLAR VERSIONS THE CONTRACT BY DATE, AND AN UNPINNED REQUEST IS NOT
 * VERSIONLESS — it resolves to whatever is Current, and Current CHANGES at each
 * quarterly release (January, April, July, October). On 2026-10-01, 2026-10
 * becomes Current, so leaving this unset would have changed the shape of every
 * response convex/polar.ts reads with no code change, no build failure and no
 * test failure. 2026-04 becomes Deprecated on that date and keeps its stable
 * contract until it is REMOVED at the January 2027 release; migrating off it is
 * wordle-teams-4etd, and it is a hard deadline because Polar answers an unknown
 * or removed version with 404 rather than a fallback.
 *
 * 2026-04 IS NOT A PREFERENCE, IT IS WHAT THE INSTALLED SDK ALREADY IS.
 * `@polar-sh/sdk@0.49.0` reports `SDK_METADATA.openapiDocVersion === '2026-04'`:
 * its generated models — the types convex/polar.ts compiles against — describe
 * that contract and no other. Pinning the wire to it makes the request agree
 * with the types. `polarVersion.test.ts` asserts that equality rather than
 * trusting it, so an SDK upgrade that moves the generated contract fails the
 * suite instead of drifting silently past this constant.
 *
 * A CONSTANT, NOT AN ENV VAR, and the reasoning is `polarServer`'s inverted.
 * That value is checked rather than coerced because a deployment genuinely has
 * to change it and a typo must not resolve to something plausible. This one a
 * deployment must NOT change: a version the SDK's models do not describe is
 * broken code, not a configuration choice, and making it settable would let an
 * operator turn every Polar call into a 404 from a dashboard.
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
 * THE TWO SIDES ARE NOT THE SAME MECHANISM, which is why one constant serves
 * both rather than one setting covering both:
 *   - OUTBOUND is pinned by the `Polar-Version` request header, which
 *     convex/polar.ts's `pinApiVersion` hook sets on every SDK call.
 *   - INBOUND is pinned per WEBHOOK ENDPOINT, by an `api_version` set where the
 *     endpoint is configured — a dashboard setting on each Polar instance, which
 *     the request header has no bearing on. This repo cannot set it;
 *     docs/runbooks/2026-cutover.md carries the step, and convex/http.ts warns
 *     when a delivery arrives at a version other than this one, which is how a
 *     missed step becomes visible.
 */
export const POLAR_API_VERSION = '2026-04'
