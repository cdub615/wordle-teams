# Passkey sign-in

**Date:** 2026-09-13
**Issue:** wordle-teams-wty4.1.7 (P2) · epic wordle-teams-wty4.1 · unblocked by wordle-teams-hrqw
**Status:** design approved, plan pending

## What we are building and why

A signed-in player can register a passkey, sign in with it on a later visit, see it
and remove it — with every existing sign-in method untouched.

The email-OTP path is the slowest login in the app: leave, wait for mail, come back,
paste a code. Every returning player from the launch email who is not on a social
provider walks it, on a phone, once, and that is the moment they decide whether to
bother. A passkey turns it into a biometric prompt.

### What is already done

The hard part shipped as `wordle-teams-hrqw`. The Better Auth Convex component is a
Local Install at `v2/convex/betterAuth/`, its schema is ours, and the `passkey` table
already exists there and is empty. `convex/betterAuthSchema.test.ts` pins that the
table reaches the adapter the app actually calls.

## Decisions taken, and what was ruled out

**Offer after ANY sign-in, plus Settings** (owner, 2026-09-13). Not OTP-only: a passkey
still beats an OAuth redirect round-trip, and restricting the offer to the slowest path
would leave most of the audience without one. Ruled out: Settings-only (the issue's own
framing is that an offer nobody sees produces no passkeys) and a fourth `NextStepCard`
task (that card is a first-run checklist; a returning-user convenience does not belong
in it).

**Coverage is a virtual-authenticator e2e spec AND a gate-visible config assertion**
(owner, 2026-09-13). Both, deliberately. See *Testing*.

**`wordle-teams-31a` is a follow-up, not part of this.** The Local Install newly makes
the component tables reachable — that issue says the prune "structurally cannot reach"
them, which was true only while the component lived in `node_modules`. Passkeys add a
third accumulating table. Worth doing, worth doing separately: folding cleanup into a
feature makes both harder to judge.

## Two corrections to earlier assumptions

**v2 has no preview deployments.** `wty4.1.7` and the Local Install spec both carry a
caveat that `*.vercel.app` previews can never host a passkey because `vercel.app` is a
public-suffix entry. That was inherited from v1's hosting. v2 deploys to a single
Cloudflare Worker bound to `beta.wordleteams.com` as a `custom_domain`, only on push —
there is no preview URL to guard against, and a whole class of "hide the offer where it
cannot work" handling disappears with it.

**The `credentialID` uniqueness gap does NOT close itself — this paragraph said the
opposite and was wrong.** `hrqw` recorded that the passkey table has no adapter-level
uniqueness enforcement because `checkUniqueFields` consults the options schema, and this
spec originally concluded that adding `passkey()` to `createAuthOptions` would therefore
start enforcing it. **Measured 2026-09-13, it does not.** `@better-auth/passkey@1.6.23`
declares `credentialID` as `index: true`, not `unique: true`, and `isUniqueField` filters
on `value.unique`:

```
getAuthTables({ plugins: [emailOTP(…), passkey()] })
  passkey.credentialID          = { type: 'string', required: true, index: true }
  unique fields on passkey      = []
  CONTROL — user.email unique   = true
```

The control is what makes it decisive: the same probe returns `true` for a field that
genuinely is unique, so this is not a broken harness. The model moved from *not found,
answer false* to *found, answer false* — the reason changed, the outcome did not. No
other layer closes it either: registration calls `adapter.create` with no prior lookup on
the field, and authentication resolves a credential with a plain `findOne`, so duplicates
would resolve to whichever row came back first. A Convex index does not constrain.

Tracked as `wordle-teams-047w`. Probably unreachable in a normal flow — an authenticator
mints a fresh credential id per registration — and filed at P1 anyway **because the plan
believed the opposite**, which is the more dangerous half. Nothing in this design depends
on the enforcement: no task asserts it, and the sign-in path is unaffected.

## Relying party, which is the one unrecoverable setting

An rpID is chosen **once, per credential, at registration**. Get it wrong and those
credentials are orphaned — there is no migration.

Derive it from `SITE_URL` rather than hardcoding:

| Environment | Origin | `rpID` |
| --- | --- | --- |
| local dev | `http://localhost:3000` | `localhost` |
| beta | `https://beta.wordleteams.com` | `wordleteams.com` |
| production, post-cutover | `https://wordleteams.com` | `wordleteams.com` |

`origin` takes the array form so beta and the apex are both trusted at once.

**Why the apex, from beta.** WebAuthn permits an rpID that is the origin's effective
domain *or any registrable-domain suffix of it*, and a credential scoped to the apex
works on the apex and every subdomain. So a passkey registered on beta survives the DNS
flip (`docs/runbooks/2026-cutover.md:289`, `wt-ksh.9`). Left at the default — the full
hostname — every beta-registered credential would be orphaned by the cutover. That is
the failure this table exists to prevent, and it is silent.

## Architecture

