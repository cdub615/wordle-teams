# The locked team teaser — design

**Date:** 2026-09-17
**Issue:** wordle-teams-iht.2 ("Tease the paid team panel with the viewer's own locked data, not a screenshot")
**Depends on:** wordle-teams-iht.3 (shipped 2026-09-17) — the Layer 3 payload gate and the rank
**Status:** approved by the owner 2026-09-17

---

## 1. Why this work exists

The owner asked, walking v2 before launch: *"Should we add a screenshot to the free
insights page as a teaser of what they're missing out on?"*

iht.2's answer was yes to the teaser, no to the screenshot — build it from the
viewer's own data instead, because a screenshot goes stale silently (which
`public/welcome-screenshot.png` did within weeks), strangers' numbers persuade less
than your own, and an image of a UI inside the UI reads as an ad rather than as
product.

That answer stands. What has changed is the ground under it.

### Two findings that move the design

**The figures are genuinely gone now.** iht.2 asked for "the real Layer 3 panel …
with the figures obscured — blurred, or replaced with a lock", and warned that "a
blur a reader can defeat with devtools is not a paywall." That framing assumed the
numbers reached the client and were merely hidden. As of iht.3 they do not reach it
at all: a free viewer is sent identities, today's entry and a rank, and nothing
else. So there is nothing real left to blur, and any blurred figure this design
drew would be **invented** — the "invented team's head-to-head" iht.2 rejected,
wearing the viewer's own team's name. The blur option is therefore off the table on
its own former merits.

**There is a dead control on the free tier today.** `daily-team-fact.tsx` renders a
"See the full month →" button whenever `fact.kind === 'beat'`, and
`team-section.tsx` never passes `onSeeFullMonth`. It renders with `onClick=
{undefined}`: it is visible on beta right now and does nothing when clicked. It is
also exactly the affordance this issue needs, so it is fixed here rather than
filed separately.

---

## 2. What is being built

A second card on `/insights`, below the existing daily-fact card, for a free
member of a team. It shows the real shape of the paid panel with every figure
redacted, and one call to action.

```
┌─ insights-daily-fact ─────────────┐   unchanged, except the dead link goes
│ You beat 2 of 3 teammates today.  │
└───────────────────────────────────┘
┌─ insights-team-locked ────────────┐   NEW
│ Alpha Analysts · Sep 2026         │
│ You're 3rd of 5 this month        │   ← the headline; four variants, §4
│                                   │
│ Head to head                      │
│   Grace Hopper      ▨▨▨▨▨▨       │   ← real name, redacted value
│   Ada Lovelace      ▨▨▨▨▨▨       │
│ Averages                          │
│   You vs team       ▨▨▨▨         │
│                                   │
│ [ Unlock team insights ]          │
└───────────────────────────────────┘
```

### Decision 1 — two cards, not one

*Rejected: growing the existing card; rendering one blurred panel.*

Keeping the daily fact untouched and adding a separate card draws the line the
owner asked for — **what you have** above, **what you don't have but would**
below. Growing the one card blurs that line; the single blurred panel is the
option the first finding rules out.

### Decision 2 — redacted, not locks-only, not prose

*Rejected: a list of the four section names with lock glyphs; rows that describe in
prose what you would learn.*

The redacted treatment is the only one of the three that **looks like the thing
being bought**: after upgrading, the bars become numbers and nothing else on the
card moves. The locks-only list is a feature list that says nothing about the
viewer, and so persuades about as well as the landing page already does. The prose
option carries the exact staleness risk this issue was written to avoid — sentences
describing the panel age silently when the panel changes.

### Decision 3 — the card always appears, with four headlines

*Rejected: showing the card only when a rank exists.*

The owner's reasoning, and it overrides the tidier rule: **the players with too
little engagement to be ranked are the ones most at risk of never getting there**,
so they are precisely the ones who need to see what is possible. Hiding the card
from them optimises the card and loses the player.

So the card is always rendered for a free member, and only the headline changes —
to say what would make the numbers appear. The rows below never change and are
never faked.

### Decision 4 — the unlock goes straight to checkout, for now

*Rejected: blocking on wordle-teams-iht.1; building an indirection seam.*

iht.2 says this affordance "should route through that interstitial rather than
jumping to checkout", but iht.1 is unbuilt and needs a design conversation that has
not happened. This wires to `useStartUpgrade` like the four affordances that exist
today. iht.1's own premise is a single shared component behind one call site, so it
re-points every caller including this one; a fifth caller costs it nothing and
makes the teaser shippable now.

### Decision 5 — a solo team gets a different call to action

The one state where the CTA is **"Invite a teammate"** rather than "Unlock team
insights". `team-panel.tsx` itself tells a solo player "You are the only member of
this team, so there is nobody to compare with" — so upgrading would not deliver the
thing the card is showing. Selling it anyway is selling a dud, and it is the one
place where pushing the upgrade actively costs trust.

---

## 3. The server amendment

States 2, 3 and 4 below are **indistinguishable to the browser**. After iht.3 the
free client holds identities and today's entry; it cannot tell "you have not
played this month" from "nobody else has", because both are facts about the
per-member totals that the gate deliberately withholds.

The server knows. So `teamMonth`'s `rank` stops being a nullable pair and becomes a
tagged value:

```ts
rank:
  | { kind: 'ranked'; rank: number; of: number }
  | { kind: 'not-played' }      // the viewer has no boards this month
  | { kind: 'nobody-else' }     // the viewer has played; no teammate has
  | { kind: 'solo' }            // the team has one member
  | null                        // pro or trial — they have the real panel
```

