# Clue Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the clue ladder playable: a daily puzzle made from a secret seed, the five server functions a play goes through, the play page, the dashboard card, a share line, and one end-to-end test.

**Architecture:** `convex/lib/clueLadder/seed.ts` turns a date into a puzzle with HMAC-SHA256 under `CLUE_LADDER_SEED`. `convex/clueLadder.ts` stores each date's puzzle once (`clueLadderPuzzles`) and holds `today`, `start`, `nextClue`, `saveScratch` and `lockIn`, all writing plays through one function, `writePlayFor`. The client side is the play route `/play/clue-ladder`, a container that owns the queries, mutations and batched scratch saves, and a pure view over plan 2's screens. The dashboard mounts plan 2's `ClueLadderCard` for opted-in teams.

**Tech Stack:** Convex (queries, mutations, schema, Web Crypto), convex-test, Vitest (edge-runtime and jsdom), React 19, TanStack Router and Query, `@convex-dev/react-query`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-clue-ladder-design.md`, sections 3, 4, 6 and 8. Build order step 3. Plans 1 (`docs/superpowers/plans/2026-10-14-game-abstraction.md`) and 2 (`docs/superpowers/plans/2026-10-14-play-surface.md`) are done before this starts.

---

## Scope, and departures from the spec

**In:** the puzzle table and seed; `today`, `start`, `nextClue`, `saveScratch`, `lockIn`; the two new error codes; clue text in words; the team's clue ladder start date and the scoreboard counting from it; the finished screen's cap on listed orders; the play route; mounting the dashboard card; the share action and `#N`; one Playwright happy path with its CI switches; every carry-forward from plan 1's review.

**Owner decisions, 2026-10-15** (each was an open question on the first draft):

1. **A day before a team turned the clue ladder on, with no result, counts for nothing** (`wordle-teams-k1v5`). It is not a missed day, and the grid shows it blank. **A result always counts**, whatever its date, because the toggle's help text promises "Scores are kept" and the spec shows a player's result on every opted-in team they are on. So switching the game off and on again never hides a play (adjusted 2026-10-15).
   - The owner's switch stores the day: `teams.clueLadderOnSince`, from the owner's `today`, checked by `requirePlausibleToday`.
   - Turning the game on sets it. Turning it off leaves it. Turning it on again after that resets it to the new day.
   - A team with no stored date has no limit. Only dev rows are like that.
   - `getTeamGameMonth` returns the date as `countsFrom`, and `monthTotal`, `ScoresGrid` and `GameScoresTable` honour it. The Wordle callers are unchanged.
   - Tasks 7 and 8 build it.
2. **The share number stays a constant.** `CLUE_LADDER_DAY_ONE` is today's date for now. Launch day includes a one-line commit that sets it to the production launch day, before `CLUE_LADDER_ENABLED` goes on. The comment on the constant (Task 10) and the rollout note (Task 16) say so.
3. **Clues name shapes in words**, for example "The star is somewhere left of the circle." A relation that holds at any distance says "somewhere"; "next to" means adjacent. This changes text only: the clue objects, the generator and the simulation do not change. It is Task 2, placed before the seed so that the golden snapshot is written once, with the new text.
4. **The finished screen lists at most 6 orders**, then "and N more" ("and 1 more" in the singular). The cap covers both lists: the other orders, and the orders that fitted. It is Task 11.

**Out:** drag to place (`wordle-teams-9j7o.3.2.2`), stored winners and team totals for the clue ladder (spec section 7), replays, practice, past puzzles, hints.

**Departures, each to be confirmed by the owner:**

1. **No usable seed means the game is off.** `CLUE_LADDER_SEED` unset or shorter than 16 characters makes `today` answer `{ enabled: false }` and `start` throw `CLUE_LADDER_DISABLED`, as if `CLUE_LADDER_ENABLED` were off. The spec names only the switch. Without this, a deployment with the switch on and no seed would show a Play button that always fails.
2. **`today` falls back to the server's day** when the client's `today` is implausible, as `leagues.ts`'s `readToday` does. It is a live query, and a tab left open past midnight would otherwise start throwing. The four writers still refuse with `INVALID_DATE`.
3. **A `saveScratch` that lands after `lockIn` is ignored, not refused.** The client batches saves on a timer, so one can arrive just after the game ends. Refusing it would show an error for nothing.
4. **Calling `nextClue`, `saveScratch` or `lockIn` before `start` is a plain `Error`, not a new code.** Our client never does it, since the play page starts the game before showing those buttons.
5. **Opening the play page starts the game.** The card's **Play** button is the start. There is no second Start button on the page.
6. **An e2e-only seed returns today's answer** (`e2eSeed.seedClueLadderFor`), because lock-in is one try and the test must win. It has the same guard as every other e2e seed: `E2E_TEST_MODE` and an `e2e+*` address.
7. **`nextClue` takes the clue count the client is showing** (`expectedRevealed`). If the play has already moved past it, nothing changes and the current count comes back, so a double tap reveals one clue, not two. The spec's `nextClue` takes only `today`.
8. **The e2e prune also deletes clue ladder plays** for e2e players, so a test account leaves nothing behind. This is a small addition beyond the spec.

**Carried forward from plan 1's review, and where each lands:**

| Item | Task |
|---|---|
| Writers refuse a date `isPassedDate` treats as passed, by reusing it | 5 (`writePlayFor`) |
| Writers keep `cluesRevealed` and `lockedAtClue` within 1..6 | 5 (`writePlayFor`) |
| HMAC seed with an explicit byte order | 3 |
| A golden test per date | 3 |
| `ladderProblem` is null before a puzzle is stored | 4 |
| `ALREADY_FINISHED` and `INVALID_ORDER` mirrored in `src/lib/convex-error.ts` | 1 |
| Test: a non-owner cannot switch the clue ladder OFF | 9 |
| Test: clue ladder `firstDay` with a malformed date row | 9 |

**Left as it is:** a play still unfinished from yesterday scores the missed-day value in the client's total until the date passes on the server, and then scores X. The spec chose this: until the date passes, the cell shows as not yet played (section 4). To change it, the client would need the server's passed-date rule, and the scoreboard would disagree with the server for an hour around midnight.

## Ground rules for every task

- Server imports inside `convex/lib/` use explicit `.ts` extensions. Type-only imports use `import type` or inline `type` (`verbatimModuleSyntax` is on).
- **Client code imports only these from `convex/`:** `_generated/api`, `_generated/dataModel` (types), `lib/clueLadder/*.ts` and `lib/puzzleDay.ts`. Never import `lib/games.ts`, `access.ts` or `clueLadder.ts` as values from `src/`. They reach `auth.ts`, and `src/frontend-import-graph.test.ts` fails the build if that ships to the browser. Use `import type` or `FunctionReturnType` for server types.
- Component tests are `*.hook.test.ts`, with `// @vitest-environment jsdom` on line 1, rendered with `createElement` and `afterEach(cleanup)`. A test that opens a Radix Popover needs the ResizeObserver stub shown in Task 12.
- Tests that set `CLUE_LADDER_ENABLED` or `CLUE_LADDER_SEED` use `vi.stubEnv` with `afterEach(() => vi.unstubAllEnvs())`.
- `$SCRATCH` means the session scratchpad. Run one file with `TZ=UTC pnpm exec vitest run <path> > "$SCRATCH/x.log" 2>&1; echo "exit $?"`. **Never pipe a gate into `tail` or `grep`.**
- **`convex/_generated/api.d.ts` is maintained by hand.** Each task that adds a Convex module adds its two lines in sorted order, as commits `fa5bdeab` and `4c17bdb1` did.
- **`src/routeTree.gen.ts` is written only by the vite plugin** on `pnpm dev` or `pnpm build`. Never run `tsr generate`.
- **Never run a `convex` CLI command** in an implementer subagent; `.env.local` holds a production key. The e2e run in Task 15 is done by the controller.
- Commit with a quoted heredoc (`git commit -F - <<'EOF'`). End the message with both lines below. Never `--no-verify`.
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
  ```
- Before each commit, run all four gates separately: `TZ=UTC pnpm test:once`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- After each task: `bd close <id>`, `bd export -o .beads/issues.jsonl`, include `.beads/issues.jsonl` in the commit, then check that `git show HEAD:.beads/issues.jsonl` records the issue as closed. If it doesn't, re-export, then `git add .beads/issues.jsonl && git commit --amend --no-edit`, but only on an unpushed commit.

## Beads issues

Epic: `wordle-teams-9j7o.2.3.2` (child of `wordle-teams-9j7o.2.3`). Each task blocks the next. Claim each with `bd update <id> --claim`.

| Task | Issue |
|---|---|
| 1 Error codes | `wordle-teams-9j7o.2.3.2.1` |
| 2 Clue text in words | `wordle-teams-9j7o.2.3.2.2` |
| 3 Daily seed | `wordle-teams-9j7o.2.3.2.3` |
| 4 Puzzle table | `wordle-teams-9j7o.2.3.2.4` |
| 5 Who plays, the write path, start and today | `wordle-teams-9j7o.2.3.2.5` |
| 6 Next clue, scratch and lock-in | `wordle-teams-9j7o.2.3.2.6` |
| 7 The day a team turned it on | `wordle-teams-9j7o.2.3.2.7` |
| 8 The scoreboard counts from that day | `wordle-teams-9j7o.2.3.2.8` |
| 9 Plan 1 test gaps | `wordle-teams-9j7o.2.3.2.9` |
| 10 Client helpers | `wordle-teams-9j7o.2.3.2.10` |
| 11 Finished screen lists six orders at most | `wordle-teams-9j7o.2.3.2.11` |
| 12 Play view | `wordle-teams-9j7o.2.3.2.12` |
| 13 Play route | `wordle-teams-9j7o.2.3.2.13` |
| 14 Dashboard card | `wordle-teams-9j7o.2.3.2.14` |
| 15 End to end | `wordle-teams-9j7o.2.3.2.15` |
| 16 Gates and record | `wordle-teams-9j7o.2.3.2.16` |

Task 7 is the k1v5 server and setting-card change. Link its issue to `wordle-teams-k1v5`, or close k1v5 together with Task 8.

## File structure

| File | Responsibility |
|---|---|
| `convex/access.ts` | Two new codes: `ALREADY_FINISHED`, `INVALID_ORDER` |
| `src/lib/convex-error.ts` | Their parse entries and player-facing copy |
| `convex/lib/clueLadder/clues.ts` | `clueText` names shapes in words, as full sentences |
| `convex/lib/clueLadder/seed.ts` | `hmacSeed`, `puzzleForDate`, `GENERATOR_VERSION`, `seedSecretUsable` |
| `convex/lib/ladderValidators.ts` | `shapeValidator`, `slotValidator`, `clueValidator` |
| `convex/schema.ts` | The `clueLadderPuzzles` table; `teams.clueLadderOnSince` |
| `convex/games.ts` | `setTeamClueLadder` takes the owner's `today` and stores `clueLadderOnSince` |
| `convex/lib/scoring.ts` | `monthTotal` takes an optional `fromDay`: missed days before it score nothing |
| `convex/scores.ts` | `getTeamGameMonth` returns `countsFrom` |
| `src/components/scores-table.tsx` | `ScoresGrid` takes an optional `countsFrom`: an empty day before it is blank and scores nothing; a result always shows and counts |
| `src/components/game-scores-table.tsx` | Passes `countsFrom` to the grid |
| `src/components/teams/clue-ladder-setting-card.tsx` | Sends the owner's `today`; help text says earlier days don't count as missed |
| `src/components/clue-ladder/finished.tsx` | Lists six orders at most, then "and N more" |
| `convex/clueLadder.ts` | `ensurePuzzleFor`, `writePlayFor`, the `*For` functions, and the public `today`, `start`, `nextClue`, `saveScratch`, `lockIn` |
| `convex/e2eSeed.ts` | `seedClueLadderFor` |
| `convex/e2ePrune.ts` | Deletes e2e players' clue ladder plays |
| `src/lib/clue-ladder-share.ts` | `CLUE_LADDER_DAY_ONE`, `clueLadderNumber`, `clueLadderShareText` |
| `src/lib/share-link.ts` | `shareText` beside `shareLink` |
| `src/components/clue-ladder/today.ts` | `ClueLadderTodayView`, `cardPlayOf` |
| `src/components/clue-ladder/use-scratch-saver.ts` | Batches `saveScratch` to one call per 3 seconds |
| `src/components/clue-ladder/play-view.tsx` | `ClueLadderPlayView`: pure, one branch per state |
| `src/components/clue-ladder/play-page.tsx` | `ClueLadderPlayPage`: queries, mutations, toasts |
| `src/routes/play.clue-ladder.tsx` | The route: guard, back link, page |
| `src/components/clue-ladder/dashboard-card.tsx` | `DashboardClueLadderCard`: reads `today`, opens the play route |
| `src/routes/app.tsx` | Mounts the card below `TodayPanel` |
| `e2e/clue-ladder.spec.ts` | The happy path |
| `.github/workflows/deploy-v2.yml`, `CLAUDE.md` | The two env vars for the e2e backend |

---

### Task 1: Error codes

**Files:**
- Modify: `convex/access.ts` (the `AccessCode` union, after `'CLUE_LADDER_NOT_ON_TEAM'`)
- Modify: `src/lib/convex-error.ts` (the parse chain in `convexErrorCode`, the switch in `typedCodeMessage`)
- Test: `src/lib/convex-error.test.ts`

- [ ] **Step 1: Write the failing test.** In `src/lib/convex-error.test.ts`, add two rows to the `test.each([...])('%s has its own copy', ...)` table, after the `CLUE_LADDER_NOT_ON_TEAM` row:

```ts
  ['ALREADY_FINISHED', "You've already finished today's clue ladder."],
  ['INVALID_ORDER', 'Put each of the five shapes in its own slot, then lock in.'],
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/lib/convex-error.test.ts > "$SCRATCH/c1.log" 2>&1; echo "exit $?"`. Expected: exit 1. Both rows get the fallback copy.

- [ ] **Step 3: Add the codes.** In `convex/access.ts`, after `| 'CLUE_LADDER_NOT_ON_TEAM'`:

```ts
  // convex/clueLadder.ts (wordle-teams-9j7o.2.3). ALREADY_FINISHED is nextClue
  // or lockIn on a play already solved or failed: one lock-in a day.
  // INVALID_ORDER is lockIn's order not being the five shapes once each, or a
  // saveScratch arrangement that is not five slots with each shape at most once.
  | 'ALREADY_FINISHED'
  | 'INVALID_ORDER'
```

In `src/lib/convex-error.ts`, extend the parse chain's last line:

```ts
    code === 'CLUE_LADDER_DISABLED' ||
    code === 'CLUE_LADDER_NOT_ON_TEAM' ||
    code === 'ALREADY_FINISHED' ||
    code === 'INVALID_ORDER'
```

and add before `default:` in `typedCodeMessage`:

```ts
    case 'ALREADY_FINISHED':
      // A second lock-in, or a clue asked for after the game ended, usually from
      // a second tab. Says what is true; there is nothing to retry.
      return "You've already finished today's clue ladder."
    case 'INVALID_ORDER':
      // Lock in is disabled until all five slots are filled, so this is a client
      // out of step with the board. Says what a valid order is.
      return 'Put each of the five shapes in its own slot, then lock in.'
```

- [ ] **Step 4: Run it to verify it passes.** Same command. Expected: exit 0.

- [ ] **Step 5: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.1
bd export -o .beads/issues.jsonl
git add convex/access.ts src/lib/convex-error.ts src/lib/convex-error.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): ALREADY_FINISHED and INVALID_ORDER, with their copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 2: Clue text in words

**Files:**
- Modify: `convex/lib/clueLadder/clues.ts` (`clueText` and its import line)
- Test: `convex/lib/clueLadder/clues.test.ts` (`describe('clueText')`)

Owner decision 3. The clues used filled symbols (▲ ●), but the board draws outlined shapes, and a screen reader reads a symbol out by its Unicode name. This task changes text only. `Clue`, `holds`, `candidateClues`, the generator and the simulation's scoring all work on clue objects and never read the text. The simulation runner (`scripts/clue-ladder-sim.mjs`) prints `clueText` in its sample puzzles, so only its printed samples change. It is placed before Task 3, so the golden snapshot is written once, with this text.

- [ ] **Step 1: Write the failing test.** In `convex/lib/clueLadder/clues.test.ts`, replace the `test.each` table in `describe('clueText', ...)` with:

```ts
  test.each<[Clue, string]>([
    [{ kind: 'atEnd', shape: 'triangle', negated: false }, 'The triangle is at one end.'],
    [{ kind: 'atEnd', shape: 'circle', negated: true }, 'The circle is not at either end.'],
    [{ kind: 'inSlot', shape: 'circle', slot: 2, negated: false }, 'The circle is in the third slot.'],
    [{ kind: 'inSlot', shape: 'circle', slot: 0, negated: true }, 'The circle is not in the first slot.'],
    [{ kind: 'inSlot', shape: 'diamond', slot: 4, negated: false }, 'The diamond is in the fifth slot.'],
    [{ kind: 'leftOf', a: 'star', b: 'circle' }, 'The star is somewhere left of the circle.'],
    [{ kind: 'rightOf', a: 'star', b: 'triangle' }, 'The star is somewhere right of the triangle.'],
    [{ kind: 'nextTo', a: 'square', b: 'circle', negated: false }, 'The square is next to the circle.'],
    [{ kind: 'nextTo', a: 'square', b: 'diamond', negated: true }, 'The square is not next to the diamond.'],
    [{ kind: 'between', shape: 'circle', a: 'triangle', b: 'star' }, 'The circle is somewhere between the triangle and the star.'],
    [{ kind: 'apart', a: 'triangle', b: 'circle', distance: 2 }, 'Exactly one shape sits between the triangle and the circle.'],
    [{ kind: 'apart', a: 'triangle', b: 'square', distance: 3 }, 'Exactly two shapes sit between the triangle and the square.'],
    [{ kind: 'apart', a: 'triangle', b: 'star', distance: 4 }, 'Exactly three shapes sit between the triangle and the star.'],
  ])('%j reads "%s"', (clue, text) => {
    expect(clueText(clue)).toBe(text)
  })

  test('every clue the vocabulary can produce is one sentence in words', () => {
    // No symbol, no digit, a capital first and a full stop last, for every true
    // clue about every order: the cases above cover each kind, this covers
    // every shape, slot and distance.
    for (const order of ALL_ORDERS) {
      for (const clue of candidateClues(order)) {
        const text = clueText(clue)
        expect(text, JSON.stringify(clue)).toMatch(/^[A-Z][a-z ]+\.$/)
      }
    }
  })
