import { Link, createFileRoute } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import { TierTable } from '#/components/pricing/tier-table.tsx'
import { publicRouteHead } from '#/lib/seo'
import { trialCanStart } from '../../convex/lib/insightsAccess.ts'

/**
 * THE FIRST PUBLIC PRICE THIS PRODUCT HAS EVER PUBLISHED (wordle-teams-wty4.1.14.3).
 *
 * Until now the only way to find out what Pro costs was to create an account,
 * reach an upgrade affordance and be sent to Polar's hosted checkout. That is a
 * price behind a signup on a funnel that already loses about 93% of /login
 * arrivals (wordle-teams-390), and the launch email points at these pages.
 *
 * IT IS FOR PEOPLE WHO HAVE NOT SIGNED UP. The in-app surface for the same
 * question is components/upgrade-dialog.tsx — the owner's decision, recorded in
 * the spec — so nothing in the signed-in chrome links here. The two render one
 * inventory (PRO_BENEFITS) and one price (plans.ts) precisely so they cannot
 * come to disagree.
 *
 * NO `beforeLoad`, AND THAT IS A DECISION RATHER THAN AN OMISSION. routes/
 * index.tsx bounces a signed-in visitor to /app because v1's `welcomePaths`
 * (src/lib/supabase/middleware.ts:7) is exactly `['/', '/login']` and because a
 * relaunching iOS PWA that ignores `start_url` lands on `/`. /pricing is neither
 * of those things: nothing restores to it, no PWA opens on it, and a signed-in
 * player who follows a link here — from the launch email, or from a friend —
 * asked to read a page. Bouncing them to the dashboard would answer a question
 * they did not ask. routes/home.tsx has no beforeLoad for a version of the same
 * reason and writes four sentences about it; src/routes.test.ts pins ITS absence
 * because mutation found that adding one left all 39 specs green.
 *
 * THE PAGE WRITES NO BENEFIT COPY OF ITS OWN. Everything about what Pro
 * includes is components/pricing/tier-table.tsx rendering PRO_BENEFITS, for the
 * reason that file's header gives. What lives here is the frame: a title, a
 * lede, and the one thing this page exists to hand over — a link to /login.
 *
 * THIS PATH IS IN src/lib/cache-policy.ts's STATIC_DOCUMENTS, alongside /about
 * and the legal pages, at a day of shared edge freshness. IT DOES READ ONE
 * THING PER-REQUEST — the clock, in the loader below — and that is still safe,
 * because shared freshness does not require a document to be timeless: it
 * requires it to be identical for every CONCURRENT anonymous visitor, and
 * nothing here varies by WHO is asking. Everything else on the page is a
 * compile-time constant. What the clock costs is a TRANSITION rather than a
 * correctness problem, and the loader's own comment below has it.
 *
 * It is deliberately NOT in lib/maintenance.ts's gated set, for the same reason
 * /about is not: it renders fine while the app is down, and an outage is a poor
 * moment to also stop telling people what the product costs.
 */
