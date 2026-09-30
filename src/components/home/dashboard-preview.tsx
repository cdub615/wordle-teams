import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import { SHOTS } from './marketing-copy.ts'
import { ProductShot } from './product-shot.tsx'

/**
 * The product shot, and the landing's second call to action.
 *
 * THE SHOT IS NOW v2's OWN DASHBOARD, NOT v1's welcome-screenshot.png. That file
 * is a picture of the product this one replaces: a Supabase-era dashboard with
 * none of the month picker, team chat entry point or played-today panel that
 * Phase 7 ships. public/marketing/dashboard-{light,dark}.png come from Task 2's
 * scripts/build-marketing-shots.mjs against seeded fixtures, so they are a
 * picture of the code in this repo and can be recaptured when it changes.
 *
 * THE CROP IS CSS, NOT A SECOND FILE, AND IT IS TWO CROPS RATHER THAN ONE.
 * From `md` up, `aspect-[1440/492]` with `object-[50%_17%]` frames rows 68 to
 * 560 of the 1440x900 capture: the team and month pickers, the played-today bar,
 * the whole scores table and the points-per-result card, cut in the gap above
 * "Team Boards" so nothing is sliced through. The 68px it drops is the app's OWN
 * header bar — a second wordmark directly beneath the real one reads as a
 * rendering bug rather than a screenshot. Cropping here rather than in the
 * capture script keeps one artifact per surface, which is what lets /about reuse
 * the same files (Task 5).
 *
 * ON A PHONE THAT SAME CROP WAS A SMEAR, WHICH IS WHY THERE IS A SECOND ONE.
 * `object-cover` scales a 1440px capture to the container, so at 390px every
 * figure in the scores table renders under four pixels tall — the reader gets
 * grey stripes where the product's whole point is a table of numbers.
 * `object-none` renders at the file's intrinsic size and clips instead, and
 * `object-[0%_16%]` anchors that window to the file's LEFT edge rather than its
 * centre: the table is read left to right from the player names, so the
 * left-hand 358px — the picker, the played-today bar, the names and the first
 * days — is the half that means something on its own. A centred window would
 * show four midweek columns and nobody's name. The 360px height and the 16%
 * are measured against the file: rows 86 to 446 hold the pickers, the
 * played-today bar and BOTH players' rows whole, and cutting a player's row in
 * half is the one thing a screenshot of a scoreboard must not do. InsightsPayoff makes the same
 * trade with a different anchor and explains the mechanism.
 *
 * WHAT WOULD ACTUALLY FIX IT IS A PHONE-WIDTH CAPTURE, and there is not one:
 * scripts/build-marketing-shots.mjs takes 1440x900 only.
 *
 * THE CLIENT-SIDE PWA REDIRECT IN v1's dashboard-preview.tsx IS DELIBERATELY
 * NOT PORTED. DO NOT "RESTORE" IT. v1 runs an effect here that checks
 * `display-mode: standalone`, reads the Supabase session out of cookies and
 * `router.replace('/me')` — its job is to stop an installed PWA that relaunched
 * onto the welcome screen from sitting there. v2 does that job in
 * src/routes/index.tsx's `beforeLoad`, which is server-side, runs before a byte
 * of the page is rendered, and needs no session read in the browser. Porting
 * both would be two mechanisms enforcing one rule, and the client one would
 * race hydration — the visitor would see the marketing page and then get yanked
 * off it. One mechanism, in the route.
 *
 * ALSO GONE: v1's `Suspense` + dashboard-skeleton.tsx, and magicui's
 * `BorderBeam`. The skeleton existed only because v1's preview was a client
 * component doing that session read; nothing here is async, so there is nothing
 * to fall back to. BorderBeam is an animated gradient outline from the same
 * class of dependency as the aceternity components — see the note in title.tsx.
 */
export function DashboardPreview() {
  return (
    <section className="px-4 pb-12 md:pb-16">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-8">
        <ProductShot
          shot={SHOTS.dashboard}
          className="h-[360px] w-full md:aspect-[1440/492] md:h-auto"
          imgClassName="object-none object-[0%_16%] md:object-cover md:object-[50%_17%]"
        />
        <Button asChild size="lg">
          {/* Same destination as the hero's "Get Started" — v1 has both, and a
              landing page whose CTAs all go to the same place is the point. */}
          <Link to="/login" className="no-underline">
            Sign In
          </Link>
        </Button>
      </div>
    </section>
  )
}
