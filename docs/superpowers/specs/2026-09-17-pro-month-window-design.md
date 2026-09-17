# The Pro month window — design

**Date:** 2026-09-17
**Issue:** `wordle-teams-kusd` (filed during this brainstorm)
**Blocks:** wordle-teams-iht.1 (the upgrade interstitial), wordle-teams-wty4.1.14 (the marketing pages)
**Status:** approved by the owner 2026-09-17; amended 2026-09-17 after the
adversarial review of the plan (§0)

---

## 0. What the adversarial review of the plan changed

Four reviewers were run against the first plan, on separate failure modes. They
found ten blockers and no false positives. Five changed this spec rather than only
the plan, and they are recorded here so the reasoning is not lost:

- **The Pro window could be narrower than the free one** (§3). No `FREE_MONTHS`
  floor on the Pro branch meant a team younger than three months gave its Pro owner
  a shorter dropdown than its free members — upgrading would have removed months.
  The first draft's tests asserted this as correct.
- **The window could be empty, and then crash the server** (§3). `puzzleDay` is an
  unvalidated `v.string()`, so a stored `''` makes the span `NaN` and the window
  `[]` — violating the element-0 invariant the whole termination argument rests on,
  for a reachable input.
- **A bare year defeats the gate** (§4). `{ month: '2026' }` sorts above the Pro
  floor and lexically brackets a whole year, which `convex/scores.ts:180` already
  documented as a property of this function.
- **The two-ways-in split was not implementable and would have raced** (§4). Now
  one behaviour: always correct.
- **The ScrollArea did not exist, and was redundant** (§5).

Two factual errors in the first draft are corrected in place and named here because
they had already propagated: `V2-ADDENDUM.md`'s "no pro month gate yet" is at
**`:450`** (row 50), not `:446` (row 48) — the wrong line reached the beads issue
too — and `formatMonthLabel` renders **"Mar 2023"**, not "March 2023".

---

## 1. Why this work exists

This was not on the roadmap. It surfaced while verifying the premises of
wordle-teams-iht.1, which asks for an interstitial that tells a player what Pro
includes before sending them to checkout. Writing that sentence truthfully
required knowing what Pro includes, and the answer did not survive contact with
the code.

`src/components/home/feature-cards.tsx` — the only description of Pro anywhere in
the product — sells "unlimited months, unlimited teams, customizable scoring
systems, and more". Checked against the gates:

| Claim | Reality |
| --- | --- |
| unlimited teams | Shipped. `FREE_TEAM_LIMIT = 2` (`convex/lib/teamLimits.ts:23`), enforced in `players.ts`, `teams.ts:722`, `inviteLinks.ts:166` |
| customizable scoring | Shipped. `scoring-system-card.tsx:60` |
| "and more" | Screenshot import (`board-entry/form.tsx:857`; `:858` is the upsell shown in its place), Insights Layer 2 and Layer 3 (`convex/insights.ts:211`) |
| **unlimited months** | **Not shipped.** `month-picker.tsx:38` returns exactly three months, for everyone, Pro included |

`docs/design-system/V2-ADDENDUM.md:450` (row 50) states it outright: *"v2 has no pro month
gate yet — `monthOptions` returns three months for everyone."* It was deferred out
of Phase 2 and again out of Phase 3, deliberately and with reasons, and nothing has
picked it up since.

**THAT MAKES IT A LAUNCH-FACING REGRESSION, NOT MERELY A GAP.** v1 ships the
expansion today — its month dropdown wraps a `ScrollArea` with a computed height
(`src/components/action-buttons/month-dropdown/utils.ts`) precisely because a Pro
player's list gets long. So a v1 Pro subscriber who migrates to v2 does not fail to
gain history; they **lose** history they are currently paying for, in the same week
the launch email invites them to come back. Nobody would have noticed until a
subscriber wrote in.

The owner's call, given both options, was to ship the expansion rather than drop
the claim. This spec is that work.

### What this unblocks

