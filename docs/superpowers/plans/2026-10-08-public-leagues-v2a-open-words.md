# Public Leagues v2a: Open-Word Starting Words. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Starting Words' five fixed groups with any Wordle answer word (groups created on first pick), with a search picker, a large-league standings slice, and contextual Insights nudges.

**Architecture:**
- New pure, client-safe modules hold the rules:
  - `convex/lib/answerWords.ts`: the word list.
  - additions to `convex/lib/league.ts`: the standings slice.
  - `src/lib/league-nudges.ts`: nudge decisions.
- A word is resolved to a group, or the group is created, by `resolveWordGroupFor`. The new `joinWord`/`switchWord` mutations call it and then hand off to the existing, reviewed `joinGroupFor`/`switchGroupFor`, so the membership engine is untouched.
- `standingsFor` slices word leagues to top-10 + viewer + unranked count.
- A new `WordPicker` component replaces the fixed picker wherever Starting Words is offered.

**Tech Stack:** Convex (convex-test + vitest), TanStack Start/Router, React, shadcn/ui, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-public-leagues-v2-design.md` (v2), on top of `docs/superpowers/specs/2026-10-07-public-leagues-design.md` (v1). §-references are to v2 unless marked v1.

---

## Ground rules (every task)

These are the same as v1, and the shared rules file carries them:
`/tmp/claude-1000/-home-cdub-projects-wordle-teams/fbf3696f-0b3e-4607-aa2b-d8d048a810f3/scratchpad/tasks/ground-rules.md`

- **Gates:** run all four separately and read each exit code. Never pipe a gate.
- **Commits:** use quoted-heredoc commit messages. Commit red, then green.
- **Refusals:** always `throw accessError(code)`.
- **`convex/_generated/api.d.ts`:** it's hand-maintained. Add new Convex modules by hand.
- **Convex CLI:** never run it without the local-only `--env-file` guard. `.env.local` holds the production deploy key.
- **No pushes and no amends** by subagents.
- **Wrapper tests:** public wrappers CAN be tested through `authenticatedAs` from `convex/fixtures.ts`. `onboarding.test.ts` and `leagues.test.ts` both do it. Prefer that over source pins for new wrappers.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `convex/lib/answerWords.ts` | create | The answer list, its source and licence, `isAnswerWord`, `normalizeWord` |
| `convex/lib/answerWords.test.ts` | create | Tests |
| `convex/schema.ts` | modify | `leagues.groupSource`; indexes `leagueGroups.by_league_and_slug`, `leagueGroups.by_league_and_memberCount` |
| `convex/access.ts`, `src/lib/convex-error.ts` | modify | `UNKNOWN_WORD` code + copy |
| `convex/lib/league.ts` | modify | `largeLeagueSlice`, `isLargeLeague` |
| `convex/leagues.ts` | modify | Spec `groupSource`; `resolveWordGroupFor`; `joinWord`/`switchWord`; sliced standings; `groupStanding`; popular groups in `leaguesFor` |
| `src/lib/league-nudges.ts` | create | `nudgeFor` |
| `src/lib/plans.ts` (+ test) | modify | Origins `leagues-behind`, `league-result` |
| `src/components/leagues/word-picker.tsx` | create | Search + quick picks + validation |
| `src/components/leagues/league-standings.tsx` | modify | Slice rendering: unranked count, "find a group" |
| `src/components/leagues/league-page-view.tsx`, `src/routes/leagues.$slug.tsx` | modify | WordPicker in join/switch; nudges |
| `src/components/leagues/leagues-card.tsx`, `src/routes/app.tsx` | modify | Card uses WordPicker + `joinWord` |
| `src/routes/leagues.index.tsx` | modify | Cards with your group/rank (≥2 leagues) |
| `e2e/leagues.spec.ts` | modify | Join by typing a word |

---

### Task A1: The answer-word list

**Files:** create `convex/lib/answerWords.ts` and `convex/lib/answerWords.test.ts`; add `lib/answerWords` to `api.d.ts` by hand.

**Source and licence gate (do this first):**
- Find a copy of the published Wordle answer list with an explicit open licence: MIT, Unlicense, CC0, CC-BY or similar. Example: a list committed inside an MIT- or Unlicense-licensed open-source Wordle clone.
- Record the source URL, licence and retrieval date in the file header.
- **If you can't find a copy with a clear open licence, stop and report BLOCKED** with what you found. The owner decides. Don't commit an unlicensed copy.
- Use web search and fetch tools if you have them. If not, report NEEDS_CONTEXT and ask the controller to fetch.

**Shape:**
```ts
/**
 * WORDLE ANSWER WORDS: the only words a Starting Words group may be named for
 * (spec v2 §2, owner decision 2026-10-08: common, family-friendly, no blocklist).
 *
 * SOURCE: <url> — <licence> — retrieved <YYYY-MM-DD>. <n> words.
 * Client-safe: no imports. A static Set, so a lookup is O(1).
 */
