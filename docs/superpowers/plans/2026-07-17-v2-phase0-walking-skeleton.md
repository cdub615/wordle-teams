# v2 Phase 0 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed TanStack Start app at `beta.wordleteams.com` on Cloudflare Workers where email-OTP login works and a page renders one value round-tripped through Convex — the Phase 0 done-when from the v2 re-platform spec (Beads epic `wt-ksh`, phase issue `wt-ksh.1`).

**Architecture:** New self-contained app in `v2/` (own `package.json` + `pnpm-lock.yaml`, NOT a workspace member — no imports across the `v2/` boundary). TanStack Start (pure Vite) with `@cloudflare/vite-plugin` targeting Workers. Convex holds all data and the Better Auth server instance (via the `@convex-dev/better-auth` component); the app proxies `/api/auth/*` to Convex's HTTP router so session cookies stay first-party. OTP emails go out through the Convex Resend component. Sentry wired on both client and Worker. CI deploys Convex then the Worker on `v2/`-touching pushes.

**Tech Stack (pinned — see Version Pins):** TanStack Start 1.168.x, `@cloudflare/vite-plugin` 1.45.x, wrangler 4.x, Convex 1.42.x, `@convex-dev/better-auth` 0.12.5 (exact), better-auth ~1.6.15, `@convex-dev/react-query` 0.1.0, `@convex-dev/resend` 0.2.x, Sentry 10.66.x, convex-test + Vitest, Playwright.

---

## Version Pins & Flux Warnings

| Package | Pin | Why |
|---|---|---|
| `@convex-dev/better-auth` | `0.12.5` **exact** | pre-1.0, breaking changes every minor (0.8→0.12 all have migration guides) |
| `better-auth` | `~1.6.15` | component peer range is `>=1.6.11 <1.7.0`; 1.7.0-rc.1 exists — do NOT take 1.7 |
| `@convex-dev/react-query` | `^0.1.0` | beta; requires `convex ^1.29.3` |
| `convex` | `^1.42.3` | satisfies both above |
| `@tanstack/react-start` / `react-router` | whatever the scaffold pins | Start (1.168.x) and Router (1.170.x) drift independently — keep the scaffold's compatible pair, don't bump to latest of each |
| `@sentry/cloudflare` + `@sentry/tanstackstart-react` | `^10.66.0` | the Start-on-Workers Sentry story is beta and split across two packages |

**Adaptation rule:** the C3 scaffold's generated files (aliases, entry exports, route conventions) are the source of truth for glue code. If a snippet below conflicts with what the scaffold generated or with the linked doc page, keep the *semantics* of the snippet and the *shape* of the scaffold/docs. Key doc pages:
- CF + TanStack Start: https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
- Convex + Better Auth + TanStack Start: https://labs.convex.dev/better-auth/framework-guides/tanstack-start (complete example: github.com/get-convex/better-auth `examples/tanstack`)
- Email OTP plugin: https://www.better-auth.com/docs/plugins/email-otp
- Convex + TanStack Query: https://docs.convex.dev/client/tanstack-query
- Sentry on CF + Start: https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/tanstack-start/
- convex-test: https://docs.convex.dev/testing/convex-test

**Assumptions surfaced (flag disagreement before executing):**
1. CI deploys beta on pushes to `dev` and `feat/v2-replatform` touching `v2/**` (trim the feature branch after Phase 0 merges). Vercel's auto-deploy of the old app from `dev` is untouched — never trigger Vercel manually.
2. Beta uses the **prod deployment** of the Convex project (per spec: beta *becomes* prod at cutover). Local dev uses your personal dev deployment.
3. OTP emails send from the Resend domain already verified for wordleteams.com (existing `RESEND_API_KEY` account). From-address `Wordle Teams <auth@wordleteams.com>` — confirm the verified domain in the Resend dashboard in Task 5.
4. Sentry: same org (`o177762`), new project `wordle-teams-v2`.
5. Executing on the existing `feat/v2-replatform` branch (no worktree needed — all work is additive inside `v2/`; the old app is never touched).

## File Structure (end state of Phase 0)