```

and add `ALL_ORDERS` to the file's `./orders.ts` import, or add `import { ALL_ORDERS } from './orders.ts'` if there is none.

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/clues.test.ts > "$SCRATCH/s2.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: Implement.** In `convex/lib/clueLadder/clues.ts`, change the import line to:

```ts
import { SHAPES, SLOT_COUNT, type Order, type Shape } from './orders.ts'
```

and replace everything from `const SLOT_NAMES` to the end of the file with:

```ts
const SLOT_NAMES = ['first', 'second', 'third', 'fourth', 'fifth'] as const

/** Shapes between two others: apart's distance runs 2–4, so 1–3. */
const COUNT_WORDS = ['no', 'one', 'two', 'three'] as const

/** "the star". The shape's own name, so a screen reader reads the clue exactly as written. */
const the = (shape: Shape) => `the ${shape}`

const sentence = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}.`

/**
 * Player-facing text for a clue: one sentence that names the shapes in words
 * (owner decision, 2026-10-15). Not symbols: the board draws outlines, not the
 * filled ▲ ● glyphs, and a screen reader reads a glyph out by its Unicode name.
 *
 * "SOMEWHERE" MARKS A RELATION THAT HOLDS AT ANY DISTANCE (left of, right of,
 * between), so it is not read as "directly". "Next to" is the adjacent one.
 *
 * TEXT ONLY. Nothing scores or generates from it; the clue objects are what is
 * stored and tested, so rewording a sentence never changes a puzzle.
 */
export function clueText(clue: Clue): string {
  switch (clue.kind) {
    case 'atEnd':
      return sentence(`${the(clue.shape)} is ${clue.negated ? 'not at either end' : 'at one end'}`)
    case 'inSlot':
      return sentence(`${the(clue.shape)} is ${clue.negated ? 'not ' : ''}in the ${SLOT_NAMES[clue.slot]} slot`)
    case 'leftOf':
      return sentence(`${the(clue.a)} is somewhere left of ${the(clue.b)}`)
    case 'rightOf':
      return sentence(`${the(clue.a)} is somewhere right of ${the(clue.b)}`)
    case 'nextTo':
      return sentence(`${the(clue.a)} is ${clue.negated ? 'not ' : ''}next to ${the(clue.b)}`)
    case 'between':
      return sentence(`${the(clue.shape)} is somewhere between ${the(clue.a)} and ${the(clue.b)}`)
    case 'apart': {
      const gap = clue.distance - 1
      const shapes = gap === 1 ? 'shape sits' : 'shapes sit'
      return sentence(`exactly ${COUNT_WORDS[gap]} ${shapes} between ${the(clue.a)} and ${the(clue.b)}`)
    }
  }
}
```

If `SHAPES` or `SLOT_COUNT` turns out to be unused in `clues.ts` after this, drop it from the import too: lint fails on an unused import.

- [ ] **Step 4: Run it to verify it passes, and confirm nothing else moved.** Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder > "$SCRATCH/s2b.log" 2>&1; echo "exit $?"`. Expected: exit 0. The generator, ladder and simulation suites pass unchanged, which confirms they never read the text.

- [ ] **Step 5: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.2
bd export -o .beads/issues.jsonl
git add convex/lib/clueLadder/clues.ts convex/lib/clueLadder/clues.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): clues name shapes in words, as full sentences

Text only: clue objects, the generator and the simulation are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 3: Daily seed

**Files:**
- Create: `convex/lib/clueLadder/seed.ts`, `convex/lib/clueLadder/seed.test.ts`
- Create (by the first test run): `convex/lib/clueLadder/__snapshots__/seed.test.ts.snap`
- Modify: `convex/_generated/api.d.ts`

The generator's RNG (mulberry32) is not cryptographic, so the secret has to be in the seed. HMAC-SHA256 of the date under `CLUE_LADDER_SEED` gives a 32-bit seed. The byte order is part of every puzzle, so the RFC 4231 test vectors pin it rather than this file's own output.

- [ ] **Step 1: Write the failing test** (`convex/lib/clueLadder/seed.test.ts`)

```ts
import { describe, expect, test } from 'vitest'
import { addDays } from '../puzzleDay.ts'
import { clueText } from './clues.ts'
import { ladderProblem } from './ladder.ts'
import {
  GENERATOR_VERSION,
  hmacSeed,
  MIN_SECRET_LENGTH,
  puzzleForDate,
  puzzleMessage,
  seedSecretUsable,
} from './seed.ts'

const SECRET = 'golden-test-secret-not-for-production'

describe('hmacSeed', () => {
  // RFC 4231's vectors, so the HMAC and the byte order are checked against an
  // outside source, not against this module's own output.
  test('RFC 4231 case 2: the first four MAC bytes, big-endian', async () => {
    // HMAC-SHA256 = 5bdcc146 bf60754e 6a042426 ...
    expect(await hmacSeed('Jefe', 'what do ya want for nothing?')).toBe(0x5bdcc146)
  })

  test('RFC 4231 case 1: a first byte above 0x7f stays unsigned', async () => {
    // HMAC-SHA256 = b0344c61 d8db3853 5ca8afce ...
    expect(await hmacSeed('\x0b'.repeat(20), 'Hi There')).toBe(0xb0344c61)
  })
})

describe('seedSecretUsable', () => {
  test.each([
    [undefined, false],
    ['', false],
    ['x'.repeat(MIN_SECRET_LENGTH - 1), false],
    ['x'.repeat(MIN_SECRET_LENGTH), true],
  ])('%j -> %s', (secret, usable) => {
    expect(seedSecretUsable(secret)).toBe(usable)
  })
})

describe('puzzleForDate', () => {
  test('the message names the generator version, so a new generator means new puzzles', () => {
    expect(puzzleMessage('2026-10-15')).toBe(`clue-ladder:${GENERATOR_VERSION}:2026-10-15`)
  })

  test('the same date always yields the same puzzle; the next day a different one', async () => {
    const a = await puzzleForDate(SECRET, '2026-10-15')
    expect(await puzzleForDate(SECRET, '2026-10-15')).toEqual(a)
    expect(await puzzleForDate(SECRET, '2026-10-16')).not.toEqual(a)
    expect(await puzzleForDate(`${SECRET}-other`, '2026-10-15')).not.toEqual(a)
  })

  test('a year of dates all obey the ladder rules', async () => {
    for (let i = 0; i < 366; i++) {
      const date = addDays('2026-10-15', i)
      const puzzle = await puzzleForDate(SECRET, date)
      expect(ladderProblem(puzzle.answer, puzzle.clues), date).toBeNull()
    }
  })

  // GOLDEN. These dates' puzzles under SECRET are pinned in the snapshot file.
  // A change to the generator, the clue vocabulary, the RNG or the seed changes
  // them. That is a GENERATOR_VERSION bump, never a snapshot update: stored
  // puzzles were made by the old code.
  test.each(['2026-10-15', '2026-12-31', '2027-03-01'])('%s is pinned', async (date) => {
    const puzzle = await puzzleForDate(SECRET, date)
    expect({
      answer: puzzle.answer,
      clues: puzzle.clues.map(clueText),
      remaining: puzzle.remaining,
      fallback: puzzle.fallback,
    }).toMatchSnapshot()
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/seed.test.ts > "$SCRATCH/s2.log" 2>&1; echo "exit $?"`. Expected: exit 1, `./seed.ts` not found.

- [ ] **Step 3: Implement** (`convex/lib/clueLadder/seed.ts`)

```ts
import { generatePuzzle, type Puzzle } from './generate.ts'

/**
 * The clue ladder's daily seed (wordle-teams-9j7o.2.3, spec section 3).
 *
 * HMAC-SHA256 of the date under CLUE_LADDER_SEED: a date always yields the same
 * puzzle, and nobody without the secret can compute tomorrow's. The generator's
 * RNG (rng.ts) is not cryptographic, so the secrecy has to live here.
 *
 * Web Crypto only. It is global in Convex's runtime, in Node and in Vitest's
 * edge-runtime, so this file stays Convex-free like the rest of lib/clueLadder.
 */

/**
 * Stored on every puzzle and part of the HMAC message. Bump it when
 * generatePuzzle's output for a seed changes, and seed.test.ts's golden
 * snapshot with it.
 */
export const GENERATOR_VERSION = 1

/** A shorter secret is treated as unset: a guessable secret is no secret. */
export const MIN_SECRET_LENGTH = 16

export function seedSecretUsable(secret: string | undefined): secret is string {
  return secret !== undefined && secret.length >= MIN_SECRET_LENGTH
}

export function puzzleMessage(date: string): string {
  return `clue-ladder:${GENERATOR_VERSION}:${date}`
}

/**
 * The first four bytes of HMAC-SHA256(secret, message), read BIG-ENDIAN as an
 * unsigned 32-bit integer. The byte order is part of every puzzle: the same
 * bytes read little-endian would give every date a different one. So it is
 * spelled out (`getUint32(0, false)`) and pinned by RFC 4231's vectors.
 */
export async function hmacSeed(secret: string, message: string): Promise<number> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return new DataView(mac).getUint32(0, false)
}

export async function puzzleForDate(secret: string, date: string): Promise<Puzzle> {
  return generatePuzzle(await hmacSeed(secret, puzzleMessage(date)))
}
```

- [ ] **Step 4: Run it to verify it passes, and write the golden snapshot.** Run the Step 2 command. Expected: exit 0, with the line `3 written` in the log. This is the one run that writes snapshots, because CI does not write new ones. Read `convex/lib/clueLadder/__snapshots__/seed.test.ts.snap`. Each entry must have five shapes, 4–6 clue lines, and `remaining` ending in `1`. Run the command again. Expected: exit 0, nothing written.

- [ ] **Step 5: List the module in `api.d.ts`.** In `convex/_generated/api.d.ts`, after the `lib_clueLadder_rng` import line:

```ts
import type * as lib_clueLadder_seed from "../lib/clueLadder/seed.js";
```

and after the `"lib/clueLadder/rng": typeof lib_clueLadder_rng;` line:

```ts
  "lib/clueLadder/seed": typeof lib_clueLadder_seed;
```

- [ ] **Step 6: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.3
bd export -o .beads/issues.jsonl
git add convex/lib/clueLadder/seed.ts convex/lib/clueLadder/seed.test.ts convex/lib/clueLadder/__snapshots__/seed.test.ts.snap convex/_generated/api.d.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): daily seed, HMAC-SHA256 of the date under CLUE_LADDER_SEED

Big-endian first four bytes, pinned by RFC 4231's vectors. Three dates'
puzzles are pinned as a golden snapshot.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 4: Puzzle table

**Files:**
- Create: `convex/lib/ladderValidators.ts`, `convex/lib/ladderValidators.test.ts`
- Create: `convex/clueLadder.ts`, `convex/clueLadder.test.ts`
- Modify: `convex/schema.ts` (new table after `clueLadderPlays`)
- Modify: `convex/_generated/api.d.ts`

- [ ] **Step 1: Write the failing validator test** (`convex/lib/ladderValidators.test.ts`)

```ts
import type { Infer } from 'convex/values'
import { describe, expect, expectTypeOf, test } from 'vitest'
import type { Clue } from './clueLadder/clues.ts'
import { SHAPES } from './clueLadder/orders.ts'
import { clueValidator, shapeValidator, slotValidator } from './ladderValidators.ts'

describe('ladder validators', () => {
  test('the shape validator is exactly SHAPES, in order', () => {
    expect(shapeValidator.members.map((member) => member.value)).toEqual([...SHAPES])
  })

  test('a slot is a shape or null', () => {
    expect(slotValidator.members.map((member) => member.value)).toEqual([...SHAPES, null])
  })

  test('the clue validator stores exactly the engine’s Clue type', () => {
    // A compile-time check: `pnpm typecheck` fails if the two drift apart.
    expectTypeOf<Infer<typeof clueValidator>>().toEqualTypeOf<Clue>()
  })
})
```

If `slotValidator.members` has no `.value` on its `v.null()` member, change the second test to check `members.length === SHAPES.length + 1` and that the first five values equal `SHAPES`. Report the change.

- [ ] **Step 2: Write the failing puzzle test** (`convex/clueLadder.test.ts`)

```ts
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { ensurePuzzleFor } from './clueLadder'
import { puzzleForDate } from './lib/clueLadder/seed.ts'
import { toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')
const SECRET = 'clue-ladder-test-secret-0123456789'
// The real clock, as teamGameMonth.test.ts does: requirePlausibleToday reads it.
const today = toPuzzleDay(new Date())

beforeEach(() => {
  vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
  vi.stubEnv('CLUE_LADDER_SEED', SECRET)
})
afterEach(() => vi.unstubAllEnvs())

describe('ensurePuzzleFor', () => {
  test('creates the date’s puzzle once, from the secret', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const first = await ensurePuzzleFor(ctx, today)
      const again = await ensurePuzzleFor(ctx, today)
      expect(again._id).toBe(first._id)
      expect(await ctx.db.query('clueLadderPuzzles').collect()).toHaveLength(1)

      const expected = await puzzleForDate(SECRET, today)
      expect(first).toMatchObject({
        date: today,
        answer: [...expected.answer],
        clues: expected.clues,
        remaining: expected.remaining,
        generatorVersion: 1,
        fallback: expected.fallback,
      })
    })
  })

  test.each([[undefined], [''], ['too-short']])('refuses with seed %j, writing nothing', async (secret) => {
    vi.stubEnv('CLUE_LADDER_SEED', secret)
    await convexTest(schema, modules).run(async (ctx) => {
      await expect(ensurePuzzleFor(ctx, today)).rejects.toMatchObject({ data: { code: 'CLUE_LADDER_DISABLED' } })
      expect(await ctx.db.query('clueLadderPuzzles').collect()).toEqual([])
    })
  })

  test('refuses to store a ladder that breaks the rules', async () => {
    const broken = async (secret: string, date: string) => ({ ...(await puzzleForDate(secret, date)), clues: [] })
    await convexTest(schema, modules).run(async (ctx) => {
      await expect(ensurePuzzleFor(ctx, today, broken)).rejects.toThrow(/breaks rule 'length'/)
      expect(await ctx.db.query('clueLadderPuzzles').collect()).toEqual([])
    })
  })
})
```

- [ ] **Step 3: Run both to verify they fail.** Run: `TZ=UTC pnpm exec vitest run convex/lib/ladderValidators.test.ts convex/clueLadder.test.ts > "$SCRATCH/s3.log" 2>&1; echo "exit $?"`. Expected: exit 1, modules not found.

- [ ] **Step 4: Implement the validators** (`convex/lib/ladderValidators.ts`)

```ts
import { v } from 'convex/values'

/**
 * Convex validators for the clue ladder's shapes and clues (wordle-teams-9j7o.2.3).
 *
 * HERE, NOT IN lib/clueLadder/, which stays free of Convex imports so the
 * simulation runner can load it in plain Node (orders.ts). ladderValidators.test.ts
 * holds these to SHAPES and to the Clue type, so they cannot drift apart.
 */
export const shapeValidator = v.union(
  v.literal('triangle'),
  v.literal('square'),
  v.literal('circle'),
  v.literal('diamond'),
  v.literal('star'),
)

/** One slot of a scratch arrangement: a shape, or null while empty. */
export const slotValidator = v.union(
  v.literal('triangle'),
  v.literal('square'),
  v.literal('circle'),
  v.literal('diamond'),
  v.literal('star'),
  v.null(),
)

export const clueValidator = v.union(
  v.object({ kind: v.literal('atEnd'), shape: shapeValidator, negated: v.boolean() }),
  v.object({ kind: v.literal('inSlot'), shape: shapeValidator, slot: v.number(), negated: v.boolean() }),
  v.object({ kind: v.literal('leftOf'), a: shapeValidator, b: shapeValidator }),
  v.object({ kind: v.literal('rightOf'), a: shapeValidator, b: shapeValidator }),
  v.object({ kind: v.literal('nextTo'), a: shapeValidator, b: shapeValidator, negated: v.boolean() }),
  v.object({ kind: v.literal('between'), shape: shapeValidator, a: shapeValidator, b: shapeValidator }),
  v.object({ kind: v.literal('apart'), a: shapeValidator, b: shapeValidator, distance: v.number() }),
)
```

- [ ] **Step 5: Add the table.** In `convex/schema.ts`, import the validators beside the other imports:

```ts
import { clueValidator, shapeValidator } from './lib/ladderValidators.ts'
```

and add after the `clueLadderPlays` table's closing `.index('by_player_and_date', ['playerId', 'date']),`:

```ts

  /**
   * ONE ROW PER CLUE LADDER DATE (spec section 3), shared by every player.
   *
   * Written once, by clueLadder.ts's ensurePuzzleFor, the first time anyone
   * starts that date. Generation is deterministic (lib/clueLadder/seed.ts), so
   * two first requests would write identical content. Convex retries the
   * second mutation, which then finds the first's row, so `by_date` stays unique
   * by convention, as clueLadderPlays' index does.
   *
   * THE ANSWER AND EVERY CLUE ARE HERE. Nothing sends this table to a client
   * except clueLadder.ts's todayFor, which hides both while a play is unfinished.
   *
   * `remaining[i]` is the count of orders still possible after clue i + 1.
   * `fallback` marks the four-slot ladder generatePuzzle uses when its random
   * build gives up.
   */
  clueLadderPuzzles: defineTable({
    date: v.string(),
    answer: v.array(shapeValidator),
    clues: v.array(clueValidator),
    remaining: v.array(v.number()),
    generatorVersion: v.number(),
    fallback: v.boolean(),
  }).index('by_date', ['date']),
```

- [ ] **Step 6: Implement `ensurePuzzleFor`** (`convex/clueLadder.ts`)

```ts
import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server'
import type { DataModel, Doc } from './_generated/dataModel'
import { accessError } from './access'
import type { Puzzle } from './lib/clueLadder/generate.ts'
import { ladderProblem } from './lib/clueLadder/ladder.ts'
import { GENERATOR_VERSION, puzzleForDate, seedSecretUsable } from './lib/clueLadder/seed.ts'
import type { PuzzleDay } from './lib/puzzleDay.ts'

/**
 * The clue ladder's puzzles and plays (wordle-teams-9j7o.2.3, spec sections 3
 * and 4). Plan 1 made the plays table and the scoreboard that reads it; this
 * module is everything that writes.
 */

type ReaderCtx = { db: GenericDatabaseReader<DataModel> }
type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

export async function puzzleOn(ctx: ReaderCtx, date: PuzzleDay): Promise<Doc<'clueLadderPuzzles'> | null> {
  return await ctx.db
    .query('clueLadderPuzzles')
    .withIndex('by_date', (q) => q.eq('date', date))
    .first()
}

/**
 * The puzzle for `date`, made the first time anyone asks (spec section 3).
 *
 * CALLERS BOUND THE DATE FIRST, with requirePlausibleToday, so a puzzle exists
 * only for a day some player could be on. Nothing here checks it again.
 *
 * `generate` is a parameter only so a test can hand in a ladder that breaks the
 * rules. Production always uses puzzleForDate.
 */
export async function ensurePuzzleFor(
  ctx: WriterCtx,
  date: PuzzleDay,
  generate: (secret: string, date: PuzzleDay) => Promise<Puzzle> = puzzleForDate,
): Promise<Doc<'clueLadderPuzzles'>> {
  const existing = await puzzleOn(ctx, date)
  if (existing) return existing

  const secret = process.env.CLUE_LADDER_SEED
  if (!seedSecretUsable(secret)) throw accessError('CLUE_LADDER_DISABLED')
  const puzzle = await generate(secret, date)

  // CHECKED BEFORE IT IS STORED, because a stored ladder is permanent: everyone
  // plays it that day. The generator's tests cover thousands of seeds; this
  // covers the one date being made. A plain Error, not an AccessCode: no player
  // did anything wrong, and the message is for the logs.
  const problem = ladderProblem(puzzle.answer, puzzle.clues)
  if (problem !== null) throw new Error(`clue ladder ${date}: generated ladder breaks rule '${problem}'`)

  const id = await ctx.db.insert('clueLadderPuzzles', {
    date,
    answer: [...puzzle.answer],
    clues: puzzle.clues,
    remaining: puzzle.remaining,
    generatorVersion: GENERATOR_VERSION,
    fallback: puzzle.fallback,
  })
  const row = await ctx.db.get(id)
  if (!row) throw new Error(`clue ladder ${date}: puzzle missing after insert`)
  return row
}
```

- [ ] **Step 7: List both modules in `api.d.ts`.** Add the import lines in sorted position: `clueLadder` after `chatNotify`, and `lib/ladderValidators` after `lib/invite` (it sorts before `lib/league`):

```ts
import type * as clueLadder from "../clueLadder.js";
```

```ts
import type * as lib_ladderValidators from "../lib/ladderValidators.js";
```

Then the two matching entries in the `fullApi` object: `clueLadder: typeof clueLadder;` after `chatNotify: typeof chatNotify;`, and `"lib/ladderValidators": typeof lib_ladderValidators;` after `"lib/invite": typeof lib_invite;`.

- [ ] **Step 8: Run both tests to verify they pass.** Run the Step 3 command. Expected: exit 0.

- [ ] **Step 9: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.4
bd export -o .beads/issues.jsonl
git add convex/lib/ladderValidators.ts convex/lib/ladderValidators.test.ts convex/clueLadder.ts convex/clueLadder.test.ts convex/schema.ts convex/_generated/api.d.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): puzzle table, each date's puzzle made once from the seed

A ladder that breaks the spec's rules is refused before it is stored.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 5: Who plays, the write path, start and today

**Files:**
- Modify: `convex/clueLadder.ts`, `convex/clueLadder.test.ts`

- [ ] **Step 1: Write the failing tests.** In `convex/clueLadder.test.ts`, replace the import block with:

```ts
import { convexTest } from 'convex-test'
import type { GenericDatabaseWriter } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import type { DataModel } from './_generated/dataModel'
import { requirePlausibleToday } from './access'
import { aPlayer, aTeam } from './fixtures.ts'
import { ensurePuzzleFor, puzzleOn, startFor, todayFor, writePlayFor } from './clueLadder'
import { clueText } from './lib/clueLadder/clues.ts'
import { SHAPES } from './lib/clueLadder/orders.ts'
import { puzzleForDate } from './lib/clueLadder/seed.ts'
import { isPassedDate } from './lib/games.ts'
import { addDays, toPuzzleDay } from './lib/puzzleDay.ts'
```

and append:

```ts
type Ctx = { db: GenericDatabaseWriter<DataModel> }

const EMPTY = [null, null, null, null, null]

/** A player on one team, opted in unless told otherwise. */
async function aClueLadderPlayer(ctx: Ctx, optedIn = true) {
  const playerId = await ctx.db.insert('players', aPlayer())
  await ctx.db.insert('teams', aTeam({ playerIds: [playerId], owner: playerId, clueLadderEnabled: optedIn }))
  return playerId
}

async function nothingWritten(ctx: Ctx) {
  expect(await ctx.db.query('clueLadderPlays').collect()).toEqual([])
  expect(await ctx.db.query('clueLadderPuzzles').collect()).toEqual([])
}

describe('startFor', () => {
  test('creates the puzzle and the play, with clue 1 revealed, once', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await startFor(ctx, playerId, today)
      await startFor(ctx, playerId, today)
      const plays = await ctx.db.query('clueLadderPlays').collect()
      expect(plays).toHaveLength(1)
      expect(plays[0]).toMatchObject({ playerId, date: today, cluesRevealed: 1, status: 'playing', scratch: EMPTY })
      expect(await ctx.db.query('clueLadderPuzzles').collect()).toHaveLength(1)
    })
  })

  test.each([
    ['CLUE_LADDER_ENABLED', ''],
    ['CLUE_LADDER_SEED', ''],
  ])('refuses with %s=%j, writing nothing', async (name, value) => {
    vi.stubEnv(name, value)
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(startFor(ctx, playerId, today)).rejects.toMatchObject({ data: { code: 'CLUE_LADDER_DISABLED' } })
      await nothingWritten(ctx)
    })
  })

  test('refuses a player on no opted-in team', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx, false)
      await expect(startFor(ctx, playerId, today)).rejects.toMatchObject({ data: { code: 'CLUE_LADDER_NOT_ON_TEAM' } })
      await nothingWritten(ctx)
    })
  })

  test('refuses a past date: there is no backfill', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(startFor(ctx, playerId, addDays(today, -2))).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })
      await nothingWritten(ctx)
    })
  })
})