const WORDS = '...space-separated lowercase list...'

export const ANSWER_WORDS: ReadonlySet<string> = new Set(WORDS.split(' '))

/** Trimmed, lowercased, A-Z only. Returns null for anything that can't be a word. */
export function normalizeWord(input: string): string | null {
  const w = input.trim().toLowerCase()
  return /^[a-z]{5}$/.test(w) ? w : null
}

export function isAnswerWord(input: string): boolean {
  const w = normalizeWord(input)
  return w !== null && ANSWER_WORDS.has(w)
}
```

Store slugs lowercase. Display names are UPPERCASE: `word.toUpperCase()`.

**Tests:**
- size within the expected range for the source;
- `crane`, `slate` and `adieu` are present (verify each against the chosen list; drop any that aren't);
- `isAnswerWord(' Crane ')` is true;
- `'xxxxx'`, `'cran'`, `'cranes'` and `'cr4ne'` are false;
- `normalizeWord` edge cases;
- **report whether each of the five v1 group words is in the list.** This decides grandfathering (§4.2).

Check bundle impact: the file is imported by the client picker. A ~2,300-word string is about 14 KB raw. If `src/frontend-import-graph.test.ts` or any bundle-size guard objects, report it.

- [ ] Steps: red test → commit red → implement → green → four gates → commit green.

---

### Task A2: Schema, spec flag and the `UNKNOWN_WORD` code

**Files:** `convex/schema.ts`, `convex/leagues.ts` (LeagueSpec, STARTING_WORDS, seedLeagueFor), `convex/access.ts`, `src/lib/convex-error.ts` (+ test), `convex/leagues.test.ts`.

1. **`leagues`:** add `groupSource: v.optional(v.union(v.literal('fixed'), v.literal('answer-words')))`. Absent means `'fixed'`.
2. **`leagueGroups`:** add `.index('by_league_and_slug', ['leagueId', 'slug'])` and `.index('by_league_and_memberCount', ['leagueId', 'memberCount'])`.
3. **`LeagueSpec`** gains `groupSource?: 'fixed' | 'answer-words'`. `STARTING_WORDS` sets `groupSource: 'answer-words'` and keeps its five groups. They remain seeded (ordinary or grandfathered, per A1's finding). `seedLeagueFor` writes and patches `groupSource` on insert and on re-seed.
4. **`AccessCode`:** add `'UNKNOWN_WORD'` with a comment naming the throw site (`resolveWordGroupFor`). Client recogniser plus copy: `"That isn't a Wordle answer word."` Extend the convex-error `test.each`.
5. **Tests:**
   - Re-seed sets `groupSource: 'answer-words'` on an existing league that lacked it. That's the dev deployment's state, so a re-seed upgrades it in place.
   - The schema accepts both indexes, used through queries in later tasks.

- [ ] Steps: red → green → gates → commit.

---

### Task A3: Resolve a word to a group, and the `joinWord`/`switchWord` mutations

**Files:** `convex/leagues.ts`, `convex/leagues.test.ts`.

```ts
/**
 * A word league's group for `word`: the existing one, or a new one if `word`
 * is an answer word (spec v2 §4.2). An existing group is always joinable, even if
 * its word isn't on the list (grandfathered v1 groups), but a non-answer word
 * never creates one. CONCURRENCY: two first-joins of one word both read the
 * empty by_league_and_slug range; the second's read set is invalidated by the
 * first's insert, so Convex retries it and it finds the group. Never two groups.
 */
