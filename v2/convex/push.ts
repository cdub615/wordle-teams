/**
 * Web push subscription storage.
 *
 * SPLIT FROM pushSend.ts DELIBERATELY, and not for tidiness: a 'use node' file
 * can contain only actions, so the reads and writes the delivery action needs
 * cannot live beside it and are reached through ctx.runQuery / ctx.runMutation.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { accessError, requirePlayer } from './access.ts'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

type SubscriptionInput = { endpoint: string; p256dh: string; auth: string }

/**
 * Whether `endpoint` is safe to hand to `webpush.sendNotification`, which
 * `https.request`s whatever host it parses out of it. Only a parseable URL
 * with protocol exactly `https:` passes — not a regex, because a hand-rolled
 * pattern is exactly the kind of check that looks right and lets something
 * through; the platform `URL` constructor is what actually parses a URL the
 * way the request path will.
 */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export async function saveSubscriptionFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  subscription: SubscriptionInput,
): Promise<void> {
  // REJECTED HERE, NOT JUST AT THE PUBLIC MUTATION, so every writer is
  // covered. A real browser's Push API never hands back anything but an
  // https: endpoint; a value that fails this check is a hand-built or
  // tampered request, aimed at making pushSend.ts's `https.request` reach an
  // arbitrary host on this deployment's dime. The rejected value is never
  // logged or echoed back — see INVALID_PUSH_ENDPOINT's copy in
  // src/lib/convex-error.ts.
  if (!isHttpsUrl(subscription.endpoint)) throw accessError('INVALID_PUSH_ENDPOINT')

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

export async function removeByEndpointFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  endpoint: string,
): Promise<void> {
  const existing = await ctx.db
    .query('pushSubscriptions')
    .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
    .first()

  // ABSENT, OR PRESENT BUT NOT YOURS: BOTH SILENT NO-OPS, never a throw.
  // Absent is success, not failure — the 410 path can race a sign-out that
  // already removed the row, and a throw would turn a completed cleanup into
  // a failed action. "Not yours" gets the SAME treatment, on purpose, and not
  // as a lesser version of the same idea: a caller who does not own the row
  // must not be able to tell "this endpoint does not exist" apart from "this
  // endpoint exists but is someone else's" by watching which one throws —
  // that distinction is a probe for other players' endpoints, one call at a
  // time. A row landing here that names no matching playerId simply is not
  // this caller's to remove, and the function returns exactly as if it had
  // found nothing at all.
  if (existing && existing.playerId === playerId) await ctx.db.delete(existing._id)
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
    // AUTHENTICATED AND SCOPED TO THE OWNER. requirePlayer stops an
    // unauthenticated caller from unsubscribing anyone's device at all, and
    // passing its `_id` into removeByEndpointFor is what stops an
    // AUTHENTICATED one from removing a row that is not theirs: that function
    // deletes only when the row's playerId matches. Absent, or present but
    // owned by someone else, are both silent no-ops rather than a throw — see
    // removeByEndpointFor's own comment for why a throw on "not yours" would
    // be a probe, not just an inconsistency.
    const player = await requirePlayer(ctx)
    await removeByEndpointFor(ctx, player._id, endpoint)
  },
})

export const subscriptionsFor = internalQuery({
  args: { playerId: v.id('players') },
  handler: async (ctx, { playerId }) => await subscriptionsForPlayer(ctx, playerId),
})

/**
 * `playerId` HERE IS THE RIGHT ONE, NOT MERELY AN AVAILABLE ONE. This
 * mutation's only caller is pushSend.ts's 404/410 branch inside `deliverTo`,
 * which already has `playerId` in scope — it is the same id `deliverTo` was
 * invoked with, and the same one `subscriptionsFor({ playerId })` used to
 * fetch the very subscription that just 404/410'd. So the row being deleted
 * is provably this player's own, not a value threaded through on the
 * assumption that it would line up.
 */
export const removeByEndpoint = internalMutation({
  args: { playerId: v.id('players'), endpoint: v.string() },
  handler: async (ctx, { playerId, endpoint }) => await removeByEndpointFor(ctx, playerId, endpoint),
})
