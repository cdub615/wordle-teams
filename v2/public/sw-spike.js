/* global self */
// TEMPORARY — spike S2 (wt-ksh.7.27). Delete with convex/spikePush.ts.
//
// Exists only so a browser on beta can register SOMETHING and call
// pushManager.subscribe, which requires a same-origin service worker script —
// a blob: or data: URL will not register. The real worker is Task 13 and lives
// at /sw.js; this one caches nothing and claims nothing beyond itself.
//
// `/* global self */` rather than an eslint ignore: this file is hand-written,
// and the config's ignores list is explicitly for GENERATED or vendored code.
// A service worker's globals are simply not the ones the base config assumes.
// Task 13's worker is a .ts file under src/ and will need the same treatment
// done properly, as a scoped config entry rather than a per-file comment.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// A separate function rather than a reassigned `let`: no-useless-assignment
// fires on the initialise-then-overwrite shape, and it is right to.
function payloadOf(event) {
  try {
    return event.data ? event.data.json() : {}
  } catch {
    return { title: 'Wordle Teams', body: event.data ? event.data.text() : '(no payload)' }
  }
}

self.addEventListener('push', (event) => {
  const data = payloadOf(event)
  event.waitUntil(
    self.registration.showNotification(data.title || 'Wordle Teams', {
      body: data.body || 'S2 probe',
      icon: '/wt-icon-192x192.png',
      badge: '/wt-icon-192x192.png',
    }),
  )
})