export async function resolveWordGroupFor(ctx: WriterCtx, league: Doc<'leagues'>, input: string): Promise<GroupId> {
  const word = normalizeWord(input)
  if (word === null) throw accessError('UNKNOWN_WORD')
  const found = await ctx.db
    .query('leagueGroups')
    .withIndex('by_league_and_slug', (q) => q.eq('leagueId', league._id).eq('slug', word))
    .unique()
  if (found) return found._id
  if (league.groupSource !== 'answer-words' || !isAnswerWord(word)) throw accessError('UNKNOWN_WORD')
  // ORDER IS CREATION TIME: no collect of the league's groups to find a max, and
  // order is only a display tiebreak among equals.
  return await ctx.db.insert('leagueGroups', {
    leagueId: league._id,
    slug: word,
    name: word.toUpperCase(),
    order: Date.now(),
    memberCount: 0,
  })
}
```

Two more handlers:
- `joinWordFor(ctx, playerId, { leagueId, word, today })`:
  1. `requirePlausibleToday` FIRST, the same validation order as `joinGroupFor`.
  2. Load the league; throw `UNKNOWN_LEAGUE` if it's missing.
  3. `resolveWordGroupFor`.
  4. Delegate to `joinGroupFor(ctx, playerId, { groupId, today })`.
- `switchWordFor`: the same, delegating to `switchGroupFor`.

**Bad dates and refused joins:**
- **Correction (review of A3):** in production a refused mutation rolls back entirely in Convex, so a refused join can never leave a group behind. The orphan only appears in convex-test when a handler's error is caught inside the same `t.run`. The pre-check is kept for **error order** (an existing member typing a bad word hears `ALREADY_IN_LEAGUE`, not `UNKNOWN_WORD`) and for any future in-transaction caller that catches the refusal.
- **Fix:** check the plan before creating. If `planJoin` would refuse, throw before inserting.
- Simplest way:
  - In `joinWordFor`, read the intervals and call `planJoin` with a placeholder group id. Throw `ALREADY_IN_LEAGUE` if refused, then resolve and delegate.
  - Do the same for switch with `planSwitch` and `NOT_IN_LEAGUE`.
- **Alternative:** accept orphan empty groups. They're harmless (no member, never listed, because standings list only groups with rows this month), and creation is bounded by the dictionary.
- **Choose the pre-check.** It's cheap and keeps the data clean.

**Public wrappers:** `joinWord` and `switchWord`, gated by `gate()`, with args `{ leagueId: v.id('leagues'), word: v.string(), today: v.string() }`.

**Tests** (handlers, plus one wrapper test via `authenticatedAs`):
- A new answer word creates a group named UPPERCASE, and joins it.
- A second player picking the same word joins the same group (one group).
- Mixed case and whitespace input resolves to the same group.
- A non-answer word is refused `UNKNOWN_WORD` and creates nothing.
- A grandfathered existing non-answer group is joinable, if A1 found one; otherwise test with a group inserted directly.
- A fixed league (`groupSource` absent) refuses a new word with `UNKNOWN_WORD` but accepts an existing group's slug.
- A refused join (already in league) creates no group.
- `switchWord` to a new word creates the group and plans the switch.
- **Concurrency:** convex-test runs mutations serially, so assert the invariant instead. After two sequential first-joins there is exactly one group for the slug. Add a comment explaining why a true race isn't reproducible here.
- **Mutation check:** remove the pre-check; the refused-join test must fail.

- [ ] Steps: red → green → gates → mutation check → commit.

---

### Task A4: Large-league standings, `groupStanding`, popular groups

**Files:** `convex/lib/league.ts` (+ test), `convex/leagues.ts` (+ test).

**Pure (`lib/league.ts`):**
```ts
/** Word leagues are large; fixed leagues at or below PICKER_INLINE_MAX are not. */
export function isLargeLeague(groupSource: 'fixed' | 'answer-words' | undefined, groupCount: number): boolean {
  return groupSource === 'answer-words' || groupCount > PICKER_INLINE_MAX
}

export const LARGE_LEAGUE_TOP = 10

