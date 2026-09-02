# Handoff — Phase 7's codeable tail is done; what remains needs the owner

**Written 2026-09-02**, superseding this file's earlier version and continuing
from `2026-09-02-phase5-close-and-phase7-remainder.md`. Read that one for
Phase 5, Phase 7.5 and the standing rules; this file records what moved.

Branch `feat/v2-replatform`, in sync with origin, tree clean. Four gates green
(**1402 tests / 86 files**), e2e **66/66 on a verified-fresh server**, beta
deployed and verified.

> The previous handoff said 1335 / 79. Growth is this session's new tests; the
> file count was already 81 at HEAD before any of it.

---

## Read this first: every e2e result before today was untrustworthy

**`wordle-teams-9mjm` (P1).** `playwright.config.ts` sets
`reuseExistingServer: true` against port 3000, and a `vite dev` process from
**Aug 31** had been answering there for two days. Every run since attached to
it, so the suite was exercising that process's view of the code, not the
working tree. It was demonstrably stale, not merely old: port 3000 served
`/about` with the pre-change `og:url` and no canonical while a server started
seconds earlier from the same files served both correctly.

It surfaced only because a new test asserted a **count** — "exactly one
og:url" — and reported two, a number impossible from either version of the
code. An assertion on a value would have looked like an ordinary failure and
sent me to doubt the change.

**So `wt-ksh.8.40`'s unblocking premise is void.** Task 17 was cleared on the
grounds that e2e was reliable enough to tell a regression from noise, citing six
consecutive clean runs. Those runs cannot be assumed to have exercised current
code. Before running e2e: `ss -ltnp | grep :3000`, and kill what is there.

---

## Closed

| | |
| --- | --- |
| `wt-ksh.8.45` | `s-maxage` reached nothing — no `cf-cache-status` at all on Worker documents. Cache Rules run *ahead* of the Worker and were never an available remedy. |
| `wordle-teams-fqeq` | The Cache API, verified live. One predicate gates read *and* write; the key carries `CF_VERSION_METADATA.id`, proven against a real redeploy. |
| `wt-ksh.8.44` | The NUL byte. |
| `wt-ksh.8.54` | `X-Robots-Tag` on staging. **Keyed on the request hostname, not `ENVIRONMENT`** — the runbook already recorded that beta and production are the *same deployment*, so a var cannot tell two hostnames apart at cutover. Deny-list, so an unrecognised host is indexable and production can never be accidentally removed from search. Runbook §3.4 is now a two-direction check with no step to remember. |
| `wt-ksh.8.55` | Per-route `og:url` and `rel=canonical`, `/home` → apex. Removed from the root rather than overridden there, so no merge rule can produce two tags. |
| `wt-ksh.8.48` | The `--text-subtle` exception **stands**, with a measured reason — see below. |
| `wordle-teams-54s` | A stored time zone outside the curated 27 now displays truthfully and cannot be silently replaced. |
| `wordle-teams-82zq` | Static assets had **no** cache policy — every asset, including content-hashed bundles, was on `max-age=0`. `public/_headers` fixes it. |
| `wordle-teams-vlve`, `wordle-teams-721e` | The copy's misleading note; a stale comment. |

**`wt-ksh.8.48` is the one worth reading.** The claim that there was room to
lift `--text-subtle` to AA rested on `--text-muted` scoring 5.05 — **the
`--background` figure**, which is exactly the single-surface mistake that row
was added to correct, reintroduced two paragraphs later. The binding surface is
`--surface-sunken` at 4.80, so the band is 0.30 wide and the best AA-clearing
grey lands 1.06:1 from `text-muted` against the 1.174:1 actually shipped. The
ranks would collapse. `styles.test.ts` now runs that search every CI run, so the
exception is flagged for revisiting rather than inherited.

---

## Filed, and worth your attention

- **`wordle-teams-9mjm` (P1)** — above. The fix is a judgement about developer
  ergonomics; three options are on the issue.
