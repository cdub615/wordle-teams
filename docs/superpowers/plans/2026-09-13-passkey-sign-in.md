# Passkey Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in player can register a passkey, sign in with it later, see it and remove it — with email OTP and all four social providers untouched.

**Architecture:** Better Auth's first-party `@better-auth/passkey` plugin on the server (in `createAuthOptions`) and its client plugin in `auth-client.ts`. The `passkey` table already exists in the Local Install component. The relying-party id is *derived* from `SITE_URL` so beta and production both scope credentials to the apex, which is what lets a beta-registered passkey survive the DNS cutover.

**Tech Stack:** Better Auth 1.6.23 + `@better-auth/passkey@1.6.23`, Convex components, TanStack Router, vitest, Playwright (CDP virtual authenticator).

**Spec:** `docs/superpowers/specs/2026-09-13-passkey-sign-in-design.md`
**Issue:** `wordle-teams-wty4.1.7`

---

## Working directory

Every command runs from `v2/`:

```bash
cd /home/cdub/projects/wordle-teams/v2
```

`cd` is zoxide-aliased here and can short-circuit `&&` — run it as its own command, never chained.

## Gates, every task

Run all four **separately**, reading each exit status on its own. `PIPESTATUS` is empty in zsh, so piping them together reports false greens:

```bash
pnpm exec vitest run
pnpm typecheck
pnpm lint
pnpm build
```

Do **not** run Playwright or start a local Convex backend until Task 5 — that environment is broken on this workstation (Node 25, `wordle-teams-mtv9`). CI runs e2e on every push.

**Nothing under `convex/` may evaluate `import.meta` outside a `*.test.ts`.** `convex/pushableModules.test.ts` enforces it; violating it passes all four gates and kills the deploy (`wordle-teams-06pf`).

## File Structure

| File | Responsibility |
| --- | --- |
| `v2/convex/lib/relyingParty.ts` | **new** — pure `rpIdFor(siteUrl)` / `originsFor(siteUrl)`. The unrecoverable setting, isolated so it can be pinned. |
| `v2/convex/lib/relyingParty.test.ts` | **new** — the gate-visible guard. |
| `v2/convex/auth.ts` | `passkey()` in `createAuthOptions`. |
| `v2/src/lib/auth-client.ts` | `passkeyClient()`. |
| `v2/src/lib/passkey.ts` | **new** — support detection and the two per-device markers. |
| `v2/src/components/settings/security-tab.tsx` | **new** — list, add, remove. |
| `v2/src/components/settings/settings-dialog.tsx` | a fourth tab. |
| `v2/src/components/passkey-offer.tsx` | **new** — the post-sign-in offer. |
| `v2/src/routes/app.tsx` | `'passkey'` in the arrival guard; mount the offer. |
| `v2/src/routes/login.tsx` | the passkey sign-in button. |
| `v2/e2e/passkey.spec.ts` | **new** — virtual authenticator. |

---

### Task 1: Install the plugin and pin the relying party

Nothing user-visible. This task exists so the one unrecoverable setting is correct and guarded before any credential can be created.

**Files:**
- Create: `v2/convex/lib/relyingParty.ts`, `v2/convex/lib/relyingParty.test.ts`
- Modify: `v2/package.json`, `v2/convex/auth.ts`, `v2/src/lib/auth-client.ts`

- [ ] **Step 1: Write the failing test**

