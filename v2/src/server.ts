import * as Sentry from '@sentry/cloudflare'
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react'
import handler from '@tanstack/react-start/server-entry'
import { TRACES_SAMPLE_RATE } from './lib/sentry-config'

// @ts-expect-error handler type mismatch between TanStack Start and the Sentry
// SDK's ServerEntry (Start's fetch opts are typed, Sentry's are unknown) —
// required per the Sentry TanStack Start on Cloudflare docs
const sentryHandler = wrapFetchWithSentry(handler)

// The Start server entry's fetch is typed as (request, opts?) but the Workers
// runtime invokes it as (request, env, ctx) — forward all args through.
type WorkerFetch = (
  request: Request,
  env: unknown,
  ctx: ExecutionContext,
) => Response | Promise<Response>
const sentryFetch = sentryHandler.fetch as unknown as WorkerFetch

/**
 * SSR document responses embed the dehydrated router/query state, which
 * includes the auth JWT — they must never land in any shared cache. Static
 * assets (JS/CSS/images) are served by the Workers assets layer and don't
 * pass through this handler, and the content-type guard keeps this from
 * touching anything but HTML documents. (wt-ksh.1.13)
 */
const withNoStoreOnDocuments = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const response = await sentryFetch(request, env, ctx)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return response
    const doc = new Response(response.body, response)
    doc.headers.set('cache-control', 'private, no-store')
    return doc
  },
}

export default Sentry.withSentry(
  (env: { SENTRY_DSN?: string }) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: TRACES_SAMPLE_RATE,
  }),
  withNoStoreOnDocuments,
)
