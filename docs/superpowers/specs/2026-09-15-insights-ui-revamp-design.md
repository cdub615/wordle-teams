# Insights UI revamp — design

**Date:** 2026-09-15
**Issue:** wordle-teams-wty4.1.11 ("Insights: the UI refinement pass — needs a brief from the owner before any code")
**Status:** approved by the owner 2026-09-15

This document is the written brief that wty4.1.11 has been blocked on. That issue's
DONE WHEN is "the owner has signed off on a specific, written brief — not
'refinement' — and either child issues exist for it or this closes with the
evidence that the page is fine." This is that brief.

---

## 1. Why this work exists

The owner walked v2 before launch and listed "insights UI refinement" as one of
seven observations. wty4.1.11 correctly refused to act on it, because "refinement"
was a reaction rather than a specification. This design supplies the specification.

The brief given on 2026-09-15 was: **make the page align with the design system,
and make it read as a quality product that provides value exceeding its price
tag** — which is now $49.99/year or $4.99/month (decided 2026-09-11, recorded on
wordle-teams-iht).

### The diagnosis

The problem is not spacing. The page has **exactly one visual treatment** and
applies it to all of its content:

- Four cards, each `space-y-4 text-sm`, each a stack of `<h3 className="mb-1
  font-medium">` over a `<ul>` of `flex justify-between` rows with a muted
  right-hand value. Nothing is emphasised, so nothing is.
- **No figure is ever rendered at display size.** Every number on a statistics page
  sits at 14px inside a muted string. It does not read as a statistics product.
- **It does not follow this project's own design system.** Card titles are
  `text-base`; `DESIGN_SYSTEM.md` §7 specifies `text-2xl font-semibold`. The route
  wrapper is `mx-auto w-full max-w-2xl p-4` where `team.tsx` uses `page-max` and
  `max-w-3xl`. The back button carries a "Back" text label that no other page has.
- **Zero accent.** Design principle #1 is "neutral plus one accent — green is the
  only colour that earns attention." The page is entirely greyscale.
- **The signature component never appears.** Principle #5 is "the board is the
  signature." The page about board performance renders no tiles.
- **Nothing is visualised.** `attemptsByMonth` renders as a text list. Attempt
  distribution — the canonical Wordle statistic — is absent entirely.
- **The paid panels do not feel paid.** The only value claim on the page is a muted
  `text-sm` sentence above the footer.

### Scope decision

Three options were put to the owner: (A) systematic polish within the existing
structure, (B) restructure and visualise, (C) rethink the product surface with new
queries and pickers. **The owner chose B.**

C was argued against and ruled out: what the layers *contain* belongs to
wordle-teams-4s0, paywall placement and conversion copy belong to
wordle-teams-iht, and wty4.1.11's own boundaries hand both away. C would pull
scope back out of those epics and hold the launch.

---

## 2. Scope

### In scope

The visual state of `/insights`: layout, hierarchy, typography, colour, responsive
behaviour, empty states, and new **client-side derivations** of data the page
already receives.

### Explicitly out of scope

| Concern | Owner |
| --- | --- |
| What the layers contain; Layer 4; the global cohort rule | wordle-teams-4s0 |
| Paywall placement, conversion copy, pricing | wordle-teams-iht |
| Screenshot-import accuracy | wordle-teams-418 |
| Team and month pickers for Layer 3 | wordle-teams-iht (per the `TeamSection` comment) |

### The hard constraint: no new Convex queries

Everything specified below is derived **client-side** from data
`api.insights.myBenchmarkBoards` and `api.insights.teamMonth` already return.
`myBenchmarkBoards` returns `{ puzzleDay, guesses, answer? }` per board — the full
guess arrays and the answer — which is sufficient for attempt distribution, the
month trend, difficulty splits and real coloured tiles.

This is not an incidental property. **wordle-teams-dcu** establishes that database
*bandwidth*, not function calls, is the binding Convex free-tier limit, and
wordle-teams-yhii found the deployment at 45% of that ceiling with no user traffic.
A redesign that added per-panel queries would be the wrong trade. Adding one is a
scope change and must be raised, not absorbed.

---

## 3. What the corpus can and cannot support

`public/insights/benchmark-openers.json` and `benchmark-difficulty.json` were
inspected directly while writing this spec, because the first draft of the hero
depended on a figure that does not exist.

