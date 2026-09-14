# Continuous Board Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual board entry one continuous keystroke stream — type the answer, keep typing the guesses, with the cursor handing itself from the answer to the board and no click in between.

**Architecture:** A pure state machine (`entry-cursor.ts`) owns every rule about where a keystroke lands; a pure copy module (`entry-coach.ts`) turns that state into one coaching line. `form.tsx` becomes the single `contentEditable` region that owns the keystroke stream, and `board-input.tsx` and the new `answer-slots.tsx` become presentational shells that render a cursor position handed to them. This follows the repo's existing division: everything that decides is pure and tested directly, because a decision inside a component that needs a real DOM is a decision no cheap test can reach.

**Tech Stack:** TypeScript, React 19, TanStack Router, Vitest (edge-runtime by default, jsdom for `.hook.test.ts`), Playwright for e2e, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-14-continuous-board-entry-design.md`
**Issue:** `wordle-teams-wty4.1.6`

---

## Working agreements for this plan

- **All four gates, every commit.** `pnpm run lint`, `pnpm run typecheck`, `pnpm run test:once`, `pnpm run build`. They are different checks and passing one says nothing about the others.
- **Run commands from `v2/`.** Use absolute paths rather than `cd` in a compound command — the shell here has a zoxide-aliased `cd` that can short-circuit `&&`.
- **e2e is NOT one of the gates** and does not run in CI. Task 9's spec must be run by hand.
- **Never use `--no-verify`.** The pre-commit hook exports and stages `.beads/issues.jsonl`; a bd-only commit can abort on the first try, in which case retry once with `||`, never twice unconditionally.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `v2/src/components/board-entry/entry-cursor.ts` | **Create.** Pure state machine: where a keystroke lands, and every refusal. |
| `v2/src/components/board-entry/entry-cursor.test.ts` | **Create.** Exhaustive unit coverage, including the dead-end regression. |
| `v2/src/components/board-entry/entry-coach.ts` | **Create.** Pure. The coaching line as a function of state. |
| `v2/src/components/board-entry/entry-coach.test.ts` | **Create.** One assertion per state. |
| `v2/src/components/board-entry/answer-slots.tsx` | **Create.** Five slots with the rendered caret. Replaces the `#answer` box. |
| `v2/src/components/wordle-board.tsx` | **Modify.** Optional `cursor` prop so the entry board can mark the active tile. |
| `v2/src/components/board-entry/board-input.tsx` | **Modify.** Loses its keydown handler and focus target; takes a `cursor` prop. `applyLetter`/`applyBackspace` move out. |
| `v2/src/components/board-entry/board-input.test.ts` | **Modify.** Migrate to `entry-cursor.ts` or delete the moved cases. |
| `v2/src/components/board-entry/form.tsx` | **Modify.** Owns the single region, routes keydown, renders the coach line as a live region. |
| `v2/src/components/board-entry/form.hook.test.ts` | **Modify.** Add the no-click hand-off assertions. |
| `v2/e2e/board-entry.spec.ts` | **Modify or create.** The zero-click acceptance spec. |

---

## Task 1: The state machine's shape and `typeLetter`

**Files:**
- Create: `v2/src/components/board-entry/entry-cursor.ts`
- Test: `v2/src/components/board-entry/entry-cursor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/components/board-entry/entry-cursor.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { typeLetter, type EntryState } from './entry-cursor.ts'

const EMPTY_ROWS = ['', '', '', '', '', '']

const state = (over: Partial<EntryState> = {}): EntryState => ({
  answer: '',
  guesses: [...EMPTY_ROWS],
  zone: 'answer',
  ...over,
})

describe('typeLetter, in the answer zone', () => {
  test('appends, uppercased', () => {
    const { state: next, refused } = typeLetter(state(), 'c')
    expect(next.answer).toBe('C')
    expect(refused).toBeNull()
  })

  /**
   * THE HAND-OFF. This single line is the whole feature: the fifth letter of
   * the answer moves the cursor into the board with no click, which is what
   * removes the gap players were getting lost in.
   */
  test('THE FIFTH LETTER HANDS OFF TO THE BOARD', () => {
    const { state: next } = typeLetter(state({ answer: 'CRAN' }), 'E')
    expect(next.answer).toBe('CRANE')
    expect(next.zone).toBe('board')
  })

  test('the fourth letter does NOT hand off', () => {
    const { state: next } = typeLetter(state({ answer: 'CRA' }), 'N')
    expect(next.zone).toBe('answer')
  })

  test('a full answer refuses a sixth letter rather than silently dropping it', () => {
    const { state: next, refused } = typeLetter(state({ answer: 'CRANE' }), 'X')
    expect(next.answer).toBe('CRANE')
    expect(refused).toBe('answer-full')
  })
})

describe('typeLetter, in the board zone', () => {
  /**
   * THE REGRESSION THIS WHOLE CHANGE EXISTS FOR (wordle-teams-wty4.1.6).
   *
   * Today's applyLetter returns the guesses array UNCHANGED when the answer is
   * empty — `current === answer` is `'' === ''` — so every keystroke is
   * swallowed with no signal of any kind. Asserting "the array did not change"
   * would pass against that bug. The refusal has to be a DISTINCT, NAMED
   * outcome, which is the only shape of assertion the old behaviour cannot
   * satisfy.
   */
  test('REFUSES a letter while the answer is incomplete, nameably', () => {
    const { state: next, refused } = typeLetter(state({ zone: 'board' }), 'C')
    expect(refused).toBe('answer-incomplete')
    expect(next.guesses).toEqual(EMPTY_ROWS)
  })

  test('types into the first row with room', () => {
    const { state: next } = typeLetter(state({ answer: 'CRANE', zone: 'board' }), 's')
    expect(next.guesses[0]).toBe('S')
  })

  test('advances to the next row once the active one is full', () => {
    const { state: next } = typeLetter(
      state({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', '', '', '', '', ''] }),
      'T',
    )
    expect(next.guesses[1]).toBe('T')
  })

  // v1's rule, preserved: typing past a solved row would start a seventh guess.
  test('refuses once a row equals the answer', () => {
    const { refused } = typeLetter(
      state({ answer: 'CRANE', zone: 'board', guesses: ['CRANE', '', '', '', '', ''] }),
      'X',
    )
    expect(refused).toBe('board-solved')
  })

  test('refuses once all six rows are full', () => {
    const full = ['SLATE', 'TRAIN', 'HOUSE', 'MOUSE', 'PIVOT', 'BLIMP']
    const { refused } = typeLetter(state({ answer: 'CRANE', zone: 'board', guesses: full }), 'X')
    expect(refused).toBe('board-full')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/board-entry/entry-cursor.test.ts`
Expected: FAIL — `Cannot find module './entry-cursor.ts'`.

- [ ] **Step 3: Write the minimal implementation**

Create `v2/src/components/board-entry/entry-cursor.ts`:

```ts
import { toRows } from '../../../convex/lib/board.ts'

/** Which half of the entry surface the next keystroke lands in. */
export type Zone = 'answer' | 'board'

export type EntryState = {
  answer: string
  guesses: Array<string>
  zone: Zone
}

/**
 * Why a keystroke did nothing, when it did nothing.
 *
 * NAMED RATHER THAN SILENT, AND THAT IS THE POINT OF THIS MODULE
 * (wordle-teams-wty4.1.6). The behaviour being replaced returned the guesses
 * array unchanged when the answer was empty, so a player who clicked the board
 * first met an application that did not respond at all — and a test asserting
 * "unchanged" passed against it happily. A refusal that can be named is a
 * refusal a test can demand and a coach line can explain.
 */
export type Refusal = 'answer-full' | 'answer-incomplete' | 'board-solved' | 'board-full'

export type EntryResult = { state: EntryState; refused: Refusal | null }

export const ANSWER_LENGTH = 5

const kept = (state: EntryState, refused: Refusal): EntryResult => ({ state, refused })

export function typeLetter(state: EntryState, key: string): EntryResult {
  const letter = key.toUpperCase()

  if (state.zone === 'answer') {
    if (state.answer.length >= ANSWER_LENGTH) return kept(state, 'answer-full')
    const answer = state.answer + letter
    return {
      // THE HAND-OFF, and it is one expression. The fifth letter moves the
      // cursor into the board, which is what makes this continuous.
      state: { ...state, answer, zone: answer.length === ANSWER_LENGTH ? 'board' : 'answer' },
      refused: null,
    }
  }

  // Unreachable through the transitions below — nothing sets zone to 'board'
  // while the answer is short — and checked anyway, because this is an exported
  // pure function and a future caller may construct state directly.
  if (state.answer.length !== ANSWER_LENGTH) return kept(state, 'answer-incomplete')

  const rows = toRows(state.guesses)
  if (rows.some((row) => row === state.answer)) return kept(state, 'board-solved')

  const index = rows.findIndex((row) => row.length < ANSWER_LENGTH)
  if (index === -1) return kept(state, 'board-full')

  const guesses = [...rows]
  guesses[index] = guesses[index] + letter
  return { state: { ...state, guesses }, refused: null }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/board-entry/entry-cursor.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/src/components/board-entry/entry-cursor.ts v2/src/components/board-entry/entry-cursor.test.ts
git commit -m "feat(entry): a state machine whose refusals have names"
```

---

## Task 2: `backspace`, and the walk-back

**Files:**
- Modify: `v2/src/components/board-entry/entry-cursor.ts`
- Test: `v2/src/components/board-entry/entry-cursor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/src/components/board-entry/entry-cursor.test.ts`:

```ts
describe('backspace', () => {
  test('shortens the answer in the answer zone', () => {
    expect(backspace(state({ answer: 'CRAN' })).answer).toBe('CRA')
  })

  test('backspacing an empty answer is a no-op that stays put', () => {
    const next = backspace(state())
    expect(next.answer).toBe('')
    expect(next.zone).toBe('answer')
  })

  test('deletes from the last row that has content', () => {
    const next = backspace(
      state({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', 'TR', '', '', '', ''] }),
    )
    expect(next.guesses[1]).toBe('T')
  })

  test('crosses back into the previous row once the active row is empty', () => {
    const next = backspace(
      state({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', '', '', '', '', ''] }),
    )
    expect(next.guesses[0]).toBe('SLAT')
  })

  /**
   * THE WALK-BACK, which is the hand-off in reverse and the reason the stream
   * is continuous in both directions. Without it, a player who mistyped the
   * answer and has not yet typed a guess is stranded in a zone where backspace
   * does nothing.
   */
  test('BACKSPACING AN EMPTY BOARD RETURNS TO THE ANSWER', () => {
    const next = backspace(state({ answer: 'CRANE', zone: 'board' }))
    expect(next.zone).toBe('answer')
    expect(next.answer).toBe('CRANE')
  })
})
```

Extend the existing import at the top of the file to:

```ts
import { backspace, typeLetter, type EntryState } from './entry-cursor.ts'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/board-entry/entry-cursor.test.ts`
Expected: FAIL — `backspace is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to `v2/src/components/board-entry/entry-cursor.ts`:

```ts
/**
 * Delete one letter, or walk back a zone when there is nothing left to delete.
 *
 * RETURNS PLAIN STATE, NOT AN EntryResult, and the asymmetry with typeLetter is
 * deliberate rather than an oversight. Every way a backspace can do nothing is a
 * state the player can see for themselves — an empty answer with the cursor in
 * it — so there is no refusal worth naming and nothing for a coach line to
 * explain. typeLetter's refusals are the opposite: each one is a keystroke that
 * vanished for a reason the screen does not show.
 */
export function backspace(state: EntryState): EntryState {
  if (state.zone === 'answer') {
    return { ...state, answer: state.answer.slice(0, -1) }
  }

  const rows = toRows(state.guesses)
  // Array.prototype.findLastIndex is ES2023 and this project's tsconfig targets
  // ES2022, so the last filled row is found with a manual reverse scan — the
  // same reason the function this replaces did it this way.
  let lastFilled = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].length > 0) {
      lastFilled = i
      break
    }
  }

  // THE WALK-BACK: nothing typed yet, so the only thing behind the cursor is
  // the answer. Going there is what makes the stream continuous in reverse.
  if (lastFilled < 0) return { ...state, zone: 'answer' }

  const guesses = [...rows]
  guesses[lastFilled] = guesses[lastFilled].slice(0, -1)
  return { ...state, guesses }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/board-entry/entry-cursor.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/src/components/board-entry/entry-cursor.ts v2/src/components/board-entry/entry-cursor.test.ts
git commit -m "feat(entry): backspace walks back into the answer"
```

---

## Task 2b: `nextSlot`, `normalise`, and the gapped-board backspace fix

> **Inserted after Task 2's quality review.** It found a **live production bug**
> (`wordle-teams-lz3w`) that Task 2 faithfully ported, plus two extractions that
> are genuine sharing rather than false sharing. Split out of Task 3 so
> "refactor and fix" and "add the two new functions" are separate reviewable
> commits.

**Files:**
- Modify: `v2/src/components/board-entry/entry-cursor.ts`
- Modify: `v2/src/components/board-entry/entry-cursor.test.ts`
- Closes (partly): `wordle-teams-lz3w`

### The bug, measured

`typeLetter` scans FORWARDS for the first row with room. `backspace` scans
BACKWARDS for the last row with any content. On a board where those disagree,
backspace deletes from a row the cursor is not in.

They disagree on any **gapped** board, and gapped boards are a designed-for
shape: `prefillFrom` (`import-prefill.ts`) assembles the board **by row index**
from a screenshot parse and reports unreadable rows through `missingRows`.
`import-prefill.test.ts` asserts exactly `['', '', 'CRANE', '', '', '']` with
`missingRows: [0, 1]`.

Measured against the real functions on `['', '', 'SLATE', '', '', '']`:

```
type 'A'        -> A | | SLATE | | |     lands row 0, correct
then backspace  -> A | | SLAT  | | |     eats row 2, leaves the A
production      -> A | | SLAT  | | |     applyBackspace, identical
backspace alone -> | | SLAT | | |        nothing was ever typed
```

The last line is the user-visible bug: open an import-prefilled board with an
unread row, press backspace once, and a row the reader got RIGHT silently loses
a letter nowhere near the cursor.

**Why no test caught it:** `board-input.test.ts`'s "crosses back into the
previous row once the active row is empty" documents the reverse scan as
intentional — and it IS correct for a **prefix** board, where rows fill in order
and the two scans always agree. Every test used a prefix board. Import is what
produces the non-prefix shape.

- [ ] **Step 1: Write the failing test**

Append to `entry-cursor.test.ts`:

```ts
describe('a gapped board, which is what an import with an unread row produces', () => {
  /**
   * wordle-teams-lz3w. import-prefill.ts assembles by ROW INDEX, so a parse
   * that could not read rows 0-1 yields ['', '', 'SLATE', '', '', ''] — a board
   * where "the first row with room" (row 0) and "the last row with content"
   * (row 2) are different rows. Typing used the first; backspace used the
   * second; so backspace ate a row the player never touched.
   */
  test('backspace deletes behind the CURSOR, not from the last row with content', () => {
    const next = backspace(
      state({ answer: 'CRANE', zone: 'board', guesses: ['A', '', 'SLATE', '', '', ''] }),
    )
    expect(next.guesses).toEqual(['', '', 'SLATE', '', '', ''])
  })

  test('with nothing typed, backspace leaves an imported row alone entirely', () => {
    const next = backspace(
      state({ answer: 'CRANE', zone: 'board', guesses: ['', '', 'SLATE', '', '', ''] }),
    )
    expect(next.guesses).toEqual(['', '', 'SLATE', '', '', ''])
  })

  // The walk-back must NOT fire here: there is a board with content on it, so
  // the answer is not the only thing behind the cursor.
  test('and does not walk back to the answer while the board has content', () => {
    const next = backspace(
      state({ answer: 'CRANE', zone: 'board', guesses: ['', '', 'SLATE', '', '', ''] }),
    )
    expect(next.zone).toBe('board')
  })
})
```

- [ ] **Step 2: Run and confirm the first two fail for the right reason**

Run: `pnpm vitest run src/components/board-entry/entry-cursor.test.ts`
Expected: the first two FAIL, showing `['A', '', 'SLAT', ...]` — backspace eating
row 2. That failure IS the bug. The third may already pass; that is fine.

- [ ] **Step 3: Extract the two helpers**

In `entry-cursor.ts`, replace the two duplicated normalisation expressions with
one helper, and add `nextSlot`:

```ts
/**
 * Every entry point opens with this. v1 boards can carry a seventh '' sentinel
 * (see convex/lib/board.ts), so a caller reading `guesses.length` must get 6
 * regardless of which function it called or which branch fired.
 */
