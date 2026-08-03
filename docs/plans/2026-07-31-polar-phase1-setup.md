# Phase 1 — Polar dashboard setup (owner task)

Companion to `docs/superpowers/specs/2026-07-31-polar-migration-design.md`.

This is everything that has to happen in the Polar and Vercel dashboards before the code on
`feat/polar-migration` can be verified. It runs in parallel with Phase 2 (the code), and blocks
Phase 3 (dev verification).

**Nothing here touches production billing or the existing Lemon Squeezy subscription.** Do not
cancel the LS subscription, delete the LS webhook, or close the LS store — that is Phase 4 and
Phase 7.

---

## Do this first — it has lead time

Polar reviews organizations before enabling live payments. If that review takes days, it gates
Phase 6 (prod verification) even when everything else is finished.

- [ ] Create the **production** organization at <https://polar.sh> and submit it for review /
      complete account details as early as possible, before doing anything else below.

While that is pending, everything else can proceed — sandbox needs no review.

---

## Before you start

- [ ] Look up the current **Pro** prices in the Lemon Squeezy dashboard — both the monthly and
      the annual figure. The Polar products below must match them exactly. Note them down; the
      rest of this doc refers to "the monthly price" and "the annual price".

> **Two products per environment, not one.** Polar has no concept of variants: "each product has
> a single pricing model, and instead of bolting variants onto one product, you create one
> product per pricing model." Monthly and annual are therefore two separate products, and a
> product's billing cycle is locked at creation — it cannot be changed later, only replaced.
>
> This costs no application code. A Polar checkout session accepts several products at once and
> renders them side by side on the hosted page, so the customer picks the interval there rather
> than in the app.

---

## Part A — Sandbox (`sandbox.polar.sh`)

Polar's sandbox is a **completely separate instance** with its own login, organization, products,
and tokens. A production token will not work against it, and vice versa.

- [ ] Create an account and organization at <https://sandbox.polar.sh>

### A1. Pro products (two of them)

- [ ] Create **Pro Monthly** — recurring subscription, monthly interval, at the monthly price
- [ ] Copy its **product ID** (a UUID) → `POLAR_PRO_MONTHLY_PRODUCT_ID` for dev and local
- [ ] Create **Pro Annual** — recurring subscription, yearly interval, at the annual price
- [ ] Copy its **product ID** → `POLAR_PRO_ANNUAL_PRODUCT_ID` for dev and local

Names are yours to choose; only the IDs reach the code, so nothing breaks if you label them
differently. Both must exist before checkout works, because a single session offers both.

> There is deliberately **no "Free" product**. Under the new design, `free` is a database
> default for anyone without an active paid subscription — it is never driven by a webhook. If
> you create a Free product out of habit, the code will ignore it.
>
> The app also does not record *which* interval a subscriber chose. Nothing in the app branches
> on it — every gate is simply "are they pro" — and Polar's own dashboard and customer portal
> are the source of truth for billing details. This is the same reasoning that let the old
> `membership_variant` column be dropped.

### A2. Access token

- [ ] Settings → Developers → create an **Organization Access Token**
- [ ] Grant it permission to: **create checkout sessions**, **create customer sessions**, and
      **read customers and products**. Polar's docs do not publish exact scope label text, so
      select whatever the UI shows for those four resources — checkouts, customer sessions,
      customers, products.
- [ ] Copy the token → `POLAR_ACCESS_TOKEN` for dev and local. **It is shown once.**

### A3. Webhook endpoint

`dev.wordleteams.com` sits behind Vercel Deployment Protection, which redirects unauthenticated
requests to `vercel.com/sso-api`. Polar's webhooks would be silently blocked, so the URL needs
Vercel's automation bypass secret as a query parameter — a method Vercel documents specifically
for third-party webhooks that cannot set custom headers.

- [ ] In Vercel → the project → Settings → Deployment Protection → **Protection Bypass for
      Automation**, create (or copy the existing) secret
- [ ] In Polar sandbox → Settings → Webhooks → add endpoint:

```
https://dev.wordleteams.com/api/webhook?x-vercel-protection-bypass=<THE_BYPASS_SECRET>
```

- [ ] Format: **Raw** (not Discord or Slack)
- [ ] Subscribe to exactly these events:
  - `subscription.active`
  - `subscription.uncanceled`
  - `subscription.canceled`
  - `subscription.revoked`
  - `subscription.past_due`
- [ ] Copy the **signing secret** → `POLAR_WEBHOOK_SECRET` for dev

> ⚠️ That URL contains a secret and **this repository is public**. It lives in the Polar
> dashboard and in Vercel env vars only — never in a committed file.

---

## Part B — Production (`polar.sh`)

Same shape as Part A, in the organization you created at the top of this doc.

- [ ] **Pro Monthly** and **Pro Annual** — recurring subscriptions at the same prices and
      intervals as sandbox
- [ ] Copy both **product IDs** → `POLAR_PRO_MONTHLY_PRODUCT_ID` and
      `POLAR_PRO_ANNUAL_PRODUCT_ID` for production
- [ ] Organization Access Token with the same four permissions → `POLAR_ACCESS_TOKEN` for
      production
- [ ] Webhook endpoint → `https://wordleteams.com/api/webhook`
      (no bypass parameter — production is not behind Deployment Protection)
- [ ] Format: **Raw**, same five events as A3
- [ ] Copy the signing secret → `POLAR_WEBHOOK_SECRET` for production

---

## Part C — Vercel environment variables

Four variables, scoped by environment. `dev.wordleteams.com` deploys as a Preview, so sandbox
values go to Preview and production values go to Production.

| Variable | Production scope | Preview scope |
|---|---|---|
| `POLAR_ACCESS_TOKEN` | production token (B) | sandbox token (A2) |
| `POLAR_WEBHOOK_SECRET` | production secret (B) | sandbox secret (A3) |
| `POLAR_PRO_MONTHLY_PRODUCT_ID` | production monthly UUID (B) | sandbox monthly UUID (A1) |
| `POLAR_PRO_ANNUAL_PRODUCT_ID` | production annual UUID (B) | sandbox annual UUID (A1) |

- [ ] Add all eight values in Vercel → Settings → Environment Variables
- [ ] Add the sandbox values to your local `.env.local` too, so local dev works
      (`npm run pull-edge-config` pulls from Vercel if you prefer)

**Leave the three `LEMONSQUEEZY_*` variables in place for now.** They get removed in Phase 7,
after prod is verified.

---

## When you're done

Tell me and I'll pick up Phase 3. I don't need the secret values — only confirmation that:

- [ ] All four Pro products exist (monthly + annual, in sandbox and in production) and their
      prices match the current Lemon Squeezy ones
- [ ] All eight Vercel env vars are set
- [ ] Both webhook endpoints are registered with the five events, in Raw format
- [ ] The production org's payment review is submitted (and whether it has cleared yet)

If the production review is still pending, that's fine — it only blocks Phase 6, so Phases 3
through 5 can proceed without it.
