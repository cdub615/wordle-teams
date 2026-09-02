# Handoff — close Phase 5, then finish Phase 7

**Written 2026-09-02.** Read this whole file and follow it; it is the prompt. You
do not need any previous conversation.

Run `bd prime` first. Branch `feat/v2-replatform`, in sync with origin, tree
clean, four gates green (**1335 tests / 79 files**), e2e **60/60**, last beta
deploy green.

> **Ordering changed on 2026-09-02: cutover is NOT what follows Phase 7.**
> A new Phase 7.5 (`wordle-teams-wty4`) now sits between them — the seven
> post-v2 roadmap epics, moved inside the v2 release so they ship with it. See
> the Phase 7.5 section below before planning anything that assumes Phase 8 is
> next. It does not change this session's scope, but it changes what "done"
> leads to.

---

## The one thing that decides this whole session

**Phase 5 and Phase 7 converge on a single task.** Phase 5 (`wt-ksh.6`) closes
through `wordle-teams-02c`, and `02c` *is* Phase 7's Task 18 (`wt-ksh.8.41`).
They are not two pieces of work.

**And `02c` is blocked on one thing: a fresh non-pro account on beta.** The
owner's account is **comped pro**, so `amIPro` is true, so the Upgrade CTA never
renders and they cannot reach checkout as themselves. What is needed:

> A brand-new account on beta, **not** an `e2e+@wordleteams.com` address (those
> are gated on `E2E_TEST_MODE`, which is unset on beta), with **two teams created
> first** so it sits at the free cap.

**Ask the owner to create that account before planning anything else.** Nothing
in Phase 5's remaining work can proceed without it, and most of Phase 7's
remaining P1s need the owner too.

### The same fact probably answers an open bug

`wordle-teams-jcjj` — "the invite badge is not visible" — is very likely **this
same root cause and not a defect.** `Header.tsx` computes
`showInviteBadge = isPro === false && (pendingInvites ?? 0) > 0`, and a pro
player is deliberately never shown it because accepting an invite *is* the
upgrade. The owner is comped pro. **Check this before investigating anything
else on that issue**; the fresh account above will settle it in the same sitting.

---

## Phase 5 — what is actually left

`02c`'s DONE-WHEN has five clauses. **Three are already finished by Phase 7 —
do not redo them:**

| Clause | State |
| --- | --- |
| Divergence 12 (softened downgrade) written | ✅ §7a row 12 |
| Divergence 8 updated (2-team cap now exists) | ✅ §7a row 8, struck through |
| §7a header count updated | ✅ **43**, reconciled by Task 16 |
| The four blind-spot sites corrected | ✅ all four, the last on 2026-09-02 |
| Delete-site inventories checked | ✅ `wordle-teams-c68` |

**The four blind-spot sites are done and the fourth is worth knowing about.**
`convex/migrate.ts:103` claimed nothing in v2 writes `playerMembership` or
`webhookEvents`; Phase 5's `billing.ts` writes both (`:549`, `:523`, `:638`). It
survived Task 16's sweep because the other three sites phrase it as **deletes**
and that one as **writes**. Fixed 2026-09-02.

**What genuinely remains is the sandbox pass, and only the owner can run it.**

Already verified against real Polar sandbox (do not re-verify):

- The webhook endpoint is live at
  `https://fabulous-goldfish-949.convex.site/polar/webhook` — **`.convex.site`,
  not `.convex.cloud`**. No `webhook-id` → 400; bogus signature → 403.
- `getCustomerPortalUrl` works end to end and correctly answers `no-customer`
  for an account with no sandbox customer.
- All five `POLAR_*` are set on beta and `POLAR_SERVER` is `sandbox` (measured
  2026-09-01).

Still to run, with the fresh account:

1. Subscribe, upgrade, downgrade, cancel — confirm team limits move each time,
   and specifically that **`subscription.canceled` does NOT remove teams while
   `subscription.revoked` does**.
2. A duplicate `webhook-id` returns success **without** reprocessing.
3. **The silent-202 case** — needs a Polar sandbox customer to exist under that
   address *before* checkout. Create one in the Polar dashboard first.
4. **The v1-uuid identity case may be unreachable**, and if so **say so in the
   runbook rather than letting a green pass imply coverage.** A fresh v2 account
   has no `legacyId`, so it cannot reproduce what happens to a *migrated*
   subscriber on revocation — the case that hits every paying customer at
   cutover. It is pinned by unit tests and the portal's dual-namespace lookup.

Then close `wt-ksh.6`'s six acceptance criteria **each against evidence**, then
`02c`, then `wt-ksh.6`.

**Two stale claims inside `02c` itself.** Its notes say team-picker's CTA is
"v2's only route to `createProCheckout`" — Task 12 added a second in the Header,
though both are gated on `isPro === false` so the blocker stands. And it cites
`http.ts:121`/`:144`; those are now `:130`/`:154`.

