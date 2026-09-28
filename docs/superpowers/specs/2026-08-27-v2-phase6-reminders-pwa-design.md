# v2 Phase 6 — Reminders & PWA: Design

- **Epic:** `wt-ksh.7` (child of `wt-ksh`)
- **Branch:** `feat/v2-replatform`
- **Date:** 2026-08-27
- **Supersedes:** nothing. `wt-ksh.7` carries a one-line description and two notes; both are
  adopted below. Its only child, `wt-ksh.7.1`, is partly stale — see Context §5.

## Summary

The daily board-entry reminder in v2: a Convex cron, a timezone-correct eligibility rule, email
delivery through Resend, and **web push built from nothing**. Plus the PWA — `vite-plugin-pwa`
with a hand-written service worker, the manifest actually linked, an offline fallback, and the
kill switch that retires v1's Serwist worker at cutover.

It also builds the settings surface both halves depend on. v2 has no user menu, no dialog, and no
mutation that writes `timeZone`, `reminderDeliveryTime`, `reminderDeliveryMethods` or `hasPwa`.
Those five fields are in the schema and populated by the copy, and nothing in v2 reads or writes
one of them. Without that surface a reminder cannot be turned on, turned off, or scheduled, and
the eligibility rule has no `timeZone` to work from for anyone who signed up in v2.

**This is not a port of a working feature.** The email half is a faithful port of something live
in production. The push half is new construction wearing a port's clothes — see Context §1.

## Context — measurements taken before any decision

Every claim below came from reading the file named, not from reasoning about it.

### 1. Web push has never worked in v1, in any environment

Four independent pieces of evidence, all in this repo on this branch:

- `src/app/api/subscribe/route.ts:5` returns `NextResponse.json({ message: 'Subscription
  successful' })` as its first statement. The entire body — the Novu `setCredentials` call — is
  commented out beneath it, along with a `// Note: You'll need to implement user authentication
  and get the userId`.
- `src/components/push-subscribe-button.tsx:15` passes the literal string
  `'YOUR_PUBLIC_VAPID_KEY'` as `applicationServerKey`, with the comment `// get this from Novu`.
  That component is not imported anywhere.
- `src/components/app-bar/board-entry-reminders.tsx:121-134` has the Push switch commented out.
  Only the Email switch renders.
- `src/app/api/novu/route.ts:5` serves `workflows: [BoardEntryReminderEmailWorkflow]`. The push
  workflow is defined at `workflow.ts:27` and is not registered, so Novu has never known it
  exists.

The `push` and `notificationclick` listeners at `src/app/sw.ts:26-46` have therefore never fired.
Their icon paths are `/icon.png` and `/badge.png`, both marked `// TODO`, and neither file exists
in `public/`.

**Consequence for this phase.** "Port web-push" is not a porting task and must not be planned as
one. There is no working reference, no VAPID keypair anywhere, no subscription storage, and no
delivery path. Every line of it is new, which is why it carries a spike (§Spikes, S2) and the
largest share of the task breakdown.

### 2. v1's eligibility rule has the same timezone bug `puzzleDay` was created to fix

`supabase/migrations/20250416172516_limit_daily_reminders.sql` is the live definition of
`get_players_for_reminder`. Three of its clauses resolve a calendar day in the **server's** zone
rather than the player's:

```sql
EXTRACT(DOW FROM CURRENT_DATE) NOT IN (0, 6)          -- line 17: weekend, in UTC
ds.date >= CURRENT_DATE - INTERVAL '10 days'          -- line 24: activity window, in UTC
```

`CURRENT_DATE` is the database server's date. A player in Sydney has the weekend rule applied to
them on the wrong day for eight hours of every Friday and Sunday. This is the same defect class
the schema note at `convex/schema.ts:176-191` documents for `dailyScores`: 733 of production's
7468 score rows land on a different calendar day in UTC than in `America/Chicago`, across 57
distinct player timezones.

The "did they enter today" clause (lines 7-9) is *already* timezone-correct in v1 — it applies
`AT TIME ZONE p.time_zone` on both sides. v2 improves on it anyway, because `puzzleDay` records
the day the player was living in when they entered the board, so no resolution is needed at all.

A third defect, latent rather than active: the hour window at lines 11-12 is

```sql
reminder_delivery_time <= (now)::time AND reminder_delivery_time >= (now - 1 hour)::time
```

which is unsatisfiable whenever the hour spans midnight, because the lower bound wraps to `23:xx`
while the upper stays at `00:xx`. It cannot bite today: `board-entry-reminders.tsx:86-103` offers
exactly eighteen options, `05:00:00` through `22:00:00`. It becomes a live bug the moment anyone
adds an early or late hour to that list.

### 3. Convex functions cannot reach Sentry, and the house convention is `console.error`

`src/lib/sentry-capture.ts:1-14` reports through `@sentry/core`, which dispatches to whichever
client is bound to the current scope — `@sentry/cloudflare` on the Worker, `@sentry/tanstackstart-react`
in the browser. A Convex function runs in neither. `grep -rn "Sentry\|sentry" convex/` returns
nothing.

What Phase 5 actually did instead is visible throughout `convex/http.ts` and `convex/polar.ts`:
tagged `console.error` / `console.warn`, twenty-one call sites, all prefixed `[polar]`. Those land
in the Convex dashboard log and nowhere else.

Convex Log Streams would bridge this, and they are a paid-plan feature. `wordle-teams-dcu` records
that this project is on the free tier and that database bandwidth, not function calls, is its
binding limit.

### 4. `e2ePrune` would orphan a new player-keyed table

`convex/e2ePrune.ts` deletes players, teams, `dailyScores`, `monthlyWinners` and
`playerMembership`. It was written because an e2e-debris snapshot on 2026-08-26 found 2520
players, 1680 teams and 7915 `dailyScores` with no copied or seed data present at all
(`e2ePrune.ts:11-20`), and because `getMyTeamsFor` collects the whole `teams` table on the
critical path of every sign-in — measured at ~260ms median against 1680 teams.

Any table this phase adds that is keyed by `playerId` inherits that growth and must be pruned
with its player. `wordle-teams-31a` already tracks the Better Auth component tables, which the
prune cannot reach.

