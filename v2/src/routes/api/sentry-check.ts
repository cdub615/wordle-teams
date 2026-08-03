import { createFileRoute } from '@tanstack/react-router'

/**
 * TEMPORARY — delete with sentry-check.tsx once wt-ksh.1.12 is verified.
 *
 * Diagnostic, not a duplicate. The loader throw in sentry-check.tsx did NOT
 * reach Sentry: TanStack Router caught it, rendered its error page and returned
 * 404, so the error never propagated out of the worker's fetch handler and
 * wrapFetchWithSentry never saw it.
 *
 * That leaves two possible causes, and they need different fixes:
 *   a) the worker Sentry wiring is broken -> fix src/server.ts
 *   b) the worker wiring is fine and the ROUTER swallows route-level errors
 *      -> fix is the error-boundary-to-Sentry wiring the v2 design calls for
 *
 * A server handler throw bypasses the router's route-level error handling, so
 * if THIS one reaches Sentry the answer is (b).
 */
export const Route = createFileRoute('/api/sentry-check')({
  server: {
    handlers: {
      GET: () => {
        throw new Error('wt-ksh.1.12 SERVER-handler Sentry check — safe to resolve')
      },
    },
  },
})