---

## Phase 7 — what is left, in the order it should be done

Everything is parented under `wt-ksh.8`. Twenty-two open children.

### Needs the owner (do these while they are available)

- **`wt-ksh.8.41` / `02c`** — the sandbox pass above. Closes Phase 5 too.
- **`wt-ksh.8.40`** — Task 17, the hand-walked checklist of every interactive
  surface. **Its blocker is cleared**: e2e is reliable now (six consecutive
  60/60 runs), so it can tell a regression from noise. Task 13's table is the
  mechanical half — paste it from
  `docs/superpowers/audits/2026-09-01-parity-routes.md` and re-run the script
  first. Every difference goes to §7a or Beads; **nothing stays in the walk
  document as a note.**
- **`wordle-teams-jcjj`** — settle with the fresh account, per above.

### Codeable now, highest value first

- **`wt-ksh.8.45` (P1)** — one `curl` for `cf-cache-status` on beta, run twice.
  It decides whether a Worker response reaches Cloudflare's edge cache at all —
  **if it does not, Task 3's entire `s-maxage` win is currently zero** — and it
  sets the severity of `.46` and `.52`. Cheapest P1 on the board.
- **`wt-ksh.8.44` (P1)** — remove the literal NUL from `sw-push.test.ts`. It
  makes the file invisible to recursive greps and renders its diff as binary.
  Write `'\u0000'` as an escape; do not paste a real one.
- **`wordle-teams-vlve` (P2)** — the copy's `droppedMembers` note tells the
  operator an expected outcome is "a real problem" under `--scope=all`. It will
  do that at cutover under time pressure.
- **`wordle-teams-82zq` (P2)** — `/opengraph-image.png` went from immutable/1yr
  on prod to `max-age=0, must-revalidate` on beta. No policy covers static
  assets at all; this is Workers Assets' default, not a decision.
- **`.46`, `.52`, `.54`, `.55`, `.48`** (P2) and the P3 tail (`721e`, `7jpo`,
  `cog5`, `d2oc`, `vmya`, `woe0`, `.50`, `.57`, `.58`).

### The design one

- **`wordle-teams-ha7u` (P2)** — step back on the dashboard cards and brainstorm
  options against modern UX practice. **Use `superpowers:brainstorming`; this is
  explicitly not a ticket to implement one answer.** Read
  `docs/design-system/V2-ADDENDUM.md` §7a first — 43 deliberate divergences —
  so a proposal does not "fix" something that was decided. Parity with v1 is
  *not* a constraint here, which means anything adopted becomes a new §7a row.

### Held open on purpose

- **`wt-ksh.8.43`** (Task 20) — the runbook is **written**
  (`docs/runbooks/2026-cutover.md`). The bead is blocked by Tasks 17 and 18,
  whose outputs still feed into it. Do not force it closed.
- **`wt-ksh.8.38`** (Task 15) — the copy ran successfully on 2026-09-02 and its
  reports were adjudicated clean. Open only on Step 5, below.
- **`wt-ksh.7.32`** — **the code is shipped, do not re-implement it.** Open only
  on "verified by measuring beta after a run". No internal query exposes
  `reminderDeliveryMethods`, so this needs either a small probe query deployed
  to beta returning a COUNT, or measuring during the cutover run itself. When
  measuring: beta holds **one v2-born player**; count rows with a `legacyId`
  separately or the answer is ambiguous in the direction that matters.

---

## Phase 7.5 — what now sits between Phase 7 and cutover

**This is new as of 2026-09-02 and it changes what "done" means for this
session. Cutover is no longer what follows Phase 7.**

`wordle-teams-wty4` is Phase 7.5: the seven post-v2 roadmap epics, moved INSIDE
the v2 release. The owner's decision is that they land **before** Phase 8's DNS
flip, so v2 and all seven go live together and the announcement email describes
the whole thing at once.

**The reason is the email, and it should shape how the work is judged.** It goes
to every existing player, including people who hit early friction or confusion
and gave up — a re-engagement moment that happens once. It must not say "new
features are on the way": someone who comes back because of it has to find the
value already in front of them.

```
Phase 7 (wt-ksh.8) -> Phase 7.5 (wty4) -> Phase 8 cutover (wt-ksh.9)
```

In roadmap priority order, kept as a serial chain:

| # | Epic | |
| --- | --- | --- |
| 1 | `wordle-teams-qix` | Team chat (free) — **unblocked, ready to start** |
| 2 | `wordle-teams-418` | Board import from a pasted screenshot (paid) |
| 3 | `wordle-teams-4s0` | Insights from global guess/answer data (paid) |
| 4 | `wordle-teams-qt4` | App onboarding tour |
| 5 | `wordle-teams-0hx` | SEO |
| 6 | `wordle-teams-c0f` | PWA launch screen and startup speed |
| 7 | `wordle-teams-iht` | Monetization and marketing |

