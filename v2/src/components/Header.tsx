import { Link } from '@tanstack/react-router'
import { convexQuery, useConvexAuth } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Mails, Sparkles } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { Badge } from '#/components/ui/badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import { pendingInviteLabel } from '#/lib/billing-copy.ts'
import { useLocalCapture } from '#/lib/use-local-capture.ts'
import { useStartUpgrade } from '#/lib/use-start-upgrade.ts'
import { AppMenu } from './app-menu.tsx'

/**
 * The app bar. DESIGN_SYSTEM.md section 8 describes the shape — gradient
 * wordmark left, user affordance right, separator underneath.
 *
 * IT HOLDS FOUR THINGS NOW, DOWN FROM SEVEN (wordle-teams-lyab). The Home/About
 * nav row, the Billing button and the "Auto" theme pill all moved into
 * app-menu.tsx; what is left is the wordmark, the pending-invite badge, the
 * Upgrade CTA and the menu. On a phone the old bar wrapped its nav onto a
 * second line and still read as clutter — see the screenshots on the issue.
 *
 * UPGRADE STAYED OUT OF THE MENU, DELIBERATELY, AND IT IS THE ONE THING HERE
 * THAT IS A JUDGEMENT RATHER THAN A TIDY-UP. Everything else in the bar was
 * navigation or a preference, which loses nothing by costing one tap. Upgrade
 * is the conversion path: wordle-teams-456 measures 87% of production signups
 * never entering a single board, and burying the only always-reachable route
 * to checkout behind a hamburger pushes in exactly the wrong direction. See
 * `showUpgrade`.
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
  // Shared with routes/app.tsx's "Upgrade for more" — one copy of the outcome
  // handling, in lib/use-start-upgrade.ts. See the button below.
  const { startUpgrade, pending: upgradePending } = useStartUpgrade()

  const { data: isPro } = useQuery(
    convexQuery(api.teams.amIPro, isAuthenticated ? {} : 'skip'),
  )
  const { data: pendingInvites } = useQuery(
    convexQuery(api.billing.myPendingInviteCount, isAuthenticated ? {} : 'skip'),
  )

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
   * WHAT IT DOES NOT CLOSE: the owner's account is comped pro, so `isPro` is
   * true for him, this button does not render, and he STILL cannot reach
   * checkout as himself. That is correct behaviour rather than a leftover gap —
   * offering a subscriber a second subscription is the thing the condition
   * exists to prevent — and it is why Task 18's Polar sandbox pass
   * (wordle-teams-02c) has to mint a fresh non-pro account instead of using his.
   *
   * ONE MORE ENTRY POINT, NOT v1'S THREE. v1 had an upgrade button in the user
   * dropdown, the teams dropdown and the month dropdown — lib/polar/checkout.ts
   * calls them "the three upgrade buttons in the app" — but three is a funnel
   * experiment and this is a parity phase. team-picker.tsx's gated CTA stays;
   * two entry points to one action is what v1 had in the equivalent places.
   *
   * BILLING IS NO LONGER ITS NEIGHBOUR — it moved into the menu, and the long
   * argument for why Billing is UNCONDITIONAL for an authenticated player
   * (v1's `hasBillingAccount` covers 'pro', 'cancelled' and 'expired'; v2 has
   * no equivalent and would have needed a second query purely to hide the
   * portal from the never-subscribed; recorded as V2-ADDENDUM.md §7a row 39)
   * moved with it, to app-menu.tsx.
   *
   * `=== false`, NOT `!isPro`, FOR THE REASON THE BADGE ABOVE GIVES. `isPro` is
   * undefined while amIPro is in flight and `!undefined` is true, so the loose
   * spelling would flash "Upgrade" at a paying subscriber on every cold load
   * and then take it away again. Spelling it out makes the in-flight state its
   * own case: Upgrade appears only once amIPro has actually said no. A wrong
   * label is worse than a late one. Header.hook.test.ts pins all three states,
   * and the signed-out one, as the exact SET of buttons in the bar.
   */
  const showUpgrade = isPro === false

  return (
    <header className="sticky top-0 z-50 border-b border-line-subtle bg-background/80 px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-4 py-3 sm:py-4">
        {/*
          POINTS AT THE MARKETING LANDING, decided in Phase 7 Task 4 and no
          longer open. Task 1 had it on /app only because deleting the old index
          route took `'/'` out of the router's `to` union.

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
          wall /app 307s them to. Sending a curious visitor from the wordmark to
          a login form is the specific behaviour wordle-teams-390 is about.

          IT IS ALSO NOW THE BAR'S ONLY NAVIGATION. The "Home" link that used to
          sit below this and duplicate it is a menu item; the wordmark being a
          real link to the landing is what keeps that one tap from being the
          only way back.
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

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {showInviteBadge && (
            // NOT A BUTTON, mirroring v1, whose menu item carries
            // `focus:bg-transparent` precisely so it does not read as one:
            // there is nothing to click. Accepting an invite is the upgrade,
            // and the upgrade is the button beside it.
            <Badge variant="secondary" className="gap-1 whitespace-nowrap">
              <Mails className="h-3.5 w-3.5" aria-hidden="true" />
              {pendingInviteLabel(pendingInvites ?? 0)}
            </Badge>
          )}
          {isAuthenticated && showUpgrade && (
            // Sparkles and the bare word "Upgrade", both taken from v1's
            // user-dropdown.tsx menu item; team-picker.tsx's CTA uses the same
            // icon for the same action. Icon-only below `sm`, where the label
            // is hidden and the icon is the only thing naming it — hence the
            // explicit aria-label, which would otherwise leave the button with
            // no accessible name at all on a phone.
            <Button
              variant="ghost"
              size="sm"
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
            NOT GATED ON isAuthenticated, WHICH IS THE CHANGE. Its predecessor
            (settings/user-menu.tsx) only ever mounted for a session, and could
            afford to because the nav and the theme control lived in the bar
            beside it. Now that they live INSIDE the menu, gating the mount
            would leave a signed-out visitor on /login or /about with no
            navigation and no theme control whatsoever. app-menu.tsx branches
            per item instead, and gates its own three queries with 'skip'.
          */}
          <AppMenu />
        </div>
      </nav>
    </header>
  )
}
