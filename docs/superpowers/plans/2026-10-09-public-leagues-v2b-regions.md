# Public Leagues v2b: Regions. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An automatic region league. Every player with a saved time zone plays for their region, with no membership rows. The region is fixed for the month, players can opt out and rejoin, and the region has its own page and appears on the home card and in the directory.

**Architecture:**
- Pure, client-safe rules:
  - `convex/lib/regions.ts`: the IANA → region table and `regionOf`.
  - Additions to `convex/lib/league.ts`:
    - `regionGroupFor` and `regionCountsFrom`: placement and its start day.
    - `pickerModeFor`: one picker decision for the page and the card (vzvp).
- One server helper, `regionPlacementOf`, answers "which region group, from which day" for a player and a month. Three readers share it:
  - the write path (`recomputeLeagueMonthFor`), which feeds the placement to the existing `memberTotalsFor` as a synthetic interval;
  - `myRegionFor`, the region page and directory status;
  - `myLeaguesFor`, the home card row.
- The membership engine (`planJoin`/`planSwitch`/`planLeave`) is untouched. Region leagues refuse it outright.

**Tech Stack:** Convex (convex-test + vitest), TanStack Start/Router, React, shadcn/ui, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-public-leagues-v2-design.md` (v2) §4.3, §4.4, §5, §6 and §8, on top of `docs/superpowers/specs/2026-10-07-public-leagues-design.md` (v1). §-references are to v2 unless marked v1. Pre-plan notes are in beads `wordle-teams-vzvp`.

---

## Owner decisions for this plan (2026-10-09)

| Question | Decision | Ruled out |
| --- | --- | --- |
| Which boards count at launch | **From the day after the region league is seeded**, like a join, which counts from tomorrow. The league's `createdAt` is the only state needed. | Pulling in the whole launch month on the first board write (retroactive). |
| US/Canada group names | **`US Eastern`, `US Central`, `US Mountain`, `US Pacific`, `Alaska`, `Hawaii`**, with the Canadian zones folded in (Toronto → US Eastern). Matches the spec's "You're in US Central". | "US & Canada Eastern" (long); bare "Central" (ambiguous). |
| Home card for a player in a region but not in Starting Words | **The region row and the unchanged "Join the opener wars" offer, in one card.** The offer predicate ignores region rows. | Region row only, which would hide the opener offer from almost every player. |
| `memberCount` on region groups | **Not maintained** (stays 0). Nothing renders it for a region: GroupPicker is the only reader, and regions have no picker. Region surfaces show this month's `contributors`. A source comment says so. | Bumping it on a player's first member-month row, which needs month-rollover rules and adds writes to the hottest rows. |

## Plan-level decisions (approve with the plan)

1. **Opt-out and rejoin are their own mutations,** `leaveRegion({ today })` and `rejoinRegion({ today })`. Both are idempotent.
   - Rejoin stores `players.regionLeagueFrom = tomorrow` next to the opt-out day `regionLeagueOptOutDay`, because "rejoin counts from tomorrow" needs a day to count from.
   - `joinGroup`, `switchGroup`, `joinWord`, `switchWord` and `leaveLeague` refuse a region league with a new code, **`AUTOMATIC_LEAGUE`**.
2. **One region league, found by a new index `leagues.by_kind`.** The write path reads it with `.first()`, never `.unique()`: a board write must never throw because two region leagues exist.
3. **Placement is defined in one place.** A player is placed in a month when they have not opted out and either:
   - they already have a member-month row for that month (**sticky**), or
   - their time zone maps to a seeded region group.

   A player is placed even before their first board, so the home card and the region page show the region straight away. Rows and totals still appear only when a board is written.
4. **A time-zone change before any board this month moves the player at once.** Stickiness needs a member-month row to stick to. This is a narrow, intentional reading of "a time-zone change takes effect next month". The copy says so only where it's true: the region page shows "Moving to X on Nov 1" only when the player is sticky and their zone now maps elsewhere.
5. **Region standings use the existing large-league shape.** There are 12 groups, which is more than `PICKER_INLINE_MAX`. The page gets `kind: 'region'` on the standings payload. **"Find a group" is shown only for `answer-words` leagues** (vzvp note). It searches 5-letter words, so it's wrong for regions and, later, sports.
6. **"Set your time zone" is text, not a link.** Settings is a dialog with no route (`settings-dialog.tsx`), so the text says where to go: Settings → Alerts → Time Zone. `use-local-capture` writes the zone on first sign-in, so in practice this state is rare.
7. **The teamless onboarding step goes straight to `/leagues/starting-words`.** With 2 leagues, `/leagues` becomes the directory (spec §5), and the step's copy is "Join the opener wars". A new client-safe constant `OPENER_LEAGUE_SLUG` in `lib/league.ts` names it.
8. **Group set: 12 regions** (B1 has the table). The spec's "Australia & NZ" becomes **"Australia & Pacific"**, because the app's own picker offers `Pacific/Fiji` under that heading. Atlantic and Newfoundland Canada fold into US Eastern, the nearest group, because they're too small to stand alone.
9. **Cost, stated:** every board write by a player with a mapped zone now pays the member cost: the player, the region league, the month's boards, and one group-month row. That used to be only league members. Every US Eastern board writes the same `leagueGroupMonth` row, which makes `wordle-teams-1hfl` (hot-group OCC) real rather than theoretical. At about 400 players spread across the day, Convex's retries absorb it. B3 adds a note to 1hfl and does nothing more.

## Explicitly out of scope

Sports (v2c) and the `challenge-result` nudge; backfilling past months; region push notifications; a settings deep-link; maintaining region `memberCount`; nickname search for large fixed leagues (v2c). The open follow-ups qu0o, vmhl, 1hfl, jck4, pck4, 8s6s, 55lh, 029l, tdkl, p3gc, vrtk and dgba stay out unless one blocks a task.

## Ground rules (every task)

These are the same as v2a. The controller writes them to the session's `scratchpad/tasks/ground-rules.md` and every implementer reads that file.

- **Gates:** run all four separately (`TZ=UTC pnpm test:once`, `pnpm typecheck`, `pnpm lint`, `pnpm build`) and read each exit code. Never pipe a gate.
- **Commits:** quoted-heredoc commit messages. Commit red, then green.
- **Refusals:** always `throw accessError(code)`.
- **`convex/_generated/api.d.ts`** is hand-maintained. Add `lib/regions` by hand.
- **Convex CLI:** never run it without the local-only `--env-file` guard. `.env.local` holds the production deploy key.
- **No pushes and no amends** by subagents.
- **Wrapper tests:** test public wrappers through `authenticatedAs` from `convex/fixtures.ts`, not source pins.
- **The write path must never throw on region data:** a missing league, a missing group or an unknown zone means log and place nowhere.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `convex/lib/regions.ts` (+ test) | create | `REGIONS`, `regionOf` |
| `convex/lib/league.ts` (+ test) | modify | `regionGroupFor`, `regionCountsFrom`, `pickerModeFor`, `OPENER_LEAGUE_SLUG`, `LeagueKind` |
| `convex/schema.ts` | modify | `leagues.kind` + `by_kind`; `players.regionLeagueOptOutDay`, `players.regionLeagueFrom` |
| `convex/access.ts`, `src/lib/convex-error.ts` (+ test) | modify | `AUTOMATIC_LEAGUE` |
| `convex/leagues.ts` (+ test) | modify | `REGION_LEAGUE` spec; `kind` in seed and payloads; refusals; `regionPlacementOf`; write path; `leaveRegion`/`rejoinRegion`; `myRegion`; region row in `myLeaguesFor` |
| `convex/e2eSeed.ts` | modify | `ensureLeagueFor` seeds the region league too |
| `src/components/leagues/leagues-card.tsx` (+ test), `src/routes/app.tsx` | modify | `pickerModeFor`; region row + offer; onboarding target |
| `src/components/leagues/league-page-view.tsx` (+ test), `src/components/leagues/region-panel.tsx` (+ test, create), `src/routes/leagues.$slug.tsx` | modify | Region branch, `pickerModeFor`, word-only Find |
| `src/components/leagues/league-directory.tsx` (+ test), `src/routes/leagues.index.tsx` | modify | Region card status |
| `e2e/leagues.spec.ts` | modify | Region path |

---

### Task B1: The region table

**Files:** create `convex/lib/regions.ts` and `convex/lib/regions.test.ts`; add `lib/regions` to `api.d.ts` by hand.

```ts
/**
 * REGIONS (spec v2 §4.3/§4.4): a player's saved IANA time zone → the region
 * group they play for. Client-safe: no imports. Static, so no upkeep.
 *
 * ORDER IS EXPLICIT TABLE, THEN PREFIX FALLBACK, THEN NULL. The table holds
 * every US and Canadian zone (they cannot use a prefix: America/* is mostly
 * Latin America), the UK and Ireland, and the few non-continent prefixes.
 * Canada folds into the US groups (owner, 2026-10-09); Atlantic and
 * Newfoundland Canada into US Eastern, the nearest. UTC, Etc/* and Antarctica/*
 * are null: no region, and the page says so.
 * Legacy link names (US/Eastern, Canada/Pacific, GB, Asia/Calcutta…) are listed
 * because v1 rows were copied verbatim (src/lib/time-zones.ts).
 */