Plus `wordle-teams-efrc` — brainstorm which further paid features are worth
building. The paid tier's only real substance today is the team cap, and the
relaunch is when the most people will meet the paywall for the first time.

**TWO THINGS TO RAISE RATHER THAN ABSORB.**

**The launch date is now the sum of seven serial epics.** That is the direct
consequence of the sequencing decision, and it is written into `wty4` on
purpose. If it turns out to be longer than the owner will hold v2 unlaunched,
the honest options are parallelising the chain, cutting items from the launch
set, or revisiting the split — cut over quietly, land the rest, then email. **Do
not silently reorder or drop anything.**

**Two of the seven cannot carry the email.** #5 SEO and #7 monetization serve
acquisition and conversion, not the returning player; #6 PWA speed is felt but
not announceable. What the email actually has to talk about is #1, #2, #3 and
#4 — and #4, the onboarding tour, is aimed squarely at the population being won
back, since confusion is why they left.

**DO NOT START PHASE 7.5 IN THIS SESSION** unless the owner says so. It is
gated on Phase 7 finishing, and Phase 7's remaining P1s need the owner. The
scope of this session is Phase 5's close and Phase 7's remainder; 7.5 is here so
you know what "next" is and do not plan cutover work that cannot happen yet.


---

## State you need before touching anything

- **The owner did a round of UI/UX polish on this branch in another session.**
  Do not undo it. `user-menu.tsx` became `app-menu.tsx`; theme, skeletons,
  calendar sizing, TeamBoards and layout all changed.
- **The beta Convex deploy key is in `v2/.env.local`**, and the beta
  `CONVEX_URL` + `CONVEX_MIGRATION_KEY` pair is there too. A `convex dev`
  watcher is live on the LOCAL anonymous backend and did not retarget — a
  running process keeps its environment — but **it reads that file on restart.**
- **`/etc/hosts` pins `dcfqzbdusxhrfgvnpwqc.supabase.co`** to `172.64.149.246`,
  because the network filters `supabase.co` DNS. That pin is what makes the copy
  and `verify-parity` runnable. If either starts failing with
  `TypeError: fetch failed` naming a *different table each run*, check
  `getent hosts dcfqzbdusxhrfgvnpwqc.supabase.co` before theorising.
- **`REMINDERS_ENABLED` is empty on beta and must stay that way.**
  `convex/reminders.ts:81` gates on `!== 'true'`. Beta holds copied production
  rows. **Do not flip it on any deployment without asking.**
- **`E2E_TEST_MODE` is unset on beta.** Verified. It must stay unset, and the
  runbook re-confirms it after the final copy.
- **`verify-parity --scope=all` currently FAILS with 8 problems, and that is
  expected.** All eight are beta's own v2-born rows — 1 player, 2 teams, 2
  winners with no `legacyId`, plus 5 boards entered on beta against one copied
  account. Measured with `internal.migrate.parityProbe`. The verifier is exact
  by design and cannot tell a v2-born row from a lost one.

---

## Rules that each cost this project real time

- **Run everything from inside `v2/`, and give EVERY command its own `cd v2`.**
- **NEVER pipe a command whose exit code matters.** zsh's `PIPESTATUS` is empty;
  `pnpm lint | tail` reported success while lint had failed.
- **`convex env --prod` silently reads the LOCAL backend**, and `convex env get`
  **exits 0 whether or not the variable exists**. Read a beta-only sentinel
  first; match the "not found" TEXT, never the exit code.
- **Run all four gates every time**, and `pnpm e2e` deliberately — it is still
  not a CI gate. Playwright workers are pinned to 4; do not raise them.
- **Backticks and `!` inside a double-quoted shell string are expanded.** Use
  `git commit -F -` and `bd note --stdin` with quoted heredocs. This bit twice
  in one session and silently ate words out of a filed issue.
- **`bd create --parent wt-ksh.8` is refused across prefixes.** Use
  `bd dep add <child> wt-ksh.8 --type parent-child`.
- **NEVER put an email address in a beads issue or a commit.** The repo is
  public and `.beads/issues.jsonl` is tracked.
- **DO NOT USE `--no-verify`** — the hook chains to the PII guard.
- **Do not push from a subagent.** Committing is theirs; pushing is yours.
- **Comment and document accuracy is a defect here, not a nit.**

## The discipline that keeps paying

**Mutate before believing a green test**, anchored on syntax a comment cannot
contain — this codebase is dense enough that the first textual occurrence of
almost any code string is prose about that code. Print the diff and confirm the
code line moved. In the last session three "kills" were no-ops, two anchors
matched twice, two survivors were the tests' fault, and one was a genuine
equivalent mutant recorded as such.

**And check your own numbers before writing them down.** A comment was committed
last session claiming "a third off" from figures invented before the measurement
was taken; the real figure was a fifth. A §7a row claimed a source guard that
did not exist. `02c` cites line numbers that have moved. Verify, then write.
