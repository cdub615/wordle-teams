import { convexQuery, useConvexAuth, useConvexMutation } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api } from '../../convex/_generated/api'
import { captureError } from '#/lib/sentry-capture.ts'

/**
 * What to write, given what the player's row already has and what the
 * browser just reported. Takes the RAW readings, not pre-computed booleans —
 * `storedTimeZone` is the stored value as-is and both standalone signals are
 * passed separately — so the polarity of "does this player already have a
 * zone" and the OR between the two standalone checks live inside this tested
 * function, not at the call site where a flipped comparison or a dropped
 * disjunct would be invisible to every test here.
 *
 * Separated from the effect below because this is policy worth pinning on its
 * own: what to write is a decision about the player's row, independent of
 * which platform reported it. (`window.matchMedia` happens to be unavailable
 * in both the edge-runtime environment this suite runs under AND jsdom, so a
 * test that had to drive `useLocalCapture` itself to reach this logic would
 * need to stub that read regardless — seeing that isn't necessary is a
 * secondary benefit, not the reason for the split.)
 */
export function decideLocalCapture({
  storedTimeZone,
  storedHasPwa,
  resolvedZone,
  displayModeStandalone,
  navigatorStandalone,
}: {
  storedTimeZone: string | null
  storedHasPwa: boolean
  resolvedZone: string
  displayModeStandalone: boolean
  navigatorStandalone: boolean
}): { writeZone: string | null; writePwa: boolean } {
  // Matches v1's guard (app-bar-base.tsx:51): `''` counts as missing, not as
  // an existing zone. `updateTimeZoneFor` rejects `''` and nothing in this
  // app's picker writes it, but a copied row could carry it, and reading `''`
  // as "already has a zone" would leave that player permanently invisible to
  // the reminder sweep (convex/reminders.ts's `if (!timeZone) return []`)
  // with no write ever attempted to fix it.
  const hasTimeZone = storedTimeZone !== null && storedTimeZone.length > 0
  const isStandalone = displayModeStandalone || navigatorStandalone
  return {
    writeZone: hasTimeZone ? null : resolvedZone,
    writePwa: isStandalone && !storedHasPwa,
  }
}

/**
 * Records two things the player never tells us directly: which zone they are
 * in, and whether they have installed the app.
 *
 * PORTED FROM v1 (app-bar-base.tsx:31-68) AND LOAD-BEARING. The reminder sweep
 * skips any player with no timeZone, and until this ran, nobody who signed up in
 * v2 had one — so the whole feature was silently inert for every new account
 * while looking configured. THIS HOOK BEING MOUNTED IS THE ONLY THING THAT
 * STILL PREVENTS THAT: `decideLocalCapture` above is exhaustively tested, but
 * nothing in this file's own suite fails if `useLocalCapture()` is deleted
 * from Header.tsx entirely — see e2e/settings.spec.ts's "signing in with no
 * stored zone" test, which is the one thing that actually notices.
 *
 * SILENT ON PURPOSE. Neither write is something the player asked for, so neither
 * toasts. A failure is reported and otherwise ignored: this is telemetry for a
 * daily email, not a transaction.
 *
 * STORES WHAT THE BROWSER SAYS, UNMAPPED. v1 translated this into the spelling
 * Postgres wanted before writing; v2 has no Postgres, so a new row carries the
 * canonical IANA name. Copied rows keep v1's older spellings, and
 * time-zones.ts's canonicalTimeZone translates those at READ time — one
 * direction, at the boundary that needs it, rather than rewriting data.
 *
 * NOT WRAPPED IN TANSTACK'S `useMutation`, UNLIKE EVERY OTHER MUTATION CALLER
 * IN THIS CODEBASE. Those wrap `useConvexMutation` to get `mutateAsync` and a
 * pending flag for a toast or a disabled button; this hook has neither, so the
 * `ReactMutation` `useConvexMutation` returns is called directly — it is itself
 * a callable that returns a `Promise` (convex/react's `useMutation`, re-exported
 * under this name).
 */
