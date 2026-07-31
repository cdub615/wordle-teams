'use client'

import { log } from 'next-axiom'
import { useEffect } from 'react'

// The single place the service worker is registered. Serwist's own injected
// registration is turned off in next.config.js (`register: false`) — having both
// meant register() ran twice on every page load, and serwist's call had no
// rejection handler, so failures surfaced in Sentry as unhandled promise
// rejections instead of being logged here.
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let cancelled = false

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js')
        if (cancelled) return
        log.info('Service Worker registered', { scope: registration.scope })
      } catch (error) {
        if (cancelled) return
        // Registration legitimately fails in situations we do not control:
        // private browsing modes that disable the API, extensions or enterprise
        // policy blocking the script fetch, automated browsers, and transient
        // network errors mid-deploy. The PWA is an enhancement, so log it as a
        // warning and carry on — never let it reject unhandled.
        log.warn('Service Worker registration failed', {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : undefined,
        })
      }
    }

    register()

    return () => {
      cancelled = true
    }
  }, [])

  return null // This component doesn't render anything
}
