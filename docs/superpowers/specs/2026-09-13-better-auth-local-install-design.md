# Better Auth component → Local Install

**Date:** 2026-09-13
**Issue:** wordle-teams-hrqw (P2) · blocks wordle-teams-wty4.1.7 · watch wordle-teams-368m
**Status:** design approved, plan pending

## What we are building and why

Stop using the prebuilt `@convex-dev/better-auth` component out of `node_modules` and
define it inside the repo at `v2/convex/betterAuth/` instead, so that **we own its
schema**. The schema is the only reason to do this, and passkeys are the only reason
the schema matters yet.

`v2/convex/convex.config.ts:6` mounts the prebuilt component. Its schema is
auto-generated upstream, enumerated, and fixed at ten tables — `user`, `session`,
`account`, `verification`, `twoFactor`, `oauthApplication`, `oauthAccessToken`,
`oauthConsent`, `jwks`, `rateLimit` (`dist/component/schema.js`). The Better Auth
passkey plugin declares a `passkey` table. There is nowhere to put it.

Local Install is the supported answer. The component's own generated schema header
points at it, and the docs describe it as what "gives you full control over your
Better Auth schema … and makes it possible to use plugins beyond those supported for
Convex + Better Auth."

### This is deliberately not the passkey feature

The passkey plugin is **not wired up in this work**. The migration ships with the
`passkey` table present and empty and no behaviour change of any kind. The reason is
that this change touches authentication for every user in the app, and the only way to
judge it is against the question "did anything move?" — a question that stops being
answerable the moment a feature rides along with it. Passkeys are a separate, small
change on top of a component already known good. That is wordle-teams-wty4.1.7.

## The findings that shaped the scope

Two beliefs recorded on wordle-teams-wty4.1.7 turned out to be wrong, in opposite
directions, and both are worth keeping because either one alone would have produced
the wrong plan.

**The DNS cutover is not an ordering constraint.** The issue held that passkeys
registered on beta would be orphaned by the flip to the production hostname, and that
this therefore had to ship either configured for production or after the flip. That is
true only under the default relying-party ID, which is the full hostname. It is not
true here: beta is `beta.wordleteams.com` and production is the apex
`wordleteams.com` (`docs/runbooks/2026-cutover.md:289`), and WebAuthn permits an rpID
that is the origin's effective domain **or any registrable-domain suffix of it**. A
credential scoped to the apex works on the apex and on every subdomain, so
`rpID: 'wordleteams.com'` registered from beta survives the flip. `@better-auth/passkey`
exposes both knobs needed — `rpID`, and `origin` typed `string | string[] | null`, so
beta and apex can both be trusted at once.

**There was never a version wall.** An earlier pass on this concluded that passkeys
were unbuildable because `@better-auth/passkey` started at 1.7.0 while the Convex
component pins `better-auth <1.7.0`. That rested on a truncated `npm view … versions`
output; the package goes back to 1.4.0-beta, and `@better-auth/passkey@1.6.23` peers
exactly onto the installed tree. Nothing needs upgrading. **The component schema was
always the whole blocker.**

What remains true, and constrains everything downstream: **stay on the 1.6 line.**
Better Auth 1.7.0 removed `better-auth/plugins/oidc-provider`, which `convex()` still
imports (`dist/plugins/convex/index.js:4`), so 1.7.x fails at component bundling with
`The path "./plugins/oidc-provider" is not exported by package "better-auth"`. That is
upstream `get-convex/better-auth#433`; the fix is PR #430, open and unmerged as of
2026-09-10, and it carries a staged account-issuer backfill of its own.

## What was measured, and what it settled

The one question that decided whether this is a half-day task or a maintenance window:
does Convex treat the component as the **same instance**, with the same physical
tables, when the mount name stays `"betterAuth"` but the `componentDefinitionPath`
moves from `node_modules/…/dist/component` to `convex/betterAuth`?

**It does. Data is preserved.** Measured 2026-09-13 on a throwaway project against an
anonymous local Convex backend (`CONVEX_AGENT_MODE=anonymous`, convex pinned to 1.42.2
to match this repo). Beta and prod were never contacted.

| Phase | Result |
| --- | --- |
| Mount the prebuilt component, write a `user` row via `components.betterAuth.adapter.create` — the call `fixtures.ts:87` uses | row written |
| Copy `src/component` → `convex/betterAuth/`, repoint `convex.config.ts`, redeploy | **row read back intact** |
| Add the `passkey` table as a pure addition, redeploy | **row still intact** |
| Negative control: remove a field existing rows carry | push **refused** — `SchemaDefinitionError` |

The mechanism was confirmed independently with a hand-rolled component: `use()`
resolves the mount as `options.name ?? definition.defaultName ?? basename(path)`
(`convex/dist/esm/server/components/index.js:77-85`), and both the prebuilt and the
local definition are `defineComponent("betterAuth")`.

