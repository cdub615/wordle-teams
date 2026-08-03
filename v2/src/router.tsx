import * as Sentry from '@sentry/tanstackstart-react'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { TRACES_SAMPLE_RATE } from './lib/sentry-config'
import { captureError } from './lib/sentry-capture'

export function getRouter() {
  if (typeof window !== 'undefined') {
    notifyManager.setScheduler(window.requestAnimationFrame)
  }

  const convexUrl = import.meta.env.VITE_CONVEX_URL
  if (!convexUrl) throw new Error('VITE_CONVEX_URL is not set')

  const convexQueryClient = new ConvexQueryClient(convexUrl, { expectAuth: true })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient, convexQueryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Every route error that reaches a boundary without its own onCatch —
    // loaders, beforeLoad, rendering — on the server as well as in the browser.
    //
    // Router-level rather than an onCatch on the root route: TanStack catches
    // an error at the boundary of the route that threw, not at the root, so a
    // root-only handler never fires for a child route. Verified the hard way on
    // beta — a root onCatch produced no log line at all.
    //
    // This is what makes route errors visible at all. TanStack Start converts a
    // throw into a response before it leaves the fetch handler, so the Sentry
    // wrappers in server.ts never see it. See wordle-teams-7qa.
    //
    // KNOWN LIMIT, measured not assumed: this fires in the BROWSER, including
    // for errors that originated during SSR — React does not run
    // componentDidCatch while server rendering, so the boundary only catches
    // once the client hydrates. A real visitor's SSR loader error is therefore
    // reported (confirmed on beta); the same request made by curl or a crawler,
    // which never hydrates, is not. Server route handlers are not affected —
    // they report without a browser via withErrorCapture.
    defaultOnCatch: (error) => captureError(error, { boundary: 'router' }),
  })
  setupRouterSsrQueryIntegration({ router, queryClient })

  if (!router.isServer) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      tracesSampleRate: TRACES_SAMPLE_RATE,
      // Without a browser-tracing integration nothing on the client ever starts
      // a span, so tracesSampleRate above would sample a population of zero.
      // The TanStack variant is the one that knows about router navigations —
      // the generic browserTracingIntegration only sees the initial pageload.
      integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
    })
  }

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