`v2/convex/lib/relyingParty.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { originsFor, rpIdFor } from './relyingParty.ts'

/**
 * THE ONE SETTING THAT CANNOT BE UNDONE.
 *
 * An rpID is chosen once, per credential, at registration. A credential scoped
 * to the wrong id is orphaned — there is no migration and no repair, and the
 * failure is silent until someone tries to sign in.
 *
 * THIS RUNS INSIDE THE FOUR GATES ON PURPOSE. The passkey flow itself can only
 * be exercised by a Playwright virtual authenticator, and e2e sits outside the
 * gates on this project — a spec here has stayed red for three tasks with
 * nothing failing. So the unrecoverable half gets a guard that runs on every
 * commit regardless of the e2e suite's health.
 */
describe('the relying-party id', () => {
  test('is the APEX on beta, not the beta hostname', () => {
    // THE WHOLE POINT. WebAuthn allows an rpID that is the origin's effective
    // domain OR any registrable-domain suffix of it, and a credential scoped to
    // the apex works on the apex and every subdomain. Left at the default — the
    // full hostname — every passkey registered on beta would be orphaned by the
    // DNS cutover (wt-ksh.9).
    expect(rpIdFor('https://beta.wordleteams.com')).toBe('wordleteams.com')
  })

  test('and is the same apex in production, so the flip changes nothing', () => {
    expect(rpIdFor('https://wordleteams.com')).toBe('wordleteams.com')
  })

  test('is localhost in development, which the spec special-cases', () => {
    expect(rpIdFor('http://localhost:3000')).toBe('localhost')
  })

  test('trusts beta AND the apex as origins, so one deployment serves both', () => {
    expect(originsFor('https://beta.wordleteams.com')).toEqual([
      'https://beta.wordleteams.com',
      'https://wordleteams.com',
    ])
  })

  test('and in development trusts only the dev origin', () => {
    expect(originsFor('http://localhost:3000')).toEqual(['http://localhost:3000'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run convex/lib/relyingParty.test.ts
```

Expected: FAIL — `relyingParty.ts` does not exist.

- [ ] **Step 3: Write the module**

`v2/convex/lib/relyingParty.ts`. Derive, never hardcode — a literal is how the hostname sneaks back in. Keep it pure and dependency-free so `convex/pushableModules.test.ts` has nothing to complain about. Export `rpIdFor(siteUrl: string): string` and `originsFor(siteUrl: string): string[]`, with a header comment carrying the reasoning from the test above.

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run convex/lib/relyingParty.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Install the plugin, pinned exactly**

```bash
pnpm add @better-auth/passkey@1.6.23
```

**The version must equal the installed `better-auth` version and must not be a caret range.** Its `better-call` peer is an exact pin that moves with the minor (1.3.5 at 1.6.11, 1.3.7 at 1.6.23, 1.4.0 at 1.6.30); drifting one without the other is a silent mismatch. Confirm `package.json` records `1.6.23`, not `^1.6.23`.

Do **not** upgrade `better-auth`. 1.7 removed `better-auth/plugins/oidc-provider`, which `convex()` still imports, so 1.7.x cannot bundle the component (`get-convex/better-auth#433`).

- [ ] **Step 6: Wire the server plugin**

In `v2/convex/auth.ts`, import `passkey` from `@better-auth/passkey` (a real exports-map entry — it does **not** need the `better-auth/plugins` barrel that lines 2-3 refuse) and `rpIdFor` / `originsFor` from `./lib/relyingParty.ts`. Add to the `plugins` array in `createAuthOptions`, beside `emailOTP` and `convex`:

```ts
passkey({
  rpID: rpIdFor(siteUrl),
  rpName: 'Wordle Teams',
  origin: originsFor(siteUrl),
}),
```

`siteUrl` is the local already in scope — the one carrying `SCHEMA_ONLY_BASE_URL` when the component imports these options. Confirm `rpIdFor` tolerates that placeholder without throwing; the component evaluates `createAuthOptions({})` at module-init and a throw there is an unpushable deployment (`hrqw`).

- [ ] **Step 7: Wire the client plugin**

In `v2/src/lib/auth-client.ts`, add `passkeyClient()` from `@better-auth/passkey/client` to the plugins array.

- [ ] **Step 8: Add the source guard against a hardcoded id**

Add to `v2/convex/lib/relyingParty.test.ts` an assertion that `convex/auth.ts` passes `rpIdFor(...)` to `passkey()` rather than a string literal. Use `src/test-support/source-ast.ts` — `objectLiteralReturnedBy` reaches `createAuthOptions`'s returned literal, and `codeOf` strips comments so the file's own prose about the apex cannot satisfy the match.

**Prove it fails:** replace the call with the literal `'beta.wordleteams.com'`, watch it go red, revert. Report the red output. An assertion nobody has seen fail is the failure mode this whole guard exists to prevent.

- [ ] **Step 9: Run all four gates**

- [ ] **Step 10: Commit**

```bash
git add v2/package.json v2/pnpm-lock.yaml v2/convex/lib/relyingParty.ts v2/convex/lib/relyingParty.test.ts v2/convex/auth.ts v2/src/lib/auth-client.ts
git commit -m "feat(auth): add the passkey plugin, with the relying party pinned to the apex"
```

