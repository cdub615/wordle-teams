# Insights, Plan A — public benchmark, personal history, and the trial

## Design source

`docs/superpowers/specs/2026-09-05-pro-tier-and-insights-design.md`, section 3
(Layers 1 and 2) and section 1 (the tier and the trial). That spec settles the
decisions; this plan only sequences them. Where the two disagree, the spec wins
and this file is wrong.

Epic: `wordle-teams-4s0`.

## Scope

Layers 1 and 2, plus the trial and the per-layer access rule they need. Layers 3
and 4 are Plan B (`2026-09-08-insights-layers-3-4.md`).

**TWO PLANS, ONE RELEASE.** The owner's decision, 2026-09-08: splitting the work
does NOT mean shipping Layers 1–2 to users and following up later. Everything
goes together. This is safe by construction rather than by discipline —
`wordle-teams-wty4` (Phase 7.5) BLOCKS `wt-ksh.9` (cutover), production is still
v1 until the DNS flip, and beta is a staging environment whose state is
discarded at cutover. So Layers 1–2 landing on beta ahead of 3–4 is staging, not
release, and **no feature flag is needed** to hide a half-built surface. If that
sequencing assumption ever stops holding — if any of this could reach a real
user before Plan B lands — a flag becomes required and this paragraph is the
thing that was wrong.

## Where the surface lives, and why this plan decides it

**The spec does not place it.** It says the artifact is lazy-loaded "when
insights are opened" and that attribution must be visible on "the insights
surface", but never says what that surface is. Section "Out of scope" assigns
*paywall placement* to `wordle-teams-iht`; the surface's own location is not
assigned to anyone, so it is decided here and recorded for the owner to
overrule.

**A top-level `/insights` route**, matching `/chat` and `/team` — both are
sibling top-level routes rather than children of `/app`, both are reached from
the app menu, and both are gated by the same `beforeLoad` redirect to `/login`.
Insights is the same shape: signed-in only, its own screen, nothing for an
anonymous visitor.

Consequences that are easy to miss and are therefore tasks below:

- `public/robots.txt` needs a `Disallow: /insights` line, for the reason `/chat`
  has one. `src/crawler-metadata.test.ts` walks `routeTree.gen.ts` and FAILS if a
  route is neither in the sitemap nor disallowed nor named as a deliberate
  exclusion — so adding the route without the rule turns that suite red, which is
  the check working.
- The app menu gains an entry.
- Lazy loading is what makes the artifact affordable; a route whose component is
  code-split gives that for free.

## File structure

```
v2/scripts/build-insights-corpus.mjs      A1/A2  reduce raw datasets -> artifact
v2/public/insights/benchmark-openers.json    A2  14,855 words in rank order
v2/public/insights/benchmark-difficulty.json A2  1,900 contiguous percentiles
v2/src/lib/insights-benchmark.ts          A2     typed lazy loader + lookups
v2/src/lib/insights-personal.ts           A5     pure stats over a player's rows
v2/src/lib/insights-access.ts             A3     which layers a player may see
v2/convex/schema.ts                       A3     players.insightsTrialEndsAt
v2/convex/access.ts                       A3     insightsAccessFor
v2/convex/insights.ts                     A3/A5  the player's own scores
v2/src/routes/insights.tsx                A4     the surface
v2/public/robots.txt                      A4     Disallow: /insights
v2/e2e/insights.spec.ts                   A6
```

Pure modules in `lib/` and the Convex boundary kept thin, for the reason
`convex/lib/e2e.ts` states: logic behind an authed wrapper is untestable in this
repo (`wordle-teams-obw`), so the decisions live in pure functions and the
wrappers act on the answer.

---

## Task A1 — Acquire and vet the corpus (SPIKE)

**This is the only task that can invalidate the rest**, which is why it is first
and why it is a spike rather than an implementation step. Layer 1 is a benchmark
against a corpus we do not have; Layer 2's opener repertoire is only worth paying
for because it *joins* to Layer 1's ranks. If the corpus is unobtainable or its
licence does not permit redistribution in a client bundle, both layers are
mis-specified and the owner has to be told before anything is built.

