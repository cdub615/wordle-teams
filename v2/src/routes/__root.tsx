import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
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
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
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
        <Footer />
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
        <Scripts />
      </body>
    </html>
  )
}
