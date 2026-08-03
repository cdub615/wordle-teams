import { createFileRoute } from '@tanstack/react-router'

/**
 * TEMPORARY — delete once wt-ksh.1.12 is verified.
 *
 * Phase 0 Step 6 item 4: prove errors actually reach the wordle-teams-v2
 * Sentry project. The SSR document already carries sentry-trace headers, so
 * the SDKs are initialised — what is unproven is the ERROR path, that a throw
 * is captured, transported and rendered as an issue.
 *
 * Two paths, because they are two different SDKs with two separate inits:
 *   /sentry-check?server=1   throws during SSR  -> @sentry/cloudflare (worker)
 *   the button               throws in the tab  -> @sentry/tanstackstart-react
 *
 * Deliberately unauthenticated so it can be driven without a session. It only
 * ever throws, so it exposes nothing.
 */
export const Route = createFileRoute('/sentry-check')({
  validateSearch: (search: Record<string, unknown>) => ({
    server: search.server === '1' || search.server === 1 || search.server === true,
  }),
  loaderDeps: ({ search }) => ({ server: search.server }),
  loader: ({ deps }) => {
    if (deps.server) {
      throw new Error('wt-ksh.1.12 SERVER-side Sentry check — safe to resolve')
    }
    return null
  },
  component: SentryCheck,
})

function SentryCheck() {
  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Sentry check</h1>
      <p>Temporary route for wt-ksh.1.12. Delete after verifying.</p>
      <button
        data-testid="throw-client"
        onClick={() => {
          // Errors thrown in React event handlers are not caught by error
          // boundaries; they propagate to window.onerror, which is exactly the
          // global handler Sentry.init installs.
          throw new Error('wt-ksh.1.12 CLIENT-side Sentry check — safe to resolve')
        }}
      >
        Throw a client error
      </button>
    </main>
  )
}