### 5. The manifest is correct; nothing links it

`wt-ksh.7.1` says `v2/public/manifest.json` "still carries 'Create TanStack App Sample' branding
and TanStack logos". That was true when the issue was filed on 2026-07-17 and is not true now —
commit `bc8e061` ("replace TanStack starter content with Wordle Teams") rewrote it. The file today
carries the Wordle Teams name, four real icons, `#0a0a0a` theme and background, `standalone`
display and portrait orientation.

What is missing is the link. `src/routes/__root.tsx`'s `head()` returns a `links` array containing
one entry, the stylesheet. There is no `<link rel="manifest">`, no `theme-color`, no service
worker, and no registration anywhere in `v2/src`. **v2 is not installable at all today**, which is
a larger gap than the issue describes and the reason `wt-ksh.7.1` is adopted into this phase
rather than closed against the existing file.

### 6. The reminder email's branding images are the Supabase trap in `wt-ksh.7`'s notes

`src/app/novu/workflows/board-entry-reminder/schemas.ts:10,16` default two payload fields to

```
https://dcfqzbdusxhrfgvnpwqc.supabase.co/storage/v1/object/public/images/wordle-teams-title.png
https://dcfqzbdusxhrfgvnpwqc.supabase.co/storage/v1/object/public/images/wt-icon.png
```

Both are rendered by `src/app/novu/emails/board-entry-reminder-email.tsx:37,47`. Supabase retires
in Phase 9. Re-hosting is therefore in scope here, not deferred — an email that breaks after
cutover breaks silently, in someone else's inbox, where nothing we run would notice.

`v2/public/` already holds `wt-icon-192x192.png`, so only `wordle-teams-title.png` has to be
fetched across.

### 7. Existing v2 scaffolding this phase must consume, not duplicate

- `convex/email.ts` is the only sending path and deliberately does not export its Resend client.
  Its own doc comment (`:17-21`) names Phase 6's reminders as "the third sender", covered by
  construction. `sendEmail` accepts a `MutationCtx` *or* an `ActionCtx`, which is what lets the
  sweep enqueue mail transactionally.
- `convex/lib/puzzleDay.ts` already provides `toPuzzleDay`, `addDays` and `isWeekendDay`, and is
  dependency-free on purpose so Convex functions can import it.
- `convex/access.ts` provides `requirePlayer`, `accessError` and the `...For` helper convention
  that `wordle-teams-obw` requires — rules never go in a query or mutation wrapper, because
  `convex-test` cannot stand up a Better Auth session.
- `convex/inviteEmails.ts` holds an `escapeHtml` this phase needs a second copy of, and its doc
  comment explicitly defers the react-email decision to Phase 6 (see Decision D).
- `src/lib/use-media-query.ts`, `ui/tabs.tsx`, `ui/select.tsx`, `ui/switch.tsx`, `ui/dialog.tsx`
  and `ui/dropdown-menu.tsx` all exist. The settings dialog adds no new primitive.

## Decisions Made (and alternatives ruled out)

| # | Decision | Ruled out |
|---|---|---|
| A | **Build web push fully** — VAPID, subscription table, SW handlers, delivery | Email-only with push deferred; push gated behind `hasPwa` |
| B | **Full settings port** — Header dropdown, dialog, Notifications + Install Guide tabs | Notifications-only dialog; a bare `/settings` route |
| C | **Static assets + one offline page**; navigations never cached | Porting serwist's `defaultCache`; no fallback at all |
| D | **Hand-written email HTML**, matching the two existing senders | Adopting `@react-email/components` |
| E | **Fix the timezone bugs**, port every other eligibility rule unchanged | Bug-for-bug port; also fixing the midnight window |
| F | **Claim before sending**, and retry on delivery failure | v1's send-then-claim |
| G | **`console.error('[reminders] …')` + a scheduled retry** | A `reminderDeliveries` table; hand-rolled Sentry ingest |

### On decision C

The offline page is the one place this design adds a screen v1 does not have, and it is worth
saying why the alternative was rejected rather than merely not chosen. `wordle-teams-bpt` measured
what serwist's `defaultCache` actually does: its HTML rule matches on the **request's**
`Content-Type`, which a navigation GET never sends, so that rule is dead code and every same-origin
document falls through to a `NetworkFirst` catch-all writing into a cache named `others`. One
user's rendered `/me` dashboard sits in Cache Storage for up to 24 hours and can be served to the
next person on a shared device after sign-out. Reproducing that faithfully would mean knowingly
shipping a disclosure bug to make a parity walk tidier.

### On decision E

This diverges from production deliberately, so the Phase 7 side-by-side will show beta reminding
some players on days prod does not. That is the correct outcome and is recorded in §Divergences so
the audit reads it as intended rather than as a regression.

### On decision F

The two failure modes are not symmetric and neither is free. Claim-first can never double-send but
can silently skip a player for a day; send-first can never skip but can repeat. G is what makes F
tolerable: a delivery failure schedules its own retry rather than waiting for a cron window the
player has already aged out of, because the hour window makes each player eligible during exactly
one run per day.

### On decision G

`console.error` is not an alert and this design does not pretend otherwise. It is the convention
already in place across twenty-one Phase 5 call sites, it costs nothing, and the scheduled retry
is what actually addresses the failure. The two alternatives were priced and rejected: a
`reminderDeliveries` table adds a row per attempt to a project whose binding constraint is
database bandwidth (`wordle-teams-dcu`), and a hand-rolled Sentry envelope adds a second, untested
reporting path alongside the one that works.

## Architecture

### Layer 1 — pure logic (no Convex, no I/O, no env)

`convex/lib/reminders.ts`, testable with plain vitest:

| Export | Responsibility |
|---|---|
| `localParts(timeZone, at: Date)` | `{ day: PuzzleDay, time: 'HH:MM:SS' }` for an instant in a zone |
| `isDueThisHour(reminderTime, localTime)` | v1's one-hour window, ported as-is |
| `alreadyRemindedToday(lastReminder, timeZone, localDay)` | the once-per-day guard, resolved locally |
| `hasRecentActivity(days, localDay)` | any puzzle day within the trailing 10 |
| `enteredOn(days, localDay)` | membership test |
| `needsWeekendOptIn(localDay)` | whether the weekend rule applies at all |

