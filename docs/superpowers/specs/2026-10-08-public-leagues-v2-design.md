# Public leagues v2: open words, regions, sports

**Issue:** wordle-teams-zic8.3 (v2 sub-epics to be filed under it)
**Date:** 2026-10-08
**Status:** approved design, awaiting implementation plans
**Builds on:** `docs/superpowers/specs/2026-10-07-public-leagues-design.md` (v1). Everything v1 settled stands unless this document changes it explicitly.

---

## 1. Why v2

v1 is complete and verified on the dev deployment: one curated league with five fixed groups. The owner's verdict after the hand test (2026-10-08): **five fixed words is too small, and with no other leagues the feature will fall flat.** The owner also set a hard constraint: **more flexibility without creating moderation or support work.**

The constraint rules out every source of user-written names. What remains is flexibility bounded by the dictionary or by data the app already holds. v2 turns leagues into three kinds of league on the same engine.

## 2. Decisions (owner, 2026-10-08)

| Question | Decision |
| --- | --- |
| Starting Words groups | **Any word in NYT's answer pool** (3,158 words, owner decision 2026-10-08 after A1; it includes ADIEU, ORATE and AUDIO), created when first picked. This replaces the five fixed groups. |
| How players join word groups | **Pick a word.** The join, switch and leave model is unchanged. Automatic grouping by real opener was considered and not chosen. |
| Word list | **NYT's 3,158-word answer pool** (alex1770/wordle `wordlist_nyt20230701_hidden`, MIT). Common and family-friendly, so no blocklist. All five v1 words are on it; the grandfathering rule (§4.2) stays as a safety net but applies to none today. Solver-only openers (ROATE, SOARE, SALET, TARES) aren't on it. |
| More leagues | **Regions** (automatic) and **sports-fan leagues**. |
| Sports naming | **Team nicknames with safeguards:** plain text, no logos, colours or emoji; a "Not affiliated with any league or team" line; never Pro-gated; never used in marketing. A short IP-lawyer check is recommended before production; nothing in the design depends on it. |
| Sports at launch | **NFL, NBA, MLB, NHL, MLS.** One league per sport; one team per sport per player. |
| Region membership | **Automatic** from the player's saved time zone, with an opt-out. |
| Insights upsell | **Contextual, one line per surface,** never shown to Pro or trial players. Each surface has its own upgrade origin so conversion can be measured. No banners, no modals. |
| Order | **v2a open words → v2b regions → v2c sports.** Each is a separate sub-epic with its own plan, reviews and owner dev check. |

**Unchanged from v1 and not reopened:** strangers see group totals only (v1 §3.2); the metric (pooled average guesses, 1dp, failure = 7); `MIN_LEAGUE_BOARDS = 10`; monthly season with day-2 snapshots; one group per league per month; Pro or an active Insights trial unlocks the contribution row; the `LEAGUES_ENABLED` flag; the dismissible "Join the opener wars" card.

## 3. League kinds

| League | Groups come from | Joining | Upkeep |
| --- | --- | --- | --- |
| Starting Words | Wordle answer words, created on first pick | Pick (search + popular quick picks) | None: static list in the repo |
| Sports (NFL, NBA, MLB, NHL, MLS) | Static team list per sport, seeded once | Pick your team | A one-line data change on a rename or relocation |
| Regions | Player's `timeZone` → region (static table) | Automatic; opt-out | None |

## 4. Data model (additive; no renames, no backfill)

### 4.1 `leagues`

- `kind: v.optional(v.union(v.literal('picked'), v.literal('region')))`. Absent means `'picked'`.
- `groupSource: v.optional(v.union(v.literal('fixed'), v.literal('answer-words')))`. Absent means `'fixed'`.
- `disclaimer: v.optional(v.string())`. Sports leagues set "Not affiliated with any league or team."

### 4.2 `leagueGroups`