const normalise = (state: EntryState): EntryState => ({
  ...state,
  guesses: toRows(state.guesses),
})

/**
 * Where the next letter lands: the first row with room, and the column in it.
 * Null when all six rows are full.
 *
 * typeLetter, backspace and cursorFor MUST all derive from this. If the
 * rendered cursor and the row a keystroke fills were computed separately they
 * could disagree — and they DID (wordle-teams-lz3w), on an import-prefilled
 * board with an unread middle row, where the first row with room is row 1 but
 * the last row with content is row 2.
 *
 * NOT NAMED `activeRow`. "Active row" is vague enough to invite exactly the
 * reuse that caused that bug; "next slot" says it answers one question. And it
 * returns the column as well as the row because the column is free
 * (`rows[row].length`) and cursorFor needs it — a helper that dropped it would
 * leave cursorFor hand-rolling half the query again.
 */
function nextSlot(rows: Array<string>): { row: number; col: number } | null {
  const row = rows.findIndex((guess) => guess.length < ANSWER_LENGTH)
  return row === -1 ? null : { row, col: rows[row].length }
}
```

Rewrite `typeLetter`'s board branch to use `nextSlot` (behaviour identical), and
replace `backspace`'s reverse scan with the cursor-relative rule:

- `slot === null` (board full) → delete the last letter of row 5
- `slot.col > 0` → delete the last letter of `slot.row`
- `slot.col === 0 && slot.row > 0` → delete the last letter of `slot.row - 1`
  (this is the existing, correct "cross back into the previous row" behaviour)
- `slot.row === 0 && every row empty` → the walk-back, `zone = 'answer'`
- `slot.row === 0` with content elsewhere → **no-op**. Nothing is behind the
  cursor, and eating an untouched imported row is the bug.

- [ ] **Step 4: Run the whole file**

Run: `pnpm vitest run src/components/board-entry/entry-cursor.test.ts`
Expected: PASS. **All 20 pre-existing tests must still pass unchanged** — the new
rule is identical on every prefix board, and if any of them go red the rewrite
is wrong rather than the test being outdated.

- [ ] **Step 5: Fix the two doc comments**

Replace `EntryResult`'s doc comment with the affirmative rule, so `moveZone` in
Task 3 can be measured against it:

```ts
/**
 * The envelope for operations that can swallow a keystroke invisibly: the
 * resulting state, plus the named reason nothing happened. An operation whose
 * every no-op is already legible on screen returns plain EntryState instead —
 * `backspace` does, and its doc comment has the argument.
 */