**CONFIRMED ON BETA 2026-09-13, AFTER THE FACT.** The rehearsal below ran on an
anonymous **local** backend via `convex dev`; beta ran `convex deploy` against
**cloud** Convex. That local-vs-cloud gap was never stated as a limit of the
probe — only the stub adapter was — and it mattered, because component identity
could in principle be computed differently in the two. It is not: after the beta
deploy, the `betterAuth` component's `user` table still holds rows created before
the deploy. The claim is now first-hand rather than inferred from a rehearsal.

One check did fail, and it is worth recording why it was not the alarm it looked
like. A browser signed in before the deploy was signed out. That check was a
*proxy* for "did the component keep its tables", and the direct reading above
supersedes it. Nothing in this repo deletes session rows, and `convex/auth.ts`
sets no session lifetime — the only `expiresIn` in the file is `OTP_EXPIRY_SEC`
for the sign-in code — so Better Auth's defaults apply, and an untouched browser
older than seven days was already signed out before the deploy ran. That last
step is inference; the decisive reading, if it ever matters, is whether the
`session` table holds rows predating the deploy.

**What the probe does not cover.** It carried a stub adapter — `createApi(schema, () => ({}))`
— rather than real auth options. It proves the **data** survives the move and says
nothing about the auth wiring working afterward. Verifying that is the acceptance
criteria below, not an assumption.

## Architecture

`components.betterAuth` stays spelled exactly the same, because the mount name does
not change. That is what keeps the blast radius small: `auth.ts:229`, `fixtures.ts:87`
and `:96`, and all of `http.ts` are untouched.

| File | Change |
| --- | --- |
| `v2/convex/betterAuth/convex.config.ts` | **new** — `defineComponent("betterAuth")` |
| `v2/convex/betterAuth/schema.ts` | **new** — prebuilt tables + `passkey` |
| `v2/convex/betterAuth/adapter.ts` | **new** — `createApi(schema, createAuthOptions)` |
| `v2/convex/convex.config.ts:2` | import `./betterAuth/convex.config` instead of the package |
| `v2/convex/auth.ts` | split `createAuthOptions()` out of `createAuth()` |

### The `createAuthOptions` split is required, not tidiness

Code in the component directory needs the Better Auth options, but calling
`createAuth()` there throws: the component directory has no environment access, and
`auth.ts:19` fails fast on a missing `SITE_URL` at module scope. The split is
`createAuthOptions(ctx)` returning the options object, with `createAuth(ctx)` staying
as `betterAuth(createAuthOptions(ctx))`.

**Measured 2026-09-13: component code does not receive deployment environment
variables, and the app's code does.** With `SITE_URL` unset on the deployment, the push
fails analyzing `auth.js`. With `SITE_URL` set, `auth.js` analyzes fine and the push
still fails — now analyzing `adapter.js`, with the same
`SITE_URL is not set on this deployment` thrown from `auth.ts`. The component imports
`createAuthOptions` from `../auth`, so every module-scope side effect in `auth.ts`
runs inside the component too, where the environment is empty.

This is not avoidable by moving the read into the function, because `createApi` calls
`createAuthOptions({} as any)` at component module-init time
(`src/client/create-api.ts:65`). **`createAuthOptions` must tolerate a missing
`SITE_URL`; `createAuth` must assert it.** The fail-fast that `auth.ts:19` provides
today is preserved, just relocated from module load to `createAuth` — which every real
request goes through, and which the component never calls.

It is also load-bearing for passkeys later, for a reason that is easy to miss.
`createApi` builds the adapter from **both** the Convex schema and
`getAuthTables(createAuthOptions(...))` (`src/client/create-api.ts:61-65`). A table has
to appear in **two** places to be *used*: the component schema, and the auth options via
the plugin that declares it. **Adding `passkey` to the schema alone leaves it unused** —
which is exactly why this migration can ship the table with no behaviour change.

**Measured 2026-09-13, correcting an earlier draft of this paragraph that said
"inert".** Unused is not unreachable, and the distinction matters because the
stronger claim is false. The adapter's argument validators are built from the
Convex schema alone, so `adapter.create({ model: 'passkey', … })` would validate
and insert through the raw adapter API; `betterAuthSchema` gates only
`checkUniqueFields`, `listOne` and `paginate`, never construction. What actually
keeps the table inert is that Better Auth only ever *calls* the models its own
options declare. The asymmetry is worth knowing too: options-only is a hard
`ArgumentValidationError`, schema-only is silent. And one corollary —
`isUniqueField` returns `false` for a model it cannot find rather than throwing
(`src/client/adapter-utils.ts:61-74`), so a schema-only table carries **no
uniqueness enforcement** until its plugin lands — and **measured 2026-09-13, not even
then**: `@better-auth/passkey@1.6.23` declares `credentialID` as `index: true` rather than
`unique: true`, so `isUniqueField` still answers false once the plugin is wired. See
`wordle-teams-047w`.

### The schema decision: extend, do not regenerate

**Import the prebuilt tables and add `passkey` as a pure addition.** Do not run
`npx auth generate` and take whatever comes out.

