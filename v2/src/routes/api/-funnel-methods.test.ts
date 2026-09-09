import { describe, expect, test } from 'vitest'
import { Route } from './funnel.ts'

// THE LEADING DASH IS REQUIRED: TanStack Router treats every file under
// src/routes/ as a route and warns on each build that this one exports no Route.
// `routeFileIgnorePrefix` is "-", which is the documented way to keep a non-route
// file beside the route it tests.
/**
 * WHICH HTTP METHODS /api/funnel ANSWERS — wordle-teams-ao7j.
 *
 * WHY THIS FILE EXISTS AND WHY THE EXISTING CRAWLER TEST COULD NOT COVER IT.
 * src/crawler-metadata.test.ts walks routeTree.gen.ts and asserts every route is
 * in the sitemap, covered by a robots Disallow, or named as a deliberate
 * exclusion. /api/funnel is a named exclusion, so it PASSED that test the entire
 * time GET was returning the marketing landing page at 200. That suite asserts
 * route COVERAGE and says nothing about methods; a POST-only route that silently
 * 200s on GET satisfies it completely. So the status has to be asserted directly,
 * which is what the issue's acceptance criterion asks for.
 *
 * ASSERTED AGAINST THE REGISTERED HANDLERS rather than over HTTP, because the
 * fault was a method having NO handler and falling through to the SPA catch-all.
 * A handler existing and returning 405 is exactly the condition that stops the
 * fall-through, so it is the thing worth pinning. e2e/routes.spec.ts is where an
 * over-the-wire check would live if one is ever wanted.
 */

const handlers = Route.options.server?.handlers as
  | Record<string, ((...args: never[]) => Response | Promise<Response>) | undefined>
  | undefined

describe('/api/funnel', () => {
  test('still accepts POST, which is the whole point of the route', () => {
    expect(handlers?.POST).toBeTypeOf('function')
  })

  /**
   * GET IS THE ONE THAT WAS BROKEN. Measured on beta 2026-09-04: 200, text/html,
   * 9578 bytes, carrying the landing page's own title and no noindex — a soft
   * 404, which search engines treat as a real indexable page.
   */
  test.each(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    '%s answers 405 rather than falling through to the SPA catch-all',
    async (method) => {
      const handler = handlers?.[method]
      expect(handler, `${method} has no handler, so it falls through to the app shell`).toBeTypeOf(
        'function',
      )

      const response = await handler!(...([] as never[]))
      expect(response.status).toBe(405)
      // Without Allow, a 405 does not say what WOULD work.
      expect(response.headers.get('allow')).toBe('POST')
      // A 405 carrying HTML would be the same indexing problem with a new status.
      expect(response.headers.get('content-type')).toBeNull()
    },
  )

  test('and none of them answers a body, so there is nothing to index', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const response = await handlers![method]!(...([] as never[]))
      expect(await response.text()).toBe('')
    }
  })
})