---

### Task 2: Per-device markers, and the Settings Security tab

The first point at which a passkey can actually be created.

**Files:**
- Create: `v2/src/lib/passkey.ts`, `v2/src/lib/passkey.test.ts`
- Create: `v2/src/components/settings/security-tab.tsx`, `v2/src/components/settings/security-tab.hook.test.ts`
- Modify: `v2/src/components/settings/settings-dialog.tsx`

- [ ] **Step 1: Write the failing tests for the markers**

`v2/src/lib/passkey.test.ts`. Cover: `passkeySupported()` false when `window.PublicKeyCredential` is absent; the two markers round-trip; `shouldOfferPasskey()` is false after registering on this device, false after declining, true otherwise; and **a throwing storage is survived rather than propagated**.

Model the fakes on `v2/src/lib/last-login.test.ts` — it installs both storage fakes rather than touching ambient ones, because this jsdom's `window.localStorage` is a plain object with no `getItem`, and that measured detail is what stops a store-swap mutation passing by accident.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Write `src/lib/passkey.ts`**

Two keys (`wt.passkey.registered`, `wt.passkey.declined`), `passkeySupported()`, and `shouldOfferPasskey()`. **Every storage access wrapped** — it throws outright in Safari private mode and wherever site data is blocked, and a post-login screen must not fail to render over a dismissal flag.

Carry the reasoning for per-device in the header: a passkey is bound to one authenticator, so a per-account "has passkeys" flag would suppress the offer on exactly the device that still needs one.

- [ ] **Step 4: Run and watch them pass**

- [ ] **Step 5: Build the Security tab**

`security-tab.tsx`: list the player's passkeys, add one, remove one.

**Verify the client method names against the installed package rather than trusting this plan.** At 1.6.23 the server plugin registers `/passkey/generate-register-options`, `/passkey/verify-registration`, `/passkey/list-user-passkeys`, `/passkey/delete-passkey` and `/passkey/update-passkey`; the client exposes `addPasskey` among others. Read `node_modules/@better-auth/passkey/dist/client.d.mts` and use what is actually there.

On successful registration, set the registered marker from `src/lib/passkey.ts`.

**Removing the last passkey needs no confirmation gate.** OTP and all four social providers are untouched, so nothing can lock anyone out — and a confirmation would imply a risk that does not exist. Follow `notifications-tab.tsx` for the shape of an async settings control.

- [ ] **Step 6: Add the tab**

In `settings-dialog.tsx`, add `<TabsTrigger value="security">Security</TabsTrigger>` and its `<TabsContent>`. Place it after Notifications and before Install Guide.

**Then measure the four-tab row at small widths.** This project has already had a settings width problem — `/team` needed a 768px cap (`c5718ef8`). If the row overflows at 320px, say so in your report rather than shipping it; do not silently restyle the tab strip.

- [ ] **Step 7: Run all four gates**

- [ ] **Step 8: Commit**

```bash
git add v2/src/lib/passkey.ts v2/src/lib/passkey.test.ts v2/src/components/settings/
git commit -m "feat(settings): a Security tab for adding and removing passkeys"
```

---

### Task 3: Offer a passkey after any sign-in

**Files:**
- Create: `v2/src/components/passkey-offer.tsx`, `v2/src/components/passkey-offer.hook.test.ts`
- Modify: `v2/src/routes/app.tsx`

- [ ] **Step 1: Write the failing tests**

The offer renders only when `shouldOfferPasskey()` is true and WebAuthn is supported; declining sets the declined marker and it does not return; registering sets the registered marker.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Build the offer and mount it**

Mount it in `routes/app.tsx`. **Hang it on the signal that already exists** — the arrival effect at `app.tsx` (find it by its condition `method !== 'oauth' && method !== 'otp'`, not by line number; it has already moved once). That effect is already the confirmed "they made it" moment, already idempotent, already pinned by ordering assertions. Do not invent a second notion of "just signed in"; `src/lib/last-login.ts`'s header explains why two of those would be a problem.

- [ ] **Step 4: Run and watch them pass**

- [ ] **Step 5: Run all four gates**

- [ ] **Step 6: Commit**

```bash
git add v2/src/components/passkey-offer.tsx v2/src/components/passkey-offer.hook.test.ts v2/src/routes/app.tsx
git commit -m "feat(auth): offer a passkey after a completed sign-in, once per device"
```

