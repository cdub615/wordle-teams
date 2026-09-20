import { Link, createFileRoute } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import { TierTable } from '#/components/pricing/tier-table.tsx'
import { publicRouteHead } from '#/lib/seo'

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
 * and the legal pages. The document is rendered from compile-time constants,
 * reads nothing per-request and is identical for every anonymous visitor, which
 * is the property that makes a day of shared edge freshness safe. It is
 * deliberately NOT in lib/maintenance.ts's gated set, for the same reason /about
 * is not: it renders fine while the app is down, and an outage is a poor moment
 * to also stop telling people what the product costs.
 */
export const Route = createFileRoute('/pricing')({
  head: () => publicRouteHead('/pricing', 'Pricing'),
  component: Pricing,
})

function Pricing() {
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

        <TierTable />
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
