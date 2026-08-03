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
    if (error instanceof PolarError && isMissingCustomer(error)) {
      log.info('No Polar customer for player; portal unavailable', { playerId })
      return { url: null, reason: 'no-customer' }
    }

    log.error('Failed to create Polar customer portal session', { error, playerId })
    return { url: null, reason: 'error' }
  }
}

// Deciding whether "this player has no billing account" turned out to need three attempts, so
// the reasoning is written down.
//
// Polar does NOT answer an unknown external_customer_id with a 404. It answers 422 with a
// validation detail of "Customer does not exist." — verified against the sandbox API for a
// non-UUID id, a well-formed-but-unknown UUID, and an empty string alike. Earlier versions of
// this function tested `instanceof ResourceNotFound` (never raised, because the SDK only maps
// typed errors for responses the OpenAPI spec declares) and then `statusCode === 404` (never
// matched, because Polar does not send one). Both left every non-subscriber being told to try
// again later, forever.
//
// A bare 422 is not enough either: Polar also returns 422 for ordinary validation failures such
// as a malformed success_url, and reporting those as "no billing account" would hide real bugs.
// So the detail has to be matched too.
function isMissingCustomer(error: PolarError): boolean {
  if (error.statusCode === 404) return true // not currently sent, accepted if that ever changes
  if (error.statusCode !== 422) return false
  return /customer does not exist/i.test(error.body ?? '')
}
