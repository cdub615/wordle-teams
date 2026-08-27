import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { ConvexBetterAuthProvider, type AuthClient } from '@convex-dev/better-auth/react'
import type { QueryClient } from '@tanstack/react-query'
import type { ConvexQueryClient } from '@convex-dev/react-query'
import { authClient } from '#/lib/auth-client'
import { getToken } from '#/lib/auth-server'
import { pageTitle } from '#/lib/seo'
import Footer from '../components/Footer'
import Header from '../components/Header'
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
   * HERE. routes/index.tsx prefetches with `ensureQueryData` because its reads
   * feed `useSuspenseQuery` — without the prefetch the component suspends and
   * the query only starts once the route renders, which is a real waterfall.
   * Header's reads feed a plain `useQuery`, so nothing waits on them: the badge
   * is simply absent for the first frame, and the subscription opens on the
   * first client render either way. There is no waterfall to remove, only
   * latency to add.
   *
   * THE FIRST VERSION OF THIS TASK DID AWAIT THEM HERE, and a root loader runs
   * before every child loader on every route — so those two awaits sat in front
   * of the dashboard's own three, on /about as well as on /. Removed on the
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
        // The site-wide default. Routes that had their own title in v1
        // override it with pageTitle('...'); everything else inherits this,
        // which is exactly how Next's title.default behaved.
        title: pageTitle(),
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent() {
  const context = Route.useRouteContext()
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
