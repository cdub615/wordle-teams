import 'server-only'

import { log } from 'next-axiom'
import { polar } from './client'

// Works out which player a Polar subscription event belongs to.
// See docs/superpowers/specs/2026-07-31-polar-migration-design.md.
//
// WHY THIS IS NOT JUST `customer.externalId`:
//
// The design assumed external_customer_id set at checkout would always come back on the customer.
// It does not. Polar matches a checkout to an EXISTING customer by email when one exists, and
// does not stamp external_customer_id onto that customer — the value stays on the checkout while
// the customer keeps its own (often null) external_id.
//
// Observed on dev 2026-08-03: a real subscription went active on Pro Annual, the checkout carried
// external_customer_id correctly, and the customer — created months earlier in the Polar sandbox
// — had external_id null. The webhook was delivered and accepted with HTTP 202, and nobody was
// upgraded. Silent, because 202 is not an error.
//
// This is not a sandbox quirk. In production the same thing happens to anyone who already exists
// as a Polar customer under that email, which includes every customer imported by polar-migrate.
//
// So the id is looked for in three places, cheapest first, and the customer is repaired once
// found so later events for the same person do not need the fallback.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SubscriptionIdentity = {
  customer?: { id?: string | null; externalId?: string | null } | null
  customerId?: string | null
  metadata?: Record<string, unknown> | null
  checkoutId?: string | null
}

const asPlayerId = (value: unknown): string | null =>
  typeof value === 'string' && UUID.test(value) ? value : null

export async function resolvePlayerId(data: SubscriptionIdentity): Promise<string | null> {
  // 1. The happy path: Polar applied our external id to the customer.
  const fromCustomer = asPlayerId(data.customer?.externalId)
  if (fromCustomer) return fromCustomer

  // 2. Metadata we set on the checkout ourselves. Costs no API call.
  const fromMetadata = asPlayerId(data.metadata?.player_id)
  if (fromMetadata) {
    void repairCustomerExternalId(data, fromMetadata)
    return fromMetadata
  }

  // 3. Last resort: the checkout that created this subscription still holds the value.
  if (!data.checkoutId) return null

  try {
    const checkout = await polar().checkouts.get({ id: data.checkoutId })
    const fromCheckout = asPlayerId(checkout.externalCustomerId)

    if (fromCheckout) {
      log.info('Recovered player id from the checkout; customer had no external id', {
        checkoutId: data.checkoutId,
      })
      void repairCustomerExternalId(data, fromCheckout)
      return fromCheckout
    }

    return null
  } catch (error) {
    log.error('Failed to resolve player id from checkout', { error, checkoutId: data.checkoutId })
    return null
  }
}

// Best-effort self-heal. Stamping the external id onto the customer means the next event for this
// person — a cancellation, a renewal, a revocation — arrives with customer.externalId populated
// and takes path 1 above. Deliberately not awaited by callers and never fatal: the current event
// has already been resolved, and failing to tidy up must not turn a successful webhook into a
// retry.
async function repairCustomerExternalId(data: SubscriptionIdentity, playerId: string) {
  const customerId = data.customer?.id ?? data.customerId
  if (!customerId) return

  try {
    await polar().customers.update({ id: customerId, customerUpdate: { externalId: playerId } })
    log.info('Stamped external id onto Polar customer', { customerId })
  } catch (error) {
    log.warn('Could not stamp external id onto Polar customer', { error, customerId })
  }
}
