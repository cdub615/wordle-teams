# v2 Phase 7 — Parity audit + hardening: Design

**Date:** 2026-08-31
**Epic:** `wt-ksh.8` (parent `wt-ksh`)
**Status:** Approved design, pending implementation plan

---

## Summary

Phase 7 makes v2's surface complete, proves route by route that it matches
production, and writes the cutover runbook Phase 8 executes from.

The phase was scoped as an audit. It is not one. A walk of v1 against v2 taken
during planning found that v2 is missing an entire tier of production's public
surface — the marketing landing, both legal pages, the login-error and
maintenance pages, the sitemap, the OpenGraph image and a real `robots.txt` —
plus two features on the dashboard itself. So Phase 7 builds first and audits
second. Auditing first would produce a checklist of gaps already known and would
have to be re-run in full afterwards.

Three ordered stages, one spec:

| Stage | What | Why it is where it is |
| --- | --- | --- |
| **A** | Complete the surface | The walk cannot walk routes that do not exist |
| **B** | Audit — the route-by-route comparison, env hygiene, a fresh copy run | Measures what A built, against production |
| **C** | Close out — Phase 5's sandbox pass, P3 polish, the runbook | The runbook cannot be written until B's findings are in |

Splitting A and B into two epics was considered and rejected: the runbook is the
deliverable and depends on both, so a split only inserts a handoff between two
halves of one thought.

---

## Context — measurements taken before any decision

Every number and file reference below was measured on 2026-08-31 against this
repository and the deployed beta, not recalled.

### 1. v2 has four routes; v1 has eleven plus metadata

`v2/src/routes/` holds `index.tsx`, `about.tsx`, `login.tsx`,
`complete-profile.tsx`, and two API routes (`api/auth/$.ts`, `api/funnel.ts`).

`src/app/` holds all of those plus `/home`, `/privacy`, `/terms`, `/login-error`,
`/maintenance`, `/branding`, `/me`, and the three metadata generators
`sitemap.ts`, `robots.ts` and `opengraph-image.png` + `.alt.txt`.

The gap is not large in code. Measured: `privacy/page.tsx` 111 lines,
`terms/page.tsx` 181, `branding/page.tsx` 62, `login-error/page.tsx` 34,
`maintenance/page.tsx` 7 plus a `Maintenance` component, and
`src/components/home/` is five components totalling about 7 KB. Mostly prose.

Two files in v2 already say this is Phase 7's job. `v2/src/components/Footer.tsx`
carries "DELIBERATELY OMITTED: v1's Privacy Policy and Terms links. Those routes
do not exist in v2 yet … Porting v1's static pages is Phase 7's route-by-route
walk." `v2/src/routes/about.tsx` carries "This is the SUBSTANCE of v1's About
page, not the whole thing … porting that marketing surface belongs to Phase 7's
route-by-route static-page walk."

### 2. v2's apex serves no marketing at all

v1's `src/app/page.tsx` renders `<Home />` to every visitor, signed in or not.
`/home` renders the same component with `redirectForPwa={false}` and a
`revalidate = 86400`. The dashboard is `/me`.

v2 inverted this: `v2/src/routes/index.tsx` **is** the dashboard, and its
`beforeLoad` throws `redirect({ to: '/login' })` for anyone unauthenticated. So
after cutover an anonymous visitor to the apex is bounced into a login form, and
a crawler finds nothing to index but `/about`.

This is not a neutral difference. `src/app/sitemap.ts` lists the apex at
priority 1. Two funnel bugs are already open against production —
`wordle-teams-390` (163 human visitors reached `/login` in 30 days, ~7%
completed auth) and `wordle-teams-456` (87% of signups never enter a board).
Removing the "what is this" surface plausibly makes 390 worse.

### 3. v1's PWA manifest points at `/me`, and v2 has no `/me`

`src/app/manifest.json` sets `"start_url": "/me"`. `v2/public/manifest.json` sets
`"start_url": "/"`.

Every production user who installed the PWA has `/me` burned into their
installed app, and an installed iOS PWA does not adopt a new `start_url` from a
re-fetched manifest. At cutover the domain flips and those apps open on a route
v2 does not have.

`src/lib/supabase/middleware.ts` compounds it: `welcomePaths = ['/', '/login']`
bounces a signed-in user to `/me`, with the comment "A signed-in user should
never land here (e.g. an iOS PWA relaunch that ignores manifest start_url and
restores the welcome page)". That rule exists precisely because start_url is not
reliable, and v2 has no equivalent.

