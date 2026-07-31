import { polarWebhookSecret } from '@/lib/polar/client'
import { handlePolarEvent } from '@/lib/polar/webhook'
import type { Json } from '@/lib/database.types'
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks.js'
import { log } from 'next-axiom'

export const dynamic = 'force-dynamic'

// Polar webhook receiver. See docs/superpowers/specs/2026-07-31-polar-migration-design.md.
//
// Deliberately thin: verify the signature, pull out the two identifiers, hand off. Everything
// that touches the database lives in @/lib/polar/webhook, which is not a 'use server' module and
// so is not reachable as a public action.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers.entries())

  let event
  try {
    // Verifies the Standard Webhooks signature and returns a typed, parsed event.
    event = validateEvent(rawBody, headers, polarWebhookSecret())
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      log.warn('Rejected Polar webhook with an invalid signature')
      return new Response('Invalid signature', { status: 403 })
    }

    log.error('Failed to parse Polar webhook', { error })
    return new Response('Invalid payload', { status: 400 })
  }

  // Standard Webhooks puts the delivery id in a header, unlike Lemon Squeezy which carried it in
  // meta.webhook_id. Retries reuse the same id, which is what makes replay detection possible.
  const webhookId = headers['webhook-id']
  if (!webhookId) {
    log.error('Polar webhook arrived without a webhook-id header', { eventType: event.type })
    return new Response('Missing webhook-id', { status: 400 })
  }

  // The only link between a Polar customer and a player. Set as external_customer_id at checkout
  // and echoed back on every event.
  const playerId = (event.data as { customer?: { externalId?: string | null } }).customer?.externalId

  // 202, not 500: a foreign or malformed external_id is not a transient fault, so retrying can
  // never succeed. Returning 500 would put Polar into an endless redelivery loop over an event
  // this app can do nothing with — for instance one belonging to a different integration on the
  // same organization.
  if (!playerId || !UUID.test(playerId)) {
    log.warn('Polar webhook has no usable player external_id; acknowledging without processing', {
      eventType: event.type,
      webhookId,
    })
    return new Response('Accepted, no matching player', { status: 202 })
  }

  const outcome = await handlePolarEvent({
    eventType: event.type,
    playerId,
    webhookId,
    body: JSON.parse(rawBody) as Json,
  })

  switch (outcome.kind) {
    case 'processed':
    case 'duplicate':
      return new Response('OK', { status: 200 })
    case 'ignored':
      return new Response(`Accepted, ${outcome.reason}`, { status: 202 })
    case 'failed':
      // 500 asks Polar to retry, which is correct for a genuinely transient database failure.
      return new Response(outcome.message, { status: 500 })
  }
}
