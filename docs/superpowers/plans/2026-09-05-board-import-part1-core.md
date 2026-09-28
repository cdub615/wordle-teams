# Board Import, Part 1 — the risk spike and the correctness core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether grid detection is viable on real screenshots, and build the pure-logic core that turns noisy tile readings into certain words.

**Architecture:** The parser is split so that everything except grid-finding is pure logic over plain data. `feedbackFor` reproduces Wordle's colouring rules; `resolveRow`/`resolveBoard` use those rules plus the accepted-guess list to repair OCR noise into exactly one word per row. None of it touches an image, a DOM or a network, so all of it is testable in this repo's existing `edge-runtime` vitest environment.

**Tech Stack:** TypeScript, vitest (`edge-runtime`), pnpm. `sharp` as a dev-only dependency for the throwaway spike in Task 1.

**Spec:** `docs/superpowers/specs/2026-09-05-pro-tier-and-insights-design.md`, section 2.
**Epic:** `wordle-teams-418`.

---

## Why this plan stops where it stops

The spec names Stage 1 (grid detection) as the only part of board import carrying real risk, and says the epic "should not be fully planned until that risk is measured." So this plan covers **Task 1, the measurement**, and then the four pieces that are *independent of the outcome* — they are pure logic and would be built identically whether Stage 1 turns out easy or hard.

Stages 1–3 proper (lattice fitting, colour clustering, glyph matching), the browser adapter and the confirm-before-save UI are **Part 2**, planned after Task 1 reports.

## File structure

| File | Responsibility |
| --- | --- |
| `v2/scripts/spike-lattice.mjs` | **Throwaway.** Task 1 only. Deleted at the end of Task 1. |
| `v2/scripts/fetch-wordlists.mjs` | One-off fetch + validation, writes the checked-in artifact |
| `v2/src/lib/board-import/data/accepted-guesses.json` | Generated. The word list. Never hand-edited. |
| `v2/src/lib/board-import/types.ts` | `Mark`, `LetterScores`, `RowObservation` |
| `v2/src/lib/board-import/feedback.ts` | Wordle's colouring rules, including duplicate letters |
| `v2/src/lib/board-import/wordlist.ts` | Loads and normalises the artifact |
| `v2/src/lib/board-import/repair.ts` | `resolveRow`, `resolveBoard` — Stage 4 |

Each is one responsibility and each is separately testable. `repair.ts` imports
`feedback.ts` and nothing else — the word list arrives as a parameter, so the
repair logic can be tested against a five-word fixture instead of 12972 entries,
and the caller decides which list to use. `wordlist.ts` is wired in by the
caller in Part 2.

---

### Task 1: SPIKE — is grid detection viable?

**This task is not TDD and produces no shipped code.** Its deliverable is a number recorded on `wordle-teams-418`. Everything it writes is deleted in the last step.

**Files:**
- Create: `v2/scripts/spike-lattice.mjs` (throwaway)
- Create: `v2/spike-shots/` (throwaway, gitignored)

- [ ] **Step 1: Collect the corpus by hand**

Ask the owner for **at least 20 real screenshots** of finished Wordle boards, saved into `v2/spike-shots/`. The set must include, and the spike is not valid without them:

- light mode and dark mode
- iOS and Android
- the NYT app and the web version
- at least three deliberately awkward ones: a partial crop, one including a status bar, and a screenshot of a screenshot

- [ ] **Step 2: Add the dev-only decoder**

```bash
cd v2 && pnpm add -D sharp
```

- [ ] **Step 3: Write the spike**

Create `v2/scripts/spike-lattice.mjs`:

```js
// THROWAWAY. Task 1 of docs/superpowers/plans/2026-09-05-board-import-part1-core.md.
// Answers one question — can we find the 5-wide tile lattice in a real
// screenshot — and is deleted once the answer is recorded on wordle-teams-418.
import { readdir } from 'node:fs/promises'
import sharp from 'sharp'

const DIR = new URL('../spike-shots/', import.meta.url)

// Quantise hard. We are looking for large flat regions, not colour fidelity.
const bucket = (v) => Math.round(v / 32) * 32
const key = (r, g, b) => `${bucket(r)},${bucket(g)},${bucket(b)}`

async function runsFor(path) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info

  // Horizontal run-length encode every row. A tile row shows up as several
  // long runs of one colour at a regular pitch — that is the whole signal.
  const runsByRow = []
  for (let y = 0; y < height; y++) {
    const runs = []
    let start = 0
    let prev = null
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      const k = key(data[i], data[i + 1], data[i + 2])
      if (k !== prev) {
        if (prev !== null && x - start > width * 0.02) runs.push({ start, end: x, colour: prev })
        start = x
        prev = k
      }
    }
    if (prev !== null && width - start > width * 0.02) runs.push({ start, end: width, colour: prev })
    runsByRow.push(runs)
  }
  return { runsByRow, width, height }
}

// A candidate tile row: five runs of near-equal width at a near-constant pitch.
function fiveWideRow(runs) {
  for (let i = 0; i + 5 <= runs.length; i++) {
    const five = runs.slice(i, i + 5)
    const widths = five.map((r) => r.end - r.start)
    const pitches = five.slice(1).map((r, j) => r.start - five[j].start)
    const spread = (xs) => (Math.max(...xs) - Math.min(...xs)) / Math.max(...xs)
    if (spread(widths) < 0.15 && spread(pitches) < 0.15) return five
  }
  return null
}

const files = (await readdir(DIR)).filter((f) => /\.(png|jpe?g)$/i.test(f))
let hit = 0
for (const file of files) {
  const { runsByRow } = await runsFor(new URL(file, DIR))
  const rowsWithFive = runsByRow.filter((runs) => fiveWideRow(runs) !== null).length
  // A real board gives MANY scanlines through each of its rows, so a genuine
  // detection is hundreds of hits, not one. One hit is noise.
  const found = rowsWithFive > 40
  if (found) hit++
  console.log(`${found ? 'OK  ' : 'MISS'}  ${file}  (${rowsWithFive} five-wide scanlines)`)
}
console.log(`\n${hit}/${files.length} detected`)
```

- [ ] **Step 4: Run it and read the result**

Run: `cd v2 && node scripts/spike-lattice.mjs`
Expected: one line per screenshot, then a hit count.

**The bar: at least 18 of 20, with at least one hit in every category from Step 1.** A category that misses entirely is a structural failure, not a tuning problem, even if the overall count passes.

- [ ] **Step 5: Record the measurement on the epic**

```bash
bd update wordle-teams-418 --notes "$(cat <<'NOTE'
STAGE 1 SPIKE, <DATE>. <HIT>/<TOTAL> screenshots detected.
By category: light <n/n>, dark <n/n>, iOS <n/n>, Android <n/n>, app <n/n>,
web <n/n>, awkward <n/n>.
VERDICT: <GO - plan Part 2 as specced | NO-GO - see below>.
What missed and why: <one line per miss>.
NOTE
)"
```

Replace every placeholder with the real figures. **If the bar is not met, stop and report to the owner** — the spec's whole client-side approach rests on this, and a different answer changes the design, not just the plan.

- [ ] **Step 6: Delete the spike**

```bash
cd v2 && rm scripts/spike-lattice.mjs && rm -rf spike-shots && pnpm remove sharp
cd /home/cdub/projects/wordle-teams && git add -A
git commit -m "chore(spike): lattice detection measured, throwaway removed"
```

Nothing from this task ships. The measurement lives on the epic.

---

### Task 2: `feedback.ts` — Wordle's colouring rules

**Files:**
- Create: `v2/src/lib/board-import/types.ts`
- Create: `v2/src/lib/board-import/feedback.ts`
- Test: `v2/src/lib/board-import/feedback.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/board-import/feedback.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { feedbackFor } from './feedback.ts'

describe('feedbackFor', () => {
  it('marks an exact match all correct', () => {
    expect(feedbackFor('CRANE', 'CRANE')).toEqual([
      'correct', 'correct', 'correct', 'correct', 'correct',
    ])
  })

  it('marks a letter in the wrong place as present', () => {
    expect(feedbackFor('CRANE', 'NACRE')).toEqual([
      'present', 'present', 'present', 'present', 'correct',
    ])
  })

  // THE DUPLICATE-LETTER RULE, which is where every naive implementation is
  // wrong. SPEED has two Es and ERASE has two, so both Es are paid for.
  it('gives a present mark to each duplicate the answer can pay for', () => {
    expect(feedbackFor('SPEED', 'ERASE')).toEqual([
      'present', 'absent', 'present', 'present', 'absent',
    ])
  })

  // AND THE OTHER HALF OF IT: a green LATER in the word must not be starved by
  // a yellow EARLIER in it. One-pass implementations mark the first E yellow
  // and then have nothing left for the last E, which is green.
  it('lets a later correct letter claim the count before an earlier one', () => {
    expect(feedbackFor('EERIE', 'THREE')).toEqual([
      'present', 'absent', 'correct', 'absent', 'correct',
    ])
  })

  it('is case insensitive on both sides', () => {
    expect(feedbackFor('crane', 'CRANE')).toEqual(feedbackFor('CRANE', 'crane'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/lib/board-import/feedback.test.ts`
