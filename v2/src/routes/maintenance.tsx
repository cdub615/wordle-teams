import { createFileRoute } from '@tanstack/react-router'
import { MaintenancePage } from '#/components/maintenance.tsx'
import { publicRouteHead } from '#/lib/seo'

/**
 * WHAT REACHES THIS PAGE. Almost nobody types the path. src/server.ts answers
 * every gated app route with a 307 here while the MAINTENANCE var is 'true' —
 * see src/lib/maintenance.ts for which routes those are and why the static
 * pages are deliberately not among them. It is a real route rather than a
 * document the Worker writes inline for two reasons: a redirect has to have
 * somewhere to point, and being reachable directly is how you check the page
 * still looks right without taking the site down to do it.
 *
 * THE COMPONENT IS IMPORTED, NOT DECLARED AND EXPORTED HERE, AND THAT IS THE
 * WHOLE OF wordle-teams-xsrv. It used to be `export function MaintenancePage()`
 * in this file. @tanstack/router-plugin rewrites `component:` into a lazy
 * reference so the markup ships in its own chunk, but it cannot move a
 * declaration something else exports — and on this version of the plugin it
 * does not warn, it simply declines to split the file at all. The outage page
 * was therefore inside the 468 kB entry chunk every visitor downloads, and
 * /maintenance was the only route in the app with no chunk of its own. The
 * import is what puts it back: components/maintenance.tsx may export whatever
 * it likes, because it is not a route file.
 *
 * The blast-radius argument is in that file's header. Short version: /chat
 * survived a module-scope throw only because it was a separate chunk.
 *
 * NO TITLE OF ITS OWN, WHICH IS v1 PARITY AND NOT AN OVERSIGHT. v1's
 * src/app/maintenance/ contains page.tsx and error.tsx and no layout.tsx, so
 * the page inherits the root metadata title — 'Wordle Teams: The ultimate app
 * for Wordle enthusiasts'. publicRouteHead() is called with no title segment
 * below, which yields exactly that same default, so this is unchanged. A title
 * of "Maintenance - Wordle Teams" would also be the string a browser keeps in
 * history and autocompletes for months after the outage.
 *
 * IT DOES NOW HAVE A head(), for the canonical and og:url alone (wt-ksh.8.55).
 * The route is in lib/sitemap.ts — advertising the outage page is v1's
 * behaviour and its own uncomfortable decision, argued there — and a URL that
 * is advertised should say what it is.
 */
export const Route = createFileRoute('/maintenance')({
  // noindex: the outage page answers 200 and is reachable, so it is indexable
  // regardless of the sitemap (wt-ksh.8.58). "We will be back shortly" as a
  // search result for the product is the outcome being prevented.
  head: () => publicRouteHead('/maintenance', undefined, { noindex: true }),
  component: MaintenancePage,
})
