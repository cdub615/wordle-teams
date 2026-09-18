# The marketing pages and the upgrade dialog — design

**Date:** 2026-09-18
**Issues:** `wordle-teams-wty4.1.14` (the marketing pages) and `wordle-teams-iht.1` (the upgrade interstitial)
**Builds on:** `wordle-teams-kusd` / `docs/superpowers/specs/2026-09-17-pro-month-window-design.md`, closed 2026-09-18, which shipped `src/lib/pro-benefits.ts`
**Status:** approved by the owner 2026-09-18

---

## 1. Why these two issues share one spec

They are one defect seen from two sides: **the product has changed enormously and
the only descriptions of it have not.**

`components/home/feature-cards.tsx` sells Pro as "unlimited months, unlimited
teams, customizable scoring systems, and more". Since that copy was written the
app gained the Insights surface, team chat, screenshot import, push notifications
and — as of yesterday — the Pro month window. None of them appear on the landing
page. Meanwhile every upgrade affordance in the app calls straight through to
checkout: the player is asked to pay before anything tells them what they are
buying, and the one place Pro *is* described is a page a signed-in player never
sees, because `routes/index.tsx` redirects authenticated visitors to `/app`.

Two open funnel bugs make this launch-facing rather than cosmetic:
`wordle-teams-390` (about 7% of `/login` visitors complete auth) and
`wordle-teams-456` (87% of signups never enter a board). The launch email goes to
every existing player once, including people who bounced off v1, and it points at
these pages.

## 2. What already exists, and must not be duplicated

`wordle-teams-kusd` landed `src/lib/pro-benefits.ts` the day before this spec, and
its header names this work's two issues as its only intended consumers: *"They
describe one tier and must not describe it twice."* This spec therefore adds no
second inventory.

`PRO_BENEFITS` is five entries — `teams`, `scoring`, `import`, `insights`,
`months` — each with a title, a one-sentence body, the path to the file that gates
it, and whether a server path refuses a free caller. `pro-benefits.test.ts` pins
the set, asserts every `gatedAt` path exists on disk, and pins that the file
quotes no price in any shape.

Two of its recorded decisions constrain every surface below:

- **Layer 4 (global comparison) is deliberately absent.** It is Pro-gated and
  server-enforced but has no UI consumer in `src/`. Nothing here sells it.
- **Chat and push notifications are deliberately absent.** Neither is gated. They
  are part of the *free* product and belong in the story the landing page tells
  about what the app does.

## 3. Decisions taken in the brainstorm

| Question | Decision |
| --- | --- |
| Who is the landing page for? | The cold visitor who has never heard of it. The "what's new" story belongs to the launch email, which keeps the page from going stale the week after launch. |
| Public pricing? | Yes, on its own `/pricing` page. |
| Landing shape | Narrative scroll: hero → product shot → how it works → the insights payoff → the rest → closing CTA. |
| Where prices come from | Typed constants, plus a drift check that can be run against Polar. |
| Staleness prevention | One typed source per concern, with tests that fail on drift. |
| Interstitial shape | A dialog over the current page, not a route. |
| Context-awareness | The headline varies by origin; the body is shared. |
| Skip-to-checkout | None. Every affordance opens the dialog. |
| `/about` | Keeps its URL and its job as the how-to walkthrough, refreshed. |
| Screenshots | Produced by a committed Playwright script, not captured by hand. |

## 4. The economics that set the copy rules

`wordle-teams-iht` records Polar's real schedule. The account is on **Starter:
5.0% + $0.50 per transaction**. That epic's break-even section was computed at the
old $1.99/$19.99 prices and has not been re-run since the owner set $4.99/$49.99 on
2026-09-11. Re-run here:

| | Gross/yr | Fees | Net/yr | Fee share |
| --- | --- | --- | --- | --- |
| Monthly $4.99 | $59.88 | 12 × $0.7495 = **$8.99** | $50.89 | 15.0% |
| Annual $49.99 | $49.99 | 1 × $3.00 = **$3.00** | $46.99 | 6.0% |

The fixed 50¢, charged twelve times, costs about $6 a year per subscriber, and the
fee share on monthly is two and a half times worse. The net column still favours
monthly only because the annual discount (16.5% — twelve months for the price of
ten) is larger than the fee saving, and **that gap survives only at full
retention**: annual nets more the moment a monthly subscriber lasts under **11.1
months** (`$46.99 ÷ $4.2405`). For a $5 consumer subscription that is the common
case, not the edge case. Annual also removes eleven further opportunities a year
for involuntary churn on an expired card.

