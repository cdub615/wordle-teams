import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/database.types'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { mapEventToTransition } from './events'
import { notifyBilling } from './notify'

// Persists and applies a verified Polar webhook.
// See docs/superpowers/specs/2026-07-31-polar-migration-design.md.
//
// THIS MODULE MUST NOT CARRY THE 'use server' DIRECTIVE. These functions previously lived in
// src/app/me/actions.ts, which does, and in Next.js every export of a 'use server' module is a
// public HTTP endpoint. They take a caller-supplied event, use the service-role client, and
// write membership_status — so as actions they let anyone grant themselves Pro without paying
// or without any signature ever being checked. See wordle-teams-8uk. Here they are ordinary
// server-side functions reachable only from the webhook route.

export type WebhookOutcome =
  | { kind: 'processed' }
  // Already handled. Standard Webhooks retries any non-2xx, so redelivery is routine.
  | { kind: 'duplicate' }
  // Accepted but not actionable, and retrying will never help.
  | { kind: 'ignored'; reason: string }
  | { kind: 'failed'; message: string }

export type VerifiedPolarEvent = {
  eventType: string
  playerId: string
  webhookId: string
  body: Json
}

// Postgres error codes surfaced through PostgREST.
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

export async function handlePolarEvent(event: VerifiedPolarEvent): Promise<WebhookOutcome> {
  const { eventType, playerId, webhookId, body } = event

  try {
    const supabase = createAdminClient(await cookies())

    const { data: stored, error: insertError } = await supabase
      .from('webhook_events')
      .insert({ event_name: eventType, body, player_id: playerId, webhook_id: webhookId })
      .select('id')
      .single()

    if (insertError) {
      // The partial unique index on webhook_id makes redelivery a no-op instead of a second
      // membership change.
      if (insertError.code === UNIQUE_VIOLATION) {
        log.info('Duplicate Polar webhook ignored', { webhookId, eventType })
        return { kind: 'duplicate' }
      }

      // external_id was a well-formed uuid but names no player. Retrying cannot fix that, and
      // webhook_events.player_id is NOT NULL with an FK, so the row can never be stored.
      if (insertError.code === FOREIGN_KEY_VIOLATION) {
        log.warn('Polar webhook references an unknown player', { webhookId, eventType, playerId })
        return { kind: 'ignored', reason: 'unknown-player' }
      }

      log.error('Failed to store Polar webhook event', { error: insertError, webhookId, eventType })
      return { kind: 'failed', message: 'Failed to store webhook event' }
    }

    const transition = mapEventToTransition(eventType)

    // Recognized-but-inert events (subscription.canceled, subscription.past_due) and anything
    // unrecognized land here. The row is kept for the audit trail; membership is untouched.
    if (!transition) {
      await markProcessed(supabase, stored.id, '')
      // subscription.canceled and past_due reach LogSnag from here — they change no membership
      // but are the two worth knowing about while the person is still a customer.
      await notifyBilling(eventType, playerId)
      return { kind: 'processed' }
    }

    const { error: updateError } = await supabase
      .from('player_customer')
      .update({ membership_status: transition.status })
      .eq('player_id', playerId)

    if (updateError) {
      log.error('Failed to update player_customer', { error: updateError, playerId, eventType })
      await markProcessed(supabase, stored.id, updateError.message)
      return { kind: 'failed', message: 'Failed to update player_customer' }
    }

    if (transition.rpc) {
      const { error: rpcError } = await supabase.rpc(transition.rpc, { player_id_input: playerId })

      if (rpcError) {
        log.error(`Failure in ${transition.rpc}`, { error: rpcError, playerId, eventType })
        await markProcessed(supabase, stored.id, rpcError.message)
        return { kind: 'failed', message: `Failure in ${transition.rpc}` }
      }
    }

    await markProcessed(supabase, stored.id, '')
    // Only after the membership change actually succeeded, so a notification never announces
    // something that did not happen. Awaited rather than fired and forgotten: a serverless
    // instance can be frozen once the response is sent, which would drop the request.
    await notifyBilling(eventType, playerId)
    return { kind: 'processed' }
  } catch (error) {
    log.error('Unexpected error handling Polar webhook', { error, webhookId, eventType })
    return { kind: 'failed', message: 'Failed to process webhook event' }
  }
}

async function markProcessed(
  supabase: ReturnType<typeof createAdminClient>,
  id: number,
  processingError: string
) {
  const { error } = await supabase
    .from('webhook_events')
    .update({ processed: true, processing_error: processingError })
    .eq('id', id)

  // Deliberately not fatal. The membership change already succeeded or failed on its own terms,
  // and returning 500 here would make Polar redeliver an event that was in fact applied.
  if (error) log.error('Failed to mark webhook event processed', { error, id })
}
