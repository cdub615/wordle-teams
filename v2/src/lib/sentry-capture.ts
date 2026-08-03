import { captureException, withScope } from '@sentry/core'

// Isomorphic error reporting.
//
// WHY @sentry/core AND NOT THE SDK PACKAGES: this file is imported by code that
// runs in BOTH environments, and neither SDK can serve both.
// @sentry/tanstackstart-react's server entry exports only wrapFetchWithSentry —
// no captureException — and importing @sentry/cloudflare would drag worker-only
// code into the client bundle. @sentry/core's captureException reports through
// whichever client is bound to the current scope: @sentry/cloudflare on the
// worker (via withSentry in server.ts), @sentry/tanstackstart-react in the
// browser (via Sentry.init in router.tsx). One import, correct in both.
//
// Pinned to an exact version in package.json on purpose. It must match the SDK
// versions or the two halves disagree about the shape of the current scope.
//
// WHY THIS EXISTS AT ALL: nothing server-side was reaching Sentry.
// TanStack Start converts thrown errors into RESPONSES before they leave the
// fetch handler, so wrapFetchWithSentry and withSentry — which only see what
// propagates OUT — never saw them. A loader throw returned a 404 and Sentry
// stayed empty. Reporting therefore has to be explicit at the points where the
// framework swallows the error. See wordle-teams-7qa.

type ErrorContext = Record<string, unknown>

export function captureError(error: unknown, context?: ErrorContext) {
  // Never let reporting an error become an error. A throw here would surface as
  // a second, misleading failure on top of the one being reported.
  try {
    withScope((scope) => {
      if (context) scope.setContext('wordle-teams', context)
      captureException(error)
    })
  } catch {
    // Intentionally silent.
  }
}
