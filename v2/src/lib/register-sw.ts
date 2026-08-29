import { useEffect } from 'react'

/**
 * The single place a service worker is registered.
 *
 * WHY "SINGLE" IS STRUCTURAL HERE, AND IT IS NOT THE REASON v1 GIVES.
 * v1's equivalent (src/components/service-worker-registration.tsx, in the repo
 * root) had to turn serwist's own injected registration off with
 * `register: false` in next.config.js, because without it register() ran twice
 * on every page load and serwist's call had no rejection handler — failures
 * surfaced in Sentry as unhandled promise rejections instead of being logged.
 *
 * v2 has no such flag to set and no plugin to disable. The worker is built by
 * scripts/build-sw.mjs (esbuild + workbox-build's injectManifest) and nothing
 * in the build injects a registration of its own, so this call is the only one
 * that exists. That absence is what makes it exactly once — not a config
 * option. If a PWA plugin is ever added to vite.config.ts, its auto-registration
 * must be turned off or this comment stops being true.
 *
 * FAILURE IS NOT AN ERROR. Registration legitimately fails in situations we do
 * not control: private browsing modes that disable the API, extensions or
 * enterprise policy blocking the script fetch, automated browsers, and
 * transient network errors mid-deploy. The PWA is an enhancement — warn and
 * carry on, and never let the promise reject unhandled.
 *
 * NOT REPORTED TO SENTRY. src/lib/sentry-capture.ts is for failures someone
 * should act on; a private-browsing session that cannot install a worker is not
 * one, and routing every one of them to Sentry would bury the failures that
 * matter. console.warn is what the eslint config leaves open in src/ for
 * exactly this: something a developer should see in the console, not an alert.
 */
export function useServiceWorkerRegistration() {
  useEffect(() => {
    // `dist/client/sw.js` IS A BUILD ARTIFACT AND DOES NOT EXIST IN DEV.
    // `pnpm dev` is plain `vite dev`, serving from src/ and public/, and
    // scripts/build-sw.mjs only runs after `vite build`. Registering here would
    // therefore fetch the SSR 404 document, fail the MIME-type check, and warn
    // on every single dev page load. `vite preview` and the deployed Worker
    // both serve a real build, so PROD is where there is something to register.
    if (!import.meta.env.PROD) return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    let cancelled = false

    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      if (cancelled) return
      console.warn('Service Worker registration failed', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : undefined,
      })
    })

    return () => {
      cancelled = true
    }
  }, [])
}
