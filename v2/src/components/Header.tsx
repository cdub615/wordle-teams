import { Link } from '@tanstack/react-router'
import { convexQuery, useConvexAction, useConvexAuth } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { CreditCard, Loader2, Mails, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../convex/_generated/api'
import { Badge } from '#/components/ui/badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import { pendingInviteLabel, portalOutcome } from '#/lib/billing-copy.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { useLocalCapture } from '#/lib/use-local-capture.ts'
import { useStartUpgrade } from '#/lib/use-start-upgrade.ts'
import { UserMenu } from './settings/user-menu.tsx'
import ThemeToggle from './ThemeToggle'

/**
 * The app bar. DESIGN_SYSTEM.md section 8 describes the shape — gradient
 * wordmark left, user affordance right, separator underneath. Phase 5 added the
 * first two pieces of the right-hand side that need app state: the billing
 * link and the pending-invite badge. Phase 7 Task 12 added the third — an
 * Upgrade button that renders beside Billing for anybody amIPro says is not
 * pro (wordle-teams-6tp); see `showUpgrade`.
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
 * NOT useSuspenseQuery, WHICH IS THE ONE PLACE THIS DEPARTS FROM routes/app.tsx,
 * AND IT IS ALSO WHY NEITHER READ IS PREFETCHED IN A LOADER. Suspending here
 * suspends the chrome of every route, including the two a signed-out visitor
 * can reach. With a plain useQuery nothing waits on either value — the badge is
 * absent for the first frame and then appears — so there is no waterfall for a
 * prefetch to remove, only latency for it to add. See the note where __root.tsx
 * would otherwise have had a loader.
 */
export default function Header() {
  // Silent by design — see use-local-capture.ts. Placed first, and safe only
  // because of the ConvexBetterAuthProvider positioning documented above: it
  // is itself a Convex hook, no different from useConvexAuth below it.
  useLocalCapture()

  const { isAuthenticated } = useConvexAuth()
  const openPortal = useConvexAction(api.polar.getCustomerPortalUrl)
  const [portalPending, setPortalPending] = useState(false)
  // Shared with routes/app.tsx's "Upgrade for more" — one copy of the outcome
  // handling, in lib/use-start-upgrade.ts. See the button below.
  const { startUpgrade, pending: upgradePending } = useStartUpgrade()

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

  /**
   * THE ALWAYS-REACHABLE UPGRADE ENTRY POINT (wordle-teams-6tp).
   *
   * Until this, v2's ONLY route to createProCheckout was team-picker.tsx's
   * "Upgrade for more", which renders only at `!isPro && teams.length >=
   * FREE_TEAM_LIMIT` — so a free player holding one team could not pay at all.
   * Any non-pro account can now reach checkout from here having created no
   * teams whatsoever, and that is the half of wordle-teams-6tp this closes.
   *
   * WHAT IT DOES NOT CLOSE, AND THE COMMENT HERE CLAIMED OTHERWISE UNTIL THE
   * TASK 12 REVIEW: the owner's account is comped pro, so `isPro` is true for
   * him, this button does not render, and he STILL cannot reach checkout as
   * himself. That is correct behaviour rather than a leftover gap — offering a
   * subscriber a second subscription is the thing the condition exists to
   * prevent — and it is why Task 18's Polar sandbox pass (wordle-teams-02c)
   * has to mint a fresh non-pro account instead of using his.
   *
   * ONE MORE ENTRY POINT, NOT v1'S THREE. v1 had an upgrade button in the user
   * dropdown, the teams dropdown and the month dropdown — lib/polar/checkout.ts
   * calls them "the three upgrade buttons in the app" — but three is a funnel
   * experiment and this is a parity phase. team-picker.tsx's gated CTA stays;
   * two entry points to one action is what v1 had in the equivalent places.
   *
   * BESIDE BILLING, NOT INSTEAD OF IT — WHICH IS v1'S SHAPE, AND THE EXACT
   * OPPOSITE OF WHAT THIS COMMENT USED TO SAY. v1's user-dropdown.tsx:55-59
   * renders Billing behind `hasBillingAccount = ['pro', 'cancelled',
   * 'expired'].includes(user.memberStatus)` (:168) and Upgrade behind
   * `!proMember` (:175). For 'cancelled' and 'expired' BOTH are true and both
   * render, deliberately; v1's own comment gives the reason — "Anyone who has
   * ever subscribed has a Polar customer record worth linking to, even once
   * the subscription has lapsed."
   *
   * THOSE TWO STATUSES ARE LIVE IN v2, so this is not a hypothetical.
   * schema.ts carries 'cancelled' and 'expired', lib/polarEvents.ts maps
   * `subscription.revoked` to 'expired' (every lapse lands there), access.ts's
   * `isProFor` answers `membershipStatus === 'pro'` so amIPro is FALSE for
   * them, and migrate.ts copies both statuses out of Supabase — real players
   * arrive in this state at cutover. Gating Billing on `isPro === true` took
   * the portal away from every one of them, because this component holds the
   * ONLY getCustomerPortalUrl call site in v2, and it also stranded
   * PortalResult's `no-customer` branch, which exists precisely to answer
   * somebody who reaches the portal with no Polar customer behind them.
   *
   * SO BILLING IS UNCONDITIONAL FOR AN AUTHENTICATED PLAYER, WHICH IS WIDER
   * THAN v1 AND IS A DELIBERATE WIDENING. `amIPro` is a boolean and v2 has no
   * `hasBillingAccount` equivalent, so the choice was between showing the
   * portal to everyone signed in and building a second Convex query, in a
   * parity phase, purely to hide it from the never-subscribed. The first: the
   * branch that answers them already exists and tells them the truth without
   * dressing it as a failure ("You do not have a billing account yet.", an
   * info toast). Recorded as V2-ADDENDUM.md §7a row 39.
   *
   * `=== false`, NOT `!isPro`, FOR THE REASON THE BADGE ABOVE GIVES. `isPro` is
   * undefined while amIPro is in flight and `!undefined` is true, so the loose
   * spelling would flash "Upgrade" at a paying subscriber on every cold load
   * and then take it away again. Spelling it out makes the in-flight state its
   * own case: Billing does not depend on the answer and is there from the first
   * frame, Upgrade appears only once amIPro has actually said no. A wrong label
   * is worse than a late one. Header.hook.test.ts pins all three states, and
   * the signed-out one, as the exact SET of buttons in the bar.
   */
  const showUpgrade = isPro === false

  return (
    <header className="sticky top-0 z-50 border-b border-line-subtle bg-background/80 px-4 backdrop-blur-lg">
      <nav className="page-wrap flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:py-4">
        {/*
          BOTH THIS AND "Home" BELOW POINT AT `/`, DECIDED IN PHASE 7 TASK 4 AND
          NO LONGER OPEN. Task 1 had them on /app only because deleting the old
          index route took `'/'` out of the router's `to` union and /app was the
          one alternative that compiled; the landing now exists, so the question
          is a real one again and this is the answer.

          PARITY, WHICH IS THE STANDARD THIS PHASE IS HELD TO: v1's app bar
          (src/components/app-bar/app-bar-base.tsx:73) links its wordmark to the
          MARKETING page, not the dashboard. `/` is v2's marketing page.

          AND `/` IS THE RIGHT SPELLING OF IT, not /home. The two render the
          identical component; `/` is the canonical apex (v1's sitemap puts it at
          priority 1 and /home at 0.9) and /home exists only to catch v1's
          inbound links. Linking internally to the duplicate would advertise the
          non-canonical copy of a page we serve twice.

          IT IS ALSO THE ONLY DESTINATION THAT IS CORRECT FOR BOTH AUDIENCES,
          which /app is not. `/`'s beforeLoad bounces a signed-in visitor to
          /app, so they get the dashboard exactly as they do today; an anonymous
          visitor gets the page that explains the product instead of the /login
          wall /app 307s them to. Sending a curious visitor from "Home" to a
          login form is the specific behaviour wordle-teams-390 is about.
        */}
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
          {/*
            `/`, for the reasons above — this link carried no marker before and
            read as settled, but it was deferred by the same Task 1 constraint
            as the wordmark and is decided here with it.

            NO `activeOptions={{ exact: true }}`, WHICH WAS CHECKED RATHER THAN
            ASSUMED. TanStack matches an active Link fuzzily by default and `/`
            is a prefix of every path in the app, so the underline could
            plausibly sit under "Home" everywhere. MEASURED on @tanstack/
            react-router 1.170: it does not — `is-active` appears on `/` and on
            no other route, /home and /about included. The option would be a
            no-op, so it is not here; e2e/routes.spec.ts asserts the outcome in
            both directions instead, which is what would catch a router upgrade
            changing that default.
          */}
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
              {/*
                NO CONDITION OF ITS OWN — every authenticated player gets this,
                including the lapsed subscriber v1 built `hasBillingAccount`
                for. See the note above `showUpgrade`; it is the only place in
                v2 that reaches the customer portal.
              */}
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
              {showUpgrade && (
                // Sparkles and the bare word "Upgrade", both taken from v1's
                // user-dropdown.tsx menu item; team-picker.tsx's CTA uses the
                // same icon for the same action. Deliberately the SAME shape as
                // the Billing button beside it — ghost, sm, icon-only below
                // `sm` — because the two sit in one row, and a differently
                // sized control there would move UserMenu and ThemeToggle
                // depending on who is signed in. BELOW `sm` THE ICON IS THE
                // ONLY THING TELLING THE TWO APART, since the label is
                // `hidden sm:inline`; Header.hook.test.ts pins both icons.
                <Button
                  variant="ghost"
                  size="sm"
                  // As above: the visible label is hidden below `sm`.
                  aria-label="Upgrade"
                  disabled={upgradePending}
                  onClick={() => void startUpgrade()}
                  className="px-2 sm:px-3"
                >
                  {upgradePending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">Upgrade</span>
                </Button>
              )}
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