| Artifact | Contains | Does **not** contain |
| --- | --- | --- |
| `benchmark-openers.json` | `count` (14,855) and `words`, one concatenated ranked string | Any per-word attempt average |
| `benchmark-difficulty.json` | `firstDay`, `count` (1,907), `percentiles[]` — one difficulty percentile per day | Any attempt average, global or per day |

**There is no global mean-attempts figure, so there is no "par" to compare a
player against.** An early draft of the hero read "4.32 — 0.38 better than par,
benchmark average 4.70". That line is unbuildable and has been removed.

What the corpus *can* do is rank an opener and rate a day's difficulty. Both are
used below. Everything else compares the player against **themselves** or against
**their team**, from their own boards.

---

## 4. The design

Panel order is unchanged from what ships today, and deliberately so: the current
order was itself a correction made on the owner's feedback (the daily list used to
lead and buried the two paid panels). The owner re-confirmed on 2026-09-15 that
**personal history stays first** — "that's what users will be interested in first".

```
Header  →  Your game (hero)  →  Your openers  →  Your trend
        →  Your team  →  Day by day  →  upsell  →  attribution
```

### 4.1 Header

- Back control becomes **icon-only**: `<Button variant="ghost" size="icon"
  aria-label="Back to dashboard">` wrapping a `<Link to="/app">` with a bare
  `<ArrowLeft className="h-4 w-4" aria-hidden="true" />`. This is verbatim the
  shape `team.tsx` and `chat.tsx` already use; insights is the only page that
  diverges, and the word "Back" is what the owner asked to remove first.
- `<h1>` becomes `text-2xl font-bold`, matching `team.tsx`.
- Route wrapper becomes `page-max` with `max-w-3xl`, matching `team.tsx`. The page
  currently sets `mx-auto w-full max-w-2xl p-4` and so does not participate in the
  app's single `--page-max` contract.
- A scope line sits under the title: `308 boards · since March 2024`. It states
  what the page is computed from, which nothing currently does.

### 4.2 Your game — the hero

Replaces the six-cell `<dl>` of equal-weight statistics.

**Lead figure.** Average guesses, `text-4xl md:text-5xl font-bold tabular-nums`.

**Comparison — trailing form (option A, chosen by the owner).**
> **4.32** lifetime · last 30 boards **4.02** ▲ *your best stretch yet*

Derived from the player's own boards — needs neither the corpus nor a team. Shown
once the player has 40 boards (§6); below that the slot carries an unlock prompt
(§6.1) rather than a comparison against itself. The delta is coloured `text-success`
when the recent window is better and left neutral (`text-muted-foreground`) when it
is not — never `text-destructive`. This page is not for scolding.

**Attempt distribution.** Horizontal bars for 1–6 and X, each labelled, count
right-aligned `tabular-nums`. The modal row fills `bg-accent-solid`; every other
row is `bg-muted`. This is the single highest-value addition on the page — it is
the statistic every Wordle player recognises and it is currently absent.

**Supporting statistics**, on a `border-t`: current streak, longest streak, solved
rate, spread (±). Four values, demoted from the six equal cells they replace. Solved
rate is `solved / (solved + failed)` from the existing `consistency()`, shown as a
percentage — replacing the separate "Solved" and "Missed" counts, which stated the
same fact twice and neither at a glance.

### 4.3 Your openers

**The advice callout.** Today `insights-headline` states two averages and leaves
the player to do the subtraction. It should close the loop:

> You average **4.6** with **MUSIC** and **3.9** with **CRANE**.
> Opening CRANE instead would save you about **0.7 guesses a day**.

Rendered as a callout with a `border-l-[3px] border-accent-solid` on `bg-muted`.
This is the sentence the 4s0 spec says no other product can say; it should look
like it.

**The difficulty line (option B).** A second sentence in this card, using the one
thing the corpus is actually good for:

> You average **4.61** on days the world found hard, and **3.94** on the rest.

Rendered only when both bands hold enough boards to be stable (§6); otherwise the
slot carries an unlock prompt (§6.1).

**Opener rows.** Per opener: the word as tiles, a bar showing relative mean
attempts, the mean `tabular-nums`, rank as a `Badge`, and use count.

> **Opener tiles are uncoloured** — border-only, the board's `empty` state, letters
> at full contrast. A word used 41 times has 41 different colourings, so there is
> no single correct one, and inventing a colour semantic here (hit-rate, say) would
> overload green/yellow, which mean exactly one thing in this product. The tiles
> carry the board's *shape and typography*, not a result. Coloured tiles appear
> only in §4.6, where a real answer exists.