export const Route = createFileRoute('/pricing')({
  head: () => publicRouteHead('/pricing', 'Pricing'),
  /**
   * THE CLOCK IS READ HERE, ONCE, AND THE ANSWER IS SERIALIZED. The component
   * below never reads one, and neither does components/pricing/tier-table.tsx.
   *
   * WHAT IS BEING ASKED IS "CAN A TRIAL BE STARTED RIGHT NOW", which is
   * convex/lib/insightsAccess.ts's `trialCanStart` — `shouldStartTrial`'s
   * timing half, plus a refusal while LAUNCH_AT is still the placeholder
   * sentinel. convex/lib/insightsAccess.test.ts asserts the two agree about
   * that timing half, so the instant this page starts advertising a trial is
   * the instant a board entered now would actually be stamped one. Before this
   * existed the section was keyed to `!LAUNCH_AT_IS_PLACEHOLDER`, which flips
   * when the constant is EDITED rather than when launch ARRIVES — and
   * wordle-teams-kc8c sets it before the DNS cutover, so the two are not the
   * same moment (wordle-teams-wty4.1.14.10).
   *
   * SERIALIZATION IS THE WHOLE MECHANISM, NOT A CONVENIENCE. Loader data is
   * dehydrated into the document and assigned back on the client rather than
   * recomputed — @tanstack/router-core's `dehydrateMatch` writes `loaderData`
   * out under the key `l` and `hydrateMatch` reads it straight back, read out
   * of the installed package rather than assumed, and lib/cache-policy.ts
   * records the sibling field `b` (`__beforeLoadContext`) being observed in a
   * real document. So the rendered HTML is the only source of this boolean. A
   * component that called `Date.now()` itself would recompute during hydration
   * and disagree with an edge-cached document rendered BEFORE the cutover — a
   * minified React #418 in production, which is the hazard
   * components/today-panel.tsx and components/scores-table.tsx both record at
   * length.
   *
   * SERVER-RENDERED RATHER THAN REVEALED AFTER HYDRATION. A `useHydrated` gate
   * is this repo's idiom for a client-only fact and would be exact from the
   * cutover instant with no staleness at all — but a crawler never runs the
   * effect, and /pricing is in lib/sitemap.ts and is not disallowed in
   * robots.txt, so the trial section would be invisible to search
   * indefinitely rather than for a transition.
   *
   * WHAT THE EDGE COSTS, STATED EXACTLY. This answer flips once, when `now`
   * reaches LAUNCH_AT, and for up to a day after that the edge may still serve
   * the copy rendered before it. That copy says nothing about a trial, which is
   * UNDER-claiming — the same direction the section's own "silence rather than a
   * hedge" rule already chooses — and it is fully mitigable without touching
   * the policy: src/server.ts keys the document cache on
   * `${origin}/__doc-cache/${version}${pathname}` where the version is the
   * Cloudflare deploy id, so ANY deploy evicts every cached document at once.
   * wordle-teams-kc8c's runbook carries "deploy again at or after the cutover
   * instant" as a step for exactly this. Shortening `s-maxage` for a one-time
   * transition would instead cost every visitor thereafter.
   *
   * A CLIENT-SIDE NAVIGATION IS CORRECT IMMEDIATELY whatever the edge holds:
   * the loader runs again in the browser, against the browser's clock. Read out
   * of the installed router-core rather than assumed — a navigation enters this
   * match with `cause: 'enter'` and the default `staleTime` is 0, so the loader
   * re-runs. components/home/closing-cta.tsx and routes/about.tsx are both such
   * links.
   */
  loader: () => ({ trialOffered: trialCanStart({ now: Date.now() }) }),
  component: Pricing,
})

function Pricing() {
  const { trialOffered } = Route.useLoaderData()

  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">Plans</p>
        <h1 className="font-display mb-3 text-4xl font-bold text-foreground sm:text-5xl">
          Pricing
        </h1>
        <p className="m-0 mb-8 max-w-xl text-base leading-8 text-muted-foreground">
          Wordle Teams is free to play, and free is a real tier rather than a trailer for
          the paid one. Here is what each side of that actually holds.
        </p>

        <TierTable trialOffered={trialOffered} />
      </section>

      {/*
        THE ONE THING THIS PAGE HANDS OVER. A pricing page that describes two
        tiers and offers no way to start on either has answered the question and
        dropped the reader — which is the dead-end shape e2e/routes.spec.ts
        already pins on /login-error and on both of the landing's CTAs.

        IT POINTS AT /login, NOT AT CHECKOUT, and that is not timidity. Polar's
        checkout needs a customer, so there is no route to paying that does not
        pass through signing in; sending an anonymous visitor at it would hand
        them an error instead of a page. The second line says where the upgrade
        actually lives so the path from here is legible rather than implied.
      */}
      <div className="mt-10 flex flex-col items-center gap-3 text-center">
        <Button asChild size="lg">
          <Link to="/login" className="no-underline">
            Get Started
          </Link>
        </Button>
        <p className="m-0 max-w-md text-sm text-muted-foreground">
          Signing in is free. Pro is offered inside the app, whenever you want it.
        </p>
      </div>
    </main>
  )
}