Expected: FAIL — `Failed to load .../feedback.ts`

- [ ] **Step 3: Write the types**

Create `v2/src/lib/board-import/types.ts`:

```ts
/**
 * Shared vocabulary for board import. Deliberately plain data: nothing in here
 * references an image, a DOM node or a Convex document, which is what lets the
 * whole correctness core be tested in this repo's edge-runtime vitest
 * environment (see vitest.config.ts — there is no DOM and no canvas).
 */

/**
 * What a tile's colour MEANS. Named for meaning, never for the colour itself:
 * high-contrast mode paints "correct" blue and "present" orange, so a type
 * called `green` would be a lie on a real player's screenshot.
 */
export type Mark = 'absent' | 'present' | 'correct'

/**
 * What the glyph reader thinks a single tile says: a confidence in 0..1 for
 * each letter it considered. Sparse on purpose — a reader that is sure returns
 * one entry, a reader that is torn returns several. Letters not mentioned
 * score 0.
 */
export type LetterScores = Readonly<Record<string, number>>

/** One row of the board as OBSERVED, before any repair. */
export type RowObservation = {
  readonly letters: ReadonlyArray<LetterScores>
  readonly marks: ReadonlyArray<Mark>
}
```

- [ ] **Step 4: Write the implementation**

Create `v2/src/lib/board-import/feedback.ts`:

```ts
import type { Mark } from './types.ts'

/**
 * Wordle's colouring rules, reproduced exactly.
 *
 * This is the constraint that makes board import accurate rather than merely
 * plausible: a candidate word is admissible only if colouring it against the
 * answer reproduces the marks we read off the screenshot. See repair.ts.
 *
 * TWO PASSES, AND THE ORDER IS THE WHOLE ALGORITHM. Greens are claimed first
 * and remove their letter from the pool; only then are yellows handed out from
 * what is left. A single pass marks an early duplicate yellow and then has
 * nothing left for a later green, which is the classic wrong answer.
 */
export function feedbackFor(guess: string, answer: string): Array<Mark> {
  const g = guess.toUpperCase()
  const a = answer.toUpperCase()
  const marks: Array<Mark> = Array.from({ length: g.length }, () => 'absent')

  // Pass one: greens, and count what the answer has left over afterwards.
  const remaining = new Map<string, number>()
  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) marks[i] = 'correct'
    else remaining.set(a[i], (remaining.get(a[i]) ?? 0) + 1)
  }

  // Pass two: yellows, paid for out of the remainder, left to right.
  for (let i = 0; i < g.length; i++) {
    if (marks[i] === 'correct') continue
    const left = remaining.get(g[i]) ?? 0
    if (left > 0) {
      marks[i] = 'present'
      remaining.set(g[i], left - 1)
    }
  }

  return marks
}

/** Marks compare by value; there is no shared identity to lean on. */
export function marksEqual(a: ReadonlyArray<Mark>, b: ReadonlyArray<Mark>): boolean {
  return a.length === b.length && a.every((mark, i) => mark === b[i])
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run src/lib/board-import/feedback.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Prove the tests are not vacuous**

Break the implementation deliberately and confirm the suite catches it: in pass one, run the `remaining.set(...)` line unconditionally so greens also add to the pool. Re-run and confirm the two duplicate tests FAIL. Then revert.

This repo has caught a vacuous assertion this way before. A test that has never been seen to fail is not evidence.

- [ ] **Step 7: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/lib/board-import/types.ts v2/src/lib/board-import/feedback.ts v2/src/lib/board-import/feedback.test.ts
git commit -m "feat(board-import): Wordle colouring rules, duplicates included"
```

---

### Task 3: the accepted-guess list

**Files:**
- Create: `v2/scripts/fetch-wordlists.mjs`
- Create: `v2/src/lib/board-import/data/accepted-guesses.json` (generated)
- Create: `v2/src/lib/board-import/wordlist.ts`
- Test: `v2/src/lib/board-import/wordlist.test.ts`