**The copy rules that follow, and they are binding on every surface here:**

1. Annual is the number we lead with, everywhere. This matches `proProductIds()`,
   which returns annual first "so it presents first" and is pinned in
   `polar.test.ts`.
2. Monthly is present, never hidden, and never disparaged — it is a real choice
   for someone who will not commit a year.
3. **Monthly is never presented as the better value.** This is the part that
   changes: `src/lib/trial-copy.test.ts` currently records "monthly is worth MORE
   across a fully retained year ($59.88 vs $49.99)" with no mention of fees and no
   mention of the retention assumption that claim depends on. That comment is
   corrected as part of this work; leaving it would have the next person design
   against it.

For the record, and because it will look deliberate on a public page: the epic's
own table says a charge must exceed $5.00 for fees to fall under 15% of revenue,
and $4.99 sits one cent below that line — the same shape as the $1.99 finding.
Unlike that one the difference is immaterial (15.02% against 15.00%) and no price
change is proposed here. Prices are the owner's, set in the Polar dashboard.

## 5. The typed sources

### 5.1 `src/lib/pro-benefits.ts` — unchanged

Consumed, not modified. Every surface that describes what Pro includes renders
`PRO_BENEFITS`; none writes its own list.

### 5.2 `src/lib/plans.ts` — new, and price-only

A sibling of `billing-copy.ts` and `trial-copy.ts`, holding what `pro-benefits.ts`
is forbidden to hold:

- **`PLANS`** — annual first, then monthly, each with its price and interval.
- **`PLAN_COPY`** — the framing rules above as copy: which plan leads, the
  sentence that names the annual price, and the fine-print sentence for monthly.
- **`UPGRADE_HEADLINES`** — one line per origin, keyed by
  `'import' | 'insights' | 'teams' | 'months' | 'header' | 'trial-ended'`.

**This module knowingly departs from the "NO PRICE HERE" rule** stated in both
`trial-copy.ts` and `pro-benefits.ts`. That rule assumed no public pricing surface
existed; a pricing page with no prices is not one. The departure is confined to
this single module, argued in its own banner, and backstopped by the drift check
in §8. The rule stands unchanged everywhere else — in particular
`pro-benefits.test.ts`'s "quotes no price, in any of the shapes a price takes"
must stay green.

## 6. The public surfaces

### 6.1 `/` and `/home`

Both keep rendering one `Landing` component — `routes/home.tsx` records why both
paths exist and must keep existing (v1's sitemap advertised `/home` at priority
0.9 and inbound links carry it). Its structure becomes:

1. **Hero** — positioning line and the primary CTA.
2. **Product shot** — the dashboard, re-shot (§7).
3. **How it works** — three steps: make a team, enter your board, scores settle.
4. **The insights payoff** — a real shot beside a short description. This is the
   largest thing built in the last phase and today it is invisible to a visitor.
5. **The rest of the free product** — chat, notifications, and the remaining
   capabilities, rendered as a compact group rather than six equal cards.
6. **Closing CTA** — free to play, Pro **$49.99/year**, linking to `/pricing`.
   The monthly price does not appear on this page.

`feature-cards.tsx`'s six-card grid is replaced. Its `FEATURES` export exists
because v2 has no DOM under vitest and the copy is only assertable as data; the
replacement keeps that property (§8).

### 6.2 `/pricing` — new route

Free against Pro, built from `PRO_BENEFITS` plus `PLANS`. Annual is the presented
plan; monthly is a quieter secondary line, not a co-equal column. The page also
explains the 30-day trial of Layers 2 and 3, and what starts it — the first board
entered after `LAUNCH_AT`.

**Consequence requiring work, not merely awareness:** `crawler-metadata.test.ts`
asserts the sitemap "lists v1's seven URLs, in v1's order, and nothing else", which
was a deliberate v1-parity rule. Adding `/pricing` means amending
`src/routes/sitemap[.]xml.ts`, that assertion, and the route's canonical and
`og:url` metadata. `public/robots.txt` allows everything not explicitly
disallowed, so the new page is crawlable without change.

### 6.3 `/about`

Keeps its URL and its job as the walkthrough — board entry, installing to the home
screen, creating or joining a team. Copy refreshed against current behaviour, and
its four screenshots re-shot by the same script.

## 7. Screenshots

`scripts/build-marketing-shots.mjs`, in the generate-on-demand-and-commit family
of `build-splash-screens.mjs`, `fetch-fonts.mjs` and `build-insights-corpus.mjs`
— **not** part of `pnpm build`, and its output committed.

