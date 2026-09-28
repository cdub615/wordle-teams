/**
 * LogSnag delivery for the login funnel (wt-ksh.12.11).
 *
 * SERVER ONLY. The LogSnag token is a secret — v1 reads it as
 * process.env.LOGSNAG_TOKEN and constructs the client server-side
 * (src/lib/utils.ts:16). It must never reach the browser, which is why the
 * client posts to our own /api/funnel route and this module does the delivery.
 *
 * Called via fetch rather than the `logsnag` npm package: one less dependency,
 * and the REST call is a few lines on a Worker.
 */

import { captureError } from './sentry-capture'

const LOGSNAG_URL = 'https://api.logsnag.com/v1/log'

/** Same project as v1, so both funnels land in one place and stay comparable. */
const PROJECT = 'wordle-teams'

/**
 * A channel of its own. v1 posts signups to `users` with notify: true; funnel
 * events are far higher volume and must not drown that or fire notifications.
 */
const CHANNEL = 'login-funnel'

type Payload = {
  event: string
  icon: string
  tags: Record<string, string>
}

/**
 * Deliver one event. Resolves either way — callers must never fail because
 * analytics did. Returns whether it was actually sent, for the route's logging.
 */
export async function sendToLogSnag(payload: Payload): Promise<boolean> {
  const token = process.env.LOGSNAG_TOKEN
  if (!token) return false // unconfigured: a no-op, not an error

  try {
    const res = await fetch(LOGSNAG_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        project: PROJECT,
        channel: CHANNEL,
        event: payload.event,
        icon: payload.icon,
        notify: false,
        tags: payload.tags,
      }),
    })
    if (!res.ok) {
      // Reported, not thrown. A 4xx here means our payload or token is wrong
      // and we want to know, but the user's sign-in is not affected.
      captureError(new Error(`LogSnag responded ${res.status}`), {
        kind: 'funnel-delivery',
        event: payload.event,
      })
      return false
    }
    return true
  } catch (error) {
    captureError(error, { kind: 'funnel-delivery', event: payload.event })
    return false
  }
}
