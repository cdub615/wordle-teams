# Better Auth Local Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Better Auth Convex component out of `node_modules` and into `v2/convex/betterAuth/` so we own its schema, and add the `passkey` table — with no change to sign-in behaviour.

**Architecture:** The component keeps its mount name `"betterAuth"`, so `components.betterAuth` and every call site stay identical and the existing component tables are preserved in place (measured — see the spec). `createAuthOptions(ctx)` is split out of `createAuth(ctx)` so the component can import the options for schema shape; because component code receives **no deployment environment variables**, `createAuthOptions` must tolerate a missing `SITE_URL` and `createAuth` takes over the fail-fast.

**Tech Stack:** Convex 1.42.2 components, Better Auth 1.6.23 (`better-auth/minimal`), `@convex-dev/better-auth` 0.12.5, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-better-auth-local-install-design.md`
**Issue:** `wordle-teams-hrqw` — blocks `wordle-teams-wty4.1.7`

---

## Working directory

Every command below runs from `v2/`, not the repo root:

```bash
cd /home/cdub/projects/wordle-teams/v2
```

`cd` is aliased to zoxide on this machine and can short-circuit `&&`, so run the `cd` as its own command rather than chaining it.

## File Structure

| File | Responsibility |
| --- | --- |
| `v2/convex/auth.ts` | **modify** — split `createAuthOptions` out of `createAuth`; move the `SITE_URL` fail-fast off module scope |
| `v2/convex/auth.test.ts` | **modify** — pin the new empty-environment behaviour |
| `v2/convex/betterAuth/convex.config.ts` | **create** — `defineComponent("betterAuth")` |
| `v2/convex/betterAuth/generatedSchema.ts` | **create** — verbatim copy of the upstream generated schema; the thing to regenerate, never hand-edit |
| `v2/convex/betterAuth/schema.ts` | **create** — spreads `generatedSchema`'s tables and adds ours |
| `v2/convex/betterAuth/adapter.ts` | **create** — `createApi(schema, createAuthOptions)` |
| `v2/convex/convex.config.ts` | **modify** — mount the local definition |
| `v2/vitest.config.ts` | **modify** — one stale comment |

Splitting `generatedSchema.ts` from `schema.ts` is deliberate: it keeps "upstream's file, replaceable wholesale" separate from "our additions", so a future regeneration is a single file overwrite with a reviewable diff.

---

### Task 1: Split `createAuthOptions` out of `createAuth`

App-only change. The component does not exist yet, nothing is mounted differently, and this must be a no-op for every caller.

**Files:**
- Modify: `v2/convex/auth.ts:18-19`, `v2/convex/auth.ts:227`, `v2/convex/auth.ts:231-334`
- Modify: `v2/vitest.config.ts:22-26` (comment only)
- Test: `v2/convex/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `v2/convex/auth.test.ts`. Add `vi` and `afterEach` to the existing import on line 1 so it reads
`import { afterEach, describe, expect, test, vi } from 'vitest'`, and add `createAuth, createAuthOptions` to the
import on line 2 so it reads `import { buildSocialProviders, createAuth, createAuthOptions } from './auth.ts'`.

