'use node'

// TEMPORARY — spike S2 (wt-ksh.7.27). Delete once it has answered.
//
// THE QUESTION: does `web-push` import and execute on Convex's Node runtime?
// Nothing else in Phase 6 can be built on push until this is known, and no gate
// can answer it — lint, typecheck, vitest and build all pass against code that
// cannot run. Phase 5 shipped `validateEvent` through all four green and it
// died on `Buffer is not defined`; only a live request found it.
//
// Measured on the DEFAULT runtime before writing this, which is why the
// directive above is load-bearing rather than precautionary:
//   hasBuffer false   hasCrypto true   hasSubtle true
// WebCrypto is there; Node's Buffer is not, and web-push needs it for VAPID JWT
// signing and AES128GCM payload encryption.
//
// internalAction, not action: a public endpoint that posts to an arbitrary push
// URL is a small relay, and this only needs to be reachable from the Convex
// dashboard, which can run internal functions.
import { v } from 'convex/values'
import webpush from 'web-push'
import { internalAction } from './_generated/server'

export const probe = internalAction({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (_ctx, { endpoint, p256dh, auth }) => {
    // Reported back so a failure distinguishes "the runtime is wrong" from
    // "the config is wrong" without a second round trip.
    const env = {
      hasBuffer: typeof Buffer !== 'undefined',
      hasSubject: Boolean(process.env.VAPID_SUBJECT),
      hasPublicKey: Boolean(process.env.VAPID_PUBLIC_KEY),
      hasPrivateKey: Boolean(process.env.VAPID_PRIVATE_KEY),
    }

    if (!env.hasSubject || !env.hasPublicKey || !env.hasPrivateKey) {
      return { ok: false as const, stage: 'config' as const, env }
    }

    try {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT!,
        process.env.VAPID_PUBLIC_KEY!,
        process.env.VAPID_PRIVATE_KEY!,
      )
    } catch (error) {
      return { ok: false as const, stage: 'setVapidDetails' as const, env, error: String(error) }
    }

    try {
      const result = await webpush.sendNotification(
        { endpoint, keys: { p256dh, auth } },
        JSON.stringify({ title: 'Wordle Teams', body: 'S2 probe — push works.', url: '/' }),
      )
      return { ok: true as const, stage: 'sent' as const, env, statusCode: result.statusCode }
    } catch (error) {
      // The push services answer with a statusCode worth seeing: 403 is a VAPID
      // mismatch, 404/410 a dead subscription, 400 a malformed request.
      const statusCode = (error as { statusCode?: number }).statusCode ?? null
      const body = (error as { body?: string }).body ?? null
      return {
        ok: false as const,
        stage: 'sendNotification' as const,
        env,
        statusCode,
        body,
        error: String(error),
      }
    }
  },
})