describe('todayFor', () => {
  test('before start: not started, and nothing about the puzzle', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await ensurePuzzleFor(ctx, today)
      expect(await todayFor(ctx, playerId, today)).toEqual({ status: 'not-started', date: today })
    })
  })

  test('while playing: the revealed clues only, and no answer', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await startFor(ctx, playerId, today)
      const puzzle = await puzzleOn(ctx, today)
      if (!puzzle) throw new Error('no puzzle')

      const view = await todayFor(ctx, playerId, today)
      // toEqual is exact, so no answer, remaining or later clue can ride along.
      expect(view).toEqual({
        status: 'playing',
        date: today,
        cluesRevealed: 1,
        clues: [clueText(puzzle.clues[0])],
        scratch: EMPTY,
      })
      const json = JSON.stringify(view)
      for (const hidden of puzzle.clues.slice(1)) expect(json).not.toContain(clueText(hidden))
    })
  })
})

describe('writePlayFor', () => {
  const playing = { cluesRevealed: 1, status: 'playing' as const, scratch: EMPTY }

  test('refuses a passed date, which the scoreboard already counts as X', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(writePlayFor(ctx, playerId, addDays(today, -2), null, playing)).rejects.toMatchObject({
        data: { code: 'INVALID_DATE' },
      })
      await nothingWritten(ctx)
    })
  })

  test.each([0, 7, 1.5])('refuses cluesRevealed %s', async (cluesRevealed) => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(writePlayFor(ctx, playerId, today, null, { ...playing, cluesRevealed })).rejects.toThrow(
        /cluesRevealed/,
      )
      await nothingWritten(ctx)
    })
  })

  test('refuses a lock-in on a different clue from the one revealed', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      const write = { ...playing, status: 'solved' as const, cluesRevealed: 3, lockedAtClue: 2, lockedOrder: [...SHAPES] }
      await expect(writePlayFor(ctx, playerId, today, null, write)).rejects.toThrow(/lockedAtClue/)
      await nothingWritten(ctx)
    })
  })

  test('refuses a finished status without a lock-in', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(writePlayFor(ctx, playerId, today, null, { ...playing, status: 'failed' })).rejects.toThrow(
        /status failed/,
      )
      await nothingWritten(ctx)
    })
  })

  test('every day requirePlausibleToday accepts is live by isPassedDate', () => {
    // The two rules must agree, or a writer could accept a day the scoreboard has
    // already scored X. Pinned here, where both are used.
    const serverToday = toPuzzleDay(new Date())
    for (const delta of [-1, 0, 1]) expect(isPassedDate(addDays(serverToday, delta), serverToday)).toBe(false)
    expect(isPassedDate(addDays(serverToday, -2), serverToday)).toBe(true)
    expect(() => requirePlausibleToday(addDays(serverToday, -2))).toThrow()
  })
})
```

The unused `puzzleForDate` import stays: the Task 4 tests use it.

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run convex/clueLadder.test.ts > "$SCRATCH/s4.log" 2>&1; echo "exit $?"`. Expected: exit 1, `startFor` is not exported.

- [ ] **Step 3: Implement.** In `convex/clueLadder.ts`, replace the import block with:

```ts
import { v } from 'convex/values'
import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server'
import { mutation, query } from './_generated/server'
import type { DataModel, Doc, Id } from './_generated/dataModel'
import { accessError, requirePlausibleToday, requirePlayer } from './access'
import { clueText } from './lib/clueLadder/clues.ts'
import { clueLadderSwitchOn } from './lib/clueLadder/flag.ts'
import type { Puzzle } from './lib/clueLadder/generate.ts'
import { ladderProblem, MAX_CLUES, survivors } from './lib/clueLadder/ladder.ts'
import { SLOT_COUNT, type Shape } from './lib/clueLadder/orders.ts'
import { GENERATOR_VERSION, puzzleForDate, seedSecretUsable } from './lib/clueLadder/seed.ts'
import { isPassedDate } from './lib/games.ts'
import { isPlausibleToday, toPuzzleDay, type PuzzleDay } from './lib/puzzleDay.ts'
```

and append after `ensurePuzzleFor`:

```ts
/**
 * Whether the clue ladder can be PLAYED here: the CLUE_LADDER_ENABLED switch
 * and a usable CLUE_LADDER_SEED. With no seed no puzzle can be made, so the game
 * answers as switched off instead of offering a Play button that always fails.
 */
export function clueLadderPlayable(): boolean {
  return clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED) && seedSecretUsable(process.env.CLUE_LADDER_SEED)
}

/**
 * Whether the player is on at least one team whose owner opted it in (spec
 * section 4, "Who can play"). A whole-table scan, as getMyTeamsFor does
 * (teams.ts): Convex cannot index array membership, and the table is small.
 */
export async function onClueLadderTeam(ctx: ReaderCtx, playerId: Id<'players'>): Promise<boolean> {
  const teams = await ctx.db.query('teams').collect()
  return teams.some((team) => team.clueLadderEnabled === true && team.playerIds.includes(playerId))
}

async function requireClueLadderPlayer(ctx: ReaderCtx, playerId: Id<'players'>): Promise<void> {
  if (!clueLadderPlayable()) throw accessError('CLUE_LADDER_DISABLED')
  if (!(await onClueLadderTeam(ctx, playerId))) throw accessError('CLUE_LADDER_NOT_ON_TEAM')
}

export async function playOn(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  date: PuzzleDay,
): Promise<Doc<'clueLadderPlays'> | null> {
  return await ctx.db
    .query('clueLadderPlays')
    .withIndex('by_player_and_date', (q) => q.eq('playerId', playerId).eq('date', date))
    .first()
}

type Slot = Shape | null

const emptyScratch = (): Slot[] => Array.from({ length: SLOT_COUNT }, () => null)

/** Every field a writer sets. playerId, date and startedAt are fixed when the play is made. */
export type PlayWrite = {
  cluesRevealed: number
  status: 'playing' | 'solved' | 'failed'
  scratch: Slot[]
  lockedOrder?: Shape[]
  lockedAtClue?: number
  finishedAt?: number
}

const isClueCount = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_CLUES

/**
 * THE ONE WRITE PATH FOR A CLUE LADDER PLAY (spec section 5), the role
 * upsertBoardFor plays for Wordle. start, nextClue, saveScratch and lockIn all
 * write through here, and spec section 7's later hooks (stored winners, team
 * totals) attach here.
 *
 * It refuses what no writer should produce:
 * - A PASSED DATE, judged by the scoreboard's own isPassedDate (lib/games.ts),
 *   so a day already counted as X can never become a win. Today's callers
 *   cannot reach it, since they write only a `today` that requirePlausibleToday
 *   accepted, and that is never passed (clueLadder.test.ts pins the two rules
 *   together). It guards the next writer.
 * - A clue count outside 1..MAX_CLUES, or a lockedAtClue different from
 *   cluesRevealed: the registry scores lockedAtClue as the result.
 * - A finished status without a lock-in, or a lock-in on a play still playing.
 *
 * Those three are plain Errors. They mean a bug in this module, not a player's
 * mistake, so there is no player-facing copy for them.
 */
export async function writePlayFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  date: PuzzleDay,
  existing: Doc<'clueLadderPlays'> | null,
  write: PlayWrite,
): Promise<void> {
  if (isPassedDate(date, toPuzzleDay(new Date()))) throw accessError('INVALID_DATE')
  if (!isClueCount(write.cluesRevealed)) {
    throw new Error(`clue ladder: cluesRevealed ${write.cluesRevealed} is outside 1..${MAX_CLUES}`)
  }
  if (write.scratch.length !== SLOT_COUNT) throw new Error(`clue ladder: scratch has ${write.scratch.length} slots`)
  const finished = write.status !== 'playing'
  if (finished !== (write.lockedAtClue !== undefined) || finished !== (write.lockedOrder !== undefined)) {
    throw new Error(`clue ladder: status ${write.status} with lockedAtClue ${write.lockedAtClue}`)
  }
  if (write.lockedAtClue !== undefined && write.lockedAtClue !== write.cluesRevealed) {
    throw new Error(`clue ladder: lockedAtClue ${write.lockedAtClue} differs from cluesRevealed ${write.cluesRevealed}`)
  }
  if (existing) await ctx.db.patch(existing._id, write)
  else await ctx.db.insert('clueLadderPlays', { playerId, date, startedAt: Date.now(), ...write })
}

/** Makes the puzzle if needed, then the play with clue 1 revealed. Idempotent (spec section 4). */
export async function startFor(ctx: WriterCtx, playerId: Id<'players'>, today: string): Promise<void> {
  await requireClueLadderPlayer(ctx, playerId)
  const date = requirePlausibleToday(today)
  await ensurePuzzleFor(ctx, date)
  if (await playOn(ctx, playerId, date)) return
  await writePlayFor(ctx, playerId, date, null, { cluesRevealed: 1, status: 'playing', scratch: emptyScratch() })
}

/**
 * The player's game on `date`, for the play page and the dashboard card.
 *
 * WHILE PLAYING IT HOLDS ONLY THE REVEALED CLUES, as text, and no answer, no
 * `remaining` and no clue count (spec section 3: the ladder's length is
 * hidden). Once finished it adds the answer, the ladder and the orders that
 * still fitted when the player locked in, for the explanation.
 */
export async function todayFor(ctx: ReaderCtx, playerId: Id<'players'>, date: PuzzleDay) {
  const play = await playOn(ctx, playerId, date)
  if (!play) return { status: 'not-started' as const, date }
  const puzzle = await puzzleOn(ctx, date)
  if (!puzzle) throw new Error(`clue ladder: a play for ${date} has no puzzle`)

  const base = {
    date,
    cluesRevealed: play.cluesRevealed,
    clues: puzzle.clues.slice(0, play.cluesRevealed).map(clueText),
    scratch: play.scratch,
  }
  if (play.status === 'playing') return { status: 'playing' as const, ...base }

  const { lockedAtClue, lockedOrder } = play
  if (lockedAtClue === undefined || lockedOrder === undefined) {
    throw new Error(`clue ladder: finished play for ${date} has no lock-in`)
  }
  return {
    status: play.status,
    ...base,
    lockedAtClue,
    lockedOrder,
    answer: puzzle.answer,
    remaining: puzzle.remaining,
    possibleAtLockIn: survivors(puzzle.clues.slice(0, lockedAtClue)),
  }
}

export const today = query({
  args: { today: v.string() },
  handler: async (ctx, args) => {
    // RETURNS rather than throws when off, so the card and the play page never
    // error on a dark deployment (challenges.ts's convention). A player on no
    // opted-in team gets the same answer: there is nothing for them to see.
    if (!clueLadderPlayable()) return { enabled: false as const }
    const player = await requirePlayer(ctx)
    if (!(await onClueLadderTeam(ctx, player._id))) return { enabled: false as const }
    // A LIVE QUERY FALLS BACK TO THE SERVER'S DAY instead of refusing, as
    // leagues.ts's readToday does: a tab left open past midnight re-runs this on
    // every write, and must not start throwing with no action from the player.
    const serverToday = toPuzzleDay(new Date())
    const date = isPlausibleToday(args.today, serverToday) ? args.today : serverToday
    return { enabled: true as const, play: await todayFor(ctx, player._id, date) }
  },
})

export const start = mutation({
  args: { today: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await startFor(ctx, player._id, args.today)
  },
})
```