- New index **`by_league_and_slug`** `['leagueId', 'slug']`. Joining by word is one point read.
- **Answer-word groups are created lazily.** The first `joinWord` (or `switchWord`) to a valid word that has no group inserts it: slug is the word and name is the word in UPPERCASE; `order` is the creation time (`Date.now()`), so seeded groups sort first and new words follow in creation order; `memberCount` 0.
- **Concurrency:** two first-joins of the same word race. Convex serialisability means the loser's read of `by_league_and_slug` conflicts and retries, sees the group, and joins it. Never two groups. Pinned by a test.
- **The existing five groups stay** as ordinary groups. If any of their words (ORATE is the likely one; verify against the chosen list) is not an answer word, that group is **grandfathered**: it remains joinable so nobody is stranded, but it can never be created anew. The validity check is `isAnswerWord(word) || an existing group with that slug`.
- Join and switch address a group by **word** through separate mutations, `joinWord`/`switchWord({ leagueId, word, today })`, which resolve the group and then delegate to the id-based `joinGroup`/`switchGroup` handlers (unchanged, still used for fixed leagues). A plan pre-check runs before the word is resolved, so a member who types a bad word hears `ALREADY_IN_LEAGUE`/`NOT_IN_LEAGUE` rather than `UNKNOWN_WORD`. (A refused mutation rolls back entirely in Convex, so the pre-check is about error order, not about orphan groups.) A word that isn't an answer word and has no existing group is refused with a new code **`UNKNOWN_WORD`**.

### 4.3 Static data in `convex/lib/` (client-safe, no imports)

- `answerWords.ts`: the answer list as a `ReadonlySet<string>` plus `isAnswerWord(word)` (case-insensitive, trimmed). The file header records the list's **source and licence**. The v2a plan picks an openly licensed copy of the published answer list and verifies the licence before committing.
- `sportsTeams.ts`: `{ nfl, nba, mlb, nhl, mls }`, each an array of `{ slug, nickname }` (e.g. `{ slug: 'vikings', nickname: 'Vikings' }`). Seeded through `scripts/seed-league.mjs --slug=nfl` and so on, each with its own spec in `LEAGUE_SPECS`.
- `regions.ts`: `regionOf(timeZone) → { slug, name } | null`. An explicit IANA table for US/Canada zones (Eastern, Central, Mountain, Pacific, Alaska, Hawaii), UK & Ireland, and other common zones. A continent-prefix fallback (`Europe/*` → Europe, `Australia/*` → Australia & NZ, and so on). Unknown means null.

### 4.4 Regions are automatic

- The region league has `kind: 'region'` and seeded groups (the region set).
- **No `leagueMemberships` rows.** In `recomputeLeagueMonthFor`, a region league's member-month group is:
  - the existing member-month row's group for that month, if one exists (**month-sticky**: a time-zone change counts from next month); otherwise
  - `regionOf(player.timeZone)`, if the player has a time zone and has not opted out; otherwise no row.
- Boards count for the region from the **first board written after launch**. Like joining, this is never retroactive: placement starts at the first recompute after the flag is on. Past months are not backfilled.
- **Opt-out:** `players.regionLeagueOptOut?: number`. Leaving sets it and removes this month's member row through the normal delta path. Rejoining clears it and counts from tomorrow. A player with no time zone sees "Set your time zone to join your region" with a link to settings.
- `memberCount` for region groups is maintained when a player's first member-month row in a region is created or moved, so the picker and standings show it. The exact maintenance point is left to the v2b plan.

### 4.5 Standings for large leagues

`standingsFor` still reads one month's `leagueGroupMonth` rows for the league, in one range read. For `answer-words` and other large leagues (more groups than `PICKER_INLINE_MAX`) it returns:

- the **top 10 ranked** groups;
- the **viewer's** group, always (even if unranked or outside the top 10);
- **`unrankedCount`**, the number of active groups below the board floor.

Groups with no rows this month are not listed (no zero-fill for open leagues). The viewer's group is always present, as a zero row when it has no row this month. A large **fixed** league (more than `PICKER_INLINE_MAX` groups, e.g. a sports league) also returns `pickable`, its full seeded group list, because its picker must offer every team; word leagues never collect their groups. The page chooses the picker by `groupSource` (word box only for `answer-words`), not by size. A new query `groupStanding({ slug, today, word })` powers search: one point read.

**Cost:** the range read grows with the number of groups *active this month*, not with the dictionary size. At 3,158 words the ceiling is bounded and small, and realistically tens of groups.

### 4.6 Upgrade nudges

