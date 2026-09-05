# What Pro is at relaunch — the tier, board import, and insights

**Design for `wordle-teams-efrc`, and the re-spec of `wordle-teams-418`
(roadmap #2, board import) and `wordle-teams-4s0` (roadmap #3, insights).**
Written 2026-09-05, after a brainstorm with the owner, at the start of Phase 7.5
(`wordle-teams-wty4`).

It supersedes the "open questions" bodies on `418` and `4s0` where the two
conflict. It does **not** supersede `wordle-teams-iht` (roadmap #7), which still
owns price, unit economics and the conversion funnel; this feeds it.

---

## Why this exists

`efrc` asked what Pro should actually BE at relaunch, on the grounds that the
launch email is the one moment when the most people will look at the product
with fresh eyes and the most people will meet the paywall for the first time.
Deciding the paid surface after that moment wastes it.

**The owner's framing decision, taken first because everything else is judged
against it: Pro's job is to fund the product as a real business** — revenue,
not cost recovery. That points at fewer, richer paid surfaces aimed at
willingness to pay, rather than a broad cheap tier.

### Two corrections to the issue's premise, found in the code

`efrc` says "the paid tier's only real substance is the team cap — v1's rule,
ported." Both halves needed adjusting.

**Pro already gates two things, not one.** Custom scoring is Pro
(`scoring-system-card.tsx:60`, `canEdit = isCurrentMonth && isPro && isOwner`,
with the server half in `scoringSystems.ts`), and the
Forgiving/Competitive/Custom presets shipped 2026-09-04. Pro already sells
control, not just capacity.

**The cap is stranger than its description.** `FREE_TEAM_LIMIT = 2` caps *teams
per player*, not players per team — team size is unbounded
(`waiting-on.ts:28`). Server-side it is enforced in exactly two places and both
are *joining*: `invitePlayerFor` parks the invite of a non-Pro player already on
two teams, and `completeProfileFor` claims at most two invites at signup.
`createTeam` does not enforce it at all — decision K left that UI-only in
`team-picker.tsx:48`.

So the enforced wall lands on the person being invited to a third team, and
invites are the only growth channel that works. The parked invite *is* surfaced
— `Header.tsx:85` shows a badge on `isPro === false && pendingInvites > 0` — so
this is a deliberate upgrade prompt rather than a silent drop. It stays. But it
is a paywall pointed at the viral loop, and that tension is why the tier
question could not be answered without first settling what Pro is for.

---

## The candidate set, with the case against each

`efrc` asked for candidates grouped by what they sell, each with its honest
counter-argument and its build cost, plus an explicit do-not-build list.
Recorded in full so the same ideas are not re-proposed.

### Capacity

| Candidate | Cost | The case against | Verdict |
| --- | --- | --- | --- |
| Team cap = 2 (existing) | free | Taxes the invite loop, the one channel that works | **Keep** — it is the only lever converting anyone today |
| Cap free team *size* | cheap | Punishes the organiser for succeeding; `qix`'s one sustained-usage team was five players; takes away something free | **Do not build** |
| History depth (free sees last N months) | cheap | Takes away, and punishes the longest-tenured teams — the returning population the email targets | **Do not build** |

### Insight

| Candidate | Cost | The case against | Verdict |
| --- | --- | --- | --- |
| Public-benchmark insights | cheap, static data | None material | **Build** — Layer 1 |
| Personal history | cheap | Empty for 368 of 392 accounts | **Build** — Layer 2, and the emptiness is acceptable because the ~24 with history are the willingness-to-pay population |
| Team analytics | cheap, precomputed | None material; a team is a consented group | **Build** — Layer 3 |
| Global human comparison | cheap to compute | Corpus far too thin; see the threshold rule | **Build, switched off** — Layer 4 |
| Season retrospective | cheap | Once-a-year value against a monthly price | **Defer** to `iht` as an annual-plan hook |

### Convenience

| Candidate | Cost | The case against | Verdict |
| --- | --- | --- | --- |
| Board import from a screenshot | the largest build here | Accuracy risk; see the architecture below | **Build** — deterministic and client-side |
| Share-text (emoji grid) import | cheap | Gives colours without letters, and we store words — may save the user nothing | **Do not build**; see "Alternatives ruled out" |
| Reminder customisation | cheap, Phase 6 built it | Reminders are an activation tool; gating them hurts the 82% who never played. Currently free — takes away | **Do not build** |
| Past-day backfill | — | **Already free and already works.** `board-entry/form.tsx` has a day selector across the month and `pickDefaultDay` lands on an unplayed one | **Not a candidate** |

### Status

| Candidate | Cost | The case against | Verdict |
| --- | --- | --- | --- |
| Team identity (avatar, colour, custom celebration) | cheap | Pure status; weak willingness to pay on its own | **Defer** — a sweetener, never a reason |

### Do not build, with reasons

- **Solver or assistant features.** Corrupts the honest-play premise the whole
  product rests on. Already out of scope on `4s0`.
- **Ads, or monetising the data.** Already out of scope on `iht`.
- **Usage-metered pricing.** Needs a third Polar product; `efrc`'s own
  constraint says that is a materially bigger change and must not be costed as
  equal.
- **Free team-size cap, history-depth paywall, gating reminders.** All three
  take away something currently free. The launch email is aimed at people who
  already bounced off once; a free product that gets worse is how you lose them.

---

## Directions considered, and why individual Pro

Three coherent tier shapes were put to the owner.

**A — Team plan.** One organiser pays; their whole team gets custom scoring,
team analytics and unlimited membership. Fits the product's social shape and
converts one motivated person instead of five individual decisions. **Ruled
out by the owner**, and the objection is right: at ten active players you need
one person to volunteer to fund the others, the four beneficiaries have no
reason to ever convert, and if the payer lapses the whole team loses the
features. Fragile in a way you would feel immediately. It also needs a Polar
unit-of-sale change.

**B — Individual Pro, insight-led.** Cheapest to build, ships without touching
billing, anchored on data nobody else has.

**C — Individual Pro, convenience-led.** Import is the anchor, insights are the
depth. Highest willingness to pay if the parse works.

**CHOSEN: B and C together.** Individual Pro selling convenience *and* insight.
The unit of sale does not change and the two existing Polar products stay.
Crucially, **team analytics does not require a team plan** — gate it on the
*viewer* being Pro and a Pro member sees the analysis for their teams, with no
free-rider problem and no billing change. That recovers A's best feature
without A's fragility.

**The named risk:** the anchor is the most expensive build on the roadmap. If
import slips, the tier leans on insights alone, which are thin for anyone
without history. The mitigation is Layer 1 below, which is real from a player's
very first board.

### An honesty note the owner accepted knowingly

`418`'s stub justifies the paywall on the grounds that import "has a real
marginal cost, which makes it an honest thing to put behind Pro rather than an
artificial gate." **Parsing client-side removes that marginal cost entirely.**
The gate is now a product decision, not cost recovery. It remains fair —
convenience is an honest thing to sell, and it is net-new so nothing is taken
away — but the argument written on that epic no longer holds and should not be
quoted as if it does.

---

## 1. The tier

| | Free | Pro |
| --- | --- | --- |
| Teams you can be on | 2 | unlimited |
| Custom scoring | — | ✔ (unchanged) |
| Board entry, backfill, reminders, chat | ✔ | ✔ |
| Board import | — | ✔ |
| Insights Layer 1 — public benchmark | today's board | all history + aggregates |
| Insights Layer 2 — personal history | — | ✔ |
| Insights Layer 3 — team analytics | today's team fact | ✔ full surface |
| Insights Layer 4 — global comparison | — | ✔ per slice, once ≥30 |

**Nothing currently free moves behind the paywall.** That is a hard constraint,
not a preference: the launch email is aimed at people who already gave up once.

**The tier explains itself in one line: free shows you today, Pro shows you
everything you have done.** That sentence is the pricing page and the email.

### The trial

One month of Layers 2 and 3, on a per-player `insightsTrialEndsAt`.

**The clock starts on the player's first board entry after launch, not at
launch.** A calendar window anchored to launch expires while a dormant player is
still dormant, and dormant returners are exactly who the email is for. Starting
at first board covers the returning population and every future signup with a
single rule, one field and one comparison.

---

## 2. Board import

**Runs entirely in the browser. No vendor call, no upload, no image leaves the
device.** This settles `418`'s "where does the image go?" in the strongest
direction available: there is nothing to persist and nothing to disclose. It
also works offline and costs nothing per parse.

### Stage 1 — Find the lattice, not the board

Do not look for "a Wordle board." Quantise the image, take connected components
that are near-square and of similar size, then fit a regular grid by voting on
(x-pitch, y-pitch, origin). Accept any maximal lattice with exactly five columns
and one to six populated rows.

This is what buys tolerance to partial crops, status bars, screenshots of
screenshots and arbitrary scale: none of those produce a competing five-wide
lattice of equally sized squares. **This stage carries the residual risk of the
whole feature and is the thing to prototype first**, against real screenshots
from the owner's own devices, before the epic is planned.

### Stage 2 — Classify colour by relation, never by hex

Cluster the observed tile colours rather than matching known values. The
unsaturated cluster is *absent*.

**High-contrast mode is the trap**: it replaces green/yellow with blue/orange,
and a hardcoded palette silently mislabels every tile on the board. Hue
detection works, but Stage 4 makes it unnecessary — try both mappings and keep
whichever is consistent. Nothing breaks when NYT nudges a shade.

### Stage 3 — Read glyphs

Filled tiles are white letters in one uniform font at high contrast. Twenty-six
classes, size-normalised template matching. No model, no training data, no
inference dependency.

### Stage 4 — Constraint repair

**This is where the accuracy comes from, and it is the part `418`'s stub does
not anticipate.** Two constraints that general OCR does not have:

1. Every row must be a word in the accepted-guess list (14,855 entries in
   the benchmark corpus below — NYT has edited the list since the original
   12,972, so take the size from the shipped artifact rather than from memory).
2. Every row's colours must be exactly what Wordle emits for that guess against
   the answer.

So a shaky `CRANF` has exactly one repair. Score every candidate on (per-letter
OCR confidence × pattern consistency) and take the maximum. This converts a
per-character problem into a near-certain per-word one.

**Where the answer comes from**, in order: the solved final row when the board
was solved; else the `answer` field the user already fills in; else word-list
constraints alone. The last case is weaker but still strong, and it applies only
to failed boards.

**The stage also knows when it failed.** If no valid word fits a row, that is a
detected failure rather than a silent wrong save — which is the property that
makes the whole feature safe to ship.

### Stage 5 — Never write silently

The parse pre-fills the existing entry form; the user confirms or corrects.
Every correction is logged as (tile, read, actual). **That log is the labeled
corpus**, accumulating from real use — which is what `418`'s acceptance
criterion asks for and could not otherwise obtain.

### Proving accuracy without waiting for users

`418`'s acceptance criterion requires a labeled corpus of real user screenshots
across light/dark, iOS/Android and app/web. That corpus does not exist and
cannot be gathered quickly from seventy players, ten of whom are most of the
activity.

**Synthesise it instead.** The tile geometry is known, so render boards across
theme × platform × size × crop × JPEG quality and generate thousands of labeled
samples for free. Then property-test: random answer, random valid guesses,
render → parse → assert exact round-trip. That is a stronger bar than a few
hundred hand-labeled images and it exists on day one. Stage 5's corrections then
supply the real-world corpus over time.

### Failure paths

- **A screenshot of the share card** has no letters. Detect it and say so
  specifically — a generic failure here reads as a broken feature.
- **Anything unparseable** falls back to manual entry, pre-filled with whatever
  was recovered. A failed parse must never cost the user their board.
- **Non-NYT clones** with different fonts are out of scope.

---

## 3. Insights

### Layer 1 — Public benchmark

Opener rank out of 14,855 scored openers, opening-*pair* rank out of 500
evaluated pairs, and per-day difficulty percentile across 1,900 dated puzzles
joined on `puzzleDay`.

Source: the FiveLetterWords research corpus, **CC BY 4.0**, twelve datasets.
Word lists originate from the archived dracos and cfreshman sources.
**Attribution is an obligation, not a courtesy** — the insights surface needs a
visible credit.

**Ships as a static build artifact, not in Convex.** It is identical for every
user and never changes per player, and `wordle-teams-dcu` establishes that
database bandwidth is the binding cost limit — putting a constant in the
database spends the scarcest resource for nothing. Lazy-load it when insights
are opened.

Free users see **the most recent board they have entered**, refreshed as they
enter — stated that way rather than as "today" because backfill is free and a
player filling in an earlier day must get the benchmark for the day they just
entered, not an empty panel. Pro sees every board plus the aggregates that need
history.

### Layer 2 — Personal history

Guess-count curve over months, opener repertoire with each opener's benchmark
rank, streaks and consistency. Computed from the player's own scores. No cohort.

**The join of Layers 1 and 2 is the thing worth paying for:** *"You have opened
with `MUSIC` 41 times. It ranks 4,102nd. You average 4.6 guesses with it and 3.9
with `CRANE`."* No other product can say that.

### Layer 3 — Team analytics

Head-to-head against each teammate, team trend by month, most improved, team
average against each member, best and worst team days, per-member consistency.

**Precomputed into a per-team-per-month aggregate by the existing cron**, so a
view is one document read rather than a scan — again because bandwidth is the
constraint.

**Privacy footing, established by measurement rather than assumption:**
`getTeamMonth` (`convex/scores.ts`) already returns every teammate's `guesses`
and `answer` to every member, and `team-boards.tsx` renders them. Team analytics
therefore summarises data teammates can already read board by board. It exposes
nothing new.

Free users get **today's team fact**, pinned to one thing rather than left
open: *how many of the teammates who have entered today the player has beaten*,
phrased as "you beat three of four teammates today". When nobody else has
entered yet it says so instead of comparing against an empty set. It is one read from the aggregate already being computed, recurs daily, is
the most shareable thing in the product, and earns a "see the full month →" that
points at the paywall.

> **Rejected: one free fact per month.** The surface is roughly six view types
> multiplied by teammates and months — hundreds of cells for a five-person team
> over a year. One fact a month is under a sixth of the view types and a rounding
> error of the data, and monthly is not a cadence anyone notices. It would
> advertise nothing.

### Layer 4 — Global human comparison, built and switched off

Percentile against other players. **Pro only, with no free slice.**

**The threshold: a slice renders only when ≥30 distinct players contribute to
it, evaluated per slice at render time.** "Contribute" means a distinct player
holding at least one board counted into that slice — so a per-day percentile
counts players who entered a board on that day, and an opener comparison counts
players who have used that opener at least once.

Two separate justifications, worth keeping apart because they bite at different
sizes:

- **Re-identification.** A daily percentile over six players, combined with the
  team boards a member can already read, lets a stranger's score be inferred by
  subtraction. This is the rule `4s0`'s acceptance criteria require.
- **Meaninglessness.** "Top 20% globally" when global is six people is a ranking
  of six friends presented as a population claim. This is a quality argument, not
  a privacy one, and it bites first.

**30 is a convention, not a derivation** — the conventional large-sample rule of
thumb; k-anonymity practice ranges from 5 to 50 by sensitivity. The owner
accepted 30 knowingly.

**Per slice, not one global flag**, because the cohorts differ wildly in size: a
per-day percentile draws only on players who played that exact day, while a
lifetime opener comparison draws on everyone who ever used that opener. Views
light up independently as the data supports them.

### Why the corpus question resolved this way

`4s0`'s body asks how much history exists post-migration. Measured 2026-09-05:
**392 players, 70 have ever entered a board, 24 have ten or more, ten hold most
of the 7,594 boards.**

The public alternative is thinner. The only project collecting opt-in human
Wordle play — the Wordle Observatory, also CC BY 4.0 — holds **26 games across
22 puzzles**, with most rows suppressed for low sample size. No source publishes
per-player human guess data.

**So the layer was mis-specified rather than blocked.** Benchmark against
computed optimality, which is public, free and just as true at 70 players as at
70,000. Benchmarking against other humans needs a corpus that only Wordle Teams
has and that is not yet deep enough — hence Layer 4, built and dark.

---

## Testing

- **Import** — property test round-trips over synthesised boards (Stage 4 above)
  is the primary bar. Unit tests on lattice fitting, colour clustering, glyph
  matching and constraint repair as separable units. Mutation testing per
  project convention.
- **Insights** — Layer 4's threshold needs a test that a slice below the
  threshold renders nothing, and one that it renders at exactly the boundary.
  Both directions, because a threshold tested in one direction is vacuous.
- **The trial** — a test that the clock starts at first board and not at launch,
  because that distinction is the entire reason the rule exists.
- **e2e** — import and the insights paywall both cross the HTTP boundary and
  neither is covered by the four gates. `wordle-teams-5jcn.14` applies.

---

## Out of scope

- Price, unit economics, paywall placement, lifecycle email and the conversion
  funnel. All `wordle-teams-iht`.
- Season retrospective and team identity — deferred, recorded above.
- Everything on the do-not-build list, which is deliberate rather than pending.
- Cross-team or global chat, DMs, file sharing — `wordle-teams-qix`'s exclusions
  are untouched.

---

## How this decomposes

This spec settles decisions that interlock across three issues, which is why it
is one document. **It is not one implementation plan.**

- **`wordle-teams-efrc`** is answered in full by the tier, the candidate set and
  the do-not-build list. Its output feeds `wordle-teams-iht`, which still owns
  price and unit economics. Close it against this spec.
- **`wordle-teams-418`** takes section 2 as its design and gets its own plan.
  Its first task is the Stage 1 prototype against real screenshots — the epic
  should not be fully planned until that risk is measured.
- **`wordle-teams-4s0`** takes section 3 as its design and gets its own plan.
  Layers 1 and 2 are independent of Layers 3 and 4 and can ship first.

The two epics are independent of each other and can run in parallel, which is
what Phase 7.5's rewiring on 2026-09-05 was for. `iht` stays blocked on both.

---

## Acceptance criteria

1. Pro gates exactly what the tier table says, and nothing previously free has
   moved behind the paywall.
2. Board import parses without any network call, verified by a test that fails
   if the parse path issues one.
3. Import accuracy is measured against a synthesised labeled corpus with a
   stated pass bar, and correction logging is in place before general
   availability.
4. A failed parse never destroys or overwrites an existing board.
5. Layer 1 renders for a free user on their first board, with visible CC BY 4.0
   attribution.
6. Layer 4 renders nothing for any slice below 30 distinct contributors,
   enforced in one constant and tested in both directions.
7. The trial clock starts at a player's first board after launch, for returning
   and new players alike.
