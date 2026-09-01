import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '#/lib/seo'

/**
 * Copy ported from v1's src/components/about.tsx.
 *
 * This is the SUBSTANCE of v1's About page, not the whole thing. v1 also has
 * eight annotated product screenshots and an aceternity InfiniteMovingCards
 * carousel; porting that marketing surface belongs to Phase 7's route-by-route
 * static-page walk, and the carousel dependency is explicitly not being carried
 * over (wt-ksh.12.5). What matters here is that the page says what the product
 * is, in the product's own words, rather than describing a starter template.
 *
 * THE E2E SUITE NO LONGER DEPENDS ON THIS PAGE, as of Phase 7 Task 4.
 * playwright.config.ts pointed its webServer readiness probe at /about for as
 * long as `/` had no route — Playwright reads a 404 as "not ready yet" and
 * fails the whole run with `Timed out waiting for config.webServer`, naming the
 * dev server rather than the route. The marketing landing now renders at `/`
 * and the probe has moved back there, which is also the better home for it
 * while Task 9 is still adding v1's eight product screenshots to this page.
 * Recorded here because the dependency ran both ways and someone reading only
 * this file would otherwise still believe it exists.
 */
export const Route = createFileRoute('/about')({
  head: () => ({ meta: [{ title: pageTitle('About') }] }),
  component: About,
})

function About() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">About</p>
        <h1 className="font-display mb-3 text-4xl font-bold text-foreground sm:text-5xl">
          Wordle Teams
        </h1>
        <div className="flex max-w-3xl flex-col gap-4 text-base leading-8 text-muted-foreground">
          <p className="m-0">
            Wordle Teams is designed as a companion app to the New York Times Wordle game.*
          </p>
          <p className="m-0">
            Play Wordle as you normally would in the official app or website, then come here to
            enter the day&apos;s answer and your guesses and see how you stack up against your
            friends.
          </p>
        </div>
        <p className="mt-8 text-xs leading-4 text-muted-foreground">
          * Wordle Teams is not affiliated with New York Times or the official Wordle game
        </p>
      </section>
    </main>
  )
}