```
v2/
├── package.json              ← own deps, own lockfile (island rule)
├── pnpm-lock.yaml
├── wrangler.jsonc            ← Worker config, custom domain, public vars
├── vite.config.ts            ← cloudflare() + tanstackStart() + react()
├── vitest.config.ts          ← edge-runtime env for convex-test
├── playwright.config.ts
├── .env.local                ← gitignored; written by `convex dev` (dev deployment URLs)
├── .env.production           ← committed; public VITE_* values for prod builds
├── convex/
│   ├── convex.config.ts      ← registers betterAuth + resend components
│   ├── auth.config.ts
│   ├── auth.ts               ← createAuth (Better Auth instance) + getCurrentUser
│   ├── email.ts              ← Resend component instance
│   ├── http.ts               ← auth HTTP routes
│   ├── schema.ts             ← statusMessages + testOtps
│   ├── status.ts             ← round-trip query/mutation
│   ├── status.test.ts
│   └── testOtps.ts           ← E2E-only OTP capture (env-gated)
├── src/
│   ├── router.tsx            ← ConvexQueryClient wiring + Sentry client init
│   ├── start.ts              ← Sentry middlewares
│   ├── server.ts             ← Sentry-wrapped Worker entry
│   ├── lib/auth-client.ts
│   ├── lib/auth-server.ts
│   └── routes/
│       ├── __root.tsx        ← auth token fetch + ConvexBetterAuthProvider
│       ├── index.tsx         ← protected; round-trip demo + sign-out
│       ├── login.tsx         ← two-step OTP form
│       └── api/auth/$.ts     ← proxy to Convex .site HTTP router
├── e2e/
│   └── login.spec.ts
.github/workflows/deploy-v2.yml   ← at repo root (modify repo, not island — CI only)
```

---

### Task 1: Move wordleteams.com DNS to Cloudflare (manual, start immediately — propagation has lead time)

The zone must be active on Cloudflare before the Worker custom domain (Task 9) can exist. Vercel keeps serving apex/www through replicated records the whole time.

