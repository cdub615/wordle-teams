# Pro pricing — annual-led at $49, with the number gated on the import spike

Status: approved 2026-09-10. Feeds `wordle-teams-iht`.

Companion to `2026-09-05-pro-tier-and-insights-design.md`, which decided what Pro
**is**. This decides what it **costs**, and in what shape it is sold.

---

## Why this exists

`iht`'s acceptance criteria ask for "the vendor cost of one free active user per
month and the conversion rate at the chosen price that covers it". Working that
through on real numbers produced an answer the criteria did not anticipate, and
the answer is the reason this document exists rather than a price being set in a
comment somewhere.

**The vendor cost of a free active user is approximately zero.** Measured
2026-09-10: Cloudflare at 0.3% of its allowance, Resend at 10%, Sentry at
essentially nothing, Polar billing per transaction with no transactions. There is
no bill to cover, so a price cannot be derived from one.

**The one real ceiling was Convex, and `wordle-teams-yhii` removed it.** The
deployment was at 460.26 MB of a 1 GB free-tier database-I/O allowance with
almost no user traffic, because `teamStats.sweep` ran hourly and its cost is
O(data) × runs. Moving it to daily leaves an estimated 9.5–16× headroom. Avoiding
Convex Professional is worth $300/year, which is the same 17 annual subscribers
this document would otherwise have to find.

So pricing is no longer a cost-recovery problem. It is a positioning problem, and
that is what the rest of this decides.

---

## The evidence this has to respect

Every number below is measured, with its source, because the temptation in a
pricing document is to reason from feel.

| Fact | Source |
| --- | --- |
| 392 accounts, 70 have ever entered a board, 24 have 10+ | measured 2026-09-05, `wty4` |
| 87% of production signups never enter a single board | `wordle-teams-456` |
| ~7% of visitors reaching `/login` complete auth | `wordle-teams-390` |
| 0 paying subscribers today | Polar, 2026-09-10 |
| Polar Starter fee: 5% + $0.50 per transaction | owner, 2026-09-10 |
| Current price: $1.99/mo or $19.99/yr | owner, 2026-09-10 |

### The paywall has never actually been tested

`FREE_TEAM_LIMIT = 2` caps *teams per player*. Server-side it is enforced in
exactly two places and both are **joining** — `invitePlayerFor` parks the invite
of a non-Pro player already on two teams, and `completeProfileFor` claims at most
two invites at signup. `createTeam` does not enforce it at all.

So the only enforced wall lands on someone being invited to a *third* team. With
392 players and 171 teams, almost nobody has ever met it.

**Nobody declined $1.99. They never encountered it.** Any reasoning of the form
"the price was too high, look at the conversions" is unsupported, and so is the
opposite. The price is unmeasured, not disproven.

This changes at relaunch: trial expiry on Insights Layers 2–3 becomes a paywall
that everyone who plays will meet, which is a categorically higher encounter rate
than an invite to a third team.

---

## The finding that sets the altitude

At the base that actually exists, **conversion dominates price**.

Net revenue per year, annual plan, against the 24 genuinely engaged players:

| price | net/sub | 25% convert | 50% | 75% |
| --- | --- | --- | --- | --- |
| $19.99/yr | $18.49 | $111 | $222 | $333 |
| $39/yr | $36.55 | $219 | $439 | $658 |
| **$49/yr** | **$46.05** | **$276** | **$553** | **$829** |
| $69/yr | $65.05 | $390 | $781 | $1,171 |
| $89/yr | $84.05 | $504 | $1,009 | $1,513 |

$19.99 at 75% conversion is $333. $89 at 25% is $504. **A 4.5× price premium beats
a 3× conversion gap by only 1.5×, and both outcomes are small.**

The decision that actually moves revenue is how many of the 392 ever become
engaged at all. 87% have never entered a board. No price on that table competes
with moving that number, and this document should not pretend otherwise.

**Consequence for how hard to optimise this:** get the structure right, avoid the
fee cliff, and stop. Pricing is not where the leverage is, and time spent tuning
it past this point is time not spent on activation.

