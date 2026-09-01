import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'

/**
 * The product shot, and the landing's second call to action.
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
        <img
          src="/welcome-screenshot.png"
          alt="The Wordle Teams dashboard, showing a team's scores for the month"
          width={1000}
          height={695}
          className="w-full rounded-xl border border-line-subtle shadow-sm"
        />
        <Button asChild size="lg">
          {/* Same destination as the hero's "Get Started" — v1 has both, and a
              landing page whose two CTAs go to the same place is the point. */}
          <Link to="/login" className="no-underline">
            Sign In
          </Link>
        </Button>
      </div>
    </section>
  )
}