### 4.4 Your trend

`attemptsByMonth`, drawn rather than listed. Vertical bars, most recent
highlighted in `bg-accent-solid`, the rest `bg-muted`. Axis label states the
direction explicitly — *avg guesses · lower is better* — because a bar chart where
shorter is better is otherwise ambiguous.

**Capped at the last 12 months.** A two-year player would otherwise get 24 bars at
~11px on a phone, and the count grows without bound. Twelve is a year and a natural
comparison. One line of interpretation sits beneath on a `border-t`.

### 4.5 Your team

Reworked `TeamPanel`. Head-to-head leads, because it is the most engaging content
on the page and currently renders as a list row.

- **Two-person team:** a versus block — the viewer's wins against the opponent's, at
  `text-3xl tabular-nums`, viewer's figure in `text-success`, ties and shared days
  stated beneath.
- **Larger team:** a standings table of the same records with the viewer's row
  pinned and carrying `bg-pinned-self` (the existing helper class, which exists
  precisely for this and is currently used by the scores table).
- **Averages** become bars: viewer, each member, then team, so the comparison is
  visible rather than arithmetic.
- **Best and worst day** stay, as a two-up on a `border-t`.

The card title takes the **team's name** rather than the generic "Your team", with
"Your team" retained as the fallback for an unnamed team — the same three-state
treatment `chat.tsx` already applies to its heading.

**The no-team empty state is filled.** `TeamSection` currently returns `null` for a
player on no team — a silent empty state, and a v1 migrant can land in it. It gains
a stated card inviting the player to join or create a team. wty4.1.11 names this
gap explicitly, so closing it is in scope.

### 4.6 Day by day

Bounded height, own scroller, and the count beneath are all **kept** — that
structure is load-bearing (400 cards would otherwise push everything above it off
the page) and its reasoning is recorded in the current source. What changes:

- Each row renders the **real board** as a mini tile grid, coloured via the
  existing `tileStates(answer, guess)` from `src/lib/wordle.ts`. Tiles stay square
  and unrounded at every size, per principle #5.
- The score appears as `3/6` at the row's right, `tabular-nums`.
- Opener rank becomes a `Badge` rather than a muted string.
- Difficulty keeps its label and sentence, with the label at full contrast.
- The two absent states are **unchanged in wording**: an opener the corpus does not
  hold still reads "is not in the benchmark set" (never a zero), and a day outside
  the artifact's range still reads "not rated yet". Both are load-bearing and
  documented in the current source.

### 4.7 Upsell and attribution

The upsell gains the presence of a real card rather than a muted paragraph.

**`upsellFor()` is not modified** — neither its logic nor its copy semantics.
Placement and conversion copy belong to wordle-teams-iht. What changes here is only
how the existing string is presented, which is this page's visual state.

The attribution footer is unchanged in content and remains read out of the
artifact. CC BY 4.0 requires credit where the data is shown; this is an obligation,
not a styling decision.

---

## 5. Responsive behaviour

Mobile is the primary surface — the app is an installed PWA locked to portrait.
The design was reviewed at a true 390px at real type sizes and approved on
2026-09-15.

**Only three things reflow.** Everything else is one layout at both sizes, which
keeps the breakpoint surface small.

| Element | Mobile | `md:` and up |
| --- | --- | --- |
| Hero | Stacked — lead figure and comparison on one row, distribution full-width beneath | Side by side |
| Supporting statistics | 2×2 grid | 4 across |
| Opener rows | Two lines — tiles + rank + count, then bar + mean | One line |

Reasoning, so it is not re-litigated: the distribution bars need ~360px to be
readable and a side-by-side hero leaves them stubs at 358px of content width; four
statistics across 358px gives each ~85px, which does not hold "97.7%" plus its
label; a single-line opener row at 358px leaves ~130px for the bar, too little to
read a comparison from.

### Touch targets

- Back button: `size="icon"` (40px) with a negative inline-start margin so the
  glyph still optically aligns with the `h1` beneath it.
- The two filter `<select>`s go **full-width, stacked under the card title** on
  mobile, and become `h-9`. They are currently `px-2 py-1 text-xs` — roughly 24px
  tall, well under the 44px minimum, on the page's only interactive controls.

---

## 6. States

Every state below must render deliberately. "Deferred silently" is not an outcome,
per the parent epic's acceptance criteria.

