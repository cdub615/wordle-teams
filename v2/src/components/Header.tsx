import { Link } from '@tanstack/react-router'
import { convexQuery, useConvexAction, useConvexAuth } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { CreditCard, Loader2, Mails } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../convex/_generated/api'
import { Badge } from '#/components/ui/badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import { pendingInviteLabel, portalOutcome } from '#/lib/billing-copy.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { UserMenu } from './settings/user-menu.tsx'
import ThemeToggle from './ThemeToggle'

/**
 * The app bar. DESIGN_SYSTEM.md section 8 describes the shape — gradient
 * wordmark left, user affordance right, separator underneath. Phase 5 added the
 * first two pieces of the right-hand side that need app state: the billing
 * link and the pending-invite badge.
 *
 * The wordmark is a Link, not a heading. v1 makes it an <h1> in the app bar,
 * which means every page has an h1 that describes the site rather than the
 * page — and on /login it would now collide with the page's own h1.
 *
 * THIS COMPONENT IS MOUNTED INSIDE ConvexBetterAuthProvider, IN __root.tsx's
 * RootComponent, AND THAT IS LOAD-BEARING. It used to sit in RootDocument, the
 * root route's `shellComponent`, which @tanstack/react-router renders OUTSIDE
 * the root route's component (Match.js: the shell wraps the match context
 * provider) — so every Convex React hook here threw. Measured, not reasoned:
 * `useAction` in the old position answered GET /login with a 500 and "Could not
 * find Convex client! `useAction` must be used in the React component tree
 * under `ConvexProvider`". Moving Header into RootComponent keeps the rendered
 * DOM order identical, because RootComponent's output is exactly the
 * `{children}` that used to sit between Header and Footer.
 *
 * EVERY QUERY IS GATED ON `isAuthenticated` WITH 'skip', NOT `enabled:`. This
 * bar renders on /login and /about for signed-out visitors, and `enabled: false`
 * does not gate a Convex query — measured on this project earlier in the phase:
 * the browser still opens the websocket watch and the server still refuses, and
 * the refusal never reaches the console because the adapter writes it into query
 * state. 'skip' is the one that actually skips, and convexQuery gives it its own
 * query key rather than just switching a flag.
 *
 * NOT useSuspenseQuery, WHICH IS THE ONE PLACE THIS DEPARTS FROM routes/index.tsx,
 * AND IT IS ALSO WHY NEITHER READ IS PREFETCHED IN A LOADER. Suspending here
 * suspends the chrome of every route, including the two a signed-out visitor
 * can reach. With a plain useQuery nothing waits on either value — the badge is
 * absent for the first frame and then appears — so there is no waterfall for a
 * prefetch to remove, only latency for it to add. See the note where __root.tsx
 * would otherwise have had a loader.
 */
export default function Header() {
  const { isAuthenticated } = useConvexAuth()
  const openPortal = useConvexAction(api.polar.getCustomerPortalUrl)
  const [portalPending, setPortalPending] = useState(false)

  const { data: isPro } = useQuery(
    convexQuery(api.teams.amIPro, isAuthenticated ? {} : 'skip'),
  )
  const { data: pendingInvites } = useQuery(
    convexQuery(api.billing.myPendingInviteCount, isAuthenticated ? {} : 'skip'),
  )

  /**
   * All four PortalResult branches, kept distinguishable. The mapping itself
   * is billing-copy.ts's, so it is testable without a DOM — see its note and
   * billing-copy.test.ts; what is left here is a call, a navigation and a toast.
   *
   * A THROW IS ANOTHER OUTCOME AND NOT ONE OF THOSE FOUR. getCustomerPortalUrl
   * turns a Polar failure into `reason: 'error'` itself, so reaching this catch
   * means the action never got that far — an unset SITE_URL, or the transport.
   * mutationErrorMessage gives a typed ConvexError its own copy and everything
   * else this fallback, which is the reflex every other mutation in this app
   * uses (current-team-card.tsx).
   */
  const manageBilling = async () => {
    setPortalPending(true)
    try {
      const outcome = portalOutcome(await openPortal({}))
      if (outcome.action === 'navigate') {
        window.location.href = outcome.url
        return
      }
      // level is 'info' or 'error', and sonner has a method for each. Indexing
      // rather than branching keeps the two-way choice in billing-copy.ts,
      // where the test can see it.
      toast[outcome.level](outcome.message)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not open the billing portal.'))
    } finally {
      setPortalPending(false)
    }
  }

  // `isPro === false` RATHER THAN `!isPro`. `isPro` is undefined while the query
  // is in flight, and `!undefined` is true — so the loose form would flash "N
  // Invites Pending" at a PRO player on every cold load, which is the one person
  // the badge is not for. v1 gates the same badge on `!proMember`, where the
  // value comes off a JWT and is never undefined.
  const showInviteBadge = isPro === false && (pendingInvites ?? 0) > 0

  return (
    <header className="sticky top-0 z-50 border-b border-line-subtle bg-background/80 px-4 backdrop-blur-lg">
      <nav className="page-wrap flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:py-4">
        <Link to="/" className="flex-shrink-0 no-underline">
          {/*
            v1 hardcodes this pair of gradients:
              from-green-600 via-green-500  to-yellow-400
              dark:from-green-600 dark:via-green-300 dark:to-yellow-400
            The brand tokens already fork by theme (--brand-via is #22c55e light,
            #86efac dark), so the dark: variants disappear and the gradient has
            one definition instead of two. This is the tokenisation the design
            system is for — DESIGN_SYSTEM.md section 10, drift #3.
          */}
          <span className="bg-gradient-to-r from-brand-from via-brand-via to-brand-to bg-clip-text text-2xl font-bold text-transparent md:text-3xl">
            Wordle Teams
          </span>
        </Link>

        <div className="order-3 flex w-full flex-wrap items-center gap-x-4 gap-y-1 pb-1 text-sm font-semibold sm:order-none sm:w-auto sm:flex-nowrap sm:pb-0">
          <Link to="/" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
            Home
          </Link>
          <Link to="/about" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
            About
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {showInviteBadge && (
            // NOT A BUTTON, mirroring v1, whose menu item carries
            // `focus:bg-transparent` precisely so it does not read as one:
            // there is nothing to click. Accepting an invite is the upgrade,
            // and the upgrade is elsewhere.
            <Badge variant="secondary" className="gap-1 whitespace-nowrap">
              <Mails className="h-3.5 w-3.5" aria-hidden="true" />
              {pendingInviteLabel(pendingInvites ?? 0)}
            </Badge>
          )}
          {isAuthenticated && (
            <>
              <Button
                variant="ghost"
                size="sm"
                // Same word as the visible label, so unlike team-picker.tsx's
                // trigger this hides nothing from a screen reader — it is here
                // because the label itself is hidden below `sm`, where the button
                // would otherwise have no accessible name at all.
                aria-label="Billing"
                disabled={portalPending}
                onClick={() => void manageBilling()}
                className="px-2 sm:px-3"
              >
                {portalPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">Billing</span>
              </Button>
              {/*
                UserMenu (settings/user-menu.tsx) owns its own three queries —
                api.auth.getCurrentUser, api.players.myName, api.teams.amIPro —
                and does NOT gate them on isAuthenticated itself. It doesn't
                need to: this whole branch already only renders once
                isAuthenticated is true, so UserMenu never exists in the tree
                for a signed-out visitor. Same reasoning as amIPro/pendingInvites
                above, just pushed one level down instead of duplicated here.
              */}
              <UserMenu />
            </>
          )}
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
