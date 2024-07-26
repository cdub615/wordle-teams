import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { Serwist } from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope & {
  clients: Clients
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
})

serwist.addEventListeners()

// Listen for push events
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || 'New Notification';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/icon.png', // TODO Path to your app icon
    badge: '/badge.png', // TODO Path to your notification badge icon
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow('/')
  );
});