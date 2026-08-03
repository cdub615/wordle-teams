import 'server-only'

import { log } from 'next-axiom'
import { appOrigin, polar, proProductIds } from './client'

// Creates the Polar checkout a player is sent to when they upgrade to Pro.
// See docs/superpowers/specs/2026-07-31-polar-migration-design.md.
//
// Both Pro products — monthly and annual — go into a single session. Polar has no variants, so
// the two intervals are separate products, and a multi-product checkout renders them side by
// side on Polar's hosted page. That is why no caller passes a plan: the customer chooses the
// interval on Polar's page, and the three upgrade buttons in the app stay identical.
//
// externalCustomerId is the player's own id. It is the only link between a Polar customer and a
// row in this database — Polar's customer UUID is never stored — and it comes back on every
// webhook as customer.external_id.

export async function createProCheckout(playerId: string, email: string, name: string) {
  try {
    const checkout = await polar().checkouts.create({
      products: proProductIds(),
      externalCustomerId: playerId,
      // Belt and braces. Polar does NOT stamp external_customer_id onto a customer that already
      // exists under this email, so the webhook's customer.external_id can come back null and the
      // upgrade silently does nothing. Metadata travels with the checkout and costs no extra API
      // call to read back. See resolvePlayerId in ./identity.
      metadata: { player_id: playerId },
      customerEmail: email,
      customerName: name,
      // Landing back on /me matters: that page already reconciles player_customer against the
      // JWT, so the upgrade shows up even before the session is refreshed.
      successUrl: `${appOrigin()}/me?checkout=success`,
    })

    return checkout.url
  } catch (error) {
    log.error('Failed to create Polar checkout', { error, playerId })
    return undefined
  }
}
