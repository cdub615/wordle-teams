import { useEffect } from 'react'

/**
 * The minimum this module needs from `navigator`. Structural rather than the
 * DOM lib's `Navigator`, so a test can hand in an object whose `serviceWorker`
 * is a THROWING getter — which is the whole point of the guard below and is not
 * expressible with the real type.
 */
interface ServiceWorkerContainerLike {
  register(scriptUrl: string): Promise<unknown>
}

interface NavigatorLike {
  readonly serviceWorker?: ServiceWorkerContainerLike
}

/**
 * Registers /sw.js, absorbing every way that can fail. Returns a cancel
 * function that suppresses a late warning after the caller has gone away.
 *
 * TAKES `navigator` AS AN ARGUMENT rather than reaching for the global, because
 * the failure this function exists to survive can only be reproduced by passing
 * an object that misbehaves. See register-sw.test.ts.
 *
 * WHY EVERY ACCESS IS INSIDE A `try`, AND WHY `'serviceWorker' in navigator`
 * IS NOT ENOUGH — this was a real bug, found in review of f71d183:
 * `in` performs [[HasProperty]] and NEVER invokes the accessor, and
 * `Navigator.serviceWorker` is a [SecureContext] GETTER THAT THROWS
 * `SecurityError` in Chromium when site data is blocked for the origin (a user
 * setting or an enterprise policy — "Access to service workers is denied in
 * this document origin"), and in a sandboxed frame without `allow-same-origin`.
 * A presence check therefore passes and the very next property read throws,
 * synchronously, outside any handler. This is called from RootComponent, so
 * that is not a missing PWA — it is a blank page for everyone whose IT
 * department blocks site data.
 *
 * v1's component (src/components/service-worker-registration.tsx, in the repo
 * root) got this right by accident: its access sat inside
 * `try { await navigator.serviceWorker.register(...) } catch`, which absorbed
 * both the getter and the rejection. The port split them and lost it.
 *
 * FAILURE IS NOT AN ERROR. Registration legitimately fails in situations we do
 * not control: private browsing modes that disable the API, extensions or
 * enterprise policy blocking the script fetch, automated browsers, and
 * transient network errors mid-deploy. The PWA is an enhancement — warn and
 * carry on, and never let it throw or reject unhandled.
 *
 * NOT REPORTED TO SENTRY. src/lib/sentry-capture.ts is for failures someone
 * should act on; a private-browsing session that cannot install a worker is not
 * one, and routing every one of them to Sentry would bury the failures that
 * matter. console.warn is what the eslint config leaves open in src/ for
 * exactly this: something a developer should see in the console, not an alert.
 */
export function registerServiceWorker(navigatorLike: NavigatorLike | undefined): () => void {
  let cancelled = false
  const cancel = () => {
    cancelled = true
  }

  const warn = (message: string, error: unknown) => {
    if (cancelled) return
    console.warn(message, {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
    })
  }

  let container: ServiceWorkerContainerLike | undefined
  try {
    container = navigatorLike?.serviceWorker
  } catch (error) {
    // The [SecureContext] getter threw. Site data is blocked for this origin,
    // or we are in a sandboxed frame. Nothing to register, and nothing wrong.
    warn('Service Worker is unavailable in this document origin', error)
    return cancel
  }

  if (!container) return cancel

  try {
    // `register` is specified to return a rejected promise rather than throw,
    // but it is reached through the same hostile surface as the getter above
    // and costs nothing to bracket. Both halves land in the same warning.
    Promise.resolve(container.register('/sw.js')).catch((error: unknown) => {
      warn('Service Worker registration failed', error)
    })
  } catch (error) {
    warn('Service Worker registration failed', error)
  }

  return cancel
}

/**
 * The single place a service worker is registered.
 *
 * WHY "SINGLE" IS STRUCTURAL HERE, AND IT IS NOT THE REASON v1 GIVES.
 * v1's equivalent had to turn serwist's own injected registration off with
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
    if (typeof navigator === 'undefined') return

    return registerServiceWorker(navigator)
  }, [])
}