- [ ] **Step 1: Record current DNS.** Run and save the output (you'll verify against it later):

```bash
for r in A AAAA CNAME MX TXT; do echo "== $r =="; dig +short wordleteams.com $r; dig +short www.wordleteams.com $r; done
```

Also export the full record list from your current DNS provider's dashboard (registrar or Vercel DNS). Pay special attention to MX and TXT records (SPF/DKIM for Resend — breaking these breaks all app email).

- [ ] **Step 2: Add the zone.** Cloudflare dashboard → Add a domain → `wordleteams.com` → Free plan. Cloudflare scans and imports existing records. Compare the imported list against Step 1's export; add anything missed (especially TXT/MX). Leave the Vercel A/CNAME records exactly as they are, **set them to "DNS only" (grey cloud), not proxied** — Vercel must keep terminating TLS for the apex/www.

- [ ] **Step 3: Flip nameservers** at the registrar to the two Cloudflare-assigned nameservers. Wait for the zone to show **Active** (minutes to hours).

- [ ] **Step 4: Verify prod is unharmed.**

```bash
dig +short NS wordleteams.com          # expect the two *.ns.cloudflare.com hosts
curl -sI https://wordleteams.com | head -3    # expect HTTP/2 200 (or 307/308 to www) served by Vercel
dig +short TXT wordleteams.com         # SPF/verification records intact
```

Expected: prod site loads normally; `dig` shows Cloudflare nameservers; MX/TXT unchanged.

- [ ] **Step 5:** Record your **Cloudflare Account ID** (dashboard → Workers & Pages → right sidebar) — needed in Tasks 9–10. Update `wt-ksh.1` notes: `bd update wt-ksh.1 --notes="CF zone active; account id recorded"`.

### Task 2: Scaffold the TanStack Start app in `v2/`

**Files:** Create: `v2/` (entire scaffold via C3)

- [ ] **Step 1: Scaffold with Cloudflare's C3** (wires the Cloudflare Vite plugin + wrangler.jsonc automatically):

```bash
cd /home/cdub/projects/wordle-teams
pnpm create cloudflare@latest v2 --framework=tanstack-start --no-deploy --git=false
```

Answer prompts: TypeScript yes; do not deploy. `--git=false` because we're already inside the repo.

- [ ] **Step 2: Verify the island.** Confirm `v2/pnpm-lock.yaml` exists (repo root has no `pnpm-workspace.yaml`, so `v2/` is its own install root — verify with `ls /home/cdub/projects/wordle-teams/pnpm-workspace.yaml` → should not exist). Confirm `v2/.gitignore` covers `node_modules`, `.env*`, `dist`, `.wrangler`; add `.dev.vars` and `.env.local` if missing (keep `.env.production` committed by adding a `!.env.production` negation if the scaffold ignores `.env*` wholesale).

- [ ] **Step 3: Set the Worker name.** In `v2/wrangler.jsonc` set `"name": "wordle-teams-v2"`. Note the scaffold's `main`, `compatibility_date`, and `compatibility_flags` — expect `"main": "@tanstack/react-start/server-entry"` and `nodejs_compat`; ensure `compatibility_date` ≥ `2025-04-01` (required for automatic `process.env` population).

- [ ] **Step 4: Smoke the dev server.**

```bash
cd v2 && pnpm dev
```

Expected: Vite dev server on http://localhost:3000 renders the scaffold page. Note the port — if the scaffold uses a different one, use that value everywhere this plan says 3000 (SITE_URL, Playwright).

- [ ] **Step 5: Commit.**

```bash
cd /home/cdub/projects/wordle-teams
git add v2 && git commit -m "feat(v2): scaffold TanStack Start app for Cloudflare Workers"
```

### Task 3: Convex project + round-trip functions (TDD)

**Files:** Create: `v2/convex/schema.ts`, `v2/convex/status.ts`, `v2/convex/status.test.ts`, `v2/vitest.config.ts`

- [ ] **Step 1: Install and initialize Convex.**

```bash
cd v2
pnpm add convex
pnpm add -D convex-test vitest @edge-runtime/vm
npx convex dev --once
```

The CLI opens device login (create the Convex account if needed), then prompts to create a project — name it `wordle-teams`. It creates your **dev deployment**, writes `convex/_generated/`, and writes `v2/.env.local` with `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL`. Record the dev deployment URL.

- [ ] **Step 2: Write the schema** at `v2/convex/schema.ts`:

```ts
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  statusMessages: defineTable({
    message: v.string(),
  }),
})
```

- [ ] **Step 3: Vitest config** at `v2/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
})
```

Add scripts to `v2/package.json`:

```json
"test": "vitest",
"test:once": "vitest run"
```

- [ ] **Step 4: Write the failing tests** at `v2/convex/status.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

test('get returns null before any set', async () => {
  const t = convexTest(schema, modules)
  expect(await t.query(api.status.get, {})).toBeNull()
})

test('set then get round-trips the message', async () => {
  const t = convexTest(schema, modules)
  await t.mutation(api.status.set, { message: 'hello from convex' })
  expect(await t.query(api.status.get, {})).toBe('hello from convex')
})

test('set overwrites the existing message instead of accumulating docs', async () => {
  const t = convexTest(schema, modules)
  await t.mutation(api.status.set, { message: 'first' })
  await t.mutation(api.status.set, { message: 'second' })
  expect(await t.query(api.status.get, {})).toBe('second')
  await t.run(async (ctx) => {
    const all = await ctx.db.query('statusMessages').collect()
    expect(all).toHaveLength(1)
  })
})
```

- [ ] **Step 5: Run tests, verify they fail.**

```bash
pnpm test:once
```

Expected: FAIL — `Could not find public function for 'status:get'` (or import error for `./status`).

- [ ] **Step 6: Implement** `v2/convex/status.ts`:

```ts
import { query, mutation } from './_generated/server'
import { v } from 'convex/values'

export const get = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query('statusMessages').first()
    return doc?.message ?? null
  },
})

export const set = mutation({
  args: { message: v.string() },
  handler: async (ctx, { message }) => {
    const existing = await ctx.db.query('statusMessages').first()
    if (existing) {
      await ctx.db.patch(existing._id, { message })
    } else {
      await ctx.db.insert('statusMessages', { message })
    }
  },
})
```

- [ ] **Step 7: Run tests, verify they pass.** `pnpm test:once` → 3 passed. Also run `npx convex dev --once` to push schema+functions to the dev deployment (expect success, no type errors).

- [ ] **Step 8: Commit.**

```bash
git add convex vitest.config.ts package.json pnpm-lock.yaml
git commit -m "feat(v2): convex project with status round-trip functions and tests"
```

### Task 4: Wire Convex into the UI (round-trip page)

**Files:** Modify: `v2/src/router.tsx`, `v2/src/routes/index.tsx`

- [ ] **Step 1: Install the query integration.**

```bash
pnpm add @convex-dev/react-query @tanstack/react-query @tanstack/react-router-ssr-query
```

- [ ] **Step 2: Wire `ConvexQueryClient` into the router.** Replace the router-creation body of `v2/src/router.tsx` (keep the scaffold's imports/exports for `routeTree` and any generated types):

```tsx
import { createRouter } from '@tanstack/react-router'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  if (typeof window !== 'undefined') {
    notifyManager.setScheduler(window.requestAnimationFrame)
  }

  const convexUrl = import.meta.env.VITE_CONVEX_URL
  if (!convexUrl) throw new Error('VITE_CONVEX_URL is not set')

  const convexQueryClient = new ConvexQueryClient(convexUrl)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = createRouter({
    routeTree,
    context: { queryClient, convexQueryClient },
    scrollRestoration: true,
  })
  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}
```

Update the root route's context type in `v2/src/routes/__root.tsx` to match:

```tsx
import type { QueryClient } from '@tanstack/react-query'
import type { ConvexQueryClient } from '@convex-dev/react-query'

interface RouterContext {
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // ...keep the scaffold's head/shell/component as-is for now
})
```

- [ ] **Step 3: Round-trip page.** Replace `v2/src/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useSuspenseQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.status.get, {}))
  },
  component: Home,
})

function Home() {
  const { data: message } = useSuspenseQuery(convexQuery(api.status.get, {}))
  const [draft, setDraft] = useState('')
  const setMessage = useMutation({ mutationFn: useConvexMutation(api.status.set) })

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>wordle-teams v2 walking skeleton</h1>
      <p data-testid="status-message">
        Status from Convex: <strong>{message ?? '(none yet)'}</strong>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setMessage.mutate({ message: draft })
          setDraft('')
        }}
      >
        <label htmlFor="status">New status</label>{' '}
        <input id="status" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit">Save</button>
      </form>
    </main>
  )
}
```

- [ ] **Step 4: Verify the round trip.** Run `npx convex dev` in one terminal and `pnpm dev` in another. In the browser: save a message → it renders; reload → persists; open a second tab and save there → first tab updates live (Convex reactivity, no refresh).

- [ ] **Step 5: Commit.**

```bash
git add src package.json pnpm-lock.yaml
git commit -m "feat(v2): convex react-query wiring with live round-trip page"
```

### Task 5: Better Auth — Convex backend (email OTP via Resend)

**Files:** Create: `v2/convex/convex.config.ts`, `v2/convex/auth.config.ts`, `v2/convex/auth.ts`, `v2/convex/email.ts`, `v2/convex/http.ts`. Modify: `v2/vite.config.ts`

- [ ] **Step 1: Install pinned packages.**

```bash
pnpm add @convex-dev/better-auth@0.12.5 better-auth@~1.6.15 @convex-dev/resend
pnpm add -D @types/node
```

Verify the pins landed: `grep -E 'better-auth|resend' package.json` → `"@convex-dev/better-auth": "0.12.5"` (no caret), `"better-auth": "~1.6.15"`.

- [ ] **Step 2: Register components** at `v2/convex/convex.config.ts`:

```ts
import { defineApp } from 'convex/server'
import betterAuth from '@convex-dev/better-auth/convex.config'
import resend from '@convex-dev/resend/convex.config.js'

const app = defineApp()
app.use(betterAuth)
app.use(resend)
export default app
```

- [ ] **Step 3: Auth config provider** at `v2/convex/auth.config.ts`:

```ts
import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import type { AuthConfig } from 'convex/server'

export default { providers: [getAuthConfigProvider()] } satisfies AuthConfig
```

- [ ] **Step 4: Resend instance** at `v2/convex/email.ts`:

```ts
import { Resend } from '@convex-dev/resend'
import { components } from './_generated/api'

// testMode: false — real deliveries; the component defaults to test-only recipients otherwise.
export const resend = new Resend(components.resend, { testMode: false })
```

- [ ] **Step 5: The Better Auth instance** at `v2/convex/auth.ts`:

```ts
import { betterAuth } from 'better-auth/minimal'
import { emailOTP } from 'better-auth/plugins'
import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import { requireActionCtx } from '@convex-dev/better-auth/utils'
import authConfig from './auth.config'
import { components } from './_generated/api'
import { query } from './_generated/server'
import { resend } from './email'
import type { GenericCtx } from '@convex-dev/better-auth'
import type { DataModel } from './_generated/dataModel'

const siteUrl = process.env.SITE_URL!

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    plugins: [
      emailOTP({
        async sendVerificationOTP({ email, otp }) {
          await resend.sendEmail(requireActionCtx(ctx), {
            from: 'Wordle Teams <auth@wordleteams.com>',
            to: email,
            subject: `Your Wordle Teams sign-in code: ${otp}`,
            html: `<p>Your Wordle Teams sign-in code is <strong>${otp}</strong>. It expires in 5 minutes.</p>`,
          })
        },
      }),
      convex({ authConfig }),
    ],
  })

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.getAuthUser(ctx),
})
```

Before this compiles, confirm the from-address: Resend dashboard → Domains → use an address on the verified sending domain (assumed `wordleteams.com`; adjust `from:` if the verified domain differs).

- [ ] **Step 6: HTTP routes** at `v2/convex/http.ts`:

```ts
import { httpRouter } from 'convex/server'
import { authComponent, createAuth } from './auth'

const http = httpRouter()
authComponent.registerRoutes(http, createAuth)
export default http
```

- [ ] **Step 7: SSR bundling.** In `v2/vite.config.ts` add (alongside the existing plugins):

```ts
ssr: { noExternal: ['@convex-dev/better-auth'] },
```

- [ ] **Step 8: Dev deployment env vars.**

```bash
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set SITE_URL http://localhost:3000
npx convex env set RESEND_API_KEY <your Resend API key>   # reuse the existing account's key or mint a fresh "v2" key in the Resend dashboard (preferred)
```

- [ ] **Step 9: Push and verify.** `npx convex dev --once` → success, no type errors; Convex dashboard shows the `betterAuth` and `resend` components. Then `pnpm test:once` — if the status tests now fail because `import.meta.glob` pulls in auth files that reference components, follow the component-registration section of the convex-test docs (https://docs.convex.dev/testing/convex-test) to register the component modules in the test setup; the status tests must pass again before committing.

- [ ] **Step 10: Commit.**

```bash
git add convex vite.config.ts package.json pnpm-lock.yaml
git commit -m "feat(v2): better auth backend on convex with email OTP via resend"
```

### Task 6: Better Auth — app wiring + login UI

**Files:** Create: `v2/src/lib/auth-client.ts`, `v2/src/lib/auth-server.ts`, `v2/src/routes/api/auth/$.ts`, `v2/src/routes/login.tsx`. Modify: `v2/src/router.tsx`, `v2/src/routes/__root.tsx`, `v2/src/routes/index.tsx`

Note on aliases: snippets use `~/` — substitute the scaffold's configured alias (check `tsconfig.json` `paths`).

- [ ] **Step 1: Auth client** at `v2/src/lib/auth-client.ts`:

```ts
import { createAuthClient } from 'better-auth/react'
import { convexClient } from '@convex-dev/better-auth/client/plugins'
import { emailOTPClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [convexClient(), emailOTPClient()],
})
```

- [ ] **Step 2: Server utilities** at `v2/src/lib/auth-server.ts`:

```ts
import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'

// process.env works on Workers (nodejs_compat + compat date ≥ 2025-04-01 populates it)
// and import.meta.env covers local vite dev.
const convexUrl = process.env.VITE_CONVEX_URL ?? import.meta.env.VITE_CONVEX_URL
const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL ?? import.meta.env.VITE_CONVEX_SITE_URL

export const { handler, getToken, fetchAuthQuery, fetchAuthMutation, fetchAuthAction } =
  convexBetterAuthReactStart({ convexUrl, convexSiteUrl })
```

Add to `v2/.env.local` (dev values; the `.site` URL is the `.cloud` URL with the TLD swapped):

```
VITE_CONVEX_SITE_URL=https://<your-dev-deployment>.convex.site
VITE_SITE_URL=http://localhost:3000
```

- [ ] **Step 3: Auth proxy route** at `v2/src/routes/api/auth/$.ts`:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { handler } from '~/lib/auth-server'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
    },
  },
})
```

- [ ] **Step 4: Root route auth wiring.** In `v2/src/routes/__root.tsx`, add a server function that reads the session token and wrap the app in the provider (keep the scaffold's head/shell):

```tsx
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import { authClient } from '~/lib/auth-client'
import { getToken } from '~/lib/auth-server'
import type { QueryClient } from '@tanstack/react-query'
import type { ConvexQueryClient } from '@convex-dev/react-query'

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
  component: RootComponent,
  // keep the scaffold's head(), shellComponent/RootDocument, etc.
})