### 4. The blanket `no-store` that amendment A4 predicted is already shipped

`wt-ksh.8`'s amendment A4, written 2026-08-03, says:

> Phase 0 shipped `wt-ksh.1.13` enforcing 'no-store' on SSR document responses —
> correct for authenticated documents, WRONG for the static marketing routes. If
> that is applied at the worker level to every document, v2 reproduces jcj on a
> new platform.

It is applied at the worker level to every document. `v2/src/server.ts`'s
`withNoStoreOnDocuments` guards only on `content-type` including `text/html` and
then sets `cache-control: private, no-store` unconditionally.

The cost this reproduces is measured. `wordle-teams-jcj`: v1's marketing pages
emitted `Cache-Control: public, max-age=0, must-revalidate` despite being
prerendered, so 28–41% of requests to `/home`, `/privacy` and `/terms` missed the
edge and invoked a cold function at roughly 1.9s. `src/app/home/page.tsx`'s
`revalidate = 86400` is the fix, and its comment explains it.

So this is a defect to fix in Stage A, not a discovery to make during the walk.

### 5. Two dashboard features exist in v2's backend and in no v2 UI

`hasSeenCelebration` and `monthlyWinners` are in `v2/convex/schema.ts`,
`winners.ts`, `billing.ts`, `migrate.ts` and their tests. §7a divergence #3 is a
careful argument about `hasSeenCelebration`'s rewrite semantics.

Nothing in `v2/src/` renders any of it. A grep for `celebrat` or `TeamBoards`
across `v2/src` returns zero hits. v1 has
`src/app/me/monthly-winner-celebration.tsx` and
`src/components/app-grid-items/team-boards.tsx` (168 lines), both imported by
`src/app/me/page.tsx`.

These are the open issues `wordle-teams-k7w` and `wordle-teams-ry1`, both filed
with "no owning phase in the v2 port" — which is exactly why nobody has been
assigned to notice them.

### 6. v2's `robots.txt` is the Vite starter default

`v2/public/robots.txt` is three lines: a comment, `User-agent: *`, and an empty
`Disallow:`. It allows everything and names no sitemap.

`src/app/robots.ts` disallows `/me/`, `/branding`, `/complete-profile`, `/novu`
and `/api`, and points at `https://wordleteams.com/sitemap.xml`.

### 7. Maintenance mode has no v2 mechanism, and v1's is being retired

`src/middleware.ts` reads `maintenance_${process.env.ENVIRONMENT}` from Vercel
Edge Config and rewrites to `/maintenance`, failing open on any read error. Edge
Config is on the epic's "Killed with no replacement" list.

Two things in that middleware are worth carrying rather than re-deriving. Its
matcher is an allowlist, not a filter, and deliberately excludes `/home`,
`/about`, `/privacy` and `/terms` — the comment argues those "are static and
render fine while the app is down", which is the better behaviour. And its
location note records that the file sat at the repo root for the project's whole
life, where Next silently ignores it, so maintenance mode had **never once
executed in production** before `bdca5f5`. `wt-ksh.8`'s own notes say it: do not
assume maintenance mode works in v2 because it exists; test it.

### 8. v2 has one route to checkout and the owner cannot reach it

`v2/src/components/team-picker.tsx:78` renders the only call site of
`createProCheckout`, inside a dropdown item shown when
`atFreeLimit = !isPro && teams.length >= FREE_TEAM_LIMIT` (`:48`). A free player
with one team has no way to pay, and the owner's account is comped Pro so
`isPro` is true and the item never renders for them at all.

This blocks Phase 5's close-out: `wordle-teams-02c`'s sandbox pass needs an
account that can actually reach checkout. `wordle-teams-6tp` records that v1 had
three upgrade buttons.

`v2/src/components/Header.tsx` already renders a Billing button for
authenticated users (`:155-165`) and already computes `isPro === false` (`:106`,
with a note on why it is not `!isPro`). The always-reachable entry point has an
obvious home there.

---

## Decisions Made (and alternatives ruled out)

