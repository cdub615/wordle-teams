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
 * and the legal pages, at a day of shared freshness and a week of
 * stale-while-revalidate. IT READS THE CLOCK, in the loader below — which makes
 * it the only entry in that set whose ROUTE does, and a WHEN rather than a WHO.
 * (`/` varies by who: its `beforeLoad` reads `context.isAuthenticated`. That is
 * the axis the session half of the policy exists for, and a different question
 * from this one. A when-varying value is NOT new to the set, though:
 * components/Footer.tsx renders `new Date().getFullYear()` and __root.tsx puts
 * it under every path here — so a stored copy spanning New Year shows last
 * year's year, which is the same bounded, say-less staleness this page's own
 * transition has.)
 *
 * THE TEST A SHARED ENTRY HAS TO PASS is not "the document is identical for
 * every concurrent visitor" — it is that EVERY visitor who may be handed the
 * SAME STORED COPY, across the whole window it can be served in, can acceptably
 * receive it. Concurrency is the easy half; the window is the half that decides
 * it, and it is why a genuinely time-sensitive page does not belong in that set
 * however identical two simultaneous renders of it are. This page passes because
 * its one time-dependent value flips ONCE, ever, and a stale copy errs toward
 * saying less — the loader's own comment below has that in full. Everything else
 * on the page is a compile-time constant.
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
   * reaches LAUNCH_AT. After that the edge may still serve the copy rendered
   * before it for A DAY OF SHARED FRESHNESS AND A WEEK OF
   * STALE-WHILE-REVALIDATE — `s-maxage=86400, stale-while-revalidate=604800`,
   * and BOTH numbers are the exposure, which is how lib/cache-policy.ts and
   * src/server.ts each state it for the same header. That copy says nothing
   * about a trial, which is UNDER-claiming — the same direction the section's own
   * "silence rather than a hedge" rule already chooses — and it is fully
   * mitigable without touching the policy: src/server.ts keys the document cache
   * on `${origin}/__doc-cache/${version}${pathname}` where the version is the
   * Cloudflare deploy id, so ANY deploy evicts every cached document at once.
   * wordle-teams-kc8c's runbook carries "deploy again at or after the cutover
   * instant" as a step for exactly this. Shortening `s-maxage` for a one-time
   * transition would instead cost every visitor thereafter.
   *
   * AND THE EDGE IS SKIPPED ENTIRELY FOR A TAGGED LINK. src/server.ts requires
   * `url.search === ''` before it will read from or write to the document cache,
   * so anything arriving with a `?utm_…` renders fresh — which during the
   * cutover window is most of the traffic this page gets, because the launch
   * email and the marketing links are where its visitors come from.
   *
   * A CLIENT-SIDE NAVIGATION IS CORRECT IMMEDIATELY whatever the edge holds:
   * the loader runs again in the browser, against the browser's clock. Read out
   * of the installed router-core rather than assumed — a navigation enters this
   * match with `cause: 'enter'` and the default `staleTime` is 0, so the loader
   * re-runs. components/home/closing-cta.tsx and routes/about.tsx are both such
   * links. ONE CAVEAT, so the word "immediately" is not doing more work than it
   * can: router.tsx sets `defaultPreload: 'intent'` with
   * `defaultPreloadStaleTime: 0`, so a hover has often already run this loader,
   * and a reused preloaded match reloads in the BACKGROUND — meaning the first
   * paint can come from the preload's value rather than the navigation's. For
   * this boolean the two readings are the same unless the hover and the click
   * straddle the cutover instant, so nothing is visible either way; for a value
   * that changed more often it would be.
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
