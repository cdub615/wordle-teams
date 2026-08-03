'use server'

import { createClient } from '@/lib/supabase/server'
import { getUserFromSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { createProCheckout } from './checkout'
import { getCustomerPortalUrl } from './portal'

// The two billing actions the UI calls, consolidated here.
// See docs/superpowers/specs/2026-07-31-polar-migration-design.md.
//
// getCheckoutUrl previously existed twice — in src/app/me/actions.ts and in
// src/components/app-bar/actions.ts — as near-identical copies that three components imported
// from two different modules.
//
// Both actions derive the player from the SESSION rather than from an argument. This module
// carries 'use server', which in Next.js makes every export a public HTTP endpoint, so a
// caller-supplied user id or email would be caller-controlled identity on an unauthenticated
// route. The previous getCheckoutUrl(user: User) took exactly that. See wordle-teams-8uk.

export async function getCheckoutUrl(): Promise<{ checkoutUrl?: string; error?: string }> {
  const supabase = createClient(await cookies())
  const user = await getUserFromSession(supabase)

  if (!user) {
    log.warn('Checkout requested without a session')
    return { error: 'Please sign in before upgrading.' }
  }

  const checkoutUrl = await createProCheckout(user.id, user.email, `${user.firstName} ${user.lastName}`.trim())

  if (!checkoutUrl) return { error: 'Failed to create checkout, please try again later.' }

  return { checkoutUrl }
}

export async function getBillingPortalUrl(): Promise<{ url?: string; error?: string }> {
  const supabase = createClient(await cookies())
  const user = await getUserFromSession(supabase)

  if (!user) {
    log.warn('Billing portal requested without a session')
    return { error: 'Please sign in to manage billing.' }
  }

  const result = await getCustomerPortalUrl(user.id)

  // Compared against null rather than checked for truthiness: the success variant types url as
  // string, so a falsy test would not narrow the union and `reason` would be unreachable below.
  if (result.url !== null) return { url: result.url }

  // Distinguished so the UI can say something true. Retrying will not conjure a billing account
  // for someone who has never checked out.
  if (result.reason === 'no-customer') return { error: 'You do not have a billing account yet.' }

  return { error: 'Failed to open the billing portal, please try again later.' }
}