```ts
/**
 * THE OPTIONS HAVE TO SURVIVE AN EMPTY ENVIRONMENT, because the COMPONENT
 * imports them.
 *
 * `convex/betterAuth/adapter.ts` calls `createApi(schema, createAuthOptions)`,
 * and `createApi` evaluates `createAuthOptions({} as any)` at component
 * module-init time to derive the Better Auth table shape
 * (`src/client/create-api.ts:65`). Component code gets NO deployment
 * environment variables — measured 2026-09-13: with SITE_URL set on the
 * deployment the app's own `auth.js` analyzes fine and the push still fails
 * analyzing `adapter.js`, throwing our own SITE_URL error.
 *
 * So the fail-fast moved from module scope to `createAuth`, which every real
 * request goes through and the component never calls. These tests are the only
 * thing standing between that arrangement and a deploy that cannot push.
 */
describe('createAuthOptions survives the empty environment the component imports it into', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('falls back to a placeholder baseURL when SITE_URL is unset', () => {
    vi.stubEnv('SITE_URL', undefined)

    expect(createAuthOptions({} as never).baseURL).toBe('https://schema-generation.invalid')
  })

  test('and wires NO social providers, so the component logs no false alarms', () => {
    // buildSocialProviders console.warn's per unconfigured provider. Called in
    // the component, where every credential is absent, it would claim all four
    // providers are unconfigured on every component init — misleading exactly
    // when someone is reading logs to find out why sign-in broke.
    vi.stubEnv('SITE_URL', undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(createAuthOptions({} as never).socialProviders).toEqual({})
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })

  test('uses the real baseURL, and real providers, when SITE_URL is set', () => {
    vi.stubEnv('SITE_URL', 'https://beta.wordleteams.com')

    const options = createAuthOptions({} as never)

    expect(options.baseURL).toBe('https://beta.wordleteams.com')
    expect(options.socialProviders).not.toEqual({})
  })

  test('createAuth still fails fast when SITE_URL is unset', () => {
    // The guard auth.ts:19 used to provide, relocated rather than dropped.
    vi.stubEnv('SITE_URL', undefined)

    expect(() => createAuth({} as never)).toThrow(/SITE_URL/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm exec vitest run convex/auth.test.ts
```

Expected: FAIL — `createAuthOptions` is not exported from `./auth.ts`.

- [ ] **Step 3: Remove the module-scope fail-fast**

In `v2/convex/auth.ts`, delete lines 18-19:

```ts
const siteUrl = process.env.SITE_URL
if (!siteUrl) throw new Error('SITE_URL is not set on this deployment')
```

and replace them with:

```ts
/**
 * WHY THE SITE_URL CHECK IS NOT AT MODULE SCOPE ANY MORE.
 *
 * `convex/betterAuth/adapter.ts` imports `createAuthOptions` from this file,
 * so every module-scope side effect here also runs inside the COMPONENT — and
 * component code receives no deployment environment variables. Measured
 * 2026-09-13: with SITE_URL set on the deployment, the app's `auth.js`
 * analyzes fine and the push still dies with
 * `Failed to analyze adapter.js: Uncaught Error: SITE_URL is not set`.
 *
 * Moving the read inside `createAuthOptions` is not enough on its own, because
 * `createApi` evaluates `createAuthOptions({} as any)` at component init
 * (`src/client/create-api.ts:65`). So the OPTIONS tolerate an absent SITE_URL
 * and `createAuth` carries the guard instead. Nothing is weakened: every real
 * request builds auth through `createAuth`, and the component never calls it.
 */
const SCHEMA_ONLY_BASE_URL = 'https://schema-generation.invalid'
```

- [ ] **Step 4: Move the social providers off module scope**

In `v2/convex/auth.ts`, delete line 227:

```ts
const socialProviders = buildSocialProviders()
```

It moves into `createAuthOptions` in the next step. Leave `buildSocialProviders` itself, and its doc comment, exactly as they are.

- [ ] **Step 5: Split the options out of `createAuth`**

Replace the `export const createAuth = (ctx: GenericCtx<DataModel>) =>` declaration at `v2/convex/auth.ts:231` with `createAuthOptions`, keeping **every** option, comment and plugin between there and the closing `})` byte-for-byte. Only the wrapper changes:

```ts
export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  // Absent only when the component imports these options for schema shape.
  const siteUrl = process.env.SITE_URL

  return {
    baseURL: siteUrl ?? SCHEMA_ONLY_BASE_URL,
    database: authComponent.adapter(ctx),

    // Skipped entirely without an environment: see the third test in
    // auth.test.ts. Providers contribute no tables, so the component's view of
    // the schema is identical either way.
    socialProviders: siteUrl ? buildSocialProviders() : {},

    // ... every remaining option UNCHANGED: onAPIError, account, plugins ...
  }
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  // The guard that used to sit at module scope.
  if (!process.env.SITE_URL) throw new Error('SITE_URL is not set on this deployment')

  return betterAuth(createAuthOptions(ctx))
}
```