function RootComponent() {
  const context = Route.useRouteContext()
  return (
    <ConvexBetterAuthProvider
      client={context.convexQueryClient.convexClient}
      authClient={authClient}
      initialToken={context.token}
    >
      <Outlet />
    </ConvexBetterAuthProvider>
  )
}
```

- [ ] **Step 5: Expect auth in the router.** In `v2/src/router.tsx` change the client construction to:

```ts
const convexQueryClient = new ConvexQueryClient(convexUrl, { expectAuth: true })
```

(Required for a clean authenticated initial render; consequence: sign-out must `location.reload()` — handled in Step 7.)

- [ ] **Step 6: Login page** at `v2/src/routes/login.tsx`:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { authClient } from '~/lib/auth-client'

export const Route = createFileRoute('/login')({
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
    setPending(false)
    if (error) return setError(error.message ?? 'Failed to send code')
    setStep('code')
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const { error } = await authClient.signIn.emailOtp({ email, otp: code })
    setPending(false)
    if (error) return setError(error.message ?? 'Invalid code')
    window.location.href = '/' // full reload — required with expectAuth
  }

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 360 }}>
      <h1>Sign in</h1>
      {step === 'email' ? (
        <form onSubmit={sendCode}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <p>We emailed a code to {email}.</p>
          <label htmlFor="code">Code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" disabled={pending}>
            {pending ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      )}
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
    </main>
  )
}
```

