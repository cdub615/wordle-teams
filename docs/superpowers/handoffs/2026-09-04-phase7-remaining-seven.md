# Handoff — the seven items left in Phase 7, walked together

**Written 2026-09-03, for a session on 2026-09-04.** Read this whole file; it is
the prompt. You need no previous conversation.

Run `bd prime` first. Branch `feat/v2-replatform`, in sync with origin, tree
clean. Four gates green (**1510 tests / 89 files**), e2e **66/66**, beta deployed
and verified.

**Phase 5 is CLOSED** (`wt-ksh.6`) — the owner ran the Polar sandbox pass on
2026-09-03 and all six acceptance criteria are closed against observed evidence.
**The v1 legal correction is merged to `main` and live in production.**

---

## How this session is meant to run

The owner wants to **walk these seven together, in this order**. They are not
independent — the first two pairs are entangled, and doing them out of order
wastes a Cloudflare dashboard trip and a copy run.

**Everything here needs the owner for at least part of it.** Nothing in this
list is codeable alone; that work was finished on 2026-09-03 (eleven issues
closed, including the P0). If something turns out to be codeable, it is because
a decision got made in-session — that is the expected shape.

---

## 1. `wt-ksh.8.40` — Task 17, maintenance mode (P1) — AND 2. `wt-ksh.8.52`

**Do these as one thing.** The walk's maintenance section IS 8.52's
verification; there is no reason to flip the flag twice.

The checklist is `docs/superpowers/audits/2026-09-03-task17-walk.md`. Everything
else in it is ticked. What is left:

- [ ] Flip `MAINTENANCE` to `"true"` in the Cloudflare dashboard (Workers &
      Pages -> the Worker -> Settings -> Variables). **Not a code deploy** —
      that is the whole point of it being a var.
- [ ] `/app`, `/me`, `/complete-profile`, `/login` and `/` all 307 to
      `/maintenance`
- [ ] `/home`, `/about`, `/privacy`, `/terms` **stay up** — deliberate, and
      argued in `src/lib/maintenance.ts`
- [ ] **`/` needs a cache purge, and this is now load-bearing** (`wt-ksh.8.52`).
      `/` is the only path in both `GATED_PATHS` and `STATIC_DOCUMENTS`, and
      since `wordle-teams-fqeq` it is genuinely cached at the edge — a cached
      200 outlives the flag and the Worker never sees those requests. **Purge
      the apex, or redeploy**: the cache key carries `CF_VERSION_METADATA.id`,
      so a new version misses everything.
- [ ] Flip back to `"false"` and confirm the site returns

**That caveat was stale until 2026-09-03 and is not any more.** It used to say
the purge "costs nothing today", because nothing reached the edge. Both halves
have flipped since. Beta returns `x-doc-cache: HIT` on `/`.

**8.40 closes when nothing is left unresolved in the walk document** — that is
its acceptance criterion, and it is `wt-ksh.8`'s. It is also the last thing
blocking `wt-ksh.8.43`, the cutover runbook.

---

## 3. `wt-ksh.7.32` — reminder settings on beta (P1)

**The code half is DONE and shipped (d95796a). Do not re-implement it.**
`scripts/lib/copy-reminder-policy.mjs` withholds `timeZone` and
`reminderDeliveryMethods`; `--with-reminders` restores them and the runbook
passes it to the final copy. Ten tests, nine mutations killed. §7a row 41 records
the omission; runbook §4.2 carries the restoring line.

**ONE CLAUSE REMAINS: "verified by measuring beta after a run."**

**ITS STATED BLOCKER HAS LIFTED.** The issue says this is blocked because
`supabase.co` does not resolve on this machine. Checked 2026-09-03: the
`/etc/hosts` pin (`172.64.149.246 dcfqzbdusxhrfgvnpwqc.supabase.co`) is in place
and the host answers **401 in 0.17s**, i.e. reachable. The pin is known to be
intermittent — if a copy starts failing with `TypeError: fetch failed` naming a
different table each run, check `getent hosts` before theorising.

So this is probably just a **measurement**, not a copy run: Task 15's copy ran
on 2026-09-02, *after* the withholding policy landed, so beta should hold no
player with a non-empty `reminderDeliveryMethods`.

- [ ] Measure beta for any player holding a non-empty `reminderDeliveryMethods`
      or a `timeZone` that came from the copy. **Beta holds v2-born players
      too** — count rows with a `legacyId` separately or the answer is ambiguous
      in the direction that matters.
- [ ] A probe script takes about a minute to write (the pattern is the one used
      for `parityProbe` on 2026-09-02). **The assistant cannot run it** — the
      auto-mode classifier blocks reading `CONVEX_MIGRATION_KEY` out of
      `.env.local`. Ask the owner to run it with `!`.
- [ ] **`REMINDERS_ENABLED` must stay empty on beta.** `convex/reminders.ts:81`
      gates on `!== 'true'`, and beta holds copied production rows.