export type Region = { slug: string; name: string }

export const REGIONS = [
  { slug: 'us-eastern', name: 'US Eastern' },
  { slug: 'us-central', name: 'US Central' },
  { slug: 'us-mountain', name: 'US Mountain' },
  { slug: 'us-pacific', name: 'US Pacific' },
  { slug: 'alaska', name: 'Alaska' },
  { slug: 'hawaii', name: 'Hawaii' },
  { slug: 'uk-ireland', name: 'UK & Ireland' },
  { slug: 'europe', name: 'Europe' },
  { slug: 'africa', name: 'Africa' },
  { slug: 'asia', name: 'Asia' },
  { slug: 'australia-pacific', name: 'Australia & Pacific' },
  { slug: 'latin-america', name: 'Latin America & Caribbean' },
] as const satisfies readonly Region[]

type Slug = (typeof REGIONS)[number]['slug']
const BY_SLUG = new Map<string, Region>(REGIONS.map((r) => [r.slug, r]))

// Every zone in the "ZONES must contain" lists below, one block per region.
const ZONES: Record<string, Slug> = {
  'America/New_York': 'us-eastern',
  'America/Chicago': 'us-central',
  // …the rest of the lists below, verbatim
}

const PREFIXES: Record<string, Slug> = {
  Europe: 'europe', Arctic: 'europe',
  Africa: 'africa',
  Asia: 'asia', Indian: 'asia',
  Australia: 'australia-pacific', Pacific: 'australia-pacific', NZ: 'australia-pacific',
  America: 'latin-america', Brazil: 'latin-america', Chile: 'latin-america', Mexico: 'latin-america',
}

