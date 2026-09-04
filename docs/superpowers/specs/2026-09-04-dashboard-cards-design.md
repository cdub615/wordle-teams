# Dashboard cards — splitting Today from the Month

**Design for `wordle-teams-ha7u`.** Written 2026-09-04, after a brainstorm with
the owner. Supersedes nothing; the dashboard has never had a design document of
its own, which is part of what this issue was filed about.

---

## Why this exists

`wordle-teams-ha7u` asked for a step back on the dashboard's card surface —
options rather than one opinion, and an explicit statement of what is already
right so the brainstorm does not churn it.

**The finding that drove everything else.** Asked which questions the dashboard
should answer fastest, the owner selected five and pointedly did not select the
sixth:

| | Job | Selected |
| --- | --- | --- |
| 1 | Did I play today? | yes — **second priority** |
| 2 | How did I do today? | yes |
| 3 | How am I doing against the team? | yes — **primary** |
| 4 | Who hasn't entered yet? | yes |
| 5 | What did everyone's board look like? | yes |
| 6 | Team admin | **no** |

**Team admin currently occupies two of the three columns below the scores
table.** `CurrentTeamCard`, `MyTeamsCard` and `ScoringSystemCard` hold that
space because v1 held it that way — `routes/app.tsx` says so itself, calling
`md:row-span-3` "the slot v1 gives it (`src/app/me/page.tsx`)". The carving is
inherited, not chosen, and it gives the most room to the one job nobody wants
done daily.

---

## What is already right, and is not touched

Recorded first, because the issue asked for it explicitly.

- **The table already sorts by month total, descending** (`scores-table.tsx:164`).
  Standings ORDER exists. What is missing is only that the rank is never stated.
- **Today's column is auto-centred on landing** (`wt-ksh.3.18`), and correctly
  refuses to do it when the viewed month does not contain today.
- **The long-name strategy is good and is reused, not replaced**
  (`scores-table.tsx:166`): first name alone, `First L` only when two players on
  the team share a first name, initials below `md:`. Ported from v1 and worth
  keeping.
- **Every §7a dashboard decision stands**: 31 (scroll-snap, not embla), 32/33
  (day bounds, weekend-filtered default), 34 (concealed boards carry no
  letters), 35–38 (celebration dialog), 40 (`/app`), 44/45 (app bar, avatar
  ring), 46 (44px calendar cells), 48 (months newest first), 49 (skeletons),
  50/51 (day picker reach, arrows crossing months), 52 (1440px max width).

---

## Directions considered, and why B

Three were put to the owner.

- **A — a summary strip above the table.** Cheapest. Rejected because it bolts a
  second surface onto a table that still makes you scan; the strip and the table
  end up saying overlapping things.
- **B — split Today from the Month.** **Chosen.** The top two jobs run on
  different clocks: standings is a month question the grid answers well once
  rank is stated, and "did I play today" is a today question the grid answers
  badly, by asking you to locate a cell.
- **C — a ranked list, table on demand.** Boldest, and markedly better on a
  phone. Rejected because it trades away month-at-a-glance — streaks, patterns,
  missed days — which is the one thing the grid is genuinely good at.

**The scores table survives in full.** This was explicitly confirmed with the
owner after a wireframe left it ambiguous. Removing the grid was direction C.

---

## Constraints the owner added

> "we need to be sure we maintain good UI/UX for large teams and when team
> members have long names"

**Team size is unbounded.** `FREE_TEAM_LIMIT = 2` is teams per *player*, not
members per *team*; nothing in `convex/` caps membership. So there is no ceiling
to design against, and any layout whose height or width grows per member is
disqualified.

**Long names already have a latent bug.** The pinned name column is
`md:w-max` with no maximum, so one long name silently widens it and steals
horizontal space from the day columns. That is live today and this design fixes
it rather than inheriting it.

---

## The design

### 1. Data — no backend change

Both new components read the two queries `routes/app.tsx` already fetches:

- **`api.scores.getTeamMonth({ teamId, month })`** — `getTeamMonthFor` maps over
  `team.playerIds`, so the payload carries EVERY MEMBER, not only those with
  scores, plus the team's `scoringSystems` row. That is precisely what "who
  hasn't played today" and the legend need.
- **`api.scores.getMyPlayerId({})`** — already fetched at `app.tsx:119`.

`ScoresTable`, `TeamBoards` and `ScoringSystemCard` already share that one
suspense query. `TodayPanel` and `ScoringLegend` join the same subscription.
**Zero new Convex functions, zero new indexes, no additional round-trips.**

### 2. `TodayPanel` — new

**Renders only when the viewed month contains today.** Absent, not empty: a
"Today" panel is meaningless while browsing March. `ScoresTable` already holds
this predicate (`if (monthOf(todayNow) !== month) return`); it is extracted to a
shared pure function rather than written twice.

**THE HYDRATION HAZARD IS THE REAL TRAP IN THIS COMPONENT.** "Today" is a
client-only fact. `scores-table.tsx:40` records the rule and the reason —
guessing it during SSR is a hydration mismatch — and resolves it with
`useHydrated`. `TodayPanel` is *entirely* about today, so it must render its
skeleton until hydrated rather than render a guessed value. Getting this wrong
produces a minified React #418 in production, which is the same failure the
maintenance-mode rewrite was rejected for (see `src/server.ts`).

Content:

