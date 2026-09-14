import { authClient } from '#/lib/auth-client.ts'
import { rememberPasskeyRegistered } from '#/lib/passkey.ts'

/**
 * ONE WEBAUTHN REGISTRATION, CLASSIFIED, WITH THE PER-DEVICE MARKER ALREADY
 * WRITTEN (wordle-teams-wty4.1.7.3).
 *
 * WHY THIS IS A MODULE AND NOT A SECOND COPY. Two places in the app now start a
 * registration — components/settings/security-tab.tsx, where the player went
 * looking for one, and components/passkey-offer.tsx, which asks after a
 * sign-in. Everything between the button and the outcome is identical in both
 * and every part of it is a trap:
 *
 *   - `addPasskey` NEVER REJECTS. It resolves to `{ data, error }` for every
 *     failure, an aborted ceremony included (measured in
 *     `@better-auth/passkey/dist/client.mjs`, whose `registerPasskey` catches
 *     `WebAuthnError` and RETURNS it). A bare `await` in a `try` therefore reads
 *     every single failure as a success — and the thing that follows a success
 *     here is a marker saying this device holds a passkey, which permanently
 *     suppresses the offer on a device that holds nothing.
 *   - THE ERROR IS A UNION AND ONE ARM HAS NO `code`. The shape returned when
 *     the ceremony fails carries one; the shape returned when the initial
 *     options request fails does not. `'code' in …` is what makes reading it
 *     legal, and typecheck is the only thing that would have caught the other
 *     spelling.
 *   - `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED` IS NOT A FAILURE, it is
 *     evidence. See below.
 *
 * Duplicated, one caller gets a fix and the other does not, and the divergence
 * has no symptom either gate or eye can see.
 *
 * WHAT IS *NOT* SHARED, DELIBERATELY: how the outcome is announced. The
 * Settings tab toasts into a page the player is reading; the offer is a dialog
 * that has to decide whether to close itself. Folding the messaging in here
 * would make one of the two callers wrong, so this returns a classification and
 * says nothing.
 *
 * THE MARKER WRITE *IS* SHARED, and that is the asymmetry worth stating: it is
 * not a message, it is the fact, and both callers owe it identically. Leaving
 * it to the callers is exactly how one of them comes to forget it.
 *
 * NOT IN lib/passkey.ts, AND THE COST OF FOLDING IT IN IS ALREADY PAID TODAY
 * RATHER THAN AT TASK 4. That module is two localStorage flags and one feature
 * probe with no imports at all, and `routes/app.tsx` imports it — so putting
 * the ceremony there would pull the whole Better Auth client into the DASHBOARD
 * route's module graph now, for a route that starts no ceremony. /login's
 * passkey button (Task 4) will be the second such importer; that half is
 * PLANNED rather than present, and `login.tsx` imports nothing from
 * lib/passkey.ts yet. This module depends on the auth client and belongs beside
 * it rather than inside the storage primitives it calls.
 */
export type PasskeyRegistration =
  | { outcome: 'registered' }
  | { outcome: 'already-registered'; message: string }
  | { outcome: 'aborted' }
  | { outcome: 'failed'; message: string }

/**
 * What to say when the authenticator reports it already holds a credential.
 *
 * MODULE-PRIVATE, AND IT REACHES THE CALLERS AS `result.message` — the same way
 * a failure's does. It used to be exported and imported by both of them, which
 * made two files claim in a comment that "the messaging is not shared" while
 * importing a shared message two lines above. What actually diverges is the
 * SEVERITY, not the sentence: the Settings tab toasts this as an error, because
 * a player who went looking for a new passkey did not get one; the offer toasts
 * it as information, because the app asked a question whose premise was wrong.
 * Carrying it on the outcome leaves each caller choosing only that.
 *
 * THE PLUGIN'S OWN MESSAGE IS "Previously registered", which tells the player
 * nothing they can act on. This says what is actually true, and the true thing
 * is reassuring: there is nothing to do.
 */
const ALREADY_REGISTERED_MESSAGE = 'This device already has a passkey on your account.'

/**
 * The generic failure, for an error that arrived with no message of its own.
 *
 * EXPORTED ONLY FOR THE TEST'S VACUITY GUARD — no component imports it, because
 * it too reaches them on `result.message`.
 */
export const REGISTRATION_FAILED_MESSAGE = 'Could not add a passkey.'

/**
 * Run the ceremony and report what happened. Never rejects, never throws.
 *
 * 'aborted' MEANS THE PLAYER PRESSED CANCEL on the system sheet, which is how a
 * person says "not now" to a modal drawn by their operating system. It is not a
 * failure and must never be reported as one — a toast there scolds someone for
 * using the button the browser itself put in front of them.
 *
 * 'already-registered' CARRIES A WRITE. The authenticator refusing because it
 * ALREADY HOLDS a credential for this relying party is positive proof of
 * exactly what the registered marker records, arriving as a rejection. Treating
 * it as a plain failure is what leaves a device whose site data was cleared
 * nagging to register at every sign-in forever — the loop lib/passkey.ts's
 * header exists to rule out.
 */
export async function registerPasskey(): Promise<PasskeyRegistration> {
  try {
    const result = await authClient.passkey.addPasskey()
    if (result?.error) {
      const code = 'code' in result.error ? result.error.code : undefined
      if (code === 'ERROR_CEREMONY_ABORTED') return { outcome: 'aborted' }
      if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
        rememberPasskeyRegistered()
        return { outcome: 'already-registered', message: ALREADY_REGISTERED_MESSAGE }
      }
      return { outcome: 'failed', message: result.error.message || REGISTRATION_FAILED_MESSAGE }
    }
    // AFTER THE ERROR CHECK, NOT BESIDE IT. Marking a device as holding a
    // passkey when registration failed suppresses the offer on a device that
    // has nothing, permanently, with no symptom.
    rememberPasskeyRegistered()
    return { outcome: 'registered' }
  } catch (cause) {
    // Unreachable through `addPasskey` itself (see the header) — this covers
    // the network layer underneath it.
    return {
      outcome: 'failed',
      // `&& cause.message`, NOT A BARE `instanceof`. `new Error('')` is an Error
      // whose message is the empty string, and handing that to a toast draws an
      // empty toast — the exact failure the `|| REGISTRATION_FAILED_MESSAGE` on
      // the returned-error path above guards against. An `instanceof` check
      // answers "is it shaped like an Error", which is not the question; the
      // question is whether there is anything to show.
      message: cause instanceof Error && cause.message ? cause.message : REGISTRATION_FAILED_MESSAGE,
    }
  }
}
