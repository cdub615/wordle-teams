import { createFileRoute } from '@tanstack/react-router'
import { publicRouteHead } from '#/lib/seo'

/**
 * Ported from v1's src/components/maintenance.tsx (rendered by
 * src/app/maintenance/page.tsx).
 *
 * WHAT REACHES THIS PAGE. Almost nobody types the path. src/server.ts answers
 * every gated app route with a 307 here while the MAINTENANCE var is 'true' —
 * see src/lib/maintenance.ts for which routes those are and why the static
 * pages are deliberately not among them. It is a real route rather than a
 * document the Worker writes inline for two reasons: a redirect has to have
 * somewhere to point, and being reachable directly is how you check the page
 * still looks right without taking the site down to do it.
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
 *
 * THE COPY IS v1'S, VERBATIM: "Coming Soon" and "Site is under construction".
 * It is deliberately vague about duration, which is the right call for a
 * message nobody will remember to edit.
 *
 * THE GRADIENT IS GONE, AND THAT IS THE ONE DELIBERATE CHANGE. v1 defines an
 * SVG <linearGradient id='svg-gradient'> whose three stops are
 * `hsl(var(--color-stop-1))`, `-2` and `-3`. THOSE THREE CUSTOM PROPERTIES DO
 * NOT EXIST IN v2 — they are declared in v1's src/app/globals.css and have no
 * counterpart in src/styles.css. A CSS variable with no declaration resolves to
 * nothing, and an SVG stop with no colour paints BLACK, so porting the markup
 * as written would have shipped a black blob on a page whose entire job is to
 * look composed while everything else is broken. (v1's three stops are the same
 * green-to-yellow brand ramp v2 keeps as --brand-from / --brand-via /
 * --brand-to, so nothing about the identity is lost by naming it differently.)
 *
 * The icon is therefore one token, --accent-solid, via `text-accent-solid` and
 * `fill='currentColor'` — the same treatment components/home/feature-cards.tsx
 * gives its aria-hidden icons, and a pairing src/styles.test.ts already
 * measures against --surface in both themes. It is decorative and hidden from
 * assistive technology; the h1 says what the page is.
 */
export const Route = createFileRoute('/maintenance')({
  head: () => publicRouteHead('/maintenance'),
  component: MaintenancePage,
})

export function MaintenancePage() {
  return (
    <main className="page-wrap flex justify-center px-4 py-12">
      <section className="island-shell w-full max-w-md rounded-2xl p-6 text-center sm:p-8">
        <div className="flex justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            className="h-24 w-24 text-accent-solid"
          >
            {/* v1's path data, untouched: the heroicons "users" glyph. */}
            <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
          </svg>
        </div>
        <h1 className="font-display mt-4 mb-2 text-3xl font-bold text-foreground sm:text-4xl">
          Coming Soon
        </h1>
        <p className="m-0 text-lg text-muted-foreground">Site is under construction</p>
      </section>
    </main>
  )
}