/**
 * Spec v2 §4.5: the top LARGE_LEAGUE_TOP ranked groups, plus the viewer's group
 * if it isn't already shown, plus how many active groups are unranked.
 * Input is standingsOf output (ranked first).
 */
export function largeLeagueSlice<G extends string>(
  standings: readonly Standing<G>[],
  viewerGroupId: G | null,
): { shown: Standing<G>[]; viewer: Standing<G> | null; unrankedCount: number } {
  const shown = standings.filter((s) => s.rank !== null).slice(0, LARGE_LEAGUE_TOP)
  const mine = viewerGroupId === null ? null : (standings.find((s) => s.groupId === viewerGroupId) ?? null)
  const viewer = mine && !shown.some((s) => s.groupId === mine.groupId) ? mine : null
  return { shown, viewer, unrankedCount: standings.filter((s) => s.rank === null).length }
}
```

Tests:
- top-10 cut;
- the viewer outside the top 10 is added;
- the viewer inside the top 10 isn't duplicated;
- an unranked viewer is added;
- `unrankedCount`;
- no viewer.

**`standingsFor(ctx, slug, today, viewerGroupId?)`:**
- For large leagues, standings come only from **this month's group rows**. There's no zero-fill: build each row from `leagueGroupMonth` plus a `get` of the group for name and order. The read cost is bounded by the number of active groups.
- The result gains `large: true`, the slice fields, and `groups` limited to the groups referenced in `shown`, `viewer` and `monthsWon` (for name lookup).
- `monthsWon` lists only groups with a count above 0.
- `lastMonth` gains `viewerRank: number | null`, taken from the snapshot's standings when `viewerGroupId` is in it. Derive the rank from the snapshot's stored order. Snapshots store standings in ranked order; confirm in `closeLeagueMonthFor`.
- Fixed small leagues keep today's exact shape with `large: false`.
- The `standings` wrapper gains `groupId: v.optional(v.id('leagueGroups'))`. **Privacy:** group totals are public, so a client passing any group id learns nothing new.

**`groupStanding({ slug, today, word })` query:**
- It does a point read of the group by slug, then a point read of its month row.
- It returns `{ group: { _id, name, memberCount }, boards, attempts, average, contributors } | null`. This doesn't know the group's rank, so there's no rank.
- It's gated like the other queries, and an unknown word returns null.

**`leaguesFor`:** for word leagues, `groups` becomes the top 6 by `memberCount`, read via `by_league_and_memberCount` with `.order('desc').take(6)`. These feed the quick picks. Fixed leagues are unchanged.

Tests:
- the slice through `standingsFor` with 12 active groups (top 10 plus a viewer at #12) and inactive groups not listed;
- `lastMonth.viewerRank`;
- the fixed-league shape unchanged (the existing tests stay green);
- `groupStanding` found and unknown;
- popular groups ordered by `memberCount` and capped at 6.

- [ ] Steps: red → green → gates → commit.

---

### Task A5: Nudges and upgrade origins

**Files:** create `src/lib/league-nudges.ts` (+ `league-nudges.test.ts`); modify `src/lib/plans.ts`, `src/lib/plans.test.ts`.

```ts
export type Nudge = { origin: 'leagues-behind' | 'league-result'; text: string }

/**
 * Spec v2 §4.6: contextual Insights upsell, at most one per surface, never for
 * Pro/trial players (`unlocked` = the contribution row's unlock, i.e. Pro or an
 * active trial).
 */