Two things inside the options body need the local `siteUrl` and currently close over the deleted module-scope const — `baseURL` above, and `onAPIError: { errorURL: `${siteUrl}/login-error` }`. Both now read the local. No other line changes.

**Do not add a return type annotation** (no `satisfies BetterAuthOptions`, no `as BetterAuthOptions`). `authComponent.registerRoutes(http, createAuth)` and the client both depend on the inferred plugin types, and annotating widens them.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm exec vitest run convex/auth.test.ts
```

Expected: PASS, all four new tests plus the existing `buildSocialProviders` suite.

- [ ] **Step 7: Fix the now-stale comment in vitest.config.ts**

`v2/vitest.config.ts:22-25` says auth.ts "fails fast at module scope when SITE_URL is unset". It no longer does. Replace those four comment lines with:

```ts
    // Several modules read SITE_URL inside their functions (auth.ts's
    // createAuth, polar.ts, teams.ts) and reminders.test.ts overrides this
    // default to assert the unset case. The value is never dereferenced; it
    // only has to exist.
```

Leave `env: { SITE_URL: 'http://localhost:3000' }` in place.

- [ ] **Step 8: Run all four quality gates**

Run each separately and read each exit status. Do **not** pipe them into one command — `PIPESTATUS` is empty in zsh and a piped gate check can report a false green.

```bash
pnpm exec vitest run
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all four pass.

- [ ] **Step 9: Commit**

```bash
git add v2/convex/auth.ts v2/convex/auth.test.ts v2/vitest.config.ts
git commit -m "refactor(auth): split createAuthOptions out of createAuth"
```

---

### Task 2: Create the local component, schema unchanged

Still no behaviour change and still no `passkey` table. The only question this task answers is whether the swap itself is inert.

**Files:**
- Create: `v2/convex/betterAuth/convex.config.ts`
- Create: `v2/convex/betterAuth/generatedSchema.ts`
- Create: `v2/convex/betterAuth/schema.ts`
- Create: `v2/convex/betterAuth/adapter.ts`
- Modify: `v2/convex/convex.config.ts:2`

- [ ] **Step 1: Create the component definition**

`v2/convex/betterAuth/convex.config.ts`:

```ts
import { defineComponent } from 'convex/server'

/**
 * THE NAME IS LOAD-BEARING AND MUST STAY "betterAuth".
 *
 * Convex identifies a mounted component by its mount name, which `use()`
 * resolves as `options.name ?? definition.defaultName ?? basename(path)`
 * (convex/dist/esm/server/components/index.js:77-85). The prebuilt component
 * this replaces is also `defineComponent("betterAuth")`, which is the whole
 * reason the existing user, session and account rows survive the move and
 * `components.betterAuth` still resolves at every call site.
 *
 * Renaming it orphans every row in the component.
 */
const component = defineComponent('betterAuth')

export default component
```

- [ ] **Step 2: Copy the upstream generated schema verbatim**

```bash
cp node_modules/@convex-dev/better-auth/src/component/schema.ts convex/betterAuth/generatedSchema.ts
```

Then edit **only** the header comment of the new file, replacing the upstream
`npx auth generate --output src/component/schema.ts` line so it names this repo's path:

```ts
/**
 * Copied verbatim from @convex-dev/better-auth's generated component schema.
 * DO NOT HAND-EDIT — our additions live in ./schema.ts, which spreads this.
 * To refresh: re-copy from
 * node_modules/@convex-dev/better-auth/src/component/schema.ts and re-read the
 * diff, then check ./schema.ts still spreads everything it expects.
 */
```

Leave `export const tables` and the `defineSchema(tables)` default export untouched.

- [ ] **Step 3: Create our schema**

`v2/convex/betterAuth/schema.ts`:

```ts
import { defineSchema } from 'convex/server'
import { tables } from './generatedSchema'

/**
 * EXTENDS THE UPSTREAM TABLES, NEVER REGENERATES THEM.
 *
 * Running `npx auth generate` against this app's options would produce a
 * SMALLER schema than upstream's — upstream generates from a wider plugin set
 * (twoFactor, anonymous, username, phoneNumber, magicLink, genericOAuth ...,
 * see src/auth-options.ts), so regenerating would drop the `twoFactor` table
 * and the twoFactorEnabled / isAnonymous / username / displayUsername /
 * phoneNumber / phoneNumberVerified user fields. Measured 2026-09-13: a schema
 * that drops a field existing rows carry does not corrupt anything, it makes
 * the push FAIL — `SchemaDefinitionError` — which is a deploy that dies at the
 * worst possible moment for no benefit. Spreading cannot hit that case.
 */
const schema = defineSchema({
  ...tables,
})

export default schema
```

- [ ] **Step 4: Create the adapter**

`v2/convex/betterAuth/adapter.ts`:

```ts
import { createApi } from '@convex-dev/better-auth'
import schema from './schema'
import { createAuthOptions } from '../auth'

/**
 * A TABLE HAS TO EXIST IN BOTH PLACES TO BE USABLE.
 *
 * `createApi` builds the adapter from the Convex schema AND from
 * `getAuthTables(createAuthOptions(...))` (src/client/create-api.ts:61-65).
 * Adding a table to ./schema.ts alone is inert — which is exactly what lets
 * this migration ship the passkey table with no behaviour change, and exactly
 * what wordle-teams-wty4.1.7 has to do the other half of.
 */
export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } =
  createApi(schema, createAuthOptions)
```

- [ ] **Step 5: Mount the local definition**

In `v2/convex/convex.config.ts`, change line 2 from:

```ts
import betterAuth from '@convex-dev/better-auth/convex.config'
```

to:

```ts
// LOCAL INSTALL (wordle-teams-hrqw): the component is defined in this repo so
// we own its schema. Same mount name, so components.betterAuth and every
// existing row are unchanged.
import betterAuth from './betterAuth/convex.config'
```

`app.use(betterAuth)` on line 6 does not change. Neither does `app.use(resend)`.

- [ ] **Step 6: Run all four quality gates**

```bash
pnpm exec vitest run
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all four pass.

**CORRECTED 2026-09-13 — the gates do NOT cover the new adapter, and an earlier draft of this step claimed they did.** `convex/fixtures.ts` writes through `components.betterAuth.adapter.create`, but `betterAuthTest.register(t)` mounts the PACKAGE's component (`node_modules/@convex-dev/better-auth/src/test.ts` registers `./component/schema.js` and `import.meta.glob("./component/**/*.ts")`). Nothing imports `convex/betterAuth/adapter.ts`; delete it and all tests still pass. What actually covers this task is `tsc`, successful component codegen, and the deploy itself. Task 4 closes the gap.

Then confirm no call site moved — the acceptance criteria require `components.betterAuth` to still resolve everywhere untouched:

```bash
git diff --stat HEAD -- v2/convex/auth.ts v2/convex/fixtures.ts v2/convex/http.ts
```

Expected: **empty**. If any of those three appear, the mount name changed or the adapter shape drifted; stop and re-read Task 2 Step 1.

- [ ] **Step 7: Run the e2e suite explicitly**

e2e sits outside the quality gates on this project; a green gate run is not evidence here.

```bash
pnpm exec playwright test
```

Before believing a pass, confirm Playwright started its own dev server rather than attaching to a stale one already holding port 3000. If something else holds :3000, kill it and re-run.

Expected: PASS, in particular the sign-in specs.

- [ ] **Step 8: Commit**

```bash
git add v2/convex/betterAuth v2/convex/convex.config.ts
git commit -m "refactor(auth): define the Better Auth component locally"
```

---

### Task 3: Prove the swap is inert on beta

No code. This is the acceptance gate the probe could not cover — it ran with a stub adapter, so it proved the data survives and said nothing about auth working afterward.

**Files:** none.

- [ ] **Step 1: Push and identify the deploy run by SHA**

```bash
git push
git rev-parse HEAD
```

`.github/workflows/deploy-v2.yml` deploys `feat/v2-replatform` to beta on any push touching `v2/`. Find the run for **this** SHA — `--limit 1` returns the previous run if the new one has not registered yet:

```bash
gh run list --workflow=deploy-v2.yml --json databaseId,headSha,status --jq '.[] | select(.headSha=="<SHA from above>")'
gh run watch <databaseId>
```

Expected: the workflow completes green. A failure here is most likely the component push; read the `convex deploy` step's log rather than guessing.

- [ ] **Step 2: Confirm existing sessions survived**

In a browser already signed in to `https://beta.wordleteams.com` from **before** this deploy, reload.