- **`wordle-teams-g1cd` — FIXED, same session.** The zone's Browser Cache TTL
  defaults to 4 hours and overrides a *lower* origin `max-age`, so the
  documents' deliberate `max-age=0` was shipping as `max-age=14400` — four hours
  of browser cache that the version-keyed edge key cannot reach. The owner set
  the zone to **Respect Existing Headers**; all five documents verified back to
  `max-age=0` with the edge cache still HITting, and every asset class
  unchanged. **Runbook §3.5 checks it**, because dashboard state cannot be
  asserted from the repository and the apex inherits it.
- **`wordle-teams-jtvx` (P2)** — re-measured on a clean server: **two** of three
  invite tests fail under full-suite load, all three pass in isolation. A
  contention signature. The final run of the session was 66/66, so it is
  intermittent. Both failures are 5s toast assertions; line 392 already checks
  the server outcome, so reordering would remove the dependence on catching a
  disappearing element.
- **`wordle-teams-51zk` (P3)** — lifting `--text-subtle` to AA is possible in
  **dark only** (`#848484`, 4.56, 1.48:1 separation). Asymmetric token, visible
  change in the theme the app is used in: a design call.
- **`wordle-teams-v917` (P3)** — production freezes `/manifest.json` for a year;
  beta does not. Deliberately left, because `wordle-teams-c0f` is likely to edit
  manifest fields and freezing it immediately beforehand is the wrong order.

---

## What is left, and all of it needs you

**Owner-only, in the order that unblocks the most:**

- **`wt-ksh.8.41` / `02c`** — the Polar sandbox pass. Still closes Phase 5 too.
  You have a usable non-pro account now; the **silent-202 case still needs a
  Polar sandbox customer created in the dashboard before checkout**, and the
  v1-uuid identity case is still probably unreachable — say so in the runbook
  rather than letting a green pass imply coverage.
- **`wt-ksh.8.40`** — Task 17's walk. Read `wordle-teams-9mjm` first.
- **`wt-ksh.7.32`** — needs a probe query on beta, or measurement during the
  cutover run.

**Decisions I deliberately did not make:**

- **`wordle-teams-4yt`** — the legal copy names Apple and Facebook as sign-in
  providers and a username that does not exist. Its DONE-WHEN is explicitly to
  reissue both published documents (bumping the Effective Date, deciding whether
  users need notice under the Changes clauses) or to leave them. Amending
  published legal text is not a thing to do unattended.
- **`wordle-teams-7jpo`** — where to show a player their own email address. The
  issue says outright it is a decision, not a ticket to implement one, and the
  weighing is about shoulder-surfing and screenshots.
- **`wordle-teams-jcjj`** — settled with data and **not a defect**; left open
  only because its DONE-WHEN asks for the badge to be *shown* to render. The
  recipe is on the issue.

---

## Two disciplines that paid for themselves again

**`gh run watch | tail` reported a false green.** zsh's `PIPESTATUS` is empty so
`$?` was `tail`'s; the run had failed. Read conclusions with
`gh run view --json conclusion`, never through a pipe.

**Three of my own mutations were no-ops and one of my tests asserted nothing.**
A mutation that appends a comment, or references a field that does not exist,
"survives" while changing nothing. And an anchoring test used
`workers.dev.example.com`, where `endsWith` and `includes` agree, so it pinned
nothing until the mutation survived and exposed it. Separately, a three-segment
timezone example used `America/Argentina/Buenos_Aires` — which is *in* the
curated list, so the test asserted nothing at all. Print the diff, confirm the
code moved, and check that the fixture is the case you think it is.

**`pnpm cf-typegen` is not free.** Regenerating `worker-configuration.d.ts`
pulled every local env-var name into the committed file and broke
`convex/http.test.ts`. Reverted; bindings are typed narrowly at the use site
instead. Note `caches.default` is unreachable through the globals here at all —
tsconfig's `lib` includes `DOM`, and the DOM's `CacheStorage` wins.

**Beta deploys from CI on push**, not local wrangler, which has no credentials
here. One deploy failed on a **transient Convex 500 at `finish_push`** after the
build and schema validation both passed; `gh run rerun --failed` was clean.
