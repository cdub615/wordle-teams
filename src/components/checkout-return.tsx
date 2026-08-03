'use client'

import { createClient } from '@/lib/supabase/client'
import { log } from 'next-axiom'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

// Handles the return trip from Polar's hosted checkout.
// See docs/superpowers/specs/2026-07-31-polar-migration-design.md.
//
// Replaces what the Lemon Squeezy overlay's Checkout.Success event used to do. The refresh is
// not cosmetic: user_member_status is stamped into the JWT when the token is issued, so without
// refreshing the session the token still says the player is on the free tier no matter what the
// database now holds.
//
// The retry is new. Polar's webhook races the browser redirect, and the user can easily arrive
// before their upgrade has been recorded. /me reconciles player_customer against the JWT on
// render, but that only helps once the webhook has actually landed, so one delayed retry closes
// most of the gap.

const RETRY_DELAY_MS = 2000

export default function CheckoutReturn({ memberStatus }: { memberStatus: string }) {
  const router = useRouter()
  // Strict Mode mounts effects twice in development; without this the refresh runs twice.
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') !== 'success') return

    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const refresh = async () => {
      const supabase = createClient()
      const { error } = await supabase.auth.refreshSession()
      if (error) log.error('Failed to refresh session after checkout', { error })
      router.refresh()
    }

    const run = async () => {
      await refresh()

      // Drop the query param so a reload does not repeat this.
      router.replace('/me')

      if (memberStatus !== 'pro') retryTimer = setTimeout(refresh, RETRY_DELAY_MS)
    }

    void run()

    return () => clearTimeout(retryTimer)
  }, [memberStatus, router])

  return null
}