- [ ] **Step 7: Protect the index page and add sign-out.** In `v2/src/routes/index.tsx` add to the route options:

```ts
beforeLoad: ({ context }) => {
  if (!context.isAuthenticated) throw redirect({ to: '/login' })
},
```

(import `redirect` from `@tanstack/react-router` and `authClient` from `~/lib/auth-client` in `index.tsx`). In the `Home` component, show the signed-in user and a sign-out button:

```tsx
const { data: user } = useSuspenseQuery(convexQuery(api.auth.getCurrentUser, {}))
// in JSX, above the status form:
<p data-testid="signed-in-email">Signed in as {user?.email}</p>
<button
  onClick={() =>
    authClient.signOut({ fetchOptions: { onSuccess: () => location.reload() } })
  }
>
  Sign out
</button>
```

and add the loader prefetch alongside the existing one:

```ts
await context.queryClient.ensureQueryData(convexQuery(api.auth.getCurrentUser, {}))
```

- [ ] **Step 8: Verify the full OTP loop locally.** With `npx convex dev` and `pnpm dev` running: visit `/` → redirected to `/login`; enter your real email → receive the code (check inbox; Convex dashboard logs show the Resend send); enter the code → land on `/` showing your email and the status round-trip; reload → still signed in; sign out → back to `/login`.

