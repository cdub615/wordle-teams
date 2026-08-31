'use node'

import { v } from 'convex/values'
import webpush from 'web-push'
import { internalAction } from './_generated/server'
import { internal } from './_generated/api'
import { safePushErrorLog } from './lib/pushErrors.ts'

const RETRY_DELAY_MS = 60_000

/**
 * Deliver one player's reminder to every endpoint they have registered.
 *
 * 'use node' IS LOAD-BEARING. web-push signs a VAPID JWT and encrypts the
 * payload with AES128GCM, both of which need Node crypto that Convex's default
 * runtime does not have. Proven on beta before this file was written — see
 * spike S2, and Phase 5's `Buffer is not defined`, which is the same failure
 * one phase earlier and reached production-shaped code through four green
 * gates.
 *
 * `attempt` BOUNDS THE RETRY. This action reschedules ITSELF, so without a stop
 * condition a push service having a bad hour becomes an infinite loop against
 * it. One retry, then log and stop. The bound is an argument checked in one
 * place rather than a comment promising restraint.
 *
 * WHY A RETRY AT ALL: sweep claims a player before delivering (divergence 16),
 * and the hour window makes each player eligible during exactly one cron run
 * per day — so a failure here is not picked up by the next tick. Nothing else
 * would try again.
 *
 * THE RETRY IS PER-PLAYER, NOT PER-ENDPOINT, and that has an accepted cost: it
 * resends to EVERY subscription this player has, including one that already
 * succeeded, and the payload carries no `tag` for the push service to collapse
 * duplicates on. A two-device player where one endpoint 429s gets a second
 * notification on the healthy device. This is what the plan specifies, not an
 * oversight — see wordle-teams-vsx, which tracks whether that's worth
 * narrowing later.
 */
export const deliverTo = internalAction({
  args: { playerId: v.id('players'), attempt: v.number() },
  handler: async (ctx, { playerId, attempt }) => {
    const subject = process.env.VAPID_SUBJECT
    const publicKey = process.env.VAPID_PUBLIC_KEY
    const privateKey = process.env.VAPID_PRIVATE_KEY

    // A MISCONFIGURATION, NOT AN OUTAGE, and worth telling apart in the log —
    // the same distinction Phase 5 drew on both billing paths. Retrying would
    // not help, so do not.
    if (!subject || !publicKey || !privateKey) {
      console.error('[reminders] VAPID is not configured on this deployment', {
        hasSubject: Boolean(subject),
        hasPublicKey: Boolean(publicKey),
        hasPrivateKey: Boolean(privateKey),
      })
      return
    }

    try {
      // A PRESENT BUT MALFORMED VALUE — wrong length, padded base64, a
      // non-https/non-mailto subject — throws SYNCHRONOUSLY here
      // (web-push's vapid-helper.js validators), before any subscription is
      // touched. A truncated paste into `convex env` is the likeliest real
      // VAPID failure this deployment will see, more likely than the absent
      // case above, so this has to be caught rather than left to kill the
      // action with a raw stack trace. Same branch, same reasoning as the
      // absent case: a bad value stays bad, so no retry is scheduled. The key
      // values themselves are never in the thrown message (checked against
      // web-push's validators) and safePushErrorLog is used anyway, on
      // principle, rather than trusting that to stay true.
      webpush.setVapidDetails(subject, publicKey, privateKey)
    } catch (error) {
      console.error(
        '[reminders] VAPID is configured but invalid on this deployment',
        safePushErrorLog(error),
      )
      return
    }

    const subscriptions = await ctx.runQuery(internal.push.subscriptionsFor, { playerId })
    if (subscriptions.length === 0) return

    // THE OTHER COPY OF THIS COPY IS v2/src/sw.ts's `readReminder` fallback,
    // which renders these exact three strings when `event.data.json()` throws
    // — a truncated or non-JSON push body. Byte-identical today. Not shared as
    // a module: this is a Convex 'use node' action and that is a browser
    // service worker bundled separately by scripts/build-sw.mjs, so there is no
    // import path between them that does not drag one runtime into the other.
    // CHANGE BOTH, or the notification a user sees on a malformed push quietly
    // stops matching the one they see normally.
    const payload = JSON.stringify({
      title: 'Wordle Teams',
      body: "You have not entered today's board yet. Don't miss out on those points!",
      url: '/app',
    })

    // NOT "TRANSIENT" — the name would claim more than this loop can know.
    // Everything that isn't 404/410 sets this, including failures that will
    // never succeed on retry (a malformed stored p256dh, a 400, an endpoint
    // that no longer parses) alongside real transient ones (a 5xx, a
    // timeout). The bound in `attempt` is what keeps a permanent failure to
    // one wasted retry rather than an infinite one — this flag just means
    // "not a 404/410, so worth trying once more".
    let retryableFailure = false

    for (const subscription of subscriptions) {
      try {
        // A 2xx HERE MEANS THE PUSH SERVICE ACCEPTED THE REQUEST, NOTHING MORE.
        // Spike S2 saw statusCode 201 and no notification rendered: acceptance
        // is not decryption, and decryption is not delivery. This loop cannot
        // observe delivery at all, only whether the push service took the
        // request or rejected it.
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        )
      } catch (error) {
        // READ ONCE, THROUGH THE SAME NARROWING safePushErrorLog APPLIES.
        // A bare `(error as { statusCode?: number }).statusCode` would trust
        // the cast instead of checking it, so a stringly-typed '410' would
        // fail the === 404/410 comparison below, skip the delete, and retry a
        // permanently-dead subscription forever — the exact failure the
        // comment on that branch says cannot happen.
        const logSafe = safePushErrorLog(error)

        // 404/410 mean the browser threw the subscription away — an uninstall, a
        // cleared profile, a revoked permission. Expected, not an error, and the
        // row must go or it is retried forever.
        if (logSafe.statusCode === 404 || logSafe.statusCode === 410) {
          // `playerId` is the same one this action was invoked with, and the
          // same one `subscriptionsFor` used to fetch `subscription` in the
          // first place — see removeByEndpoint's own comment for why that
          // makes it provably the right id and not just an available one.
          await ctx.runMutation(internal.push.removeByEndpoint, {
            playerId,
            endpoint: subscription.endpoint,
          })
          continue
        }

        // Everything else. THE RAW `error` IS NEVER PASSED TO THE LOGGER.
        // WebPushError (web-push's src/web-push-error.js) sets `endpoint` as
        // an own enumerable property right alongside `statusCode` — the same
        // kind of property a logger or JSON.stringify prints without being
        // asked to — so forwarding the error itself, or even `{ ...error }`,
        // would leak the capability URL regardless of what this comment
        // claims. safePushErrorLog reads exactly `statusCode` and `message`
        // off it and nothing else, which is what makes leaving `endpoint` out
        // an actual guarantee rather than a hope. `subscription._id` stands in
        // for the endpoint as the thing that identifies WHICH row failed: it
        // is a Convex document id, not a capability, so it is safe to keep.
        console.error('[reminders] push delivery failed', {
          playerId,
          subscriptionId: subscription._id,
          ...logSafe,
        })
        retryableFailure = true
      }
    }

    if (retryableFailure && attempt === 0) {
      await ctx.scheduler.runAfter(RETRY_DELAY_MS, internal.pushSend.deliverTo, {
        playerId,
        attempt: 1,
      })
    }
  },
})
