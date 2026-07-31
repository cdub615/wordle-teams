import 'server-only'

import { PolarError } from '@polar-sh/sdk/models/errors/polarerror.js'
import { log } from 'next-axiom'
import { appOrigin, polar } from './client'

// Creates a short-lived Polar customer portal session for a player.
// See docs/superpowers/specs/2026-07-31-polar-migration-design.md.
//
// Resolved by externalCustomerId — the player's own id — rather than a stored Polar customer
// UUID. That is precisely what allowed player_customer.customer_id to be dropped instead of
// retyped from int to uuid.
//
// Portal URLs are short-lived, so this is called at the moment the player clicks and the result
// is never stored.

export type PortalResult =
  | { url: string }
  // The player has no Polar customer record, which is the expected state for anyone who has
  // never checked out. Distinguished from a genuine failure so the UI can say something true
  // rather than "try again later" about a condition retrying will never fix.
  | { url: null; reason: 'no-customer' }
  | { url: null; reason: 'error' }

export async function getCustomerPortalUrl(playerId: string): Promise<PortalResult> {
  try {
    const session = await polar().customerSessions.create({
      externalCustomerId: playerId,
      returnUrl: `${appOrigin()}/me`,
    })

    return { url: session.customerPortalUrl }
  } catch (error) {
    // Matched on status rather than error class. The SDK only raises its typed ResourceNotFound
    // for responses declared in the OpenAPI spec, and customerSessions.create does not declare a
    // 404 — it throws the generic SDKError instead. An `instanceof ResourceNotFound` check
    // therefore never matches, and every player who has not checked out would be told to try
    // again later, forever. Both classes extend PolarError, which carries statusCode, so this
    // holds whichever one a future SDK version throws.
    if (error instanceof PolarError && error.statusCode === 404) {
      log.info('No Polar customer for player; portal unavailable', { playerId })
      return { url: null, reason: 'no-customer' }
    }

    log.error('Failed to create Polar customer portal session', { error, playerId })
    return { url: null, reason: 'error' }
  }
}
