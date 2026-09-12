import { useConvexAuth, useConvexMutation } from '@convex-dev/react-query'
import { useEffect, useRef } from 'react'
import { api } from '../../convex/_generated/api'
import { captureError } from '#/lib/sentry-capture.ts'

/**
 * Mirrors the caller's OWN Better Auth profile image onto their player row, so
 * TEAMMATES can see it — their session cannot read your Better Auth record, and
 * players.socialImage is the only way that photo reaches them.
 *
 * MOUNTED IN Header.tsx, NOT IN A ROUTE, AND THAT IS THE WHOLE POINT OF THIS
 * FILE. It lived in routes/app.tsx's Dashboard until 2026-09-12, which meant the
 * write happened on ONE route while the header read the result on EVERY route.
 * A signed-in player who opened /chat, /team or /me and never the dashboard
 * never mirrored at all. Header mounts globally, so any authenticated page now
 * does it. (The regression that found this is on wordle-teams-wty4.1.1: a
 * GitHub user's avatar disappeared from their own header.)
 *
 * YOUR OWN AVATAR NO LONGER DEPENDS ON THIS, WHICH IS THE OTHER HALF OF THAT
 * FIX. players.myName falls back to the live `user.image` for the caller, so
 * this hook's timing cannot affect what YOU see — only how soon your teammates
 * see you, which was always eventual.
 *
 * A REF GUARD AS WELL AS THE DEPS ARRAY, matching use-local-capture.ts's
 * attemptedZone/attemptedPwa pattern. `useConvexMutation`'s callable is
 * memoised on [convex, functionName] and both are stable, so the deps array
 * alone should fire this once per mount — but React documents useMemo as a hint
 * it MAY discard rather than a guarantee, and this hook's sibling already wears
 * the belt and braces. An extra fire is a server-side no-op (shouldSyncSocialImage
 * decides nothing needs writing), so this costs nothing and removes a class of
 * doubt.
 */
export function useSocialImageSync() {
  const { isAuthenticated } = useConvexAuth()
  const syncSocialImage = useConvexMutation(api.players.syncSocialImage)
  const attempted = useRef(false)

  useEffect(() => {
    // A signed-out visitor has no Better Auth user and no player row; the
    // mutation would resolve nothing and return silently, so do not call it.
    if (!isAuthenticated || attempted.current) return
    attempted.current = true

    /**
     * CAPTURED, NOT SWALLOWED. The first version of this wrote
     * `.catch(() => {})`, and when the mirror stopped populating there was no
     * evidence anywhere to say whether it had failed or simply never run. That
     * silence cost more than the failure did.
     *
     * Still no toast: this is a background convenience and a failure costs
     * initials until the next load, which is not worth interrupting anyone for.
     */
    void syncSocialImage({}).catch((error: unknown) =>
      captureError(error, { where: 'useSocialImageSync' }),
    )
  }, [isAuthenticated, syncSocialImage])
}