- New upgrade origins with `UPGRADE_HEADLINES`: **`leagues-behind`**, **`league-result`**, **`challenge-result`**, alongside the existing `leagues`.
- One pure helper, `nudgeFor({ isPro, trialActive, surface, facts }) → { origin, text } | null`, in a client-safe lib. It returns null for Pro or trial players and when the moment doesn't apply:
  - **`leagues-behind`:** the viewer's group is ranked and not first. "SLATE is 0.3 guesses off the lead — see where you lose guesses."
  - **`league-result`:** last month's snapshot ranked the viewer's group below 1st (no upsell after a win). "CRANE finished 3rd in September — see where your own guesses go." Insights shows personal history, not opener-vs-opener comparisons (its global layer is dark at today's population), so nudges promise only what Insights delivers.
  - **`challenge-result`:** a closed challenge the viewer's team lost. "You lost to Team X by 0.2 — see where the guesses went." (Team names in challenges are already visible to both teams; nothing here names a player.)
- Rendering: one muted line with a small link that calls `openUpgrade(origin)`. **At most one nudge per surface.** The league-page nudge may appear on any league (small fixed leagues have no `viewerRank`, so only the behind nudge can apply there).

## 5. UI

- **`/leagues` is a directory** once there are 2 or more leagues; the v1 single-league redirect remains for exactly 1. Sections:
  - **Your leagues:** group, rank and average per league.
  - **Join a league:** Starting Words, each sport, and your region. The region card shows the player's region automatically, or "Set your time zone".
- **Open-word picker** (Starting Words):
  - A search box that accepts answer words, with a live "Not a Wordle answer word" hint.
  - The **six most popular** groups as quick picks.
  - Quick picks reuse GroupPicker, so accessible names remain exactly the group names; the word list is lazy-loaded on first use, in its own chunk.
- **Sports picker:** the existing searchable sheet, by nickname. The disclaimer appears on the league page and the league card.
- **Region page:**
  - "You're in **US Central**, based on your time zone."
  - "A time-zone change moves you from next month."
  - A Leave (opt-out) button. No picker.
- **Large-league standings:** ranked top 10, then the viewer's row if it isn't already shown, then "N more groups not ranked yet", then a search box for any group.
- **Home card:**
  - Member rows per league, capped at 3. The region counts toward the cap once placed.
  - The "Join the opener wars" offer and "Not now" are unchanged and remain Starting Words only.
- **Nudges** as described in §4.6.

## 6. Privacy, flag and clock

All v1 rules carry over:

- **Privacy:** group totals only; a region is a group like any other, with no names.
- **Flag:** queries return `{ enabled: false }` and mutations refuse while dark. Region placement in the write path runs regardless of the flag, like the rest of the write path, so data is right on the day it flips.
- **Clock:** queries use `readToday`; mutations use `requirePlausibleToday` at click time; the UI never reads the clock during SSR.

## 7. Sub-epics

| Sub-epic | Contents |
| --- | --- |
| **v2a: open-word Starting Words** | `answerWords.ts`, `leagues.groupSource`, lazy groups and `by_league_and_slug`, `UNKNOWN_WORD`, word-addressed join/switch, large-league standings slice and `groupStanding`, search picker with popular quick picks, `/leagues` directory, `leagues-behind` + `league-result` nudges, e2e: pick a word by search and see it in standings |
| **v2b: regions** | `regions.ts`, `leagues.kind`, automatic placement in the write path, month-sticky region, opt-out and rejoin, region page, region on the home card |
| **v2c: sports** | `sportsTeams.ts` (NFL, NBA, MLB, NHL, MLS), seeding via the script, disclaimer, sports cards and pages, `challenge-result` nudge |

Each sub-epic follows the full flow: plan → owner approval → subagent build with spec and quality reviews → final review → CI → owner dev check. The PR to `main` waits for the owner's call after v2 (or earlier if the owner chooses).

## 8. Testing

- **Pure:**
  - `isAnswerWord`
  - `regionOf`: every US zone, the continent fallbacks, unknown
  - the large-league standings slice
  - each `nudgeFor` branch
- **Convex handlers:**
  - lazy group creation, including the concurrent first-join (one group results)
  - `UNKNOWN_WORD`; grandfathering of an existing non-answer group
  - automatic region placement on a board write; month-stickiness on a time-zone change; opt-out and rejoin
  - sports seeding idempotency
  - `groupStanding`
- **UI:** search picker (valid and invalid words, quick picks), directory sections, region page states, nudges hidden for Pro and trial.
- **e2e:** one new path per sub-epic.

## 9. Out of scope

- User-created leagues or free-text group names (moderation).
- Automatic opener groups (considered; not chosen).
- A second-guess league; WNBA, Premier League and other sports. Each is a later data-only addition through the same mechanism.
- Logos, team colours, or any sports branding.
- Backfilling past months into regions.