export function regionOf(timeZone: string | null | undefined): Region | null {
  if (!timeZone) return null
  const exact = ZONES[timeZone]
  if (exact) return BY_SLUG.get(exact)!
  const prefix = PREFIXES[timeZone.split('/')[0]]
  return prefix ? BY_SLUG.get(prefix)! : null
}
```

**`ZONES` must contain:**
- **US Eastern:** America/New_York, Detroit, Kentucky/Louisville, Kentucky/Monticello, Louisville, Indiana/Indianapolis, Indianapolis, Fort_Wayne, Indiana/Vincennes, Indiana/Winamac, Indiana/Marengo, Indiana/Petersburg, Indiana/Vevay; Toronto, Montreal, Nipigon, Thunder_Bay, Iqaluit, Pangnirtung (not Nassau: Bahamas falls back to Latin America); Halifax, Glace_Bay, Moncton, Goose_Bay, St_Johns; US/Eastern, US/Michigan, US/East-Indiana, Canada/Eastern, Canada/Atlantic, Canada/Newfoundland, EST5EDT, EST.
- **US Central:** America/Chicago, Indiana/Knox, Knox_IN, Indiana/Tell_City, Menominee, North_Dakota/Center, North_Dakota/New_Salem, North_Dakota/Beulah, Winnipeg, Rainy_River, Rankin_Inlet, Resolute, Regina, Swift_Current; US/Central, US/Indiana-Starke, Canada/Central, Canada/Saskatchewan, CST6CDT.
- **US Mountain:** America/Denver, Boise, Phoenix, Shiprock, Edmonton, Cambridge_Bay, Yellowknife, Inuvik, Creston, Dawson_Creek, Fort_Nelson, Whitehorse, Dawson; US/Mountain, US/Arizona, Navajo, Canada/Mountain, Canada/Yukon, MST7MDT, MST.
- **US Pacific:** America/Los_Angeles, Vancouver; US/Pacific, Canada/Pacific, PST8PDT.
- **Alaska:** America/Anchorage, Juneau, Sitka, Metlakatla, Yakutat, Nome; US/Alaska.
- **Hawaii:** Pacific/Honolulu, Pacific/Johnston, America/Adak, America/Atka; US/Hawaii, US/Aleutian, HST.
- **UK & Ireland:** Europe/London, Dublin, Belfast, Guernsey, Isle_of_Man, Jersey; GB, GB-Eire, Eire.
- **Europe:** Atlantic/Reykjavik, Azores, Madeira, Canary, Faroe, Faeroe, Jan_Mayen; Iceland, Poland, Portugal, Turkey, WET, CET, MET, EET.
- **Africa:** Atlantic/Cape_Verde, St_Helena; Indian/Antananarivo, Comoro, Mayotte, Mauritius, Reunion, Mahe; Egypt, Libya.
- **Asia:** Japan, ROK, PRC, ROC, Hongkong, Singapore, Israel, Iran.
- **Latin America & Caribbean:** Atlantic/Bermuda, Stanley, South_Georgia; Cuba, Jamaica.
- **Australia & Pacific:** Kwajalein, NZ-CHAT.

**Before committing, cross-check the US and CA rows of `/usr/share/zoneinfo/zone1970.tab` and `tzdata`'s `backward` file**, if present on the machine. Every US/CA zone listed there must be in `ZONES`. Report any you add.

**Tests:**
- **every value in `REGIONS` is reached** by at least one zone;
- **US/Canada:** every zone in each list above maps to its region. Use a `test.each` over a literal per region; it duplicates the table on purpose, since a table typo is exactly what this catches;
- **the fallbacks:** `Europe/Paris` → Europe, `Europe/Moscow` → Europe, `Asia/Kolkata` → Asia, `Australia/Perth` → Australia & Pacific, `Pacific/Auckland` → Australia & Pacific, `Pacific/Fiji` → Australia & Pacific, `America/Sao_Paulo` → Latin America & Caribbean, `America/Mexico_City` → Latin America & Caribbean, `Africa/Nairobi` → Africa;
- **unknown or null:** `UTC`, `Etc/GMT+5`, `Antarctica/McMurdo`, `''`, `null`, `undefined`, `'Not/AZone'`;
- **the five Postgres spellings** (`Asia/Calcutta`, `Asia/Katmandu`, `Asia/Rangoon`, `Europe/Kyiv`, `Pacific/Kanton`) and their IANA pairs both map, and to the same region;
- **exhaustive:** for every `z` in `Intl.supportedValuesOf('timeZone')`, `regionOf(z)` is non-null unless `z` is `UTC` or starts with `Etc/` or `Antarctica/`;
- **the app's picker:** every value in `TIME_ZONE_GROUPS` (`src/lib/time-zones.ts`) maps. If an import-graph guard refuses a `convex/` → `src/` import, inline the 27 values with a comment naming the source.

- [ ] Steps: red test → commit red → implement → green → four gates → commit green.

**Mutation check:** delete `America/Chicago` from `ZONES` (it falls through to Latin America): the US Central test must fail. Delete the `Pacific` prefix: the Fiji test must fail.

---

### Task B2: Schema, region league spec, `AUTOMATIC_LEAGUE`, pure placement rules

**Files:** `convex/schema.ts`, `convex/lib/league.ts` (+ test), `convex/leagues.ts` (+ test), `convex/access.ts`, `src/lib/convex-error.ts` (+ test).

1. **`leagues`:** `kind: v.optional(v.union(v.literal('picked'), v.literal('region')))`. Absent means `'picked'`. Comment it like `groupSource`. Add `.index('by_kind', ['kind'])` with a comment naming its readers (`regionLeagueOf`).
2. **`players`:**
   ```ts
   // REGION OPT-OUT (spec v2 §4.4): the PuzzleDay the player left their region
   // league (leaveRegion's validated local `today`, never a UTC timestamp);
   // absent = in it. Set by leagues.leaveRegion, cleared by rejoinRegion.
   regionLeagueOptOutDay: v.optional(v.string()),
   // The first PuzzleDay a REJOINED player's boards count for their region
   // (tomorrow at the rejoin). Absent = never rejoined. Never cleared: once in
   // the past it no longer binds (regionCountsFrom takes the later day).
   regionLeagueFrom: v.optional(v.string()),
   ```
3. **`lib/league.ts`** (pure):
   ```ts
   export type LeagueKind = 'picked' | 'region'
   /** The opener league: the onboarding step and the home card's offer (spec §5). */
   export const OPENER_LEAGUE_SLUG = 'starting-words'

   /**
    * WHICH REGION GROUP a player plays for this month (spec v2 §4.4). Opted out:
    * none. Otherwise the month's existing row (MONTH-STICKY: a time-zone change
    * waits for next month), else the group for their time zone, else none.
    */
   export function regionGroupFor<G extends string>(f: { optedOut: boolean; stickyGroupId: G | null; zoneGroupId: G | null }): G | null {
     if (f.optedOut) return null
     return f.stickyGroupId ?? f.zoneGroupId
   }

   /**
    * THE FIRST DAY a region board counts (owner 2026-10-09): the day after the
    * league was seeded (never retroactive, like a join), or the rejoin day if later.
    */
   export function regionCountsFrom(seededDay: PuzzleDay, rejoinFrom: PuzzleDay | null): PuzzleDay {
     const launch = addDays(seededDay, 1)
     return rejoinFrom !== null && rejoinFrom > launch ? rejoinFrom : launch
   }

   /**
    * HOW A LEAGUE IS JOINED (vzvp), shared by league-page-view and leagues-card:
    * a region never by a picker (placement is automatic), a word league by word,
    * anything else by group button.
    */
   export function pickerModeFor(l: { groupSource?: 'fixed' | 'answer-words'; kind?: LeagueKind }): 'words' | 'groups' | 'none' {
     if (l.kind === 'region') return 'none'
     return l.groupSource === 'answer-words' ? 'words' : 'groups'
   }
   ```
   Check whether `addDays` is already imported in `lib/league.ts`. If not, import it from `./puzzleDay.ts`; that file is client-safe.
4. **`leagues.ts`:**
   - `LeagueSpec` gains `kind?: LeagueKind`.
   - `STARTING_WORDS.slug` becomes `OPENER_LEAGUE_SLUG`.
   - Add the region league spec:
     ```ts
     /** v2b's automatic league: groups are REGIONS (lib/regions.ts), placement is by time zone. */
     export const REGION_LEAGUE: LeagueSpec = {
       slug: 'regions', name: 'Regions', featured: false, kind: 'region',
       groups: REGIONS.map(({ slug, name }) => ({ slug, name })),
     }
     ```
   - Add it to `LEAGUE_SPECS`.
   - `seedLeagueFor` writes and patches `kind` exactly as it does `groupSource` (`...(spec.kind ? { kind: spec.kind } : {})`).
   - `leaguesFor` adds `kind: league.kind ?? ('picked' as const)` to each row.
   - Add `regionLeagueOf`:
     ```ts
     /** THE region league, or null before it is seeded. .first(): the write path must never throw on a duplicate. */
     export async function regionLeagueOf(ctx: ReaderCtx) {
       return await ctx.db.query('leagues').withIndex('by_kind', (q) => q.eq('kind', 'region')).first()
     }
     ```
   - **Refusals.** Add `requirePickedLeague(league)`, which throws `AUTOMATIC_LEAGUE` when `league.kind === 'region'`. Call it:
     - in `joinGroupFor` and `switchGroupFor`, after `requireGroup`, on `await ctx.db.get(group.leagueId)` (a missing league here is `UNKNOWN_LEAGUE`);
     - in `joinWordFor` and `switchWordFor`, after `requireLeague`, before the plan pre-check;
     - in `leaveLeagueFor`, on the league it already reads.
5. **`AccessCode`:** add `'AUTOMATIC_LEAGUE'` with a comment naming the throw sites. Client copy: `"Your region comes from your time zone, so there's nothing to join."` Extend the convex-error `test.each`.

**Tests:**
- the pure helpers, every branch:
  - `regionGroupFor`: opted out with a sticky row is null; sticky beats zone; zone only; neither;
  - `regionCountsFrom`: no rejoin; rejoin earlier than launch; rejoin later; a month boundary in `addDays`;
  - `pickerModeFor`: all three answers, plus `kind` absent;
- seeding `REGION_LEAGUE` creates 12 groups in `REGIONS` order with `kind: 'region'`;
- a re-seed is idempotent and patches `kind` onto an existing league that lacked it;
- `leaguesFor` carries `kind` for both leagues;
- `joinGroup` on a region group refuses `AUTOMATIC_LEAGUE`, through the wrapper via `authenticatedAs`, and leaves no membership row;
- `switchGroupFor`, `joinWordFor`, `switchWordFor` and `leaveLeagueFor` each refuse `AUTOMATIC_LEAGUE` on the region league;
- the Starting Words paths are unchanged (the existing tests stay green).

**Mutation check:** remove the `requirePickedLeague` call in `joinGroupFor`: the wrapper test must fail.

- [ ] Steps: red → commit red → green → gates → mutation check → commit.

---

### Task B3: Automatic placement in the write path

**Files:** `convex/leagues.ts`, `convex/leagues.test.ts`. Add a note to beads `wordle-teams-1hfl` (plan decision 9).

```ts
type Placement = { groupId: GroupId; fromDay: PuzzleDay; sticky: boolean }

