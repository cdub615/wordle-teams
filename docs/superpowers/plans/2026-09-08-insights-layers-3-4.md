# Insights, Plan B — team analytics and the dark global layer

## Design source

`docs/superpowers/specs/2026-09-05-pro-tier-and-insights-design.md`, section 3
(Layers 3 and 4). The spec settles the decisions; this plan sequences them.

Epic: `wordle-teams-4s0`. Plan A is
`2026-09-08-insights-layers-1-2.md` and this plan assumes its output —
specifically `insightsAccessFor` and the `/insights` route, both introduced
there.

## Scope, and the release rule

Layers 3 and 4. **Split from Plan A for planning, NOT for shipping** — the
owner's decision on 2026-09-08 was that everything releases together. Plan A's
scope section records why that is safe by construction: Phase 7.5 blocks the
cutover, production is v1 until the DNS flip, and beta is staging. Read that
paragraph before assuming this can trail.

---

## Task B1 — The per-team-per-month aggregate and its rollup

One document per team per month, written by the existing cron, so a Layer 3 view
is **one document read rather than a scan**. Bandwidth is the constraint
(`wordle-teams-dcu`) and this is the most read-heavy surface in the product.

The cron already exists — `convex/crons.ts` runs `reminders.sweep` hourly at :00
and `chatNotify.sweep` at :30 — so this is a third entry, not new
infrastructure. Its own comments state the `{}`-and-nothing-else rule for cron
args; follow it.

**Done when:**

- A schema table with an index that makes the read a point lookup by
  `(teamId, year, month)` — the shape `monthlyWinners` already uses with
  `by_team_year_month`.
- The rollup is idempotent: running it twice for the same month produces the
  same document, because a cron that double-counts on a retry is worse than one
  that misses.
- **The current month is recomputed, past months are not rewritten** unless a
  board changed — backfill is a free feature, so a player CAN edit an old month
  and the aggregate must follow. Decide and state the trigger; a cron that only
  ever touches the current month makes backfilled history permanently wrong.
- `cascadeDeleteTeam` sweeps the new table. It is the only code that deletes a
  `teams` document and it already collects six tables by `teamId`; a seventh
  that is forgotten is exactly `wordle-teams-2c1u` again, whose whole cause was a
  table added the day after the cascade was written.
- Unit tests over fixture rows, not over a live cron.

---

## Task B2 — Layer 3, the full team surface

Head-to-head against each teammate, team trend by month, most improved, team
average against each member, best and worst team days, per-member consistency.
Pro (or trial) only.

**PRIVACY IS ALREADY SETTLED AND MUST NOT BE RE-ARGUED HERE.** The spec
establishes by measurement that `getTeamMonth` (`convex/scores.ts`) already
returns every teammate's `guesses` and `answer` to every member, and
`team-boards.tsx` renders them. Team analytics therefore summarises data
teammates can already read board by board — it exposes nothing new. That is why
the ≥30 threshold belongs to Layer 4 and NOT here; applying it to Layer 3 would
suppress a five-person team's own numbers from itself, which is both wrong and
the opposite of the feature.

**Done when:** each view reads the aggregate rather than scanning boards; the
statistics are pure and unit-tested over fixtures; a team with one member, or a
month with no boards, renders a stated empty state rather than a divide-by-zero.

---

## Task B3 — The free team fact, and its hook

*"You beat three of four teammates today."* One fact, pinned rather than left
open, and it earns a "see the full month →" pointing at the paywall.

**Pinned to one thing on purpose.** The spec rejects "one free fact per month"
explicitly and gives the arithmetic: the surface is roughly six view types
multiplied by teammates and months — hundreds of cells for a five-person team
over a year — so one fact a month is under a sixth of the view types, a rounding
error of the data, and not a cadence anyone notices. It would advertise nothing.
Daily, shareable, and one read from the aggregate already being computed.

**Done when:**

- It says so plainly when **nobody else has entered today**, rather than
  comparing against an empty set and claiming a win over zero people. That case
  is the common one on a small team early in the day and is the most likely
  thing to look broken.
- It is one read from B1's aggregate.
- The "see the full month →" target is a placeholder that `wordle-teams-iht`
  owns — paywall placement and copy are explicitly out of scope in the spec.
  Wire the affordance, do not invent the pitch.

---

## Task B4 — The ≥30 threshold, per slice

**One constant, evaluated per slice at render time.** "Contribute" means a
distinct player holding at least one board counted into that slice: a per-day
percentile counts players who entered a board that day; an opener comparison
counts players who have used that opener at least once.

**PER SLICE, NOT ONE GLOBAL FLAG**, because cohorts differ wildly in size — a
per-day percentile draws only on players who played that exact day, while a
lifetime opener comparison draws on everyone who ever used it. Views light up
independently as the data supports them.

**Two justifications, kept apart because they bite at different sizes**, and
both belong in the code comment: re-identification (a daily percentile over six
players, combined with team boards a member can already read, lets a stranger's
score be inferred by subtraction) and meaninglessness ("top 20% globally" when
global is six people). The second bites first.

**30 is a convention, not a derivation** — the conventional large-sample rule of
thumb, against a k-anonymity practice that ranges from 5 to 50 by sensitivity.
The owner accepted it knowingly. Say so where it is defined, so the next reader
does not go looking for a derivation that does not exist.

**Done when:** acceptance criterion 6 is met — **one constant**, and a test in
**both directions**: a slice below the threshold renders nothing, and a slice at
exactly the boundary renders. The spec is explicit that a threshold tested in
one direction is vacuous, and this repo has the scars to match.

---

## Task B5 — Layer 4, built and switched off

Percentile against other players. Pro only, no free slice.

**"SWITCHED OFF" IS THE THRESHOLD ITSELF, NOT A SEPARATE FLAG.** With 70
activated players and ten holding most of the 7,594 boards, essentially no slice
reaches 30 contributors, so the layer is dark by construction and lights up on
its own as the corpus grows. That is the whole design: the spec's reasoning is
that the layer was **mis-specified rather than blocked** — benchmarking against
computed optimality (Layer 1) is public, free and just as true at 70 players as
at 70,000, while benchmarking against other humans needs a corpus only Wordle
Teams has and that is not yet deep enough.

If the owner also wants an explicit kill switch, that is a separate decision and
is not assumed here.

**Done when:** the views exist and are exercised by tests at both sides of the
threshold; nothing renders today against real data volumes; and no view can
render a percentile without passing through B4's constant.

---

## Task B6 — End to end for the free fact

The free team fact is the most shareable thing in the product and the one Layer 3
surface an unpaid player sees, so it crosses the paywall boundary that no unit
gate covers.

**Done when:** a free member of a team sees the fact and the "see the full month
→" hook; a Pro member sees the full surface; and the nobody-else-entered-yet
case renders its own copy rather than a comparison against zero.

---

## Out of scope for Plan B

- Price, unit economics, paywall copy and placement — `wordle-teams-iht`.
- Season retrospective and team identity — deferred in the spec.
- Everything on the spec's do-not-build list, which is deliberate rather than
  pending.