- your status — played or not — with the board-entry CTA when not
- `N of M played`, with a progress bar
- "waiting on" — at most **three** names, then "and N others" behind a
  disclosure that reveals the rest

**Large teams:** the count and the bar are constant height at any team size, and
the name list is capped. Nothing here renders one element per member.

**Long names:** reuses the table's collision rule, imported rather than
restated.

### 3. `ScoresTable` — additive only

Four changes, and nothing else:

1. A rank `#` column.
2. The caller's own row highlighted.
3. Today's column tinted.
4. The name column capped with an ellipsis, full name on `title`.

Day columns, sticky first/last columns, today auto-centring, and the sort by
month total are untouched.

**TIES TAKE STANDARD COMPETITION RANKING — 1, 2, 2, 4.** Two players on equal
points are equal, and dense ranking (1, 2, 2, 3) would tell the fourth-placed
player they are third. Decided rather than left open, because a tie is the
normal case in a small team on a slow month.

### 4. `ScoringLegend` — new, read-only

A chip strip attached beneath the table: `1 +5 · 2 +3 · 3 +2 · 4 +1 · 5 0 ·
6 −1 · X −3 · Missed day 0`. Labels come from `SYSTEM_FIELD_LABELS` VERBATIM and
order from `SYSTEM_FIELDS` — never hand-listed, for the reason that module
already gives. **`nA`'s label is "Missed day" and it is not abbreviated**, even
though it is the longest chip: it is the one value a player is least likely to
guess, and an abbreviation would save a few pixels on the entry that most needs
spelling out.

- Renders the team's **actual** system, not `DEFAULT_SYSTEM`. Teams customise,
  and a legend showing the defaults to a team that scores differently is worse
  than no legend.
- Negative values keep their sign, so `−1` and `−3` read as penalties.
- Wraps to two lines on a phone; never scrolls horizontally.
- An **Edit** affordance opens Team settings → Scoring, **shown only to the team
  creator.** Team mutations are creator-only and enforced server-side (§7a 4),
  so showing it to a member offers an action the server will refuse. The flag is
  `selectedTeam.isOwner`, already on the page and already passed to
  `CurrentTeamCard` (`app.tsx:381`), so this gate costs no backend change
  either — it is a prop, not a new query.

### 5. `TeamSettingsDialog` — new shell

Hosts `CurrentTeamCard`, `MyTeamsCard` and the scoring editor as tabs, entered
from the controls row. **The components move; they are not rewritten.** A dialog
matches the frequency of the job — occasional — and matches the Settings dialog
pattern the app already has.

A separate `/app/team` route was considered and rejected: it adds an entry to
`routeTree.gen.ts`, which drags in `crawler-metadata.test.ts`'s coverage
assertion and a sitemap/robots disallow decision, for no daily benefit.

### 6. The grid afterwards

```
controls        Team · Month · [Team settings] · [Enter board]
TodayPanel      full width, only when the month contains today
ScoresTable     full width
ScoringLegend   attached beneath the table
TeamBoards      full width
```

**`TeamBoards` loses `md:row-span-3` and goes full width.** That span exists
solely so the admin cards could sit beside it; with them gone it is inherited v1
geometry with nothing left to justify it.

---

## Error handling

Unchanged in shape. The existing `DashboardError` boundary and per-region
`Suspense` fallbacks cover the new components; `TodayPanel` and `ScoringLegend`
each get a skeleton consistent with `dashboard-skeletons.tsx` (§7a 49). Because
both read the query the page already suspends on, neither introduces a new
failure mode — a `getTeamMonth` failure surfaces exactly where it does today.

---

## Testing

Three pieces of logic become **pure functions**, so they are unit- and
mutation-testable without a harness — the same reasoning that put
`copy-reminder-policy.mjs` outside its script:

- `rankWithTies(rows)` — standard competition ranking
- `waitingOnSummary(members, played, limit)` — the ≤3 names and "and N others"
- `monthContainsToday(month, today)` — extracted from `ScoresTable`

**Mutation-test the tie rule and the truncation specifically.** Both are
off-by-one shaped, and this project has already caught three no-op "kills" and
two tests that matched their own explanatory prose. A green test on either of
these means nothing until its mutant has been seen to die.

Component behaviour follows the repo's existing `.hook.test.ts` pattern.

**One e2e assertion is worth its keep:** that `TodayPanel` is absent when the
viewed month is not the current month. It is the one behaviour whose failure is
silent and whose cause (hydration) is expensive to diagnose after the fact.

---

## New §7a rows

Five, numbered 60–64 when written:

| # | Divergence |
| --- | --- |
| 60 | A Today panel above the scores table; v1 has no equivalent surface |
| 61 | The scores table states rank and highlights the caller's own row |
| 62 | Today's column is tinted in the scores table |
| 63 | Team admin lives in a dialog, not in cards on the dashboard |
| 64 | A read-only scoring legend replaces the on-page scoring card |

Parity with v1 is explicitly not a constraint for this work — that is the
issue's own wording — which is exactly why each adopted change earns a row.

---

## Out of scope

Every §7a decision listed under "already right"; `TeamBoards`' internals; the
board-entry flow; reminders; and `wordle-teams-51zk` and `wordle-teams-v917`,
which are separate items in the same Phase 7 walk.

**Not addressed here, deliberately:** whether the dashboard should work well for
a team of 40. The design refuses to *break* at that size — nothing grows per
member — but no claim is made that a 40-person scores grid is pleasant, and no
work is proposed to make it so.
