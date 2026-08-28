// TEMPORARY — spike S2 (wt-ksh.7.27). Delete with convex/spikePush.ts.
//
// Exists only so a browser on beta can register SOMETHING and call
// pushManager.subscribe, which requires a same-origin service worker script —
// a blob: or data: URL will not register. The real worker is Task 13 and lives
// at /sw.js; this one caches nothing and claims nothing beyond itself.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Wordle Teams', body: event.data ? event.data.text() : '(no payload)' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Wordle Teams', {
      body: data.body || 'S2 probe',
      icon: '/wt-icon-192x192.png',
      badge: '/wt-icon-192x192.png',
    }),
  )
})