| State | Condition | Treatment |
| --- | --- | --- |
| Loading | `isPending` or corpus unresolved | Existing skeletons, restyled to the new panel shapes |
| Corpus failed | `loadInsightsBenchmark()` rejected | Existing message, unchanged wording |
| No boards | `data.boards.length === 0` | Existing message, unchanged wording |
| Thin history | `isThin(boards)` — fewer than `MIN_BOARDS_FOR_STATS` (5) | Unlock prompt (§6.1), carrying the existing message's value clause. **Not a failure** — the 4s0 spec is explicit that Layer 2 is empty for 368 of 392 accounts and that this is acceptable |
| Free tier | `access.layer2 !== 'full'` | Personal panels absent; page is team fact + day-by-day + upsell card |
| No team | `getMyTeams()` empty | **New** stated empty state (§4.5) |
| Team, no boards this month | `stats === null` or `days.length === 0` | Existing message, restyled |
| Solo team | No opponents in `headToHead` | Existing message, restyled |
| Trailing form unavailable | Fewer than 40 boards | Hero shows the lead figure, with an unlock prompt (§6.1) where the comparison would sit. Never a fabricated or partial-window comparison |
| Difficulty split unstable | Either band holds fewer than 10 boards | The §4.3 difficulty line is replaced by an unlock prompt (§6.1) |

### The two sample-size floors, fixed here

Both are pinned in this spec rather than left to implementation, must be named
constants in `src/lib/`, and must each be covered by a unit test at the boundary.

**Trailing form — window 30, floor 40 boards.** The lead figure is the lifetime
mean and the comparison is the mean of the last 30 boards against it, which is an
ordinary moving-average comparison. The floor exists because at exactly 30 boards
the window *is* the lifetime and the delta is necessarily zero; 40 leaves at least
10 boards outside the window, so the comparison is against something.

**Difficulty split — hard is percentile ≥ 65, floor 10 boards per band.** The
threshold reuses the corpus's own band boundaries rather than inventing one:
`difficultyLabel()` puts "Tricky" at 65–89 and "Hard for the solver" above 89, so
≥ 65 is exactly "the two harder bands". Days the artifact does not cover are
excluded from both bands, not defaulted into either.

Neither floor is the ≥30-contributor cohort rule. That is Layer 4's *privacy*
threshold and belongs to 4s0. These are sample-size floors on the viewer's own
data, where no privacy question arises.

### 6.1 Unlock prompts — an unmet floor is an invitation, not a blank

Wherever a floor is unmet, the slot the insight would have occupied renders an
**unlock prompt** instead of collapsing. The owner's reasoning, taken 2026-09-15:
a player should know that more is coming, what specifically it is, and how close
they are — so the floor becomes an incentive to keep entering boards rather than a
silent absence.

