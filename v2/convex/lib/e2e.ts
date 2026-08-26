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
 *
 * EXPECTS AN ALREADY-NORMALISED ADDRESS. It matches the raw string, so a padded
 * or display-name form (`' e2e+a@…'`, `'Ada <e2e+a@…>'`) does NOT match and
 * would be treated as a real recipient. Every path that reaches this today has
 * already been through normaliseInviteEmail (lib/invite.ts) or better-auth, both
 * of which trim and lowercase. A future caller that assembles addresses itself —
 * Phase 6's reminders — must do the same: the routing is covered by
 * construction, the MATCHING is not.
 */
export const isE2eEmail = (email: string) => E2E_ADDRESS.test(email)

// The synthetic `players.legacyId` e2eSeed.ts stamps on every row it creates:
// `e2e-<lowercased email>`. See that file's doc comment — the value exists so a
// seeded row is identifiable on sight AND can never be adopted by the Supabase
// copy, which matches on by_legacyId.
const E2E_SEED_LEGACY_PREFIX = 'e2e-'

/**
 * Whether a `players` row is a throwaway e2e row — the rule e2ePrune.ts deletes
 * on, and the reason it can be trusted to.
 *
 * A UNION OF TWO MARKERS, BECAUSE NEITHER ALONE COVERS THE ROWS THAT EXIST.
 * Measured against the local anonymous backend on 2026-08-26, over 2520 player
 * rows, every one of which was e2e debris:
 *
 *   - 2488 matched by ADDRESS. 605 of those carry no legacyId at all: they were
 *     created by the real signup/invite flow during a test, not by the seed, so
 *     no marker was ever stamped on them. The address is the only handle.
 *   - 1915 matched by LEGACY-ID PREFIX. 32 of those FAIL the address test:
 *     `second-e2e+<stamp>@wordleteams.com`, from an older spec, where the local
 *     part does not START with `e2e+` and E2E_ADDRESS is anchored. The prefix is
 *     the only handle.
 *
 * WHY THE PREFIX CANNOT MATCH A COPIED ROW, which is what makes it safe to
 * delete on. A copied player's legacyId is a Supabase uuid, whose first hyphen
 * is always at index 8; `e2e-` puts one at index 3, so no uuid can begin with
 * it. Confirmed on the same measurement: of 1916 string legacyIds present, 1915
 * had their first hyphen at index 3 and one at index 7 (a hand-written scratch
 * value) — not one at index 8, because no Supabase copy has ever run against
 * that deployment.
 *
 * NOT MODE-GATED, deliberately, unlike isE2eTraffic above. This answers "is this
 * row test data", which is a property of the row; whether the caller is allowed
 * to act on that answer is a property of the deployment, and e2ePrune.ts checks
 * E2E_TEST_MODE itself before it reads this. Folding the flag in here would make
 * the predicate untestable against a row without also stubbing the environment.
 */
export function isE2ePlayerRow(row: { email: string; legacyId?: string }): boolean {
  return isE2eEmail(row.email) || (row.legacyId?.startsWith(E2E_SEED_LEGACY_PREFIX) ?? false)
}

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

/**
 * The recipients of a message that should actually be mailed.
 *
 * PER RECIPIENT, NOT PER MESSAGE. Resend's `to`, `cc` and `bcc` are each
 * `string | string[]`, so one send can address several people at once — and
 * Phase 6's reminders will. A message addressed to a throwaway account AND a
 * real one must still reach the real one, so this filters rather than deciding
 * a whole send. Testing the address against the message would be wrong in both
 * directions: it would either mail the throwaway account or drop the real
 * person's reminder.
 *
 * Returns a plain array, empty when nobody is left. `undefined` in gives an
 * empty array out, so an absent `cc` and a fully-suppressed `cc` are the same
 * thing here; the caller decides whether that means "omit the field" or "do not
 * send at all".
 */
export function realRecipients(
  recipients: string | Array<string> | undefined,
  e2eTestMode: string | undefined,
): Array<string> {
  if (recipients === undefined) return []
  const all = typeof recipients === 'string' ? [recipients] : recipients
  return all.filter((address) => !isE2eTraffic(address, e2eTestMode))
}