- [ ] **Step 4: Run it to verify it passes.** Run the Step 2 command. Expected: exit 0.

- [ ] **Step 5: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.5
bd export -o .beads/issues.jsonl
git add convex/clueLadder.ts convex/clueLadder.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): start and today, through one write path

today shows only the revealed clues while a game is on. Every write
refuses a passed date and a clue count outside 1..6.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 6: Next clue, scratch and lock-in

**Files:**
- Modify: `convex/clueLadder.ts`, `convex/clueLadder.test.ts`

- [ ] **Step 1: Write the failing tests.** In `convex/clueLadder.test.ts`, change the `./clueLadder` import to:

```ts
import {
  ensurePuzzleFor,
  lockInFor,
  nextClueFor,
  playOn,
  puzzleOn,
  saveScratchFor,
  startFor,
  todayFor,
  writePlayFor,
} from './clueLadder'
```

add `import { FAILED_ATTEMPTS, GAMES, isPassedDate } from './lib/games.ts'` in place of the `isPassedDate`-only import, and append:

```ts
async function started(ctx: Ctx) {
  const playerId = await aClueLadderPlayer(ctx)
  await startFor(ctx, playerId, today)
  const puzzle = await puzzleOn(ctx, today)
  if (!puzzle) throw new Error('no puzzle')
  return { playerId, puzzle }
}

describe('nextClueFor', () => {
  test('reveals one clue at a time, then says there are no more and changes nothing', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      for (let n = 2; n <= puzzle.clues.length; n++) {
        expect(await nextClueFor(ctx, playerId, today, n - 1)).toEqual({ noMoreClues: false, cluesRevealed: n })
      }
      expect(await nextClueFor(ctx, playerId, today, puzzle.clues.length)).toEqual({ noMoreClues: true })
      expect((await playOn(ctx, playerId, today))?.cluesRevealed).toBe(puzzle.clues.length)
    })
  })

  test('a double tap reveals one clue, not two', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId } = await started(ctx)
      // Both taps were sent while the page showed clue 1.
      expect(await nextClueFor(ctx, playerId, today, 1)).toEqual({ noMoreClues: false, cluesRevealed: 2 })
      expect(await nextClueFor(ctx, playerId, today, 1)).toEqual({ noMoreClues: false, cluesRevealed: 2 })
      expect((await playOn(ctx, playerId, today))?.cluesRevealed).toBe(2)
    })
  })
})

describe('lockInFor', () => {
  test('the answer solves on the clue revealed, and the scoreboard scores that clue', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      await nextClueFor(ctx, playerId, today, 1)
      expect(await lockInFor(ctx, playerId, today, [...puzzle.answer])).toEqual({ status: 'solved', lockedAtClue: 2 })
      expect(await GAMES.clueLadder.resultsFor(ctx, playerId, today, today)).toEqual([{ puzzleDay: today, attempts: 2 }])
    })
  })

  test('any other order is an X', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      const wrong = [...puzzle.answer].reverse()
      expect(await lockInFor(ctx, playerId, today, wrong)).toEqual({ status: 'failed', lockedAtClue: 1 })
      expect(await GAMES.clueLadder.resultsFor(ctx, playerId, today, today)).toEqual([
        { puzzleDay: today, attempts: FAILED_ATTEMPTS },
      ])
    })
  })

  test('one lock-in only: a second, or another clue, is ALREADY_FINISHED', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      await lockInFor(ctx, playerId, today, [...puzzle.answer].reverse())
      await expect(lockInFor(ctx, playerId, today, [...puzzle.answer])).rejects.toMatchObject({
        data: { code: 'ALREADY_FINISHED' },
      })
      await expect(nextClueFor(ctx, playerId, today, 1)).rejects.toMatchObject({ data: { code: 'ALREADY_FINISHED' } })
      expect((await playOn(ctx, playerId, today))?.status).toBe('failed')
    })
  })

  test('refuses an order that is not the five shapes once each', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId } = await started(ctx)
      await expect(
        lockInFor(ctx, playerId, today, ['star', 'star', 'circle', 'square', 'triangle']),
      ).rejects.toMatchObject({ data: { code: 'INVALID_ORDER' } })
      expect((await playOn(ctx, playerId, today))?.status).toBe('playing')
    })
  })

  test('afterwards, today shows the answer, the ladder and the orders possible at lock-in', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      await lockInFor(ctx, playerId, today, [...puzzle.answer])
      const view = await todayFor(ctx, playerId, today)
      if (view.status !== 'solved') throw new Error(`expected solved, got ${view.status}`)
      expect(view).toMatchObject({ lockedAtClue: 1, answer: puzzle.answer, remaining: puzzle.remaining })
      expect(view.possibleAtLockIn).toHaveLength(puzzle.remaining[0])
      expect(view.possibleAtLockIn).toContainEqual(puzzle.answer)
    })
  })
})

describe('saveScratchFor', () => {
  test('stores the arrangement, and never checks it against the answer', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId } = await started(ctx)
      const scratch = ['star', null, null, null, 'circle'] as const
      await saveScratchFor(ctx, playerId, today, [...scratch])
      expect((await playOn(ctx, playerId, today))?.scratch).toEqual([...scratch])
    })
  })

  test.each([
    [['star', 'star', null, null, null]],
    [[null, null, null, null]],
  ] as const)('refuses %j', async (scratch) => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId } = await started(ctx)
      await expect(saveScratchFor(ctx, playerId, today, [...scratch])).rejects.toMatchObject({
        data: { code: 'INVALID_ORDER' },
      })
    })
  })

  test('a save that lands after lockIn is ignored, not refused', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      await lockInFor(ctx, playerId, today, [...puzzle.answer])
      await saveScratchFor(ctx, playerId, today, [...EMPTY])
      expect((await playOn(ctx, playerId, today))?.scratch).toEqual([...puzzle.answer])
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run convex/clueLadder.test.ts > "$SCRATCH/s5.log" 2>&1; echo "exit $?"`. Expected: exit 1, `nextClueFor` is not exported.

- [ ] **Step 3: Implement.** In `convex/clueLadder.ts`, change two imports:

```ts
import { isOrder, SLOT_COUNT, type Shape } from './lib/clueLadder/orders.ts'
import { shapeValidator, slotValidator } from './lib/ladderValidators.ts'
```

(the second one is new; put it after the `./lib/games.ts` import) and append:

```ts
/**
 * The caller's play for today, finished or not.
 *
 * NO PLAY YET IS A CLIENT BUG, not a player's mistake: the play page calls start
 * before it shows Next clue or Lock in. So it is a plain Error, with no
 * player-facing code.
 */
async function ownPlayFor(ctx: ReaderCtx, playerId: Id<'players'>, today: string) {
  await requireClueLadderPlayer(ctx, playerId)
  const date = requirePlausibleToday(today)
  const play = await playOn(ctx, playerId, date)
  if (!play) throw new Error(`clue ladder: no play for ${date}; start comes first`)
  return { date, play }
}

async function puzzleOfPlay(ctx: ReaderCtx, date: PuzzleDay): Promise<Doc<'clueLadderPuzzles'>> {
  const puzzle = await puzzleOn(ctx, date)
  if (!puzzle) throw new Error(`clue ladder: a play for ${date} has no puzzle`)
  return puzzle
}

/**
 * Reveals one more clue. Irreversible. When none remain it changes nothing and
 * says so (spec section 4): the ladder's length stays hidden until a player asks
 * past its end.
 *
 * SAFE AGAINST A DOUBLE TAP. The client sends the clue count it is looking at
 * (`expectedRevealed`). If the play has already moved past it, because an
 * earlier tap landed, nothing changes and the current count comes back. Two
 * quick taps reveal one clue, not two, and a revealed clue costs points.
 */
export async function nextClueFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  today: string,
  expectedRevealed: number,
): Promise<{ noMoreClues: true } | { noMoreClues: false; cluesRevealed: number }> {
  const { date, play } = await ownPlayFor(ctx, playerId, today)
  if (play.status !== 'playing') throw accessError('ALREADY_FINISHED')
  if (play.cluesRevealed !== expectedRevealed) return { noMoreClues: false, cluesRevealed: play.cluesRevealed }
  const puzzle = await puzzleOfPlay(ctx, date)
  if (play.cluesRevealed >= puzzle.clues.length) return { noMoreClues: true }
  const cluesRevealed = play.cluesRevealed + 1
  await writePlayFor(ctx, playerId, date, play, { cluesRevealed, status: 'playing', scratch: play.scratch })
  return { noMoreClues: false, cluesRevealed }
}

/** Five slots, each shape at most once. Never compared with the answer (spec section 4). */
function isScratch(slots: readonly Slot[]): boolean {
  const placed = slots.filter((slot) => slot !== null)
  return slots.length === SLOT_COUNT && new Set(placed).size === placed.length
}

export async function saveScratchFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  today: string,
  scratch: Slot[],
): Promise<void> {
  const { date, play } = await ownPlayFor(ctx, playerId, today)
  if (!isScratch(scratch)) throw accessError('INVALID_ORDER')
  // A FINISHED PLAY IGNORES A LATE SAVE instead of refusing it. The client
  // batches saves on a timer, so one can land just after lockIn, and an error
  // for that would blame the player for nothing. The arrangement no longer matters.
  if (play.status !== 'playing') return
  await writePlayFor(ctx, playerId, date, play, { cluesRevealed: play.cluesRevealed, status: 'playing', scratch })
}

/**
 * The one try (spec section 4). The answer solves on the clue revealed; any
 * other order is an X. Either way the order becomes the scratch, so the board
 * shows what was locked in.
 */
export async function lockInFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  today: string,
  order: Shape[],
): Promise<{ status: 'solved' | 'failed'; lockedAtClue: number }> {
  const { date, play } = await ownPlayFor(ctx, playerId, today)
  if (play.status !== 'playing') throw accessError('ALREADY_FINISHED')
  if (!isOrder(order)) throw accessError('INVALID_ORDER')
  const puzzle = await puzzleOfPlay(ctx, date)
  const status = order.every((shape, i) => shape === puzzle.answer[i]) ? 'solved' : 'failed'
  const lockedAtClue = play.cluesRevealed
  await writePlayFor(ctx, playerId, date, play, {
    cluesRevealed: play.cluesRevealed,
    status,
    scratch: [...order],
    lockedOrder: [...order],
    lockedAtClue,
    finishedAt: Date.now(),
  })
  return { status, lockedAtClue }
}

export const nextClue = mutation({
  args: { today: v.string(), expectedRevealed: v.number() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    return await nextClueFor(ctx, player._id, args.today, args.expectedRevealed)
  },
})

export const saveScratch = mutation({
  args: { today: v.string(), scratch: v.array(slotValidator) },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await saveScratchFor(ctx, player._id, args.today, args.scratch)
  },
})

export const lockIn = mutation({
  args: { today: v.string(), order: v.array(shapeValidator) },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    return await lockInFor(ctx, player._id, args.today, args.order)
  },
})
```

- [ ] **Step 4: Run it to verify it passes.** Run the Step 2 command. Expected: exit 0.

- [ ] **Step 5: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.6
bd export -o .beads/issues.jsonl
git add convex/clueLadder.ts convex/clueLadder.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): next clue, scratch saves and the one lock-in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 7: The day a team turned it on

**Files:**
- Modify: `convex/schema.ts` (`teams`, after `clueLadderEnabled`)
- Modify: `convex/games.ts`; replace `convex/games.test.ts`
- Modify: `convex/scores.ts` (`getTeamGameMonthFor`'s return), `convex/teamGameMonth.test.ts`
- Modify: `src/components/teams/clue-ladder-setting-card.tsx`, `src/components/teams/clue-ladder-setting-card.hook.test.ts`

Owner decision 1 (`wordle-teams-k1v5`), server side. The mutation gains a required `today`, so the setting card changes in the same commit or typecheck fails.

**Winners.** `getTeamGameMonthFor` computes no winner: the clue ladder's month total is worked out on the client, by `ScoresGrid` (Task 8). Stored winners for this game are spec section 7 and not built. When they are, `recomputePlayerMonth` must pass `countsFrom` to `monthTotal` as `fromDay`. The schema comment below says so, where that work will find it.

- [ ] **Step 1: Write the failing tests.** Replace `convex/games.test.ts` with:

```ts
import { convexTest } from 'convex-test'
import type { GenericDatabaseWriter } from 'convex/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import type { DataModel } from './_generated/dataModel'
import { aPlayer, aTeam } from './fixtures.ts'
import { setTeamClueLadderFor } from './games'
import { addDays, toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')
// The real clock: requirePlausibleToday reads it.
const today = toPuzzleDay(new Date())

afterEach(() => vi.unstubAllEnvs())

type Ctx = { db: GenericDatabaseWriter<DataModel> }

async function seedTeam(ctx: Ctx) {
  const owner = await ctx.db.insert('players', aPlayer())
  const member = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
  const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [owner, member], owner }))
  return { owner, member, teamId }
}

describe('setTeamClueLadderFor', () => {
  test('the owner switches it on, and back off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await setTeamClueLadderFor(ctx, owner, teamId, true, today)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(true)
      await setTeamClueLadderFor(ctx, owner, teamId, false, today)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(false)
    })
  })

  test('a member who is not the owner is refused', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { member, teamId } = await seedTeam(ctx)
      await expect(setTeamClueLadderFor(ctx, member, teamId, true, today)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBeUndefined()
    })
  })

  test('switching on is refused while the deployment switch is off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await expect(setTeamClueLadderFor(ctx, owner, teamId, true, today)).rejects.toMatchObject({
        data: { code: 'CLUE_LADDER_DISABLED' },
      })
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBeUndefined()
    })
  })

  test('switching off works even while the deployment switch is off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await ctx.db.patch(teamId, { clueLadderEnabled: true })
      await setTeamClueLadderFor(ctx, owner, teamId, false, today)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(false)
    })
  })
})

describe('clueLadderOnSince (wordle-teams-k1v5)', () => {
  test('switching on stores the owner’s today', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await setTeamClueLadderFor(ctx, owner, teamId, true, today)
      expect((await ctx.db.get(teamId))?.clueLadderOnSince).toBe(today)
    })
  })

  test('switching off leaves it; switching on again moves it to the new day', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      const earlier = addDays(today, -20)
      await ctx.db.patch(teamId, { clueLadderEnabled: true, clueLadderOnSince: earlier })

      await setTeamClueLadderFor(ctx, owner, teamId, false, today)
      expect((await ctx.db.get(teamId))?.clueLadderOnSince).toBe(earlier)

      await setTeamClueLadderFor(ctx, owner, teamId, true, today)
      expect((await ctx.db.get(teamId))?.clueLadderOnSince).toBe(today)
    })
  })

  test('switching on what is already on keeps its day', async () => {
    // A second tab, or a double tap on the switch, must not wipe out the days
    // the team has already played.
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      const earlier = addDays(today, -20)
      await ctx.db.patch(teamId, { clueLadderEnabled: true, clueLadderOnSince: earlier })
      await setTeamClueLadderFor(ctx, owner, teamId, true, today)
      expect((await ctx.db.get(teamId))?.clueLadderOnSince).toBe(earlier)
    })
  })

  test('switching on refuses an implausible today; switching off never does', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await expect(setTeamClueLadderFor(ctx, owner, teamId, true, addDays(today, -5))).rejects.toMatchObject({
        data: { code: 'INVALID_DATE' },
      })
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBeUndefined()

      await ctx.db.patch(teamId, { clueLadderEnabled: true })
      await setTeamClueLadderFor(ctx, owner, teamId, false, 'not-a-day')
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(false)
    })
  })
})
```

In `convex/teamGameMonth.test.ts`, append inside the clue ladder `describe` block:

```ts
  test('returns the day the team turned the clue ladder on, for the grid to count from', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true, clueLadderOnSince: today }),
      )
      expect((await getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')).countsFrom).toBe(today)
      // Wordle has no such day, whatever the team's clue ladder holds.
      expect((await getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'wordle')).countsFrom).toBeNull()
    })
  })

  test('a team with no stored day counts every day (rows from before the field existed)', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true }))
      expect((await getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')).countsFrom).toBeNull()
    })
  })
```

In `src/components/teams/clue-ladder-setting-card.hook.test.ts`, add `import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'` and change the two argument assertions:

```ts
    expect(mutate.mock.calls[0][0]).toEqual({ teamId, enabled: true, today: toPuzzleDay(new Date()) })
```

```ts
    expect(mutate.mock.calls[0][0]).toEqual({ teamId, enabled: false, today: toPuzzleDay(new Date()) })
```

and append inside `describe('ClueLadderSettingCard', ...)`:

```ts
  test('the help text says days before it was on are not missed days', () => {
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: false }))
    expect(screen.getByRole('switch', { description: /Days before you turn it on don't count as missed\./ })).toBeTruthy()
  })
```

The existing description test matches `/Scores are kept\./` and still passes.

- [ ] **Step 2: Run them to verify they fail.** Run: `TZ=UTC pnpm exec vitest run convex/games.test.ts convex/teamGameMonth.test.ts src/components/teams/clue-ladder-setting-card.hook.test.ts > "$SCRATCH/s7.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: Add the field.** In `convex/schema.ts`, after `clueLadderEnabled: v.optional(v.boolean()),` in `teams`:

```ts

    /**
     * THE DAY THE OWNER LAST TURNED THE CLUE LADDER ON (wordle-teams-k1v5,
     * owner decision 2026-10-15). On the team's clue ladder scoreboard, a day
     * before it WITH NO RESULT counts for nothing: not a missed day, a blank
     * cell. A result always counts, whatever its date: the toggle promises
     * "Scores are kept", so switching off and on again never hides a play.
     *
     * Written only by games.ts setTeamClueLadderFor, from the owner's own
     * `today`. Turning the game off leaves it; turning it on again moves it.
     * ABSENT MEANS NO LIMIT, which only rows from before this field existed can
     * be (dev data).
     *
     * scores.ts getTeamGameMonthFor returns it as `countsFrom`, and ScoresGrid
     * passes it to monthTotal as `fromDay`. The clue ladder's stored winners
     * (spec section 7, not built) must do the same when they arrive.
     */
    clueLadderOnSince: v.optional(v.string()),
```

- [ ] **Step 4: Store it.** In `convex/games.ts`, change the access import to:

```ts
import { accessError, requirePlausibleToday, requirePlayer, requireTeamOwnerFor } from './access'
```

and replace `setTeamClueLadderFor` and `setTeamClueLadder` with:

```ts
/**
 * The owner switches the team's clue ladder on or off.
 *
 * ON IS REFUSED WHILE THE DEPLOYMENT SWITCH IS OFF; OFF NEVER IS. An owner must
 * always be able to take a game off their team, whatever the deployment's
 * state, as ending a challenge always works (challenges.ts). So `today` is
 * checked only when switching on.
 *
 * SWITCHING ON RECORDS THE OWNER'S TODAY as clueLadderOnSince
 * (wordle-teams-k1v5): the team's clue ladder scoreboard counts from that day.
 * Switching on what is already on keeps the day it has, so a second tab cannot
 * wipe out days the team has played. Switching off leaves it, and the next
 * switch-on moves it.
 */
export async function setTeamClueLadderFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  enabled: boolean,
  today: string,
): Promise<void> {
  if (enabled && !clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED)) throw accessError('CLUE_LADDER_DISABLED')
  const team = await requireTeamOwnerFor(ctx, playerId, teamId)
  if (!enabled) {
    await ctx.db.patch(teamId, { clueLadderEnabled: false })
    return
  }
  if (team.clueLadderEnabled === true) return
  await ctx.db.patch(teamId, { clueLadderEnabled: true, clueLadderOnSince: requirePlausibleToday(today) })
}