---

## The decision

### Structure: annual-led, monthly retained as an on-ramp

| | price | fee | fee share | net per charge | net/year if retained 12 months |
| --- | --- | --- | --- | --- | --- |
| **Annual (default, pushed)** | **$49/yr** | $2.95 | 6.0% | $46.05 | **$46.05, guaranteed up front** |
| Monthly (on-ramp) | $4.99/mo | $0.75 | 15.0% | $4.24 | $50.89, if they stay |

**This change repairs the monthly plan rather than merely raising it.** Today
monthly is *structurally loss-making relative to annual*: $1.99/mo nets $16.69
over a year against annual's $18.49, and the break-even is **13.3 months** — a
monthly subscriber can never catch an annual one inside a year. That is an
accident of the fixed $0.50 fee, not a decision anyone made.

At $4.99/$49 the relationship inverts into a real trade: a monthly subscriber
overtakes an annual one at **10.9 months**, and is worth $4.84 more across a full
retained year.

So the two plans now price genuinely different things:

- **Annual trades ~$5 of upside for certainty.** $46.05 lands up front and cannot
  churn.
- **Monthly is worth more only from month 11.** Every month before that, it is
  behind.

**Annual is led because it converts churn risk into guaranteed revenue**, not
because monthly is worth less. That distinction matters for the copy: there is no
need to disparage the monthly option, and doing so would be inaccurate.

### Why not the alternatives

**Annual-only at $69** was the owner's instinct and is defensible on margin —
best revenue per head, one transaction, one churn point a year. Rejected because
a $69 upfront ask at the decision moment, from a user base that last saw this as
effectively free and is being re-approached by an apology-adjacent re-engagement
email, optimises the wrong variable given the table above. The monthly door costs
about a dollar a year per subscriber and removes that risk.

**$39/yr** is the safe version and was rejected only because $49 clears the same
fee cliff, reads more like a product, and the evidence does not support treating
$10/year as the difference between converting and not.

**Staying near $2** is rejected on the fee arithmetic alone: $1.99 sits one cent
below the $2.00 line where Polar's fixed $0.50 stops taking 30% of revenue. It is
close to the worst available price point on this fee schedule.

### The number is gated on `wordle-teams-418.1`

**$49 is conditional. The gate is the board-import spike's GO/NO-GO verdict.**

- **GO** — board import works at the specified bar. Ship $49/yr and $4.99/mo. The
  tier contains a genuine labour-saving feature and the price is defensible.
- **NO-GO** — Pro is "unlimited teams + custom scoring + your own history", with
  Insights Layer 4 already built-and-switched-off for corpus reasons (`4s0`).
  **Then $39/yr and $3.99/mo is the honest ceiling**, and shipping $49 would be
  charging proper-product money for a tier missing its proper-product feature.

This gate exists because the spike has not run — it needs ≥20 real screenshots
from the owner — and pricing a feature before knowing whether it works is the
wrong order. It is one substitution in one place, not a redesign.

### Polar stays on Starter

Break-even on Polar's own platform fees, given their reduced rates:

| tier | break-even |
| --- | --- |
| Pro $20/mo | ~707 annual subscribers |
| Growth $100/mo | ~2,792 |
| Scale $400/mo | ~9,234 |

Recorded so that "the paid tier has better rates" is not acted on. Upgrading
before roughly 700 annual subscribers destroys money.

---

## What "annual-led" means concretely

Not a slogan; three specific behaviours, each of which is a separate testable
change:

1. **Annual is preselected** wherever both plans are shown.
2. **The saving is stated in the customer's terms** — "$49/year, or $4.99/month"
   with the annual framed as the better deal, because it is: $49 against $59.88.
   This is an honest saving, not a manufactured anchor.
3. **The trial converts to annual by default.** The trial designed in the Pro-tier
   spec — one month of Layers 2–3, clock starting at first board entry after
   launch — ends in an upgrade prompt, and that prompt's primary action is annual.