| # | Decision | Chosen | Ruled out / why |
| --- | --- | --- | --- |
| A | Phase 5's unfinished close-out | **Absorbed into Phase 7** | Closing Phase 5 separately first, or decoupling the `wt-ksh.6 → wt-ksh.8` dependency. `6tp` is a funnel gap on the public surface Phase 7 is already rebuilding, so it lands in the same code and the same review pass, and the dependency is satisfied honestly rather than deleted |
| B | Missing public surface | **Build all four groups** — legal, crawler/social metadata, error/ops, marketing landing | Deferring the marketing landing to a post-cutover backlog. See Context 2: at cutover the apex flips to v2, so this is a regression visible to every anonymous visitor and every crawler, not an acquisition nicety |
| C | Dashboard URL | **`/app`**, with `/me` permanently redirecting to it | Matching v1's `/me` exactly (owner prefers `/app`, since it is the whole app surface while every other route serves some other function); and keeping the dashboard at `/` with a branching root. The branching root was rejected on cache grounds — see Decision D |
| D | Cache headers | **Per-route policy**, static documents cacheable at the edge, authenticated documents `private, no-store` | A blanket policy either way. Keeping the dashboard at `/` would have forced `/` to serve two different documents depending on a cookie, so it could never be edge-cached — reproducing `jcj` on the highest-priority page in the sitemap. Splitting `/` from `/app` is what makes a per-route policy expressible at all |
| E | Audit method | **A header/metadata script plus a manual visual walk** | A Playwright harness against both origins (largest build, and e2e is not one of the four gates so it only runs when someone remembers); a fully manual walk (cache-header comparison across a dozen routes by hand is exactly the check that silently gets skipped, and nothing is re-runnable at cutover) |
| F | Maintenance mechanism | **A plain Cloudflare Worker var**, read in `src/server.ts` | A KV namespace (a binding and a per-request read, plus a fail-open path to test, for a flag flipped roughly never); a Cloudflare-level rule outside the app (invisible to the repo, untestable, cannot reuse v1's route allowlist) |
| G | Upgrade entry points | **One always-reachable entry point** in the Header, beside/replacing Billing | Matching v1's three buttons. One reachable route is what `6tp` actually requires and what unblocks the sandbox pass; three is a funnel experiment, and this phase is a parity phase |
| H | `/branding` | **Dropped**, recorded as a divergence | Porting it. 62 lines of press-kit images, disallowed in v1's own `robots.ts` |

---

## Architecture

### The `/app` move and its blast radius

The dashboard route moves from `v2/src/routes/index.tsx` to a route at `/app`.
`/` becomes the marketing landing. `/me` becomes a permanent redirect to `/app`,
and it is permanent rather than transitional because installed PWAs keep their
original `start_url` indefinitely (Context 3).

Every URL-bearing consumer moves with it. The complete list, measured:

| Consumer | Today | After |
| --- | --- | --- |
| `v2/public/manifest.json` | `"start_url": "/"` | `/app` |
| `v2/convex/polar.ts:431` | `${siteUrl()}/?checkout=success` | `/app?checkout=success` |
| `v2/convex/polar.ts:653` | `${siteUrl()}/` | `/app` |
| `v2/convex/pushSend.ts` | payload `url: '/'` | `/app` |
| `v2/convex/reminderEmails.ts:146` | `<a href="${site}">` — the bare origin | `/app` |
| `v2/convex/inviteEmails.ts` | `${siteUrl}/login` (`teams.ts:692`) | **unchanged** — the move does not touch `/login` |
| `robots.txt` | (starter default) | `Disallow: /app` |
| Internal links, e2e specs, funnel events | `/` | `/app` |

Note `polar.ts:387` already carries a comment saying v1 used
`/me?checkout=success` and v2 uses `/`. That comment becomes wrong and must move
with the code — comment accuracy is a defect in this codebase, not a nit.

**The reminder email has no CTA link to the board, and gets one.** Its only link
today is the brand wordmark beside the icon (`reminderEmails.ts:146`), pointing
at the bare origin. That reaches the dashboard only because `/` currently *is*
the dashboard; after the move it would land a player on the marketing page
instead of the board the email just reminded them to enter.

Owner's decision, 2026-08-31: the email gets a **real call-to-action button to
`/app`**, rather than the wordmark link merely being re-pointed. This is a
deliberate departure from the parity rule, and a defensible one — the email's
entire purpose is to get the reader to enter a board, and it has never given
them anything to click that does that. v1's reminder email was a Novu template
that does not exist in this repo, so there is no v1 rendering to diverge *from*.

It is task **A1a**, and it is a change to **both halves** of the email. A CTA
present in the HTML and absent from the plain-text alternative is a parity bug
of its own: `reminderEmails.ts:101-118` builds a text part deliberately, with a
comment recording that a mail with no text alternative scores worse with spam
filters.

### Cache headers become route-aware

`withNoStoreOnDocuments` in `v2/src/server.ts` is replaced by a policy keyed on
the request path:

- **Static documents** — `/`, `/home`, `/about`, `/privacy`, `/terms`,
  `/maintenance`, `/login-error` — get `s-maxage` plus `stale-while-revalidate`,
  the shape `src/app/home/page.tsx`'s `revalidate = 86400` produces in v1.
- **Authenticated documents** — `/app`, `/complete-profile`, `/login` — keep
  `private, no-store`. The existing comment's reasoning is unchanged and still
  correct: an SSR document embeds dehydrated router/query state including the
  auth JWT.
- **An unrecognised path defaults to `no-store`.** The failure mode of a missing
  entry is then a slow page, never a shared one. A new authenticated route added
  later is safe by default; a new static route is merely uncached until someone
  notices.

### Maintenance mode

A `MAINTENANCE` var in `wrangler.jsonc`, read in `src/server.ts`. When truthy,
requests matching v1's allowlist — the app routes, not the static pages — are
served the `/maintenance` document. Unset means not in maintenance, which gives
v1's fail-open semantics for free, and any read failure is caught and continues.

Flipping the var in the Cloudflare dashboard takes effect without a code deploy,
which is the property Edge Config was providing.

### The parity harness

`v2/scripts/parity-routes.mjs`. For each route in a declared table, it requests
the path against both origins and records: HTTP status, `Cache-Control`,
`Content-Type`, `<title>`, canonical link, OpenGraph tags, and whether the route
exists at all. It emits a markdown table.

It is a plain fetch script, not a browser harness: no Playwright dependency, no
local Convex backend, runs in seconds, and re-runs at cutover to prove the flip
landed. It covers amendment A4's cache-header requirement mechanically. It does
not attempt to compare rendered output — that is the manual half, where eyes
genuinely beat automation, and it is what the written checklist is for.

---

## Task Breakdown

### Stage A — complete the surface

**A0 — `wordle-teams-lvv`.** The local Convex backend has silently refused every
push since the `creator`→`owner` rename. e2e drives that backend and several
protections in this codebase live only in e2e. Without this, every e2e result
this phase produces is meaningless.
*Done when:* a push succeeds against `127.0.0.1:3210` and an e2e run is green.

**A1 — dashboard moves to `/app`; `/me` redirects.**
*Done when:* every consumer in the blast-radius table points at `/app`, `/me`
issues a permanent redirect, `polar.ts:387`'s comment is corrected, and a test
covers the redirect.

**A1a — a real CTA button in the reminder email, to `/app`.** Both halves: an
HTML button and a plain-text URL line. The button follows the existing
`bgcolor` + inline `background-color` pattern already used in this file, which
`wordle-teams-cih` records as best-effort rather than guaranteed in dark mode —
so it must remain legible if the background does not apply.
*Done when:* a test asserts the HTML half contains a link whose href ends in
`/app`, and asserts the text half contains the same URL. Assert on the emitted
string, not a round trip — a codec you own both halves of will happily agree
with itself about a wrong answer.

**A2 — per-route cache headers.**
*Done when:* static and authenticated classes are each asserted by a test, and a
test proves an unrecognised path gets `no-store`.

**A3 — marketing landing at `/` and `/home`.** Port v1's `src/components/home/`.
Restore `Footer.tsx`'s legal links. Port v1's `welcomePaths` rule so a signed-in
visitor to `/` or `/login` is sent to `/app`.
*Done when:* both routes render for an anonymous visitor and a signed-in visitor
is bounced.

**A4 — `/privacy` and `/terms`.**
*Done when:* both render, both are linked from the footer, both are in the
sitemap.

**A5 — `/login-error`.** Also decides `wordle-teams-vjh`: v1's auth callback
discards the provider's `?error=` param and shows a generic page. Port the
behaviour as-is or carry the param through — either is acceptable, leaving it
undecided is not.
*Done when:* the route renders and vjh is closed with the decision recorded.

**A6 — `/maintenance` and the `MAINTENANCE` var.**
*Done when:* a test proves the gate in both states, proves the static pages are
**not** gated, and proves an unreadable var fails open.

**A7 — `robots.txt`, `sitemap.xml`, OpenGraph image and alt text.**
*Done when:* robots disallows `/app`, `/complete-profile` and `/api` and names
the sitemap; the sitemap matches the real route set; the OG image is served.

**A8 — About's missing half.** The eight annotated product screenshots. No
carousel — `wt-ksh.12.5` already ruled the aceternity dependency out.
*Done when:* `about.tsx`'s "this is the SUBSTANCE, not the whole thing" comment
is no longer true and has been removed.

**A9 — TeamBoards carousel (`wordle-teams-ry1`).**
*Done when:* it renders on `/app`.

**A10 — monthly-winner celebration dialog (`wordle-teams-k7w`).**
*Done when:* it renders, and it honours the `hasSeenCelebration` semantics §7a
divergence #3 describes — preserved when the winner is unchanged, reset only
when the winner actually changes.

**A11 — always-reachable upgrade entry point (`wordle-teams-6tp`).** In the
Header, where `isPro === false` is already computed: free players see Upgrade
where pro players see Billing. `team-picker.tsx`'s existing gated CTA stays.
*Done when:* a free player holding one team can reach `createProCheckout`.

### Stage B — audit

**B1 — `scripts/parity-routes.mjs`.**
*Done when:* it emits the table for every route against both origins.

**B2 — env and secret hygiene.** `wordle-teams-cd8` (SITE_URL and E2E_TEST_MODE
on beta), `-7az` (E2E_TEST_MODE unset on the deployment that becomes
production), `-3bl` (all five `POLAR_*` vars), `-5il` (`pnpm build` copies
`.dev.vars`, with secret values, into `dist/server`).
*Done when:* each is verified **against a beta-only sentinel value** — because
`convex env --prod` and `convex run --prod` both silently fall back to
`127.0.0.1:3210`, and `convex env get` exits 0 whether or not the variable
exists, so neither the output nor the exit code can be trusted on its own.

**B3 — fresh copy run and re-verify.** Run the copy against beta, then
`verify-parity.mjs --scope=all`.
*Done when:* the overwrite report has been read at **field** level; resurrection
has been checked by hand, because no diff-based report can see a row v2 deleted;
and `wt-ksh.7.32` is verified — no beta player left holding a non-empty
`reminderDeliveryMethods`. Counts come from `countTable`, which loops across
transactions and is therefore not a consistent snapshot: an off-by-one or two is
re-run before it is believed.

**B4 — §7a accuracy pass.** Correct `wordle-teams-c68`'s stale delete-site
inventories (14 is now 21, asserted in four places). Add divergence **#19**
(`/app` rather than v1's `/me`, with the `/me` redirect) and **#20** (the copy
omits reminder settings until cutover, per `wt-ksh.7.32`). Re-verify the
existing eighteen, and drop `/branding` in as a recorded divergence.
*Done when:* the "Eighteen known differences" header is correct and every row
still describes something true.

**B4a — file, do not fix:** `inviteEmails.ts:70` hardcodes
`https://wordleteams.com` in the plain-text footer regardless of deployment, so
a beta invite signs itself with the production origin. Real, pre-existing, and
too small to displace anything in this phase — it gets a bead.

**B5 — the written checklist walk.** Every production screen gets a ✔ against
beta. B1 carries the mechanical half; the visual and interactive half is walked
by hand.
*Done when:* the checklist is complete and every difference is either in §7a or
filed as a bug.

### Stage C — close out

**C1 — Polar sandbox pass on beta (`wordle-teams-02c`).** Now runnable because
A11 exists. Subscribe, upgrade, downgrade, cancel, confirming team limits move
correctly each time, and specifically that `subscription.canceled` does **not**
remove teams while `subscription.revoked` does.
*Done when:* the pass is run and `wt-ksh.6`'s six acceptance criteria are each
closed against evidence.

**C2 — P3 polish.** `wordle-teams-p37` (two paths throw a plain `Error` where a
caller sees it — fix, or document the exception deliberately), `-069`
(delivery-method writes lose updates across a slow browser prompt), `-uhx`
(`useLocalCapture` refs outlive the account), `-dpi` (the dashboard loader
awaits three independent Convex queries in sequence).

**C3 — the cutover runbook.** The phase's deliverable.
*Done when:* it carries, at minimum: `REMINDERS_ENABLED=true` on the production
deployment with `REMINDERS_ALLOWLIST` left empty; restoration of whatever
`wt-ksh.7.32` removes from the copy script; the `/me`→`/app` redirect verified
against a real installed PWA; the copy's overwrite report read at field level;
resurrection checked by hand; OAuth production callback URLs registered;
`E2E_TEST_MODE` unset; and the DNS flip.

---

## Testing

Same loop as Phase 6, which found something real in **every single task**,
including four Criticals: a fresh implementer per task, then a spec-compliance
review, then a code-quality review, then fixes, then close.

Every reviewer is told to mutation-test, and told the recurring finding
explicitly:

> **An extraction can move the untested part rather than shrink it.**

Three times in one phase a pure function was pulled out and thoroughly tested
while the wiring deciding whether it is ever called stayed uncovered — and in one
case an exact revert of the fix passed every gate.

All four gates every time — `lint`, `typecheck`, `test:once`, `build`. `build`
does not typecheck, and lint reaches `public/*.js` that build only copies. e2e is
**not** one of the four and is never run by CI, so it is run deliberately, and it
needs a local Convex backend on `127.0.0.1:3210` (which is what A0 restores).

Route-level work in this phase is unusually cheap to test wrongly. Two specific
traps:

- **A cache-header test that asserts only the happy path proves nothing.** The
  interesting assertion is that an unrecognised path gets `no-store` — that is
  the property protecting a route nobody has written yet.
- **A maintenance-mode test that only checks the on state misses the whole
  defect class.** v1's middleware never executed at all, and no test noticed for
  the project's entire life. Assert the off state, the on state, the excluded
  static pages, and the fail-open path.

---

## Divergences from v1 this phase adds

Both are written into `docs/design-system/V2-ADDENDUM.md` §7a in task B4, in the
same evidence-cited register as the first eighteen.

- **#19 — the dashboard is `/app`, not `/me`.** A deliberate rename, owner's
  decision 2026-08-31: `/app` is the whole application surface while every other
  route serves some other function. `/me` permanently redirects, because
  production PWAs carry `start_url: /me` and an installed iOS PWA never adopts a
  new one.
- **#20 — the copy omits reminder settings until cutover.** Per `wt-ksh.7.32`.
  Beta is expected to differ from production on `reminderDeliveryMethods` and
  `timeZone`; that is a parity difference the audit expects, not a bug, and the
  runbook restores it.

Plus one recorded drop: **`/branding` is not ported.**

---

## Out of Scope

- `/branding` and `/sentry-example-page` with its API route.
- The aceternity `InfiniteMovingCards` carousel (`wt-ksh.12.5`).
- Any fix to v1. `src/` is untouched until cutover.
- v1-side bugs: `wordle-teams-54s` (timezone picker offers 27 zones, players
  span 57), `-5p9` (board-entry date picker too small on a phone), `-31e`
  (boards entered in another timezone show on the wrong day).
- `wordle-teams-04r`, `-31a`, `-bya`, `-obw`, `-dcu`.
- Matching v1's three upgrade buttons. One always-reachable entry point only.
- Every post-cutover roadmap epic (`wordle-teams-qix`, `-418`, `-4s0`, `-qt4`,
  `-0hx`, `-c0f`, `-iht`).
- `wt-ksh.4` stays open deliberately — its done-when is the owner's side-by-side
  comparison on a real phone, which is their call, not a task outcome.

---

## Acceptance Criteria

1. A written checklist of every production screen has a ✔ against beta, and
   every difference is either recorded in §7a or filed as a bug.
2. `scripts/parity-routes.mjs` runs against both origins and reports no
   unexpected difference in status, `Cache-Control`, `Content-Type`, title,
   canonical or OpenGraph tags.
3. No document response carries a cache header inappropriate to its route:
   static documents are edge-cacheable, authenticated documents are
   `private, no-store`, and an unrecognised path defaults to `no-store`.
4. Maintenance mode has been demonstrated working on beta — on, off, and with
   the static pages still rendering while it is on.
5. `/me` redirects to `/app` and an installed PWA carrying the old `start_url`
   reaches the dashboard.
6. A free player holding one team can reach checkout.
7. The Polar sandbox pass is complete and `wt-ksh.6` is closed.
8. A fresh copy run and `verify-parity.mjs --scope=all` are clean, with the
   overwrite report read at field level and resurrection checked by hand.
9. `SITE_URL` is set and `E2E_TEST_MODE` is unset on the deployment that becomes
   production, each verified against a beta-only sentinel value rather than a
   bare command's output or exit code.
10. §7a is accurate: twenty rows, correct header count, correct delete-site
    inventories, every row still true.
11. The cutover runbook exists and carries every line listed in C3.
12. The reminder email carries a working call-to-action to `/app` in both its
    HTML and plain-text halves.
13. All four gates green, and e2e run deliberately and green.