Regenerating against our actual options would produce a *smaller* schema than the
prebuilt one — dropping the `twoFactor` table and the `twoFactorEnabled`,
`isAnonymous`, `username`, `displayUsername`, `phoneNumber` and `phoneNumberVerified`
user fields, all of which exist upstream because upstream generates from a wider
plugin set than ours. Every one is a chance for an existing row to fail validation.

The measured consequence is milder than feared — phase 4 showed a lost field **blocks
the push** rather than corrupting anything — but a refused deploy is still a refused
deploy, and extending makes the case impossible. The component's own test fixture
takes this exact approach: `dist/component/testProfiles/schema.profile-plugin-table.js:3`
is `import { tables as baseTables } from "../schema.js"`.

The `jwks` and `oauth*` tables stay needed regardless: `convex()` bundles bearer, jwt
**and** oidc-provider internally (`dist/plugins/convex/index.js:2-4`).

## Ordering

**Land this on beta, well before cutover.** Three reasons, in order of weight:

1. The swap is data-preserving and behaviour-neutral, so there is nothing to time.
2. If it somehow is not, beta users are testers and beta state is discarded at the
   flip by design (wt-ksh.9). The blast radius is at its smallest now and never gets
   smaller.
3. Passkeys want to be in the launch, and they cannot start until this lands.

What it must **not** do is land adjacent to the cutover runbook. That runbook is long,
hand-checked and unforgiving, and an auth-component change in the same window would
contaminate every judgement in it.

### Blast radius if the probe is somehow wrong on beta

Smaller than it first appears, and worth writing down so nobody panics. `players` keys
on `email` (`v2/convex/schema.ts:42`), not on a Better Auth user id, and auth resolves
through `getAuthUser → playerForEmail`. Orphaned component tables would mean everyone
is signed out, signs in again by OTP or social, and gets a fresh user row against the
same verified email that re-attaches to their existing player. Teams, scores and
history are keyed by email and survive. It is an annoyance event, not a data-loss
event.

## Explicitly out of scope

- **The passkey plugin, client plugin and any UI.** wordle-teams-wty4.1.7.
- **Any move to Better Auth 1.7.x.** Blocked upstream; see `get-convex/better-auth#433`
  and wordle-teams-368m.
- **The unbounded growth of the component tables.** wordle-teams-31a is unchanged by
  this, and Local Install does not fix it. It does make it *reachable* — the tables
  become ours to write cleanup against — but that is a follow-up, not this.
- **Any change to sign-in behaviour, providers, session lifetime or account linking.**

## Alternatives ruled out

**Fork or patch the prebuilt component to add the table.** Rejected: it is the same
ownership burden as Local Install with none of the support, and it breaks on every
upstream release.

**Wait for upstream to add passkey to the prebuilt component.** Rejected as a plan,
kept as a watch (wordle-teams-368m). Upstream generates that schema from a fixed plugin
set and has given no signal it intends to widen it; blocking a launch feature on an
unsignalled upstream change is not a plan.

**Implement WebAuthn outside Better Auth.** Rejected: it means owning credential
storage, challenge handling and verification next to an auth system that already wants
to own all three.

## Acceptance criteria

1. `v2/convex/betterAuth/` contains `convex.config.ts` (`defineComponent("betterAuth")`),
   `schema.ts` (prebuilt tables **plus** `passkey`), and `adapter.ts`
   (`createApi(schema, createAuthOptions)`).
2. `v2/convex/convex.config.ts` mounts the local definition. **No call site changes**:
   `components.betterAuth` still resolves, and `auth.ts:229`, `fixtures.ts:87`/`:96`
   and `http.ts` are untouched.
3. `auth.ts` exports `createAuthOptions(ctx)`; `createAuth(ctx)` is
   `betterAuth(createAuthOptions(ctx))`. Options are unchanged in content.
4. **All four quality gates pass** — `test`, `typecheck`, `lint`, `build`. Not just the
   one that looks relevant.
5. **The e2e auth specs pass, run explicitly.** e2e sits outside the quality gates on
   this project, so a green gate run is not evidence here. Confirm Playwright is not
   attached to a stale dev server before believing the result.
6. On beta, after deploy: **sessions that existed before the deploy still work** — no
   forced sign-out — and sign-in succeeds by email OTP and by all four social
   providers — Google, Microsoft, GitHub and Discord.
7. The `passkey` table exists and is **empty**, and no passkey plugin appears in
   `createAuthOptions`.
8. `better-auth` is still on the 1.6 line.

## Testing

The existing suite is the regression net and it already exercises the component:
`fixtures.ts` writes `user` and `session` rows through `components.betterAuth.adapter.create`,
so every test that authenticates a caller is a test of this migration. If the adapter
wiring is wrong, `convex-test` fails broadly rather than subtly.

No new unit tests are called for — there is no new behaviour to assert, and a test that
merely restates the schema would pass whether or not the deployment works. The real
verification is criteria 5 and 6, which are deployment facts, not test facts.