export function leaguePageNudge(f: {
  unlocked: boolean
  groupName: string | null
  rank: number | null
  average: number | null
  leaderAverage: number | null
  lastMonth: { monthName: string; viewerRank: number | null } | null
}): Nudge | null {
  if (f.unlocked || f.groupName === null) return null
  if (f.rank !== null && f.rank > 1 && f.average !== null && f.leaderAverage !== null) {
    const gap = (Math.round((f.average - f.leaderAverage) * 10) / 10).toFixed(1)
    return { origin: 'leagues-behind', text: `${f.groupName} is ${gap} guesses off the lead — see where you lose guesses.` }
  }
  if (f.lastMonth?.viewerRank != null) {
    return {
      origin: 'league-result',
      text: `${f.groupName} finished ${ordinal(f.lastMonth.viewerRank)} in ${f.lastMonth.monthName} — see what separates the top openers.`,
    }
  }
  return null
}
```

- `ordinal`: `1st`, `2nd`, `3rd`, `4th`, `11th`, `12th`, `13th`, `21st`, `22nd`, `23rd`, `101st`, `111th`. Test all of these.
- **Priority:** "behind" beats "result", so one nudge at most.
- **`plans.ts`:**
  - Add `'leagues-behind'` with the headline `'Find the guesses your group is losing'`.
  - Add `'league-result'` with the headline `'See what the top openers do differently'`.
  - Add both to `ORIGINS`. The overlap guard must pass; reword the headlines if it doesn't.

Tests cover every branch: unlocked → null; not a member → null; leader → no "behind"; behind (the gap formatting, e.g. 0.3); result only; behind beats result.

- [ ] Steps: red → green → gates → commit.

---

### Task A6: `WordPicker`

**Files:** create `src/components/leagues/word-picker.tsx` and `word-picker.hook.test.ts`.

**Props:**
```ts
{
  popular: PickerGroup[]
  currentWord: string | null
  onPick: (word: string) => void
  disabled?: boolean
  label?: string
  className?: string
}
```
`PickerGroup` comes from group-picker.

**Behaviour:**
- **Quick picks:** a `role="group"` with `aria-label={label ?? 'Choose a group'}` wrapping the popular words as buttons. Reuse `GroupPicker` for this part, with `onPick` mapping the group to its slug. Accessible names stay exactly the group names, and member counts are described, as now.
- **Search box:**
  - A labelled input ("Any Wordle answer word"), five letters, upper-cased as you type.
  - A Join button, disabled until `isAnswerWord(input)`.
  - A live hint: "Not a Wordle answer word" when there are five letters and the word isn't valid.
  - Enter submits when valid.
  - `onPick(normalizeWord(input)!)`.
- **`currentWord`:** the quick pick matching it is pressed.

**Tests:**
- quick pick calls `onPick('crane')`;
- typing `slate` and submitting calls `onPick('slate')`;
- `xxxxx` shows the hint and leaves Join disabled;
- fewer than five letters gives no hint and Join disabled;
- `disabled` disables everything;
- the group label resolves.

- [ ] Steps: red → green → gates → commit.

---

### Task A7: League page for word leagues

**Files:** `src/components/leagues/league-page-view.tsx` (+ test), `src/components/leagues/league-standings.tsx` (+ test), `src/routes/leagues.$slug.tsx`.

**Join and switch sections:**
- When the league is large (`standings.large`), render `WordPicker` instead of `GroupPicker`, with `popular` taken from `standings.popular`. Add `popular` to the large `standingsFor` payload in this task: the top 6 by `memberCount`, sharing A4's read helper.
- Callbacks become `onJoinWord(word)` and `onSwitchWord(word)`.
- The route wires these to `api.leagues.joinWord`/`switchWord` with `{ leagueId, word, today }`, where `today` is read at click time as now.
- The fixed path is unchanged.

**Standings:**
- **`LeagueStandings`:** when given `viewer` and `unrankedCount`, it renders:
  - the shown rows;
  - then, if there's a `viewer`, a separator and the viewer's row, with "you" and `aria-current`;
  - then "N more groups not ranked yet" when N > 0;
  - then a **"Find a group"** input that calls `groupStanding` through a callback prop `onFind(word)` and renders the result row: "SLATE — 4.1 · 12 boards", "not yet ranked (n/10)", or "No one plays for SLATE this month".
- The route owns the query, using `useQuery` with `'skip'` until a word is submitted.

**Nudge:**
- Below the standings, `leaguePageNudge(...)` renders one muted line plus an "Upgrade" link button calling `onUpgrade(nudge.origin)`.
- `unlocked` comes from the contribution query (`locked === false`). For non-members, the nudge is null because `groupName` is null.
- `leaderAverage` is `shown[0].average`.
- `lastMonth.monthName` comes from the existing `monthName`.
- Widen the route's `openUpgrade` call to take the origin.

**Tests** (in the view and standings tests):
- word picker shown for large leagues, fixed picker for fixed ones;
- viewer row appended;
- unranked count;
- find-a-group renders each result state;
- nudge shown for a locked behind-member, hidden when unlocked, with the result nudge after a closed month.

- [ ] Steps: red → green → gates → commit.

---

### Task A8: Home card and onboarding for word leagues

**Files:** `src/components/leagues/leagues-card.tsx` (+ test), `src/routes/app.tsx`.

- **Picker state:** render `WordPicker` (`popular` = `featured.groups`, now the top 6 from `leaguesFor`) instead of `GroupPicker` when the featured league is a word league. Add `groupSource` to `leaguesFor`'s payload. `onJoin` becomes `onJoinWord(word)`. "Not now" and the copy are unchanged.
- **`app.tsx`:** wire `api.leagues.joinWord` with `{ leagueId, word, today }` via `mutate` plus `onError`. Today is read at click time. Keep exactly one `.mutateAsync(` in the file; routes.test.ts pins it. `leaguesFor` must also return the league's `_id` as `leagueId`; add it.
- **Onboarding** still navigates to `/leagues`. No change.

**Tests:**
- the card shows WordPicker for a word league;
- a quick pick and a typed word each call `onJoinWord`;
- the fixed-league card path is unchanged;
- `pickerCouldShow` and `leaguesCardInput` are unchanged.

- [ ] Steps: red → green → gates → commit.

---

### Task A9: `/leagues` index cards

**Files:** `src/routes/leagues.index.tsx`. Move the card into a presentational component `src/components/leagues/league-directory.tsx` with a test.

- **One league:** the redirect stays.
- **Two or more leagues** (from v2b onwards), render two sections:
  - **"Your leagues":** one row per membership from `myLeagues`, showing group, rank and average, each linking to its league.
  - **"Join a league":** the rest, each with name and disclaimer (if any).
- The page component stays unexported.

**Tests** (directory component):
- both sections render;
- a league you're in isn't repeated under "Join";
- a disclaimer renders when present.

- [ ] Steps: red → green → gates → commit.

---

### Task A10: e2e by word, and local run

**Files:** `e2e/leagues.spec.ts`.

1. After landing on `/leagues/starting-words`, type **CRANE** into the "Any Wordle answer word" box and press Join, instead of clicking the quick pick. That exercises the search path. CRANE is seeded, so it's always present.
2. Assert membership and the "you" row as now.
3. Back on the dashboard, assert the member link as now.

Run ONLY the leagues spec against the local backend, using the same guard, dashboard check and Node 22 workaround as v1 Task 14. Stop by PID afterwards.

- [ ] Steps: update → run locally (report the summary line) → gates → commit.

---

### Task A11: Dev rollout (owner-run, no code)

1. CI is green on the final v2a commit (the controller watches it).
2. The owner re-runs the seed on dev to set `groupSource: 'answer-words'` on the existing league. It's idempotent, and the five groups stay:
   ```
   ! CONVEX_URL=https://successful-canary-135.convex.cloud CONVEX_MIGRATION_KEY="$(sed -n 's/^CONVEX_DEPLOY_KEY=//p' .env.dev.local | tr -d '"')" node scripts/seed-league.mjs --confirm-host=successful-canary-135.convex.cloud
   ```
3. Owner hand checks:
   - typing a new word (e.g. AUDIO) creates and joins its group;
   - a non-word shows the hint;
   - quick picks show the popular words;
   - standings show the viewer row and the unranked count;
   - "Find a group" works;
   - a free account sees the nudge when behind.

---

## Self-review notes

- **Spec coverage:** every v2a row in spec §7 maps to a task:
  - word list → A1
  - `groupSource` and indexes → A2
  - lazy groups and `UNKNOWN_WORD` → A2/A3
  - word-addressed join and switch → A3
  - slice and `groupStanding` → A4
  - search picker and quick picks → A6/A7/A8
  - directory → A9
  - nudges → A5/A7
  - e2e → A10
- The `challenge-result` nudge is v2c, per the spec.
- **Deliberate deviation from spec §4.2:** joining is by `leagueId + word` through new mutations instead of changing `joinGroup`'s arguments. The id-based mutations stay for fixed leagues, and their behaviour is unchanged.
