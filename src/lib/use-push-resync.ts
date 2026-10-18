import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../../convex/_generated/api'
import { browserPush, pushStateOfThisDevice } from '#/lib/push-subscribe.ts'

/**
 * Once per page load, the first time this player's methods are known.
 * Module state rather than a ref, so leaving the dashboard and coming back
 * does not save again.
 */
let resyncedThisLoad = false

/**
 * Saves this device's push subscription again when the app opens with push on
 * for the account (the cheap half of wordle-teams-cvvn).
 *
 * WHY: the stored row was a one-time snapshot taken when the switch was
 * flipped. A browser that later re-issues the subscription with new keys
 * leaves a row nothing can decrypt to, and the push service still answers 2xx.
 * savePushSubscription upserts on endpoint, so saving again is idempotent and
 * refreshes the keys. A re-issued ENDPOINT gets a new row here too, and the old
 * one is pruned by pushSend's 404/410 branch.
 *
 * NOT DONE HERE: the service worker's pushsubscriptionchange handler, which
 * covers a player who never opens the app again. cvvn stays open for it.
 *
 * NEVER SURFACES AN ERROR. A failed save is a console.warn with the message
 * only: the endpoint is a capability URL and must not reach the console.
 */
export function usePushResync(): void {
  const { data: settings } = useQuery(convexQuery(api.settings.mySettings, {}))
  const save = useConvexMutation(api.push.savePushSubscription)
  const pushOn = settings?.reminderDeliveryMethods.includes('push') ?? false

  useEffect(() => {
    if (!pushOn || resyncedThisLoad) return
    resyncedThisLoad = true
    void (async () => {
      const state = await pushStateOfThisDevice(browserPush())
      if (state.kind !== 'subscribed') return
      try {
        await save(state.subscription)
      } catch (error) {
        console.warn('Push subscription re-save failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }, [pushOn, save])
}