export function useLocalCapture() {
  const { isAuthenticated } = useConvexAuth()
  const { data: settings } = useQuery(
    convexQuery(api.settings.mySettings, isAuthenticated ? {} : 'skip'),
  )
  const updateTimeZone = useConvexMutation(api.settings.updateTimeZone)
  const markPwaInstalled = useConvexMutation(api.settings.markPwaInstalled)

  // NOT guarding against a plain re-render — `updateTimeZone`, `markPwaInstalled`
  // and (in ordinary operation) `settings` are all referentially stable between
  // renders, so this effect does not just refire on its own. Two real triggers
  // make the guard necessary anyway: React StrictMode double-invokes effects in
  // development, and an unrelated patch to this same players row (the settings
  // dialog's own reminder-time or delivery-method change) pushes a NEW
  // `mySettings` object while this write is still in flight — same `timeZone`,
  // different object identity, which re-runs the effect regardless.
  //
  // Flips at ATTEMPT time, not on success — a rejected write leaves the flag
  // `true` and no retry happens in this tab. That is deliberate: this is the
  // guard against a rejection loop, not a retry policy. A fresh mount (the next
  // sign-in, a reload) gets a fresh ref and tries again.
  const attemptedZone = useRef(false)
  const attemptedPwa = useRef(false)

  /**
   * RESET WHEN THE SESSION ENDS (`wordle-teams-uhx`).
   *
   * The refs above are per-MOUNT, and `Header` mounts once in `__root.tsx` and
   * never unmounts — so without this they live as long as the tab, not as long
   * as the account. Sign out and back in as a DIFFERENT account with no full
   * page reload and `attemptedZone` is still `true`, so the second brand-new
   * account never gets a `timeZone` written.
   *
   * THAT FAILURE IS SILENT AND PERMANENT, which is why this is worth five lines
   * for a path that does not exist yet: `convex/reminders.ts` skips any player
   * without a `timeZone`, so that account is never reminded, forever, with
   * nothing logged and nothing in the UI to suggest why.
   *
   * REACHABLE SINCE `wordle-teams-lyab`, WHICH ADDED THE SIGN-OUT THIS WAS
   * WAITING FOR. It was written while v2 had none — nothing in `src/` called
   * `signOut` — and armed ahead of the feature rather than left as a note for
   * whoever added it, on the reasoning that the person adding sign-out has no
   * reason to look here and every reason to assume a hook resets itself. That
   * bet paid: `components/app-menu.tsx`'s Log out item now drives exactly the
   * transition described above, and this needed no change to meet it.
   *
   * KEYED ON `isAuthenticated` GOING FALSE, not on a player identity, because
   * `mySettings` does not return one — so the hook cannot see an account SWAP
   * directly. The sign-out that must sit between two sessions is what it can
   * see, and it is sufficient: any switch passes through it.
   */
  useEffect(() => {
    if (isAuthenticated) return
    attemptedZone.current = false
    attemptedPwa.current = false
  }, [isAuthenticated])

  useEffect(() => {
    if (!settings) return

    // Both standalone signals are kept even though iOS Safari has supported
    // `(display-mode: standalone)` since iOS 13 (v1 predates that support and
    // relied on `navigator.standalone` alone). Belt-and-suspenders: neither
    // read is expensive, and dropping either would silently stop covering
    // whatever platform still needs it.
    const decision = decideLocalCapture({
      storedTimeZone: settings.timeZone,
      storedHasPwa: settings.hasPwa,
      resolvedZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
      navigatorStandalone: (window.navigator as { standalone?: boolean }).standalone === true,
    })

    if (decision.writeZone !== null && !attemptedZone.current) {
      attemptedZone.current = true
      // updateTimeZone THROWS INVALID_TIME_ZONE if the server's Intl rejects
      // what the browser resolved (convex/settings.ts's updateTimeZoneFor).
      // Caught here rather than left to reject into a dangling promise — this
      // write has no UI to surface a failure to, so the only other outcome is
      // an unhandled rejection.
      void updateTimeZone({ timeZone: decision.writeZone }).catch((error: unknown) =>
        captureError(error, { where: 'useLocalCapture.timeZone', resolved: decision.writeZone }),
      )
    }

    if (decision.writePwa && !attemptedPwa.current) {
      attemptedPwa.current = true
      void markPwaInstalled({}).catch((error: unknown) =>
        captureError(error, { where: 'useLocalCapture.hasPwa' }),
      )
    }
  }, [settings, updateTimeZone, markPwaInstalled])
}