- [ ] **Step 9: Commit.**

```bash
git add src convex package.json pnpm-lock.yaml
git commit -m "feat(v2): email OTP login end-to-end with better auth"
```

### Task 7: Playwright smoke E2E (OTP login)

The spec requires one smoke E2E before each phase merge; OTP-in-E2E needs a code-capture mechanism, built once here and reused every phase. Capture is gated by an `E2E_TEST_MODE` env var set **only on the dev deployment** — never on prod.

**Files:** Create: `v2/convex/testOtps.ts`, `v2/e2e/login.spec.ts`, `v2/playwright.config.ts`. Modify: `v2/convex/schema.ts`, `v2/convex/auth.ts`

- [ ] **Step 1: Schema addition** in `v2/convex/schema.ts`:

```ts
testOtps: defineTable({
  email: v.string(),
  otp: v.string(),
}).index('by_email', ['email']),
```

- [ ] **Step 2: Capture functions** at `v2/convex/testOtps.ts`:

```ts
import { internalMutation, query } from './_generated/server'
import { v } from 'convex/values'

export const store = internalMutation({
  args: { email: v.string(), otp: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert('testOtps', args)
  },
})

export const latestFor = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (process.env.E2E_TEST_MODE !== 'true') {
      throw new Error('testOtps.latestFor is only available in E2E test mode')
    }
    const doc = await ctx.db
      .query('testOtps')
      .withIndex('by_email', (q) => q.eq('email', email))
      .order('desc')
      .first()
    return doc?.otp ?? null
  },
})
```

- [ ] **Step 3: Hook into OTP sending.** In `v2/convex/auth.ts`, at the top of `sendVerificationOTP` (import `internal` from `./_generated/api`):

```ts
if (process.env.E2E_TEST_MODE === 'true') {
  await requireActionCtx(ctx).runMutation(internal.testOtps.store, { email, otp })
  return // no real email in test mode
}
```

- [ ] **Step 4: Enable test mode on the dev deployment only.**

```bash
npx convex env set E2E_TEST_MODE true
```

- [ ] **Step 5: Playwright setup.**

```bash
pnpm add -D @playwright/test dotenv
npx playwright install chromium
```

`v2/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' }) // VITE_CONVEX_URL for the OTP-capture client

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
})
```

Add script: `"e2e": "playwright test"`.

- [ ] **Step 6: The smoke test** at `v2/e2e/login.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'

test('signs in with an emailed OTP code', async ({ page }) => {
  const email = `e2e+${Date.now()}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: /send code/i }).click()

  let otp: string | null = null
  await expect
    .poll(async () => (otp = await convex.query(api.testOtps.latestFor, { email })), {
      timeout: 15_000,
    })
    .not.toBeNull()

  await page.getByLabel('Code').fill(otp!)
  await page.getByRole('button', { name: /verify/i }).click()

  await expect(page.getByTestId('signed-in-email')).toContainText(email)
})
```

- [ ] **Step 7: Run it.** With `npx convex dev` running: `pnpm e2e` → 1 passed. (Each run creates a fresh throwaway user on the dev deployment — acceptable; dev data is disposable.)

- [ ] **Step 8: Commit.**

```bash
git add convex e2e playwright.config.ts package.json pnpm-lock.yaml
git commit -m "test(v2): playwright OTP login smoke with env-gated code capture"
```

### Task 8: Sentry (client + Worker)

**Files:** Create: `v2/src/server.ts`. Modify: `v2/src/router.tsx`, `v2/src/start.ts` (create if the scaffold didn't), `v2/wrangler.jsonc`

This is the flakiest integration (beta SDK, split packages) — follow https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/tanstack-start/ exactly where these snippets drift.

- [ ] **Step 1: Create the Sentry project** (manual): sentry.io, existing org → Create project → platform "TanStack Start (React)" → name `wordle-teams-v2`. Record the DSN.

- [ ] **Step 2: Install.**

```bash
pnpm add @sentry/cloudflare @sentry/tanstackstart-react
```

- [ ] **Step 3: Worker entry wrapper** at `v2/src/server.ts`:

```ts
import * as Sentry from '@sentry/cloudflare'
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react'
import handler from '@tanstack/react-start/server-entry'