- [ ] **Step 1: Write the fetch script**

Create `v2/scripts/fetch-wordlists.mjs`:

```js
#!/usr/bin/env node
/**
 * Fetches the Wordle word lists ONCE and writes a checked-in artifact, so that
 * builds and CI never touch the network for them.
 *
 * SOURCES, both cfreshman's gists of the pre-acquisition source lists:
 *   answers (2315)             a03ef2cba789d8cf00c08f767e0fad7b
 *   additional guesses (10657) cdcdf777450c5b5301e439061d29694c
 * Union = 12972, the original accepted-guess set.
 *
 * THE LIST IS KNOWINGLY INCOMPLETE AND THAT IS RECORDED RATHER THAN HIDDEN.
 * These are the PRE-NYT lists. NYT has edited the accepted set since — the
 * FiveLetterWords benchmark corpus counts 14855 — so a word a player
 * legitimately guessed today can be missing here. repair.ts must therefore
 * treat "no candidate" as an ordinary outcome that falls back to manual entry,
 * never as a bug. Stage 5's correction log is what will surface the gaps.
 *
 * VALIDATES BEFORE WRITING. A gist that has moved or been reformatted must fail
 * loudly here rather than silently produce a shorter list, which would degrade
 * parse accuracy in a way nobody could see.
 */
import { writeFile, mkdir } from 'node:fs/promises'

const GISTS = {
  answers: 'a03ef2cba789d8cf00c08f767e0fad7b',
  additional: 'cdcdf777450c5b5301e439061d29694c',
}

async function fetchList(id) {
  const res = await fetch(`https://gist.githubusercontent.com/cfreshman/${id}/raw`)
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`)
  const words = (await res.text())
    .split('\n')
    .map((w) => w.trim().toUpperCase())
    .filter((w) => w.length > 0)

  const bad = words.filter((w) => !/^[A-Z]{5}$/.test(w))
  if (bad.length > 0) throw new Error(`${id}: ${bad.length} malformed, e.g. ${bad[0]}`)
  if (words.length < 2000) throw new Error(`${id}: only ${words.length} words — source changed?`)
  return words
}

const answers = await fetchList(GISTS.answers)
const additional = await fetchList(GISTS.additional)
const accepted = [...new Set([...answers, ...additional])].sort()

if (accepted.length < 12000) {
  throw new Error(`union is only ${accepted.length} — expected ~12972`)
}

const dir = new URL('../src/lib/board-import/data/', import.meta.url)
await mkdir(dir, { recursive: true })
await writeFile(new URL('accepted-guesses.json', dir), JSON.stringify(accepted))
await writeFile(new URL('answers.json', dir), JSON.stringify([...answers].sort()))

console.log(`answers ${answers.length}, additional ${additional.length}, accepted ${accepted.length}`)
```

- [ ] **Step 2: Run it**

Run: `cd v2 && node scripts/fetch-wordlists.mjs`
Expected: `answers 2315, additional 10657, accepted 12972`

If the numbers differ, the sources have changed. Record the new numbers on `wordle-teams-418` rather than editing the thresholds to match them.

- [ ] **Step 3: Write the failing test**

Create `v2/src/lib/board-import/wordlist.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { acceptedGuesses, isAccepted } from './wordlist.ts'

describe('the accepted-guess list', () => {
  it('holds the full pre-NYT accepted set', () => {
    expect(acceptedGuesses().length).toBeGreaterThan(12000)
  })

  it('is uppercase, five letters, and sorted', () => {
    const words = acceptedGuesses()
    expect(words.every((w) => /^[A-Z]{5}$/.test(w))).toBe(true)
    expect([...words].sort()).toEqual([...words])
  })

  it('accepts a known answer and a known non-answer guess', () => {
    expect(isAccepted('CRANE')).toBe(true)
    expect(isAccepted('AAHED')).toBe(true)
  })

  it('rejects a non-word and is case insensitive', () => {
    expect(isAccepted('ZZZZZ')).toBe(false)
    expect(isAccepted('crane')).toBe(true)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/lib/board-import/wordlist.test.ts`
Expected: FAIL — `Failed to load .../wordlist.ts`

- [ ] **Step 5: Write the implementation**

Create `v2/src/lib/board-import/wordlist.ts`:

```ts
import accepted from './data/accepted-guesses.json'

/**
 * The accepted-guess list, as a frozen array and a Set.
 *
 * A JSON import rather than a `?raw` text import or a generated .ts module:
 * JSON is handled natively by both vite and vitest with no bundler feature to
 * depend on, and it keeps a 12972-entry generated file out of the lint and
 * typecheck paths.
 *
 * Generated by scripts/fetch-wordlists.mjs. Do not hand-edit; see that file for
 * why the list is knowingly incomplete relative to today's NYT set.
 */
const WORDS: ReadonlyArray<string> = Object.freeze(accepted as Array<string>)
const LOOKUP = new Set(WORDS)

export function acceptedGuesses(): ReadonlyArray<string> {
  return WORDS
}

export function isAccepted(word: string): boolean {
  return LOOKUP.has(word.toUpperCase())
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run src/lib/board-import/wordlist.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/scripts/fetch-wordlists.mjs v2/src/lib/board-import/data v2/src/lib/board-import/wordlist.ts v2/src/lib/board-import/wordlist.test.ts
git commit -m "feat(board-import): checked-in accepted-guess list with a validating fetcher"
```

---

### Task 4: `resolveRow` — repairing one row

**Files:**
- Create: `v2/src/lib/board-import/repair.ts`
- Test: `v2/src/lib/board-import/repair.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/board-import/repair.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveRow } from './repair.ts'
import type { LetterScores, Mark, RowObservation } from './types.ts'

/** A tile the reader is certain about. */
const sure = (letter: string): LetterScores => ({ [letter]: 1 })

/** A tile the reader is torn between two letters, `first` slightly favoured. */
const torn = (first: string, second: string): LetterScores => ({ [first]: 0.55, [second]: 0.45 })

const row = (letters: Array<LetterScores>, marks: Array<Mark>): RowObservation => ({ letters, marks })

const ALL_CORRECT: Array<Mark> = ['correct', 'correct', 'correct', 'correct', 'correct']
const ALL_ABSENT: Array<Mark> = ['absent', 'absent', 'absent', 'absent', 'absent']

const WORDS = ['CRANE', 'CRANK', 'ERASE', 'SPEED', 'TRACE']

describe('resolveRow', () => {
  it('returns the word the reader was already sure of', () => {
    const observed = row(['C', 'R', 'A', 'N', 'E'].map(sure), ALL_CORRECT)
    expect(resolveRow(observed, WORDS, 'CRANE')).toMatchObject({ ok: true, word: 'CRANE' })
  })

  // THE POINT OF THE WHOLE STAGE: the reader PREFERRED K, and the colours say
  // it cannot be K, so the constraint overrules the pixels.
  it('overrules a confident misread when the colours forbid it', () => {
    const observed = row([sure('C'), sure('R'), sure('A'), sure('N'), torn('K', 'E')], ALL_CORRECT)
    expect(resolveRow(observed, WORDS, 'CRANE')).toMatchObject({ ok: true, word: 'CRANE' })
  })

  it('reports failure rather than guessing when nothing fits', () => {
    const observed = row(['Z', 'Z', 'Z', 'Z', 'Z'].map(sure), ALL_ABSENT)
    expect(resolveRow(observed, WORDS, 'CRANE')).toEqual({ ok: false, reason: 'no-candidate' })
  })

  // Without an answer the colours cannot be checked, so only the word list and
  // the reader's own confidence are left. It must still pick, and pick sanely.
  it('falls back to the reader when no answer is known', () => {
    const observed = row(['T', 'R', 'A', 'C', 'E'].map(sure), ALL_ABSENT)
    expect(resolveRow(observed, WORDS, null)).toMatchObject({ ok: true, word: 'TRACE' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/lib/board-import/repair.test.ts`
Expected: FAIL — `Failed to load .../repair.ts`

- [ ] **Step 3: Write the implementation**

Create `v2/src/lib/board-import/repair.ts`:

```ts
import { feedbackFor, marksEqual } from './feedback.ts'
import type { RowObservation } from './types.ts'

export type RowResolution =
  | { ok: true; word: string; score: number }
  | { ok: false; reason: 'no-candidate' }

/**
 * Turns one noisy row into one certain word — Stage 4 of the spec.
 *
 * WHY THIS IS ACCURATE WHERE GENERAL OCR IS NOT. Two constraints that ordinary
 * text recognition does not have:
 *
 *   1. the row must be a word in the accepted-guess list, and
 *   2. colouring that word against the answer must reproduce the marks we read.
 *
 * Together those usually leave exactly one admissible word, so a shaky glyph is
 * repaired rather than propagated. The reader's confidence is then only a
 * tie-breaker AMONG words that already satisfy both constraints — which is why
 * a confident misread still loses to the colours.
 *
 * NO ANSWER IS AN ORDINARY CASE, not an error: it happens on a board the player
 * failed. Constraint 2 is simply unavailable and constraint 1 carries the row
 * alone, which is weaker — and is why the caller must still show the parse for
 * confirmation rather than saving it.
 *
 * A LINEAR SCAN OF ~13k WORDS IS THE RIGHT IMPLEMENTATION. It runs once per row
 * on a user gesture; an index would be complexity bought with nothing.
 */
export function resolveRow(
  observation: RowObservation,
  words: ReadonlyArray<string>,
  answer: string | null,
): RowResolution {
  let best: { word: string; score: number } | null = null

  for (const word of words) {
    if (word.length !== observation.letters.length) continue
    if (answer !== null && !marksEqual(feedbackFor(word, answer), observation.marks)) continue

    let score = 0
    for (let i = 0; i < word.length; i++) {
      score += observation.letters[i][word[i]] ?? 0
    }

    // Strictly greater, so a tie keeps the earlier word and the result is
    // stable under a re-sort of the list.
    if (best === null || score > best.score) best = { word, score }
  }

  return best === null ? { ok: false, reason: 'no-candidate' } : { ok: true, ...best }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run src/lib/board-import/repair.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the constraint is load-bearing**

Delete the `if (answer !== null && ...) continue` line, re-run, and confirm "overrules a confident misread" FAILS. Then revert.

If it still passes, that test is proving nothing and must be strengthened before moving on.

- [ ] **Step 6: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/lib/board-import/repair.ts v2/src/lib/board-import/repair.test.ts
git commit -m "feat(board-import): constraint repair for one row"
```

---

### Task 5: `resolveBoard` — deriving the answer, then repairing every row

**Files:**
- Modify: `v2/src/lib/board-import/repair.ts`
- Modify: `v2/src/lib/board-import/repair.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/src/lib/board-import/repair.test.ts`, and add `resolveBoard` to the existing import from `./repair.ts`:

```ts
describe('resolveBoard', () => {
  // The winning row IS the answer, but we cannot know it until we have read it —
  // so it is resolved first WITHOUT the colour constraint, and its result then
  // supplies the constraint for every other row.
  it('derives the answer from an all-correct final row', () => {
    const result = resolveBoard(
      [
        row(
          ['T', 'R', 'A', 'C', 'E'].map(sure),
          ['absent', 'correct', 'correct', 'present', 'correct'],
        ),
        row(['C', 'R', 'A', 'N', 'E'].map(sure), ALL_CORRECT),
      ],
      WORDS,
      null,
    )
    expect(result).toMatchObject({ ok: true, answer: 'CRANE', words: ['TRACE', 'CRANE'] })
  })

  it('prefers a supplied answer over deriving one', () => {
    const result = resolveBoard(
      [row(['C', 'R', 'A', 'N', 'E'].map(sure), ALL_CORRECT)],
      WORDS,
      'crane',
    )
    expect(result).toMatchObject({ ok: true, answer: 'CRANE' })
  })

  // A failed board: no row is all-correct, so no answer can be derived and the
  // word list carries every row alone. This must still succeed.
  it('resolves a failed board with no answer at all', () => {
    const result = resolveBoard(
      [row(['S', 'P', 'E', 'E', 'D'].map(sure), ALL_ABSENT)],
      WORDS,
      null,
    )
    expect(result).toMatchObject({ ok: true, answer: null, words: ['SPEED'] })
  })

  it('names the row that failed rather than failing the board silently', () => {
    const result = resolveBoard(
      [
        row(['C', 'R', 'A', 'N', 'E'].map(sure), ALL_CORRECT),
        row(['Z', 'Z', 'Z', 'Z', 'Z'].map(sure), ['present', 'present', 'present', 'present', 'present']),
      ],
      WORDS,
      null,
    )
    expect(result).toEqual({ ok: false, reason: 'no-candidate', rowIndex: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/lib/board-import/repair.test.ts`
Expected: FAIL — `resolveBoard is not a function`

