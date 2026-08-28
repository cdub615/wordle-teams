/**
 * Web push subscription storage.
 *
 * SPLIT FROM pushSend.ts DELIBERATELY, and not for tidiness: a 'use node' file
 * can contain only actions, so the reads and writes the delivery action needs
 * cannot live beside it and are reached through ctx.runQuery / ctx.runMutation.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { requirePlayer } from './access.ts'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

type SubscriptionInput = { endpoint: string; p256dh: string; auth: string }

export async function saveSubscriptionFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  subscription: SubscriptionInput,
): Promise<void> {
  // UPSERT ON ENDPOINT. Convex has no unique constraints, and a browser hands
  // back the same endpoint with refreshed keys on renewal — so a blind insert
  // gives one device a row per sign-in, and that device N copies of every
  // notification.
  const existing = await ctx.db
    .query('pushSubscriptions')
    .withIndex('by_endpoint', (q) => q.eq('endpoint', subscription.endpoint))
    .first()

  if (existing) {
    await ctx.db.patch(existing._id, {
      // The endpoint can migrate between accounts on a shared device.
      playerId,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    })
    return
  }

  await ctx.db.insert('pushSubscriptions', {
    playerId,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
  })
}

export async function subscriptionsForPlayer(
  ctx: QueryCtx,
  playerId: Id<'players'>,
): Promise<Array<Doc<'pushSubscriptions'>>> {
  return await ctx.db
    .query('pushSubscriptions')
    .withIndex('by_player', (q) => q.eq('playerId', playerId))
    .collect()
}

export async function removeByEndpointFor(ctx: MutationCtx, endpoint: string): Promise<void> {
  const existing = await ctx.db
    .query('pushSubscriptions')
    .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
    .first()
  // Absent is success, not failure. The 410 path can race a sign-out that
  // already removed the row, and a throw would turn a completed cleanup into a
  // failed action.
  if (existing) await ctx.db.delete(existing._id)
}

/**
 * The VAPID public key the browser needs to subscribe.
 *
 * A QUERY RATHER THAN A `VITE_` VARIABLE, so there is one source of truth. A
 * second copy in a second config system is a second thing to set correctly on
 * two deployments, and getting it wrong produces a subscription encrypted to a
 * key nobody holds — which fails at delivery, hours later, not at subscribe.
 *
 * NULL RATHER THAN A THROW when unset, so the UI can hide the Push switch on a
 * deployment where push is not configured instead of offering a control that
 * cannot work.
 */
export const publicKey = query({
  args: {},
  handler: async () => process.env.VAPID_PUBLIC_KEY ?? null,
})

export const savePushSubscription = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, subscription) => {
    const player = await requirePlayer(ctx)
    await saveSubscriptionFor(ctx, player._id, subscription)
  },
})

export const removePushSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    // requirePlayer BUYS AUTHENTICATION, NOT AUTHORIZATION, and the two must
    // not be read as the same thing. It does stop an unauthenticated caller
    // from unsubscribing a stranger's device by guessing or replaying an
    // endpoint. It does NOT check that the endpoint belongs to the caller:
    // removeByEndpointFor filters on nothing but the endpoint, so any
    // signed-in player who obtains someone else's endpoint can remove that
    // row. Whether that should be scoped to the caller's own subscriptions is
    // an open question, not an oversight here — see wordle-teams-6k7.
    await requirePlayer(ctx)
    await removeByEndpointFor(ctx, endpoint)
  },
})

export const subscriptionsFor = internalQuery({
  args: { playerId: v.id('players') },
  handler: async (ctx, { playerId }) => await subscriptionsForPlayer(ctx, playerId),
})

export const removeByEndpoint = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => await removeByEndpointFor(ctx, endpoint),
})