export const setTeamClueLadder = mutation({
  args: { teamId: v.id('teams'), enabled: v.boolean(), today: v.string() },
  handler: async (ctx, { teamId, enabled, today }) => {
    const player = await requirePlayer(ctx)
    await setTeamClueLadderFor(ctx, player._id, teamId, enabled, today)
  },
})
```

- [ ] **Step 5: Return it.** In `convex/scores.ts` `getTeamGameMonthFor`, add to the returned object, after `game,`:

```ts
    // The day the team turned the clue ladder on (wordle-teams-k1v5): the grid
    // counts nothing before it. Null for no limit, and always null for Wordle.
    countsFrom: game === 'clueLadder' ? (team.clueLadderOnSince ?? null) : null,
```

- [ ] **Step 6: Send the owner's day.** In `src/components/teams/clue-ladder-setting-card.tsx`, add `import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'` and change the mutation's arguments to:

```ts
                { teamId, enabled: !enabled, today: toPuzzleDay(new Date()) },
```

The switch is only ever clicked in the browser, after hydration, so reading the clock in the handler cannot mismatch the server's render.

In the same file, add one sentence to the help text, after "Scores are kept.":

```tsx
          A daily logic puzzle with its own scoreboard. Your team sees it on the dashboard once it's on. Turning it
          off hides it again. Scores are kept. Days before you turn it on don't count as missed.
```

- [ ] **Step 7: Run them to verify they pass.** Run the Step 2 command. Expected: exit 0.

- [ ] **Step 8: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.7
bd export -o .beads/issues.jsonl
git add convex/schema.ts convex/games.ts convex/games.test.ts convex/scores.ts convex/teamGameMonth.test.ts src/components/teams/clue-ladder-setting-card.tsx src/components/teams/clue-ladder-setting-card.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): record the day a team turned it on (wordle-teams-k1v5)

setTeamClueLadder takes the owner's today; getTeamGameMonth returns it
as countsFrom.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 8: The scoreboard counts from that day

**Files:**
- Modify: `convex/lib/scoring.ts` (`monthTotal`), `convex/lib/scoring.test.ts`
- Modify: `src/components/scores-table.tsx` (`ScoresGrid`)
- Modify: `src/components/game-scores-table.tsx`, `src/components/game-scores-table.hook.test.ts`

Owner decision 1, scoring side. Wordle's callers (`winners.ts`, both in `migrate.ts`, `ScoresTable`) pass no `fromDay` and are unchanged. The frozen-equivalence test in `scoring.test.ts` must stay green untouched.

- [ ] **Step 1: Write the failing tests.** Append to `convex/lib/scoring.test.ts`:

```ts
describe('monthTotal from a day (wordle-teams-k1v5)', () => {
  const missed = { ...system, nA: -2 }

  test('an empty day before fromDay scores nothing; a result before it still counts', () => {
    const total = monthTotal({
      month: '2026-08',
      days: [
        { puzzleDay: '2026-08-03', attempts: 1 }, // before fromDay, and it counts
        { puzzleDay: '2026-08-05', attempts: 7 },
      ],
      system: missed,
      playWeekends: true,
      today: '2026-08-07',
      fromDay: '2026-08-05',
    })
    // 3rd: a 1. 5th: X. 6th: empty, on/after fromDay, so missed.
    // 1st, 2nd and 4th: empty and before fromDay, so nothing.
    expect(total).toBe(missed.oneGuess + missed.failed + missed.nA)
  })

  test('an empty past day on or after fromDay is still a missed day', () => {
    const opts = { month: '2026-08', days: [], system: missed, playWeekends: true, today: '2026-08-07' }
    // 5th and 6th are past and empty: two missed days.
    expect(monthTotal({ ...opts, fromDay: '2026-08-05' })).toBe(2 * missed.nA)
  })

  test('a fromDay after today leaves the month at zero', () => {
    expect(
      monthTotal({ month: '2026-08', days: [], system: missed, playWeekends: true, today: '2026-08-07', fromDay: '2026-08-20' }),
    ).toBe(0)
  })

  test('a fromDay before the month changes nothing', () => {
    const opts = { month: '2026-08', days: [], system: missed, playWeekends: true, today: '2026-08-07' }
    expect(monthTotal({ ...opts, fromDay: '2026-07-01' })).toBe(monthTotal(opts))
  })
})
```

In `src/components/game-scores-table.hook.test.ts`:
- after `let earliestMonth: string | null = null`, add:

```ts
let countsFrom: string | null = null
let missed = 0
let results = [{ puzzleDay: '2026-08-04', attempts: 7 }]
```

- change the `getTeamGameMonth` branch of the `useSuspenseQuery` mock to:

```ts
    if (queryKey[0] === getFunctionName(api.scores.getTeamGameMonth)) {
      return {
        data: {
          ...gameMonth,
          countsFrom,
          team: { ...gameMonth.team, system: { ...gameMonth.team.system, nA: missed } },
          players: gameMonth.players.map((player) => ({ ...player, results })),
        },
      }
    }
```

- in `beforeEach`, also reset `countsFrom = null`, `missed = 0` and `results = [{ puzzleDay: '2026-08-04', attempts: 7 }]`;
- append these tests inside `describe('GameScoresTable', ...)`:

```ts
  // The row's last cell is its month total (scores-table.tsx).
  const total = (container: HTMLElement) => container.querySelector('tbody tr td:last-child')?.textContent

  test('a result before the team turned it on still shows and counts', () => {
    // "Scores are kept": switching the game off and on again never hides a play.
    earliestMonth = '2026-08'
    countsFrom = '2026-08-10'
    results = [
      { puzzleDay: '2026-08-04', attempts: 7 },
      { puzzleDay: '2026-08-12', attempts: 7 },
    ]
    const { container } = render(createElement(GameScoresTable, { ...props, month: '2026-08' }))
    expect(container.querySelector('[data-day="2026-08-04"]')?.textContent).toBe('X')
    expect(container.querySelector('[data-day="2026-08-12"]')?.textContent).toBe('X')
    expect(total(container)).toBe('-2')
  })

  test('an empty day before it is blank and scores nothing; an empty day on or after it is missed', () => {
    // August 2026 is wholly past, so without countsFrom every day would score `missed`.
    earliestMonth = '2026-08'
    countsFrom = '2026-08-30'
    missed = -1
    results = []
    const { container } = render(createElement(GameScoresTable, { ...props, month: '2026-08' }))
    expect(container.querySelector('[data-day="2026-08-29"]')?.textContent).toBe('')
    expect(container.querySelector('[data-day="2026-08-30"]')?.textContent).toBe('0')
    // The 30th and 31st, and nothing before.
    expect(total(container)).toBe('-2')
  })
```

- [ ] **Step 2: Run them to verify they fail.** Run: `TZ=UTC pnpm exec vitest run convex/lib/scoring.test.ts src/components/game-scores-table.hook.test.ts > "$SCRATCH/s8.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: `monthTotal`.** In `convex/lib/scoring.ts`, add a paragraph to `monthTotal`'s doc comment, after the GAME-NEUTRAL one:

```ts
 *
 * `fromDay`, WHEN GIVEN: MISSED DAYS BEFORE IT SCORE NOTHING (wordle-teams-k1v5).
 * An empty day before it scores 0, not the missed-day value. A result scores as
 * usual whatever its date, so a play is never lost by switching a game off and
 * on. The clue ladder passes the day the team turned it on. Wordle never passes it.
```

add `fromDay?: PuzzleDay` as the last field of its options type, and add `fromDay` to the destructuring. In the `reduce` callback, add this line AFTER the `if (result) return ...` line and BEFORE the missed-day line (`if (day < today) return total + system.nA`), so that a result always counts and only an empty day is skipped:

```ts
    if (fromDay !== undefined && day < fromDay) return total
```

- [ ] **Step 4: `ScoresGrid`.** In `src/components/scores-table.tsx`:
  - add `type PuzzleDay` to the existing `../../convex/lib/puzzleDay.ts` import;
  - add a `countsFrom` prop to `ScoresGrid`'s destructuring and to its props type, after `playWeekends`:

```ts
  /**
   * The day this game started counting for the team (wordle-teams-k1v5). An
   * EMPTY day before it is blank and scores nothing, rather than a missed day.
   * A result always shows and counts, whatever its date. Only the clue ladder
   * passes it, from getTeamGameMonth's `countsFrom`.
   */
  countsFrom?: PuzzleDay
```

  - pass it to the total: add `fromDay: countsFrom,` to the `monthTotal({ ... })` call, after `today,`;
  - render an empty day before it as blank: inside the day `<TableCell ...>`, wrap the `<ScoreCell ... />` element as:

```tsx
                      {result === undefined && countsFrom !== undefined && day < countsFrom ? null : (
                        <ScoreCell
                          attempts={result?.attempts}
                          hasScore={result !== undefined}
                          isBeforeToday={day < today}
                          isWeekend={isWeekendDay(day)}
                          playWeekends={playWeekends}
                        />
                      )}
```

  `ScoresTable` (the Wordle wrapper) passes no `countsFrom` and does not change.

- [ ] **Step 5: `GameScoresTable`.** In `src/components/game-scores-table.tsx`, add to the `<ScoresGrid ...>` element in `GameMonthGrid`, after `playWeekends={data.team.playWeekends}`:

```tsx
      countsFrom={data.countsFrom ?? undefined}
```

- [ ] **Step 6: Run them to verify they pass.** Run the Step 2 command. Expected: exit 0. The "not missed days" test needs `ScoresGrid` to have hydrated, so that `today` is the real date and not `${month}-01`. RTL's `render` flushes `useHydrated`'s effect, so it should be. If the total reads `0`, that is why: report it rather than weakening the assertion. Then run `TZ=UTC pnpm exec vitest run convex/lib/scoring.test.ts src/components > "$SCRATCH/s8b.log" 2>&1; echo "exit $?"`. Expected: exit 0, with the frozen-equivalence test ("Wordle totals are identical to the frozen pre-refactor function") among those passing.

- [ ] **Step 7: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.8
bd export -o .beads/issues.jsonl
git add convex/lib/scoring.ts convex/lib/scoring.test.ts src/components/scores-table.tsx src/components/game-scores-table.tsx src/components/game-scores-table.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(scores): the clue ladder grid counts from the day the team turned it on

An empty day before it is blank and scores nothing; a result always
counts (wordle-teams-k1v5). monthTotal takes an optional fromDay; Wordle's
callers pass none and are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

If `wordle-teams-k1v5` has no other open work after this, close it too: `bd close wordle-teams-k1v5`, then export and amend this unpushed commit.

---

### Task 9: Plan 1 test gaps

**Files:**
- Modify: `convex/games.test.ts`, `convex/teamGameMonth.test.ts`

Both are tests of code that already exists (the first against Task 7's signature, which added `today`), so they should pass on first run. If either fails, stop and report it as a defect in the code under test; do not change that code in this task.

- [ ] **Step 1: A non-owner cannot switch it off.** In `convex/games.test.ts`, inside `describe('setTeamClueLadderFor', ...)`, after the test "a member who is not the owner is refused":

```ts
  test('a member who is not the owner cannot switch it OFF either', async () => {
    // OFF never refuses for the switch's sake (games.ts), which makes it easy
    // to assume OFF skips the owner check too. It must not.
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { member, teamId } = await seedTeam(ctx)
      await ctx.db.patch(teamId, { clueLadderEnabled: true })
      await expect(setTeamClueLadderFor(ctx, member, teamId, false, today)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(true)
    })
  })
```

- [ ] **Step 2: A malformed date row.** In `convex/teamGameMonth.test.ts`, add `import { GAMES } from './lib/games.ts'` to the imports, and append inside the clue ladder `describe` block (the one holding "a passed unfinished play counts as an X on the board"):

```ts
  test('a malformed play date neither opens old months nor breaks the current one', async () => {
    // '' sorts below every real day, so firstDay returns it as the earliest. No
    // writer can store it now (start bounds the date), but inserts that bypass
    // the writers can, as scores.test.ts notes for Wordle boards. A Pro member,
    // so the window's floor comes from earliestMonth rather than the free rule.
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true }))
      await ctx.db.insert('playerMembership', { playerId: ada, membershipStatus: 'pro' })
      await ctx.db.insert('clueLadderPlays', { ...aPlay({ date: '' }), playerId: ada })

      expect(await GAMES.clueLadder.firstDay(ctx, ada)).toBe('')
      await expect(getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')).resolves.toBeDefined()
      await expect(getTeamGameMonthFor(ctx, ada, teamId, ancientMonth, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'MONTH_OUT_OF_WINDOW' },
      })
    })
  })
```

- [ ] **Step 3: Run both.** Run: `TZ=UTC pnpm exec vitest run convex/games.test.ts convex/teamGameMonth.test.ts > "$SCRATCH/s6.log" 2>&1; echo "exit $?"`. Expected: exit 0.

- [ ] **Step 4: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.9
bd export -o .beads/issues.jsonl
git add convex/games.test.ts convex/teamGameMonth.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
test(clue-ladder): non-owner switch-off and a malformed play date

The two gaps plan 1's review left.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 10: Client helpers

**Files:**
- Create: `src/lib/clue-ladder-share.ts`, `src/lib/clue-ladder-share.test.ts`
- Modify: `src/lib/share-link.ts`, `src/lib/share-link.test.ts`
- Create: `src/components/clue-ladder/today.ts`, `src/components/clue-ladder/today.test.ts`
- Create: `src/components/clue-ladder/use-scratch-saver.ts`, `src/components/clue-ladder/use-scratch-saver.hook.test.ts`

- [ ] **Step 1: Write the failing tests.**

`src/lib/clue-ladder-share.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { CLUE_LADDER_DAY_ONE, clueLadderNumber, clueLadderShareText } from './clue-ladder-share.ts'

