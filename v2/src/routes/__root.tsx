import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { ConvexBetterAuthProvider, type AuthClient } from '@convex-dev/better-auth/react'
import type { QueryClient } from '@tanstack/react-query'
import type { ConvexQueryClient } from '@convex-dev/react-query'
import { authClient } from '#/lib/auth-client'
import { getToken } from '#/lib/auth-server'
import { pageTitle, socialMetaTags } from '#/lib/seo'
import { useServiceWorkerRegistration } from '#/lib/register-sw.ts'
import { hidesSiteFooter } from '#/lib/site-chrome.ts'
import Footer from '../components/Footer'
import Header from '../components/Header'
import { PullToRefresh } from '../components/pull-to-refresh'
import { Toaster } from '#/components/ui/sonner.tsx'

import appCss from '../styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

interface RouterContext {
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}

const fetchAuth = createServerFn({ method: 'GET' }).handler(async () => {
  const token = await getToken()
  return { isAuthenticated: !!token, token }
})

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async (ctx) => {
    const { isAuthenticated, token } = await fetchAuth()
    if (token) {
      // SSR-only: authenticate loader-time Convex queries
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token)
    }
    return { isAuthenticated, token }
  },
  /*
   * NO LOADER, AND THE HEADER'S TWO QUERIES ARE DELIBERATELY NOT PREFETCHED
   * HERE. routes/app.tsx prefetches with `ensureQueryData` because its reads
   * feed `useSuspenseQuery` — without the prefetch the component suspends and
   * the query only starts once the route renders, which is a real waterfall.
   * Header's reads feed a plain `useQuery`, so nothing waits on them: the badge
   * is simply absent for the first frame, and the subscription opens on the
   * first client render either way. There is no waterfall to remove, only
   * latency to add.
   *
   * THE FIRST VERSION OF THIS TASK DID AWAIT THEM HERE, and a root loader runs
   * before every child loader on every route — so those two awaits sat in front
   * of the dashboard's own three, on /about as well as on /app. Removed on the
   * argument above rather than on a measurement: taking the loader out did NOT
   * on its own settle `pnpm e2e`, which is why the flake that showed up
   * alongside it is written down where its real cause was found
   * (e2e/billing.spec.ts) and not here.
   */
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        /*
          `viewport-fit=cover` IS WHAT MAKES `env(safe-area-inset-*)` MEAN
          ANYTHING (wordle-teams-8h2p). Without it the browser sizes the layout
          viewport to the SAFE area and reports every inset as 0 — which is why
          composer.tsx's `max(1.5rem, env(safe-area-inset-bottom))` has been
          falling through to its 1.5rem base since the day it was written, and
          why every other `env()` added alongside this change is inert on a flat
          screen and only grows on a notched one.

          IT MATTERS MORE HERE THAN ON AN ORDINARY SITE because
          public/manifest.json declares `"display": "standalone"`: installed,
          there is no browser chrome to absorb the insets, so content genuinely
          reaches the physical edges of the screen. `"orientation": "portrait"`
          is what keeps this to a top and a bottom problem — the side cutout
          case only exists in landscape, which the installed app cannot enter.

          EVERY EDGE-ANCHORED ELEMENT WAS INSET IN THE SAME COMMIT, because a
          half-done version of this is worse than none: the header would sit
          under the status bar, the toast under the home indicator. The list is
          Header, PullToRefresh, board-entry's sticky footer, Footer, the
          Dialog/Sheet content boxes, the Toaster's offsets and `.page-max`'s
          gutter. The composer already had its `max()` and did not change.

          THE OFFLINE FALLBACK IN src/sw.ts DELIBERATELY KEEPS THE OLD META.
          It is a self-contained document with no chrome of its own, so letting
          the browser inset its viewport is exactly the behaviour it wants;
          there is nothing there that needs to reach an edge.

          ON iOS, THE INSTALLED APP ALSO NEEDS `apple-mobile-web-app-status-bar-style:
          black-translucent` BEFORE THE TOP INSET IS NON-ZERO IN STANDALONE —
          without it iOS places the web view below the status bar and reports 0.
          NOT added here: it forces light status-bar text regardless of theme,
          and this app has a light mode. Safari tabs and Android get the top
          inset from this meta alone; the padding below is correct either way,
          because it is 0 wherever the inset is 0.
        */
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      {
        // Matches public/manifest.json's theme_color (and its background_color,
        // which is the same value). The manifest colours the standalone window;
        // this colours the browser UI on a normal tab, and Android reads it for
        // the task-switcher card. They have to agree or the app changes shade
        // as it is installed.
        name: 'theme-color',
        content: '#0a0a0a',
      },
      {
        // The site-wide default. Routes that had their own title in v1
        // override it with pageTitle('...'); everything else inherits this,
        // which is exactly how Next's title.default behaved.
        title: pageTitle(),
      },
      /*
        THE DESCRIPTION AND THE SOCIAL CARD, SPREAD RATHER THAN SPELLED OUT.
        Nineteen tags matched against what production emits today, tag for tag;
        the list and the argument for every value live in lib/seo.ts. They are
        a data structure there because that is the only shape `vitest run` can
        read — v2 has no component-rendering tests (the vitest environment is
        edge-runtime, so no DOM) and CI runs no Playwright, so tags written
        inline here would be pinned by nothing that CI executes.

        SITE-WIDE, LIKE v1's. Next put openGraph and twitter in the root
        layout's metadata with no page overriding them, so every route in
        production carries this same card. Nothing here varies by route, which
        is a known limitation of v1 carried across deliberately — see the
        og:url note in lib/seo.ts.
      */
      ...socialMetaTags,
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        // WITHOUT THIS THE APP IS NOT INSTALLABLE AT ALL. public/manifest.json
        // has been correct since bc8e061 — right name, four icons, standalone,
        // portrait — and nothing had ever linked it, so no browser had any
        // reason to fetch it and no install prompt could ever appear.
        rel: 'manifest',
        href: '/manifest.json',
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent() {
  const context = Route.useRouteContext()
  // Client-only by construction: the hook's whole body is a useEffect, and
  // effects do not run during SSR. Mounted here rather than in RootDocument for
  // no deeper reason than that this is the component that renders on the
  // client — it touches no context and does not care about the provider.
  useServiceWorkerRegistration()
  /*
    THE FOOTER IS NOW CONDITIONAL, AND IT MOVED HERE TO BECOME SO.
    RootDocument is the root route's `shellComponent`, which
    @tanstack/react-router renders OUTSIDE the match context (Match.js wraps
    the provider in it) — the same positioning that used to break every Convex
    hook in Header. Rather than reason a second time about which hooks survive
    up there, the Footer moved down beside the Outlet it belongs with.

    THE RENDERED DOM IS UNCHANGED for every route that keeps it. RootDocument's
    `{children}` is exactly this subtree and the Footer sat immediately after
    it, so <body> still reads header, page, footer, Toaster.

    WHY IT IS SUPPRESSED AT ALL, AND ONLY ON /chat: that route lays itself out
    to the viewport — a message list that scrolls inside a bounded column, with
    the composer pinned to the bottom edge — and a footer below that makes the
    PAGE scroll instead, pushing the composer off screen. Every other route is
    a document, and keeps it. The rule itself is `hidesSiteFooter`, pure and
    tested, because nothing in this file can be.
  */
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <ConvexBetterAuthProvider
      client={context.convexQueryClient.convexClient}
      // Cast: @convex-dev/better-auth 0.12.5 types its AuthClient against better-auth
      // 1.6.15; our installed 1.6.23 infers a structurally compatible but nominally
      // different client type. Runtime shape is identical.
      authClient={authClient as unknown as AuthClient}
      initialToken={context.token}
    >
      {/*
        HEADER LIVES HERE, NOT IN RootDocument, and the move is what makes its
        Convex hooks work at all: shellComponent renders OUTSIDE the root
        route's component (@tanstack/react-router's Match.js wraps the match
        context provider in it), so a Header in RootDocument sits above this
        provider and every Convex React hook in it throws "Could not find
        Convex client!" — measured as a 500 on GET /login.

        THE RENDERED DOM IS UNCHANGED. RootDocument's `{children}` is exactly
        this subtree, and it sat between Header and Footer there, so <body>
        still reads header, page, footer.
      */}
      {/*
        PullToRefresh NEEDS NO CONVEX HOOK OF ITS OWN, unlike Header — it is
        placed here (rather than in RootDocument, alongside Footer) purely so
        every route under this provider gets the same one instance, matching
        how Header and useServiceWorkerRegistration are already scoped.
      */}
      <PullToRefresh />
      <Header />
      <Outlet />
      {hidesSiteFooter(pathname) ? null : <Footer />}
    </ConvexBetterAuthProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-accent-solid/25">
        {children}
        {/*
          Was defined (ui/sonner.tsx, fully themed and iconed) but never
          mounted anywhere, which made every toast.success/error/warning call
          in the app — including all three of board entry's — a silent no-op.
          Caught while verifying Task 8's forced-failure path: the console
          showed the catch block running and calling toast.error, but nothing
          ever appeared on screen. Root-level, once, like any portal-based
          toaster.
        */}
        <Toaster />
        {/*
          NOT RENDERED UNDER PLAYWRIGHT, and this is a harness fix rather than a
          product one. `position: 'bottom-right'` puts the launcher in the same
          corner as the chat composer's Send button, and the launcher wins:
          Chromium reports its <img> as intercepting pointer events, so
          `Send.click()` never reaches the button. Playwright's default
          actionTimeout is 0 — UNBOUNDED — so the click retries forever instead
          of failing, and the spec dies on its own 120s test timeout with a
          stack pointing at the finally block. That is what made
          wordle-teams-zzo7 look like a chat defect: the symptom on screen is an
          unsent draft still sitting in the textarea beside "No messages yet".

          IT HAS NEVER SHIPPED TO ANYONE. @tanstack/react-devtools compiles the
          UI out of a production build — `Open TanStack Devtools` appears
          nowhere in dist/, and the only devtools strings that survive there are
          React's own __REACT_DEVTOOLS_GLOBAL_HOOK__ — so no user has ever had a
          launcher over their Send button. The obstruction exists only against
          `vite dev`, which is precisely what the e2e suite drives.

          SUPPRESSED RATHER THAN MOVED, because moving it to another corner only
          chooses which specs it breaks next; and rather than `force: true` at
          the call site, which would assert that a click lands where a real
          click could not. The flag is set by playwright.config.ts's webServer
          and by nothing else, so an ordinary `pnpm dev` still has devtools.
        */}
        {!import.meta.env.VITE_E2E && (
          <TanStackDevtools
            config={{
              position: 'bottom-right',
            }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        )}
        <Scripts />
      </body>
    </html>
  )
}
