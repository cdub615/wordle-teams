/**
 * WHETHER *THIS DEVICE* HAS A PASSKEY, AND WHETHER TO ASK IT ABOUT ONE
 * (wordle-teams-wty4.1.7).
 *
 * Two flags in localStorage and one feature probe. Between them they answer the
 * only two questions the passkey UI ever asks before it draws anything: should
 * this device be offered a passkey, and should /login show a passkey button.
 *
 * PER-DEVICE, AND THAT IS THE WHOLE DESIGN RATHER THAN A SHORTCUT. A passkey is
 * bound to ONE authenticator. Registering one on a phone does nothing for a
 * laptop — the laptop still signs in the slow way — so a server-side "this user
 * has passkeys" flag would suppress the offer on exactly the device that still
 * needs one, and it would do it permanently and invisibly. The failure has no
 * symptom: the player simply never sees the offer again and never knows why.
 * There is no per-account fact that answers "does the thing in front of me hold
 * a credential", so this is not a cheaper approximation of a better signal; it
 * is the only signal there is.
 *
 * TWO KEYS, NOT ONE, and they are not interchangeable. `registered` is evidence
 * that a credential exists here and it drives the /login button as well as the
 * offer. `declined` is a preference and drives the offer only. Collapsing them
 * would put a passkey button in front of someone who explicitly said no and has
 * no passkey — a tap that opens a system sheet reading "no passkeys found",
 * which is worse than no button at all.
 *
 * localStorage, NOT A COOKIE and not the database, for the reason
 * src/lib/last-login.ts gives at length: nothing server-side reads these, so a
 * cookie would add weight to every request for no one's benefit, and per-device
 * is the semantics being asked for rather than a limitation being worked
 * around.
 *
 * NOTHING HERE MAY THROW, AND THAT IS NOT A FORMALITY. Safari private mode and
 * "block all site data" make a bare `window.localStorage` access throw rather
 * than answer null. These reads sit in a render on the signed-in path: a throw
 * is a blank screen where the app should be, over a dismissal flag. Every
 * access is wrapped and every function degrades to a usable answer.
 *
 * AND THE DEGRADED ANSWER IS ALWAYS "NO", WHICH IS A DECISION. When the store
 * is blocked a decline cannot be recorded EITHER, so answering "yes, offer"
 * would re-offer on every single sign-in forever with no way for the player to
 * stop it. Silence is the kinder failure, and the cost of it is one convenience
 * feature missing in a browsing mode that is deliberately forgetful anyway.
 *
 * CALL THE STORAGE READS ONLY AFTER HYDRATION. The server cannot see
 * localStorage, so UI rendered from these during SSR is a hydration mismatch —
 * /login already gates its last-used badge on `useHydrated()` for the same
 * reason. `passkeySupported()` is the exception and guards itself, because a
 * feature probe is exactly the thing a caller is most likely to reach for
 * before thinking about where it runs.
 *
 * THE KEYS ARE EXPORTED because the write and the read will live in different
 * places — a key spelled in two modules is a key that can be spelled
 * differently in one of them, and the failure is silent: the write succeeds,
 * the read finds nothing, the offer never stops appearing.
 *
 * ONLY ONE CALLER EXISTS TODAY, and the rest of this file's audience is
 * PLANNED rather than present: components/settings/security-tab.tsx writes the
 * markers. /app's offer (Task 3) and /login's passkey button (Task 4) are the
 * readers these functions were shaped for and neither is built yet — so if you
 * are here wondering why `shouldOfferPasskey` has no call site, that is why,
 * not because one was deleted.
 */
export const PASSKEY_REGISTERED_KEY = 'wt.passkey.registered'
export const PASSKEY_DECLINED_KEY = 'wt.passkey.declined'

/**
 * Can this browser run a WebAuthn ceremony at all?
 *
 * GUARDS `window` ITSELF, unlike the storage functions below. Every route in
 * this app is server-rendered, and a probe that dereferences `window`
 * unguarded takes the whole document down on the server rather than answering
 * a question about the client. False is the right answer there: the server is
 * not a device with an authenticator.
 *
 * `typeof … === 'function'` rather than a truthiness check on the property,
 * because the real thing is a constructor and that is the only shape worth
 * treating as support.
 */
export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
}

/** Read a marker, treating any failure as "not set". See the header. */
function marked(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null
  } catch {
    return false
  }
}