iht.1 and wty4.1.14 both describe what Pro includes, and doing them independently
risks two descriptions of one tier. The shared substance turns out to be narrow and
concrete — **one verified inventory of the Pro gate**, which exists nowhere today.
It cannot be written honestly until the month window exists, or it gets written
twice. So it is built here, at the end (§6), and both downstream specs consume it.

---

## 2. What is being built

Four things, in dependency order:

1. `convex/lib/monthWindow.ts` — the rule, as pure functions with no imports.
2. `api.scores.monthWindow` — a query supplying the rule's inputs for a team.
3. The window applied: the dropdown widens for Pro, `getTeamMonthFor` enforces it,
   and `routes/app.tsx` corrects an out-of-window `?month=` (§4).
4. `src/lib/pro-benefits.ts` — the canonical inventory, which §1 explains.

Free behaviour is unchanged except for one new row in the dropdown (§5).

---

## 3. The rule

```ts
// convex/lib/monthWindow.ts
monthWindowFor({ currentMonth, earliestMonth, pro }): Array<PuzzleMonth>  // newest first
serverFloorFor({ currentMonth, earliestMonth, pro }): PuzzleMonth        // the oldest the server serves
proTeaserMonth({ currentMonth, earliestMonth, pro }): PuzzleMonth | null // what to advertise, or nothing
```

**Free returns `[currentMonth, −1, −2]`** — byte-identical to what
`month-picker.tsx:38` returns today.

**`monthOptions` IS DELETED, NOT LEFT DELEGATING.** Its signature takes only
`currentMonth`, so it cannot express the new rule; keeping it as a wrapper leaves a
function any future caller can reach that silently answers "three months" for a Pro
player. Its two callers (`month-picker.tsx:51`, `routes/app.tsx:1142`) move to
`monthWindowFor`, and `month-picker.test.ts` — which pins descending order and
strict monotonicity, and holds for a list of any length — moves with them.

**Pro returns every month from `earliestMonth` through `currentMonth` inclusive**,
newest first, uncapped. Uncapped is the owner's decision and the point of the work:
a cap of twelve — which is what `src/lib/insights-months.ts` chose for its own
window — would still lose roughly two dozen months for a team dating to 2023, which
is exactly the population this is meant to reassure.

