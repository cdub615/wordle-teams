/**
 * The page a visitor gets during an outage — ported from v1's
 * src/components/maintenance.tsx (rendered by src/app/maintenance/page.tsx).
 *
 * IT LIVES HERE RATHER THAN IN routes/maintenance.tsx BECAUSE A ROUTE FILE MAY
 * NOT EXPORT ITS COMPONENT BY NAME (wordle-teams-xsrv). @tanstack/router-plugin
 * rewrites `component:` into a lazy reference so the markup lands in its own
 * chunk; a named export pins the declaration in place and the compiler gives up
 * on the whole file — silently, on this version, without the warning its own
 * source can print. Measured: the outage page's markup was inside
 * dist/client/assets/index-*.js, the 468 kB entry every visitor downloads, and
 * /maintenance was the ONLY route in the app with no chunk of its own.
 *
 * THE REASON THAT IS MORE THAN BUNDLE HYGIENE is what happened to /chat. A
 * module-scope throw rode into the client behind one imported constant, and
 * because /chat is a lazily loaded chunk it broke that one route while every
 * other page kept working. In a chunk shared by every route the same throw is
 * the whole site. A route file that opts out of splitting widens the blast
 * radius of exactly that, and this one opted out to serve an outage page —
 * during an outage.
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