/**
 * Write a marker. The VALUE is never read — presence is the whole signal — so
 * it is a constant rather than a timestamp: a timestamp invites a future reader
 * to expire it, and neither marker should expire ON A CLOCK. A device that has
 * a passkey still has it next year. `registered` IS cleared, but by evidence
 * rather than by age — see `forgetPasskeyRegistered`.
 */
function mark(key: string): void {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // Blocked store. The passkey itself is unaffected — it lives in the
    // authenticator and on the server — and this device simply keeps being
    // offered one.
  }
}

/** Drop a marker, treating a blocked store as nothing to do. */
function unmark(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Blocked store: there was nothing recorded to drop either, since the write
    // would have failed the same way.
  }
}

/**
 * Record that a passkey was successfully registered ON THIS DEVICE.
 *
 * TWO CALLERS, AND THE SECOND ONE IS NOT AN ERROR PATH DESPITE APPEARING ON
 * ONE. A registration that fails with `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED`
 * is the authenticator itself saying it already holds a credential for this
 * relying party — which is POSITIVE PROOF of exactly what this marker records,
 * arriving as a rejection. Treating it as a plain failure is what left a device
 * whose storage had been cleared nagging to register forever.
 */
export function rememberPasskeyRegistered(): void {
  mark(PASSKEY_REGISTERED_KEY)
}

/**
 * Record that this device holds NO passkey after all.
 *
 * CALLED ON EXACTLY ONE PIECE OF EVIDENCE: a removal that leaves the account
 * with no passkeys at all. Zero credentials on the ACCOUNT is the only thing
 * the Settings list can prove about THIS DEVICE, because no field on a passkey
 * row says which authenticator it belongs to. Removing one of three leaves the
 * marker set, and that is correct rather than a gap — the device probably does
 * still hold one.
 *
 * IT DOES NOT TOUCH `declined`, deliberately. Removing a passkey is not
 * un-declining an offer; a player who dismissed the offer and later cleaned up
 * their credentials has not asked to be asked again.
 */
export function forgetPasskeyRegistered(): void {
  unmark(PASSKEY_REGISTERED_KEY)
}

/** Record that the offer was dismissed on this device. Never expires. */
export function rememberPasskeyDeclined(): void {
  mark(PASSKEY_DECLINED_KEY)
}

/**
 * Has a passkey been registered on this device?
 *
 * WHAT /login's PASSKEY BUTTON HANGS OFF, alongside `passkeySupported()`.
 * Without it the button is a dead-end tap: the browser opens a system sheet,
 * finds no credential for this relying party, and says so.
 *
 * IT IS MAINTAINED IN BOTH DIRECTIONS, and this paragraph used to claim it was
 * not. It is SET on a successful registration and on a
 * `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED` rejection, which is the
 * authenticator volunteering the same fact; it is CLEARED when a removal in
 * Settings leaves the account with no passkeys at all.
 *
 * ONE STALE CASE SURVIVES, AND IT IS THE SURVIVABLE DIRECTION: register on a
 * phone, then remove that credential from a laptop. The account still has other
 * passkeys, so nothing clears the phone's marker, and the phone goes on
 * offering a button whose ceremony will find nothing. The sheet says "no
 * passkeys found" and every other sign-in method is still on the page. Task 4
 * turns that into a signpost rather than a dead end; do not try to fix it by
 * guessing here, because no field on a passkey row says which authenticator it
 * belongs to.
 */
export function passkeyRegisteredHere(): boolean {
  return marked(PASSKEY_REGISTERED_KEY)
}

/**
 * Should this device be offered a passkey after a sign-in?
 *
 * SUPPORT IS PART OF THE QUESTION, deliberately, so that no caller has to
 * remember it separately. An offer that leads to a ceremony the browser cannot
 * start is worse than silence, and the one place that rule could be forgotten
 * is the one place it matters.
 */
export function shouldOfferPasskey(): boolean {
  if (!passkeySupported()) return false
  try {
    return (
      window.localStorage.getItem(PASSKEY_REGISTERED_KEY) === null &&
      window.localStorage.getItem(PASSKEY_DECLINED_KEY) === null
    )
  } catch {
    // ONE `try` AROUND BOTH READS, NOT TWO CALLS TO `marked`, and the
    // difference is the whole behaviour. `marked` folds a blocked store into
    // "not set", which is the safe reading for `passkeyRegisteredHere` and the
    // EXACTLY WRONG one here: two absent markers mean "offer", so a blocked
    // store would come out as `true` and re-offer on every sign-in forever —
    // the nagging loop the header rules out. Here a failed read has to mean
    // "cannot tell", and cannot tell means do not ask.
    return false
  }
}