export default Sentry.withSentry(
  (env: { SENTRY_DSN?: string }) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.2,
  }),
  // @ts-expect-error handler type mismatch between Start and CF — required per Sentry docs
  wrapFetchWithSentry(handler),
)
```

Change `v2/wrangler.jsonc`: `"main": "src/server.ts"`.

- [ ] **Step 4: Client init.** In `v2/src/router.tsx`, after creating the router:

```ts
import * as Sentry from '@sentry/tanstackstart-react'

if (!router.isServer) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    tracesSampleRate: 0.2,
  })
}
```

Add `VITE_SENTRY_DSN=<dsn>` to `v2/.env.local` (and later `.env.production`).

- [ ] **Step 5: Server-function middlewares.** In `v2/src/start.ts` (matching the scaffold's `createStart` shape):

```ts
import { createStart } from '@tanstack/react-start'
import {
  sentryGlobalRequestMiddleware,
  sentryGlobalFunctionMiddleware,
} from '@sentry/tanstackstart-react'

export const startInstance = createStart(() => ({
  requestMiddleware: [sentryGlobalRequestMiddleware],
  functionMiddleware: [sentryGlobalFunctionMiddleware],
}))
```

- [ ] **Step 6: Verify locally.** `pnpm dev` still serves; `pnpm build` succeeds. (Full event-capture verification happens on beta in Task 9 — local Worker-side Sentry won't initialize under plain vite dev.) Known caveats to accept, not fix: SSR render exceptions need manual `captureException`; Worker spans show 0ms durations. Skip source-map upload in Phase 0.

- [ ] **Step 7: Commit.**

```bash
git add src wrangler.jsonc package.json pnpm-lock.yaml
git commit -m "feat(v2): sentry on client and worker entry"
```

### Task 9: Wrangler config + first beta deploy

**Files:** Modify: `v2/wrangler.jsonc`. Create: `v2/.env.production`

- [ ] **Step 1: Create the prod Convex deployment.**

```bash
npx convex deploy
```

First run provisions the production deployment of the `wordle-teams` project. Record its URL (`https://<prod-slug>.convex.cloud`; the `.site` variant swaps the TLD).

- [ ] **Step 2: Prod Convex env vars.**

```bash
npx convex env set --prod BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set --prod SITE_URL https://beta.wordleteams.com
npx convex env set --prod RESEND_API_KEY <same key as Task 5>
# E2E_TEST_MODE deliberately NOT set on prod
```

- [ ] **Step 3: Public build-time vars** at `v2/.env.production` (all public values — safe to commit):

```
VITE_CONVEX_URL=https://<prod-slug>.convex.cloud
VITE_CONVEX_SITE_URL=https://<prod-slug>.convex.site
VITE_SITE_URL=https://beta.wordleteams.com
VITE_SENTRY_DSN=<dsn from Task 8>
```

Ensure `.gitignore` doesn't swallow it (`!.env.production` if needed).