The pattern already exists in one place and is being generalised rather than
invented: the current thin-history message names exactly what is coming ("your
opening repertoire, your streaks and how your scores move month to month"). What it
lacks is the distance.

**Every unlock prompt states three things, in this order:**

1. **What unlocks** — named concretely, never "more insights"
2. **What it will tell them** — one clause of actual value
3. **How far away it is** — a count *and* a progress bar, so the distance is
   readable at a glance

| Slot | Floor | Renders |
| --- | --- | --- |
| The whole personal card | 5 boards (`isThin`) | "Your history unlocks at 5 boards" · repertoire, streaks, month-to-month · `3 / 5` |
| The hero's comparison line | 40 boards | "Your form trend unlocks at 40 boards" · how your last 30 compare with your all-time average · `12 / 40` |
| The openers card's difficulty line | 10 boards in each band | "Your difficulty breakdown unlocks at 10 hard days" · how you score when the world struggles · `4 / 10` |

For the difficulty prompt, the count shown is **the band that is actually short**.
When both are short it names the hard band, which is the rarer of the two — the
corpus puts roughly 35% of days at percentile ≥ 65, so it is the binding one.

**Rules, so this cannot turn into nagging:**

- **At most one unlock prompt per card.** If a card's whole contents are gated
  (the thin state), that prompt *is* the card and no inner prompt renders.
- **An unlock prompt is visually distinct from the upsell.** The upsell asks for
  money; this asks for play. The upsell keeps the accent treatment of §4.7; unlock
  prompts are muted — `text-muted-foreground`, a `bg-muted` progress track, and the
  filled portion in `bg-muted-foreground` rather than the accent. Green is reserved
  for what the player has *achieved*, which is the §4.2 and §4.4 usage.
- **Never a countdown to something they cannot reach.** These floors are all
  reachable by playing. Nothing that depends on tier, team membership or corpus
  coverage gets an unlock prompt — a free player sees the upsell, a player on no
  team sees §4.5's invitation, and a day the artifact does not cover keeps its
  existing "not rated yet".
- **The prompt disappears the moment the floor is met.** No "just unlocked" state,
  no persistence — the insight itself appearing is the reward.

This is one shared component, `unlock-prompt.tsx`, taking the label, the value
clause, and `{ have, need }`. It is not three bespoke messages.

---

## 7. Structure of the work

### New pure functions

All go in `src/lib/`, all are pure, all get unit tests. This is where the logic
lives so that components stay renderable and the maths stays testable without a DOM.

In `insights-personal.ts`:

| Function | Returns |
| --- | --- |
| `attemptDistribution(boards)` | Counts for 1–6 and X, plus which is modal |
| `trailingForm(boards, window)` | `{ lifetime, recent, delta, isBest }` or `null` when the window cannot be filled |
| `openerAdvice(repertoire)` | `{ from, to, savingPerDay }` or `null` |
| `trendWindow(months, limit)` | The last `limit` months, plus the best one |

New, and the only one that reads the corpus:

| Function | Returns |
| --- | --- |
| `difficultySplit(boards, benchmark)` | `{ hard, rest }` mean attempts, or `null` when either band is under the floor |

`difficultySplit` uses the existing `dayDifficulty()` from `insights-benchmark.ts`.
It must tolerate `null` — a day outside the artifact's range is the common case,
not an edge case, since today is always outside it.

### Component decomposition

`src/routes/insights.tsx` is 517 lines today and holds the route, `PersonalHistory`,
`Stat`, `DailyBenchmark` and `BoardCard`. The revamp adds material to every one of
them. It gets split:

| File | Holds |
| --- | --- |
| `src/routes/insights.tsx` | Route, guard, corpus hook, the four top-level branches, panel composition — and **no panel rendering of its own**. Soft target ~150 lines; the binding criterion is the boundary, not the count, because this codebase's comments are load-bearing and a line budget must not be met by deleting them |
| `src/components/insights/personal-summary.tsx` | The hero |
| `src/components/insights/attempt-distribution.tsx` | The distribution bars |
| `src/components/insights/openers-panel.tsx` | Advice callout, difficulty line, opener rows |
| `src/components/insights/trend-panel.tsx` | The month bars |
| `src/components/insights/daily-benchmark.tsx` | Filters, bounded scroller, count |
| `src/components/insights/board-row.tsx` | One day's row |
| `src/components/insights/mini-board.tsx` | The tile grid, shared by `board-row` |
| `src/components/insights/unlock-prompt.tsx` | The §6.1 prompt — one component, three call sites |
| `src/components/insights/team-panel.tsx` | Existing file, reworked |

Two constraints on the route file survive the split and are recorded in its current
source — both must be preserved:

1. **`InsightsRoute` must stay unexported.** The vite plugin silently declines to
   code-split a route file whose routed identifier is also exported.
   `src/routes.test.ts` pins this.
2. **`loadInsightsBenchmark()` must not be lifted into a shared module.** The
   corpus is ~79 KB and is fetched only on this code-split route, so a player who
   never opens insights never pays for it. CI greps `dist/client` to enforce it.

`InsightsPanel` stays exported for `src/routes/-insights.hook.test.ts`, and
`onATeam` stays a visible prop for the reason the current source gives: a hidden
query inside the panel is unreachable from that test.

---

## 8. Accessibility

- Both charts are **lists, not images**. The distribution renders as a `<ul>` whose
  rows carry the attempt count and the board count as text; the trend renders the
  same way. A screen reader gets the numbers, not a shrug.
- Mini boards are `aria-hidden` with the score (`3/6`) adjacent as real text. A
  tile grid read letter by letter is noise; the score is the information.
- Colour is never the sole carrier. The modal distribution row is also the longest
  bar and its count is emphasised; the trailing-form delta carries ▲/▼ as well as
  colour.
- Every `<select>` keeps its existing `aria-label`.
- Bar widths animate only under `motion-safe:`.

## 9. Theme

Every colour is a token. No hardcoded hex, no `dark:` forks outside the token
layer. The page must be screenshotted in **both** themes before it is called done —
V2-ADDENDUM §5 records that `vite build`, `tsc --noEmit` and the full test suite
were all green while the Switch was invisible and the Separator zero-height. The
toolchain cannot see this class of bug.

## 10. Testing

- **Unit tests** for all five new pure functions, including every `null` branch.
- **Component tests** follow the existing `*.hook.test.ts` jsdom pattern (15 such
  files exist; jsdom is opt-in per file, the default is edge-runtime).
- **Every existing `data-testid` is preserved** where the element retains its
  meaning. All 27 are load-bearing across `e2e/`, `-insights.hook.test.ts` and the
  component tests. Where a testid's meaning genuinely changes — `insights-consistency`
  covers a six-cell `<dl>` that becomes four statistics plus a distribution — the
  test is updated in the same commit and the change is called out in the commit
  message. A testid is never silently dropped.
- **e2e is not one of the quality gates.** `test`, `tsc` and `build` never run
  Playwright. The insights e2e specs must be run explicitly before this is called
  done.
- **Screenshots in both themes at 390px and at desktop width**, per §9.

## 11. Acceptance criteria

1. The word "Back" is gone; the control is icon-only with an `aria-label`, matching
   `team.tsx` and `chat.tsx`.
2. The page uses `page-max`, `max-w-3xl` and an `h1` of `text-2xl font-bold`.
3. The hero renders the lead figure at display size with the trailing-form
   comparison, and omits the comparison rather than faking it when the window
   cannot be filled.
4. Attempt distribution renders, with the modal row in the accent.
5. The openers card renders the advice callout with its explicit conclusion, and
   the difficulty line when both bands clear the floor.
6. The trend renders as bars, capped at 12 months.
7. The team panel leads with head-to-head and names the team.
8. A player on no team sees a stated empty state.
9. Day-by-day rows render real coloured tiles; the list stays bounded and counted.
10. Every state in §6 renders deliberately, and every unmet floor renders an
    unlock prompt naming what unlocks, what it will tell them, and how far away it
    is — never a blank and never a bare "not enough data".
11. Unlock prompts are visually distinct from the upsell, and at most one renders
    per card.
12. No new Convex query is added.
13. `src/routes/insights.tsx` renders no panel itself; every panel is its own
    component under `src/components/insights/`.
14. All four quality gates pass, the insights e2e specs pass, and the page has been
    screenshotted in both themes at both widths.

## 12. Decisions recorded

| Decision | Chosen | Alternatives ruled out |
| --- | --- | --- |
| Scope | B — restructure and visualise | A (polish only) leaves four identical lists; C pulls scope from 4s0 and iht and holds the launch |
| Panel order | Personal history first | Team-first was raised and declined by the owner: "that's what users will be interested in first" |
| Hero comparison | A — trailing form vs lifetime | "Better than par" is unbuildable (§3). B (difficulty-adjusted) lands in the openers card instead |
| Difficulty insight | Kept, as a line in the openers card | Dropping it wastes the corpus's one real strength |
| Opener tiles | Uncoloured, border-only | A per-use colouring does not exist; a hit-rate colouring would overload green/yellow |
| Card titles | `text-lg md:text-xl` | `DESIGN_SYSTEM.md` §7 says `text-2xl font-semibold`. **A stated deviation:** five 24px titles on a page this dense out-shout the numbers, which are the content. `today-panel.tsx` already deviates the same direction with `text-sm md:text-base`. Approved as shown in the mockup on 2026-09-15 |
| Unmet sample floors | An unlock prompt naming the insight, its value and the distance | A blank slot, or a bare "not enough data", both of which spend a chance to give the player a reason to keep entering boards. Owner's call, 2026-09-15 |
| Trend window | Last 12 months | Unbounded growth; 24 bars at ~11px on a phone |
| New queries | None | Bandwidth is the binding Convex limit (wordle-teams-dcu) |

## 13. Risks

- **The tile grid is new surface area on the densest list on the page.** A 400-board
  history renders 400 mini boards inside the scroller. They are plain divs with no
  images and the container is already bounded, but render cost should be checked
  with a realistic history rather than assumed.
- **`text-lg md:text-xl` card titles are a stated deviation from §7.** Recorded here
  so it is a decision rather than drift, and so the next person finds the reasoning.
- **The two sample-size floors in §6 are not yet fixed.** They are deliberately left
  to the plan, and must end up stated in code and covered by a test rather than
  chosen implicitly.
