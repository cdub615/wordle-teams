import { createFileRoute } from '@tanstack/react-router'
import { sitemapResponse } from '#/lib/sitemap'
import { withErrorCapture } from '#/lib/server-handler'

/**
 * /sitemap.xml — the file name's `[.]` is TanStack's escape for a literal dot,
 * which a route file name otherwise reads as a path separator. Without it this
 * would register as `/sitemap/xml`. src/routeTree.gen.ts is the proof it
 * resolved the way it was meant to, and src/crawler-metadata.test.ts reads that
 * generated tree rather than trusting the convention.
 *
 * EVERYTHING THIS ROUTE DOES IS IN src/lib/sitemap.ts, and the split is not
 * tidiness. A module calling createFileRoute cannot be imported under vitest —
 * it registers against a router that does not exist there — so a body written
 * here would be reachable only from Playwright, and CI runs no Playwright
 * (wt-ksh.8.49). sitemapResponse() is a plain function that `vitest run` calls
 * and reads the headers off, which is a gate. What is left here is the wiring,
 * and src/crawler-metadata.test.ts parses this file to prove the wiring still
 * points at that function.
 *
 * WRAPPED LIKE api/funnel.ts. A throw inside a server route handler sits
 * outside the router's error boundaries: it answers 404 with no Sentry event,
 * measured on beta (wordle-teams-7qa). Nothing on this path can realistically
 * throw today — it renders a compile-time constant — so this is insurance
 * against the version of this handler that reads something, not a report of a
 * failure anyone has seen.
 */
export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: withErrorCapture('/sitemap.xml GET', () => sitemapResponse()),
    },
  },
})