/**
 * A player's region placement for ONE month (spec v2 §4.4), or null. The ONE
 * definition: the write path, myRegionFor and myLeaguesFor all call this.
 * NEVER THROWS: a zone with no seeded group is logged and places nowhere, since
 * this runs inside every board write.
 */
export async function regionPlacementOf(
  ctx: ReaderCtx,
  player: Doc<'players'>,
  league: Doc<'leagues'>,
  month: PuzzleMonth,
): Promise<Placement | null> {
  const { year, month: m } = yearMonthOf(month)
  const row = await ctx.db
    .query('leagueMemberMonth')
    .withIndex('by_player_league_year_month', (q) => q.eq('playerId', player._id).eq('leagueId', league._id).eq('year', year).eq('month', m))
    .unique()
  let zoneGroupId: GroupId | null = null
  const region = row ? null : regionOf(player.timeZone)
  if (region) {
    const group = await ctx.db
      .query('leagueGroups')
      .withIndex('by_league_and_slug', (q) => q.eq('leagueId', league._id).eq('slug', region.slug))
      .unique()
    if (group) zoneGroupId = group._id
    else console.error(`leagues: region ${region.slug} has no seeded group in league ${league._id}`)
  }
  const rules = regionRulesFor(month, {
    optOutDay: player.regionLeagueOptOutDay ?? null,
    rejoinFrom: player.regionLeagueFrom ?? null,
  })
  const groupId = regionGroupFor({ optedOut: rules.optedOut, stickyGroupId: row?.groupId ?? null, zoneGroupId })
  if (groupId === null) return null
  const fromDay = regionCountsFrom(toPuzzleDay(new Date(league.createdAt)), rules.rejoinFrom)
  return { groupId, fromDay, sticky: row !== null }
}
```

The dated rules (`regionRulesFor`, each binding only the month it happened in and later) came from the B3 and B4 reviews; the first draft read the opt-out and rejoin undated, which made a leave retroactive.

**`recomputeLeagueMonthFor`.** Replace the `leagueIds` set with a map from league to intervals. The loop body is unchanged except where it gets its intervals:

```ts
const intervalsOf = new Map<Id<'leagues'>, Interval<GroupId>[]>()
for (const r of memberships) intervalsOf.set(r.leagueId, [...(intervalsOf.get(r.leagueId) ?? []), r])
for (const r of existing) if (!intervalsOf.has(r.leagueId)) intervalsOf.set(r.leagueId, [])
// REGIONS (spec v2 §4.4): no membership rows. The placement IS the interval,
// open-ended from regionCountsFrom. An existing row with no placement (opted
// out) keeps its empty entry above, so it is recomputed to nothing.
const regionLeague = await regionLeagueOf(ctx)
if (regionLeague) {
  const player = await ctx.db.get(playerId)
  const placed = player ? await regionPlacementOf(ctx, player, regionLeague, month) : null
  if (placed) intervalsOf.set(regionLeague._id, [{ groupId: placed.groupId, fromDay: placed.fromDay }])
}
if (intervalsOf.size === 0) return
```

- The `for (const leagueId of leagueIds)` loop becomes `for (const [leagueId, intervals] of intervalsOf)`, and `memberTotalsFor(boards, intervals, month)` replaces the per-league filter.
- **Rename the local `intervalsOf`** if it shadows the module's `intervalsOf` function; `byLeague` is fine.
- Update the docstring's COST paragraph: a player with a mapped zone now pays the member cost. Name plan decision 9 and `wordle-teams-1hfl`.
- Region placement is **not gated** on `LEAGUES_ENABLED` (spec §6). Say so beside the existing note in `scores.ts`.

**Tests** (handler level, with `REGION_LEAGUE` seeded at a fixed `createdAt`; boards through the same helper the existing write-path tests use):
- **placement on a board write:** a player in `America/Chicago` with a board the day after the seed day gets a member-month row in US Central and a group-month row with boards 1 and contributors 1;
- **never retroactive:** a board on the seed day itself, or earlier in the month, does not count;
- **month-sticky:** board, then a switch of the time zone to `America/New_York`, then another board in the same month: both count for US Central. A board next month counts for US Eastern;
- **move before any board:** a time-zone change with no row this month places in the new region at the first board;
- **no time zone, or `UTC`:** a board creates no region rows;
- **opted out** (field set directly): no row;
- **an existing row plus an opt-out:** recomputing removes the row and takes its totals back out of the group;
- **flag off:** placement still happens with `LEAGUES_ENABLED` unset;
- **a player in both Starting Words and a region:** one board counts for both leagues;
- **a missing seeded group** (delete US Central's group row): the board write succeeds and logs, with no region row;
- **no region league seeded:** the existing write-path tests stay green, with no extra rows.

**Mutation checks:**
- drop the `row ? null :` stickiness, so a time-zone change moves the player at once: the month-sticky test must fail;
- replace `regionCountsFrom(...)` with the month start: the never-retroactive test must fail;
- remove the opted-out argument (pass `false`): the opt-out test must fail.

- [ ] Steps: red → commit red → green → gates → mutation checks → commit.

---

### Task B4: Leave and rejoin

**Files:** `convex/leagues.ts`, `convex/leagues.test.ts`.

```ts
async function requireRegionLeague(ctx: ReaderCtx) {
  const league = await regionLeagueOf(ctx)
  if (!league) throw accessError('UNKNOWN_LEAGUE')
  return league
}