```

Delete the duplicated argument from the two places it currently appears, keeping
the full version only on `backspace`, and drop the phrase "deliberate rather
than an oversight" from both — the contrast with `typeLetter`'s refusals already
makes the case, and asserting that a choice is not a mistake is the grammar of
an apology rather than a design.

Add one clause to `backspace`'s comment acknowledging that "every no-op is
visible to the player" is only true once Task 3's `cursorFor` renders a cursor.

- [ ] **Step 6: Add the walk-back-as-recovery test**

```ts
// The pairing with typeLetter's 'answer-incomplete' refusal: landing in the
// board zone with a short answer is a dead end for typing and an EXIT for
// backspace. That is the two functions composing, and nothing pinned it.
test('the walk-back is the recovery from a short answer', () => {
  const next = backspace(state({ answer: 'CRA', zone: 'board' }))
  expect(next.zone).toBe('answer')
  expect(next.answer).toBe('CRA')
})
```

- [ ] **Step 7: All four gates, each checked separately**

- [ ] **Step 8: Commit**

```
fix(entry): backspace deletes behind the cursor, not from the last filled row
```

---

## Task 3: `moveZone` and `cursorFor`

> **Three carry-forwards from Task 2b's quality review**, folded in here because
> they touch this same file and are not worth their own commit.
>
> 1. **The comment ratio is now 53%**, above the 50% of its sibling
>    `convex/lib/board.ts` and up from 44% before Task 2b. Every line earns its
>    keep individually, but the trend must not compound. **Task 3's additions
>    should lower the ratio, not raise it.** If `moveZone` and `cursorFor` want
>    doc comments proportional to `backspace`'s 26 lines, hoist the historical
>    bug narratives out of the function docs into one top-of-file "why this
>    shape" block instead, and leave the function docs stating rules.
> 2. **`backspace`'s contingency clause becomes TRUE in this task.** It
>    currently hedges that "every no-op is visible to the player" depends on a
>    cursor that does not exist yet. `cursorFor` is that cursor. Rewrite the
>    clause as a statement rather than a promise, and drop the self-referential
>    framing ("this paragraph is a claim about where the module is headed") —
>    say the thing, not that you are saying it.
> 3. **Fix one test comment's framing.** The walk-back-as-recovery test says
>    "nothing pinned it", which is no longer accurate — the pre-existing
>    `BACKSPACING AN EMPTY BOARD RETURNS TO THE ANSWER` test already covers that
>    branch. Keep the test (it documents the `typeLetter`/`backspace` pairing)
>    but say what it actually adds: documentation of the pairing, not new branch
>    coverage.


**Files:**
- Modify: `v2/src/components/board-entry/entry-cursor.ts`
- Test: `v2/src/components/board-entry/entry-cursor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/src/components/board-entry/entry-cursor.test.ts`:

```ts
describe('moveZone', () => {
  // The escape hatch: a player on row five who spots a typo in the answer must
  // not have to backspace thirty times to reach it.
  test('clicking the answer returns the cursor there from the board', () => {
    const { state: next, refused } = moveZone(
      state({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', 'TR', '', '', '', ''] }),
      'answer',
    )
    expect(next.zone).toBe('answer')
    expect(refused).toBeNull()
  })

  test('clicking the board with a complete answer moves there', () => {
    const { state: next, refused } = moveZone(state({ answer: 'CRANE' }), 'board')
    expect(next.zone).toBe('board')
    expect(refused).toBeNull()
  })

  /**
   * The early click, and the reason the board needs no lock or dim: a click it
   * cannot honour is REFUSED BY NAME, so the coach line can answer the click
   * instead of the grid having to look disabled to prevent it.
   */
  test('clicking the board with an incomplete answer is refused and the cursor stays', () => {
    const { state: next, refused } = moveZone(state({ answer: 'CRA' }), 'board')
    expect(next.zone).toBe('answer')
    expect(refused).toBe('answer-incomplete')
  })
})

describe('cursorFor', () => {
  test('points at the next empty answer slot', () => {
    expect(cursorFor(state({ answer: 'CR' }))).toEqual({ zone: 'answer', index: 2 })
  })

  /**
   * INDEX 5 IS A LEGAL INSERTION POINT with only five slots to render it in.
   * It is reachable by clicking the slots to correct a complete answer, and
   * answer-slots.tsx renders it as a trailing caret on the last slot, the way
   * an OTP input does. Returning null here instead would take the cursor off
   * the screen at exactly the moment the player asked to edit.
   */
  test('a complete answer still has a cursor, one past the end', () => {
    expect(cursorFor(state({ answer: 'CRANE' }))).toEqual({ zone: 'answer', index: 5 })
  })

  test('points at the next empty tile in the board zone', () => {
    expect(
      cursorFor(state({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', 'TR', '', '', '', ''] })),
    ).toEqual({ zone: 'board', row: 1, index: 2 })
  })

  test('there is no cursor once a row equals the answer', () => {
    expect(
      cursorFor(state({ answer: 'CRANE', zone: 'board', guesses: ['CRANE', '', '', '', '', ''] })),
    ).toBeNull()
  })

  test('there is no cursor once all six rows are full', () => {
    const full = ['SLATE', 'TRAIN', 'HOUSE', 'MOUSE', 'PIVOT', 'BLIMP']
    expect(cursorFor(state({ answer: 'CRANE', zone: 'board', guesses: full }))).toBeNull()
  })
})
```

Extend the import at the top of the file to:

```ts
import { backspace, cursorFor, moveZone, typeLetter, type EntryState } from './entry-cursor.ts'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/board-entry/entry-cursor.test.ts`
Expected: FAIL — `moveZone is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to `v2/src/components/board-entry/entry-cursor.ts`:

```ts
/**
 * Where the caret renders. `index` is an INSERTION POINT, so in the answer zone
 * it ranges 0..ANSWER_LENGTH inclusive.
 */
export type Cursor =
  | { zone: 'answer'; index: number }
  | { zone: 'board'; row: number; index: number }

/**
 * Move the cursor between zones, for a click.
 *
 * A move into the board with a short answer is REFUSED rather than allowed, and
 * that refusal is what lets the board render at full strength with no lock or
 * dim: an early click is answered by the coach line instead of being prevented
 * by making half the dialog look disabled.
 */
export function moveZone(state: EntryState, zone: Zone): EntryResult {
  if (zone === 'board' && state.answer.length !== ANSWER_LENGTH) {
    return kept(state, 'answer-incomplete')
  }
  return { state: { ...state, zone }, refused: null }
}

/**
 * THE ONE DEFINITION OF "WHERE THE NEXT LETTER GOES", consumed by both the
 * answer slots and the board so the two renderings cannot disagree about it.
 * Returns null only when there is genuinely nothing left to type.
 */
export function cursorFor(state: EntryState): Cursor | null {
  const { answer, guesses, zone } = normalise(state)

  if (zone === 'answer') return { zone: 'answer', index: answer.length }

  if (guesses.some((row) => row === answer)) return null

  // nextSlot, NOT a third hand-rolled scan. Task 2b extracted it precisely so
  // the rendered cursor and the row a keystroke fills cannot disagree — see
  // wordle-teams-lz3w for what happened when they did.
  const slot = nextSlot(guesses)
  return slot === null ? null : { zone: 'board', row: slot.row, index: slot.col }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/board-entry/entry-cursor.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Verify the refusal is not reachable by accident**

Run this mutation by hand to prove the dead-end test bites. Temporarily change, in `typeLetter`:

```ts
  if (state.answer.length !== ANSWER_LENGTH) return kept(state, 'answer-incomplete')
```

to:

```ts
  if (state.answer.length !== ANSWER_LENGTH) return { state, refused: null }
```

Run: `pnpm vitest run src/components/board-entry/entry-cursor.test.ts`
Expected: FAIL on "REFUSES a letter while the answer is incomplete, nameably".
Then revert the mutation and re-run; expected PASS, 22 tests.

- [ ] **Step 6: Commit**

```bash
git add v2/src/components/board-entry/entry-cursor.ts v2/src/components/board-entry/entry-cursor.test.ts
git commit -m "feat(entry): one definition of where the next letter goes"
```

---

## Task 4: The coach line

> **Contract change from Task 1's review.** `Refusal` gained a fifth member,
> `'not-a-letter'`, so that a raw `KeyboardEvent.key` like `'Enter'` cannot be
> appended whole and overshoot the answer. `coachFor` needs no new branch — it
> falls through to the zone line — but the silence is deliberate and is pinned
> by a test below. The union is now:
> `'not-a-letter' | 'answer-full' | 'answer-incomplete' | 'board-solved' | 'board-full'`.

**Files:**
- Create: `v2/src/components/board-entry/entry-coach.ts`
- Test: `v2/src/components/board-entry/entry-coach.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/components/board-entry/entry-coach.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { coachFor } from './entry-coach.ts'
import type { EntryState } from './entry-cursor.ts'

const EMPTY_ROWS = ['', '', '', '', '', '']

const state = (over: Partial<EntryState> = {}): EntryState => ({
  answer: '',
  guesses: [...EMPTY_ROWS],
  zone: 'answer',
  ...over,
})

const line = (over: Partial<EntryState>, refused: Parameters<typeof coachFor>[0]['refused'] = null, valid = false) =>
  coachFor({ state: state(over), refused, valid })

describe('coachFor', () => {
  test('opens by asking for the answer', () => {
    expect(line({})).toBe("Type today's answer — five letters")
  })

  /**
   * The refusal outranks the zone, because it is a reply to something the
   * player just did. Without this the coach line would go on calmly asking for
   * the answer while the click that was just ignored goes unexplained.
   */
  test('an early click on the board is answered directly', () => {
    expect(line({ answer: 'CRA' }, 'answer-incomplete')).toBe(
      'Answer first — then the board takes over',
    )
  })

  test('asks for the first guess once the cursor has handed off', () => {
    expect(line({ answer: 'CRANE', zone: 'board' })).toBe(
      'Now type your first guess — rows advance on their own',
    )
  })

  test('says backspace goes back once a guess is under way', () => {
    expect(line({ answer: 'CRANE', zone: 'board', guesses: ['SL', '', '', '', '', ''] })).toBe(
      'Keep typing. Backspace goes back a letter',
    )
  })

  /**
   * 'not-a-letter' IS DELIBERATELY NOT ANNOUNCED. Task 1's review added it so
   * that an arrow key or 'Enter' arriving as a KeyboardEvent.key cannot
   * overshoot the answer — but a player pressing an arrow key has not made a
   * mistake and does not need telling. It falls through to the zone line, and
   * this test is what stops someone "helpfully" giving it copy later.
   */
  test('a key that is not a letter is passed over in silence', () => {
    expect(line({}, 'not-a-letter')).toBe("Type today's answer — five letters")
    expect(line({ answer: 'CRANE', zone: 'board' }, 'not-a-letter')).toBe(
      'Now type your first guess — rows advance on their own',
    )
  })

  test('a complete board is told it can submit', () => {
    expect(
      line({ answer: 'CRANE', zone: 'board', guesses: ['CRANE', '', '', '', '', ''] }, null, true),
    ).toBe('Looks complete — press Enter or Submit')
  })

  /**
   * Validity outranks everything, including a refusal: a player whose board is
   * finished should be told they can submit, not scolded for a stray keystroke.
   */
  test('validity outranks a refusal', () => {
    expect(
      line(
        { answer: 'CRANE', zone: 'board', guesses: ['CRANE', '', '', '', '', ''] },
        'board-solved',
        true,
      ),
    ).toBe('Looks complete — press Enter or Submit')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/board-entry/entry-coach.test.ts`
Expected: FAIL — `Cannot find module './entry-coach.ts'`.

- [ ] **Step 3: Write the minimal implementation**

Create `v2/src/components/board-entry/entry-coach.ts`:

```ts
import type { EntryState, Refusal } from './entry-cursor.ts'

/**
 * The one line of coaching under the dialog title, as a function of state.
 *
 * A MODULE RATHER THAN JSX SO THE COPY CAN BE READ WITHOUT READING A COMPONENT,
 * and so each state's line is pinned by a test. It is also what a screen reader
 * hears: form.tsx renders this into an aria-live region, which is the only way
 * the hand-off reaches somebody who cannot see the cursor move.
 *
 * `valid` is passed in rather than recomputed here so that boardIsValid stays
 * the single definition of a finished board.
 */
export function coachFor({
  state,
  refused,
  valid,
}: {
  state: EntryState
  refused: Refusal | null
  valid: boolean
}): string {
  // Validity first: a finished board should be told it can submit, never
  // scolded for a stray keystroke that the refusal below would report.
  if (valid) return 'Looks complete — press Enter or Submit'

  // Then the refusal, because it is a reply to something the player just did
  // and the screen shows no other sign of it.
  if (refused === 'answer-incomplete') return 'Answer first — then the board takes over'

  if (state.zone === 'answer') return "Type today's answer — five letters"

  const started = state.guesses.some((guess) => guess.length > 0)
  return started
    ? 'Keep typing. Backspace goes back a letter'
    : 'Now type your first guess — rows advance on their own'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/board-entry/entry-coach.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/src/components/board-entry/entry-coach.ts v2/src/components/board-entry/entry-coach.test.ts
git commit -m "feat(entry): the coach line, as a function of state"
```

---

## Task 5: The answer slots

**Files:**
- Create: `v2/src/components/board-entry/answer-slots.tsx`
- Test: `v2/src/components/board-entry/answer-slots.hook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/components/board-entry/answer-slots.hook.test.ts`:

```ts
// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, because this renders the
// real component. `.hook.test.ts` and createElement by hand, matching every
// other component test in src/ and vitest.config.ts's `src/**/*.test.ts` glob.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { AnswerSlots } from './answer-slots.tsx'

afterEach(cleanup)

const slots = () => screen.getAllByTestId('answer-slot')

describe('AnswerSlots', () => {
  test('renders five slots, one per letter of the answer', () => {
    render(createElement(AnswerSlots, { answer: '', cursorIndex: 0, onSelect: () => {} }))
    expect(slots()).toHaveLength(5)
  })

  test('shows each typed letter in its own slot', () => {
    render(createElement(AnswerSlots, { answer: 'CR', cursorIndex: 2, onSelect: () => {} }))
    expect(slots()[0].textContent).toBe('C')
    expect(slots()[1].textContent).toBe('R')
    expect(slots()[2].textContent).toBe('')
  })

  /**
   * THE RENDERED CARET IS THE WHOLE POINT OF THIS COMPONENT. The box it
   * replaces was a shadcn Input with caret-transparent — a focused field with a
   * bright ring and no caret, which is the standard signature of a DISABLED
   * field and is most of why players did not know to type (wty4.1.6).
   */
  test('marks exactly one slot as the cursor', () => {
    render(createElement(AnswerSlots, { answer: 'CR', cursorIndex: 2, onSelect: () => {} }))
    const marked = slots().filter((slot) => slot.getAttribute('data-cursor') === 'true')
    expect(marked).toHaveLength(1)
    expect(slots()[2].getAttribute('data-cursor')).toBe('true')
  })

  // Index 5 is a legal insertion point with only five slots to render it in.
  // It is reachable by clicking back to correct a complete answer.
  test('a cursor one past the end marks the last slot, trailing', () => {
    render(createElement(AnswerSlots, { answer: 'CRANE', cursorIndex: 5, onSelect: () => {} }))
    expect(slots()[4].getAttribute('data-cursor')).toBe('true')
    expect(slots()[4].getAttribute('data-cursor-trailing')).toBe('true')
  })

  test('no slot is marked when the cursor is elsewhere', () => {
    render(createElement(AnswerSlots, { answer: 'CRANE', cursorIndex: null, onSelect: () => {} }))
    expect(slots().filter((slot) => slot.getAttribute('data-cursor') === 'true')).toHaveLength(0)
  })

  test('announces the answer so far to a screen reader', () => {
    render(createElement(AnswerSlots, { answer: 'CR', cursorIndex: 2, onSelect: () => {} }))
    expect(screen.getByLabelText("Today's Wordle answer, 2 of 5 letters: C R")).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/board-entry/answer-slots.hook.test.ts`
Expected: FAIL — `Cannot find module './answer-slots.tsx'`.

- [ ] **Step 3: Write the minimal implementation**

Create `v2/src/components/board-entry/answer-slots.tsx`:

```tsx
import { cn } from '#/lib/utils.ts'
import { ANSWER_LENGTH } from './entry-cursor.ts'

/**
 * The day's answer, as five slots with a rendered caret.
 *
 * WHAT THIS REPLACES AND WHY. The answer was a contentEditable div carrying
 * `border border-input bg-background rounded-md h-10` — pixel-for-pixel a
 * shadcn Input — with `caret-transparent` and every key preventDefault'd. So it
 * wore the complete visual language of a text input while supporting none of
 * its behaviour: no caret, no click-to-position, no selection, no paste. A
 * focused box with a bright ring and no blinking caret is the standard
 * signature of a DISABLED field, and that is most of why players opened this
 * dialog and did not know to type (wordle-teams-wty4.1.6).
 *
 * FIVE SLOTS RATHER THAN A WIDER BOX, because the answer is a five-letter word
 * and slots say so without a sentence. It is the same pattern a verification-
 * code input uses, for the same reasons: fixed length, one character per slot,
 * auto-advance, no free-form editing — which is exactly what this field can
 * actually do.
 *
 * PRESENTATIONAL ONLY. It renders a cursor position; it does not decide one.
 * entry-cursor.ts's `cursorFor` is the single definition, shared with the board.
 */
export function AnswerSlots({
  answer,
  cursorIndex,
  onSelect,
}: {
  answer: string
  /** From cursorFor. `null` when the cursor is on the board. 0..ANSWER_LENGTH. */
  cursorIndex: number | null
  /** Clicking the slots is the escape hatch back to the answer from anywhere. */
  onSelect: () => void
}) {
  const letters = Array.from({ length: ANSWER_LENGTH }, (_, i) => answer[i] ?? '')
  const typed = answer.split('').join(' ')

  return (
    <div
      className="flex gap-1.5"
      onMouseDown={onSelect}
      role="group"
      aria-label={`Today's Wordle answer, ${answer.length} of ${ANSWER_LENGTH} letters: ${typed}`}
    >
      {letters.map((letter, index) => {
        // Index ANSWER_LENGTH is a legal insertion point with no slot of its
        // own — reachable by clicking back to correct a complete answer. It
        // renders as a trailing caret on the last slot, the way an OTP input
        // does, rather than taking the cursor off screen at exactly the moment
        // the player asked to edit.
        const trailing = cursorIndex === ANSWER_LENGTH && index === ANSWER_LENGTH - 1
        const here = cursorIndex === index || trailing

        return (
          <div
            key={index}
            data-testid="answer-slot"
            data-cursor={here ? 'true' : 'false'}
            data-cursor-trailing={trailing ? 'true' : undefined}
            className={cn(
              'relative flex h-11 w-9 items-center justify-center rounded-md border text-xl font-bold uppercase',
              'caret-transparent select-none',
              letter ? 'border-wordle-tile-border' : 'border-input',
              here && 'border-ring',
            )}
          >
            {letter}
            {here && !letter && (
              <span
                aria-hidden="true"
                className="absolute h-6 w-0.5 animate-caret-blink bg-ring motion-reduce:animate-none"
              />
            )}
            {trailing && (
              <span
                aria-hidden="true"
                className="absolute right-1 h-6 w-0.5 animate-caret-blink bg-ring motion-reduce:animate-none"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default AnswerSlots
```

- [ ] **Step 4: Confirm `animate-caret-blink` exists, and add it if not**

Run: `grep -rn "caret-blink" /home/cdub/projects/wordle-teams/v2/src/styles.css /home/cdub/projects/wordle-teams/v2/tailwind.config.ts 2>/dev/null`

If it returns nothing, add to `v2/src/styles.css`:

```css
@keyframes caret-blink {
  0%, 70%, 100% { opacity: 1; }
  20%, 50%      { opacity: 0; }
}

@utility animate-caret-blink {
  animation: caret-blink 1.25s ease-out infinite;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/components/board-entry/answer-slots.hook.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add v2/src/components/board-entry/answer-slots.tsx v2/src/components/board-entry/answer-slots.hook.test.ts v2/src/styles.css
git commit -m "feat(entry): the answer becomes five slots with a visible caret"
```

---

## Task 6: `WordleBoard` learns a cursor

**Files:**
- Modify: `v2/src/components/wordle-board.tsx`
- Test: `v2/src/components/wordle-board.hook.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create or append to `v2/src/components/wordle-board.hook.test.ts`:

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { WordleBoard } from './wordle-board.tsx'

afterEach(cleanup)

const EMPTY = ['', '', '', '', '', '']

describe('WordleBoard cursor', () => {
  /**
   * The display board (team-boards.tsx) is not an input and must never grow a
   * caret. The prop is optional and absent there, and this is what keeps it so.
   */
  test('renders no cursor when none is given', () => {
    const { container } = render(
      createElement(WordleBoard, { guesses: EMPTY, answer: 'CRANE' }),
    )
    expect(container.querySelectorAll('[data-cursor="true"]')).toHaveLength(0)
  })

  test('marks exactly the tile the next letter lands in', () => {
    render(
      createElement(WordleBoard, {
        guesses: ['SL', '', '', '', '', ''],
        answer: 'CRANE',
        boardEntry: true,
        cursor: { row: 0, col: 2 },
      }),
    )
    const marked = screen.getByTestId('board-cursor')
    expect(marked.id).toBe('1-3')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/wordle-board.hook.test.ts`
Expected: FAIL — no element with test id `board-cursor`.

- [ ] **Step 3: Write the minimal implementation**

In `v2/src/components/wordle-board.tsx`, add to `WordleBoardProps`:

```ts
  /**
   * The tile the next letter lands in, on the ENTRY board only. Optional and
   * absent on the display board (team-boards.tsx), which is not an input and
   * must never grow a caret. Comes from entry-cursor.ts's `cursorFor`, which is
   * also what positions the answer slots' caret — one definition, so the two
   * cannot disagree about where typing goes.
   */
  cursor?: { row: number; col: number } | null
```

Add `cursor = null` to the destructured parameters, then change the tile `<div>` to:

```tsx
            {tileStates(answer, guess).map((state, col) => {
              const here = cursor !== null && cursor.row === row && cursor.col === col
              return (
                <div
                  key={col}
                  id={`${row + 1}-${col + 1}`}
                  data-state={state}
                  data-cursor={here ? 'true' : undefined}
                  data-testid={here ? 'board-cursor' : undefined}
                  className={cn(
                    'flex items-center justify-center border uppercase caret-transparent',
                    boardEntry ? TILE_SIZE_ENTRY : TILE_SIZE_DISPLAY,
                    tileClass[state],
                    // The ring sits OUTSIDE the tile rather than replacing its
                    // border: the border colour is the tile's own state and
                    // overwriting it would make the active tile read as a
                    // different result.
                    here && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
                  )}
                >
                  {reveal ? (guess[col] ?? '') : ''}
                </div>
              )
            })}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/wordle-board.hook.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/src/components/wordle-board.tsx v2/src/components/wordle-board.hook.test.ts
git commit -m "feat(board): an optional cursor on the entry board only"
```

---

## Task 7: `board-input.tsx` becomes a shell

**Files:**
- Modify: `v2/src/components/board-entry/board-input.tsx`
- Modify: `v2/src/components/board-entry/board-input.test.ts`

- [ ] **Step 1: Delete the moved tests**

`applyLetter` and `applyBackspace` are gone; `entry-cursor.test.ts` covers their behaviour and more. Delete `v2/src/components/board-entry/board-input.test.ts` entirely.

```bash
git rm v2/src/components/board-entry/board-input.test.ts
```

Note for the reviewer: one of its cases — "the current-equals-answer guard is a no-op only when both are empty" — *documented the dead end as correct behaviour*. It is deliberately not being carried across. Task 1's "REFUSES a letter while the answer is incomplete, nameably" is its replacement and asserts the opposite.

- [ ] **Step 2: Run the suite to see what breaks**

Run: `pnpm run typecheck`
Expected: errors in `form.tsx` for the props removed below. That is expected and Task 8 fixes it.

- [ ] **Step 3: Rewrite the component**

Replace the whole of `v2/src/components/board-entry/board-input.tsx` with:

```tsx
import { Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { WordleBoard } from '#/components/wordle-board.tsx'
import { toRows } from '../../../convex/lib/board.ts'

/**
 * The entry board. PRESENTATIONAL SINCE wordle-teams-wty4.1.6 — it renders a
 * board and a cursor position, and decides nothing.
 *
 * WHAT MOVED AND WHY. This file used to own a keydown handler, its own focus
 * target and the applyLetter/applyBackspace pair. That made the board one of
 * TWO independent places a player had to focus, with nothing announcing the
 * second — so after typing the answer they were left to discover that the
 * board had to be clicked before it would accept anything. Worse, the keystroke
 * they tried it with vanished silently.
 *
 * form.tsx now owns one contentEditable region covering the answer and the
 * board together, and entry-cursor.ts owns every rule about where a keystroke
 * lands. The keyboard interception itself is unchanged and still load-bearing:
 * see form.tsx for why every key is preventDefault'd and why onBeforeInput and
 * onPaste are not optional.
 */
export function BoardInput({
  guesses,
  answer,
  cursor,
  submitting,
  submitDisabled,
}: {
  guesses: Array<string>
  answer: string
  /** The tile the next letter lands in, from entry-cursor.ts's `cursorFor`. */
  cursor: { row: number; col: number } | null
  submitting: boolean
  submitDisabled: boolean
}) {
  return (
    <>
      <div className="mx-auto mt-4 flex h-fit w-fit select-none rounded-lg md:my-2">
        <WordleBoard guesses={toRows(guesses)} answer={answer} boardEntry cursor={cursor} />
      </div>
      {/* Desktop's submit. The mobile one lives in the sheet footer so it can
          pin above the keyboard. */}
      <div className="invisible mt-2 flex h-0 justify-end space-x-4 md:visible md:mt-2 md:h-fit">
        <Button
          disabled={submitting || submitDisabled}
          aria-disabled={submitting || submitDisabled}
          type="submit"
          id="board-submit"
          tabIndex={5}
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit
        </Button>
      </div>
    </>
  )
}

export default BoardInput
```

Note the focus ring classes are gone from the wrapper: the ring now belongs to form.tsx's region, which surrounds both zones.

- [ ] **Step 4: Commit**

```bash
git add v2/src/components/board-entry/board-input.tsx
git commit -m "refactor(entry): the board renders, it no longer decides"
```

---

## Task 8: `form.tsx` owns the keystroke stream

> **From Task 4's review — `valid` is NOT `boardIsValid(...)` alone.**
> `submitDisabled` in this file is `!day || !boardIsValid(answer, guesses, existing !== undefined)`
> — **two** conditions. Passing `boardIsValid(...)` by itself into `coachFor` would tell a
> player with a complete board and no day picked to "press Enter or Submit" while the
> Submit button is disabled, which is the coach line lying at the one moment it matters
> most. Pass `submitDisabled === false`, so the line and the button can never disagree —
> and add a test for exactly that state (complete board, `day` unset).


**Files:**
- Modify: `v2/src/components/board-entry/form.tsx`

- [ ] **Step 1: Add the state and the handlers**

Near the existing `const answerRef = useRef<HTMLDivElement>(null)` (line ~138), rename it and add the zone state:

```tsx
  const regionRef = useRef<HTMLDivElement>(null)
  const [zone, setZone] = useState<Zone>('answer')
  const [refused, setRefused] = useState<Refusal | null>(null)
```

Add the imports at the top of the file:

```tsx
import { AnswerSlots } from './answer-slots.tsx'
import { coachFor } from './entry-coach.ts'
import {
  backspace,
  cursorFor,
  moveZone,
  typeLetter,
  type EntryState,
  type Refusal,
  type Zone,
} from './entry-cursor.ts'
```

- [ ] **Step 2: Replace `handleAnswerKeyDown` with one handler for both zones**

Delete `handleAnswerKeyDown` (line ~231) and put this in its place:

```tsx
  const entry: EntryState = { answer, guesses, zone }
  const cursor = cursorFor(entry)

  const applyEntry = (next: EntryState) => {
    if (next.answer !== answer) setAnswer(next.answer)
    if (next.guesses !== guesses) setGuesses(next.guesses)
    if (next.zone !== zone) setZone(next.zone)
  }

  /**
   * ONE HANDLER FOR BOTH ZONES, which is the whole of this change.
   *
   * There used to be two: one on the answer div and one on the board, each with
   * its own focus target. A player who finished the answer had to discover that
   * the board needed clicking before it would take anything — and the keystroke
   * they tried it with disappeared without a trace. entry-cursor.ts decides
   * where a letter lands now, and it hands the cursor over by itself.
   *
   * EVERY KEY IS STILL preventDefault'd AND THAT IS NOT NEGOTIABLE. Nothing may
   * be typed into the DOM: this region contains <WordleBoard>, a React-owned
   * subtree, and a native insertion into it corrupts what React thinks it owns
   * — the wrong board on submit, or a removeChild reconciliation crash. keydown
   * alone does not cover it, which is why onBeforeInput and onPaste are on the
   * region below: paste fires its own event, and IME commits plus mobile
   * swipe-typing, predictive text and dictation all insert via beforeinput with
   * no per-character keydown at all. `beforeinput` is cancelable; `input` is not.
   */
  const handleKeyDown: KeyboardEventHandler = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key
    // Tab must reach the browser to move focus. Ctrl/Cmd combos must not be
    // read as plain letters — Ctrl+V's keydown carries event.key === 'v'.
    if (key === 'Tab' || event.ctrlKey || event.metaKey) return
    event.preventDefault()

    if (key === 'Backspace') {
      setRefused(null)
      applyEntry(backspace(entry))
      return
    }

    if (key === 'Enter') {
      setRefused(null)
      if (boardIsValid(answer, guesses, existing !== undefined)) {
        document.getElementById('board-submit')?.click()
      } else {
        toast.warning('Board must be complete to submit')
      }
      return
    }

    if (key.length === 1 && /[a-zA-Z]/.test(key)) {
      const result = typeLetter(entry, key)
      setRefused(result.refused)
      applyEntry(result.state)
    }
  }

  const selectZone = (next: Zone) => {
    const result = moveZone(entry, next)
    setRefused(result.refused)
    applyEntry(result.state)
    regionRef.current?.focus()
  }
```

- [ ] **Step 3: Repoint the focus effect**

Change line ~181 from `answerRef.current?.focus()` to:

```tsx
    regionRef.current?.focus()
```

- [ ] **Step 4: Scroll on the hand-off as well as on typing**

Change line ~227 from `useEffect(scrollActiveRowIntoView, [guesses])` to:

```tsx
  // `zone` joins the deps because focus no longer moves when the cursor enters
  // the board — the hand-off is invisible to the focus events this used to
  // ride on, so without it the first guess can be typed below the fold.
  useEffect(scrollActiveRowIntoView, [guesses, zone])
```

- [ ] **Step 5: Replace the answer markup and wrap both zones in one region**

Replace the whole `<div className="flex w-[30%] flex-col space-y-2 md:w-full">` block (the Label plus the `#answer` contentEditable div, lines ~396-423) with:

```tsx
        <div className="flex flex-col space-y-2">
          <Label className="text-xs sm:text-sm">Wordle Answer</Label>
          <AnswerSlots
            answer={answer}
            cursorIndex={cursor?.zone === 'answer' ? cursor.index : null}
            onSelect={() => selectZone('answer')}
          />
        </div>
```

Then wrap the answer block and the board in the single region. Replace the `<div ref={scrollContainerRef} ...>` block (lines ~465-476) with:

```tsx
      {/* THE COACH LINE, AND IT IS A LIVE REGION RATHER THAN DECORATION.
          Collapsing two focus stops into one is what makes entry continuous,
          and it costs a keyboard user the ability to Tab between the answer and
          the board. This is what pays that back: the hand-off is ANNOUNCED when
          it cannot be seen. If it is ever removed, the fallback recorded in the
          spec — keeping the board tabbable as a second stop — has to come with
          it. `min-h` so a changing line cannot reflow the dialog under a
          reader's hands. */}
      <p
        role="status"
        aria-live="polite"
        data-testid="entry-coach"
        className="min-h-9 px-2 text-xs text-muted-foreground md:px-4"
      >
        {coachFor({ state: entry, refused, valid: submitDisabled === false })}
      </p>

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={regionRef}
          contentEditable
          suppressContentEditableWarning
          onKeyDown={handleKeyDown}
          onBeforeInput={(event) => event.preventDefault()}
          onPaste={(event) => event.preventDefault()}
          onMouseDown={(event) => {
            // A click anywhere in the board half asks for the board. moveZone
            // refuses it while the answer is short, and the coach line answers
            // the click — which is why the board needs no lock or dim.
            if (event.currentTarget === event.target) return
            selectZone('board')
          }}
          tabIndex={2}
          role="group"
          aria-label="Wordle board entry"
          aria-describedby="entry-instructions"
          className="mx-auto w-fit rounded-lg caret-transparent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 focus:ring-offset-background"
        >
          <div data-testid="board-cursor-target">
            <BoardInput
              guesses={guesses}
              answer={answer}
              cursor={cursor?.zone === 'board' ? { row: cursor.row, col: cursor.index } : null}
              submitting={submitting}
              submitDisabled={submitDisabled}
            />
          </div>
        </div>
      </div>

      {/* Stated once, for a reader who cannot watch the cursor move. */}
      <span id="entry-instructions" className="sr-only">
        Type today&rsquo;s answer, then your guesses. Rows advance on their own. Backspace goes
        back a letter, and back to the answer from an empty board.
      </span>
```

Move the answer block from the header row into this region as well, directly above `<BoardInput>`, so one region covers both zones. The day button and the submit buttons stay OUTSIDE it — a `contentEditable` must not contain them.

- [ ] **Step 6: Set the zone after an import**

In `handleImport` (line ~246), after `setGuesses(prefill.guesses)`, add:

```tsx
    // The cursor lands wherever there is still something to type. An import
    // that produced a complete answer has already done the answer's job.
    setZone(prefill.answer.length === 5 || answer.length === 5 ? 'board' : 'answer')
```

- [ ] **Step 7: Run all four gates**

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:once
pnpm run build
```

Expected: all four exit 0. Fix anything that does not before continuing — in particular, `form.hook.test.ts` may reference the removed `#answer` node.

- [ ] **Step 8: Commit**

```bash
git add v2/src/components/board-entry/form.tsx
git commit -m "feat(entry): one region owns the keystroke stream"
```

---

## Task 9: The hand-off, asserted in a render

**Files:**
- Modify: `v2/src/components/board-entry/form.hook.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the existing `describe` in `v2/src/components/board-entry/form.hook.test.ts` (or a new one at the end of the file):

```ts
describe('the keystroke stream', () => {
  const type = (text: string) => {
    const region = screen.getByLabelText('Wordle board entry')
    for (const letter of text) {
      fireEvent.keyDown(region, { key: letter })
    }
  }

  /**
   * THE ACCEPTANCE CRITERION, in a unit test: a complete answer and a first
   * guess with NO CLICK between them. The behaviour this replaces required one,
   * and gave no sign that it did.
   */
  test('the fifth answer letter hands off, and the next letter lands on the board', () => {
    renderForm()
    type('CRANE')
    expect(screen.getAllByTestId('answer-slot').map((s) => s.textContent).join('')).toBe('CRANE')

    type('S')
    expect(screen.getByTestId('board-cursor').id).toBe('1-2')
  })

  test('the coach line announces the hand-off through the live region', () => {
    renderForm()
    const coach = screen.getByTestId('entry-coach')
    expect(coach.getAttribute('aria-live')).toBe('polite')
    expect(coach.textContent).toBe("Type today's answer — five letters")

    type('CRANE')
    expect(coach.textContent).toBe('Now type your first guess — rows advance on their own')
  })

  /**
   * The dead end, at the level a player meets it. Before this change, typing
   * here produced no state change and no message of any kind.
   */
  test('typing on the board before the answer is explained, not swallowed', () => {
    renderForm()
    // mouseDown on the region, NOT getByTestId('board-cursor') — there is no
    // board cursor to click at this point (that is the whole premise of the
    // test), and getByTestId throws rather than returning null, so a `??`
    // fallback would never run.
    fireEvent.mouseDown(screen.getByTestId('board-cursor-target'))
    type('S')
    expect(screen.getByTestId('entry-coach').textContent).toBe(
      'Answer first — then the board takes over',
    )
  })
})
```

`renderForm` is not a helper this file has today. Add it just below the existing
`afterEach(cleanup)`, lifting the props out of whichever `render(createElement(BoardEntryForm, {...}))`
call the file already makes so the two cannot drift:

```ts
const renderForm = () => {
  const rendered = render(createElement(BoardEntryForm, formProps))
  // The entry step, not the choose step: these tests are about typing, and the
  // choose step deliberately raises no keyboard.
  fireEvent.click(screen.getByRole('button', { name: /enter manually/i }))
  return rendered
}
```

where `formProps` is the existing call's props object, extracted to a `const` at module
scope. If the existing call passes its props inline, extract them in the same commit.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/board-entry/form.hook.test.ts`
Expected: FAIL — either the label does not resolve or the coach line is absent, depending on how far Task 8 got.

- [ ] **Step 3: Make it pass**

If Task 8 is complete these should pass as written. If they do not, fix `form.tsx` — not the test — until they do.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/board-entry/form.hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add v2/src/components/board-entry/form.hook.test.ts
git commit -m "test(entry): the hand-off happens with no click"
```

---

## Task 10: The zero-click e2e spec

**Files:**
- Modify: `v2/e2e/board-entry.spec.ts` (create if it does not exist)

- [ ] **Step 1: Find the existing board-entry e2e setup**

Run: `ls /home/cdub/projects/wordle-teams/v2/e2e/ && grep -rln "board" /home/cdub/projects/wordle-teams/v2/e2e/`

Use whichever sign-in helper the existing board specs use (`signInWithTeam` or equivalent) rather than inventing one.

- [ ] **Step 2: Write the spec**

Add to `v2/e2e/board-entry.spec.ts`:

```ts
/**
 * THE ACCEPTANCE CRITERION FOR wordle-teams-wty4.1.6, EXECUTABLE.
 *
 * One click to open the entry step, then nothing but typing. The behaviour this
 * replaced needed a second click to move from the answer to the board, gave no
 * sign that it did, and silently swallowed every keystroke typed before it.
 *
 * `page.keyboard.type` WITHOUT ANY LOCATOR CALL IS THE ASSERTION. Introducing a
 * `.click()` on the board to make this pass would delete the thing it tests.
 */
test('a complete board is entered with no click after the entry step opens', async ({ page }) => {
  await signInWithTeam(page)
  await openBoardEntry(page)
  await page.getByRole('button', { name: /enter manually/i }).click()

  await page.keyboard.type('CRANE')
  await page.keyboard.type('SLATE')
  await page.keyboard.type('CRANE')

  await expect(page.getByTestId('entry-coach')).toHaveText(/press Enter or Submit/)
  await page.keyboard.press('Enter')

  await expect(page.getByRole('dialog')).toBeHidden()
})
```

Adjust `signInWithTeam` / `openBoardEntry` to the helpers the file already uses.

- [ ] **Step 3: Run it**

Run: `pnpm run e2e -- board-entry`

**Before running, make sure nothing stale is holding port 3000** — Playwright attaches to whatever is already there, and a day-old dev server will test old code:

```bash
lsof -ti:3000 | xargs -r kill
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add v2/e2e/board-entry.spec.ts
git commit -m "test(e2e): a board entered with no click after the entry step"
```

---

## Task 11: Close out

- [ ] **Step 1: Run all four gates one final time**

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:once
pnpm run build
```

Expected: all four exit 0. Check each exit code separately — do not pipe them into one command, `$PIPESTATUS` is empty in this shell and a piped check can report a false green.

- [ ] **Step 2: Reproduce the original bug and confirm it is gone**

Open the app, start manual entry, click the board and type before entering an answer. Expected: the coach line reads "Answer first — then the board takes over" and the cursor stays in the answer slots. Before this change, nothing happened at all.

- [ ] **Step 3: Record the outcome on the issue**

```bash
bd update wordle-teams-wty4.1.6 --notes "$(cat <<'NOTE'
SHIPPED. Continuous entry per docs/superpowers/specs/2026-09-14-continuous-board-entry-design.md.
The dead end is closed by construction: no transition sets zone to board while the
answer is short, and typeLetter refuses by name rather than returning an unchanged
array. Coverage is in entry-cursor.test.ts, entry-coach.test.ts, answer-slots.hook.test.ts,
form.hook.test.ts and one e2e spec that types a whole board with no click.
NOTE
)"
bd close wordle-teams-wty4.1.6 --reason "Answered by design review and fixed: continuous keystroke stream, and the silent no-op when typing before an answer is gone."
```

- [ ] **Step 4: Push**

```bash
git pull --rebase
git push
git status
```

Expected: `git status` reports the branch up to date with origin.

- [ ] **Step 5: File the follow-ups the spec deferred**

```bash
bd create --title="Correcting a board after submitting is not discoverable" --type=task --priority=2 --description="The one item on the owner's 2026-09-14 entry-UX list that continuous entry did not address, deliberately: it is a question about whether the edit path is discoverable from the scoreboard, not about the entry model. See the Out of scope section of docs/superpowers/specs/2026-09-14-continuous-board-entry-design.md."

bd create --title="Guess-first entry: derive the answer from the winning row" --type=feature --priority=3 --description="Ruled out of wordle-teams-wty4.1.6 on a specific cost, not on merit. On a solved board the answer IS the last guess, so entry could stop asking for it and only prompt when the player missed it -- deleting a whole field from the common path. The cost: tiles cannot be coloured until the answer is known, so the board resolves all at once at the end instead of row by row. Worth revisiting on its own. See the Decisions section of docs/superpowers/specs/2026-09-14-continuous-board-entry-design.md."
```

---

## Self-review notes

**Spec coverage.** Every section maps to a task: the state machine (1-3), the coach line (4), the rendered caret (5-6), the single region and the aria-live mitigation (8), the scroll-on-hand-off (8 step 4), the post-import zone (8 step 6), and every acceptance criterion (1-6 in Tasks 1-8, criterion 7 in Tasks 10-11). The two out-of-scope items are filed as follow-ups in Task 11 rather than dropped.

**Known risk to watch in Task 8.** The region is one `contentEditable` wrapping both zones, which is a larger React-owned subtree inside an editable host than the board alone was. The `onBeforeInput` and `onPaste` guards are what make that safe and they are not optional — if the board renders wrong after a mobile swipe-type or a dictation, that is the first place to look.

**Deliberate omission.** No lock or dim on the board, per the owner's decision. If the coach line turns out not to be enough for the early-click case, the third state is specified in the spec's Decisions section and can be added without touching the state machine.