**A month with no aggregate row at all** — nobody on the team has played yet, so
`teamMonthStats` has no document — resolves to `not-played`, not `nobody-else`.
The viewer has no boards in that month either, so the ask is genuinely on them.
`teamMonth` already treats a missing aggregate as an empty month rather than an
error, and that stays true.

This replaces `teamRank`'s `{ rank, of } | null` return. The ranking rules
themselves are unchanged and stay as they were mutation-tested in iht.3.3:
competition ranking, the denominator counts members who played, and the comparison
is on the rounded average `memberAverages` displays.

**It leaks nothing new.** Each tag is a fact the viewer can already establish: they
know whether they have played, the roster size is on the dashboard, and
"nobody else has played" is visible in the scores table.

---

## 4. The four states

| State | When | Headline | Rows | CTA |
|---|---|---|---|---|
| **Ranked** | viewer and ≥1 teammate played | "You're 3rd of 5 this month" | real names | Unlock |
| **Not played** | viewer has no boards this month | "See where you rank this month" / "Enter a board and you'll have a standing." | real names | Unlock |
| **Nobody else** | viewer played, no teammate has | "You're the only one playing so far" / "When your teammates join in, you'll have a standing." | real names | Unlock |
| **Solo** | team of one | "Team insights need a team" / "Invite someone and this fills in." | generic | **Invite a teammate** |

Two of these deserve their reasoning recorded:

- **Not played vs Nobody else are different sentences on purpose.** One asks the
  reader for something; the other tells them it is not their fault. Collapsing them
  into one line would blame a diligent player for their teammates' silence.
- **Solo is the only state with generic rows**, because it is the only one with no
  real teammate names to use.

---

## 5. Architecture

**New component: `components/insights/team-locked-card.tsx`.**

Takes what it renders and decides nothing about tiers:

```ts
{
  teamName: string
  month: PuzzleMonth            // rendered through `formatMonthLabel`
                                // (lib/format-day.ts) — which yields "Sep 2026",
                                // NOT "September"; daily-benchmark and
                                // trend-panel already render it that way
  roster: { playerId: string; firstName: string; lastName: string }[]
  viewerId: string
  rank: TeamRankTeaser          // §3's tagged value, NEVER null here: the card
                                // renders only on the free branch, and `null` is
                                // the pro/trial case that branch cannot reach
  onUpgrade: () => void
  onInvite: () => void
}
```

It is rendered by `team-section.tsx`'s existing free branch — the one already
guarded by `!hasFullTeamMonth(layer3)` — beneath `DailyTeamFact`, from the same
`teamMonth` response. **No new query and no new document read**, which iht.2 names
as a requirement.

`onInvite` navigates to `/team` carrying the current `?team=`, where
`current-team-card.tsx`'s Invite control lives — the same destination the app bar's
"Team settings" already uses. A deep-link anchor (`id="invite"`, the mechanism
`id="scoring"` uses for ScoringLegend's Edit) is optional polish and not required
here.

`onUpgrade` and `onInvite` are props rather than hooks called inside, following the
convention `team-section.tsx` documents for `onTeamChange`.

**Not because a component may not call `useStartUpgrade`** — three do today
(`Header.tsx`, `trial-ended-card.tsx`, `board-entry/import-upsell.tsx`, the last of
which records the convention explicitly as "ONE MORE CALLER OF useStartUpgrade").
The reason is narrower and real: `onInvite` needs the **router**, and a component
calling `useNavigate` for itself cannot be rendered bare in a jsdom test without a
`RouterProvider` around it. Taking both as props keeps the pair symmetrical and the
component renderable, which is how every other component test in this directory
works.

**Changed: `daily-team-fact.tsx`** — the dead "See the full month →" button and its
unused `onSeeFullMonth` prop are removed. The locked card below now answers the
question that button was asking, and keeping it would put two competing calls to
action in one region.

**Changed: `convex/insights.ts` and `convex/lib/teamStats.ts`** — `teamRank`
returns the tagged value of §3.

---

## 6. Testing

- **`convex/insights.test.ts`** gains a case per tag, asserted **on the response**
  the way the rest of that file is, since the tag is a server fact. The existing
  cases for what the free payload withholds are unaffected and must stay green.
- **`convex/lib/teamStats.test.ts`** — the five mutation-tested ranking rules from
  iht.3.3 must survive the return-type change unchanged. If any of them needs
  editing to pass, the change has altered behaviour and is wrong.
- **`team-locked-card.hook.test.ts`** (new, jsdom) — one test per state: the
  headline, that real names appear in the three non-solo states, that the solo
  state shows the invite CTA and the others show upgrade, and that **no digit ever
  appears inside a redacted value slot**. That last one is the regression test for
  the whole design — it fails if anyone fills a redacted bar with a placeholder —
  and it is scoped to the slots rather than to the card, because the `ranked`
  headline legitimately contains two numerals ("3rd of 5").
- **`team-section.hook.test.ts`** — the locked card renders for a free viewer and
  never for pro or trial.
- **e2e `insights.spec.ts`** — a free member of a team sees the locked card and the
  upgrade control; a pro member does not.

---

## 7. Out of scope

- **The interstitial** (`wordle-teams-iht.1`). This wires to checkout; that issue
  re-points it along with the other four affordances.
- **The paid panel.** Untouched.
- **Layers 1, 2 and 4.** This is Layer 3 only.
- **The upsell copy elsewhere on the page** (`insights-panel.ts`'s `teamLocked`
  sentence). It already mentions team analytics as of wty4.1.4 and is not rewritten
  here; iht.1 owns what Pro is said to include.