---

### Task 4: Sign in with a passkey, and teach the indicator about it

**Files:**
- Modify: `v2/src/routes/login.tsx`, `v2/src/routes/app.tsx`, `v2/src/routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Three properties: the button is absent unless WebAuthn is supported **and** this device has registered one; `rememberLoginAttempt('passkey')` is recorded past the point of refusal, in the same shape the OTP site uses; and `'passkey'` is accepted by the arrival guard.

Note `routes.test.ts` uses `orderedIn` for ordering claims — and that `within` collapses duplicate callee texts, so prefer a unique anchor. The OTP site's own comment records that both `signIn.emailOtp` and `setError` were tried and rejected as anchors; read it before choosing one.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Add the button, the attempt write, and the guard entry**

The button renders only where WebAuthn exists and this device has a registered passkey — without the second condition it is a dead-end tap into a system sheet saying no passkeys were found.

In `app.tsx`, widen the arrival guard to accept `'passkey'`. **Without this the last-used indicator silently never records a passkey sign-in** — no error, just a badge that never moves.

- [ ] **Step 4: Update the two tripwires to 3**

`routes.test.ts` asserts `toHaveLength(2)` for `rememberLoginAttempt` sites and for badge sites. **Update them to 3. Do not relax them to `toBeGreaterThan`** — the count is deliberate, and relaxing it is what would let a future method ship silently unbadged.

- [ ] **Step 5: Run and watch them pass**

- [ ] **Step 6: Run all four gates**

- [ ] **Step 7: Commit**

```bash
git add v2/src/routes/login.tsx v2/src/routes/app.tsx v2/src/routes.test.ts
git commit -m "feat(login): sign in with a passkey, and record it as the last method used"
```

---

### Task 5: The virtual-authenticator e2e spec

**Files:** Create `v2/e2e/passkey.spec.ts`

- [ ] **Step 1: Write the spec**

Drive a CDP virtual authenticator through: sign in by OTP → register a passkey → sign out → sign in with the passkey → remove it in Settings.

Chromium only, via `context.newCDPSession(page)` and `WebAuthn.enable` / `WebAuthn.addVirtualAuthenticator`. Follow the existing helpers in `v2/e2e/` (`sign-in.ts`, `app-menu.ts`) rather than inventing new ones, and skip the spec on non-Chromium projects rather than failing them.

- [ ] **Step 2: Run it**

```bash
pnpm exec playwright test e2e/passkey.spec.ts
```

**This is the first step in the plan that needs a local Convex backend, and it is known broken on this workstation** — Node 25 against the local backend (`wordle-teams-mtv9`), which presents as a misleading `webServer` timeout. If you cannot get it running, say so plainly and let CI run it; do not spend hours on the environment. Before believing a pass, confirm Playwright started its own server rather than attaching to a stale one on port 3000.

- [ ] **Step 3: Commit**

```bash
git add v2/e2e/passkey.spec.ts
git commit -m "test(e2e): register and sign in with a passkey via a virtual authenticator"
```

---

### Task 6: Close out

- [ ] **Step 1: Confirm the versions did not drift**

```bash
node -e "console.log(require('./node_modules/better-auth/package.json').version)"
node -e "console.log(require('./node_modules/@better-auth/passkey/package.json').version)"
```

Expected: both `1.6.23`.

- [ ] **Step 2: Push and watch the deploy by SHA**

```bash
git push
git rev-parse HEAD
```

Find the run for **that** SHA — `--limit 1` returns the previous run if the new one has not registered yet:

```bash
gh run list --workflow=deploy-v2.yml --json databaseId,headSha --jq '.[] | select(.headSha=="<SHA>") | .databaseId'
gh run watch <id> --exit-status
```

- [ ] **Step 3: Verify on beta by hand**

Register a passkey, sign out, sign in with it, remove it. Confirm OTP and all four social providers still work.

- [ ] **Step 4: Close the issue**

```bash
bd close wordle-teams-wty4.1.7
git add .beads
git commit -m "chore(beads): close passkey sign-in"
```

Run the commit twice if the first aborts — the bd hook re-stages during it. The dirty `issues.jsonl` left afterwards is usually pure reorder churn; check before committing it again.