**Explicitly not doing:** dark patterns, hiding the monthly option, or making
monthly hard to select. The audience is people who already left once; the tier's
whole positioning line is honest ("free shows you today, Pro shows you everything
you have done") and the checkout should match it.

---

## Implementation surface

Deliberately small. This is a pricing change, not a billing rebuild.

**Polar** — the two Pro products already exist (`efrc`'s constraint), and
**the price can be changed on an existing product in place** (confirmed by the
owner, 2026-09-10). No new product, no archiving, no second product id to thread
through checkout. `efrc`'s warning that a third Polar product would be "a
materially bigger change" therefore does not apply to this work: it is a value
edit on two products that already exist.

**The codebase carries no dollar amount.** Verified 2026-09-10: no price literal
exists anywhere under `src/` or `convex/`. The price lives in Polar and reaches
the app through checkout. So the code change is confined to copy and plan
selection, not to arithmetic.

**No migration, and this is the one genuinely lucky part.** There are zero
subscribers. No grandfathering, no one to disappoint, no legacy price to honour.
This is a free shot at setting the price correctly, and it will not come again.

**The terms notice already in flight** (`wordle-teams-7e3c`) covers the launch
email's terms-change obligation. A price change on a tier nobody is currently
paying for does not add a notification duty, but the two should be checked
together rather than assumed independent.

---

## Testing

The repository's convention is that decisions live in testable helpers rather
than in components, and pricing copy is a decision.

- **Plan-selection copy** belongs beside `src/lib/billing-copy.ts`, which exists
  precisely because "the copy is the deliverable, the component is not". The
  annual-default rule is a function returning which plan is preselected, and it
  is unit-testable.
- **No test asserts a price literal**, because the price is not in the codebase.
  Asserting one would create a second source of truth that can drift from Polar
  silently — the exact failure this repo's `SENTRY_ENVIRONMENT` and
  `__SENTRY_RELEASE__` work spent effort avoiding.
- **The trial-to-annual default** is a behavioural assertion and belongs in the
  e2e suite, alongside the existing billing spec.

---

## Out of scope

- **Usage-metered pricing.** Needs a third Polar product; ruled out in `efrc` and
  still ruled out.
- **A team/organiser plan.** The cap is per-player and team size is unbounded, so
  a seat-based tier would require rethinking the model. Not now.
- **Discounts, coupons, launch offers.** The trial is the offer.
- **Fixing activation.** It is worth more than everything here, and it is
  `wordle-teams-456`'s and `qt4`'s problem, not this document's.
- **Raising the price later.** Deliberately left open. With the fee cliff cleared
  there is room above $49, and the right moment to consider it is after the first
  cohort converts, not now.

---

## How this decomposes

Against `wordle-teams-iht`, which owns price, unit economics and the conversion
funnel:

1. **Set the prices in Polar**, gated on `418.1`'s verdict: $49/$4.99 on GO,
   $39/$3.99 on NO-GO. An in-place edit on the two existing products, so this is
   a dashboard change with no code and no deploy behind it.
2. **Annual-default plan selection**, with the rule in a tested helper.
3. **Trial-expiry upgrade prompt** defaulting to annual — depends on the trial
   from the Pro-tier spec existing.
4. **Pricing-page and launch-email copy** carrying the positioning line already
   chosen: *free shows you today, Pro shows you everything you have done.*

Item 1 is the whole pricing decision and is not blocked by any of the others.
Items 2–4 are what make it annual-led rather than merely annual-available, and
they are code — they can be built and shipped before the number is set, because
nothing in them depends on what the number is.

**That independence is the useful part of the sequencing:** the only thing
waiting on `418.1` is a value typed into the Polar dashboard.

---

## An honesty note

This document spends most of its length establishing that the thing it decides
does not matter very much. That is deliberate and it is the most useful thing in
it: at 24 genuinely engaged players, the difference between the best and worst
price on the table is a few hundred dollars a year, while the difference between
87% and 70% of signups never entering a board is the entire business.

The price should be set once, defensibly, and then left alone.
