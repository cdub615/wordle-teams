import { KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { authClient } from '#/lib/auth-client.ts'
import { forgetPasskeyRegistered, passkeySupported, rememberPasskeyRegistered } from '#/lib/passkey.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'

/**
 * WHAT A ROW IS CALLED. `name` is only ever set when the CLIENT supplies one at
 * registration — measured in the plugin's own source, where `resolvedName`
 * starts as `ctx.body.name || undefined` and is only filled in by an
 * `afterVerification` hook, which `convex/auth.ts` does not configure. So this
 * fallback is the NORMAL case here rather than a defensive edge, and the
 * "Added …" line below it is what actually tells two rows apart.
 *
 * The plugin also ships `getAuthenticatorName(aaguid)` for a nicer label, and
 * it is deliberately not used: it is exported from `@better-auth/passkey`, the
 * SERVER entry, and pulling that into a browser bundle to resolve a display
 * string would drag the whole plugin — `@simplewebauthn/server` included — into
 * the client build. `@better-auth/passkey/client` does not re-export it.
 */
export function passkeyLabel(name: string | null | undefined): string {
  return name?.trim() || 'Passkey'
}

/**
 * 'Added 13 Sep 2026', or null where there is no usable date.
 *
 * NULL RATHER THAN A STRING, because `new Date(undefined)` stringifies to
 * "Invalid Date" and a settings row reading "Added Invalid Date" is worse than
 * a row with no second line at all. The value arrives over the wire as JSON, so
 * whether it is revived into a `Date` is the fetch layer's business and not
 * something this component should assert — hence `new Date(...)` over whatever
 * came back, and a finiteness check on the result rather than a type check on
 * the input.
 *
 * LOCALE IS LEFT UNDEFINED so it follows the reader, the same choice
 * lib/clock-time.ts makes and for the same reason; tests pass one explicitly.
 */
function addedOn(createdAt: Date | string | null | undefined, locale?: string): string | null {
  if (createdAt === null || createdAt === undefined) return null
  const at = new Date(createdAt)
  if (!Number.isFinite(at.getTime())) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(at)
}

export function addedLabel(createdAt: Date | string | null | undefined, locale?: string): string | null {
  const on = addedOn(createdAt, locale)
  return on && `Added ${on}`
}

/**
 * The remove button's ACCESSIBLE NAME: 'Remove Passkey, added 13 Sep 2026'.
 *
 * THE DATE IS IN HERE BECAUSE THE NAME IS NOT ENOUGH, and that is a fact about
 * this app rather than a nicety. `passkeyLabel` falls back to the bare word
 * 'Passkey' for every row — see its comment: nothing here sends a `name` at
 * registration and the server fills none in — so an accessible name built from
 * the label alone is the string "Remove Passkey", repeated once per credential,
 * with nothing to tell a screen-reader user which one they are about to
 * destroy. The visible rows have the same problem and solve it the same way:
 * the "Added …" line under each label is what actually distinguishes them.
 *
 * A ROW WITH NO USABLE DATE STILL GETS A NAME, just an ambiguous one. That is
 * strictly better than "Remove undefined", and the case is close to
 * unreachable — `createdAt` is written by the plugin on every insert.
 */
export function removeLabel(
  name: string | null | undefined,
  createdAt: Date | string | null | undefined,
  locale?: string,
): string {
  const on = addedOn(createdAt, locale)
  return on ? `Remove ${passkeyLabel(name)}, added ${on}` : `Remove ${passkeyLabel(name)}`
}

/**
 * Security tab of the settings dialog: the passkeys on this account, with add
 * and remove (wordle-teams-wty4.1.7).
 *
 * THE LIST IS PER-ACCOUNT AND THE OFFER IS PER-DEVICE, and the two must not be
 * confused. Every row here is a credential on the ACCOUNT — most of them
 * belonging to authenticators that are not the one in front of you, and there
 * is no field that says which is which. Why the offer is per-device instead is
 * argued once, in `src/lib/passkey.ts`'s header, and not restated here. All
 * this file does with that half is the one write below.
 *
 * REMOVING THE LAST PASSKEY IS NOT GATED, and the absence of a confirmation is
 * a decision rather than an omission. Email OTP and all four social providers
 * are untouched by this feature, so no sequence of removals on this tab can
 * lock anybody out of anything. A confirmation dialog would imply a danger that
 * does not exist, and teach the player to expect one where it is not warranted.
 *
 * `addPasskey` NEVER REJECTS — it resolves to `{ data, error }` in every case,
 * including a ceremony the player aborted (measured in
 * `@better-auth/passkey/dist/client.mjs`, whose `registerPasskey` catches
 * `WebAuthnError` and returns it). So the `error` field is the ONLY failure
 * signal on that path and a bare `await` in a `try` would silently treat every
 * failure as a success. `deletePasskey` goes through the inferred-endpoint
 * proxy instead, whose return type is `any`, so its throwing behaviour is not
 * pinned by anything — that one is handled both ways on purpose.
 *
 * THE LIST REFRESHES ITSELF. `passkeyClient()` registers an atom listener on
 * `/passkey/verify-registration`, `/passkey/delete-passkey`,
 * `/passkey/update-passkey` and `/sign-out` that re-signals `$listPasskeys`
 * (client.mjs's `atomListeners`), and `registerPasskey` additionally pokes that
 * atom by hand on success. A manual `refetch()` here would be a third redundant
 * round trip for the same list.
 */
export default function SecurityTab() {
  const { data: passkeys, isPending, error } = authClient.useListPasskeys()
  const hydrated = useHydrated()

  // Local flags, not a mutation's `isPending`: the slow part of both actions is
  // outside any query cache — a WebAuthn ceremony is a modal system sheet that
  // can sit open for as long as the player takes to present a finger. Without
  // these the buttons stay live under the sheet and a second click starts the
  // whole ceremony again. Same reasoning as notifications-tab.tsx's
  // `pushPending`.
  const [adding, setAdding] = useState(false)
  // AN ID RATHER THAN A BOOLEAN, because the two questions it answers have
  // different answers per row: EVERY row's button is disabled while a removal
  // is in flight (two removals racing against one list buys nothing), but only
  // the row actually going is marked busy. A boolean cannot say both.
  const [removingId, setRemovingId] = useState<string | null>(null)

  /**
   * `passkeySupported()` reads a `window` global, so it answers false on the
   * server and possibly true on the client — rendering two different trees for
   * the same markup is a hydration mismatch. `hydrated` is what settles that,
   * and it is applied AT THE JSX below rather than folded in here.
   *
   * THE FOLD (`hydrated && passkeySupported()`) IS THE TIDIER LINE AND IT IS
   * WRONG, which is why this is spelled out. It collapses "we do not know yet"
   * into "this browser cannot", so every player on a perfectly capable browser
   * reads "This browser can't use passkeys" for one frame before it is taken
   * back — a flash of the most alarming sentence on the tab, shown to precisely
   * the people it is not about. Rendering neither branch for that frame is
   * invisible. (It was written the folded way first; a mutation survived
   * against it because with the JSX gate in place the extra `hydrated &&` is
   * dead, and removing the dead half is the honest resolution.)
   */
  const supported = passkeySupported()

  const onAdd = async () => {
    setAdding(true)
    try {
      const result = await authClient.passkey.addPasskey()
      if (result?.error) {
        // A CANCELLED CEREMONY IS NOT AN ERROR TO REPORT. Dismissing the system
        // sheet is how a player says "not now", and `startRegistration` surfaces
        // it as an ordinary WebAuthnError — so the only thing distinguishing it
        // from a genuine failure is this code. A toast here would scold someone
        // for using the sheet's own cancel button.
        //
        // `'code' in …` RATHER THAN A PLAIN READ, because the declared error is
        // a union: the shape returned when the ceremony fails carries a `code`,
        // the one returned when the initial options request fails does not.
        if ('code' in result.error && result.error.code === 'ERROR_CEREMONY_ABORTED') return
        /**
         * A REJECTION THAT IS EVIDENCE. `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED`
         * is the authenticator refusing because it ALREADY HOLDS a credential
         * for this relying party — which is precisely what the registered
         * marker exists to record, arriving as a failure. Toasting it and
         * moving on (which is what this did) leaves a device whose storage was
         * cleared nagging to register forever: the exact loop passkey.ts's
         * header sets out to rule out.
         *
         * THE PLUGIN'S OWN MESSAGE IS "Previously registered", which tells the
         * player nothing they can act on. This says what is actually true, and
         * the true thing is reassuring: there is nothing to do.
         */
        if ('code' in result.error && result.error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
          rememberPasskeyRegistered()
          toast.error('This device already has a passkey on your account.')
          return
        }
        toast.error(result.error.message || 'Could not add a passkey.')
        return
      }
      // THE ONE PER-DEVICE WRITE IN THIS FILE, and it is deliberately after the
      // success check rather than beside it: marking a device as having a
      // passkey when registration failed suppresses the offer on a device that
      // has nothing, permanently, with no symptom.
      rememberPasskeyRegistered()
      toast.success('Passkey added')
    } catch (cause) {
      // Unreachable through `addPasskey` itself (see the header) — this covers
      // the network layer underneath it.
      toast.error(cause instanceof Error ? cause.message : 'Could not add a passkey.')
    } finally {
      setAdding(false)
    }
  }

  const onRemove = async (id: string) => {
    setRemovingId(id)
    try {
      const result = await authClient.passkey.deletePasskey({ id })
      if (result?.error) {
        toast.error(result.error.message || 'Could not remove that passkey.')
        return
      }
      /**
       * THE ONLY THING THIS LIST CAN PROVE ABOUT *THIS DEVICE*. Zero passkeys on
       * the ACCOUNT means zero on every device, this one included — so the
       * registered marker is now false and must go, or /login (Task 4) offers a
       * passkey button whose ceremony finds nothing.
       *
       * READ OFF THE LIST AS THE PLAYER SAW IT, which is what `passkeys` is: it
       * is the value from the render that built this handler, not whatever the
       * refetch has since produced. That is the right basis and it is also the
       * only stable one — the refetch triggered by this very delete has not
       * necessarily landed yet.
       *
       * REMOVING ONE OF THREE DELIBERATELY LEAVES THE MARKER SET. Nothing on a
       * passkey row says which authenticator it belongs to, so a shorter list is
       * no evidence at all about the device in front of us — and it probably
       * does still hold one.
       */
      if (passkeys?.length === 1 && passkeys[0]?.id === id) forgetPasskeyRegistered()
      toast.success('Passkey removed')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not remove that passkey.')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="flex flex-col space-y-4 py-4">
      <div className="flex flex-col space-y-1.5">
        <h3 className="text-lg font-semibold leading-none tracking-tight">Passkeys</h3>
        <p className="text-sm text-muted-foreground">
          Sign in with your fingerprint, face or screen lock instead of a code.
        </p>
      </div>

      <Separator />

      {/*
        `isPending` IS CHECKED BEFORE `data`. The atom starts at `data: null`
        with `isPending: true`, so a list-vs-empty decision made on `data` alone
        tells every player on a cold open that they have no passkeys — and "You
        have no passkeys yet" is a statement of fact, not a loading state, so it
        reads as an answer rather than a wait. It does NOT flash back to the
        spinner on a refetch either: better-auth's `onRequest` sets `isPending:
        currentValue.data === null`, so a reload with a list already in hand
        stays on the list.

        `error && !passkeys`, NOT A BARE `error`, AND THAT IS A BUG FIX RATHER
        THAN CAUTION. `onRequest` clears `error` but `onError` KEEPS `data` for
        anything that is not a 401 (`query.mjs`: `data: isUnauthorized ? null :
        value.get().data`, and the outer `.catch` preserves it unconditionally).
        The refetch that a successful DELETE triggers is exactly the request most
        likely to fail here — it runs unattended, straight after a write — and a
        bare `error` would swap a still-valid list of the player's passkeys for
        the line "Could not load your passkeys." The rows stay; the toast is
        what reports the failure.
      */}
      {error && !passkeys ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Could not load your passkeys.
        </p>
      ) : isPending ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading your passkeys…</span>
        </div>
      ) : !passkeys || passkeys.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">You have no passkeys on this account yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {passkeys.map((passkey) => {
            const added = addedLabel(passkey.createdAt)
            return (
              <li key={passkey.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{passkeyLabel(passkey.name)}</span>
                    {added && <span className="truncate text-xs text-muted-foreground">{added}</span>}
                  </div>
                </div>
                {/*
                  THE BUTTON STAYS MOUNTED AND ONLY ITS ICON CHANGES, rather
                  than being swapped for a bare spinner — the same shape
                  Header.tsx's UPGRADE button uses (its label stays put and the
                  Sparkles/Loader2 pair swaps underneath), and the one
                  notifications-tab.tsx argues for at length. Unmounting the
                  control mid-action throws away keyboard focus: a player who
                  got here by tabbing is dumped back at the top of the document
                  the moment they press Enter, and there is nothing to announce
                  when the row finishes.
                */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  // NO CONFIRMATION, EVEN FOR THE LAST ONE. See the header.
                  onClick={() => void onRemove(passkey.id)}
                  disabled={removingId !== null}
                  // THE SPINNER IS DECORATION; THIS IS THE ANNOUNCEMENT. A
                  // screen reader has no way to perceive a swapped icon, so
                  // without `aria-busy` the only feedback for a removal in
                  // flight is visual. It is also what the test asserts on,
                  // deliberately — pinning `.animate-spin` would couple the
                  // suite to a Tailwind class and break on a spinner swap that
                  // changed nothing a user can tell.
                  aria-busy={removingId === passkey.id}
                >
                  {removingId === passkey.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span className="sr-only">{removeLabel(passkey.name, passkey.createdAt)}</span>
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {/*
        THE BUTTON IS REPLACED, NOT DISABLED, WHERE WEBAUTHN IS MISSING. A
        disabled control with no explanation is a dead end someone will keep
        pressing; the sentence says why, and says what still works — which is
        the whole hard constraint of this feature, that nothing else was taken
        away.
      */}
      {!hydrated ? null : supported ? (
        <Button type="button" className="self-start" disabled={adding} onClick={() => void onAdd()}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Add a passkey
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          This browser can&rsquo;t use passkeys. You can still sign in with an email code or a social
          account.
        </p>
      )}
    </div>
  )
}