Every one takes its inputs and returns a value. None reads a clock, an env var or a database — the
same shape `lib/scoring.ts` and `lib/polarEvents.ts` already have, and the reason those two are
the best-tested modules in `convex/`.

### Layer 2 — Convex functions

| Module | Contents |
|---|---|
| `convex/crons.ts` | one hourly entry at `minuteUTC: 0` → `internal.reminders.sweep` |
| `convex/reminders.ts` | `sweep` (internal mutation) and the eligibility helpers it calls |
| `convex/reminderEmails.ts` | subject, HTML and plain-text bodies |
| `convex/push.ts` | `publicKey` query, `savePushSubscription`, `removePushSubscription`, `subscriptionsFor` (internal) |
| `convex/pushSend.ts` | **`'use node'`** — the `web-push` delivery action, nothing else |
| `convex/settings.ts` | `mySettings` query; `updateTimeZone`, `updateReminderTime`, `updateReminderMethods`, `markPwaInstalled` |
| `convex/lib/html.ts` | `escapeHtml`, moved out of `inviteEmails.ts` |

`pushSend.ts` contains only actions. A `'use node'` file cannot hold queries or mutations, so the
subscription reads and the prune-on-410 write live in `push.ts` and are reached through
`ctx.runQuery` / `ctx.runMutation`.

### Layer 3 — UI

| File | Contents |
|---|---|
| `src/components/user-menu.tsx` | the Header dropdown |
| `src/components/settings/settings-dialog.tsx` | tabs shell |
| `src/components/settings/notifications-tab.tsx` | timezone, time, two switches |
| `src/components/settings/install-tab.tsx` | the Add-to-Home-Screen guide |
| `src/lib/time-zones.ts` | v1's grouped option list and `timeZoneMapping` |
| `src/lib/push-subscribe.ts` | permission request, `pushManager` subscribe, key encoding |
| `src/lib/register-sw.ts` | the single registration |
| `src/sw.ts` | the service worker source |

## The reminder pipeline

`crons.hourly` → `internal.reminders.sweep`, **a mutation**, so the set of eligible players is
decided against one consistent snapshot rather than a set that can shift underneath a long action.

1. `const now = new Date()`.
2. `ctx.db.query('players').collect()`. Production holds 533. This is the same bounded-collect
   justification `convex/schema.ts:137-140` already makes for `teams`, and it is stated here so
   the number is on the record: revisit if player count changes by an order of magnitude.
3. In-memory filter, cheapest predicate first: `timeZone` present → at least one delivery method →
   `isDueThisHour` → not `alreadyRemindedToday`. One of eighteen reminder hours matches on any
   given run, so roughly thirty players survive.
4. For each survivor, **one** index range query on `by_player_and_puzzleDay` bounded to
   `[addDays(localDay, -10), localDay]`. That single read answers both remaining questions —
   `enteredOn(days, localDay)` and `hasRecentActivity(days, localDay)`. Skip anyone who already
   entered today or has no activity in the window.
5. Weekend rule, and only when a survivor's *local* day is a weekend: collect `teams` once and
   keep players who are on at least one team with `playWeekends: true`. Collected lazily so five
   days a week the read never happens.
6. **Claim.** `ctx.db.patch(player._id, { lastBoardEntryReminder: now.getTime() })`, in this
   transaction, before any delivery is attempted.
7. Deliver. `reminderDeliveryMethods.includes('email')` → `sendEmail(ctx, …)`, which enqueues into
   the Resend component transactionally and owns its own retry.
   `includes('push')` → `ctx.scheduler.runAfter(0, internal.pushSend.deliverTo, { playerId })`.

Steps 2-6 are one transaction. If it retries under OCC contention, no mail has been enqueued and
no claim has been committed, so a retry is clean by construction.

### Why the claim is a patch and not a flag

`lastBoardEntryReminder` is an existing field carrying an existing meaning — v1 writes it from
`update_last_board_entry_reminder` after a successful send. v2 writes the same field before the
send instead. No schema change, and a row copied from Supabase mid-cutover carries a value both
systems interpret the same way.

## Push, end to end

**Keys.** One VAPID keypair generated once, stored as `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
`VAPID_SUBJECT` (a `mailto:`) in Convex env. Per the standing note about this project's env
blocks, prod values sit commented above dev ones and beta reads the prod block.

The browser needs the public key. It comes from `api.push.publicKey`, a Convex query — **not** a
`VITE_` variable. A second copy in a second config system is a second thing to set correctly on
two deployments, and getting it wrong produces a subscription that encrypts to a key nobody holds,
which fails at delivery rather than at subscribe.

**Subscribe.** The switch requests `Notification.permission`, then
`registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, then posts
the endpoint and both keys to `savePushSubscription`. Denied permission toasts and leaves the
switch off — it does not write `'push'` into `reminderDeliveryMethods`, because a method the
browser will never honour is worse than no method at all.

**Store.**

```
pushSubscriptions: {
  playerId: v.id('players'),
  endpoint: v.string(),
  p256dh: v.string(),
  auth: v.string(),
  createdAt: v.number(),
}
  .index('by_player', ['playerId'])
  .index('by_endpoint', ['endpoint'])
```

One player can hold several — phone, laptop, a second browser — and each is a separate endpoint.
`by_endpoint` is what the prune-on-410 path looks up.

**Deliver.** `convex/pushSend.ts` under `'use node'`, because `web-push` needs Node crypto for
VAPID JWT signing and AES128GCM payload encryption, and Convex's default runtime does not have it.
For each subscription: `webpush.sendNotification(…)`. A `404` or `410` means the browser threw the
subscription away, so delete that row. Any other failure is `console.error('[reminders] …')` plus
one retry.

The retry is the action rescheduling **itself** via `ctx.scheduler.runAfter`, and it therefore
needs a stop condition or it is an infinite loop against a push service having a bad day.
`deliverTo` takes an `attempt: number`, retries only at `attempt === 0`, and at `attempt === 1`
logs and gives up. One argument, checked in one place, rather than a comment promising restraint.

