/**
 * Who counts as a throwaway e2e account, and when.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex imports. That
 * is what lets the rule be unit-tested at all where it matters most: nothing in
 * this repo can drive an AUTHED wrapper, because that needs a real Better Auth
 * session in the harness (wordle-teams-obw). `invitePlayer` is authed — it goes
 * through `requirePlayer` — so a rule stated inline in its body would not merely
 * be untested, it would be untestable. (An UNauthed wrapper is drivable:
 * `status.test.ts` has driven one since Phase 0, and `testOtps.takeFor` could be
 * covered directly.) The decision lives here as a pure function and the wrappers
 * only act on the answer.
 *
 * That matters more here than usual because this predicate SUPPRESSES things.
 * An ordinary guard that silently inverts refuses work that should have
 * happened, and somebody notices. This one, inverted, either keeps sending mail
 * it was added to stop or — far worse — silently stops sending real invitations
 * on production, where the symptom is people quietly never being invited.
 */

// The one definition. testOtps.ts re-exports this rather than restating it. The
// address shape was only ever written once; the MODE CHECK was written four
// times in two polarities, which is what this module is really consolidating.
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
 * BOTH HALVES ARE LOAD-BEARING and neither is sufficient alone. In a test
 * deployment a real address is still treated as real, so a genuine invitation is
 * never swallowed by a machine that happens to run tests.
 *
 * THE PRODUCTION HALF IS A REQUIREMENT, NOT YET A FACT. The mode flag MUST NOT
 * be set on the deployment that becomes production — but beta carries its
 * environment into production at cutover, so absent a deliberate step the
 * default outcome is that production ships with the flag ENABLED.
 * wordle-teams-7az is that step and it is still OPEN; whether the flag is set
 * there is recorded as unknown. Until 7az closes, do not read this predicate as
 * proof that production is safe: with the flag surviving cutover, an invitation
 * to any `e2e+*@wordleteams.com` address is dropped here silently, with no error
 * anywhere.
 *
 * `e2eTestMode` is passed in rather than read from `process.env` here so the
 * rule can be exercised without a deployment. Callers pass
 * `process.env.E2E_TEST_MODE`.
 */
export function isE2eTraffic(email: string, e2eTestMode: string | undefined): boolean {
  return e2eTestMode === 'true' && isE2eEmail(email)
}
