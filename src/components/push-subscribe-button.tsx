'use client'

import ky from 'ky'
import { log } from 'next-axiom'
import { useState } from 'react'

export default function SubscribeButton() {
  const [isSubscribed, setIsSubscribed] = useState(false)

  async function subscribeToPushNotifications() {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: 'YOUR_PUBLIC_VAPID_KEY', // get this from Novu
      })

      // Send the subscription to your server
      await ky.post('/api/subscribe', { json: subscription })

      setIsSubscribed(true)
      log.info('Push notification subscription successful')
    } catch (error) {
      log.error('Failed to subscribe to push notifications:', { error })
    }
  }

  return (
    <button onClick={subscribeToPushNotifications} disabled={isSubscribed}>
      {isSubscribed ? 'Subscribed' : 'Subscribe to Notifications'}
    </button>
  )
}