**Receive.** `src/sw.ts`'s `push` listener parses the payload and calls `showNotification` with a
real icon this time — `/wt-icon-192x192.png`, which exists, rather than v1's `/icon.png`, which
does not. `notificationclick` focuses an existing client if one is open and otherwise opens `/`.

## The PWA

`vite-plugin-pwa@1.3.0` — its peer range is `vite ^3 || ^4 || ^5 || ^6 || ^7 || ^8` and this
project is on Vite 8.

```
strategies: 'injectManifest'   // we own the worker; it must carry push handlers
srcDir: 'src'
filename: 'sw.ts'              // emitted as sw.js at the root
injectRegister: false          // registration is ours, and singular
manifest: false                // public/manifest.json is already correct
```

`injectRegister: false` is the structural half of amendment A3 and commit `e70592d`. v1 shipped
duplicate registrations because serwist injected one and `service-worker-registration.tsx` added
another; the fix there was a comment and a config flag that a future edit could silently undo.
Here there is only ever one registration because the plugin is never asked to make one.

The worker does four things:

1. Precache the build's static assets from the injected manifest.
2. **NetworkOnly for navigations**, with a catch that serves the offline document.
3. `push` → `showNotification`. `notificationclick` → focus or open.
4. On `activate`: `skipWaiting()`, `clients.claim()`, and delete every cache whose name is not
   ours.

### The offline page must be a static file

`public/offline.html`, added to the precache explicitly. **Not** a TanStack route.

`injectManifest` precaches build *output*. A route at `/offline` is server-rendered on request, so
there is no artifact at build time for the plugin to hash and store — it would appear configured,
build green, and fail exactly when it is needed. This is written down because the route is the
obvious thing to reach for and the failure is invisible until someone is genuinely offline.

### The kill switch is step 4, and needs no separate deploy

v1 registers `/sw.js` (`service-worker-registration.tsx:19`). v2 serves `/sw.js`. At cutover the
domain points at the Worker, the browser byte-compares the script on the next navigation, finds it
different, and installs ours. `skipWaiting` plus `clients.claim` make the takeover immediate
rather than two visits later, and the cache purge in `activate` removes serwist's `others` and
`pages` caches — which is also the fix `wordle-teams-bpt` asks for, arriving as a side effect of
replacement rather than as a change to v1.

Nobody can be stranded on a stale serwist cache, because the only way to keep the old worker is to
never visit the site again.

### `__root.tsx`

`head()` gains `<link rel="manifest" href="/manifest.json">` and a `theme-color` meta matching the
manifest's `#0a0a0a`. That is what makes the app installable, and it closes `wt-ksh.7.1`.

## Settings

Header gains a user menu, gated on `isAuthenticated` with `'skip'` — the same discipline
`Header.tsx:36-41` documents, where `enabled: false` was measured not to gate a Convex query.
Selecting Notifications or Install Guide opens one dialog on the matching tab, mirroring v1's
`defaultTab` prop.

**Notifications tab** (`user-dialog.tsx:122-157` + `board-entry-reminders.tsx`): timezone select
over v1's five grouped regions with short labels below `640px`; reminder time select, eighteen
options `05:00:00`–`22:00:00`; Email switch; Push switch.

**Install Guide tab** (`user-dialog.tsx:158-176`): the three-step Add-to-Home-Screen instructions,
ported. This is not decoration — iOS grants push only to an installed PWA, so on iPhone this tab
is the only route to the feature the other tab offers.

**Silent capture**, ported from `app-bar-base.tsx:31-68`: on the first authenticated load, if
`timeZone` is empty, resolve `Intl.DateTimeFormat().resolvedOptions().timeZone`, run it through
`timeZoneMapping`, and persist. If `display-mode: standalone` matches and `hasPwa` is false,
persist that too.

`timeZoneMapping` exists in v1 to translate five JS zone names into the spellings Postgres wants.
`Intl` accepts both spellings, so in v2 it is cosmetic — it is ported anyway so that copied rows
and natively-created rows spell a zone identically, which is one fewer false difference for the
Phase 7 audit to chase.

### `reminderDeliveryMethods` stays `v.array(v.string())`

Narrowing it to `v.array(v.union(v.literal('email'), v.literal('push')))` would be the honest
type, and Convex validates a schema narrowing against every existing document on push. These are
copied rows. `convex/schema.ts:44-66` records what that costs when it goes wrong — the `firstName`
narrowing needed production cleared first, and 151 of 533 players were affected.

The constraint lives in `updateReminderMethods` instead, which accepts only those two values and
throws `accessError` otherwise.

### Every rule goes in a `...For` helper

`requirePlayer` from `access.ts`, never in a query or mutation wrapper. `wordle-teams-obw`: those
wrapper bodies are unreachable by any test, because `convex-test` cannot stand up a Better Auth
session. Anything worth asserting has to sit somewhere a test can call.

## Error handling

Every failure path uses `ConvexError` via `accessError`, never a plain `Error` — plain messages
are redacted in production, so an operator loses the diagnostic exactly when they need it. Note
the blind spot recorded against this project: `convex-test` never redacts, so a test cannot
observe the difference and code review is the only check.

| Failure | Behaviour |
|---|---|
| Sweep finds nobody | Normal. No log, no send. |
| `sendEmail` returns `null` | Every recipient was an e2e throwaway. Normal; suppression, not failure. |
| `sendEmail` throws "no recipients" | A bug in the caller. `email.ts:51-60` makes this loud on purpose. |
| Push delivery `404`/`410` | Delete that subscription row. Not an error. |
| Push delivery, other | `console.error('[reminders] …')` + one scheduled retry. |
| `Notification.permission` denied | Toast, switch stays off, `'push'` not written. |
| SW registration fails | Warn and continue. The PWA is an enhancement; `e70592d`'s comment lists the legitimate causes. |
| `timeZone` unset at sweep time | Player is skipped. Same as v1. |

## Spikes — measure before building on them

