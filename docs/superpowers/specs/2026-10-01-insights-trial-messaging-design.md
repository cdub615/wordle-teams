# The Insights trial, made visible — design

**Date:** 2026-10-01
**Issues:** `wordle-teams-a6pz` (epic)
**Builds on:** `docs/superpowers/specs/2026-09-05-pro-tier-and-insights-design.md` (the tier and the trial), `docs/superpowers/specs/2026-09-17-pro-month-window-design.md` (which shipped `src/lib/pro-benefits.ts`), and `docs/superpowers/specs/2026-09-18-marketing-pages-and-upgrade-dialog-design.md` (which shipped the upgrade dialog this spec's CTA opens)
**Status:** approved by the owner 2026-10-01

---

## 1. The defect

**Nothing in `src/` reads `trialActive`.** Grepped across `src/**/*.ts{,x}`: zero
consumers. The only trial-aware component in the app is
`components/trial-ended-card.tsx`, and it is gated on `trialExpired` — it fires
*after* the trial is over.

So the entire thirty-day Insights trial runs silently. A player mid-trial sees
their personal history, their openers, their twelve-month trend and their team's
full month, with nothing anywhere saying that those panels are normally Pro,
that they are free right now, or when they stop being free. **The first notice
any player ever receives that a trial existed is the card telling them it has
ended.** `convex/insights.ts`'s own header on `myAccess` names exactly this
population — *"the difference between a player who upgrades and a player who
assumes the feature broke"* — and then the client never used the field.

### 1.1 The launch email points the other way

This is worse than silence. `emails/launch-a-active.html:195` reads:

> All of the above is free. Pro is $49.99/year and adds the full month-by-month
> […]

That sentence went to players who, at the moment they read it, **had** those
deeper numbers unlocked. `emails/_partial-notes.md` records the Pro line as
present in segments A and B and *"absent from C entirely"*, and
`docs/runbooks/launch-email-send.md` §1.1 puts those segments at **8 active and
62 lapsed** of 402 named contacts — so roughly **70 recipients** were told the
thing they were being given costs money. A reader either concludes the whole
product is permanently free, or is simply confused. Neither is recoverable from
inside the email.

## 2. What the trial actually is, stated once

Two corrections to the working mental model, both read off
`convex/lib/insightsAccess.ts` rather than assumed. Both narrow what the
messaging may claim, which is why they lead this spec.

### 2.1 There is one mechanism, not two

There is no separate "launch trial" and "new-signup trial". `shouldStartTrial`
is a single rule: a player's **first board entered at or after `LAUNCH_AT`**
stamps `insightsTrialEndsAt` exactly once, ever, and a second board cannot
extend it. `LAUNCH_AT` is `Date.UTC(2026, 8, 30)` — 2026-09-30T00:00:00Z,
backdated to midnight by the owner on launch day — and `INSIGHTS_TRIAL_DAYS` is
30. A player signing up next March gets the same thirty days from their first
board.

That is a simplification worth banking: **one mechanism means one story**, and
the copy never has to distinguish a launch cohort from a later signup.

### 2.2 It grants Layers 2 and 3 only — it is not "a month of Pro"

`insightsAccess` computes `paid = isPro || trialActive` and applies it to
`layer2` and `layer3` **only**. `layer1` and `layer4` stay keyed to `isPro`
directly. So a trialist:

- gets the full personal-history surface (Layer 2) and the full team month
  (Layer 3);
- still sees Layer 1 as a free player — their most recent board, not their
  history;
- gets no Layer 4 at all;
- and **does not get the widened month window in `/app`**, because `access.ts`
  gates that on `isProFor`, which a trial fails. That file's own comment states
  the split in those words: *"The trial does not widen this window."*

The four Pro benefits that are **not** in the trial are therefore `teams`,
`scoring`, `import` and `months` — four of the five entries in `PRO_BENEFITS`.
Only `insights` is included.

**This is the single most important constraint on the copy.** Announcing "a free
month of Pro" would send players hunting for screenshot import and custom
scoring, find them locked, and conclude the app is broken. We would be
manufacturing a support problem out of a gift.

## 3. Decisions

Each of these was a live option and was chosen by the owner on 2026-10-01.

### 3.1 The clock is not touched

Considered: a one-time patch of `insightsTrialEndsAt` for the launch cohort so
the *messaged* trial is a full thirty days, and a wholesale widening of
`INSIGHTS_TRIAL_DAYS`. **Both rejected.** Launch was roughly twelve hours before
this spec, so every existing trial is a day or two old and has ~28–30 days left.
There is no cohort that has been shortchanged, and therefore no migration, no
"who counts as launch cohort" rule to defend, and no change to what `/pricing`
already promises.

### 3.2 It is an "Insights trial"

Considered: "a free month of Pro" (with the exclusions in fine print), "Pro
Insights, free for a month", and widening the trial in code so the generous claim
becomes true. **Rejected all three in favour of the narrow, honest name.**

It is already the shipped vocabulary — `TRIAL_ENDED_TITLE` reads *"Your Insights
trial has ended"* — so this choice makes `trial-copy.ts` internally coherent
rather than introducing a second name for one thing. It also dissolves §2.2's
expectation gap by construction: nobody infers screenshot import from an
*Insights* trial. The cost is honest and accepted: it sounds like a smaller gift
than "a month of Pro", because it is one.

### 3.3 In-app only

Considered: a ~70-person correction email to segments A and B, and an email timed
to expiry instead. **Rejected for v1.** Every trialist is by definition someone
using the app, so an in-app surface reaches **100% of the affected population**
with no list fatigue, no second send days after the launch one, and no outward-facing
action to authorise. The ~70 who read the contradicting line get corrected the
next time they open `/insights`.

### 3.4 Approach: one card plus two inline markers

Considered: the card alone, and the card plus markers plus a countdown chip in
the global `Header`. **The Header chip is rejected on two grounds**, and the
second is a real hazard rather than taste:

1. It would put trial copy on every route, including ones the trial does not
   change — a trialist's `/app` month window is still three months (§2.2), so a
   persistent "Insights trial" chip there over-claims.
2. It reintroduces the SSR clock hazard. `routes/pricing.tsx`'s header documents
   at length why a time-dependent value is read in the loader and serialised:
   a component that calls `Date.now()` itself recomputes during hydration and
   disagrees with an edge-cached document, which is the minified React #418 that
   `components/today-panel.tsx` and `components/scores-table.tsx` each record.
   Inside client-only `useQuery` data that hazard does not exist; in the `Header`
   it does.

**The card alone was rejected as insufficient** for the owner's actual ask —
that players realise *which parts* of what they are seeing is Pro. On
`/insights` the free Layer 1 benchmark and today's single team fact sit directly
beside the trial-unlocked panels. A page-top card can only say "some of this";
a marker says which.

### 3.5 No urgency escalation

Considered: copy that shifts tone under a threshold (≤7 days), and an explicit
"N days left" countdown. **Both deferred.** With launch twelve hours old, nobody
is near day 30, and a threshold nobody crosses is a tested boundary that proves
nothing. The end *date* carries the information. A pre-expiry warning is filed as
its own issue, due before the first expiries around **2026-10-30**.

## 4. Scope boundary

**No Convex changes. No schema changes.** `myAccess` (`convex/insights.ts`)
already returns the whole `InsightsAccess` object — `trialActive`, `trialEndsAt`,
`trialExpired` and all four layers — to the client, and `TrialEndedCard` already
consumes it. The entire defect is in `src/`.

`convex/e2eSeed.ts` already accepts an arbitrary `trialEndsAt` (*"Past values
make an EXPIRED trial"*), so a mid-trial account is a one-line seed and needs no
new test affordance.

**Explicitly out of scope:**

- Any change to the trial clock, length, or grant (§3.1).
- The pre-expiry warning (§3.5) — separate issue.
- Correcting the already-sent launch email. Filed as a note so the *next* send
  does not repeat the line; nothing is sent as part of this work.
- Layer 4. `globalComparison` is `isPro`-gated and server-enforced and still has
  **no consumer anywhere in `src/`**. Selling a surface nobody can reach is the
  defect `pro-benefits.ts`'s header names, and it is not fixed by mentioning it
  in trial copy.

## 5. The four populations

`myAccess` already distinguishes them. Exactly one is unhandled.

| State | Predicate | Today | This spec |
| --- | --- | --- | --- |
| Free, never trialed | `layer2 === 'none'`, no `trialEndsAt` | `insights-upsell` card, from `lib/insights-panel.ts` | unchanged |
| **Trial active** | **`trialActive`** | **nothing** | **card + markers** |
| Trial expired, not Pro | `trialExpired` | `TrialEndedCard` | unchanged |
| Pro | `isPro` | full page, no prompts | unchanged |

**The markers gate on `trialActive`, never on `layer2 === 'full'` or
`hasFullTeamMonth(layer3)`.** Those predicates are also true for a paying
subscriber, and labelling a subscriber's panels *"in your trial"* would be a
false statement to the one population that has already paid. This is the single
likeliest way to get this wrong, so it is stated here and pinned by a test in
§8.

## 6. Components

### 6.1 `src/components/trial-active-card.tsx` (new)

A sibling of `trial-ended-card.tsx`, built to the same shape for the same
reasons, and rendered in the same slot — `routes/insights.tsx:239`, where
`<TrialEndedCard />` already sits. The two are mutually exclusive by
construction: `trialActive` and `trialExpired` cannot both be true.

It uses `useQuery`, **not** `useSuspenseQuery`, for the reason
`trial-ended-card.tsx` gives in so many words: this card is an aside, and
suspending the route on it would make the page wait in order to tell somebody
about a trial. It returns `null` on `!access?.trialActive`, which covers Pro,
expired, free and signed-out in one condition with no second check to drift.

### 6.2 The marker

A `Badge` (`src/components/ui/badge.tsx`, already present) in **two** placements
— not four. Layer 2's three panels (`PersonalSummary`, `OpenersPanel`,
`TrendPanel`) are one visual group behind one gate at `routes/insights.tsx:470`,
so they take one marker between them; the team panel takes the second.

`trialActive` reaches them as a new prop on `InsightsPanel`, which already
receives `layer1`, `layer2` and `layer3` as bare props
(`routes/insights.tsx:450`–`452`). That matters for testability:
`routes/-insights.hook.test.ts` renders `InsightsPanel` directly, so the prop can
be exercised without driving the route or authenticating a Convex client —
which `wordle-teams-obw` records as impossible for the unit suite.

#### 6.2.1 Most trialists will see the thin state, not the panels

Found during spec review and material enough to record. The Layer 2 block has
two branches (`routes/insights.tsx`, on `isThin(data.boards)` from
`lib/insights-personal.ts`): the three panels, or an `UnlockPrompt` reading
*"Your history — N of 5 boards"*. `MIN_BOARDS_FOR_STATS` is 5, and the route's
own comment states that Layer 2 *"is empty for 368 of 392 accounts and that is
expected"*.

So for most trialists the trial-granted block renders a prompt asking for more
boards rather than any statistics at all. **The marker still renders, in both
branches, gated on `trialActive` alone.** Two reasons:

1. **One condition cannot drift.** Gating the marker on
   `trialActive && !isThin(...)` creates a second predicate that has to stay in
   step with the branch beside it, which is the class of bug `hasFullTeamMonth`
   was extracted to end.
2. **The thin state is where the marker says the most.** A player with three
   boards is being told that a surface they cannot fill yet is unlocked and free
   right now — which is a reason to keep playing during the window, and is
   precisely the audience the trial was aimed at. A badge on a prompt is mild
   noise; the alternative is silence for the majority.

This also sets expectations for what shipping this actually achieves: for most
of the population the card at the top of the page, not the markers, carries the
message.

### 6.3 `src/lib/trial-copy.ts` (extended)

New constants alongside the existing `TRIAL_ENDED_*` trio, in the same file for
the reason its header already states: *the copy is the deliverable and the
component is not.*

- `TRIAL_ACTIVE_TITLE` — names the state without alarm, the way
  `TRIAL_ENDED_TITLE` does.
- `TRIAL_ACTIVE_BODY` — that these numbers are normally Pro, that they are free
  right now, and when that ends. Structured to mirror `TRIAL_ENDED_BODY` so the
  two read as one voice to a player who will see both, a month apart.
- `TRIAL_MARKER_LABEL` — short enough for a badge.

### 6.4 `src/lib/format-day.ts` (extended)

One new exported function: an epoch-ms instant to a long calendar date
("October 30, 2026"). The file already has a private `longDay` formatter at
line 14 with exactly the right options, but it is module-scoped and every
exported *date* formatter in the file (`formatDayHeaderParts`,
`formatMonthLabel`, `formatDayLabel`) is keyed to `PuzzleDay`/`PuzzleMonth`
strings, whereas `trialEndsAt` is epoch milliseconds. So this is a new export reusing the
existing formatter instance, not a new formatter.

## 7. Copy constraints, and the guards that enforce them

Three rules already live in the codebase and all three bind the new constants.
Each is currently enforced over a corpus that does not include them, so each
guard is **extended**, not re-implemented.

1. **No price.** `trial-copy.ts`'s header: *"NO PRICE HERE… A number in this file
   would be a second source of truth that goes stale the moment the dashboard
   changes, silently, with every gate green."* The price reaches the player from
   `plans.ts`, via the upgrade dialog or `/pricing`.
2. **No completeness claim.** `PRO_BOARD_LIMIT` is 400 (`convex/insights.ts:24`)
   and `myBenchmarkBoards` `.take()`s it, so a Pro or trial caller gets their
   most recent 400 boards and nothing older. `COMPLETE_HISTORY_WORDS` in
   `pro-benefits.ts` is the shared list, already guarding three surfaces; the new
   constants join it. No "full history", no "every board".
3. **No claim on the four excluded benefits.** New, and it is this spec's own
   rule rather than an inherited one: the body must name neither import, nor
   custom scoring, nor team limits, nor the month window (§2.2). This is what
   makes the "Insights trial" naming load-bearing instead of decorative.

## 8. Testing

The repo's own history argues for testing this at the component seam rather than
trusting the gates. `trial-ended-card.hook.test.ts`'s banner records that
rewriting its sibling's CTA as `openUpgrade('header')` — and even as a completely
dead `onClick={() => {}}` — **passed the whole suite, `tsc`, `eslint` and the
build.** The new card is the same shape and inherits the same exposure.

- **`src/lib/trial-copy.test.ts`** — extended for all three rules in §7.
- **`src/components/trial-active-card.hook.test.ts`** (new) — jsdom, mirroring
  `trial-ended-card.hook.test.ts`, including its practice of mocking one layer
  down (`useConvexAction`) so the real hook runs inside the real provider.
  Renders for `trialActive`; returns `null` for Pro, expired, free and
  signed-out; hands the dialog the correct origin.
- **`src/routes/-insights.hook.test.ts`** — extended: the markers appear for a
  trialist and are **absent for a Pro subscriber** whose `layer2`/`layer3` are
  equally `'full'`. This is the §5 correctness point, and it is the assertion
  that fails if someone later "simplifies" the gate to the layer check.
- **`src/lib/plans.test.ts`** — the new `UpgradeOrigin` and its headline (§9).
- **`src/lib/format-day.test.ts`** — the new formatter, under `TZ=UTC`, which is
  what CI runs.
- **e2e** — a seeded mid-trial account (§4) sees the card and both markers; a
  seeded Pro account sees neither. E2E is **not** one of the four gates and is
  not run by them, so this is coverage, not a gate.

### 8.1 Timezone and hydration, stated rather than discovered

`trialEndsAt` is an absolute instant, and the calendar date it falls on depends
on the viewer's zone — two players can correctly see different end dates for the
same timestamp. That is the right behaviour (each sees their own local date) and
it is **safe here specifically because the card renders only from client-only
`useQuery` data**: `Intl` therefore only ever formats in the browser, never
during SSR, so there is no document-versus-hydration divergence and no exposure
to the React #418 hazard of §3.4.

**This is a reason the card must stay a `useQuery` aside and must not later be
promoted to loader-fed banner.** Recorded here because that refactor would look
like a performance improvement and would silently reintroduce the bug.

## 9. The CTA

A quiet, link-styled button — *see what Pro includes* in substance — opening the
existing upgrade dialog, rather than a primary **Upgrade** button. A hard
conversion CTA on day two of a free month sells to somebody who has already been
sold, and the owner's stated goal for this work is awareness, not conversion.

It needs a new member of `UpgradeOrigin` and a matching entry in
`UPGRADE_HEADLINES` (`src/lib/plans.ts`), because the origin is the only thing
that chooses the dialog's headline. Two existing constraints shape that headline
and it must be written against them rather than retrofitted:

- `plans.test.ts` measures the longest run of consecutive words a headline shares
  with **any** benefit title or body and fails at four. That guard exists because
  four separate headlines shipped restating the list beneath them.
- The dialog draws the headline directly above `PRO_BENEFITS` in full, so a
  headline that restates a benefit prints the same sentence twice on one screen.
  The house rule is that a headline names *what the player just reached for*.

Here the player reached for nothing — they are being told something. So the
headline speaks to the trial state itself, which no existing benefit entry
describes, and clearing the four-word guard should be comfortable.

## 10. Acceptance criteria

1. A player with `trialActive` sees, on `/insights`, a card naming the trial,
   what it unlocks, and the end date.
2. The Layer 2 group and the team panel each carry a marker, gated on
   `trialActive` — including in Layer 2's thin branch (§6.2.1).
3. A Pro subscriber sees neither card nor markers, and a test pins that
   specifically rather than incidentally.
4. Expired-trial, free and signed-out players see no new surface, and
   `TrialEndedCard`'s behaviour is unchanged.
5. New copy lives in `trial-copy.ts`, quotes no price, passes
   `COMPLETE_HISTORY_WORDS`, and names none of the four excluded benefits.
6. The CTA opens the upgrade dialog under its own origin, pinned by a test that
   would fail on a wrong origin or a dead handler.
7. `TZ=UTC pnpm test:once`, `pnpm typecheck`, `pnpm lint` and `pnpm build` are
   each run **separately**, with each exit code read.
