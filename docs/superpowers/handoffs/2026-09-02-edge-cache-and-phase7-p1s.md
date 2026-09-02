# Handoff — the edge cache landed; Phase 7's remaining P1s need the owner

**Written 2026-09-02**, continuing from
`2026-09-02-phase5-close-and-phase7-remainder.md`. Read that one for Phase 5,
Phase 7.5 and the standing rules; this file only records what moved.

Branch `feat/v2-replatform`, in sync with origin, tree clean. Four gates green
(**1345 tests / 81 files**), e2e **65/65**, beta deployed and verified at
`3a61ec8`.

> The previous handoff says **1335 tests / 79 files**. Both numbers moved for
> benign reasons: +10 from this session's new `server.test.ts` block, and the
> file count was already 81 at HEAD before anything here was written. Not
> investigated further; flagged so the next drift is measured against the right
> baseline.

---

## What closed, and the one that did not say what it was expected to

**`wt-ksh.8.45` — s-maxage was reaching nothing, and the issue's own remedy did
not exist.** Three consecutive GETs to beta `/about` carried the header with
**no `cf-cache-status` at all** — not DYNAMIC, not MISS, absent. A Worker that
renders its own response makes no origin subrequest and is therefore not
cache-eligible, and Cache Rules run *ahead* of the Worker and cannot reach it.
So the "or a Cache Rule is added" branch was never available. The zone's cache
was fine throughout: `/favicon.ico` and `/opengraph-image.png` both reported
HIT, because Workers Assets bypasses the fetch handler entirely.

**`wt-ksh.8.44` — the NUL byte is gone** (`a32b08f`). The SSR half stays
unfixable by design and is recorded on the issue for Tasks 13 and 17 to consume.

**`wordle-teams-fqeq` — the Cache API, implemented and verified live**
(`dfa6c41`). Written from `wt-ksh.8.45`'s measurement. `cachePolicyFor`
returning `STATIC_CACHE` is the single predicate gating reading *and* writing,
so the session rule is never restated; the key carries `CF_VERSION_METADATA.id`
from a new `version_metadata` binding, which is the invalidation mechanism.

Verified on beta rather than only in tests: `/about` and `/home` both MISS then
HIT; a request carrying a session cookie stays `private, no-store` with **no**
cache involvement at all; a query string is not cached; `/app` never reaches the
handler. **The version key was then proven against a real redeploy** — a warm
cache holding the previous deployment's entries missed anyway and repopulated
under the new key.

---

## Three things this turned up that are worth your attention

**`wordle-teams-g1cd` (P2) — the zone rewrites `max-age=0` to `14400`.** The
Worker sets `max-age=0`; every response served from the edge comes back with
four hours of browser cache, because of a zone-wide Browser Cache TTL setting.
**The version-keyed invalidation does not reach a browser cache**, so a
returning visitor can hold a marketing page across a deploy. New as of the edge
cache, decided by nobody, and invisible from the repository — which is why
`cache-policy.ts` now names the cause in a comment (`3a61ec8`). Three options
are written on the issue; `/` is the one that actually matters, being the apex
a returning player hits right after the relaunch email. It is a sibling of
`wordle-teams-82zq`, same zone setting.

**`wordle-teams-jcjj` — settled, and NOT the way the last handoff predicted.**
That handoff said this was very likely the comped-pro account. **It is not** —
the owner reproduced it on a genuinely non-pro account. The real answer is that
`parkedInvitesFor` resolves the **caller's own** address, so the badge counts
invites **received**, never sent; the owner was watching their own header after
inviting someone else, which can never move. And most invites park nothing at
all — an under-cap invitee with an account goes straight onto the roster. Two
exact reproductions are on the issue. No code change; run repro A and close.

**`wordle-teams-jtvx` (P2) — an e2e flake.** `invites.spec.ts:340` failed once
in a full run and passed both in isolation and on an immediate full re-run.
Filed because `wt-ksh.8.40`'s blocker was cleared on the premise that e2e was
reliable enough to tell a regression from noise. It mostly is; it is not
perfect. Re-run before believing a red invites case.

---

## What is left, and it is the same blocker as before

Everything remaining in Phase 7's P1 tier needs the owner:

- **`wt-ksh.8.41` / `02c`** — the Polar sandbox pass. Still the thing that
  closes Phase 5 too. The owner has a usable non-pro account now, which removes
  the account half of the blocker; the **silent-202 case still needs a Polar
  sandbox customer created in the dashboard before checkout**, and the v1-uuid
  identity case is still probably unreachable — say so in the runbook rather
  than letting a green pass imply coverage.
- **`wt-ksh.8.40`** — Task 17's hand-walked checklist.
- **`wt-ksh.7.32`** — needs a probe query on beta or measurement during the
  cutover run itself.

Codeable without the owner: `wordle-teams-g1cd` once the option is chosen,
`wordle-teams-vlve`, `wordle-teams-82zq`, `wordle-teams-ha7u` (a brainstorm, not
an implementation), and the P3 tail.

**Phase 7.5 is still gated on Phase 7 and must not be started without the owner
saying so.** See the previous handoff.

---

## Two rules this session paid for again

**`gh run watch | tail` reported a false green.** zsh's `PIPESTATUS` is empty,
so `$?` was `tail`'s. The run had **failed**. Read the conclusion with
`gh run view --json conclusion` and never through a pipe.

**A mutation that appends a comment is a no-op, not a kill.** One of the six
mutations on the new tests was written as `return null // eslint-disable-line`
and "survived" because it changed nothing. Redone as a real deletion, it killed.
Print the diff and confirm the code line moved — every time.

**Also: `pnpm cf-typegen` is not free.** Regenerating `worker-configuration.d.ts`
pulled every local env var name into the committed file and broke
`convex/http.test.ts`'s typing. It was reverted; the binding is typed narrowly
in `server.ts` instead. Note that `caches.default` is unreachable through the
globals here at all — tsconfig's `lib` includes `DOM`, and the DOM's
`CacheStorage` wins over Cloudflare's.

**And beta deploys from CI on push, not local wrangler** — `pnpm --dir v2 deploy`
has no credentials on this machine and does not need them. One deploy failed on
a **transient Convex 500 at `finish_push`**, after the build and schema
validation had both passed; `gh run rerun --failed` was clean. Worth knowing
before someone meets it mid-cutover and starts diagnosing their own change.