Three assumptions above are load-bearing and unverified. Each is a task, each runs before anything
depends on it, and each is answered by a command rather than by reading documentation. Phase 5's
lesson: `validateEvent` passed every gate and could not run on Convex's runtime, and only a live
request found it.

**S1 — Does `Intl.DateTimeFormat` accept an arbitrary IANA `timeZone` in Convex's default
runtime?** Every eligibility rule in Layer 1 depends on it. If the runtime ships without full ICU,
`localParts` needs a different implementation and the shape of §Layer 1 changes. Answered by
deploying one throwaway query that formats a fixed instant in `Australia/Sydney` and calling it on
beta.

**S2 — Does `web-push` import and run in a Convex `'use node'` action on beta?** This is
`Buffer is not defined` in its next costume: invisible to lint, typecheck, vitest and build, all
four of which pass against code that cannot execute. Answered by deploying a `'use node'` action
that imports `web-push`, signs a VAPID header, and sends one real notification to the owner's own
subscription.

**S3 — Does `vite-plugin-pwa` + `injectManifest` build alongside `@cloudflare/vite-plugin` and
`tanstackStart()`, and does the Worker serve `/sw.js` at root scope with a JavaScript content
type?** `wrangler.jsonc:101` has the `assets` binding commented out, so `public/` is served by the
Cloudflare plugin's own build-time configuration and I have not measured how. A service worker
served from the wrong path, with the wrong content type, or with a long cache lifetime, fails in
three different ways. Answered by building and deploying a minimal worker to beta and fetching
`/sw.js`.

## Testing

**Unit — `convex/lib/reminders.ts`.** Plain vitest, no backend. The hour window including the
half-hour-offset zones (`Asia/Kolkata` at UTC+5:30 must still match an on-the-hour reminder time);
local weekend evaluation for a player whose local Saturday and UTC Saturday differ; the 10-day
window at both boundaries; the claim-day comparison across a local midnight.

**Unit — templates and encoding.** `reminderEmails.ts` renders both parts and escapes a hostile
first name. `push-subscribe.ts`'s base64url→`Uint8Array` conversion round-trips.

**Integration — `convex-test`.** `sweep` against fixtures: a due player with no score today gets
claimed and enqueued; a player who already entered does not; a player reminded earlier today does
not; a weekend player on a `playWeekends: false` team does not, and does on a `true` one; a player
dormant for 11 days does not. Prune-on-410 deletes the right row and only that row.

**e2e.** The settings dialog: open from the menu, change timezone, change reminder time, toggle
Email, and see each persist across a reload. The Push switch runs under
`context.grantPermissions(['notifications'])` and asserts the subscription reached Convex; the
delivery leg is not e2e-testable and is not faked.

**Manual, on beta — this is the done-when.** A real push and a real email arriving at the
configured time, and the PWA installing on a phone. No gate substitutes for it. `wt-ksh.4` is
deliberately left open for the owner's side-by-side on a real phone, and this is the natural
moment for it.

**Gates.** `pnpm lint`, `pnpm typecheck`, `pnpm test:once`, `pnpm build`. Each gets its own
`cd v2` — the shell cwd resets between calls and the repo root is v1's package, where two of the
four scripts do not exist and a build dirties `public/sw.js`. **Never pipe a gate**: this shell is
zsh, where `PIPESTATUS` expands to empty, and a piped check produced four false greens in Phase 5.
Redirect to a file and `echo $?`.

e2e is not one of the four gates and never runs as part of them — a spec stayed red for three
tasks on that assumption.

## Divergences from v1

The list lives in `docs/design-system/V2-ADDENDUM.md` §7a. Phase 5 left it at thirteen. This phase
adds five.

| # | Divergence | Why |
|---|---|---|
| 14 | Weekend rule evaluated in the player's zone, not UTC | Decision E; Context §2 |
| 15 | 10-day activity window evaluated in the player's zone, not UTC | Decision E; Context §2 |
| 16 | `lastBoardEntryReminder` written before delivery, not after | Decision F |
| 17 | Web push actually delivers | Context §1 — v1's never has |
| 18 | Navigations are never cached; one static offline page | Decision C; `wordle-teams-bpt` |

14, 15 and 17 will make beta and prod reach different people on some days. The Phase 7 parity walk
must read that as intended.

Not a divergence, and worth stating so it is not filed as one: the midnight-wrapping hour window
(Context §2) is **ported unchanged**. It is unreachable behind the eighteen-option picker.

## Out of Scope

- **Retiring the rest of Supabase Storage.** Only the two reminder-email images move. Phase 9.
- **Fixing the midnight hour window.** Latent, unreachable, and a separate issue.
- **Narrowing `reminderDeliveryMethods`.** Requires clearing production first.
- **Reminder categories beyond board entry.** One workflow, as in v1.
- **A push preview or test-send button.** Tempting for the manual verification and not a feature
  anyone asked for.
- **Convex Log Streams / real alerting.** Paid-plan; Context §3.
- **`wordle-teams-b31`** — `internal.migrate.counts` and its six unbounded collects are Phase 7's.
  Nothing here adds a caller.
- **`wordle-teams-dpi`** — the dashboard loader's three sequential queries. Adjacent, not this.

## Acceptance Criteria

1. `pnpm lint`, `pnpm typecheck`, `pnpm test:once` and `pnpm build` all pass from inside `v2/`,
   each verified by its own exit code and not through a pipe.
2. The three spikes are answered on beta, by command output, before any task depends on them.
3. A player with `reminderDeliveryMethods: ['email']` and a reminder time one hour out receives a
   real email on beta, at the right hour for their zone, containing no Supabase URL.
4. The same player with `['push']` receives a real push notification on a real phone, and tapping
   it opens the app.
5. A second sweep in the same local day sends nothing to that player.
6. A player who has already entered today's board is not reminded.
7. On a Saturday, a player whose only team has `playWeekends: false` is not reminded; a player on
   a `true` team is.
8. The settings dialog persists timezone, reminder time and both toggles across a reload, and the
   Install Guide tab renders.
9. Wordle Teams installs to a phone home screen from beta and opens standalone.
10. Loading beta with the network disabled shows the offline page rather than the browser's error.
11. `pushSubscriptions` rows are deleted with their player by `e2ePrune`.
12. No Convex function throws a plain `Error`; every thrown failure is a `ConvexError` via
    `accessError`.
