/**
 * Who counts as a throwaway e2e account, and when.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex imports. That
 * is what lets the rule be unit-tested at all: the places that need it are
 * `mutation`/`action` wrappers and Better Auth callbacks, and NOTHING in this
 * repo can drive one of those, because it needs a real Better Auth session in
 * the harness (wordle-teams-obw). A rule stated inline in a wrapper is not
 * merely untested, it is untestable — so the decision lives here as a pure
 * function and the wrapper only acts on the answer.
 *
 * That matters more here than usual because this predicate SUPPRESSES things.
 * An ordinary guard that silently inverts refuses work that should have
 * happened, and somebody notices. This one, inverted, either keeps sending mail
 * it was added to stop or — far worse — silently stops sending real invitations
 * on production, where the symptom is people quietly never being invited.
 */

// The one definition. testOtps.ts re-exports this rather than restating it: the
// address shape and the mode check had already been written out three times, in
// two different polarities, before this module existed.
const E2E_ADDRESS = /^e2e\+[^@]+@wordleteams\.com$/i

/**
 * Whether an address is a throwaway e2e account.
 *
 * Only these may ever flow through the OTP-capture oracle or the seed helpers —
 * even in test mode, a real address must never have its codes readable.
 */
export const isE2eEmail = (email: string) => E2E_ADDRESS.test(email)

/**
 * Whether this address, on this deployment, is e2e traffic.
 *
 * BOTH HALVES ARE LOAD-BEARING and neither is sufficient alone. The mode flag
 * is never set on the deployment that becomes production (wordle-teams-7az), so
 * an `e2e+*` address on production is treated as an ordinary user and gets real
 * mail; and in a test deployment a real address is still treated as real, so a
 * genuine invitation is never swallowed by a machine that happens to run tests.
 *
 * `e2eTestMode` is passed in rather than read from `process.env` here so the
 * rule can be exercised without a deployment. Callers pass
 * `process.env.E2E_TEST_MODE`.
 */
export function isE2eTraffic(email: string, e2eTestMode: string | undefined): boolean {
  return e2eTestMode === 'true' && isE2eEmail(email)
}
