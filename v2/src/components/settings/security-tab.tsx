import { KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { authClient } from '#/lib/auth-client.ts'
import { passkeySupported, rememberPasskeyRegistered } from '#/lib/passkey.ts'
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
export function addedLabel(createdAt: Date | string | null | undefined, locale?: string): string | null {
  if (createdAt === null || createdAt === undefined) return null
  const at = new Date(createdAt)
  if (!Number.isFinite(at.getTime())) return null
  return `Added ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(at)}`
}

/**
 * Security tab of the settings dialog: the passkeys on this account, with add
 * and remove (wordle-teams-wty4.1.7).
 *
 * THE LIST IS PER-ACCOUNT AND THE OFFER IS PER-DEVICE, and the two must not be
 * confused. Every row here is a credential on the ACCOUNT — most of them
 * belonging to authenticators that are not the one in front of you, and there
 * is no field that says which is which. `src/lib/passkey.ts`'s markers are the
 * per-device half, and the only one this file touches is the write on a
 * successful registration: a passkey has just been created HERE, which is the
 * one moment this device can state that as a fact.
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
 * `/passkey/verify-registration`, `/passkey/delete-passkey` and
 * `/passkey/update-passkey` that re-signals `$listPasskeys` (client.mjs's
 * `atomListeners`), and `registerPasskey` additionally pokes that atom by hand
 * on success. A manual `refetch()` here would be a third redundant round trip
 * for the same list.
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
  // the row actually going shows the spinner. A boolean cannot say both.
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
        toast.error(result.error.message || 'Could not add a passkey.')
        return
      }
      // THE ONE PER-DEVICE WRITE IN THIS FILE, and it is deliberately after the
      // success check rather than beside it: marking a device as having a
      // passkey when registration failed suppresses the post-login offer on a
      // device that has nothing, permanently, with no symptom.
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
        THREE STATES, AND `isPending` IS CHECKED BEFORE `data`. The atom starts
        at `data: null` with `isPending: true`, so a list-vs-empty decision made
        on `data` alone tells every player on a cold open that they have no
        passkeys — and "You have no passkeys yet" is a statement of fact, not a
        loading state, so it reads as an answer rather than a wait.
      */}
      {error ? (
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
                  Header.tsx's Billing button uses, and the one
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
                  // EVERY row's button, not just this one: two removals in
                  // flight against one list is a race with no benefit, and the
                  // list refetches under both of them.
                  disabled={removingId !== null}
                >
                  {removingId === passkey.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {/*
                    THE ACCESSIBLE NAME CARRIES THE ROW, not just the verb. An
                    icon-only button in a list of near-identical rows is
                    announced as "Remove, button" over and over, with nothing
                    saying which one is about to go.
                  */}
                  <span className="sr-only">Remove {passkeyLabel(passkey.name)}</span>
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