/** Spec v2 §4.4: opt out; this month's row goes through the normal delta path. IDEMPOTENT. */
export async function leaveRegionFor(ctx: WriterCtx, playerId: Id<'players'>, args: { today: string }) {
  const today = requirePlausibleToday(args.today)
  await requireRegionLeague(ctx)
  const player = await ctx.db.get(playerId)
  if (player && player.regionLeagueOptOutDay === undefined) await ctx.db.patch(playerId, { regionLeagueOptOutDay: today })
  await recomputeAfterMembershipChange(ctx, playerId, today)
}

/** Rejoin counts from TOMORROW (spec v2 §4.4). A no-op for a player who never left. */
export async function rejoinRegionFor(ctx: WriterCtx, playerId: Id<'players'>, args: { today: string }) {
  const today = requirePlausibleToday(args.today)
  await requireRegionLeague(ctx)
  const player = await ctx.db.get(playerId)
  if (!player || player.regionLeagueOptOutDay === undefined) return
  await ctx.db.patch(playerId, { regionLeagueOptOutDay: undefined, regionLeagueFrom: addDays(today, 1) })
  await recomputeAfterMembershipChange(ctx, playerId, today)
}
```

Add the public wrappers `leaveRegion` and `rejoinRegion`: `gate()`, `requirePlayer`, args `{ today: v.string() }`.

**Tests:**
- leaving removes this month's region row and its group totals, and sets the field;
- a second leave doesn't move the stamp;
- after leaving, a new board creates no row;
- rejoining clears the opt-out and sets `regionLeagueFrom` to tomorrow;
- a board for today after the rejoin does not count, and a board for tomorrow does;
- a board entered for the 1st of next month before a leave on the last day: the leave removes next month's row too (`recomputeAfterMembershipChange` reaches it);
- rejoining when never opted out writes nothing;
- both wrappers refuse `LEAGUES_DISABLED` when dark, and with no region league seeded they refuse `UNKNOWN_LEAGUE` (through `authenticatedAs`);
- an implausible `today` refuses `INVALID_DATE`.

**Mutation check:** make rejoin set `regionLeagueFrom: today`: the "board for today doesn't count" test must fail.

- [ ] Steps: red → commit red → green → gates → mutation check → commit.

---

### Task B5: Region reads: `myRegion`, the region row in `myLeagues`, `kind` in standings

**Files:** `convex/leagues.ts`, `convex/leagues.test.ts`.

```ts
export type RegionStatus =
  | { state: 'no-time-zone'; league: RegionLeagueRef }
  | { state: 'unmapped'; league: RegionLeagueRef; timeZone: string }
  | { state: 'opted-out'; league: RegionLeagueRef; region: { name: string } | null }
  | {
      state: 'placed'
      league: RegionLeagueRef
      group: { _id: GroupId; name: string }
      /** The first day a board counts this month: the month start, or later after a launch or rejoin. */
      countsFrom: PuzzleDay
      /** Sticky this month, but the zone now maps elsewhere: where they move on the 1st. */
      next: { name: string; from: PuzzleDay } | null
    }
