'use client'

import { log } from 'next-axiom'
import { useEffect } from 'react'

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(
        function (registration) {
          log.info(`Service Worker registered with scope: ${registration.scope}`)
        },
        function (error) {
          log.error('Service Worker registration failed:', error)
        }
      )
    }
  }, [])

  return null // This component doesn't render anything
}
