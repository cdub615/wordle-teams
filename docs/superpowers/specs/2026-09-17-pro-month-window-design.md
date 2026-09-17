# The Pro month window — design

**Date:** 2026-09-17
**Issue:** the Pro month gate, filed during this brainstorm (see §9)
**Blocks:** wordle-teams-iht.1 (the upgrade interstitial), wordle-teams-wty4.1.14 (the marketing pages)
**Status:** approved by the owner 2026-09-17

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
| "and more" | Screenshot import (`board-entry/form.tsx:858`), Insights Layer 2 and Layer 3 (`convex/insights.ts:211`) |
| **unlimited months** | **Not shipped.** `month-picker.tsx:38` returns exactly three months, for everyone, Pro included |

`docs/design-system/V2-ADDENDUM.md:446` states it outright: *"v2 has no pro month
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
   and `dashboard-search.ts` clamps `?month=` into it.
4. `src/lib/pro-benefits.ts` — the canonical inventory, which §1 explains.

Free behaviour is unchanged except for one new row in the dropdown (§5).

---

## 3. The rule

```ts
// convex/lib/monthWindow.ts
monthWindowFor({ currentMonth, earliestMonth, pro }): Array<PuzzleMonth>  // newest first
monthInWindow(month, window): boolean
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

**TWO CLAMPS, BOTH BORROWED FROM `teamMonthOptions` AND BOTH LOAD-BEARING:**

- `earliestMonth` absent (a team with no boards at all) → the window is
  `[currentMonth]`. There is no floor to clamp to, and the one sure thing about
  any team is that it can be viewed for the current month.
- `earliestMonth` later than `currentMonth` (clock skew, or a board entered
  between `currentMonth` being computed and this running) → clamped to
  `currentMonth`, rather than producing a negative-length or empty list.

**`currentMonth` IS ALWAYS ELEMENT 0, FOR EVERY INPUT, PRO OR FREE.** This is not a
nicety. `dashboard-search.ts` gains a fallback to element 0 for an out-of-window
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

`getTeamMonthFor` calls `monthInWindow` after `requireTeamMemberFor` and throws
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

**THE CLIENT CLAMPS TOO, SO THE ERROR IS NOT A ROUTINE PATH.**
`dashboard-search.ts` gains the out-of-window fallback `insights-search.ts` already
has. A stale bookmark, a shared link, or a `?month=` invalidated by switching to a
younger team resolves back into the window rather than hitting an error boundary.
After that the thrown error is reachable only by a direct call from devtools. It
exists so the tier is real, not so players meet it.

**THE GATE MUST COVER EVERY PATH THAT SERVES A MONTH, OR IT IS NOT A GATE.**
`convex/winners.ts` reads month-scoped data and is audited as a task of this work,
with a stated outcome either way: if it serves an out-of-window month to a member,
it gets the same `monthInWindow` check; if the audit finds no hole, the reason is
recorded in the file so the next reader does not re-audit it. "Probably fine" is
not an acceptable result. `/insights` is **not** touched — `teamMonthOptions` is
its own rule over its own query, and Layer 3 is already gated separately.

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
│ ✓ September 2026         │
│   August 2026            │
│   July 2026              │
│ ─────────────────────────│
│   Back to March 2023  Pro│
└──────────────────────────┘
```

Chosen over listing every locked month individually. A team dating to 2023 would
turn the dropdown into a wall of thirty padlocks, and would force the long-list
`ScrollArea` onto free players, who can use none of it. This row is bounded — the
free list is always four rows, whatever the team's age — and it names the actual
reward, read from the team's own earliest board, rather than an abstraction.
`earliestMonth` is already being fetched for the rule, so the copy costs nothing
extra.

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

**PRO SEES NO ROW AND A LONGER LIST.** Only Pro ever meets a list long enough to
need one, so the computed-height `ScrollArea` ported from v1's
`month-dropdown/utils.ts` is Pro-only.

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

Five entries, each naming the code that enforces it:

| Benefit | Enforced at |
| --- | --- |
| More than two teams | `convex/lib/teamLimits.ts:23`, three call sites |
| Custom scoring systems | `scoring-system-card.tsx:60` |
| Screenshot board import | `board-entry/form.tsx:858` |
| Full Insights history and team month | `convex/insights.ts:211` |
| Months back to the team's first board | `convex/lib/monthWindow.ts` (this spec) |

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

1. `monthInWindow` in `getTeamMonthFor` — delete it, a free caller's request for an
   out-of-window month must fail a named test.
2. The `pro` branch of `monthWindowFor` — force it true, the free-window test must
   fail; force it false, the Pro-window test must fail.
3. The "no row when nothing is behind it" condition in the dropdown (§5) — delete
   it, a test asserting no row for a team with no earlier boards must fail.
4. `dashboard-search.ts`'s new clamp — delete it, a named test must fail.

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
4. `dashboard-search.ts` resolves an out-of-window `?month=` back into the window,
   so the error is not reachable from the URL bar.
5. The window rule exists exactly once, in an import-free file imported by both the
   browser and the server. `monthOptions`' three-month literal does not survive
   anywhere as a second copy.
6. `src/lib/pro-benefits.ts` lists the five gated benefits with their enforcement
   sites, contains no price, and omits chat and notifications.
7. The stale predictions this discharges are corrected rather than left:
   `month-picker.tsx`'s deferred-expansion comment, `team-boards.tsx:61`'s "when
   the pro expansion lands", `insights-months.ts`'s "still owes its own score-based
   expansion", and `V2-ADDENDUM.md:446`'s "v2 has no pro month gate yet".
8. A player inside the Insights trial gets the free three-month window, proven by a
   named test rather than left to follow from `isProFor`'s definition.
9. `convex/winners.ts` has been audited for the same hole, with the outcome written
   into the file either way.
10. All four gates green, and e2e green, before this is called done.
