# Cutover runbook — v1 (Vercel/Supabase) → v2 (Cloudflare/Convex)

**Phase 8 (`wt-ksh.9`) executes from this file.** It is written to be followed at
6am without reading anything else, so the facts are inline rather than cited.
Where a step says STOP, stop.

The deployment that becomes production is the one beta already runs on —
Convex `fabulous-goldfish-949`, Cloudflare Worker `wordle-teams-v2`. **Nothing
is created at cutover.** The domain moves and the configuration changes.

**Written 2026-09-02 by Phase 7 Task 20.** It supersedes the runbook prose in
`wt-ksh.9`'s description, two bullets of which are now factually wrong — see
§7.3 for what changed and why, if you want to know before trusting this.

> **PHASE 7.5 LANDS BEFORE THIS RUNBOOK RUNS** (owner's decision, 2026-09-02).
> `wordle-teams-wty4` moved the seven post-v2 roadmap epics inside the v2
> release, so v2 and all seven go live in one flip and the announcement email
> covers everything at once. `wt-ksh.9` is now blocked by it.
>
> **What that adds to the day:** the features in Phase 7.5 are part of what goes
> live here, so §5's smoke test covers them too, and §1.3's dry run should
> happen after they have landed rather than before. Nothing else in this file
> changes — the flip, the copy and the rollback are the same either way.

---

## 0. THE MEASUREMENT RULE — read this before anything else

Every environment check below is run under time pressure with DNS waiting, and
there are **two ways to read the wrong machine, both silent**.

**1. `convex env --prod` can talk to your LOCAL backend and report success.**
It resolves "prod" from `CONVEX_DEPLOYMENT` in `v2/.env.local`, which on a dev
box is `anonymous:anonymous-v2`. On 2026-09-01 a bare
`npx convex env get SITE_URL --prod` returned `http://localhost:3000`.

> **Read the sentinel first, in every shell, before believing anything else:**
>
> ```
> cd v2 && npx convex env get SITE_URL --prod
> ```
>
> It must print the production origin. If it prints `http://localhost:3000`, you
> are talking to the local backend and **every other reading in this document is
> worthless.** Load the production `CONVEX_DEPLOY_KEY` and try again.

**2. `convex env get` exits 0 whether or not the variable exists.** Verified:
`E2E_TEST_MODE` absent, exit code 0, with `Environment variable "E2E_TEST_MODE"
not found` on stdout. **Match the TEXT, never the exit code.** Any check in this
runbook whose evidence is an exit status is not evidence.

---

## 1. Pre-cutover week

- [ ] **1.1 — Register production OAuth callbacks for all four providers.**

  better-auth's shape is `https://<site>/api/auth/callback/<providerId>` — **no
  version segment, provider id on the END.** Supabase/v1 used
  `https://<ref>.supabase.co/auth/v1/callback`, which is the opposite shape in
  both respects. Mixing them cost most of a day across four consoles.

  Provider ids: `google`, `microsoft` (**not** `azure` — that is the v1/Supabase
  name), `github`, `discord`.

  ```
  node v2/scripts/check-oauth-callbacks.mjs https://wordleteams.com
  ```

  **THAT SCRIPT CAN ONLY PROVE GOOGLE.** Only Google validates `redirect_uri`
  *before* login; microsoft, github and discord validate *after* authenticating,
  so the script reports them UNVERIFIED and **a provider reaching its login
  screen proves nothing about its callback.** Sign in with each of the other
  three by hand.

  **Microsoft spans 12 tenants** (`wordle-teams-bnv`), each with its own consent
  policy. One tenant consenting does not mean the rest will.

- [ ] **1.2 — Point Polar's webhook at the production origin.**

  The URL is on **`.convex.site`, NOT `.convex.cloud`** — Convex serves
  httpActions from the `.site` host. Today:
  `https://fabulous-goldfish-949.convex.site/polar/webhook`. The deployment does
  not change at cutover, so **this URL does not change either.** Confirm it is
  registered and live:

  | Probe | Expected |
  | --- | --- |
  | `POST`, no `webhook-id` header | **400** |
  | `POST`, bogus signature | **403**, body `Invalid signature` |

  A **500** means `POLAR_WEBHOOK_SECRET` is missing on the deployment — the 400
  is the proof it is set and reaching the code (`convex/http.ts:130` reads the
  secret *before* the `webhook-id` header at `:154`). Verified set on
  `fabulous-goldfish-949` on 2026-09-01.

- [ ] **1.3 — One full dry run: copy + verify, no DNS flip.** §4.2–§4.4 exactly
      as written, against beta, the week before. The cutover window is not where
      you want to discover the copy's shape for the first time.

- [ ] **1.4 — Resolve the paying customer by hand.**

  There is **no active Polar subscription** right now: the one paying customer
  rides an unbounded `pro` grace period with nothing behind it
  (`wordle-teams-g3k`). Whatever state exists at cutover must SURVIVE it, which
  is an **identity-mapping check, not a re-subscribe** — every migrated user
  already exists as a Polar customer under their email.

- [ ] **1.5 — Confirm `/me` against a REAL INSTALLED PWA.**

  **This is the one check that cannot be done after the flip, and it is the one
  with no second chance.** v1's `src/app/manifest.json:30` sets
  `"start_url": "/me"`, and **an installed iOS PWA does not adopt a new
  `start_url` from a re-fetched manifest** — every production user who installed
  the app has that path burned in. Install from v1 *now*, keep the install, and
  after the flip confirm it still opens correctly.

  `v2/src/routes/me.tsx` redirects `/me` → `/app` **carrying the query string**,
  because v1's checkout sets `successUrl: .../me?checkout=success` and a checkout
  in flight across the window comes back to it.

  Note it answers **307**, not a permanent redirect, despite the route file and
  the phase docs calling it permanent (`wordle-teams-cog5`). It works either way;
  decide before the flip whether you want 301.

---

## 2. Convex environment on the production deployment

Sentinel first (§0). Then, on `fabulous-goldfish-949`:

| Variable | Required value | Why |
| --- | --- | --- |
| `SITE_URL` | the production origin | `wordle-teams-cd8` |
| `E2E_TEST_MODE` | **not set** | `wordle-teams-7az` — see below |
| `REMINDERS_ENABLED` | `true` | the only thing that starts reminders |
| `REMINDERS_ALLOWLIST` | **unset/empty** | unrestricted IS the production setting |
| `POLAR_ACCESS_TOKEN` | production | move as a SET — see below |
| `POLAR_WEBHOOK_SECRET` | production | |
| `POLAR_PRO_MONTHLY_PRODUCT_ID` | production | |
| `POLAR_PRO_ANNUAL_PRODUCT_ID` | production | |
| `POLAR_SERVER` | `production` | currently `sandbox` |

- [ ] **2.1 — `E2E_TEST_MODE` must be unset, and RE-CONFIRMED AFTER THE FINAL
      COPY.** Twice, not once.

  It was measured unset on 2026-09-01. That is not sufficient: the risk is the
  gap — somebody sets it to run e2e against beta between now and cutover and
  nobody clears it. If it survives, two public mutations (`testOtps.takeFor`,
  `e2eSeed.ensureTeamFor`) become live unauthenticated write paths, **and**
  `isE2eTraffic` silently suppresses sign-in codes and team invitations for every
  `e2e+*@wordleteams.com` address **with no error raised anywhere** — the invite
  still parks in `teams.invited` and `invitePlayer` still reports success. The
  person simply never hears anything.

  Match the "not found" text, not the exit code.

- [ ] **2.2 — The five `POLAR_*` move TOGETHER, or not at all.**

  Polar's sandbox is a **wholly separate instance** — separate accounts,
  organizations, products and tokens. Flipping `POLAR_SERVER` to `production`
  without the token and both product ids sends real subscribers to an instance
  holding none of their data. `POLAR_SERVER` must be exactly `production` or
  `sandbox`; `assertPolarEnv` validates all five together and names every missing
  one, so the first checkout after cutover is a complete test that fails loudly.

  **Scopes are a different thing from variables.** The token needs four, one per
  SDK call site in `convex/polar.ts`: `checkouts:write` (`:426`),
  `customer_sessions:write` (`:658`), `checkouts:read` (`:740`),
  `customers:write` (`:799`).

- [ ] **2.3 — `REMINDERS_ENABLED=true` is the last switch you throw, and it is
      irreversible in effect.**

  It is the only thing between a config slip and mailing every copied production
  row. It is **OFF on beta and that is its designed resting state** — the cron
  fires hourly and returns having done nothing. Turn it on only after §5's smoke
  test passes.

  **On BETA the opposite rule holds and must keep holding:** if beta is ever
  given `REMINDERS_ENABLED`, `REMINDERS_ALLOWLIST` goes in **first, in the same
  sitting**, because beta holds copied production rows and `E2E_TEST_MODE` is not
  set there, so `sendEmail`'s throwaway-address filter suppresses nothing.

---

## 3. Worker and DNS configuration

- [ ] **3.1 — `ENVIRONMENT` must become `production`.** It is a wrangler var in
      `v2/wrangler.jsonc`, currently `"beta"`. Every LogSnag funnel event is
      tagged with it, so leaving it mistags all production analytics. Check with:

  ```
  curl -sI -X POST -d '{"name":"login_view"}' https://wordleteams.com/api/funnel
  ```

  and read the `x-funnel` header — `sent` | `skipped` | `dropped`.

- [ ] **3.2 — `MAINTENANCE` set to `"false"`** in `wrangler.jsonc` (it is a
      string compared to exactly `"true"`). See §4.1 for the flip itself.

- [ ] **3.3 — Routes and the custom domain.** `wrangler.jsonc` carries
      `beta.wordleteams.com` as a `custom_domain`. Add the apex.

  **A wildcard `*.wordleteams.com` A record points at Vercel.** An explicit
  record outranks it — but **if any hostname ever serves a Vercel 404 again,
  suspect that wildcard first.** It is the reason beta resolved before it existed.

- [ ] **3.4 — The `noindex` needs NO action, and that is deliberate. Verify it
      rather than change it.** Beta sends `X-Robots-Tag: noindex, nofollow`;
      production must not, and **it is the same deployment** — which is exactly
      why this is keyed on the REQUEST HOSTNAME rather than on the `ENVIRONMENT`
      var (`v2/src/lib/robots-policy.ts`, `wt-ksh.8.54`). A var is a property of
      the deployment and cannot tell two hostnames apart on the day this Worker
      answers on both; the hostname can, so the apex is indexable the moment it
      is added and beta stays suppressed, with nothing to flip.

      **It is a deny-list and must stay one.** An unrecognised host is
      indexable. The two mistakes are not equals: indexing beta is recoverable
      through Search Console, while noindexing production removes the site from
      search silently. If anyone ever rewrites this as "index only on
      wordleteams.com", the catastrophic outcome moves one typo away.

      Confirm both directions AFTER the apex is live — the second command is the
      one that matters:

  ```
  curl -sI https://beta.wordleteams.com/  | grep -i x-robots-tag   # noindex, nofollow
  curl -sI https://wordleteams.com/       | grep -i x-robots-tag   # NOTHING
  ```

      **Static assets are not covered.** `/favicon.ico` and `/opengraph-image.png`
      are served by the Workers assets layer without entering the Worker, so
      they remain indexable on beta. The exposure `wt-ksh.8.54` was filed about
      is the marketing documents, which are covered.

- [ ] **3.5 — Browser Cache TTL must still be "Respect Existing Headers".**
      Caching -> Configuration, zone-wide, and therefore inherited by the apex.
      **The default is 4 hours and it overrides a LOWER origin `max-age`**, which
      silently turned the documents' deliberate `max-age=0` into `max-age=14400`
      until it was changed on 2026-09-02 (`wordle-teams-g1cd`).

      This matters because a browser cache is the one copy the version-keyed
      edge key in `src/server.ts` cannot reach: at four hours, a fix shipped on
      cutover day would be invisible to anyone who had loaded the page in the
      previous four. **Nothing in the repository can assert this** — it is
      dashboard state — so it is a check here or it is nowhere.

  ```
  curl -sI https://wordleteams.com/about | grep -i cache-control
  ```

      Expect `max-age=0` with `s-maxage=86400` and
      `stale-while-revalidate=604800` intact. **`max-age=14400` means the
      setting has reverted.** Run it TWICE — the first response is never the
      rewritten one, because the rewrite only applies to what Cloudflare
      serves from cache.

---

## 4. Cutover day

### 4.1 — Maintenance mode is ONE step, and it is a deploy

**Corrected 2026-09-04.** An earlier version of this section said two steps —
flip the var, then purge the Cloudflare cache. **There is nothing to purge**, and
the reasoning is in `wt-ksh.8.52`, which closed not-applicable after the outage
drill measured it. What that section got wrong is worth one paragraph, because
the wrong version is the intuitive one:

`/` is the only path that is both gated and cacheable, so the fear was a cached
landing page outliving the flag — true of a **CDN edge cache sitting in front of
a Worker**, which is not what shipped. `wt-ksh.8.45` measured that `s-maxage` on
a Worker response reaches no Cloudflare edge cache at all, and
`wordle-teams-fqeq` bought the caching back a different way: documents are stored
through the **Cache API, inside the fetch handler.** That is a store the Worker
*consults*, not a layer in front of it, so **the Worker runs on every request** —
and `src/server.ts` consults it strictly downstream of the gate
(`withMaintenanceGate` delegates to `withCachePolicyOnDocuments` only when the
request is NOT gated, and `cache.match` lives inside the latter). A stored `/`
**cannot** outlive the flag.

- [ ] Set `MAINTENANCE` to the exact string `"true"`. Only `"true"` turns it on
      — `"True"`, `"1"` and `"yes"` all leave the site UP, which is the safe way
      for this to be wrong.

**BUDGET FOR A VERSION ROLLOUT, NOT A FIELD EDIT.** A Worker var is part of a
VERSION, not a value hanging beside one, so the Cloudflare dashboard offers no
Save — editing `MAINTENANCE` and confirming **mints and deploys a new version**,
and the button says Deploy. This surprised the owner mid-drill on 2026-09-04. It
is the one place this is worse than v1's Edge Config, where the value changed
with no deploy at all.

> **A DEPLOY FROM THE REPO SILENTLY ENDS THE OUTAGE.** `vars` in
> `wrangler.jsonc` carries `"false"`, so the next `wrangler deploy` overwrites
> whatever the dashboard holds. That is deliberate — the site cannot stay dark
> because someone forgot to flip back — but it means **the dashboard is the ONLY
> thing holding maintenance on.** Do not ship a routine deploy during the window
> and expect the maintenance page to survive it.

- [ ] Confirm: every gated path answers **307** to `/maintenance`, and the 307
      carries `private, no-store` with no `s-maxage`. Measured on beta
      2026-09-04 with `/` warm (`x-doc-cache: HIT`, `age: 12`) immediately
      before the flip: all five gated paths 307'd, all four static pages stayed
      200.

**What actually remains is client-side, and no purge reaches it.** `/` ships
`stale-while-revalidate=604800`, so an individual visitor's OWN browser may serve
them the pre-outage landing page while it revalidates. It self-corrects on the
next navigation and the blast radius is one visitor rather than everyone — a
property to know about, **not a step to run.**

### 4.2 — The final copy

- [ ] **Run it WITH `--with-reminders`. This flag is the whole restoration.**

  ```
  cd v2 && node --env-file=../.env.production.local --env-file=<beta convex env> \
    scripts/copy-from-supabase.mjs --scope=all --with-reminders
  ```

  Every copy before this one **deliberately withheld** `timeZone` and
  `reminderDeliveryMethods` (`wt-ksh.7.32`), so that a Phase 7 re-copy could not
  switch reminders on for someone who does not know beta exists. The banner
  states which mode it is in, in both directions — **it must say `CARRIED` on
  this run.** Without the flag, every player arrives with reminders off.

  The other three reminder fields crossed all along: `lastBoardEntryReminder`
  (which *suppresses* a same-day send — withholding it would have made an
  unwanted reminder more likely), `reminderDeliveryTime` and `hasPwa`.

  **Prerequisite:** `supabase.co` must resolve. It was blocked by network DNS
  filtering on the dev box on 2026-09-01 — `supabase.com` and everything else
  resolved, only `supabase.co` was dropped. The error names a **different table
  each run** (`readScoped` races its reads and reports whichever loses first) and
  survives switching Node versions, so it looks like a flaky timeout or a Node
  issue and is neither. **Check `resolvectl query supabase.co` first.**

- [ ] **This run DISCARDS beta team and player state on purpose.** Owner's
      decision, 2026-08-24: everything in the beta deployment is testing data
      permanently, including rows created by anyone brought in to help test. **It
      reads like data loss and is not.**

      Which rows, because it is easy to get backwards: a row **born in v2 is
      SAFE** — no `legacyId`, and `byLegacyId` is the whole upsert key for
      `players` and `teams`. What a re-run reverts is a **copied** row v2 later
      edited. `monthlyWinners` is the exception: it matches on
      `(teamId, year, month)`, so a winner row v2 computed itself IS adopted and
      overwritten.

### 4.3 — Read the overwrite report AT FIELD LEVEL

Table level is a check that cannot fail. Only `players`, `teams` and
`monthlyWinners` can ever appear at all — anything without a `clobbered` key is
routed to "Not diffed" — so "nothing else" means **no unexpected FIELD on those
three**, not no fourth table.

**EXPECTED — beta state being discarded. Do not stop:**

- `teams`: `name`, `playWeekends`, `showLetters`, `playerIds`, `invited`. Any
  subset is ordinary.
- `players`: `timeZone`, `reminderDeliveryMethods`, `reminderDeliveryTime`,
  `hasPwa`, `lastBoardEntryReminder`.
- `monthlyWinners` on an **adopted** row: `legacyId` always moves;
  `playerId` only if v1's winner differs; `hasSeenCelebration` only if the
  seen-lists differ as multisets. `teamId`/`year`/`month` are the match key and
  cannot differ.

**STOP AND READ before the DNS flip:**

- [ ] **`teams.owner`** — insert-only in v2, so a count here is never a lost v2
      edit. It means the copy is **changing which player owns a team**.
- [ ] **`teams.scoring`** (eight base fields, reported as one) — always v1-side,
      and **possibly the most consequential count in the report.** An imported v1
      scoring edit lands as the team's BASE system, and any month with no
      `scoringSystems` version preceding it falls back to exactly those fields —
      so the import **retroactively re-scores every month before v2's first
      version row and can change who won one** (`wordle-teams-1j3`).
- [ ] Anything not on the expected list.

The report **cannot tell you who wrote the value it replaced.** A clobber means
only that the incoming v1 value differs from the stored one — a lost v2 edit *or*
v1 drifting since the last copy.

### 4.4 — Adjudicate the insert report (resurrection)

A row v2 **deleted** leaves the overwrite report nothing to diff against, so it
returns counted as `inserted`. The insert block makes that visible; **it does not
attribute it.** Work the gates IN ORDER — starting at the per-table list gives the
wrong answer and sends you deleting rows the copy legitimately just wrote.

- [ ] **GATE A — is this actually the same copy run again?** Not if: the previous
      copy died partway (whole tables at full size), the `--scope` or `ME_EMAIL`
      changed, this is the first copy into a deployment already holding v2-born
      rows, or `purgeCopiedData` was run **but not looped** (it deletes ~800 per
      call and returns `remaining:true`). In every one of these there is
      **nothing to delete**.
- [ ] **GATE B — did the skip filters' inputs move?** A nameless v1 player given
      a name, or a memberless team that gained a member, is a legitimate
      first-time insert of an OLD row. Compare both "Skipped" counts against the
      previous run.
- [ ] **GATE C — only with A and B ruled out:** does v1 hold the row with a
      `created_at` AFTER the previous copy? If v1's newest rows in that table all
      predate it, the copy re-inserted an old row — v2 had deleted it.

  **Deleting on gate C alone is the dangerous mistake here:** a resumed partial
  copy fails gate C for every row it wrote.

If you confirm a resurrection: delete the row in Convex by hand, **after the copy
and before the DNS flip**, then re-read the counts. There is no tombstone.

### 4.5 — Verify

- [ ] ```
      cd v2 && node scripts/verify-parity.mjs --scope=all
      ```
      **Counts come from `countTable`, which loops across transactions and is not
      a consistent snapshot.** If a count is off by one or two, **re-run before
      believing it.**

### 4.6 — Flip DNS, then switch the configuration

- [ ] DNS to the Worker (see §3.3 on the wildcard).
- [ ] `ENVIRONMENT` → `production` (§3.1).
- [ ] `X-Robots-Tag` verified in BOTH directions — present on beta, absent on the
      apex (§3.4). No change to make; this is a check, not a step.
- [ ] Browser Cache TTL still "Respect Existing Headers"; `/about` returns
      `max-age=0` on a SECOND request, not `max-age=14400` (§3.5).
- [ ] All five `POLAR_*` → production, as a set (§2.2).
- [ ] `SITE_URL` → production origin.
- [ ] `MAINTENANCE` → `"false"` (§4.1). One step; there is nothing to purge.
- [ ] **Re-confirm `E2E_TEST_MODE` is still unset** (§2.1). This is the second of
      the two checks.

---

## 5. After the flip

- [ ] **5.1 — Smoke test by hand:** OTP sign-in, each of the four social
      providers, board entry, the scoreboard, the PWA.
- [ ] **5.2 — The `/me` PWA install from §1.5 still lands correctly.**
- [ ] **5.3 — Re-run the parity harness against production:**
      ```
      cd v2 && node scripts/parity-routes.mjs --beta=https://wordleteams.com
      ```
      Compare against `docs/superpowers/audits/2026-09-01-parity-routes.md`.
      Known differences live in `V2-ADDENDUM.md` §7a, and **anything not in that
      table is a bug.**

      **DO NOT TRUST A COUNT WRITTEN ANYWHERE ELSE, INCLUDING THIS FILE.** This
      line said "forty-three of them" until 2026-09-04, when the table held
      SIXTY — so an operator working from it would have treated seventeen
      deliberate divergences as defects, at 6am, with DNS waiting. That number
      has now drifted three times (`wordle-teams-4m2t`), which is why
      `src/addendum-divergences.test.ts` pins the count INSIDE the addendum and
      why this runbook no longer restates it. **Read it off the file:**

      ```
      grep -c '^| [0-9]' docs/design-system/V2-ADDENDUM.md   # rows in all tables
      ```

      or just open §7a — its own header states the count, and CI fails if that
      header and its table disagree.
- [ ] **5.4 — BEFORE reminders go on: count who became eligible, and compare
      against v1.** `wordle-teams-k501`, settled here on 2026-09-04.

  **`--with-reminders` does NOT overwrite `timeZone` for every copied player**,
  which is the assumption this check exists to catch. `copy-reminder-policy.mjs`
  sends the zone only when production HAS one
  (`...(row.timeZone !== undefined ? { timeZone: row.timeZone } : {})`) — it
  omits the key otherwise, and `upsertPlayers` does `db.patch`, so **a zone
  written onto a beta row survives the final copy.** 17 of 392 copied players
  carried one on 2026-09-04, from early `--scope=mine` runs and from
  `use-local-capture.ts`, which writes a zone on sign-in to any player lacking
  one.

  That is inert today because no copied player holds a delivery method. **It
  stops being inert at cutover**, when the copy brings production's methods
  across: a player who has methods in v1 but **no `time_zone`** gets nothing from
  v1 — `get_players_for_reminder()` is `WHERE time_zone IS NOT NULL` — yet in v2
  the beta-captured zone completes the pair and the sweep claims them. That is a
  reminder **v1 has never sent**, to a real person, on the one switch §2.3 calls
  irreversible in effect.

  ```
  cd v2 && CONVEX_URL=<production> CONVEX_MIGRATION_KEY=<key> \
    node scripts/verify-reminder-policy.mjs
  ```

  **Its pass condition INVERTS at cutover and the script does not know that.** It
  exits non-zero if a copied player could be swept, which is correct every day
  until this one and wrong today — after the final copy, a non-zero
  `sweepEligible` on copied rows is the entire point. **Read the number, not the
  exit code.** Compare it against v1:

  ```
  select count(*) from players
   where time_zone is not null
     and reminder_delivery_methods is not null
     and array_length(reminder_delivery_methods, 1) > 0;
  ```

  - **v2 `sweepEligible` ≤ v1's count** is expected and fine. It can be lower
    because v2 filters to methods the sweep acts on while v1 counts any
    non-empty array.
  - **v2 higher than v1 is the alarm, and the excess is exactly this
    population.** Clear `timeZone` by hand on those players before flipping
    `REMINDERS_ENABLED`, and know that a later sign-in re-adds it — which is why
    this is a measurement at cutover rather than a cleanup beforehand.

- [ ] **5.5 — Only now, `REMINDERS_ENABLED=true`** (§2.3).
- [ ] **5.6 — Watch the deploy's EFFECT, not its green.** For a Convex change
      that is the "Deploy Convex and build the client" step. And **`gh run list
      --limit 1` right after a push returns the PREVIOUS run** — select by SHA.

**Shipping a corrected document is not instant, and §8b is the detail.** The
EDGE half is handled by construction — the Cache API key carries the Worker
version id, so a new deployment misses rather than needing a purge — **but that
rotation is not yet measured end to end** (`wordle-teams-fv2s`; an accidental
natural experiment on 2026-09-04 was ambiguous). The BROWSER half is not handled
and is accepted: `stale-while-revalidate=604800` lets a returning visitor see one
stale view. **If a corrected page appears not to ship, read §8b before debugging
it** — that is the failure mode `wt-ksh.8.46` was filed to prevent.

---

## 6. Rollback

The flip is DNS, so rollback is DNS. v1 on Vercel is **untouched by this entire
process** — the workflow that deploys v2 shares a repository with it and nothing
else.

- [ ] Point DNS back at Vercel.
- [ ] **v1's Supabase data is authoritative and was only ever READ.** The copy is
      read-only against Supabase, so no rollback of source data is required or
      possible.
- [ ] Set `MAINTENANCE` back to `"true"` on the Worker if you want the v2
      hostname to stop serving (§4.1). Remember it is a deploy, and that a
      later `wrangler deploy` resets it to `"false"`.
- [ ] Anything written into v2 *after* the flip does not exist in v1 and does not
      come back. That window is the real cost of a late rollback — keep it short.

---

## 7. Facts that were wrong in an earlier version of this runbook

Recorded because each was believed, written down, and acted on.

**7.1 — "Nothing in v2 deletes from `players` or `playerMembership`."** False
since `convex/e2ePrune.ts` landed: it deletes from `playerMembership` (`:361`),
`players` (`:378`), `dailyScores` (`:338`), `monthlyWinners` (`:351`) and
`pushSubscriptions` (`:372`). The **conclusion** still holds — an unexpected
insert into `players` is still a new v1 signup — but not for the stated reason.
It is safe by two independent halves: `pruneBatch` is an `internalMutation`, and
it throws unless `E2E_TEST_MODE === 'true'` (`:183`). **If that flag survives
onto production, this guarantee is void.**

**7.2 — `cascadeDeleteTeam` has FOUR reachable callers, not two.**
`deleteTeamFor`, `leaveTeamFor`'s last-member case, `e2ePrune.ts`, and
`billing.ts`'s `downgradeTeamRemovalFor`. The last matters differently: a team it
deletes carries a `legacyId`, so a later copy re-inserts it — and **it fires from
a Polar webhook rather than from a person**, so it can happen during a
dual-running window with nobody watching. ("creator" is also a stale field name;
the Phase 5 rename made it `owner`.)

**7.3 — The `db.delete` hit count is not a constant.** It printed fourteen on
2026-08-25, twenty-one on 2026-08-26, and twenty-six on 2026-09-01 (sixteen
production, ten in `*.test.ts`). **Run `git grep -c "db\.delete(" convex/` on the
day; do not trust any figure written in prose, including this one.**

**7.4 — "Nothing in v2 writes `playerMembership` or `webhookEvents` yet."**
False since Phase 5: `convex/billing.ts` inserts `playerMembership` at `:549` and
`webhookEvents` at `:523` and `:638`.

**7.5 — v1's `/login-error` says the passcode expires in 1 hour.** This
deployment sets `OTP_EXPIRY_SEC = 300` — five minutes — and the email says so.

**7.6 — "Maintenance mode is two steps: flip the var, then purge the Cloudflare
cache."** This runbook said that, `wt-ksh.8.52` was filed for it, and a comment
on `GATED_PATHS` asserted it. It is wrong, and the reason is worth keeping: the
premise ("a cache hit does not invoke the Worker") describes a **CDN edge cache
in front of a Worker**, and what shipped is the **Cache API inside the fetch
handler** — a store the Worker consults, downstream of the gate. The correct
lesson is not "we were pessimistic"; it is that **a caching claim is only as good
as the layer it names**, and this one named the wrong layer for five days. §4.1
has the corrected version.

**7.7 — "The copy carries `reminderDeliveryMethods` and `timeZone` for every
copied player."** A comment in `convex/reminders.ts` said so as justification for
the env gate being the only protection. False since `wt-ksh.7.32`: the policy
module withholds both. But **the correction has a sting in it** — the restoration
is asymmetric. Methods are sent explicitly empty and so are cleared by a re-run;
`timeZone` is merely OMITTED, so a zone written by an early copy or a beta
sign-in **survives every later copy, including the cutover one.** That is what
§5.4 measures.

---

## 8. Known open items at cutover

Not blockers unless you decide otherwise; each is filed.

**Refreshed 2026-09-04.** Six of the seven originally listed here closed during
Phase 7's walk — `wt-ksh.8.45`, `wt-ksh.8.46`, `wt-ksh.8.55`,
`wordle-teams-82zq`, `wordle-teams-d2oc`, `wordle-teams-cog5` and
`wordle-teams-vmya` are all done and are **not** things to check on the day. What
is genuinely still open:

| Issue | What |
| --- | --- |
| `wordle-teams-4yt` | **Owner's call, and legal copy** — see the row below |
| `wordle-teams-fv2s` | The version-keyed cache rotation in §8b is **claimed, not measured.** Only matters if you need a corrected document out the same day |
| `wordle-teams-ao7j` | `GET /api/funnel` returns 200 HTML instead of 404 — a soft 404 masked only by `robots.txt`, which the apex serves differently |
| `wordle-teams-1kiy` | `/manifest.json` is `application/json` where production sends `application/manifest+json` |
| `wordle-teams-k501` | Folded into §5.4 as a step. Do not treat it as a pre-cutover cleanup |

### 8a. Two Polar cases the sandbox pass could NOT reach

Phase 5's sandbox pass (2026-09-03) closed all six acceptance criteria against
observed evidence. **These two were not among them**, and are written here so a
green pass is not read as covering them. Both are pinned by unit tests only.

- [ ] **THE v1-uuid IDENTITY CASE — the one that touches every existing paying
      customer.** A fresh v2 account has no `legacyId`, so the sandbox cannot
      reproduce what happens to a **migrated** subscriber on revocation. The
      dual-namespace lookup in `getCustomerPortalUrl` and the identity
      resolution in `convex/polar.ts` are what carry it, and they are exercised
      by unit tests and by nothing else.

      **This is the highest-risk untested path at cutover**, because every
      current subscriber is exactly this shape: a copied row with a `legacyId`,
      whose Polar customer was created against the v1 uuid. Watch the first real
      revocation after the flip, and check the player is downgraded rather than
      silently missed. `wordle-teams-7xl` already covers confirming the first
      real checkout; this is its counterpart on the other end of the lifecycle.

- [ ] **THE OWNERSHIP-REASSIGNMENT PATH.** `downgradeTeamRemovalFor` reassigns
      `owner: remaining[0]` when a dropped team was one the player owned. Owned
      teams sort FIRST in the keep list, so this only fires for an owner of
      three or more teams — the sandbox account owned exactly the two it kept,
      so the branch never ran. Unit-tested only.

      The consequence if it is wrong is not data loss but a **team nobody can
      administer**: V2-ADDENDUM records that an owner-less team cannot be edited
      by anyone, which is why the code reassigns rather than clearing.
| `wordle-teams-4yt` | **Owner's call, and legal copy:** privacy policy and terms name **Apple and Facebook** as sign-in providers. Neither has ever been offered. The policy also claims a **username** is collected; no such field exists in either codebase. Already wrong in v1, so not a regression — but cutover is when these pages start being served from the new stack |

### 8b. The staleness window after a deploy, and which half is solved

`wt-ksh.8.46` asked for one of three: a purge step in the deploy, a shortened
`s-maxage`, or the window recorded here as accepted. **The first happened by
construction and the third covers what is left**, so this is the record.

**THE EDGE HALF IS SOLVED BY CONSTRUCTION — AND THE MEASUREMENT IS ONE PATH
SHORT.** `wordle-teams-fqeq` keys the Cache API entry on
`CF_VERSION_METADATA.id`, so a new deployment should MISS on every key and render
fresh, with orphaned entries ageing out unread. That is the "purge step" branch
satisfied without a purge, and without a zone token this repo does not hold. A
redeploy on 2026-09-02 returned `x-doc-cache: MISS` against a cache holding the
previous version.

> **`wordle-teams-fv2s` is open on exactly this claim.** On 2026-09-04, two var
> edits (each of which mints a version) left `/home` reporting MISS while
> `/maintenance` — warmed to HIT shortly before, and never gated — still
> reported HIT. **A clean key rotation should have missed both.** Ordinary Cache
> API eviction is the likely explanation for the mixed result, but it was not
> established, and two paths is too few to tell rotation from eviction. Calibration
> from the same session: once warm, `x-doc-cache` is not noisy — 12/12 HIT on
> each path with monotonically advancing `Age` — so the mixed reading is not
> sampling noise. **If you need a corrected document live the same day, do not
> assume the deploy rotated the key; warm several paths, deploy, and check they
> all MISS.**

**THE BROWSER HALF IS NOT, AND IS ACCEPTED.** The header is
`public, max-age=0, s-maxage=86400, stale-while-revalidate=604800`. `max-age=0`
makes the response immediately stale to a browser, and `stale-while-revalidate`
then permits that browser to serve its cached copy **for up to seven days**
while revalidating in the background. No purge, no version key and no deploy
reaches a private browser cache.

**So the worst case is: a returning visitor who loaded a marketing page within
the last seven days sees the old one once, and the correct one thereafter.** It
costs one stale view per visitor per change, not a persistent wrong page.

- [ ] **If a copy fix must be seen immediately by everyone**, shortening
      `stale-while-revalidate` in `v2/src/lib/cache-policy.ts` is the only lever,
      and it has to ship *before* the change it is meant to expedite — a shorter
      window does not shorten one a browser has already been given.

**DO NOT DEBUG A "FIX THAT DID NOT SHIP" FOR A WEEK.** That is the failure mode
`wt-ksh.8.46` was filed to prevent, and it is why this is written down rather
than left to be rediscovered by someone watching a corrected page fail to change.