describe('clueLadderNumber', () => {
  test('day one is #1, and each day after adds one', () => {
    expect(clueLadderNumber(CLUE_LADDER_DAY_ONE)).toBe(1)
    expect(clueLadderNumber('2026-10-16')).toBe(2)
    expect(clueLadderNumber('2026-11-01')).toBe(18)
  })

  test('whole days across a clock change', () => {
    // US clocks go back on 2026-11-01; Europe's moved on 2026-10-25.
    expect(clueLadderNumber('2026-11-02') - clueLadderNumber('2026-10-24')).toBe(9)
  })
})

describe('clueLadderShareText', () => {
  test('solved names the clue; failed is an X', () => {
    expect(clueLadderShareText({ date: '2026-10-20', status: 'solved', lockedAtClue: 3 })).toBe(
      'Clue ladder #6: solved on clue 3',
    )
    expect(clueLadderShareText({ date: '2026-10-20', status: 'failed', lockedAtClue: 2 })).toBe('Clue ladder #6: X')
  })
})
```

In `src/lib/share-link.test.ts`, change the import to `import { shareLink, shareText } from './share-link.ts'` and append:

```ts
describe('shareText', () => {
  const TEXT = { text: 'Clue ladder #6: X', title: 'Clue ladder' }

  test('share sheet first, with the title and the text', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const { writeText } = browser({ share, clipboard: true })
    await expect(shareText(TEXT)).resolves.toBe('shared')
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'Clue ladder', text: 'Clue ladder #6: X' })
    expect(writeText).not.toHaveBeenCalled()
  })

  test('no share sheet: the line itself goes on the clipboard', async () => {
    const { writeText } = browser({ clipboard: true })
    await expect(shareText(TEXT)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Clue ladder #6: X')
  })

  test('neither API: unavailable', async () => {
    await expect(shareText(TEXT)).resolves.toBe('unavailable')
  })
})
```

`src/components/clue-ladder/today.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { cardPlayOf, type ClueLadderTodayView } from './today.ts'

const base = { date: '2026-10-20', clues: ['a', 'b'], scratch: [null, null, null, null, null] }
const finished = {
  ...base,
  cluesRevealed: 2,
  lockedAtClue: 2,
  lockedOrder: ['star', 'circle', 'square', 'triangle', 'diamond'],
  answer: ['star', 'circle', 'square', 'triangle', 'diamond'],
  remaining: [24, 1],
  possibleAtLockIn: [],
} satisfies Omit<Extract<ClueLadderTodayView, { status: 'solved' }>, 'status'>

describe('cardPlayOf', () => {
  test.each<[ClueLadderTodayView, ReturnType<typeof cardPlayOf>]>([
    [{ status: 'not-started', date: '2026-10-20' }, { status: 'not-started' }],
    [{ status: 'playing', cluesRevealed: 2, ...base }, { status: 'playing', cluesRevealed: 2 }],
    [{ status: 'solved', ...finished }, { status: 'solved', lockedAtClue: 2 }],
    [{ status: 'failed', ...finished }, { status: 'failed' }],
  ])('%j', (view, card) => {
    expect(cardPlayOf(view)).toEqual(card)
  })
})
```

`src/components/clue-ladder/use-scratch-saver.hook.test.ts`:

```ts
// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Slots } from '#/lib/clue-ladder-board.ts'
import { SCRATCH_SAVE_MS, useScratchSaver } from './use-scratch-saver.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const A: Slots = ['star', null, null, null, null]
const B: Slots = ['star', 'circle', null, null, null]
const C: Slots = [null, 'circle', null, null, 'star']

describe('useScratchSaver', () => {
  test('changes inside the window make one save, of the last arrangement', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useScratchSaver(save))
    result.current.schedule(A)
    result.current.schedule(B)
    result.current.schedule(C)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS)
    expect(save).toHaveBeenCalledExactlyOnceWith(C)
  })

  test('flush saves now, and the timer then has nothing to save', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useScratchSaver(save))
    result.current.schedule(A)
    await result.current.flush()
    expect(save).toHaveBeenCalledExactlyOnceWith(A)
    await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS)
    expect(save).toHaveBeenCalledTimes(1)
  })

  test('flush with nothing pending saves nothing', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useScratchSaver(save))
    await result.current.flush()
    expect(save).not.toHaveBeenCalled()
  })

  test('leaving the page saves what is pending', () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() => useScratchSaver(save))
    result.current.schedule(B)
    unmount()
    expect(save).toHaveBeenCalledExactlyOnceWith(B)
  })

  test('a failed save is dropped, not thrown', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useScratchSaver(save))
    result.current.schedule(A)
    await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS)
    await expect(result.current.flush()).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run them to verify they fail.** Run: `TZ=UTC pnpm exec vitest run src/lib/clue-ladder-share.test.ts src/lib/share-link.test.ts src/components/clue-ladder/today.test.ts src/components/clue-ladder/use-scratch-saver.hook.test.ts > "$SCRATCH/s7.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: Implement.**

`src/lib/clue-ladder-share.ts`:

```ts
import type { PuzzleDay } from '../../convex/lib/puzzleDay.ts'

/**
 * Clue ladder #1 (spec section 6). The share line counts days from here.
 *
 * A PLACEHOLDER UNTIL LAUNCH (owner decision, 2026-10-15). Launch day includes a
 * one-line commit that sets this to the production launch day, and that commit
 * lands BEFORE CLUE_LADDER_ENABLED goes on in production. After that, never
 * change it: it would renumber every line already shared.
 */
export const CLUE_LADDER_DAY_ONE: PuzzleDay = '2026-10-15'

const DAY_MS = 86_400_000

function utcOf(day: PuzzleDay): number {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year, month - 1, date)
}

/** 1 on CLUE_LADDER_DAY_ONE. Counted in UTC days, so a clock change never makes it fractional. */
export function clueLadderNumber(day: PuzzleDay): number {
  return Math.round((utcOf(day) - utcOf(CLUE_LADDER_DAY_ONE)) / DAY_MS) + 1
}

export function clueLadderShareText(result: {
  date: PuzzleDay
  status: 'solved' | 'failed'
  lockedAtClue: number
}): string {
  const n = clueLadderNumber(result.date)
  return result.status === 'solved' ? `Clue ladder #${n}: solved on clue ${result.lockedAtClue}` : `Clue ladder #${n}: X`
}
```

In `src/lib/share-link.ts`, replace the body of `shareLink` and add `shareText`. The header comment stays. Append this paragraph to it, before the closing `*/`:

```ts
 *
 * shareText IS THE SAME RULE FOR A LINE OF TEXT (the clue ladder's result,
 * spec section 6): the sheet gets `text`, the clipboard gets the line itself.
 * Both go through shareOrCopy, so the order and the AbortError rule have one home.
```

and replace everything after `export type ShareOutcome = ...` with:

```ts
async function shareOrCopy(data: ShareData, clip: string): Promise<ShareOutcome> {
  try {
    if (navigator.share) {
      await navigator.share(data)
      return 'shared'
    }
    if (!navigator.clipboard) return 'unavailable'
    await navigator.clipboard.writeText(clip)
    return 'copied'
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'dismissed'
    throw error
  }
}

export async function shareLink({ url, title }: { url: string; title: string }): Promise<ShareOutcome> {
  return await shareOrCopy({ title, url }, url)
}

export async function shareText({ text, title }: { text: string; title: string }): Promise<ShareOutcome> {
  return await shareOrCopy({ title, text }, text)
}
```

`src/components/clue-ladder/today.ts`:

```ts
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import type { ClueLadderCardPlay } from './card.tsx'

/**
 * Today's game as `api.clueLadder.today` returns it when the game is on. Taken
 * from the function's own return type, so the screens cannot drift from the
 * server, and without importing convex/clueLadder.ts, which reaches auth.ts.
 */
export type ClueLadderTodayView = Extract<FunctionReturnType<typeof api.clueLadder.today>, { enabled: true }>['play']

/** The dashboard card's four states (plan 2's ClueLadderCard). */
export function cardPlayOf(play: ClueLadderTodayView): ClueLadderCardPlay {
  switch (play.status) {
    case 'not-started':
      return { status: 'not-started' }
    case 'playing':
      return { status: 'playing', cluesRevealed: play.cluesRevealed }
    case 'solved':
      return { status: 'solved', lockedAtClue: play.lockedAtClue }
    case 'failed':
      return { status: 'failed' }
  }
}
```

`src/components/clue-ladder/use-scratch-saver.ts`:

```ts
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Slots } from '#/lib/clue-ladder-board.ts'

/** At most one saveScratch call per this many ms (spec section 4: "one per few seconds at most"). */
export const SCRATCH_SAVE_MS = 3000

/**
 * Batches the play's scratch saves. The first change starts a timer; changes
 * inside the window only replace what is waiting; when the timer fires, the
 * latest arrangement is saved once. `flush` saves now, for lockIn to call
 * first, and leaving the page flushes, so the last move survives.
 *
 * A FAILED SAVE IS DROPPED. Scratch exists so a game resumes on another device.
 * lockIn sends the full order itself, so nothing scored depends on it, and an
 * error toast for a background save would interrupt the game for nothing.
 */