type RegionLeagueRef = { leagueId: Id<'leagues'>; slug: string; name: string }

/** Null before the region league is seeded (the directory and page then show no region). */
export async function myRegionFor(ctx: ReaderCtx, playerId: Id<'players'>, today: PuzzleDay): Promise<RegionStatus | null>
```

**Rules:**
1. If opted out: `'opted-out'`, with `region: regionOf(timeZone)` (name only).
2. If there's no `timeZone`: `'no-time-zone'`.
3. Otherwise call `regionPlacementOf` for `monthOf(today)`:
   - null means `'unmapped'`;
   - otherwise `'placed'`, with the group's name from a `get`.
4. `countsFrom = max(monthRange(month).start, placement.fromDay)`.
5. `next` is set only when `placement.sticky` and `regionOf(timeZone)?.slug` differs from the placed group's slug. Its `from` is the 1st of next month.

**`myLeaguesFor`:**
- Every row gains `kind: 'picked' as const`.
- After the picked rows, if `myRegionFor` is `'placed'`, append one region row:
  ```ts
  {
    kind: 'region' as const,
    league: { slug, name }, leagueId,
    group: placed.group,
    since: placed.countsFrom,
    pending: placed.next ? { group: { _id: placed.group._id, name: placed.next.name }, from: placed.next.from } : null,
    rank, average, boards, // from currentStandings over groupsOf (12 groups, one range read)
  }
  ```
  For `pending.group._id`, use the zone group's real id. `regionPlacementOf` doesn't return it, so read it by slug. Don't reuse the placed id.
- **Order:** picked rows first, region last, so the home card's cap of 3 keeps picked leagues when it has to drop one.

**`standingsFor`:** both shapes gain `kind: league.kind ?? ('picked' as const)`. No other change: the region league takes the large fixed path (12 groups), with `pickable` set.

**`myRegion` query:** `{ today }`. It returns `{ enabled: false }` when dark, otherwise `{ enabled: true, region: RegionStatus | null }`, gated like `myLeagues`.

**Tests:**
- each of the four states;
- `countsFrom` in the launch month (seed day + 1), a later month (the 1st) and after a rejoin;
- `next` when sticky and moved, null when not sticky;
- `myLeagues` lists the region row last, with rank, average and boards from this month, and `kind: 'region'`;
- `myLeagues` has no region row for the opted-out, no-zone and unmapped states;
- `standings` for `regions` returns `kind: 'region'` and the viewer row;
- `myRegion` when dark, through `authenticatedAs`;
- **privacy:** no region payload carries a player id other than the caller's. Assert key names, as the existing privacy tests do.

- [ ] Steps: red → commit red → green → gates → commit.

---

### Task B6: Home card and onboarding

**Files:** `src/components/leagues/leagues-card.tsx` (+ test), `src/routes/app.tsx`, `src/components/leagues/my-league-row.tsx` (type only).

1. **`MyLeague` / `MyLeagueRowData`** gain `kind: 'picked' | 'region'`.
2. **`pickerCouldShow`:** "no current rows" becomes "no current **picked** rows". Change the parameter type to `readonly { kind: 'picked' | 'region' }[]` and the test to `myLeagues.leagues.every((l) => l.kind === 'region')`. Update the docstring, which says "NO current rows".
3. **`leaguesCardInput`:**
   ```ts
   if (!myLeagues?.enabled) return null
   const offer = pickerCouldShow({ myLeagues, ...viewer }) && allLeagues?.enabled ? (allLeagues.leagues.find((l) => l.featured) ?? null) : null
   if (myLeagues.leagues.length === 0 && !offer) return null
   return { mine: myLeagues.leagues, featured: offer }
   ```
4. **`LeaguesCard`:**
   - With no rows and an offer, the markup is **byte-for-byte as today**. Existing tests pin it.
   - With rows and an offer, it's one `Leagues` card: the rows, then an `h3` "Join the opener wars", the sentence, the picker and "Not now". "Not now" is `aria-describedby` that `h3`.
   - With rows only, it's as today.
   - The picker choice uses `pickerModeFor(featured)`. `'none'` renders no picker; that can't happen for the featured league, so add a comment.
5. **`app.tsx`:** the onboarding step's `onLeague` navigates to `/leagues/$slug` with `{ slug: OPENER_LEAGUE_SLUG }`. Comment why: `/leagues` is the directory once regions exist. Keep exactly one `.mutateAsync(` in the file (routes.test.ts).
6. **Before choosing the `h3` approach, check the dashboard tests** (`app.hook.test`-style files) that query the card by heading. Report any that need changing.

**Tests:**
- a region-only player who never joined Starting Words gets the row and the offer;
- a Starting Words member with a region gets two rows and no offer;
- a dismissed player gets the row only;
- a teamless call site (`offerPicker: false`) gets the row only;
- the cap is still 3 with "See all";
- `pickerCouldShow` is true with only region rows;
- `pickerModeFor` drives the word picker or the group picker (the existing card tests stay green).

**Mutation check:** revert `pickerCouldShow` to `length === 0`: the region-only offer test must fail.

- [ ] Steps: red → commit red → green → gates → mutation check → commit.

---

### Task B7: Region page

**Files:**
- create `src/components/leagues/region-panel.tsx` (+ `region-panel.hook.test.ts`);
- modify `src/components/leagues/league-page-view.tsx` (+ test) and `src/routes/leagues.$slug.tsx`.

**`RegionPanel`** props are `{ status: RegionStatus-shaped | undefined; today: PuzzleDay; busy: boolean; onLeave: () => void; onRejoin: () => void }`. Use a plain structural type with string ids, as the other views do.

| State | Renders |
| --- | --- |
| `undefined` | a one-line skeleton |
| `placed` | "You're in **US Central**, based on your time zone." · "A time-zone change moves you from next month." · if `countsFrom > today`: "Your boards count from October 10." · if `next`: "Moving to US Eastern on November 1." · an outline button **Leave region** |
| `opted-out` | "You've left the region league." · a button **Rejoin**, with "Your boards count from tomorrow." |
| `no-time-zone` | "Set your time zone to join your region: Settings → Alerts → Time Zone." |
| `unmapped` | "Your time zone (UTC) isn't part of a region yet." |

Wrap the panel in `<section aria-labelledby>` with an `h2` "Your region". Use `data-testid="region-status"` on the first line.

**`LeaguePageView`:**
1. Add `kind` to both view types.
2. Delete the local `PickerMode`/`pickerModeOf` and use `pickerModeFor`. The words branch still needs `leagueId` and `popular` from the large view; build them inside the `'words'` case.
3. When `view.kind === 'region'`, render `RegionPanel` (from a new prop `region: { status; onLeave; onRejoin } | undefined`) **instead of** the membership line, the join section and the switch section. Standings, the nudge and the contribution row render as for any league, using the region row from `myLeagues` as the membership.
4. Pass `find` to `LeagueStandings` **only when the view's `groupSource === 'answer-words'`** (vzvp note).

**Route:**
- subscribe to `api.leagues.myRegion` only when `standings?.enabled && standings.view?.kind === 'region'`;
- wire `leaveRegion` and `rejoinRegion` through `run(...)`;
- leave toast: `"You left your region. Rejoin any time — your boards count from the day after."`;
- rejoin toast: `"You're back in your region from tomorrow."`;
- add both to `busy`.

**Tests:**
- every panel state, including both optional lines;
- Leave and Rejoin call their callbacks and are disabled when busy;
- the page renders the panel and no picker or membership line for a region view;
- a word league still renders the join section;
- "Find a group" is present for a word league and absent for a large fixed league and for a region.

**Mutation check:** render the join section for regions too: the "no picker" test must fail.

- [ ] Steps: red → commit red → green → gates → mutation check → commit.

---

### Task B8: Directory region branch

**Files:** `src/components/leagues/league-directory.tsx` (+ test), `src/routes/leagues.index.tsx`.

- **`LeagueDirectory`** gains `region: RegionStatus-shaped | null`.
  - **"Your leagues":** unchanged. A placed region arrives in `mine` (B5) and renders as a `MyLeagueRow`.
  - **"Join a league":** the region league's card, when not placed, shows one status line under its title:
    - `opted-out`: "You left — rejoin from its page.";
    - `no-time-zone`: "Set your time zone to join your region.";
    - `unmapped`: "Your time zone isn't part of a region yet.".
  - The card still links to the region page.
- **Route:** subscribe to `myRegion` beside `myLeagues` (same `today` and `'skip'` rule). Keep "Loading…" until both have answered.

**Tests:**
- a placed region appears under "Your leagues" only;
- each unplaced state shows its line under "Join a league";
- `region: null` (not seeded) shows no region card text;
- the Starting Words card is unchanged.

- [ ] Steps: red → commit red → green → gates → commit.

---

### Task B9: e2e region path and the full suite

**Files:** `convex/e2eSeed.ts`, `e2e/leagues.spec.ts`.

1. **`ensureLeagueFor`** also seeds `REGION_LEAGUE`. It's idempotent, as before.
2. **The existing test:** the onboarding step now lands on `/leagues/starting-words` directly (B6). Its URL assertion stays as is and must pass unchanged.
3. **New test** with `test.use({ timezoneId: 'America/Chicago' })` in its own `describe`:
   1. A fresh e2e address, `ensureLeagueFor`, `signIn`, `completeProfile`. `use-local-capture` (mounted in Header) saves the zone.
   2. Go to `/leagues`. It's the directory now. The "Your leagues" section holds a link containing "US Central".
   3. Click it, landing on `/leagues/regions`. `region-status` contains "You're in US Central".
   4. Click **Leave region**. `region-status` reads the opted-out line, and **Rejoin** is visible.
   5. Click **Rejoin**. "You're in US Central" is back, and "Your boards count from" is visible.
4. **Run locally** against the local backend, with the guard, the dashboard check and the Node 22 workaround as in v2a A10:
   - first only `e2e/leagues.spec.ts`;
   - then **the full suite in the background** (about 11 minutes), because seeding a second league changes `/leagues` for every spec and onboarding now navigates elsewhere.
   - Report both summary lines. Stop the dev server and backend by PID.

- [ ] Steps: update → run the leagues spec → run the full suite → gates → commit.

---

### Task B10: Dev rollout (owner-run, no code)

1. CI is green on the final v2b commit. The controller watches it by SHA.
2. The owner seeds the region league on dev, early in a month if possible (see `seedLeague`'s note). The launch day is the seed's UTC day + 1 (Convex runs in UTC), so seed early in the UTC day or US players lose their local seed+1 day:
   ```
   ! CONVEX_URL=https://successful-canary-135.convex.cloud CONVEX_MIGRATION_KEY="$(sed -n 's/^CONVEX_DEPLOY_KEY=//p' .env.dev.local | tr -d '"')" node scripts/seed-league.mjs --confirm-host=successful-canary-135.convex.cloud --slug=regions
   ```
3. Owner hand checks:
   - `/leagues` is a directory with both leagues;
   - your region shows under "Your leagues";
   - the region page says "You're in …" and boards count from tomorrow;
   - entering a board tomorrow puts your region in the standings;
   - Leave, then Rejoin;
   - the home card shows the region row, and the opener offer still appears for an account not in Starting Words;
   - the teamless onboarding step opens Starting Words.

---

## Self-review notes

- **Spec coverage (v2 §7, v2b row):**
  - `regions.ts` → B1
  - `leagues.kind` → B2
  - automatic placement in the write path → B3
  - month-sticky region → B3 (B5 shows it)
  - opt-out and rejoin → B4
  - region page → B7
  - region on the home card → B6
  - region in the directory → B8 (§5)
  - `regionOf` tests per §8 → B1
  - placement, stickiness and opt-out handler tests per §8 → B3/B4
  - region page UI states per §8 → B7
  - one e2e path → B9
- **vzvp:**
  - `pickerModeFor` → B2, used in B6/B7
  - `myLeagues` lists a placed region → B5
  - directory region branch → B8
  - `MyLeagueRow` region row → B5/B6 (the row shape is shared, with `kind` added)
  - "Find a group" word-only → B7
- **Deliberate deviations from the spec:**
  - "Australia & NZ" becomes "Australia & Pacific" (decision 8);
  - a time-zone change before any board this month moves the player at once (decision 4);
  - "Set your time zone" is text, not a link (decision 6);
  - region `memberCount` isn't maintained (owner decision).
- **Not changed:** month close (the region league closes as a fixed league, zero-filled over its 12 groups); `pruneLeagueRowsFor` (it already handles member-month rows with no membership); onboarding's `inLeague` (it counts membership rows and `leagueJoinedAt` only, so a region doesn't hide the onboarding step).
