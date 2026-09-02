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

- [ ] **3.4 — If beta was ever given a `noindex`, remove it.** Vercel supplied
      `X-Robots-Tag` on previews automatically; Cloudflare supplies nothing, and
      beta serves the full marketing surface on a real hostname
      (`wt-ksh.8.54`). Whatever is decided there, **the production deployment
      must not carry it** — and it is the same deployment.

---

## 4. Cutover day

### 4.1 — Maintenance mode is TWO STEPS, not one

**`wt-ksh.8.52`, and it is the step most likely to be got wrong.**

`/` is the only path that is both gated by maintenance mode and **edge-cacheable**
(`public, max-age=0, s-maxage=86400, stale-while-revalidate=604800`). A cached
landing page **outlives the flag** — the Worker is never invoked, so setting
`MAINTENANCE=true` does not take `/` down.

- [ ] Set `MAINTENANCE` to `"true"` and deploy.
- [ ] **Purge the Cloudflare cache**, or `/` keeps serving to anyone whose edge
      has it. `wrangler deploy` purges nothing.
- [ ] Confirm by fetching `/` from an origin that has not seen it.

The same applies in reverse when you turn it off: purge again, or the "Coming
Soon" page outlives the outage by up to a day.

> **Related, and worth knowing before you rely on any cache behaviour:** a Worker
> response is **not written to Cloudflare's edge cache by default.** That needs
> `caches.default.put`, `cacheEverything`, or a Cache Rule, and **none of the
> three is in the repo** (`wt-ksh.8.45`). So the `s-maxage` win may currently be
> zero — which would make this section moot, and would also mean nothing is
> cached that needs purging. **One `curl` for `cf-cache-status`, run twice,
> settles it.** Do that before deciding how much of this section applies.

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
- [ ] All five `POLAR_*` → production, as a set (§2.2).
- [ ] `SITE_URL` → production origin.
- [ ] `MAINTENANCE` → `"false"`, **and purge** (§4.1).
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
      Known differences live in `V2-ADDENDUM.md` §7a — **forty-three of them, all
      deliberate. Anything else is a bug.**
- [ ] **5.4 — Only now, `REMINDERS_ENABLED=true`** (§2.3).
- [ ] **5.5 — Watch the deploy's EFFECT, not its green.** For a Convex change
      that is the "Deploy Convex and build the client" step. And **`gh run list
      --limit 1` right after a push returns the PREVIOUS run** — select by SHA.

**There is no purge on deploy.** `stale-while-revalidate=604800` with nothing
purging means worst case **eight days between shipping a fix and everyone seeing
it** (`wt-ksh.8.46`). v1 got away with this because Vercel purged ISR;
Cloudflare does not. Purge by hand after any deploy that changes a cacheable
document.

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
      hostname to stop serving, and **purge** (§4.1).
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

---

## 8. Known open items at cutover

Not blockers unless you decide otherwise; each is filed.

| Issue | What |
| --- | --- |
| `wt-ksh.8.45` | A Worker response may not reach the edge cache at all. Settle with `cf-cache-status` before relying on §4.1 |
| `wt-ksh.8.46` | No purge on deploy; `swr=604800` means up to 8 days |
| `wt-ksh.8.55` | `og:url` is the apex on every route; `/` and `/home` are duplicate content with no canonical |
| `wordle-teams-82zq` | `/opengraph-image.png` lost production's immutable 1-year cache |
| `wordle-teams-d2oc` | Redirects carry no `Cache-Control` at all |
| `wordle-teams-cog5` | `/me` answers 307 while the docs say permanent |
| `wordle-teams-vmya` | Invite email's text footer hardcodes the production origin |
| `wordle-teams-4yt` | **Owner's call, and legal copy:** privacy policy and terms name **Apple and Facebook** as sign-in providers. Neither has ever been offered. The policy also claims a **username** is collected; no such field exists in either codebase. Already wrong in v1, so not a regression — but cutover is when these pages start being served from the new stack |