- [ ] **Step 3: Write the implementation**

Append to `v2/src/lib/board-import/repair.ts`:

```ts
export type BoardResolution =
  | { ok: true; answer: string | null; words: Array<string> }
  | { ok: false; reason: 'no-candidate'; rowIndex: number }

/**
 * Resolves a whole board, deriving the answer first when it is not supplied.
 *
 * THE ANSWER IS CIRCULAR, AND THE TWO PASSES ARE HOW THAT IS BROKEN. A solved
 * board's winning row IS the answer, but reading it wants the answer as a
 * constraint. So: resolve the all-correct row under constraint 1 alone, take
 * the word it yields as the answer, then resolve every row — that one included
 * — under both constraints.
 *
 * WHERE THE ANSWER COMES FROM, in the order the spec sets out: the caller's
 * value if it has one (the entry form already asks the player for it); else the
 * all-correct row; else nothing, and the board resolves on the word list alone.
 * That last case is the failed board, and it is ordinary rather than an error.
 */
export function resolveBoard(
  rows: ReadonlyArray<RowObservation>,
  words: ReadonlyArray<string>,
  suppliedAnswer: string | null,
): BoardResolution {
  let answer = suppliedAnswer === null ? null : suppliedAnswer.toUpperCase()

  if (answer === null) {
    const winning = rows.findIndex((r) => r.marks.every((mark) => mark === 'correct'))
    if (winning !== -1) {
      const derived = resolveRow(rows[winning], words, null)
      // A winning row we cannot read is a failure THERE, reported against that
      // row — not a silent fall back to answerless mode, which would resolve
      // the rest of the board under a weaker constraint and hide the problem.
      if (!derived.ok) return { ok: false, reason: 'no-candidate', rowIndex: winning }
      answer = derived.word
    }
  }

  const resolved: Array<string> = []
  for (let i = 0; i < rows.length; i++) {
    const row = resolveRow(rows[i], words, answer)
    if (!row.ok) return { ok: false, reason: 'no-candidate', rowIndex: i }
    resolved.push(row.word)
  }

  return { ok: true, answer, words: resolved }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run src/lib/board-import/repair.test.ts`
Expected: PASS, 8 tests across the two describes.

- [ ] **Step 5: Run all four gates**

```bash
cd v2 && pnpm test:once
cd v2 && pnpm lint
cd v2 && pnpm typecheck
cd v2 && pnpm build
```

Run them as four separate commands and read each exit status yourself. **Do not pipe them and read `PIPESTATUS`** — this shell is zsh, where `PIPESTATUS` is empty, and a piped gate check has reported a false green in this repo before.

Expected: all four pass. Build is not lint is not typecheck: `lint` reaches `public/*.js`, and the test suite asserts a §7a divergence count that even a docs-only change can break.

- [ ] **Step 6: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/lib/board-import/repair.ts v2/src/lib/board-import/repair.test.ts
git commit -m "feat(board-import): whole-board resolution with derived answer"
```

---

## What Part 2 covers

Planned after Task 1 reports, and only then:

- **Stage 1 proper** — lattice fitting as shipped code, built from whatever the spike learned
- **Stage 2** — colour clustering by relation, with the high-contrast mapping resolved by trying both and keeping the consistent one
- **Stage 3** — glyph templates, and the synthetic board renderer that generates their test data
- **The browser adapter** — `File` to `{ data, width, height }` via `createImageBitmap`/`OffscreenCanvas`. The only DOM-touching file in the feature, and the reason everything above is environment-free
- **Confirm-before-save UI**, wired into `src/components/board-entry/form.tsx`
- **The correction log** that becomes the labeled corpus
- **The Pro gate, and an e2e covering it** — `wordle-teams-5jcn.14` applies, since none of the four gates would catch a regression here

## Spec coverage for Part 1

| Spec requirement (section 2) | Where |
| --- | --- |
| Stage 1 risk measured before planning the rest | Task 1 |
| Stage 4 constraint repair | Tasks 2, 4 |
| Answer from solved row, else supplied, else none | Task 5 |
| "Knows when it failed" rather than saving garbage | Tasks 4, 5 — `no-candidate` with `rowIndex` |
| No network in the parse path | Tasks 2–5 are pure; the list is checked in at build time (Task 3) |
| Accuracy criterion 2 ("fails if the parse path issues a network call") | Part 2, once a parse path exists end to end |