The spec names: the FiveLetterWords research corpus, **CC BY 4.0**, twelve
datasets, word lists originating from the archived dracos and cfreshman sources.
It quotes **14,855 scored openers**, **500 evaluated pairs**, **1,900 dated
puzzles**.

**CONFIRM THOSE THREE FIGURES AGAINST THE DATA, do not carry them across.** They
are the load-bearing numbers in every Layer 1 sentence the UI will show ("ranks
4,102nd of 14,855"), and a figure quoted from a spec into a UI is a figure
nobody has checked.

**Done when:**

1. The datasets are obtained and their licence recorded verbatim in the plan or
   the issue, including what CC BY 4.0 obliges us to display and where.
2. The three figures are confirmed or corrected against the actual files.
3. The join key is verified: the dated-puzzle set must key on something we can
   map to `dailyScores.puzzleDay` (`'YYYY-MM-DD'`). If it keys on puzzle NUMBER,
   the mapping to a date is part of this task and is a real risk — an off-by-one
   in puzzle numbering silently mis-attributes every difficulty percentile.
4. The reduced artifact's shape and approximate size are decided and written
   down, along with whether it splits into more than one file.
5. **Coverage against our own data is measured**, not assumed: how many of the
   7,594 boards have a `puzzleDay` present in the dated set, and how many
   `guesses[0]` values are present in the opener set. A benchmark that covers a
   third of a player's history is a different product from one that covers all
   of it, and the owner should learn that here rather than from the UI.

**If it fails, stop and report.** Do not substitute a different corpus without
the owner deciding — the spec's argument for benchmarking against computed
optimality rests on this specific corpus being public, free and stable.

### A1 RESULT — done 2026-09-08, `wordle-teams-0cmj` closed

**It did not fail. Layers 1 and 2 stand.** Full measurements are on the issue;
what the rest of this plan depends on:

- **Licence permits the client bundle.** CC BY 4.0, per-dataset rather than
  per-release — both files we ship are covered. Attribution and the release id go
  on the surface.
- **All three figures exact** — 14,855 / 500 / 1,900, and twelve datasets.
- **No join-key risk at all.** `puzzle-difficulty` carries a native
  `'YYYY-MM-DD'` `date` column, so we never touch puzzle numbering. Verified
  contiguous, 2021-06-19 .. 2026-08-31, and `date == 2021-06-19 + puzzle_number`
  on all 1,900 rows.
- **Coverage is not the problem it was feared to be**: 99.6% of boards for
  difficulty, 99.7% for opener rank, against 7,602 real boards. The 26 misses are
  our own dirty data (`XXXXX`, `ASDFG`, `CTANE`), not a thin corpus.
- **"Stable" is false for anything keyed on a date, and true for openers.** Opener
  ranks moved on 0 of 14,855 across two releases; difficulty percentiles moved on
  702 of 1,852 and 78 labels flipped band.
- **The pair rank is dropped** — 0.3% real coverage, and no player plays a fixed
  pair. `wordle-teams-ef54`, owner confirmed.

Left in the repo: `internal.migrate.insightsCoverageProbe` and
`insightsPairProbe` (counts only, both paginated), with
`scripts/measure-insights-coverage.mjs` and `scripts/measure-insights-pairs.mjs`
to re-run them. Raw datasets are deliberately **not** committed — A2 fetches
them.

---

## Task A2 — Reduce it to a lazy-loaded build artifact

`scripts/build-insights-corpus.mjs` turns the raw datasets into the smallest
thing that answers Layer 1's **two** questions, emitted into `public/insights/`.

**TWO ARTIFACTS, NOT THREE.** A1 measured and the owner decided (2026-09-08): the
opening-pair rank is dropped from Layer 1 entirely, so `benchmark-pairs.json` is
not built and `opening-pair-frontier.csv` is not fetched. See `wordle-teams-ef54`
— it fires on 0.3% of boards and describes a fixed-pair strategy that not one of
our players uses.

**A1 SETTLED THE SHAPE, so this task implements a decision rather than making
one.** Both files are pinned to release `v2026-09-01`, and every rank is derived
from ORDER rather than stored, which was verified against the files:

```
public/insights/benchmark-openers.json      72.6 KB raw / 37.8 KB brotli
public/insights/benchmark-difficulty.json    5.5 KB raw /  2.0 KB brotli
```

- **openers** — one concatenated string of 14,855 lowercase five-letter words in
  rank order. `rank = indexOf(word) / 5 + 1`. All words verified `/^[a-z]{5}$/`,
  all unique, and the CSV is already in rank order with `rank === row index + 1`.
- **difficulty** — `firstDay` plus a flat array of 1,900 integers 0..100.
  `index = days since firstDay`. This is only legal because the dated rows are a
  perfectly contiguous run with no gaps, which A1 verified; **assert contiguity in
  the build script** rather than trusting it, because a future release with a hole
  in it would silently shift every subsequent day.
- **no label is stored.** `solver_pressure_label` is a pure function of the
  percentile with non-overlapping bands — 0-34 "Easier for the solver", 35-64
  "Middle of the pack", 65-89 "Tricky", 90-100 "Hard for the solver".

Measured against the obvious alternative: openers as `[{word, rank}]` objects is
424.4 KB raw / 53.9 KB brotli — 5.8x the bytes to parse for the same information.

**UPPERCASE AT THE EDGE.** Our `guesses` are uppercase, the corpus is lowercase
throughout. Normalise in the lookup, never in the artifact.

**FETCH DIFFICULTY FROM `/data/current/`, OPENERS FROM THE PINNED RELEASE.** The
immutable release's history stops at its cutoff, so aggregate coverage is 99.6%
while coverage of the current week is 0% — and the free user's default view is
"the most recent board they have entered", which for a daily player is the one day
no release can cover. The rolling `/data/current/` feed is CC BY 4.0 with
identical columns and runs through yesterday. Record its `snapshot_id`, which it
exposes for exactly this. Today can never be covered by anything — the feed
publishes only globally completed days — so **a board with no difficulty row is an
ordinary outcome, not an error**, and the opener rank still renders for it.

**NOT IN CONVEX, AND THIS IS A COST DECISION RATHER THAN A TIDINESS ONE.**
`wordle-teams-dcu` establishes database bandwidth as the binding limit on the
free tier. The artifact is identical for every user and never changes per
player, so putting it in the database spends the scarcest resource on a
constant. It ships as a static file the CDN serves and the browser caches.

**Lazy, not in the main bundle.** The `/insights` route's component is
code-split by the router, and the artifact is fetched when that route renders —
so a player who never opens insights never pays for it.

**Done when:**

- `pnpm build` emits the artifact, and the build fails loudly if it cannot —
  the same rule `scripts/build-sw.mjs` follows, and for the same reason: a build
  step that silently emits nothing is worse than one that stops.
- A test asserts the artifact is **absent from the main client bundle**, in the
  shape of `deploy-v2.yml`'s `dist/client` grep: the fault would live in the
  emitted bundle, so the emitted bundle is where it is looked for.
- A stated size budget, asserted by a test, so growth is a deliberate decision.
- `insights-benchmark.ts` exposes typed lookups — opener rank and day difficulty
  percentile — over a lazily-fetched artifact, with unit tests including the
  **absent** cases from A1's coverage measurement: an opener not in the set and a
  `puzzleDay` not in the dated set must render as "no benchmark", never as rank 0
  or percentile 0. A1 supplies real absent cases rather than invented ones —
  `XXXXX`, `ASDFG` and `CTANE` are openers our players actually entered that the
  corpus does not hold, and any day after the artifact's cutoff is an absent date.
- The **attribution** string and the release id are exported from the artifact
  itself rather than hardcoded in the component, so they cannot drift from the
  data they credit. CC BY 4.0 obliges us to show them on the surface.

---

## Task A3 — The trial, and one access rule

Adds `players.insightsTrialEndsAt: v.optional(v.number())` and the single
resolver that answers which layers a player may see.

**THE CLOCK STARTS AT THE PLAYER'S FIRST BOARD AFTER LAUNCH, NOT AT LAUNCH**,
and the spec is emphatic that this distinction is the entire reason the rule
exists: a calendar window anchored to launch expires while a dormant player is
still dormant, and dormant returners are exactly who the launch email is for.

**`LAUNCH_AT` is a constant this task must introduce and the owner must set.**
The plan assumes the DNS cutover instant. It is deliberately a single named
constant rather than a date threaded through call sites, so it can be corrected
in one place. Until the cutover date is fixed, it may hold a placeholder — but
the placeholder must be obviously one, not a plausible wrong date.

Set on board entry: `upsertBoardFor` stamps `insightsTrialEndsAt` when the
player has none and the board is their first after `LAUNCH_AT`.

**Done when:**

- Two tests in opposite directions, because that distinction is the whole rule:
  a player whose first board predates `LAUNCH_AT` and who then enters one after
  it gets a clock starting at the LATER board; a player who never enters a board
  after launch never gets a clock at all.
- The field is written once and never re-stamped — a second board must not
  extend the trial.
- `insightsAccessFor(ctx, playerId)` returns which layers are visible,
  combining `isProFor` (already in `convex/access.ts`) with an unexpired trial.
  The decision itself lives in a pure function in `lib/insights-access.ts` so it
  is testable without a session; the Convex wrapper only supplies the inputs.
- Acceptance criterion 1 is protected: a test asserts that **nothing previously
  free has moved behind the paywall**. That is a hard constraint in the spec,
  not a preference — the launch email is aimed at people who already gave up
  once.

---

## Task A4 — Layer 1, the public benchmark

The `/insights` route and its benchmark panel.

**Free sees the most recently ENTERED board, not "today".** The spec says this
explicitly and the reason is backfill: filling in an earlier day is a free
feature, and a player who has just done so must get the benchmark for the day
they entered rather than an empty panel. "Most recent board" and "today's board"
diverge exactly on the path the free tier is meant to advertise.

Pro (or trial) sees every board plus the aggregates that need history.

**Done when:**

- Acceptance criterion 5: Layer 1 renders for a **free** player on their first
  board, with **visible CC BY 4.0 attribution**. Attribution is an obligation,
  so it gets its own assertion rather than riding along in a snapshot.
- `Disallow: /insights` is in `public/robots.txt` and
  `src/crawler-metadata.test.ts` is green — that suite fails on a route that is
  neither listed, disallowed, nor deliberately excluded, which is what will
  catch this being forgotten.
- The route is in the app menu.
- A board with no matching benchmark entry renders the absent state from A2, not
  a zero.

---

## Task A5 — Layer 2, personal history

Guess-count curve over months, opener repertoire with each opener's benchmark
rank, streaks and consistency. Computed from the player's own `dailyScores`, no
cohort, so no privacy rule applies.

**THE JOIN IS THE PRODUCT.** The spec's own example — *"You have opened with
MUSIC 41 times. It ranks 4,102nd. You average 4.6 guesses with it and 3.9 with
CRANE"* — is Layer 2's counts joined to Layer 1's ranks. Either half alone is
ordinary; the join is the sentence no other product can say. Build it as the
headline rather than as a table with a rank column bolted on.

**Done when:**

- `insights-personal.ts` is pure and unit-tested over fixture rows: opener
  frequency and mean guesses per opener, guess-count distribution by month,
  streaks.
- The empty and thin cases are designed, not accidental. The spec is explicit
  that this is empty for 368 of 392 accounts and that the emptiness is
  acceptable, because the ~24 players with history are the willingness-to-pay
  population — so "you have not entered enough boards yet" is a real state with
  real copy, not a bug.
- `answer` is `v.optional` on `dailyScores`, so rows without one must not break
  any statistic that reads it.
- Reads use `by_player_and_puzzleDay`; nothing scans the table.

---

## Task A6 — End to end across the boundary

**Because the four gates do not cross HTTP.** The spec's testing section names
this: the insights paywall crosses the boundary and no unit test covers it. As
of `wordle-teams-z6v4` Playwright IS now a blocking CI gate, so an e2e assertion
here is a gate rather than a thing somebody may run — which was not true when
the spec was written.

**Done when:**

- A free player sees the benchmark for one board and no personal history.
- A trial player sees both, and the trial's expiry flips them back.
- A Pro player sees both.
- The attribution is present in the served document.

---

## Out of scope for Plan A

- Layers 3 and 4, including the aggregates table and the ≥30 threshold — Plan B.
- Price, unit economics, paywall COPY and placement, lifecycle email — all
  `wordle-teams-iht`, per the spec.
- Board import — `wordle-teams-418`, section 2 of the same spec.
