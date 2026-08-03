import 'server-only'

import { logsnagClient } from '@/lib/utils'
import { log } from 'next-axiom'

// Publishes billing events to LogSnag from the Polar webhook.
// See docs/superpowers/specs/2026-07-31-polar-migration-design.md and wordle-teams-sv2.
//
// Replaces the Lemon Squeezy integration that posted to integ.logsnag.com. That endpoint parses
// Lemon Squeezy payload shapes and cannot be repointed at Polar, and LogSnag offers no Polar
// integration — but none is needed, since the app already holds a LogSnag token and already
// verifies these webhooks. Doing it here keeps the notifications provider-agnostic: swapping
// billing providers again would not touch this file.
//
// Identified by player id rather than email. LogSnag is a third party and the migration's whole
// identity model is built on player id, so there is no reason to send an address as well.

const NOTIFICATIONS = new Map<string, { event: string; icon: string }>([
  ['subscription.active', { event: 'Subscription Started', icon: '🎉' }],
  // Fires when a cancellation is SCHEDULED, which is well before access ends. The only billing
  // signal that arrives while the person is still a paying customer, and the only one there is
  // any point reacting to.
  ['subscription.canceled', { event: 'Cancellation Scheduled', icon: '⚠️' }],
  ['subscription.revoked', { event: 'Subscription Ended', icon: '👋' }],
  ['subscription.past_due', { event: 'Payment Failed', icon: '💳' }],
])

// Never throws. A LogSnag outage must not fail the webhook: returning 500 would make Polar
// redeliver a membership change that has already been applied, so a missed notification is
// strictly preferable to a retried event.
export async function notifyBilling(eventType: string, playerId: string): Promise<void> {
  const notification = NOTIFICATIONS.get(eventType)
  if (!notification) return

  try {
    await logsnagClient().track({
      channel: 'billing',
      event: notification.event,
      user_id: playerId,
      icon: notification.icon,
      notify: true,
      tags: {
        env: process.env.ENVIRONMENT ?? 'unknown',
        polar_event: eventType,
      },
    })
  } catch (error) {
    log.warn('Failed to publish billing event to LogSnag', { error, eventType, playerId })
  }
}