| File | Change |
| --- | --- |
| `v2/package.json` | **add** `@better-auth/passkey` pinned exactly |
| `v2/convex/auth.ts` | `passkey({ rpID, rpName, origin })` in `createAuthOptions` |
| `v2/src/lib/auth-client.ts` | `passkeyClient()` alongside `convexClient()` and `emailOTPClient()` |
| `v2/src/lib/passkey.ts` | **new** — support detection, the per-device markers, the rpID derivation |
| `v2/src/routes/login.tsx` | a Passkey sign-in button, and `rememberLoginAttempt('passkey')` |
| `v2/src/routes/app.tsx` | `'passkey'` added to the arrival guard; the offer |
| `v2/src/components/settings/` | a Security tab: list, add, remove |

**Pin the package to the installed Better Auth version — `@better-auth/passkey@1.6.23`
— not a caret range.** Its `better-call` peer is an exact pin that moves with the minor
(1.3.5 at 1.6.11, 1.3.7 at 1.6.23, 1.4.0 at 1.6.30), so letting one drift without the
other is a silent mismatch. Import paths are `@better-auth/passkey` and
`@better-auth/passkey/client`; both are in that version's exports map, so neither needs
the `better-auth/plugins` barrel that `auth.ts:2-3` refuses.

**Stay on the 1.6 line.** Better Auth 1.7 removed `better-auth/plugins/oidc-provider`,
which `convex()` still imports, so 1.7.x cannot bundle the component at all
(`get-convex/better-auth#433`, open; watch is `wordle-teams-368m`).

### The offer hangs on the signal `ilej` already built

`/app`'s arrival effect and `complete-profile`'s success path are already the confirmed
"they made it" moment. They are already proven idempotent, already pinned by ordering
assertions, and already the place a second sign-in-completion notion would conflict
with. Reuse them. Do not invent a second one.

### Suppression is per-device, and that is not a shortcut

Offer unless this device has already registered a passkey or declined the offer. Both
markers live in `localStorage`, the same discipline `src/lib/last-login.ts` uses, every
access wrapped — it throws in Safari private mode and where site data is blocked, and a
post-login screen must not fail to render over a dismissal flag.

**A server-side "this user has passkeys" flag would be wrong**, not merely heavier. A
passkey is bound to one authenticator. Having one on a phone does nothing for a laptop,
so a per-account flag suppresses the offer on exactly the device that still needs one.

### The sign-in button is shown only where it can succeed

Render it when WebAuthn is available **and** this device has registered a passkey.
Without the second condition it is a dead-end tap that opens a system sheet saying no
passkeys were found — worse than no button.

This feeds `wordle-teams-ilej` directly, as that issue's forward note records:
`rememberLoginAttempt('passkey')` at the new site, `'passkey'` added to `app.tsx`'s
`method !== 'oauth' && method !== 'otp'` guard (line 320 as of 2026-09-13 — `ilej`
moved it from 308, so find it by the condition, not the number) or the indicator silently never records
it, and its two `toHaveLength(2)` tripwires become 3 — **updated, not relaxed to
`toBeGreaterThan`**, which is what would make the next method silently unbadged.

### Settings

A **Security** tab listing each passkey with add and remove. That makes four tabs, and
this project has already had a settings-dialog width problem on mobile — `/team` needed
a 768px cap (`c5718ef8`). Measure the four-tab row at small widths rather than assuming.

Removing every passkey cannot lock anyone out: OTP and social are untouched, which is
this issue's hard constraint. No confirmation gate is needed for that reason, and adding
one would imply a risk that does not exist.

## Testing

**A Playwright spec driving a CDP virtual authenticator** through register → sign in →
remove. This is the only way WebAuthn can be exercised at all; convex-test cannot reach
it.

**AND a source-level assertion inside the four gates** pinning the rpID derivation and
the origin list. Both, and the reason is specific: e2e sits outside the quality gates on
this project and a spec has stayed red for three tasks without anything failing. The
rpID is the one mistake that cannot be undone for credentials already issued, so it gets
a guard that runs on every commit regardless of the e2e suite's health.

The gated assertion must fail if the rpID is ever left at the default, or set to the
beta hostname rather than the apex. Prove it by making both changes and watching it go
red before trusting it.

## Explicitly out of scope

- **`wordle-teams-31a`**, the component-table prune, now reachable. Follow-up.
- **Any change to OTP or social sign-in.** Additive, never exclusive.
- **Conditional UI / passkey autofill** on the login form. A deliberate button first;
  autofill is a refinement with its own browser-support matrix.
- **Cross-device passkey sync visibility.** Whether a credential is synced is the
  platform's business, not ours to display.

## Acceptance criteria

1. A signed-in player is offered a passkey after any sign-in, once per device, and the
   offer does not reappear after registering or declining on that device.
2. The offer and the sign-in button are both absent where WebAuthn is unavailable.
3. A registered passkey signs the player in on a later visit, and `/login` shows the
   passkey button only on a device that has one.
4. Settings lists passkeys and can remove one; removing all of them leaves OTP and all
   four social providers working.
5. `rpID` resolves to `wordleteams.com` on beta and production and `localhost` in dev,
   pinned by an assertion that runs inside the four gates.
6. **All four gates pass** — `test`, `typecheck`, `lint`, `build` — each run separately.
7. The e2e suite passes, run explicitly, including the new virtual-authenticator spec.
8. `wordle-teams-ilej`'s indicator records `'passkey'`, and its two count tripwires are
   updated to 3 rather than relaxed.
9. `better-auth` is still on the 1.6 line and `@better-auth/passkey` is pinned to the
   same version.