13. Divergences 14-18 are written into `docs/design-system/V2-ADDENDUM.md` §7a before the phase
    closes.

## Acceptance Criteria — the walk, 2026-08-31

Task 14's close-out. Every line below names the command that was run or the thing that was
observed. **Nothing here is green by reasoning**, which is the failure mode this spec was written
against; where the only available evidence was measured by somebody else it says so, with the
date, and where a criterion cannot be met from a terminal it is left not-met rather than argued
into green.

Two criteria are recorded as something other than pass/fail — **2 is partially met** and **12 is
written too broadly** — and neither is rounded up.

| # | Verdict | Evidence |
|---|---|---|
| 1 | **GREEN** | All four gates run from inside `v2/`, sequentially, each redirected to its own file with `$?` read on the next line — never piped, because zsh's `PIPESTATUS` is empty and a piped check reports a false green. `pnpm lint` → 0. `pnpm typecheck` → 0. `pnpm test:once` → 0, **56 files / 887 tests passed**. `pnpm build` → 0, ending `[build-sw] wrote dist/client/sw.js — precaching 25 files, 1032.8 kB. Scope: / (served at /sw.js).` |
| 2 | **PARTIAL** | The criterion asks for all three spikes answered **on beta, by command output**. Two were; one was not. **S1** (`wt-ksh.7.18`, `Intl` timezone support) was answered on the **LOCAL** backend, not beta — its own correction note of 2026-08-28 says so plainly, because `v2/.env.local` sets `CONVEX_DEPLOYMENT=anonymous:anonymous-v2` (confirmed here) so `convex run --prod` silently falls back to `127.0.0.1:3210`, and `convex run` cannot reach beta at all (`deployment:functions:runTestQuery` denied against `fabulous-goldfish-949`). The answer stands **for the purpose it served** — full ICU is present on that runtime binary, the local backend is the same binary, and Task 3 needed no redesign — but **beta's own ICU data is not independently established**. **S2** (`wt-ksh.7.27`) *was* answered on beta, by a dashboard probe against `fabulous-goldfish-949`: `{ ok: true, stage: "sent", statusCode: 201, env: { hasBuffer: true, … } }`. **S3** (`wt-ksh.7.19`) was answered, negatively, and confirmed over the wire on beta (`/sw.js` → 404 after the deploy, because `vite-plugin-pwa` emitted nothing). Two of three on beta, so: partially met |
| 3 | **NOT MET — needs the owner** | No real reminder email has been sent on beta. `REMINDERS_ENABLED` and `REMINDERS_ALLOWLIST` are deliberately unset there (recorded in `wt-ksh.7.27`'s notes), and `sweep` claims nobody without them — pinned by *"claims nobody when `REMINDERS_ENABLED` is unset"* (`convex/reminders.test.ts:437`). This could not be re-verified from here either: `pnpm exec convex env list --prod` returned the **local** backend's four variables with `SITE_URL=http://localhost:3000`, which is the same anonymous-deployment fallback S1 hit. **Still needs:** the owner to set both variables on beta, with the allowlist narrowed to their own address, and to confirm the mail arrived at the right local hour with no Supabase URL in it |
| 4 | **NOT MET — needs a real device** | No push notification has been delivered to a real phone from the reminder path. What *is* established is the layer beneath it: S2 got `statusCode: 201` from a real push service on beta, which means VAPID signing and AES128GCM encryption both executed on Convex's Node runtime. Whether the notification **renders**, and whether **tapping it opens the app**, is a property of the device and the worker's `notificationclick` handler and cannot be observed from a terminal. **Still needs:** the owner to subscribe on a phone against beta and receive one |
| 5 | **GREEN** | `convex/reminders.test.ts:135`, *"skips a player already reminded earlier in their local day"*, and `:329`, *"a player matching twice in one day — the normal case, not an edge case — is reminded only once"*. Both passed in the `pnpm test:once` run above. The second is the one that matters: it is the double-match this design absorbs by claiming before it sends, not a hypothetical |
| 6 | **GREEN** | `convex/reminders.test.ts:125`, *"skips a player who already entered today"*. Passed in the same run |
| 7 | **GREEN** | Both directions, `convex/reminders.test.ts:155` *"on a Saturday, skips a player whose only team does not play weekends"* and `:164` *"on a Saturday, reminds a player on a team that does play weekends"*. Passed in the same run. Note that v2 asks the question in the **player's** zone where v1 asks it in the server's — see divergence 14 |
| 8 | **GREEN** | `pnpm exec playwright test` against the local Convex backend on `127.0.0.1:3210`: **22 passed**, exit 0. Three of them cover this criterion directly — `e2e/settings.spec.ts:95` *"changing the reminder time and toggling Email each report success and persist"* (which does a real `page.reload()` and re-asserts), `:126` *"a time zone copied in its Postgres spelling displays correctly, and changing it persists"*, and `:28` *"the hamburger opens the menu, and each item opens the dialog on its own tab"*, which asserts the **Install Guide** tab reaches `data-state="active"`. The **Push** toggle is covered by `:223` in its absent-VAPID-key form only, which is the local backend's configuration |
| 9 | **NOT MET — needs a real device** | Nothing about a home-screen install can be observed from a terminal. The preconditions are all in place and were checked here: `https://beta.wordleteams.com/manifest.json` → **200, `application/json`**, and beta's document head really does carry `<link rel="manifest" href="/manifest.json"/>` alongside `<meta name="theme-color" content="#0a0a0a"/>` — which is what `wt-ksh.7.1` was reopened for, since the manifest existed for weeks with nothing linking it. `/sw.js` → **200, `text/javascript`, `cache-control: public, max-age=0, must-revalidate`**. **Still needs:** the owner to install it on a phone and confirm it opens standalone rather than in a browser tab |
| 10 | **GREEN — measured by the controller, 2026-08-29** | Verified in a real Chromium against beta via Playwright `context.setOffline(true)` followed by a navigation. Title was `Offline · Wordle Teams`; the body read *"You're offline — Wordle Teams needs a connection to load…"*. Both strings were re-checked here against `v2/public/offline.html`, which is the file that gets precached, and they match it. The same run found **no document in Cache Storage** (`text/html` entries excluding the offline page: none), exactly one service worker registration at scope `https://beta.wordleteams.com/`, and `caches.keys()` = `["workbox-precache-v2-https://beta.wordleteams.com/"]`. The precache entry is `{"revision":"c45b981fdce28ce1857bb2bf6940a8ca","url":"offline.html"}`, confirmed unchanged in the build output here — `v2/public/offline.html` has not been touched since `f71d183`. **One correction:** the size is **3781 bytes**, not 3779 — that is what the file measures on disk and what `https://beta.wordleteams.com/offline.html` returns over the wire today. (That URL 307s to `/offline` before serving; irrelevant to the criterion, since the worker serves the page from the precache and never asks the network) |
| 11 | **GREEN** | `convex/e2ePrune.test.ts`, the three tests under `describe('push subscriptions')` at `:335` — all of an e2e player's subscriptions counted and deleted, a non-e2e player's subscription surviving, and the dry run predicting the exact count the write then deletes. Plus `:169`/`:181`, where `pushSubscriptionsDeleted` is `1` and the table is empty after a full-player prune, and `:240`/`:251`, where a real player's subscription is not collateral damage. All passed in the `pnpm test:once` run |
| 12 | **WRITTEN TOO BROADLY — not passed, and not failed** | See the section below. As written the criterion is **false**, and it was false before this phase began |
| 13 | **GREEN** | Divergences 14-18 are in `docs/design-system/V2-ADDENDUM.md` §7a, the section header's count is updated from thirteen to eighteen, the two owner-approved divergences from *this phase's own plan* (commit `79bda50`) are recorded beneath the table, and the midnight-wrapping hour window is recorded in the same section's non-divergence list. Every file path, line number and figure written into that section was verified against source while writing it |

### Criterion 12 is false as written, and the real rule is narrower

The criterion says *"No Convex function throws a plain `Error`; every thrown failure is a
`ConvexError` via `accessError`."* `grep -rn "throw new Error" convex/*.ts convex/lib/*.ts` returns
**eleven** sites in non-test modules:

| Site | Condition | Reachable by a caller? |
|---|---|---|
| `convex/auth.ts:18` | `SITE_URL` unset | No — module scope, fails the deploy |
| `convex/email.ts:59` | `sendEmail` given no recipients | No — a caller bug, not an input |
| `convex/billing.ts:574` | unhandled `MembershipEffect` | No — a `never` exhaustiveness check |
| `convex/polar.ts:129` | required `POLAR_*` variable missing | No — user-facing actions call `polarEnvProblem()` first |
| `convex/polar.ts:205` | `POLAR_SERVER` names neither instance | No — same |
| `convex/polar.ts:270` | `SITE_URL` unset | **Yes, in one of two callers** — see below |
| `convex/teams.ts:686` | `SITE_URL` unset | **Yes** — inside the `invitePlayer` mutation |
| `convex/reminders.ts:102` | `SITE_URL` unset | No — cron only, deliberately hoisted above the claim loop |
| `convex/e2eSeed.ts:37`, `:119` | not in E2E test mode | No — e2e-only modules |
| `convex/testOtps.ts:37` | not in E2E test mode | No — same |

Most of these predate Phase 6. `convex/reminders.ts:102` is this phase's, and it is deliberate.

**The rule the codebase actually follows** — and the one worth writing down in place of the
criterion — is:

> Anything **a caller sees** must be a `ConvexError` carrying a code, via `accessError`.
> Operator-facing failures with no user-facing caller correctly use a plain `Error`, so that they
> fail loudly in the logs.

That distinction is load-bearing rather than stylistic, and for a reason this repo has already
been bitten by: a plain `Error`'s message is **redacted in production**, while `convex-test`
**never** redacts — so a test can read a message the user will never see, and no test can catch
the mistake of putting a user-actionable sentence in a plain `Error`. `ConvexError`'s `data`
survives redaction, which is why every code the UI switches on travels that way.

**Two user-facing paths do violate the real rule**, both conditioned on exactly one thing —
`SITE_URL` missing from a live deployment:

- `convex/teams.ts:686`, inside the `invitePlayer` **mutation**. The check is at the top level of
  the handler, so the plain `Error` propagates to the client.
- `convex/polar.ts:270` via `getCustomerPortalUrl`, where `const returnUrl = siteUrl()` at
  `:653` sits **outside** every `try` in the handler. The other caller, `createProCheckout`, is
  safe by accident of placement: its `siteUrl()` call at `:431` is *inside* the try, so the
  failure is caught and returned as `{ url: null, reason: 'error' }` rather than thrown.

Neither is triggerable by user input — both require an operator to have removed `SITE_URL` from a
running deployment, which `convex deploy` itself will not let you ship into (`auth.ts:18` throws at
module scope). In that state the user sees a redacted server error and the operator sees the real
message in the logs, which is arguably the intended outcome. But it **is** an exception to the
rule as stated, it is not currently written down anywhere, and the audit should know it exists
rather than discovering it. Filing it is Phase 7's call, not a Phase 6 fix.

### What still needs the owner

Three criteria cannot close from a terminal, and none of them should be marked green on anyone's
reasoning:

1. **Criterion 3** — set `REMINDERS_ENABLED=true` and a single-address `REMINDERS_ALLOWLIST` on
   beta, wait for the hour, and confirm the email arrives at the right local time with no
   Supabase URL in it. Both variables are deliberately unset today.
2. **Criterion 4** — subscribe on a real phone against beta, receive one push, and tap it.
3. **Criterion 9** — install from beta to a phone home screen and confirm it opens standalone.

`wt-ksh.4`'s done-when — the owner's side-by-side comparison on a real phone — is in the same
category and is **not** closed by this task.


## Task Breakdown

Sequential unless noted. One implementer per task, reviewed before closing, and reviewers run
serially.

| # | Task | Done when |
|---|---|---|
| 0 | Bring `feat/v2-replatform` up to date with `origin/main` | The branch is 0 behind; `wordle-teams-465` and `-5r9` closed as already-merged |
| 1 | **S1** — `Intl` timezone support on Convex's runtime | A beta query formats an instant in `Australia/Sydney` correctly, output pasted into the issue |
| 2 | **S3** — PWA plugin builds and `/sw.js` is served | `curl` against beta returns the worker with a JS content type at root scope |
| 3 | `convex/lib/reminders.ts` + tests | Every Layer 1 export exists and its tests pass, including the half-hour-offset and local-midnight cases |
| 4 | `pushSubscriptions` schema + `e2ePrune` coverage | Table pushes; prune test deletes a subscription with its player |
| 5 | `convex/settings.ts` + `mySettings` | Four mutations and the query, each on `requirePlayer`, tested through `convex-test` |
| 6 | Settings UI — menu, dialog, both tabs | e2e persists timezone, time and the Email toggle across a reload |
| 7 | Silent `timeZone` / `hasPwa` capture | A fresh v2 account has a `timeZone` after one authenticated load |
| 8 | `reminderEmails.ts` + `lib/html.ts`; re-host both images | Both parts render, hostile input is escaped, no Supabase URL remains |
| 9 | `convex/crons.ts` + `sweep` + email delivery | All six `convex-test` eligibility cases pass; a real email arrives on beta |
| 10 | **S2** — `web-push` under `'use node'` | One real notification reaches the owner's device from a beta action |
| 11 | `push.ts` + `pushSend.ts` + prune-on-410 | Delivery works for a player with several subscriptions; a dead endpoint is removed |
| 12 | Push switch in the UI | Permission flow, subscribe, and the denied path each behave; e2e covers subscribe |
| 13 | `src/sw.ts` — precache, NetworkOnly, offline, push, cache purge | AC 4, 9, 10 hold on beta |
| 14 | Divergence record + close-out | Divergences 14-18 written; `wt-ksh.7.1` and `wordle-teams-bpt` resolved |

Tasks 1 and 2 have no dependencies and are the only pair that may run in parallel. Task 10 gates
11-13; if `web-push` cannot run on Convex, the push half is redesigned before any of it is built.

### On task 0

`feat/v2-replatform` is **31 commits behind `origin/main`** and 372 ahead, measured with
`git rev-list --left-right --count origin/main...HEAD`. The gap is entirely v1 work — login fixes,
Sentry noise filters, `src/lib/score-day.ts`, and the CI pinning — plus `.gitignore` and
`.beads/issues.jsonl`.

Nothing in Phase 6 depends on any of it. It is task 0 because the gap only widens, because the
branch must reconcile with `main` at cutover regardless, and because doing it now means doing it
while the diff is 31 commits of unrelated v1 work rather than at the end of a phase alongside
everything this one adds.

**`.beads/issues.jsonl` will conflict.** The pre-commit hook at `.beads/hooks` re-exports the whole
tracker on every commit, so both sides have rewritten that file continuously. `wordle-teams-465`'s
notes record the resolution used last time: take one side wholesale rather than merging it by
hand. Do not reach for `--no-verify` to dodge the hook — it also chains to the PII guard for this
public repo.

**This task must not be bundled with any other.** A merge of this size wants its own commit and
its own four green gates, so that a later bisect can tell v1 drift apart from Phase 6 work.

The two CI issues are closed as part of this task, with a note that the fix arrived via #158/#159
rather than through Phase 6 — they were not fixed here, only observed to be already fixed.

## Gotchas Carried Into This Phase

- **Run everything from inside `v2/` except git, and give every gate its own `cd v2`.**
- **Never pipe a gate.** zsh `PIPESTATUS` is empty; use a file and `echo $?`.
- **Mutation-testing extractions must `git add` new files first** — `git archive` and
  `git stash create` see only tracked files, and a missing new test file produced a false PASS.
  Assert the extraction's test count matches the live tree's.
- **Do not use `--no-verify`.** `core.hooksPath` is `.beads/hooks`; the hook exports
  `issues.jsonl` and chains to the PII guard for this **public** repo. No user emails in beads.
- **Do not commit while a subagent runs.** Queue controller commits.
- **Hand-written Convex modules import with an explicit `.ts`; generated modules
  (`./_generated/*`) take no extension.**
- **e2e drives the local backend** at `http://127.0.0.1:3210`, not beta, and a `convex dev` watcher
  has been running since 2026-08-18 — it is what pushes Convex changes to that backend. Without
  it a Convex-side change is invisible to e2e entirely.
- **A frozen local Convex backend is invisible to all four gates** (`wordle-teams-lvv`). If e2e
  behaves impossibly, check the backend accepts a push before debugging code.
- **The "CI installs both CLIs at `version: latest`" warning is out of date, in two ways.** All
  three Supabase workflows pin `2.114.0` on `main` and `dev` (PRs #158, #159, commit `33b07b9`);
  this branch only appears unpinned because it is 31 commits behind, which task 0 fixes. And there
  is no Convex CLI in CI at all — `deploy-v2.yml:91` runs `pnpm exec convex deploy` from the
  `convex` package pinned in `v2/package.json`. The check itself regenerates
  `src/lib/database.types.ts`, a v1 Supabase file that this phase never touches.
- **A commit can falsify a comment it writes**, in the same commit, sometimes in another file.
  Sweep comments you write, not only ones you find. Comment accuracy is a defect here, not a nit.
- **Measure, do not reason.** Across Phase 5 the plan's prose held up and its code was wrong every
  time it was checked — fourteen snippets. Write snippets you have run, or mark them unverified.

## Operational note

Phase 5 is not closed. Its twelve implementation tasks are done and deployed, but the sandbox
verification pass (`wordle-teams-02c`) has not run and it is blocked on a test account
(`wordle-teams-6tp`). Phases 5 and 6 are independent by design — `2026-07-16-replatform-v2-design.md`
says so explicitly — so this phase proceeds. Phase 7 is blocked on both.

Standing authorization: push `feat/v2-replatform` and let it deploy to beta without asking, and
watch each deploy with `gh run watch`. Not prod, not main. Subagents never push.