Expected: still signed in, no redirect to `/login`. A forced sign-out means the component did not keep its tables and everything after this stops — revert the mount to `@convex-dev/better-auth/convex.config`, redeploy, and reopen `wordle-teams-hrqw` with what you saw.

- [ ] **Step 3: Confirm every sign-in method still works**

In a private window, sign in once per method:

- [ ] email OTP — code arrives and is accepted
- [ ] Google
- [ ] Microsoft
- [ ] GitHub
- [ ] Discord

Expected: all five reach the signed-in app. A provider that fails at its callback is an OAuth config problem, not this change — but confirm that before dismissing it.

- [ ] **Step 4: Record the result on the issue**

```bash
bd update wordle-teams-hrqw --append-notes "$(cat <<'NOTE'
BETA VERIFIED <date>. Deploy <SHA> is green. A session predating the deploy survived it, and all five sign-in methods (OTP, Google, Microsoft, GitHub, Discord) reach the signed-in app. The swap is inert; the passkey table can go in.
NOTE
)"
```

Use a quoted heredoc rather than an inline `-m "..."`: a backtick inside a double-quoted shell string is executed and the word disappears.

- [ ] **Step 5: Commit the issue update**

```bash
git add .beads
git commit -m "chore(beads): record beta verification of the local install"
```

The bd hook re-exports and re-stages `.beads/issues.jsonl` during the commit, so the first attempt can abort with nothing staged. Just run the same two commands again — never `--no-verify`.

---

### Task 4: Add the `passkey` table

**Files:**
- Modify: `v2/convex/betterAuth/schema.ts`

- [ ] **Step 1: Add the table**

In `v2/convex/betterAuth/schema.ts`, add the `v` import and the table. The file becomes:

```ts
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { tables } from './generatedSchema'

/**
 * EXTENDS THE UPSTREAM TABLES, NEVER REGENERATES THEM.
 *
 * Running `npx auth generate` against this app's options would produce a
 * SMALLER schema than upstream's — upstream generates from a wider plugin set
 * (twoFactor, anonymous, username, phoneNumber, magicLink, genericOAuth ...,
 * see src/auth-options.ts), so regenerating would drop the `twoFactor` table
 * and the twoFactorEnabled / isAnonymous / username / displayUsername /
 * phoneNumber / phoneNumberVerified user fields. Measured 2026-09-13: a schema
 * that drops a field existing rows carry does not corrupt anything, it makes
 * the push FAIL — `SchemaDefinitionError` — which is a deploy that dies at the
 * worst possible moment for no benefit. Spreading cannot hit that case.
 */
const schema = defineSchema({
  ...tables,

  /**
   * THE WHOLE REASON THIS COMPONENT IS LOCAL (wordle-teams-hrqw).
   *
   * The prebuilt component's schema is fixed at ten tables and has nowhere to
   * put this one. Fields mirror @better-auth/passkey's `Passkey` type;
   * `createdAt` is a number here because the Convex adapter stores dates that
   * way, as every other table in generatedSchema.ts does.
   *
   * UNUSED UNTIL wordle-teams-wty4.1.7 — WHICH IS NOT THE SAME AS UNREACHABLE,
   * and the difference was measured rather than assumed. The adapter's arg
   * validators are built from THIS schema, so `adapter.create({ model:
   * 'passkey', ... })` would validate and insert. What makes the table inert in
   * practice is that Better Auth only ever CALLS the models its own options
   * declare (`getAuthTables`, src/client/create-api.ts:65), and nothing in the
   * auth flow names passkey until the plugin lands.
   *
   * ONE CONSEQUENCE WORTH KNOWING: `checkUniqueFields` consults the OPTIONS
   * schema, and `isUniqueField` returns false for a model it cannot find rather
   * than throwing (src/client/adapter-utils.ts:61-74). So this table has NO
   * uniqueness enforcement until wty4.1.7 adds the plugin — credentialID is not
   * protected by the adapter today.
   */
  passkey: defineTable({
    name: v.optional(v.union(v.null(), v.string())),
    publicKey: v.string(),
    userId: v.string(),
    credentialID: v.string(),
    counter: v.number(),
    deviceType: v.string(),
    backedUp: v.boolean(),
    transports: v.optional(v.union(v.null(), v.string())),
    aaguid: v.optional(v.union(v.null(), v.string())),
    createdAt: v.number(),
  })
    .index('userId', ['userId'])
    .index('credentialID', ['credentialID']),
})

export default schema
```

- [ ] **Step 2: Run all four quality gates**

```bash
pnpm exec vitest run
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all four pass. Adding a table changes nothing any test asserts.

- [ ] **Step 3: Commit and deploy**

```bash
git add v2/convex/betterAuth/schema.ts
git commit -m "feat(auth): add the passkey table to the local component schema"
git push
git rev-parse HEAD
```

Watch the run for that SHA as in Task 3 Step 1.

Expected: green. A pure table addition cannot fail schema validation against existing rows — measured 2026-09-13.

- [ ] **Step 4: Confirm the table exists and is empty**

In the Convex dashboard for the beta deployment, open the `betterAuth` component's tables.

Expected: `passkey` is present with **zero** rows, and `user`, `session` and `account` still hold their pre-migration rows.

---

### Task 5: Close out

**Files:** `.beads/issues.jsonl`

- [ ] **Step 1: Confirm nothing drifted onto the 1.7 line**

```bash
node -e "console.log(require('./node_modules/better-auth/package.json').version)"
```

Expected: a `1.6.x` version. Better Auth 1.7 removed `better-auth/plugins/oidc-provider`, which `convex()` still imports, so 1.7.x cannot bundle this component at all (`get-convex/better-auth#433`). Nothing in this plan changes a version, so a 1.7 here means something else did.

- [ ] **Step 2: Close the issue and unblock passkeys**

```bash
bd close wordle-teams-hrqw
bd ready
```

Expected: `wordle-teams-wty4.1.7` now appears in `bd ready`, its only blocker gone.

- [ ] **Step 3: Leave the next session what it needs**

```bash
bd update wordle-teams-wty4.1.7 --append-notes "$(cat <<'NOTE'
UNBLOCKED <date>. The component is a local install and the passkey table exists and is empty. What remains for passkeys is the other half of the pair: add passkey() to createAuthOptions in convex/auth.ts (pin @better-auth/passkey to the INSTALLED better-auth version — 1.6.23 today — because its better-call peer is an exact pin that moves with the minor), add the client plugin in lib/auth-client.ts, and build the UI. Set rpID to the apex 'wordleteams.com' and pass origin as both beta and apex; do NOT let it default to the hostname.
NOTE
)"
```

- [ ] **Step 4: Commit and push**

```bash
git add .beads
git commit -m "chore(beads): close the local install issue, unblock passkeys"
git push
git status -sb
```

Expected: `git status -sb` shows the branch up to date with origin. Run the commit twice if the first aborts — the bd hook re-stages during it.
