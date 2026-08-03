import { createFileRoute } from '@tanstack/react-router'
import { withErrorCapture } from '#/lib/server-handler'

/** TEMPORARY — diagnostic for wordle-teams-7qa. Removed after verification. */
export const Route = createFileRoute('/api/sentry-check')({
  server: {
    handlers: {
      GET: withErrorCapture('/api/sentry-check GET', () => {
        throw new Error('wt-ksh.1.12 SERVER-handler Sentry check — safe to resolve')
      }),
    },
  },
})