---

## 4. `wt-ksh.8.57` — robots.txt has two `User-agent: *` groups (P3)

Beta's `robots.txt` contains **two** `User-agent: *` groups: Cloudflare's
managed one first (Content-Signal, `Allow: /`, **no disallows**), then ours.
Google MERGES groups sharing a user-agent, so Googlebot honours our disallows —
but merging is not universal, and a parser that takes the first match and stops
sees the dashboard and `/api` allowed.

**Nothing in CI can see this.** Our file is correct and tested; the composition
happens at the edge. Check by fetching the live hostname.

**Two decisions, and the second is a product call, not a technical one:**

- [ ] Accept it (defensible — Google merges, and the excluded paths bounce
      anonymous visitors anyway), disable the managed block (losing nine
      AI-crawler blocks and the content signals), or fold our disallows
      elsewhere.
- [ ] **Is AI-crawler blocking wanted on production at all?**

**Settle the PRODUCTION zone before cutover either way** — the apex joins this
zone at the DNS flip, and whatever is true of beta becomes true of the real
domain.

---

## 5. `wordle-teams-ha7u` — the dashboard cards (P2)

**Explicitly a brainstorm, not a ticket to implement one answer.** Use
`superpowers:brainstorming`.

Read **V2-ADDENDUM §7a first — it now holds 58 deliberate divergences** — so a
proposal does not "fix" something that was decided. **Parity with v1 is not a
constraint here**, which means anything adopted becomes a new §7a row.

---

## 6. `wordle-teams-51zk` — `--text-subtle` in dark only (P3)

`wt-ksh.8.48` closed by recording a MEASURED reason to keep the sub-AA
exception: in LIGHT there is no room (the band is 4.50-4.80, and the best
AA-clearing grey lands 1.06:1 from `text-muted` against a shipped 1.174:1, so
the ranks collapse).

**Dark is different.** `text-muted` is 6.76 on `--surface-sunken`, and `#848484`
clears AA on all three dark surfaces at 4.56 while staying 1.48:1 from
`text-muted`.

- [ ] Take `#848484`, or record that symmetry is worth more than 0.38 of
      contrast. It makes the token asymmetric and moves every N/A cell,
      timestamp and placeholder **in the theme the app is actually used in** —
      a design call, not a contrast fix.

---

## 7. `wordle-teams-v917` — `/manifest.json` immutability (P3)

Production serves it `public, immutable, no-transform, max-age=31536000`; beta
serves the Workers Assets default. A live parity difference, and the apex
inherits beta's answer at cutover.

**Not simply matched, on purpose:** a manifest that can never change freezes the
app name, theme colour, icons and `start_url` for a year in any browser that
fetched it. And `__root.tsx` only started LINKING the manifest recently — before
that nothing fetched it and the app was not installable at all — so the blast
radius is larger now than the header's age suggests.

- [ ] Match production, leave it, or take a middle TTL (~1h), which is probably
      right and is a divergence needing a §7a row. **`wordle-teams-c0f` is
      likely to edit manifest fields**, so freezing it immediately beforehand is
      the wrong order.
- [ ] `v2/src/asset-headers.test.ts` currently ASSERTS `manifest.json` has no
      rule, so it must be updated in the same change.

---

## Rules that each cost this project real time

- **Never put `cd` in a compound command.** `cd` is zoxide here; `cd v2 && ...`
  can print "already in the only match", return non-zero, and **silently skip
  the rest** — it ate a `python3` edit and an `rm` in one session. Use absolute
  paths, or `pnpm --dir v2`, or `git -C`. **Verify the file changed** rather
  than trusting the exit code.
- **NEVER pipe a command whose exit code matters.** zsh's `PIPESTATUS` is empty.
  `gh run watch | tail` reported a green deploy that had failed.
- **Before any e2e run, check `ss -ltnp | grep :3000`.** Reuse is off now
  (`wordle-teams-9mjm`), so an occupied port is a loud refusal — but a stale
  server invalidated a week of results before that landed. **Workers are 2, not
  4**, measured; do not raise them.
- **Do not inspect a fetched page with `grep`.** Every SSR document contains NUL
  bytes, so grep treats it as binary and reports no matches with no error. Use
  `grep -a`, `tr -d`, or a parser. *This bit the author while writing the
  warning about it.*
- **Mutate before believing a green test**, and check the mutation is not a
  no-op. Three no-op "kills" and two tests that matched their own explanatory
  prose were caught this way in two days.
- **DO NOT USE `--no-verify`** — the hook chains to the PII guard, and that is
  now asserted (`src/pii-guard-wiring.test.ts`).
- **NEVER put an email address in a beads issue or a commit.** The repo is
  public and `.beads/issues.jsonl` is tracked.
- **Run all four gates every time**, and `pnpm e2e` deliberately — it is still
  not a CI gate.