**NO `CAP` CONSTANT HERE, AND THAT IS A DEPARTURE FROM `insights-months.ts` WORTH
STATING.** That file caps at 12 so its list renders without scroll math. This one
accepts the scroll math instead (§5), because its job is v1 parity and v1 has no
cap. The two windows are different rules for different controls and must not be
unified; `insights-months.ts`'s own header already says so in the other direction
("It is not a drop-in for the scores picker, which still owes its own score-based
expansion") — that sentence is now discharged, and should be updated to say so
rather than left predicting work that has happened.

**THE PRO WINDOW IS NEVER NARROWER THAN THE FREE ONE.** Its length is
`max(FREE_MONTHS, span)`, and that floor is the single most important line in this
file. Without it, a team younger than three months gives its Pro owner a one- or
two-row dropdown while the free members beside them still get three — so
**upgrading would visibly remove months**, which is the exact regression this whole
spec exists to close, reintroduced inside the rule that closes it. Every team
created during the launch window this work is aimed at is in that range. The
adversarial review of the plan found this; the first draft of both this section and
its tests asserted the broken behaviour as correct.

**THE SPAN IS BOUNDED ABOVE, TOO, AND NOT FOR TIDINESS.** `earliestMonth` derives
from `dailyScores.puzzleDay`, which `upsertBoard` accepts as a bare `v.string()`
with no shape check anywhere on the server — so a hand-rolled mutation can store
`''` or `'1000-01-01'`. `''` makes the span `NaN`, `Array.from({length: NaN})`
returns `[]`, and the element-0 invariant below is then violated for a *reachable*
input — with `serverFloorFor` reading `months[-1]` and throwing a `TypeError`
inside `getTeamMonth`, taking the dashboard down for every Pro member of that
team rather than for the author. So: a non-finite span falls back to
`FREE_MONTHS`, and the length is capped at `MAX_MONTHS` (120 — v1 teams date to
2023, so that is generous). `serverFloorFor` must also be arithmetic rather than
`monthWindowFor(...).at(-1)`, so it never materialises a 12,000-element array to
read one value. The unvalidated `puzzleDay` itself predates this work and is filed
separately; this spec must not be the thing that turns it into an outage.

**TWO CLAMPS, BOTH BORROWED FROM `teamMonthOptions` AND BOTH LOAD-BEARING:**

- `earliestMonth` absent (a team with no boards at all) → the window is the free
  window. There is no floor to clamp to, and a paying member of an empty team must
  still see at least what a free one does.
- `earliestMonth` later than `currentMonth` (clock skew, or a board entered
  between `currentMonth` being computed and this running) → clamped to
  `currentMonth`, so the span is never negative.

**`currentMonth` IS ALWAYS ELEMENT 0, FOR EVERY INPUT, PRO OR FREE.** This is not a
nicety. `lib/dashboard-months.ts` falls back to element 0 for an out-of-window
`?month=` (§4), and that fallback settles — rather than the effect behind it
navigating forever — only because the fallback value is itself always a member.
`insights-months.ts` records the identical property for `resolveInsightsSearch` and
labels it DO NOT BREAK THAT PROPERTY. The same words apply here, and the test that
names the rule says why.

**NO IMPORTS IN THIS FILE**, for the reason `convex/lib/insightsAccess.ts` has
none: the browser needs this rule to build the dropdown, and reaching it through
`../access.ts` would drag `auth.ts` — the whole Better Auth server surface — into
the client chunk. `PuzzleMonth` arithmetic is the one thing it needs and
`puzzleDay.ts` is itself import-free, so a type-and-helper import from there is
permitted; nothing else is. If you are about to add an import here, read
`insightsAccess.ts`'s header first.

---

## 4. Supplying the inputs, and enforcing the rule

### The query

```ts
api.scores.monthWindow({ teamId }) → { earliestMonth: PuzzleMonth | null, pro: boolean }
```

`earliestMonth` is the minimum, across the team's **current roster**, of each
member's earliest `puzzleDay` — one `.first()` on `by_player_and_puzzleDay` per
member, ascending.

**"THE TEAM'S EARLIEST SCORE" NECESSARILY MEANS THE ROSTER'S, BECAUSE
`dailyScores` HAS NO `teamId`.** A board belongs to a player, not to a team
(`convex/schema.ts`, `dailyScores`). That is not a workaround: it is exactly how
`getTeamMonthFor` already resolves the scoreboard — one indexed read per
`team.playerIds` entry (`convex/scores.ts:88`) — so the window and the data it
gates agree by construction. A member joining brings their earlier boards and
widens the window; a member leaving takes theirs and narrows it. Both are correct,
and both are visible on the scoreboard the same way.

**THIS IS THE SAME SHAPE AS wordle-teams-iht.4 AND MUST NOT BECOME ANOTHER
INSTANCE OF IT.** That issue is a split-brain between a count derived from
`teamMonthStats` and one derived from the live roster. The rule here reads the live
roster, as `getTeamMonthFor` does, and `teamMonthStats` is not consulted. Do not
"optimise" this later by reading `teamMonthStats.by_team_year_month` instead: that
table is computed, its coverage of old months is not guaranteed, and it would
reintroduce precisely the disagreement iht.4 exists to close.

**COST.** One additional indexed `.first()` per roster member, alongside the
`.collect()` per member that `getTeamMonthFor` already performs — additive, same
order, and bounded by roster size. (Team size is unbounded in principle; see
`src/lib/waiting-on.ts:28`. In production it is small.)

**A SEPARATE QUERY RATHER THAN A FIELD ON `getTeamMonth`'S PAYLOAD.** `MonthPicker`
renders in the controls row of `routes/app.tsx`, *outside* the `<Suspense>`
boundary that `getTeamMonth` sits behind. Hanging the dropdown's contents on that
payload would make the month picker wait for a month of scores to load before it
could say which months exist.

### Enforcement

`getTeamMonthFor` compares `month` against `serverFloorFor` after
`requireTeamMemberFor` and throws
`accessError('MONTH_OUT_OF_WINDOW')` — a new code, in the shape
`inviteLinks.ts:166` uses for `TEAM_LIMIT_REACHED`.

**SERVER-SIDE BECAUSE LAYER 3 SET THAT STANDARD THIS WEEK.** Before
wordle-teams-iht.3, Layer 3 was a presentation tier wearing a paywall's clothes;
it is now a real data tier, with `convex/insights.ts:211` withholding per-member
figures from free viewers entirely. Shipping the month window as a dropdown
affordance would leave the product with one real gate and one decorative one. It is
also already bypassable today: `getTeamMonthFor` gates on membership alone
(`convex/scores.ts:37`), and `dashboard-search.ts` — unlike `insights-search.ts` —
does not clamp `?month=` at all, so any member can reach any month by typing a URL.

**A FLOOR, NOT MEMBERSHIP OF THE CLIENT'S WINDOW, AND WITH A MONTH OF SLACK.**
`toPuzzleDay` resolves in the runtime's local zone; Convex runs UTC and the viewer
does not. At a month boundary a viewer in Tokyo is on 2026-10-01 while the server
is still on 2026-09-30, so an exact server-side window of `[09, 08, 07]` would
refuse the `2026-10` the dropdown had just offered — breaking the dashboard for
everyone east of UTC on the 1st of every month, and everyone west of it for the
oldest month. The gate exists to stop someone reading years of history they have
not paid for, not to be exact to the month, so the server floor is the client
window's oldest month minus one. Offsets span UTC−12..UTC+14, so the two sides can
differ by at most one month and one month of slack is exactly sufficient. The cost
is that a hand-typed URL reaches at most a fourth month; the dropdown still offers
three. There is deliberately **no upper bound** — a future month simply contains no
boards, and refusing one would be a second way for the same disagreement to break a
page.

**THE MONTH'S SHAPE IS CHECKED HERE, WHICH IT NEVER WAS BEFORE.** `getTeamMonth`
takes `month: v.string()`, and `convex/scores.ts:180` already records what that
means: *"`{ month: '2026' }` bounds '2026-01'..'2026-31', which lexically brackets
every day of the year… getTeamMonthFor has exactly the same property."* That was
tolerable while the route was the only caller and the function was not a gate. It
is not tolerable now: a bare year sorts *above* the Pro floor, so a Pro member
could pull every board for every teammate for a whole year in one payload — past
the floor check, and past the "SCOPED TO ONE TEAM AND ONE MONTH" bandwidth
argument this file's header makes. One `/^\d{4}-\d{2}$/` test, before the floor
comparison.

**AN OUT-OF-WINDOW `?month=` IS ALWAYS CORRECTED, NEVER SHOWN AS AN ERROR.** An
earlier draft of this section split the cases: correct a team switch, but let a
bookmark kept across a downgrade reach the typed error so it could explain itself.
The adversarial review killed that, and it was right on two counts.

*The client cannot tell the cases apart.* Both are just "`?month=` is not in this
team's window". Distinguishing them means threading the previous `teamParam`
through the riskiest code in the spec — an effect that navigates.

*And they would race.* Six components call `useSuspenseQuery(getTeamMonth)` during
render; the correction only runs after commit. Whichever resolves first decides
what the player sees, so the behaviour would be intermittent — which is worse than
either branch on its own.

So `routes/app.tsx` corrects any `?month=` outside the selected team's window, via
a pure decision in `lib/dashboard-months.ts`. **The server gate stays** — it is
what makes the tier real against a devtools call, which is the whole point of §4 —
but a browser user is not expected to meet it, and no UI copy is written for it.
The `MONTH_OUT_OF_WINDOW` message exists as a backstop, not as a conversion
surface; wordle-teams-iht.1 owns the interstitial, and the dropdown's teaser row
(§5) is where a free player is actually told what they are missing.

*The accepted cost, stated so it is a decision rather than a discovery:* a
downgraded subscriber's bookmark for March 2023 lands on this month with no
explanation. If that becomes a support question, the fix is to add the
explanation deliberately, not to resurrect the split.

**THE CORRECTIVE NAVIGATION IS THE HIGHEST-RISK CODE IN THIS SPEC** and must be
treated as such: it navigates from an effect, which is the shape an infinite
redirect takes. It terminates only because element 0 of a window is always
`currentMonth` (§3) and is therefore always a member of the window it is judged
against — the same property `resolveInsightsSearch` depends on by name. It gets the
idempotence test both resolvers already have: feed it its own output and it must do
nothing.

### The trial does not widen this window

`pro` is `isProFor` — `membershipStatus === 'pro'` (`convex/access.ts:283`).
A player inside the 30-day Insights trial is **not** Pro here and sees three
months, like any free player.

**THAT IS A DECISION, NOT AN OVERSIGHT.** The trial was specified as one month of
Layers 2 and 3 (`INSIGHTS_TRIAL_DAYS`, `insightsAccess.ts`) — an Insights grant,
not a scoreboard grant — and honouring it here would mean this rule taking an
`InsightsAccess` tier rather than a boolean, and the trial's expiry silently taking
history away, which would need copy of its own.

**IT LEAVES A SEAM, AND THE SEAM IS ACCEPTED RATHER THAN HIDDEN:** a trial player
sees their team's full month on `/insights` and only three months on `/app`. If
that becomes a support question, the fix is to widen the trial deliberately, not to
discover the split-brain from a bug report.

---

## 5. What a free player sees

The dropdown gains **one row**, below a separator, naming how far back Pro reaches:

```
┌ Month ───────────────────┐
│ ✓ Sep 2026               │
│   Aug 2026               │
│   Jul 2026               │
│ ─────────────────────────│
│   Back to Mar 2023    Pro│
└──────────────────────────┘
```

Chosen over listing every locked month individually. A team dating to 2023 would
turn the dropdown into a wall of thirty padlocks, and would make a free player
scroll through months they cannot use. This row is bounded — the free list is three
rows, or four when there is something behind the gate, whatever the team's age —
and it names the actual reward, read from the team's own earliest board, rather
than an abstraction. `earliestMonth` is already being fetched for the rule, so the
copy costs nothing extra.

**THE LABEL IS `formatMonthLabel`'S OUTPUT, WHICH IS SHORT-FORM** — "Mar 2023", not
"March 2023" (`src/lib/format-day.ts:13`, `{ month: 'short' }`, whose own doc line
reads *"'Aug 2026' — the month picker's label"*). Stated because the first draft of
this section and of the plan's tests both wrote the long form, and a test asserting
a label the product never renders fails in a way whose obvious repair — loosening
the matcher — deletes the only assertion that the month name is there at all.

**THE ROW IS A SIXTH UPGRADE AFFORDANCE, AND THE COUNT MATTERS.** It calls
`startUpgrade()`, making `useStartUpgrade` six call sites rather than five —
`Header.tsx:267`, `trial-ended-card.tsx:32`, `import-upsell.tsx:49`,
`app.tsx:892`, `insights.tsx:327`, and this. wordle-teams-iht.1's whole premise is
that a single shared component sits behind *every* affordance, and that count has
now moved three times. It is recorded on that issue as part of this work, and the
row must be wired through the interstitial when spec B lands rather than being
left as the one path that still goes straight to checkout.

**IT MUST NOT RENDER WHEN THERE IS NOTHING BEHIND IT.** If `earliestMonth` is
absent, or already inside the free window, there is no row — otherwise a
week-old team advertises history that does not exist, and a player pays for it.
This is a guard, and it is mutation-tested (§7).

**PRO SEES NO ROW AND A LONGER LIST, AND THAT LIST NEEDS NO NEW SCROLL MACHINERY.**
An earlier draft called for porting v1's computed-height `ScrollArea`
(`src/components/action-buttons/month-dropdown/utils.ts`). Three things are wrong
with that and the review found all three: `src/components/ui/scroll-area.tsx` does
not exist in v2 and `@radix-ui/react-scroll-area` is not a declared dependency;
Radix's ScrollArea constructs a `ResizeObserver`, which jsdom does not provide and
this repo has no `setupFiles` to polyfill, so adding it would break the new
component tests for a reason unrelated to what they test; and it is redundant —
`DropdownMenuContent` already carries
`max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto`
(`src/components/ui/dropdown-menu.tsx:68`), which is viewport-aware and needs no
row-height constant. v1's ScrollArea is also unconditional rather than Pro-only, so
"ported from v1" misdescribed it twice over. The long list simply scrolls in the
container that already scrolls.

### The Team Boards day picker

Unchanged for free players, and widened for Pro, with no code change of its own.
`routes/app.tsx:1142` passes the same array to `MonthPicker` and to `TeamBoards`,
and `team-boards.tsx:61`'s doc comment says that sharing is deliberate *so both
widen together when the pro expansion lands*. This is that landing. The comment
should be updated from prediction to fact rather than left describing a future.

The new Pro row lives only in the dropdown, not the calendar: a day picker has
nowhere sensible to put it.

---

## 6. The inventory

`src/lib/pro-benefits.ts` — a tested list of what Pro gates, sibling of
`trial-copy.ts` and `billing-copy.ts`, and here for the reason `trial-copy.ts`
gives: *the copy is the deliverable and the component is not.*

Five entries, each naming the code that gates it — and **the field is `gatedAt`,
not `enforcedAt`, because two of the five are not enforced at all.**
`convex/access.ts:265-268` says so in terms: *"`createTeam` PAST THE CAP IS NOT
ENFORCED… THE SCORING-SYSTEM EDITOR IS NOT ENFORCED. v1's `save` action does not
check pro either."* And `board-entry/form.tsx:161`: *"THE PRO GATE, and it is
UI-ONLY BY DESIGN — Phase 3's decision 1, 'read it, gate the UI, enforce
nothing'."* Both are deliberate v1-parity decisions, and neither is a reason not to
sell the feature — v1 sells them the same way. But a comment claiming these five
are all server-enforced would be false on the day it was written, which is the
defect class this file exists to prevent. The asymmetry is recorded in the file:

| Benefit | Gated at | Server-enforced? |
| --- | --- | --- |
| More than two teams | `convex/lib/teamLimits.ts:23` — four readers, three of them enforcing | Yes, on the invite paths |
| Custom scoring systems | `scoring-system-card.tsx:60` | **No** — UI only, per `access.ts:265-268` |
| Screenshot board import | `board-entry/form.tsx:857` | **No** — UI only, per `form.tsx:161` |
| Full Insights history and team month | `convex/insights.ts:211` | Yes |
| Months back to the team's first board | `convex/lib/monthWindow.ts` (this spec) | Yes |

**NO PRICE IN THIS FILE**, for the reason `trial-copy.ts` states: the price lives
in Polar and reaches the customer on Polar's hosted checkout. A number here is a
second source of truth that goes stale silently with every gate green.

**TEAM CHAT AND PUSH NOTIFICATIONS ARE DELIBERATELY ABSENT.** Neither is
Pro-gated — there is no `isProFor` anywhere in `convex/chat.ts` or
`convex/chatNotify.ts`. wordle-teams-wty4.1.14's description lists them alongside
Insights as things missing from the landing page, which is true, but they belong to
the *free product* story. Selling something that is already free is the same defect
as selling something that does not exist, and this file is what stops both.

---

## 7. Testing

**The rule is pure, so it needs no harness.** `monthWindow.test.ts` covers: the
free window is exactly three months; the Pro window spans earliest to current
inclusive; both clamps; and the element-0 property named in §3, in the words that
say why breaking it hangs `dashboard-search`.

**Every guard is mutation-tested** — break it, watch the *named* test fail,
restore, confirm green. The guards, explicitly:

1. The floor check in `getTeamMonthFor` — delete it, a free caller's request for an
   out-of-window month must fail a named test.
2. The `pro` branch of `monthWindowFor` — force it true, the free-window test must
   fail; force it false, the Pro-window test must fail.
3. The "no row when nothing is behind it" condition in the dropdown (§5) — delete
   it, a test asserting no row for a team with no earlier boards must fail.
4. `correctedMonth`'s window check — delete it, a named test must fail.
5. The `max(FREE_MONTHS, span)` floor on the Pro branch — remove the `max`, and a
   named test asserting that a Pro viewer on a one-month-old team still sees three
   months must fail. This is the guard the review found missing entirely, and the
   one whose absence would have shipped a visible regression.

**Guard 3 is a component test**, so it is `month-picker.hook.test.ts` with
`// @vitest-environment jsdom` and `createElement`; vitest's glob is
`src/**/*.test.ts`, so a `.tsx` would not run at all.

**The four gates all run** from `v2/`: `pnpm typecheck`, `pnpm lint`,
`pnpm test:once`, `pnpm build`. e2e is a separate deploy gate and needs a local
Convex backend; a server-side access change to the dashboard's core query is
exactly the kind that e2e catches and the unit suite does not, so it runs before
this is called done.

---

## 8. Explicitly out of scope

- **The interstitial** (wordle-teams-iht.1). This spec adds a sixth affordance and
  records it; it does not build the shared component.
- **The marketing pages** (wordle-teams-wty4.1.14). This spec produces the
  inventory those pages will consume; it does not touch `feature-cards.tsx`,
  `routes/index.tsx`, `routes/home.tsx` or `routes/about.tsx`. The stale "unlimited
  months" copy is *left standing* here and corrected there — it becomes true when
  this ships, which is the point.
- **`/insights` month handling.** `teamMonthOptions` is a different rule for a
  different control and stays as it is, apart from the one stale sentence §3 names.
- **Pricing, annual billing, trial-state presentation.** These belong to the
  wordle-teams-iht epic's open questions.

---

## 9. Acceptance criteria

1. A Pro player's month dropdown reaches back to the earliest board entered by
   anyone on the team's current roster, and the Team Boards day picker reaches the
   same months.
2. A free player's dropdown offers the current month and the two before it, plus
   one row naming the month Pro reaches back to — and that row is absent when the
   team has no boards earlier than the free window.
3. `getTeamMonth` refuses an out-of-window month with a typed error, provably, in a
   convex-test that fails when the guard is deleted.
4. Any `?month=` outside the selected team's window is corrected rather than
   erroring, and that correction is proven idempotent by a test — fed its own
   output, it does nothing. The server still refuses the month to a direct caller;
   no UI copy is written for that path.
5. The window rule exists exactly once, in an import-free file imported by both the
   browser and the server. `monthOptions`' three-month literal does not survive
   anywhere as a second copy.
6. `src/lib/pro-benefits.ts` lists the five gated benefits with their enforcement
   sites, contains no price, and omits chat and notifications.
7. The stale predictions this discharges are corrected rather than left:
   `month-picker.tsx`'s deferred-expansion comment, `team-boards.tsx:61`'s "when
   the pro expansion lands", `insights-months.ts`'s "still owes its own score-based
   expansion", and `V2-ADDENDUM.md:450`'s "v2 has no pro month gate yet" (row 50,
   NOT row 48 at `:446` — an earlier draft of this spec cited the wrong row and
   the error reached the beads issue).
8. A Pro viewer never sees fewer months than a free viewer of the same team,
   proven by a named test on a team younger than three months.
9. A player inside the Insights trial gets the free three-month window, proven by a
   named test rather than left to follow from `isProFor`'s definition. The schema
   field is `insightsTrialEndsAt`, not `trialEndsAt`.
10. Every caller-supplied-month path has been audited, not only `winners.ts`:
    `getLastMonthWinner` (`winners.ts:470`) and `scores.getMyMonth`
    (`scores.ts:190`) both take an unbounded `v.string()` month, and the outcome
    for each is written into its file either way.
11. `MONTH_OUT_OF_WINDOW` is added to `convexErrorCode`'s chain
    (`src/lib/convex-error.ts:17-43`) as well as to `typedCodeMessage`. That chain
    is hand-written and not exhaustive, so typecheck does NOT force it and the
    message would otherwise be dead code behind a generic fallback.
12. All four gates green, and e2e green, before this is called done.