- [ ] **Step 4: Final `v2/wrangler.jsonc`** (merge with scaffold-generated fields; substitute recorded values):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "wordle-teams-v2",
  "main": "src/server.ts",
  "compatibility_date": "2026-06-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "routes": [{ "pattern": "beta.wordleteams.com", "custom_domain": true }],
  "vars": {
    "VITE_CONVEX_URL": "https://<prod-slug>.convex.cloud",
    "VITE_CONVEX_SITE_URL": "https://<prod-slug>.convex.site",
    "VITE_SITE_URL": "https://beta.wordleteams.com",
    "SENTRY_DSN": "<dsn from Task 8>"
  }
}
```

(Custom Domains require the zone active — Task 1 — and no pre-existing `beta` DNS record; Cloudflare creates the record + cert automatically. Keep the scaffold's `compatibility_date` if it's newer.)

- [ ] **Step 5: Deploy.**

```bash
npx wrangler login       # first time only
npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name VITE_CONVEX_URL
npx wrangler deploy
```

Expected: convex deploy pushes functions to prod and runs the vite build with prod `VITE_CONVEX_URL`; wrangler deploy publishes and binds `beta.wordleteams.com`.

- [ ] **Step 6: Verify the Phase 0 done-when on beta.** In a browser (ideally also on your phone):
  1. `https://beta.wordleteams.com` loads over valid TLS → redirects to `/login`
  2. OTP login with your real email works (real Resend email arrives — prod deployment has no test mode)
  3. The status round-trip page renders, saving a message persists, second tab live-updates
  4. Throw a test error (e.g. temporarily visit a nonexistent-function route or add `?boom` handling — simplest: add a temporary `<button onClick={() => { throw new Error('sentry beta test') }}>` locally, deploy, click, remove) and confirm the event lands in the `wordle-teams-v2` Sentry project

- [ ] **Step 7: Commit.**

```bash
git add wrangler.jsonc .env.production
git commit -m "feat(v2): beta deployment config and custom domain"
```

### Task 10: GitHub Actions deploy pipeline

**Files:** Create: `.github/workflows/deploy-v2.yml` (repo root)

- [ ] **Step 1: Secrets** (GitHub repo → Settings → Secrets and variables → Actions):
  - `CONVEX_DEPLOY_KEY` — Convex dashboard → project settings → generate **Production** deploy key
  - `CLOUDFLARE_API_TOKEN` — Cloudflare dashboard → API tokens → "Edit Cloudflare Workers" template, scoped to the account + `wordleteams.com` zone
  - `CLOUDFLARE_ACCOUNT_ID` — from Task 1 Step 5

- [ ] **Step 2: Workflow** at `.github/workflows/deploy-v2.yml`:

```yaml
name: Deploy v2 (beta)

on:
  push:
    branches: [dev, feat/v2-replatform]
    paths: ['v2/**', '.github/workflows/deploy-v2.yml']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: v2
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: v2/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:once
      - run: npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name VITE_CONVEX_URL
        env:
          CONVEX_DEPLOY_KEY: ${{ secrets.CONVEX_DEPLOY_KEY }}
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: v2
          command: deploy
```

- [ ] **Step 3: Verify.** Commit and push the branch:

```bash
git add .github/workflows/deploy-v2.yml
git commit -m "ci: deploy v2 to beta on v2-touching pushes"
git push -u origin feat/v2-replatform
```

Watch the run: `gh run watch` (or `gh run list --workflow=deploy-v2.yml`). Expected: tests pass, convex deploy + wrangler deploy succeed, beta still serves. Trim `feat/v2-replatform` from the branch list when Phase 0 merges to `dev`.

### Task 11: Supabase Storage audit (spec's open Phase 0 checklist item)

- [ ] **Step 1:** Supabase dashboard → project → Storage: list all buckets. For each, note object counts. Alternatively run in the SQL editor:

```sql
select bucket_id, count(*) as objects, sum(coalesce((metadata->>'size')::bigint, 0)) as bytes
from storage.objects group by 1;
```

- [ ] **Step 2:** Record the outcome in Beads:
  - If buckets are empty/unused: `bd update wt-ksh --notes="Storage audit: no user files in Supabase Storage — nothing to migrate"` and consider the checklist item closed.
  - If real user files exist (e.g. avatars): file a new issue — `bd create --title="Migrate Supabase Storage files to Convex file storage" --type=task --parent=wt-ksh --description="Storage audit found real user files: <details>. Port to Convex file storage; wire into copy script." --deps=blocks:wt-ksh.2` — so it lands in the Phase 1 copy-script work.

### Task 12: Phase 0 verification & close-out

- [ ] **Step 1: Full local gate.** In `v2/`: `pnpm test:once` (all convex tests pass), `pnpm e2e` (smoke passes), `pnpm build` (clean).

- [ ] **Step 2: Beta done-when re-check** (fresh browser/incognito): OTP login at `https://beta.wordleteams.com` + round-trip page live-updates. This is the phase's acceptance criterion — do not close without it.

- [ ] **Step 3: Prod regression sanity:** `https://wordleteams.com` still serves the old app normally (DNS move side-effects check).

- [ ] **Step 4: Close the phase.**

```bash
bd close wt-ksh.1 --reason="Done-when met: OTP login live at beta.wordleteams.com; convex round-trip page verified" --suggest-next
bd dolt pull
git add -A && git commit -m "chore(v2): phase 0 close-out"
```

(`--suggest-next` should show `wt-ksh.2` Phase 1 — Auth complete + data copy — unblocked.)