It reuses the e2e harness rather than inventing a fixture path: `convex/e2eSeed.ts`
(`seedInsightsFor`) to produce an account with real insights data, and
`e2e/sign-in.ts` to sign in, exactly as `billing.spec.ts` and
`team-insights.spec.ts` already do. It captures at fixed viewports in **both
themes**, served through `<picture>` with `prefers-color-scheme`, because a
light-mode screenshot on a dark page reads as exactly the opposite of "a quality
product".

Re-shooting after a UI change becomes one command. That is the same answer as the
typed copy sources: make the refresh a command rather than a chore.

## 8. Tests and gates

- **`plans.test.ts`** — annual is first; the copy contains no monthly-favouring
  language; every `UPGRADE_HEADLINES` key is one of the six origins and every
  origin has a line.
- **Surface coverage against the inventory** — a test asserting that `/pricing`
  and the dialog render *every* `PRO_BENEFITS` entry. Adding a sixth benefit then
  fails until both surfaces name it, which is the drift gate this work exists to
  install. `pro-benefits.test.ts`'s existing five-entry pin stays as it is.
- **`upgrade-dialog.hook.test.ts`** — jsdom (the established
  `*.hook.test.ts` pattern — 49 such files today, including
  `ui/dialog.hook.test.ts`): one case per origin
  headline, the CTA reaching checkout, Escape dismissing.
- **A single-importer source test** — `use-start-upgrade.ts` is imported by
  exactly one module. This is the idiom `routes.test.ts` already uses, and without
  it the next upgrade button added anywhere reintroduces the defect silently,
  which is how this one arrived.
- **Copy-as-data assertions** for the new landing sections, extending
  `feature-cards.test.ts`'s pattern.
- **`crawler-metadata.test.ts`** amended for `/pricing`.
- **A credentialed drift script** comparing `PLANS` against Polar's products. It
  cannot be a CI gate: CI holds no Polar credentials. See §10.

## 9. The upgrade dialog

`useStartUpgrade` keeps its behaviour entirely — create the checkout, navigate,
route failures through `billing-copy.ts`'s `checkoutOutcome`. What changes is who
may call it.

- **An `UpgradeDialog` provider at `__root`** exposes `openUpgrade(origin)`. The
  six affordances — `Header`, `team-picker` and `month-picker` (via
  `routes/app.tsx`), `board-entry/import-upsell`, `trial-ended-card`,
  `insights/team-locked-card` and `routes/insights.tsx` — stop calling
  `startUpgrade()` and call that instead, passing their origin.
- **The dialog's CTA is the only remaining caller of `useStartUpgrade`**, which
  keeps the checkout path single — the property that hook's banner says it exists
  to protect — and is enforced by the source test in §8.
- **What it renders:** the origin headline, the shared `PRO_BENEFITS` list, the
  annual price with "or $4.99/month" as fine print, one CTA, and dismissal by
  Escape, backdrop or "Not now". `pending` drives the CTA's spinner as
  `Header.tsx`'s button already does.
- **No skip path.** The dialog's CTA *is* the checkout, so skipping saves one
  click; what is being bought has never been stated, which is the defect.
- **390px**: the benefits list makes this tall, so it scrolls within itself with
  the CTA pinned, checked at that width — the dashboard controls row has already
  overflowed 390px once (`wordle-teams-5jcn.22` measured 64px).
- **The trial-ended card keeps `TRIAL_ENDED_BODY`** and gets its own headline in
  the dialog rather than an exemption from it.

## 10. Open questions, to be resolved in planning

1. **Where the Polar drift check runs.** CI has no Polar credentials, and in this
   setup `convex run --prod` silently targets the local deployment, so a Convex
   action is an awkward host. A credentialed node script run by the owner is the
   likely answer.
2. **Whether `/pricing` is linked from the signed-in app menu.** Adjacent to
   `wordle-teams-wty4.1.15`, which owns in-app discoverability of `/insights`.
3. **Whether the trial is explained on `/pricing` or only in-app.** §6.2 assumes
   the page explains it; it is cheap to move.

## 11. Explicitly out of scope

- **What is gated** — `wordle-teams-iht.3` owns paywall placement and payload.
- **Insights content** — `wordle-teams-4s0`.
- **The launch email** — `wordle-teams-7e3c`, which also carries the terms-change
  notice.
- **Conversion measurement** — `wordle-teams-l10c.1`, which needs the DNS flip.
- **The prices themselves** — the owner's, set in Polar.
- **Selling Layer 4, chat or notifications as Pro** — see §2.