export function useScratchSaver(save: (slots: Slots) => Promise<unknown>, delay = SCRATCH_SAVE_MS) {
  const saveRef = useRef(save)
  useLayoutEffect(() => {
    saveRef.current = save
  })
  const pending = useRef<Slots | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const slots = pending.current
    pending.current = null
    if (slots === null) return
    try {
      await saveRef.current(slots)
    } catch {
      // Dropped on purpose; see above.
    }
  }, [])

  const schedule = useCallback(
    (slots: Slots) => {
      pending.current = slots
      if (timer.current === null) timer.current = setTimeout(() => void flush(), delay)
    },
    [delay, flush],
  )

  useEffect(() => () => void flush(), [flush])

  return { schedule, flush }
}
```

- [ ] **Step 4: Run them to verify they pass.** Run the Step 2 command. Expected: exit 0. If `share-link.test.ts`'s existing `shareLink` tests fail, the refactor changed behaviour: fix `shareOrCopy`, not the tests.

- [ ] **Step 5: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.10
bd export -o .beads/issues.jsonl
git add src/lib/clue-ladder-share.ts src/lib/clue-ladder-share.test.ts src/lib/share-link.ts src/lib/share-link.test.ts src/components/clue-ladder/today.ts src/components/clue-ladder/today.test.ts src/components/clue-ladder/use-scratch-saver.ts src/components/clue-ladder/use-scratch-saver.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): share line and #N, shareText, card mapping, batched scratch saves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 11: Finished screen lists six orders at most

**Files:**
- Modify: `src/components/clue-ladder/finished.tsx`, `src/components/clue-ladder/finished.hook.test.ts`

Owner decision 4. A lock-in on clue 1 can leave dozens of orders possible, and the finished screen listed every one. It now lists 6 at most, in both lists ("The others were" and "The orders that fit were"), then "and N more". The counts in "You had a 1 in N chance." stay exact.

- [ ] **Step 1: Write the failing tests.** In `src/components/clue-ladder/finished.hook.test.ts`, change the `orders.ts` import to:

```ts
import { ALL_ORDERS, type Order } from '../../../convex/lib/clueLadder/orders.ts'
```

and append:

```ts
describe('ClueLadderFinished lists six orders at most', () => {
  /** The first `n` orders possible, locked in on `locked`. */
  const lockedIn = (n: number, locked: Order, status: 'solved' | 'failed' = 'solved') => ({
    ...solved,
    result: { status, lockedAtClue: 1, lockedOrder: locked } as ClueLadderResult,
    possibleAtLockIn: ALL_ORDERS.slice(0, n),
  })
  const more = () => screen.queryByText(/^and \d+ more$/)

  test('six others are all listed, with no "more" line', () => {
    render(createElement(ClueLadderFinished, lockedIn(7, ALL_ORDERS[0])))
    expect(screen.getByText('You had a 1 in 7 chance.')).toBeTruthy()
    expect(screen.getAllByRole('img', { name: /^Another possible order:/ })).toHaveLength(6)
    expect(more()).toBeNull()
  })

  test('seven others: six listed, then "and 1 more"', () => {
    render(createElement(ClueLadderFinished, lockedIn(8, ALL_ORDERS[0])))
    expect(screen.getByText('You had a 1 in 8 chance.')).toBeTruthy()
    expect(screen.getAllByRole('img', { name: /^Another possible order:/ })).toHaveLength(6)
    expect(screen.getByText('and 1 more')).toBeTruthy()
  })

  test('more than seven counts the rest', () => {
    render(createElement(ClueLadderFinished, lockedIn(30, ALL_ORDERS[0])))
    expect(screen.getAllByRole('img', { name: /^Another possible order:/ })).toHaveLength(6)
    expect(screen.getByText('and 23 more')).toBeTruthy()
  })

  test('six orders that fit an order that did not are all listed', () => {
    render(createElement(ClueLadderFinished, lockedIn(6, ALL_ORDERS[100], 'failed')))
    expect(screen.getAllByRole('img', { name: /^A possible order:/ })).toHaveLength(6)
    expect(more()).toBeNull()
  })

  test('seven that fit: six listed, then "and 1 more"', () => {
    render(createElement(ClueLadderFinished, lockedIn(7, ALL_ORDERS[100], 'failed')))
    expect(screen.getAllByRole('img', { name: /^A possible order:/ })).toHaveLength(6)
    expect(screen.getByText('and 1 more')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/components/clue-ladder/finished.hook.test.ts > "$SCRATCH/s11.log" 2>&1; echo "exit $?"`. Expected: exit 1. The existing tests still pass.

- [ ] **Step 3: Implement.** In `src/components/clue-ladder/finished.tsx`, add above `ClueLadderFinished`:

```tsx
/**
 * Orders listed by name at most (owner decision, 2026-10-15). A lock-in on
 * clue 1 can leave dozens possible, and a screen of rows says less than a count.
 */
export const LISTED_ORDERS = 6

function OrderRows({ orders, label }: { orders: ReadonlyArray<Order>; label: string }) {
  const listed = orders.slice(0, LISTED_ORDERS)
  const rest = orders.length - listed.length
  return (
    <>
      {listed.map((order) => (
        <ShapeRow key={orderKey(order)} order={order} label={label} />
      ))}
      {rest > 0 && <p className="text-sm text-muted-foreground">{`and ${rest} more`}</p>}
    </>
  )
}
```

then replace the fitting-orders map:

```tsx
              {possibleAtLockIn.map((order) => (
                <ShapeRow key={orderKey(order)} order={order} label="A possible order" />
              ))}
```

with `<OrderRows orders={possibleAtLockIn} label="A possible order" />`, and the others map:

```tsx
              {others.map((order) => (
                <ShapeRow key={orderKey(order)} order={order} label="Another possible order" />
              ))}
```

with `<OrderRows orders={others} label="Another possible order" />`.

- [ ] **Step 4: Run it to verify it passes.** Run the Step 2 command. Expected: exit 0, with every earlier test in the file passing unchanged.

- [ ] **Step 5: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.11
bd export -o .beads/issues.jsonl
git add src/components/clue-ladder/finished.tsx src/components/clue-ladder/finished.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): finished screen lists six orders at most, then "and N more"

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 12: Play view

**Files:**
- Create: `src/components/clue-ladder/play-view.tsx`, `src/components/clue-ladder/play-view.hook.test.ts`

- [ ] **Step 1: Write the failing test** (`src/components/clue-ladder/play-view.hook.test.ts`)

```ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EMPTY_SLOTS } from '#/lib/clue-ladder-board.ts'
import type { Order } from '../../../convex/lib/clueLadder/orders.ts'
import { ClueLadderPlayView } from './play-view.tsx'
import type { ClueLadderTodayView } from './today.ts'

// Radix Popover (Lock in's confirm) measures its content; jsdom has no
// ResizeObserver. Same stub as challenges.hook.test.ts.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

const answer: Order = ['star', 'circle', 'square', 'triangle', 'diamond']
const playing: ClueLadderTodayView = {
  status: 'playing',
  date: '2026-10-20',
  cluesRevealed: 2,
  clues: ['The triangle is at one end.', 'The circle is not in the third slot.'],
  scratch: [null, null, null, null, null],
}
const solved: ClueLadderTodayView = {
  status: 'solved',
  date: '2026-10-20',
  cluesRevealed: 2,
  clues: playing.clues,
  scratch: [...answer],
  lockedAtClue: 2,
  lockedOrder: [...answer],
  answer: [...answer],
  remaining: [24, 1],
  possibleAtLockIn: [answer],
}

function view(over: Partial<Parameters<typeof ClueLadderPlayView>[0]> = {}) {
  const props = {
    play: playing,
    slots: EMPTY_SLOTS,
    exhausted: false,
    pending: false,
    onSlotsChange: vi.fn(),
    onNextClue: vi.fn(),
    onLockIn: vi.fn(),
    onShare: vi.fn(),
    ...over,
  }
  render(createElement(ClueLadderPlayView, props))
  return props
}

const lockIn = () => screen.getByRole('button', { name: 'Lock in' }) as HTMLButtonElement

describe('ClueLadderPlayView', () => {
  test('not started: a status line while the game is set up', () => {
    view({ play: { status: 'not-started', date: '2026-10-20' } })
    expect(screen.getByRole('status').textContent).toContain("today's shapes")
  })

  test('playing: the revealed clues, and Lock in off until every slot is filled', () => {
    view()
    expect(within(screen.getByRole('list', { name: 'Clues' })).getAllByRole('listitem')).toHaveLength(2)
    expect(lockIn().disabled).toBe(true)
  })

  test('a full board turns Lock in on', () => {
    view({ slots: answer })
    expect(lockIn().disabled).toBe(false)
  })

  test('Next clue is off once the server has said there are no more', () => {
    view({ exhausted: true })
    expect((screen.getByRole('button', { name: 'Next clue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('Lock in, confirmed, hands over the order on the board', () => {
    const props = view({ slots: answer })
    fireEvent.click(lockIn())
    fireEvent.click(screen.getByRole('button', { name: 'Yes, lock in' }))
    expect(props.onLockIn).toHaveBeenCalledExactlyOnceWith(answer)
  })

  test('finished: the result, and Share hands over the numbered line', () => {
    const props = view({ play: solved })
    expect(screen.getByRole('heading', { name: 'Solved on clue 2' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(props.onShare).toHaveBeenCalledExactlyOnceWith('Clue ladder #6: solved on clue 2')
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/components/clue-ladder/play-view.hook.test.ts > "$SCRATCH/s8.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: Implement** (`src/components/clue-ladder/play-view.tsx`)

```tsx
import type { ReactNode } from 'react'
import { filledOrder, type Slots } from '#/lib/clue-ladder-board.ts'
import { clueLadderShareText } from '#/lib/clue-ladder-share.ts'
import type { Order } from '../../../convex/lib/clueLadder/orders.ts'
import { ClueLadderBoard } from './board.tsx'
import { ClueLadderControls } from './controls.tsx'
import { ClueLadderFinished } from './finished.tsx'
import type { ClueLadderTodayView } from './today.ts'

/**
 * The play page's body, one branch per state of today's game (spec section 6).
 * Pure: play-page.tsx owns the queries, the mutations and the batched saves, so
 * this is tested with plain props.
 */
export function ClueLadderPlayView({
  play,
  slots,
  exhausted,
  pending,
  onSlotsChange,
  onNextClue,
  onLockIn,
  onShare,
  actions,
}: {
  play: ClueLadderTodayView
  slots: Slots
  /** True once nextClue has answered noMoreClues. The ladder's length is otherwise hidden. */
  exhausted: boolean
  pending: boolean
  onSlotsChange: (slots: Slots) => void
  onNextClue: () => void
  onLockIn: (order: Order) => void
  onShare: (text: string) => void
  /** The caller's own buttons under the result, such as back to team scores. */
  actions?: ReactNode
}) {
  if (play.status === 'not-started') {
    return (
      <p role="status" className="text-muted-foreground">
        Setting out today's shapes…
      </p>
    )
  }

  if (play.status === 'playing') {
    const order = filledOrder(slots)
    return (
      <div className="flex flex-col gap-6">
        <ClueLadderBoard slots={slots} onChange={onSlotsChange} disabled={pending} />
        <ClueLadderControls
          clues={play.clues}
          canRevealMore={!exhausted}
          canLockIn={order !== null}
          pending={pending}
          onNextClue={onNextClue}
          onLockIn={() => {
            if (order) onLockIn(order)
          }}
        />
      </div>
    )
  }

  const shareLine = clueLadderShareText(play)
  return (
    <ClueLadderFinished
      // today serves only the current date, so a finished play always locked in;
      // plan 2's { status: 'timedOut' } never comes from here.
      result={{ status: play.status, lockedAtClue: play.lockedAtClue, lockedOrder: play.lockedOrder }}
      answer={play.answer}
      remaining={play.remaining}
      possibleAtLockIn={play.possibleAtLockIn}
      shareText={shareLine}
      onShare={() => onShare(shareLine)}
      actions={actions}
    />
  )
}
```

- [ ] **Step 4: Run it to verify it passes.** Run the Step 2 command. Expected: exit 0.

- [ ] **Step 5: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.12
bd export -o .beads/issues.jsonl
git add src/components/clue-ladder/play-view.tsx src/components/clue-ladder/play-view.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): play view over the board, controls and finished screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 13: Play route

**Files:**
- Create: `src/components/clue-ladder/play-page.tsx`
- Create: `src/routes/play.clue-ladder.tsx`
- Modify (regenerated by `pnpm build`): `src/routeTree.gen.ts`
- Test: `src/routes.test.ts`

The container is covered by the e2e happy path in Task 15, not by a jsdom test: every line of it is wiring to Convex, and the view it renders is tested in Task 12.

- [ ] **Step 1: Write the failing pin.** Append to `src/routes.test.ts`:

```ts
describe('/play/clue-ladder, the clue ladder’s own page', () => {
  const PLAY = './routes/play.clue-ladder.tsx'

  test('exists, and is the /play/clue-ladder route', () => {
    expect(existsSync(new URL(PLAY, import.meta.url)), 'src/routes/play.clue-ladder.tsx is gone').toBe(true)
    expect(codeOf(read(PLAY))).toMatch(/createFileRoute\(\s*['"]\/play\/clue-ladder['"]\s*\)/)
  })

  test('is in the generated route tree', () => {
    const tree = read('./routeTree.gen.ts')
    expect(tree).toMatch(/path: '\/play\/clue-ladder'/)
    expect(tree).toMatch(/id: '\/play\/clue-ladder'/)
  })

  test('goes back to the dashboard for the SAME team', () => {
    // As /chat does: a bare `to="/app"` lands on whatever team the dashboard
    // defaults to, which for a player on two teams can be the other one.
    const back = jsxElements(PLAY, 'Link').find((props) => props.get('to') === '"/app"')
    expect(back, 'no <Link to="/app"> in routes/play.clue-ladder.tsx').toBeDefined()
    expect(back?.get('search')).toBe('{ team }')
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/routes.test.ts > "$SCRATCH/s9.log" 2>&1; echo "exit $?"`. Expected: exit 1, the three new tests fail.

- [ ] **Step 3: Implement the container** (`src/components/clue-ladder/play-page.tsx`)

```tsx
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { EMPTY_SLOTS, type Slots } from '#/lib/clue-ladder-board.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { shareText } from '#/lib/share-link.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { api } from '../../../convex/_generated/api'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { ClueLadderPlayView } from './play-view.tsx'
import { useScratchSaver } from './use-scratch-saver.ts'

/**
 * The play page's state and server calls (spec sections 4 and 6).
 *
 * OPENING THE PAGE STARTS THE GAME. The dashboard card's Play button is the
 * start, so the page calls start once when it finds the game not started.
 * start is idempotent, so a second call (React's dev double effect, a second
 * tab) changes nothing.
 *
 * THE BOARD IS LOCAL ONCE TOUCHED. Until the first move it shows the server's
 * scratch, so a game resumes on any device; after that the server copy trails
 * it through useScratchSaver. A server scratch arriving under the board is safe:
 * the board drops a stale tray selection when `slots` changes from outside.
 *
 * LOCK IN FOLLOWS THE HOUSE ConfirmPopover PATTERN (plan 2's controls).
 * Confirming calls onLockIn and the popover stays open, showing `pending`, while
 * lockIn runs. On success `today` turns finished and the view swaps to the
 * finished screen, which unmounts the controls and the popover with them. On
 * failure the popover stays open and the error shows as a toast through
 * mutationErrorMessage. So nothing here closes the popover by hand.
 */
export function ClueLadderPlayPage({ team }: { team?: string }) {
  const hydrated = useHydrated()
  // The player's own day, read once hydrated: the server render has no clock of theirs.
  const today = hydrated ? toPuzzleDay(new Date()) : null
  const { data } = useQuery(convexQuery(api.clueLadder.today, today ? { today } : 'skip'))

  const start = useMutation({ mutationFn: useConvexMutation(api.clueLadder.start) })
  const nextClue = useMutation({ mutationFn: useConvexMutation(api.clueLadder.nextClue) })
  const lockIn = useMutation({ mutationFn: useConvexMutation(api.clueLadder.lockIn) })
  const saveScratch = useConvexMutation(api.clueLadder.saveScratch)
  const saver = useScratchSaver((scratch) =>
    today ? saveScratch({ today, scratch: [...scratch] }) : Promise.resolve(),
  )

  const [slots, setSlots] = useState<Slots | null>(null)
  const [exhausted, setExhausted] = useState(false)
  const status = data?.enabled ? data.play.status : null

  const started = useRef(false)
  useEffect(() => {
    if (today === null || status !== 'not-started' || started.current) return
    started.current = true
    start.mutate(
      { today },
      { onError: (error) => toast.error(mutationErrorMessage(error, "Couldn't start today's clue ladder.")) },
    )
  }, [today, status, start])

  if (today === null || data === undefined) return <Skeleton className="h-96 w-full" />

  const back = (
    <Button variant="outline" asChild>
      <Link to="/app" search={{ team }}>
        Back to team scores
      </Link>
    </Button>
  )

  if (!data.enabled) {
    return (
      <div className="flex flex-col gap-4">
        <p>The clue ladder isn't on for any of your teams.</p>
        {back}
      </div>
    )
  }

  const play = data.play
  const board = slots ?? (play.status === 'not-started' ? EMPTY_SLOTS : play.scratch)
  const failed = (fallback: string) => (error: unknown) => toast.error(mutationErrorMessage(error, fallback))

  return (
    <ClueLadderPlayView
      play={play}
      slots={board}
      exhausted={exhausted}
      pending={start.isPending || nextClue.isPending || lockIn.isPending}
      onSlotsChange={(next) => {
        setSlots(next)
        saver.schedule(next)
      }}
      onNextClue={() =>
        nextClue.mutate(
          // The count on screen, so a double tap reveals one clue (nextClueFor).
          { today, expectedRevealed: play.status === 'playing' ? play.cluesRevealed : 0 },
          {
            onSuccess: (result) => {
              if (result.noMoreClues) setExhausted(true)
            },
            onError: failed("Couldn't show the next clue."),
          },
        )
      }
      onLockIn={(order) => {
        void saver.flush().then(() =>
          lockIn.mutate({ today, order: [...order] }, { onError: failed("Couldn't lock in. Try again.") }),
        )
      }}
      onShare={(text) => {
        void shareText({ title: 'Clue ladder', text })
          .then((outcome) => {
            if (outcome === 'copied') toast.success('Copied. Paste it to your team.')
            if (outcome === 'unavailable') toast.error("This browser can't share or copy.")
          })
          .catch(() => toast.error("Couldn't share."))
      }}
      actions={back}
    />
  )
}
```

- [ ] **Step 4: Implement the route** (`src/routes/play.clue-ladder.tsx`)

```tsx
import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { ArrowLeft } from 'lucide-react'
import { ClueLadderPlayPage } from '#/components/clue-ladder/play-page.tsx'
import { Button } from '#/components/ui/button.tsx'
import { pageTitle } from '#/lib/seo'
import { api } from '../../convex/_generated/api'

type PlaySearch = { team?: string }

export const Route = createFileRoute('/play/clue-ladder')({
  head: () => ({ meta: [{ title: pageTitle('Clue ladder') }] }),
  validateSearch: (search: Record<string, unknown>): PlaySearch => ({
    team: typeof search.team === 'string' ? search.team : undefined,
  }),
  // THE SAME GUARD AS /chat AND /team. The page's queries call requirePlayer,
  // which throws for a visitor with no session or no player row yet.
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(convexQuery(api.players.needsProfile, {}))
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
  component: PlayRoute,
})

/**
 * A full-screen page of its own, phone first (spec section 6). `team` is only
 * for the way back: the game belongs to the player, not to a team.
 */
function PlayRoute() {
  const { team } = Route.useSearch()
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back to dashboard" asChild>
          <Link to="/app" search={{ team }}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold">Clue ladder</h1>
      </div>
      <ClueLadderPlayPage team={team} />
    </div>
  )
}
```

- [ ] **Step 5: Regenerate the route tree.** Run: `pnpm build > "$SCRATCH/b9.log" 2>&1; echo "exit $?"`. Expected: exit 0, and `git status --short src/routeTree.gen.ts` shows it modified. Never run `tsr generate`.

- [ ] **Step 6: Run the pin to verify it passes.** Run the Step 2 command. Expected: exit 0.

- [ ] **Step 7: Look at it.** With the controller's dev backend running (`CLUE_LADDER_ENABLED` and `CLUE_LADDER_SEED` set, see Task 15), open `/play/clue-ladder` at 390px wide and on desktop. Five slots and the tray fit with no horizontal scroll at 390px. Skip this step if no dev backend is running, and say so in the report.

- [ ] **Step 8: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.13
bd export -o .beads/issues.jsonl
git add src/components/clue-ladder/play-page.tsx src/routes/play.clue-ladder.tsx src/routeTree.gen.ts src/routes.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): /play/clue-ladder, the play page

Opening it starts the game. Scratch saves are batched; lock-in flushes
them first.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 14: Dashboard card

**Files:**
- Create: `src/components/clue-ladder/dashboard-card.tsx`
- Modify: `src/routes/app.tsx` (after the `TodayPanel` `<Suspense>` block, around line 1590)
- Test: `src/routes.test.ts`

- [ ] **Step 1: Write the failing pin.** Append to `src/routes.test.ts`:

```ts
describe('the dashboard offers the clue ladder to opted-in teams only', () => {
  const APP = './routes/app.tsx'

  test('the card is mounted behind selectedTeam?.clueLadderEnabled', () => {
    expect(codeOf(read(APP))).toMatch(/selectedTeam\?\.clueLadderEnabled\s*&&\s*\(?\s*<DashboardClueLadderCard/)
  })

  test('and it sits below the day’s Wordle panel (spec section 6)', () => {
    const app = read(APP)
    expect(app.indexOf('<DashboardClueLadderCard')).toBeGreaterThan(app.indexOf('<TodayPanel'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/routes.test.ts > "$SCRATCH/s10.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: Implement** (`src/components/clue-ladder/dashboard-card.tsx`)

```tsx
import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { api } from '../../../convex/_generated/api'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { ClueLadderCard } from './card.tsx'
import { cardPlayOf } from './today.ts'

/**
 * "Today's clue ladder" on the dashboard (spec section 6), fed by `today`.
 *
 * NOTHING UNTIL IT KNOWS, and no skeleton: the game can be off, or the player
 * on no opted-in team, and a placeholder that then vanished would be worse than
 * a card that arrives a moment late. useQuery, not useSuspenseQuery, so it never
 * holds up the dashboard.
 */
export function DashboardClueLadderCard({ teamId, className }: { teamId: string; className?: string }) {
  const hydrated = useHydrated()
  const today = hydrated ? toPuzzleDay(new Date()) : null
  const { data } = useQuery(convexQuery(api.clueLadder.today, today ? { today } : 'skip'))
  if (!data?.enabled) return null
  return (
    <ClueLadderCard
      play={cardPlayOf(data.play)}
      // A real link (plan 2's card wraps it in Button asChild), so it opens in a
      // new tab and is announced as a link.
      renderLink={(children) => (
        <Link to="/play/clue-ladder" search={{ team: teamId }}>
          {children}
        </Link>
      )}
      className={className}
    />
  )
}
```

In `src/routes/app.tsx`, import it beside the other component imports:

```ts
import { DashboardClueLadderCard } from '#/components/clue-ladder/dashboard-card.tsx'
```

and add directly after the `</Suspense>` that closes the `TodayPanel` block:

```tsx
      {/* Below the day's Wordle (spec section 6), for opted-in teams only.
          Outside any Suspense boundary: it reads with useQuery and renders
          nothing until its answer arrives. */}
      {selectedTeam?.clueLadderEnabled && (
        <DashboardClueLadderCard teamId={selectedTeam.id} className="md:col-span-3" />
      )}
```

`selectedTeam.id` is the field `app.tsx` already matches against `teamParam` (`teams.find((team) => team.id === teamParam)`). The card goes between `TodayPanel` and plan 2's `GameSwitch`, which is below the day's Wordle and above the scores. Plan 2's pins in `routes.test.ts` (`'{selectedTeam?.clueLadderEnabled && ('`, the GameSwitch line) still hold.

- [ ] **Step 4: Run it to verify it passes.** Run the Step 2 command. Expected: exit 0.

- [ ] **Step 5: Gates and commit.**

```bash
bd close wordle-teams-9j7o.2.3.2.14
bd export -o .beads/issues.jsonl
git add src/components/clue-ladder/dashboard-card.tsx src/routes/app.tsx src/routes.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): today's card on the dashboard, for opted-in teams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

---

### Task 15: End to end

**Files:**
- Modify: `convex/e2eSeed.ts`; create `convex/e2eSeed.test.ts`
- Modify: `convex/e2ePrune.ts`, `convex/e2ePrune.test.ts`, `scripts/prune-e2e-data.mjs`
- Modify: `.github/workflows/deploy-v2.yml`, `CLAUDE.md`
- Create: `e2e/clue-ladder.spec.ts`

Steps 1–8 are for an implementer subagent. Step 9 runs the convex CLI, so the **controller** does it.

- [ ] **Step 1: Write the failing seed test** (`convex/e2eSeed.test.ts`)

```ts
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')
const today = toPuzzleDay(new Date())
const EMAIL = 'e2e+clue-seed@wordleteams.com'

beforeEach(() => {
  vi.stubEnv('E2E_TEST_MODE', 'true')
  vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
  vi.stubEnv('CLUE_LADDER_SEED', 'clue-ladder-test-secret-0123456789')
})
afterEach(() => vi.unstubAllEnvs())

describe('seedClueLadderFor', () => {
  test('opts the account’s own team in and returns today’s answer', async () => {
    const t = convexTest(schema, modules)
    const teamId = await t.mutation(api.e2eSeed.ensureTeamFor, { email: EMAIL })
    const { answer } = await t.mutation(api.e2eSeed.seedClueLadderFor, { email: EMAIL, today })
    await t.run(async (ctx) => {
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(true)
      expect((await ctx.db.get(teamId))?.clueLadderOnSince).toBe(today)
      const puzzle = await ctx.db
        .query('clueLadderPuzzles')
        .withIndex('by_date', (q) => q.eq('date', today))
        .first()
      expect(answer).toEqual(puzzle?.answer)
    })
  })

  test('refuses an address that is not e2e traffic', async () => {
    const t = convexTest(schema, modules)
    await expect(t.mutation(api.e2eSeed.seedClueLadderFor, { email: 'ada@example.test', today })).rejects.toThrow(
      /only available in E2E test mode/,
    )
  })
})
```

If `ensureTeamFor` does not return the team id, read it with `ctx.db.query('teams').collect()` instead and report it.

- [ ] **Step 2: Write the failing prune test.** In `convex/e2ePrune.test.ts`, add `clueLadderPlays: await ctx.db.query('clueLadderPlays').collect(),` to `census`, and append:

```ts
test('an e2e player’s clue ladder plays go with them; a real player’s stay', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const e2e = await ctx.db.insert('players', aPlayer({ email: E2E_ADDRESS }))
    const real = await ctx.db.insert('players', aPlayer({ email: REAL_ADDRESS }))
    const play = {
      cluesRevealed: 1,
      status: 'playing' as const,
      scratch: [null, null, null, null, null],
      startedAt: 1_760_000_000_000,
    }
    await ctx.db.insert('clueLadderPlays', { ...play, playerId: e2e, date: '2026-10-14' })
    await ctx.db.insert('clueLadderPlays', { ...play, playerId: e2e, date: '2026-10-15' })
    await ctx.db.insert('clueLadderPlays', { ...play, playerId: real, date: '2026-10-15' })
  })
  expect((await prune(t, false)).clueLadderPlaysDeleted).toBe(2)
  expect((await prune(t, true)).clueLadderPlaysDeleted).toBe(2)
  const left = await census(t)
  expect(left.clueLadderPlays).toHaveLength(1)
})
```

- [ ] **Step 3: Run both to verify they fail.** Run: `TZ=UTC pnpm exec vitest run convex/e2eSeed.test.ts convex/e2ePrune.test.ts > "$SCRATCH/s11.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 4: Implement the seed.** In `convex/e2eSeed.ts`, add imports:

```ts
import { requirePlausibleToday } from './access'
import { ensurePuzzleFor } from './clueLadder'
```

(and `e2eTeamLegacyId` is already imported from `./lib/e2e.ts`), then append:

```ts
/**
 * Opts an e2e account's own team into the clue ladder and returns today's
 * answer, so e2e/clue-ladder.spec.ts can lock in a known order. Lock-in is one
 * try, and a test that guessed would fail 119 times in 120. The puzzle is made
 * through ensurePuzzleFor, the same path start uses.
 *
 * RETURNING AN ANSWER IS WHY THE GUARD MATTERS. Guarded exactly like
 * ensureTeamFor: E2E_TEST_MODE must be 'true', which production never sets
 * (deploy-v2.yml checks), and the address must be e2e+*.
 *
 * Call ensureTeamFor first. The team is found the way ensureTeamFor finds it,
 * by the legacyId derived from the address.
 */
export const seedClueLadderFor = mutation({
  args: { email: v.string(), today: v.string() },
  handler: async (ctx, { email, today }) => {
    if (!isE2eTraffic(email, process.env.E2E_TEST_MODE)) {
      throw new Error('e2eSeed.seedClueLadderFor is only available in E2E test mode for e2e+* addresses')
    }
    const team = await ctx.db
      .query('teams')
      .withIndex('by_legacyId', (q) => q.eq('legacyId', e2eTeamLegacyId(email.toLowerCase())))
      .first()
    if (!team) throw new Error('e2eSeed.seedClueLadderFor: call ensureTeamFor first')
    const date = requirePlausibleToday(today)
    // On since today, as the owner's switch would record it (wordle-teams-k1v5).
    await ctx.db.patch(team._id, { clueLadderEnabled: true, clueLadderOnSince: date })
    const puzzle = await ensurePuzzleFor(ctx, date)
    return { answer: puzzle.answer }
  },
})
```

- [ ] **Step 5: Implement the prune.** In `convex/e2ePrune.ts`:
  - add `clueLadderPlaysDeleted: number` to `PruneBatchReport`, after `chatReadsDeleted: number`;
  - add `clueLadderPlaysDeleted: 0,` to the zeroed report, after `chatReadsDeleted: 0,`;
  - in the per-player loop, after the `chatReads` sweep and before the `PUBLIC LEAGUES` comment, add:

```ts
      // THE CLUE LADDER (wordle-teams-9j7o.2.3). by_player_and_date with only
      // the player bound is every play they made. Puzzles belong to no player
      // and stay.
      const plays = await ctx.db
        .query('clueLadderPlays')
        .withIndex('by_player_and_date', (q) => q.eq('playerId', player._id))
        .collect()
      report.clueLadderPlaysDeleted += plays.length
      if (execute) for (const row of plays) await ctx.db.delete(row._id)
```

  In `scripts/prune-e2e-data.mjs`, add `'clueLadderPlaysDeleted',` to `TOTAL_KEYS` after `'chatReadsDeleted',`.

- [ ] **Step 6: Run both to verify they pass.** Run the Step 3 command. Expected: exit 0.

- [ ] **Step 7: Switch the game on for CI's e2e backend.** In `.github/workflows/deploy-v2.yml`, after `pnpm exec convex env set LEAGUES_ENABLED true`:

```yaml
          # The clue ladder likewise; e2e/clue-ladder.spec.ts needs it lit, and a
          # seed so a puzzle can be made. A fixed, public value: this backend is
          # thrown away after the run. Production's seed is the owner's to set.
          pnpm exec convex env set CLUE_LADDER_ENABLED true
          pnpm exec convex env set CLUE_LADDER_SEED e2e-clue-ladder-seed-not-a-secret
```

In `CLAUDE.md`, replace:

```
That local backend must have `E2E_TEST_MODE`, `CHALLENGES_ENABLED` and
`LEAGUES_ENABLED` set to `true`, as CI sets them in `deploy-v2.yml`. Without the
last two, `challenge.spec.ts` and `leagues.spec.ts` fail at their first assertion.
```

with:

```
That local backend must have `E2E_TEST_MODE`, `CHALLENGES_ENABLED`,
`LEAGUES_ENABLED` and `CLUE_LADDER_ENABLED` set to `true`, and `CLUE_LADDER_SEED`
set to any string of 16 or more characters, as CI sets them in `deploy-v2.yml`.
Without them, `challenge.spec.ts`, `leagues.spec.ts` and `clue-ladder.spec.ts`
fail at their first assertion.
```

- [ ] **Step 8: Write the spec** (`e2e/clue-ladder.spec.ts`)

```ts
import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { toPuzzleDay } from '../convex/lib/puzzleDay.ts'
import { signIn } from './sign-in'

/**
 * THE CLUE LADDER, END TO END (wordle-teams-9j7o.2.3): an opted-in player opens
 * today's card, places the five shapes, locks in on clue 1, reads the result,
 * and finds the card saying so back on the dashboard.
 *
 * THE DEPLOYMENT MUST HAVE CLUE_LADDER_ENABLED AND CLUE_LADDER_SEED SET
 * (deploy-v2.yml does). Without them the card never appears and this fails at
 * its first assertion rather than passing vacuously.
 *
 * The answer comes from e2eSeed.seedClueLadderFor: lock-in is one try.
 */
const TIMEOUT = { timeout: 15_000 }

/** The first assertion after a navigation pays for it — see onboarding.spec.ts's DASHBOARD_READY. */
const DASHBOARD_READY = { timeout: 20_000 }

test('an opted-in player solves today’s clue ladder on clue 1', async ({ page }) => {
  const email = `e2e+clue-${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  const { answer } = await convex.mutation(api.e2eSeed.seedClueLadderFor, { email, today: toPuzzleDay(new Date()) })
  await signIn(page, email)

  const card = page.getByRole('region', { name: "Today's clue ladder" })
  await expect(card).toBeVisible(DASHBOARD_READY)
  await card.getByRole('link', { name: 'Play' }).click()
  await expect(page).toHaveURL(/\/play\/clue-ladder/, TIMEOUT)
  await expect(page.getByRole('list', { name: 'Clues' }).getByRole('listitem')).toHaveCount(1, TIMEOUT)

  const tray = page.getByRole('group', { name: 'Shapes to place' })
  for (const [i, shape] of answer.entries()) {
    await tray.getByRole('button', { name: shape, exact: true }).click()
    await page.getByRole('button', { name: `Slot ${i + 1}, empty` }).click()
  }
  await page.getByRole('button', { name: 'Lock in' }).click()
  await page.getByRole('button', { name: 'Yes, lock in' }).click()
  await expect(page.getByRole('heading', { name: 'Solved on clue 1' })).toBeVisible(TIMEOUT)

  await page.getByRole('link', { name: 'Back to team scores' }).click()
  await expect(page.getByRole('region', { name: "Today's clue ladder" })).toContainText('Solved on clue 1', DASHBOARD_READY)
})
```

Commit Steps 1–8 now (the gates do not run e2e):

```bash
git add convex/e2eSeed.ts convex/e2eSeed.test.ts convex/e2ePrune.ts convex/e2ePrune.test.ts scripts/prune-e2e-data.mjs .github/workflows/deploy-v2.yml CLAUDE.md e2e/clue-ladder.spec.ts
git commit -F - <<'EOF'
test(clue-ladder): e2e happy path, its seed, and its CI switches

The e2e prune deletes e2e players' clue ladder plays too.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
```

- [ ] **Step 9 (controller only): Run the spec against a local backend.** e2e is not one of the four gates. The full suite takes about 11 minutes, so run in the background and wait on the log, not on the process name. Make sure nothing stale is serving on :3000 first.

```bash
printf 'CONVEX_DEPLOYMENT=anonymous:anonymous-v2\n' > "$SCRATCH/local-convex.env"
pnpm exec convex env set CLUE_LADDER_ENABLED true --env-file "$SCRATCH/local-convex.env"
pnpm exec convex env set CLUE_LADDER_SEED e2e-clue-ladder-seed-not-a-secret --env-file "$SCRATCH/local-convex.env"
pnpm e2e e2e/clue-ladder.spec.ts > "$SCRATCH/e2e-clue.log" 2>&1; echo "exit $?"
```

Expected: exit 0, `1 passed`. Then run the full suite in the background (`pnpm e2e > "$SCRATCH/e2e-all.log" 2>&1`) and read its summary when it finishes. Expected: no new failures against the last green run.

- [ ] **Step 10: Close the issue.**

```bash
bd close wordle-teams-9j7o.2.3.2.15
bd export -o .beads/issues.jsonl
git add .beads/issues.jsonl
git commit -F - <<'EOF' || git commit -F - <<'EOF2'
chore(clue-ladder): e2e recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
chore(clue-ladder): e2e recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF2
```

---

### Task 16: Gates and record

**Files:** none changed unless a gate fails.

**Launch, for the owner (not part of this plan's execution).** In this order:
1. A one-line commit that sets `CLUE_LADDER_DAY_ONE` in `src/lib/clue-ladder-share.ts` to the production launch day. It reaches `main` by PR and is deployed.
2. Set `CLUE_LADDER_SEED` in production: a secret of 16 or more characters.
3. Set `CLUE_LADDER_ENABLED=true` in production.
4. Turn the game on for the owner's own team. This records `clueLadderOnSince`.

Step 1 comes first because the share number counts from that day, and the first share happens as soon as step 3 is done.

- [ ] **Step 1: Run all four gates separately.**

```bash
TZ=UTC pnpm test:once > "$SCRATCH/t.log" 2>&1; echo "test $?"
pnpm typecheck > "$SCRATCH/tc.log" 2>&1; echo "tc $?"
pnpm lint > "$SCRATCH/l.log" 2>&1; echo "lint $?"
pnpm build > "$SCRATCH/b.log" 2>&1; echo "build $?"
```

Expected: all four print `0`. If one fails, read its log, fix the cause in the task that introduced it, and rerun all four.

- [ ] **Step 2: Record.**

```bash
bd close wordle-teams-9j7o.2.3.2.16
bd update wordle-teams-9j7o.2.3 --append-notes "$(cat <<'EOF'
Plan 3 (clue ladder) done: clueLadderPuzzles made once per date from HMAC-SHA256(CLUE_LADDER_SEED, date), big-endian, golden-pinned; today/start/nextClue/saveScratch/lockIn through writePlayFor (refuses passed dates, clue counts outside 1..6); ALREADY_FINISHED and INVALID_ORDER with copy; /play/clue-ladder; dashboard card for opted-in teams; clue text in words; scoreboard counts from teams.clueLadderOnSince (wordle-teams-k1v5); finished screen lists six orders at most; share line with #N from CLUE_LADDER_DAY_ONE; e2e happy path green. Rollout, in this order: (1) a one-line commit setting CLUE_LADDER_DAY_ONE in src/lib/clue-ladder-share.ts to the production launch day, merged to main by PR and deployed; (2) owner sets CLUE_LADDER_SEED (16+ chars, secret) in production; (3) owner sets CLUE_LADDER_ENABLED=true in production; (4) owner opts their own team in, which records clueLadderOnSince.
EOF
)"
bd close wordle-teams-9j7o.2.3.2
bd export -o .beads/issues.jsonl
```

- [ ] **Step 3: Commit and push.**

```bash
git add .beads/issues.jsonl
git commit -F - <<'EOF'
chore(clue-ladder): clue ladder recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016GjdyRECA5qXUFmDsVbTan
EOF
git pull --rebase && git push
```

Before pushing, confirm both closes landed: `git show HEAD:.beads/issues.jsonl` must record `wordle-teams-9j7o.2.3.2.16` and `wordle-teams-9j7o.2.3.2` as closed. If not, re-export and `git add .beads/issues.jsonl && git commit --amend --no-edit`, then push. Never amend a pushed commit.

---

## Self-review

**Spec and decision coverage.**
- **Section 3:**
  - generation from a seed plus a secret (Task 3);
  - storage with `remaining` and `generatorVersion` (Task 4);
  - a puzzle is created on first request, and only for plausible dates (Tasks 4–5);
  - the ladder length stays hidden (Task 5's `todayFor`, Task 6's `noMoreClues`, Task 12's `exhausted`).
- **Section 4:**
  - the five functions (Tasks 5–6), with an idempotent start;
  - a double tap on Next clue reveals one clue (Task 6);
  - one lock-in only;
  - a stale play reads as X (plan 1, with Task 5's guard against rewriting it);
  - progress kept on the server (scratch, through Task 10's saver);
  - the error codes (Task 1).
- **Section 6:**
  - the dashboard card (Task 14);
  - the play page with a back link (Task 13);
  - Lock in's one confirm, wired to the house pattern, and the finished screen (plan 2, mounted in Task 12);
  - the share line and `#N` (Task 10).
- **Section 8:**
  - generator determinism over dates (Task 3);
  - server tests for no leak while playing, one lock-in, opt-in and the switch, past dates, and each error code (Tasks 4–6);
  - one Playwright happy path, with `CLUE_LADDER_ENABLED` in `deploy-v2.yml` and `CLAUDE.md` (Task 15).
- **Owner decisions of 2026-10-15:**
  1. counting from the day the team turned the game on (Tasks 7–8; the e2e seed sets the day in Task 15). As adjusted: an empty day before it is blank and scores nothing, and a result always counts. Task 8's tests cover a result before the day, an empty day before it, and an empty past day on or after it. Task 7 adds the help-text sentence and a test for it;
  2. day one stays a constant, set at launch (Task 10's comment, Task 16's launch steps);
  3. clue text in words (Task 2, before the golden snapshot is written in Task 3);
  4. at most six listed orders (Task 11).
- **Carry-forwards from plan 1:** all eight, at the tasks listed in the table at the top.

**Placeholders.** The only placeholders are the Beads ids, which are created at approval. Three notes say "if X differs, do Y and report", in Tasks 4, 8 and 15:
- whether a Convex validator exposes `members` and `value`;
- whether `useHydrated` has flipped by the time a jsdom assertion runs (expected yes: RTL's `render` flushes effects);
- what `ensureTeamFor` returns.

Each is a fact that can't be confirmed without running code.

**Type consistency.**
- `ClueLadderTodayView` is derived from `api.clueLadder.today`. `todayFor`'s four shapes feed `cardPlayOf` (Task 10), `ClueLadderPlayView` (Task 12) and plan 2's committed `ClueLadderFinished`, through `result: { status, lockedAtClue, lockedOrder }`. `'timedOut'` never comes from `today`.
- `ClueLadderCard` takes `renderLink` (plan 2's committed card); Task 14 passes a `<Link>`, and Task 15 clicks the link named `Play`.
- `Slots` comes from plan 2's `clue-ladder-board.ts`, and the saver, the view and the page all use it.
- `PlayWrite.scratch` (`(Shape | null)[]`) matches the plays table's `scratch` validator.
- `setTeamClueLadderFor(ctx, playerId, teamId, enabled, today)` has five arguments everywhere: Task 7's tests, Task 9's gap test, and the mutation. `teams.clueLadderOnSince` → `countsFrom` (server) → `countsFrom` (ScoresGrid prop) → `fromDay` (`monthTotal`).
- `clueText` (Task 2) is what `todayFor` sends, the golden snapshot pins, and Task 12's fixtures imitate. Its sentences say "somewhere" for left of, right of and between; Task 12's two fixture clues ("at one end", "not in the third slot") need no "somewhere".
