# Clue Ladder Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the clue ladder's pure puzzle engine (orders, clues, ladder rules, seeded generator) and a score-spread simulation that decides, before any app code, whether the mechanic clears the bar in spec section 8.

**Architecture:** Pure TypeScript modules under `convex/lib/clueLadder/`, with no Convex imports, so the generator and solver later serve the Convex functions (plan 3) unchanged. A Node runner script, `scripts/clue-ladder-sim.mjs`, imports them directly; Node 25 strips TypeScript types on import. Monthly scoring reuses `pointsFor` and `DEFAULT_SYSTEM` from `convex/lib/scoring.ts` and `convex/lib/scoringSystem.ts`.

**Tech Stack:** TypeScript (erasable syntax only: no enums, no parameter properties, no namespaces), Vitest (`edge-runtime` env), Node 25 for the runner.

**Spec:** `docs/superpowers/specs/2026-10-14-clue-ladder-design.md` (sections 3 and 8).

---

## Ground rules for every task

- Imports between these modules use explicit `.ts` extensions (`import { x } from './orders.ts'`), and type-only imports use `import type` / `type` modifiers (`verbatimModuleSyntax` is on).
- `$SCRATCH` below means the session scratchpad directory. Gate and script logs go there, not into the repo.
- Run a single test file with: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/<file>.test.ts`
- **Never pipe a gate into `tail`/`grep`.** zsh has no `PIPESTATUS`, so a piped red gate reads as green. Redirect to a file, read `$?`, then read the file.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use a quoted heredoc (`git commit -F - <<'EOF'`), since backticks in `-m "..."` get executed. Never `--no-verify`.
- After each task, close its Beads issue (`bd close <id>`) and include `.beads/issues.jsonl` in the commit. Then run `git show HEAD:.beads/issues.jsonl | rg '"id":"<id>"'` and check it says `"status":"closed"`. If it doesn't, the export lagged: `git add .beads/issues.jsonl && git commit --amend --no-edit`.

## Beads issues

Epic: `wordle-teams-9j7o.2.3.1`. Each task blocks the next. The ids are not in task order because of how they were created.

| Task | Issue |
|---|---|
| 1 Shapes and orders | `wordle-teams-9j7o.2.3.1.1` |
| 2 Clues | `wordle-teams-9j7o.2.3.1.5` |
| 3 Seeded PRNG | `wordle-teams-9j7o.2.3.1.2` |
| 4 Ladder rules | `wordle-teams-9j7o.2.3.1.6` |
| 5 Generator | `wordle-teams-9j7o.2.3.1.3` |
| 6 Simulation core | `wordle-teams-9j7o.2.3.1.7` |
| 7 Runner script | `wordle-teams-9j7o.2.3.1.4` |
| 8 Run, tune, record | `wordle-teams-9j7o.2.3.1.8` |

Claim each with `bd update <id> --claim` before starting it. Close the epic after Task 8.

## File structure

| File | Responsibility |
|---|---|
| `convex/lib/clueLadder/orders.ts` | Shapes, the `Order` type, all 120 orders, order validation, display symbols |
| `convex/lib/clueLadder/clues.ts` | The `Clue` union, `holds`, `candidateClues`, `clueText` |
| `convex/lib/clueLadder/rng.ts` | Seeded PRNG (mulberry32) with `int`, `pick`, `shuffle`, `weighted` |
| `convex/lib/clueLadder/ladder.ts` | `remainingAfter`, `survivors`, `ladderProblem`: the three ladder rules |
| `convex/lib/clueLadder/generate.ts` | `GeneratorParams`, `DEFAULT_PARAMS`, `generatePuzzle(seed, params)` |
| `convex/lib/clueLadder/points.ts` | The clue ladder's fixed X value and `clueLadderSystem` (team points with X = −1) |
| `convex/lib/clueLadder/simulate.ts` | Player strategies, `simulate`, `checkBar`, `formatReport` |
| `scripts/clue-ladder-sim.mjs` | CLI runner: prints sample puzzles, the report and the bar verdict |

Each `.ts` file has a sibling `.test.ts`.

---

### Task 1: Shapes and orders

**Files:**
- Create: `convex/lib/clueLadder/orders.ts`
- Test: `convex/lib/clueLadder/orders.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// convex/lib/clueLadder/orders.test.ts
import { describe, expect, test } from 'vitest'
import { ALL_ORDERS, isOrder, orderKey, SHAPE_SYMBOLS, SHAPES, SLOT_COUNT } from './orders.ts'

describe('orders', () => {
  test('there are five shapes and five slots', () => {
    expect(SHAPES).toHaveLength(5)
    expect(SLOT_COUNT).toBe(5)
  })

  test('ALL_ORDERS is every permutation exactly once', () => {
    expect(ALL_ORDERS).toHaveLength(120)
    expect(new Set(ALL_ORDERS.map(orderKey)).size).toBe(120)
    for (const order of ALL_ORDERS) expect(isOrder(order)).toBe(true)
  })

  test('isOrder rejects wrong length, repeats and unknown shapes', () => {
    expect(isOrder(['triangle', 'square', 'circle', 'diamond'])).toBe(false)
    expect(isOrder(['triangle', 'triangle', 'circle', 'diamond', 'star'])).toBe(false)
    expect(isOrder(['triangle', 'square', 'circle', 'diamond', 'hexagon'])).toBe(false)
    expect(isOrder(['star', 'diamond', 'circle', 'square', 'triangle'])).toBe(true)
  })

  test('every shape has a distinct symbol', () => {
    expect(new Set(SHAPES.map((s) => SHAPE_SYMBOLS[s])).size).toBe(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/orders.test.ts`
Expected: FAIL, cannot resolve `./orders.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// convex/lib/clueLadder/orders.ts
/**
 * The clue ladder's board: five distinct shapes in a row. An Order is one
 * arrangement, index 0 = leftmost slot. Shapes differ by outline, not colour,
 * so the game reads the same for colour-blind players (spec section 6).
 *
 * Pure and Convex-free: the generator, the Convex functions and the
 * simulation runner (plain Node) all import this.
 */
export const SHAPES = ['triangle', 'square', 'circle', 'diamond', 'star'] as const
export type Shape = (typeof SHAPES)[number]
export type Order = readonly Shape[]

export const SLOT_COUNT = SHAPES.length

export const SHAPE_SYMBOLS: Readonly<Record<Shape, string>> = {
  triangle: '▲',
  square: '■',
  circle: '●',
  diamond: '◆',
  star: '★',
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()]
  const out: T[][] = []
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) out.push([item, ...tail])
  })
  return out
}

/** All 120 orders, computed once. */
export const ALL_ORDERS: readonly Order[] = permutations(SHAPES)

/** True when `value` is a full order: five slots holding each shape once. */
export function isOrder(value: readonly string[]): value is Order {
  return value.length === SLOT_COUNT && SHAPES.every((shape) => value.includes(shape))
}

export function orderKey(order: Order): string {
  return order.join(',')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/orders.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/clueLadder/orders.ts convex/lib/clueLadder/orders.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): shapes and the 120 orders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Clues

**Files:**
- Create: `convex/lib/clueLadder/clues.ts`
- Test: `convex/lib/clueLadder/clues.test.ts`

- [ ] **Step 1: Write the failing test**

Every clue kind is tested on both sides (true and false), because a predicate tested from one side only proves nothing about its boundary.

```ts
// convex/lib/clueLadder/clues.test.ts
import { describe, expect, test } from 'vitest'
import { candidateClues, clueText, holds, type Clue } from './clues.ts'
import { ALL_ORDERS, type Order } from './orders.ts'

// ▲ ■ ● ◆ ★
const ORDER: Order = ['triangle', 'square', 'circle', 'diamond', 'star']

describe('holds', () => {
  test.each<[Clue, boolean]>([
    [{ kind: 'atEnd', shape: 'triangle', negated: false }, true],
    [{ kind: 'atEnd', shape: 'star', negated: false }, true],
    [{ kind: 'atEnd', shape: 'circle', negated: false }, false],
    [{ kind: 'atEnd', shape: 'circle', negated: true }, true],
    [{ kind: 'atEnd', shape: 'triangle', negated: true }, false],
    [{ kind: 'inSlot', shape: 'circle', slot: 2, negated: false }, true],
    [{ kind: 'inSlot', shape: 'circle', slot: 1, negated: false }, false],
    [{ kind: 'inSlot', shape: 'circle', slot: 1, negated: true }, true],
    [{ kind: 'inSlot', shape: 'circle', slot: 2, negated: true }, false],
    [{ kind: 'leftOf', a: 'triangle', b: 'star' }, true],
    [{ kind: 'leftOf', a: 'star', b: 'triangle' }, false],
    [{ kind: 'rightOf', a: 'star', b: 'triangle' }, true],
    [{ kind: 'rightOf', a: 'triangle', b: 'star' }, false],
    [{ kind: 'nextTo', a: 'square', b: 'circle', negated: false }, true],
    [{ kind: 'nextTo', a: 'square', b: 'diamond', negated: false }, false],
    [{ kind: 'nextTo', a: 'square', b: 'diamond', negated: true }, true],
    [{ kind: 'nextTo', a: 'square', b: 'circle', negated: true }, false],
    [{ kind: 'between', shape: 'circle', a: 'triangle', b: 'star' }, true],
    [{ kind: 'between', shape: 'circle', a: 'star', b: 'triangle' }, true],
    [{ kind: 'between', shape: 'triangle', a: 'square', b: 'star' }, false],
    [{ kind: 'apart', a: 'triangle', b: 'circle', distance: 2 }, true],
    [{ kind: 'apart', a: 'triangle', b: 'circle', distance: 3 }, false],
    [{ kind: 'apart', a: 'triangle', b: 'star', distance: 4 }, true],
  ])('%j on ▲■●◆★ is %s', (clue, expected) => {
    expect(holds(clue, ORDER)).toBe(expected)
  })
})

describe('candidateClues', () => {
  test('every candidate is true for the answer', () => {
    const clues = candidateClues(ORDER)
    expect(clues.length).toBeGreaterThan(40)
    for (const clue of clues) expect(holds(clue, ORDER)).toBe(true)
  })

  test('every clue kind appears for an arbitrary answer', () => {
    const kinds = new Set(candidateClues(ORDER).map((c) => c.kind))
    expect([...kinds].sort()).toEqual(
      ['apart', 'atEnd', 'between', 'inSlot', 'leftOf', 'nextTo', 'rightOf'],
    )
  })

  test('the candidates together pin down the answer uniquely', () => {
    const clues = candidateClues(ORDER)
    const left = ALL_ORDERS.filter((o) => clues.every((c) => holds(c, o)))
    expect(left).toEqual([ORDER])
  })
})

describe('clueText', () => {
  test.each<[Clue, string]>([
    [{ kind: 'atEnd', shape: 'triangle', negated: false }, '▲ is at one end'],
    [{ kind: 'atEnd', shape: 'circle', negated: true }, '● is not at either end'],
    [{ kind: 'inSlot', shape: 'circle', slot: 2, negated: false }, '● is third'],
    [{ kind: 'inSlot', shape: 'circle', slot: 0, negated: true }, '● is not first'],
    [{ kind: 'leftOf', a: 'triangle', b: 'star' }, '▲ is somewhere left of ★'],
    [{ kind: 'rightOf', a: 'star', b: 'triangle' }, '★ is somewhere right of ▲'],
    [{ kind: 'nextTo', a: 'square', b: 'circle', negated: false }, '■ is next to ●'],
    [{ kind: 'nextTo', a: 'square', b: 'diamond', negated: true }, '■ is not next to ◆'],
    [{ kind: 'between', shape: 'circle', a: 'triangle', b: 'star' }, '● is somewhere between ▲ and ★'],
    [{ kind: 'apart', a: 'triangle', b: 'circle', distance: 2 }, 'Exactly 1 shape sits between ▲ and ●'],
    [{ kind: 'apart', a: 'triangle', b: 'star', distance: 4 }, 'Exactly 3 shapes sit between ▲ and ★'],
  ])('%j reads "%s"', (clue, text) => {
    expect(clueText(clue)).toBe(text)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/clues.test.ts`
Expected: FAIL, cannot resolve `./clues.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// convex/lib/clueLadder/clues.ts
import { SHAPE_SYMBOLS, SHAPES, SLOT_COUNT, type Order, type Shape } from './orders.ts'

/**
 * A clue is a true/false test over an Order. Slots are 0-based internally
 * and shown 1-based ("first") to players.
 *
 * leftOf and rightOf are the same relation with the operands swapped. Both
 * exist so a ladder can phrase it either way; the generator's per-kind cap
 * treats them as separate kinds.
 */
export type Clue =
  | { kind: 'atEnd'; shape: Shape; negated: boolean }
  | { kind: 'inSlot'; shape: Shape; slot: number; negated: boolean }
  | { kind: 'leftOf'; a: Shape; b: Shape }
  | { kind: 'rightOf'; a: Shape; b: Shape }
  | { kind: 'nextTo'; a: Shape; b: Shape; negated: boolean }
  | { kind: 'between'; shape: Shape; a: Shape; b: Shape }
  | { kind: 'apart'; a: Shape; b: Shape; distance: number }

export type ClueKind = Clue['kind']

export function holds(clue: Clue, order: Order): boolean {
  const at = (shape: Shape) => order.indexOf(shape)
  switch (clue.kind) {
    case 'atEnd': {
      const p = at(clue.shape)
      return (p === 0 || p === SLOT_COUNT - 1) !== clue.negated
    }
    case 'inSlot':
      return (at(clue.shape) === clue.slot) !== clue.negated
    case 'leftOf':
      return at(clue.a) < at(clue.b)
    case 'rightOf':
      return at(clue.a) > at(clue.b)
    case 'nextTo':
      return (Math.abs(at(clue.a) - at(clue.b)) === 1) !== clue.negated
    case 'between': {
      const p = at(clue.shape)
      const a = at(clue.a)
      const b = at(clue.b)
      return Math.min(a, b) < p && p < Math.max(a, b)
    }
    case 'apart':
      return Math.abs(at(clue.a) - at(clue.b)) === clue.distance
  }
}

/**
 * Every clue in the vocabulary that is TRUE for `answer`. Symmetric relations
 * (nextTo, apart, between's two ends) appear once, with operands in SHAPES
 * order. apart starts at distance 2 because distance 1 is nextTo.
 */
export function candidateClues(answer: Order): Clue[] {
  const all: Clue[] = []
  for (const shape of SHAPES) {
    for (const negated of [false, true]) all.push({ kind: 'atEnd', shape, negated })
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      for (const negated of [false, true]) all.push({ kind: 'inSlot', shape, slot, negated })
    }
  }
  SHAPES.forEach((a, i) => {
    SHAPES.forEach((b, j) => {
      if (i === j) return
      all.push({ kind: 'leftOf', a, b }, { kind: 'rightOf', a, b })
      if (i < j) {
        for (const negated of [false, true]) all.push({ kind: 'nextTo', a, b, negated })
        for (let distance = 2; distance < SLOT_COUNT; distance++) {
          all.push({ kind: 'apart', a, b, distance })
        }
      }
    })
  })
  for (const shape of SHAPES) {
    SHAPES.forEach((a, i) => {
      SHAPES.forEach((b, j) => {
        if (i < j && shape !== a && shape !== b) all.push({ kind: 'between', shape, a, b })
      })
    })
  }
  return all.filter((clue) => holds(clue, answer))
}

const SLOT_NAMES = ['first', 'second', 'third', 'fourth', 'fifth'] as const

/** Plain-English text for a clue. Final player-facing copy is settled in plan 3. */
export function clueText(clue: Clue): string {
  const s = (shape: Shape) => SHAPE_SYMBOLS[shape]
  switch (clue.kind) {
    case 'atEnd':
      return clue.negated ? `${s(clue.shape)} is not at either end` : `${s(clue.shape)} is at one end`
    case 'inSlot':
      return `${s(clue.shape)} is ${clue.negated ? 'not ' : ''}${SLOT_NAMES[clue.slot]}`
    case 'leftOf':
      return `${s(clue.a)} is somewhere left of ${s(clue.b)}`
    case 'rightOf':
      return `${s(clue.a)} is somewhere right of ${s(clue.b)}`
    case 'nextTo':
      return `${s(clue.a)} is ${clue.negated ? 'not ' : ''}next to ${s(clue.b)}`
    case 'between':
      return `${s(clue.shape)} is somewhere between ${s(clue.a)} and ${s(clue.b)}`
    case 'apart': {
      const gap = clue.distance - 1
      return `Exactly ${gap} shape${gap === 1 ? '' : 's'} sit${gap === 1 ? 's' : ''} between ${s(clue.a)} and ${s(clue.b)}`
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/clues.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/clueLadder/clues.ts convex/lib/clueLadder/clues.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): clue vocabulary, truth test and text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Seeded random numbers

**Files:**
- Create: `convex/lib/clueLadder/rng.ts`
- Test: `convex/lib/clueLadder/rng.test.ts`

Background: the generator must give the same puzzle for the same seed on every machine. `Math.random` cannot be seeded, so this uses mulberry32, a small well-known 32-bit PRNG. It is not cryptographic. Secrecy comes from how plan 3 derives the seed (an HMAC of the date under a server-only secret), not from this function.

- [ ] **Step 1: Write the failing test**

```ts
// convex/lib/clueLadder/rng.test.ts
import { describe, expect, test } from 'vitest'
import { createRng } from './rng.ts'

describe('createRng', () => {
  test('the same seed gives the same sequence', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  test('different seeds give different sequences', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next())
  })

  test('next is in [0, 1) and int(n) is in [0, n)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 5000; i++) {
      const x = rng.next()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      const k = rng.int(6)
      expect(Number.isInteger(k)).toBe(true)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThan(6)
    }
  })

  test('int(n) reaches every value', () => {
    const rng = createRng(9)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(rng.int(6))
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5])
  })

  test('shuffle is a permutation and leaves its input alone', () => {
    const input = [1, 2, 3, 4, 5]
    const out = createRng(3).shuffle(input)
    expect(input).toEqual([1, 2, 3, 4, 5])
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
  })

  test('pick throws on an empty list', () => {
    expect(() => createRng(1).pick([])).toThrow()
  })

  test('weighted never returns a zero-weight key and roughly follows weights', () => {
    const rng = createRng(11)
    const counts = new Map<string, number>()
    for (let i = 0; i < 10000; i++) {
      const k = rng.weighted([['a', 3], ['b', 1], ['never', 0]])
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    expect(counts.get('never')).toBeUndefined()
    const ratio = (counts.get('a') ?? 0) / (counts.get('b') ?? 1)
    expect(ratio).toBeGreaterThan(2.5)
    expect(ratio).toBeLessThan(3.5)
  })

  test('weighted throws when all weights are zero', () => {
    expect(() => createRng(1).weighted([['a', 0]])).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/rng.test.ts`
Expected: FAIL, cannot resolve `./rng.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// convex/lib/clueLadder/rng.ts
/** A deterministic PRNG (mulberry32). Not cryptographic; see plan 3 for seed secrecy. */
export type Rng = {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [0, n). */
  int(n: number): number
  pick<T>(items: readonly T[]): T
  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[]
  /** A key chosen with probability proportional to its weight. */
  weighted<K>(entries: ReadonlyArray<readonly [K, number]>): K
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  return {
    next,
    int,
    pick(items) {
      if (items.length === 0) throw new Error('pick from an empty list')
      return items[int(items.length)]
    },
    shuffle(items) {
      const out = items.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1)
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
    weighted(entries) {
      const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0)
      if (total <= 0) throw new Error('weighted needs a positive total weight')
      let roll = next() * total
      for (const [key, w] of entries) {
        if (w <= 0) continue
        roll -= w
        if (roll < 0) return key
      }
      // Floating-point edge: return the last positive-weight key.
      return [...entries].reverse().find(([, w]) => w > 0)![0]
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/rng.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/clueLadder/rng.ts convex/lib/clueLadder/rng.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): seeded PRNG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Ladder rules

**Files:**
- Create: `convex/lib/clueLadder/ladder.ts`
- Test: `convex/lib/clueLadder/ladder.test.ts`

Ladders are 4–6 clues (spec section 3; 3-clue ladders were dropped because the rules almost never allow them). The three rules from spec section 3: every clue removes at least one order still possible; after the last clue exactly one order remains; before the last clue more than one remains. The third follows from the first two (counts strictly decrease and end at 1), so `ladderProblem` checks length, truth, progress and uniqueness.

- [ ] **Step 1: Write the failing test**

```ts
// convex/lib/clueLadder/ladder.test.ts
import { describe, expect, test } from 'vitest'
import type { Clue } from './clues.ts'
import { ladderProblem, MAX_CLUES, MIN_CLUES, remainingAfter, survivors } from './ladder.ts'
import type { Order } from './orders.ts'

const ANSWER: Order = ['triangle', 'square', 'circle', 'diamond', 'star']
const slot = (shape: Order[number], s: number): Clue => ({ kind: 'inSlot', shape, slot: s, negated: false })

// Fixing slots one at a time: 120 → 24 → 6 → 2 → 1.
const VALID: Clue[] = [slot('triangle', 0), slot('square', 1), slot('circle', 2), slot('diamond', 3)]

describe('remainingAfter', () => {
  test('counts the orders still possible after each clue', () => {
    expect(remainingAfter(VALID)).toEqual([24, 6, 2, 1])
  })

  test('is empty for no clues', () => {
    expect(remainingAfter([])).toEqual([])
  })
})

describe('survivors', () => {
  test('returns exactly the orders consistent with every clue', () => {
    expect(survivors(VALID.slice(0, 3))).toEqual([
      ['triangle', 'square', 'circle', 'diamond', 'star'],
      ['triangle', 'square', 'circle', 'star', 'diamond'],
    ])
  })
})

describe('ladderProblem', () => {
  test('accepts a valid ladder', () => {
    expect(MIN_CLUES).toBe(4)
    expect(MAX_CLUES).toBe(6)
    expect(ladderProblem(ANSWER, VALID)).toBeNull()
  })

  test('rejects a ladder that is too short or too long', () => {
    // Two clues that do pin the answer: still too short.
    const two: Clue[] = [
      { kind: 'between', shape: 'circle', a: 'square', b: 'diamond' },
      slot('triangle', 0),
    ]
    expect(ladderProblem(ANSWER, two)).toBe('length')
    const seven: Clue[] = [...VALID, ...VALID.slice(0, 3)]
    expect(ladderProblem(ANSWER, seven)).toBe('length')
  })

  test('rejects a clue that is false for the answer', () => {
    const lying: Clue[] = [slot('star', 0), ...VALID.slice(1)]
    expect(ladderProblem(ANSWER, lying)).toBe('false-clue')
  })

  test('rejects a clue that removes nothing', () => {
    const wasted: Clue[] = [slot('triangle', 0), slot('triangle', 0), ...VALID.slice(1)]
    expect(ladderProblem(ANSWER, wasted)).toBe('no-progress')
  })

  test('rejects a ladder that does not end on one order', () => {
    // 24 → 6 → 3 → 2: four true, useful clues, but two orders remain.
    const open: Clue[] = [
      slot('triangle', 0),
      slot('square', 1),
      { kind: 'leftOf', a: 'circle', b: 'diamond' },
      { kind: 'nextTo', a: 'circle', b: 'diamond', negated: false },
    ]
    expect(remainingAfter(open)).toEqual([24, 6, 3, 2])
    expect(ladderProblem(ANSWER, open)).toBe('not-unique')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/ladder.test.ts`
Expected: FAIL, cannot resolve `./ladder.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// convex/lib/clueLadder/ladder.ts
import { holds, type Clue } from './clues.ts'
import { ALL_ORDERS, type Order } from './orders.ts'

export const MIN_CLUES = 4
export const MAX_CLUES = 6

/** The orders consistent with every clue, in ALL_ORDERS order. */
export function survivors(clues: readonly Clue[], orders: readonly Order[] = ALL_ORDERS): Order[] {
  return orders.filter((order) => clues.every((clue) => holds(clue, order)))
}

/** remaining[i] = orders still possible after clue i + 1. */
export function remainingAfter(clues: readonly Clue[]): number[] {
  const counts: number[] = []
  let left: readonly Order[] = ALL_ORDERS
  for (const clue of clues) {
    left = left.filter((order) => holds(clue, order))
    counts.push(left.length)
  }
  return counts
}

export type LadderProblem = 'length' | 'false-clue' | 'no-progress' | 'not-unique'

/** Null when the ladder obeys spec section 3's rules, else the first rule it breaks. */
export function ladderProblem(answer: Order, clues: readonly Clue[]): LadderProblem | null {
  if (clues.length < MIN_CLUES || clues.length > MAX_CLUES) return 'length'
  if (!clues.every((clue) => holds(clue, answer))) return 'false-clue'
  const remaining = remainingAfter(clues)
  let previous = ALL_ORDERS.length
  for (const count of remaining) {
    if (count >= previous) return 'no-progress'
    previous = count
  }
  if (previous !== 1) return 'not-unique'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/ladder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/clueLadder/ladder.ts convex/lib/clueLadder/ladder.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): ladder rules and remaining-order counts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Puzzle generator

**Files:**
- Create: `convex/lib/clueLadder/generate.ts`
- Test: `convex/lib/clueLadder/generate.test.ts`

Design: for each seed, pick the answer, a target ladder length (4–6) and a target number of orders left before the final clue (2, 3, or "4 or more") from weighted tables. Then randomly build a ladder that hits both targets, retrying up to `attempts` times. If every attempt fails, fall back to fixing four slots in random order (always valid: 120 → 24 → 6 → 2 → 1). The weight tables are the tuning knobs Task 8 adjusts.

- [ ] **Step 1: Write the failing test**

```ts
// convex/lib/clueLadder/generate.test.ts
import { describe, expect, test } from 'vitest'
import { DEFAULT_PARAMS, generatePuzzle, type GeneratorParams } from './generate.ts'
import { ladderProblem, MAX_CLUES, MIN_CLUES, remainingAfter } from './ladder.ts'
import { isOrder } from './orders.ts'

const SEEDS = Array.from({ length: 1500 }, (_, i) => i * 7919 + 1)
// Generated once at collection time, outside any test's 5 s timeout.
const PUZZLES = SEEDS.map((seed) => ({ seed, puzzle: generatePuzzle(seed) }))

describe('generatePuzzle', () => {
  test('every ladder obeys the rules across many seeds', () => {
    for (const { seed, puzzle: p } of PUZZLES) {
      expect(isOrder(p.answer)).toBe(true)
      expect(ladderProblem(p.answer, p.clues), `seed ${seed}`).toBeNull()
      expect(p.remaining).toEqual(remainingAfter(p.clues))
    }
  })

  test('the same seed always gives the same puzzle', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      expect(generatePuzzle(seed)).toEqual(generatePuzzle(seed))
    }
  })

  test('different seeds give varied answers and lengths', () => {
    const puzzles = PUZZLES.map(({ puzzle }) => puzzle)
    expect(new Set(puzzles.map((p) => p.answer.join())).size).toBeGreaterThan(100)
    const lengths = new Set(puzzles.map((p) => p.clues.length))
    for (let n = MIN_CLUES; n <= MAX_CLUES; n++) expect(lengths.has(n), `length ${n}`).toBe(true)
  })

  test('no clue kind is used more than maxPerKind times, except in the fallback', () => {
    for (const { puzzle: p } of PUZZLES) {
      if (p.fallback) continue
      const counts = new Map<string, number>()
      for (const c of p.clues) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1)
      for (const n of counts.values()) expect(n).toBeLessThanOrEqual(DEFAULT_PARAMS.maxPerKind)
    }
  })

  test('the fallback is rare with default params', () => {
    const fallbacks = PUZZLES.filter(({ puzzle }) => puzzle.fallback).length
    expect(fallbacks / SEEDS.length).toBeLessThan(0.05)
  })

  test('the before-last target is honoured when not falling back', () => {
    const onlyTwo: GeneratorParams = { ...DEFAULT_PARAMS, beforeLastWeights: [[2, 1]] }
    for (const seed of SEEDS.slice(0, 200)) {
      const p = generatePuzzle(seed, onlyTwo)
      if (p.fallback) continue
      expect(p.remaining[p.remaining.length - 2]).toBe(2)
    }
  })

  test('the fallback ladder is itself valid', () => {
    const impossible: GeneratorParams = { ...DEFAULT_PARAMS, attempts: 0 }
    const p = generatePuzzle(5, impossible)
    expect(p.fallback).toBe(true)
    expect(ladderProblem(p.answer, p.clues)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/generate.test.ts`
Expected: FAIL, cannot resolve `./generate.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// convex/lib/clueLadder/generate.ts
import { candidateClues, holds, type Clue, type ClueKind } from './clues.ts'
import { remainingAfter } from './ladder.ts'
import { ALL_ORDERS, SHAPES, type Order } from './orders.ts'
import { createRng, type Rng } from './rng.ts'

export type GeneratorParams = {
  /** [ladder length, weight]; lengths must be 4–6. */
  lengthWeights: ReadonlyArray<readonly [number, number]>
  /** [orders left before the final clue, weight]; 4 means "4 or more". */
  beforeLastWeights: ReadonlyArray<readonly [number, number]>
  /** No clue kind appears more than this many times in one ladder. */
  maxPerKind: number
  /** Random build attempts before falling back. */
  attempts: number
}

/** Starting values. Task 8 of the simulation plan tunes these. */
export const DEFAULT_PARAMS: GeneratorParams = {
  lengthWeights: [
    [4, 3],
    [5, 3],
    [6, 2],
  ],
  beforeLastWeights: [
    [2, 3],
    [3, 2],
    [4, 1],
  ],
  maxPerKind: 2,
  attempts: 400,
}

export type Puzzle = {
  answer: Order
  clues: Clue[]
  /** remaining[i] = orders still possible after clue i + 1. */
  remaining: number[]
  /** True when the random build gave up and the four-slot fallback was used. */
  fallback: boolean
}

export function generatePuzzle(seed: number, params: GeneratorParams = DEFAULT_PARAMS): Puzzle {
  const rng = createRng(seed)
  const answer: Order = rng.shuffle(SHAPES)
  const pool = candidateClues(answer)
  const length = rng.weighted(params.lengthWeights)
  const beforeLast = rng.weighted(params.beforeLastWeights)
  for (let i = 0; i < params.attempts; i++) {
    const clues = tryLadder(rng, pool, length, beforeLast, params.maxPerKind)
    if (clues) return { answer, clues, remaining: remainingAfter(clues), fallback: false }
  }
  const clues = fallbackLadder(rng, answer)
  return { answer, clues, remaining: remainingAfter(clues), fallback: true }
}

function countHolding(clue: Clue, orders: readonly Order[]): number {
  let n = 0
  for (const order of orders) if (holds(clue, order)) n++
  return n
}

function tryLadder(
  rng: Rng,
  pool: readonly Clue[],
  length: number,
  beforeLast: number,
  maxPerKind: number,
): Clue[] | null {
  const clues: Clue[] = []
  const used = new Map<ClueKind, number>()
  let left: readonly Order[] = ALL_ORDERS
  for (let step = 1; step <= length; step++) {
    const options = pool.filter((clue) => {
      if ((used.get(clue.kind) ?? 0) >= maxPerKind) return false
      const n = countHolding(clue, left)
      if (n >= left.length) return false // must remove at least one order
      if (step === length) return n === 1
      if (step === length - 1) return beforeLast >= 4 ? n >= 4 : n === beforeLast
      return n > beforeLast
    })
    if (options.length === 0) return null
    const clue = rng.pick(options)
    clues.push(clue)
    used.set(clue.kind, (used.get(clue.kind) ?? 0) + 1)
    left = left.filter((order) => holds(clue, order))
  }
  return clues
}

/** Fix four slots in random order: 120 → 24 → 6 → 2 → 1. Always a valid ladder. */
function fallbackLadder(rng: Rng, answer: Order): Clue[] {
  const slots = rng.shuffle([0, 1, 2, 3, 4]).slice(0, 4)
  return slots.map((slot): Clue => ({ kind: 'inSlot', shape: answer[slot], slot, negated: false }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/generate.test.ts`
Expected: PASS. If **"the fallback is rare"** fails, do not loosen the test. Report the measured rate in the task's Beads notes and raise `attempts` (up to 2000) or relax `maxPerKind` to 3. Rerun, and record which change fixed it.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/clueLadder/generate.ts convex/lib/clueLadder/generate.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): seeded puzzle generator with tuning weights

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Simulation core

**Files:**
- Create: `convex/lib/clueLadder/points.ts`
- Create: `convex/lib/clueLadder/simulate.ts`
- Test: `convex/lib/clueLadder/points.test.ts`
- Test: `convex/lib/clueLadder/simulate.test.ts`

Model (spec section 8):

- A player locks in at the first clue where the orders still possible are at or below their threshold: careful 1, bold 2, reckless 3. Mixed picks one of the three each day.
- Locking in with `r` orders left succeeds with probability `1/r`; the player guesses uniformly among them. Success scores the clue number, failure scores 7 (X).
- The model assumes players count possibilities perfectly. Real players will not, so treat the results as an upper bound on how well the careful strategy does.
- Monthly winner: highest total of `pointsFor(attempts, clueLadderSystem(DEFAULT_SYSTEM))`, i.e. the team's default points with X fixed at −1 (owner decision 2026-10-14; spec section 2). When players tie, the win is split equally among them.
- The bar (spec section 8): careful players win 10–50% of months; no player type wins more than half of months; bold players fail 15–35% of days. The tie-for-first rate is reported but is not part of the bar.

- [ ] **Step 1: Write the failing tests**

```ts
// convex/lib/clueLadder/points.test.ts
import { describe, expect, test } from 'vitest'
import { pointsFor } from '../scoring.ts'
import { COMPETITIVE_SYSTEM, DEFAULT_SYSTEM } from '../scoringSystem.ts'
import { CLUE_LADDER_FAILED_POINTS, clueLadderSystem } from './points.ts'

describe('clueLadderSystem', () => {
  test('X is fixed at -1 whatever the team uses', () => {
    expect(CLUE_LADDER_FAILED_POINTS).toBe(-1)
    expect(pointsFor(7, clueLadderSystem(DEFAULT_SYSTEM))).toBe(-1)
    expect(pointsFor(7, clueLadderSystem(COMPETITIVE_SYSTEM))).toBe(-1)
  })

  test('every other value is the team\'s own', () => {
    const system = clueLadderSystem(COMPETITIVE_SYSTEM)
    for (const attempts of [1, 2, 3, 4, 5, 6, 0]) {
      expect(pointsFor(attempts, system)).toBe(pointsFor(attempts, COMPETITIVE_SYSTEM))
    }
  })

  test('does not mutate the team system', () => {
    const team = { ...DEFAULT_SYSTEM }
    clueLadderSystem(team)
    expect(team.failed).toBe(DEFAULT_SYSTEM.failed)
  })
})
```

```ts
// convex/lib/clueLadder/simulate.test.ts
import { describe, expect, test } from 'vitest'
import { createRng } from './rng.ts'
import {
  checkBar,
  DEFAULT_TEAM,
  FAIL,
  formatReport,
  playDay,
  simulate,
  type SimReport,
} from './simulate.ts'

describe('playDay', () => {
  const remaining = [24, 6, 2, 1]

  test('careful locks in at the proving clue and never fails', () => {
    const rng = createRng(1)
    for (let i = 0; i < 100; i++) expect(playDay(remaining, 1, rng)).toBe(4)
  })

  test('bold locks in when two remain: clue 3 or X, about half each', () => {
    const rng = createRng(2)
    const results = Array.from({ length: 2000 }, () => playDay(remaining, 2, rng))
    expect(new Set(results)).toEqual(new Set([3, FAIL]))
    const wins = results.filter((r) => r === 3).length / results.length
    expect(wins).toBeGreaterThan(0.45)
    expect(wins).toBeLessThan(0.55)
  })
})

describe('simulate', () => {
  const report = simulate({ months: 20, daysPerMonth: 28, team: DEFAULT_TEAM, seed: 1 })

  test('counts every player-day exactly once', () => {
    const total = Object.values(report.scoreCounts).reduce(
      (sum, counts) => sum + counts.reduce((a, b) => a + b, 0),
      0,
    )
    expect(total).toBe(20 * 28 * DEFAULT_TEAM.length)
    expect(report.days).toBe(20 * 28)
  })

  test('careful players never fail', () => {
    expect(report.failRate.careful).toBe(0)
  })

  test('month win shares sum to 1', () => {
    const sum = Object.values(report.monthWinShare).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 9)
  })

  test('rates are within [0, 1]', () => {
    for (const r of [...Object.values(report.failRate), report.tieForFirstRate, report.fallbackRate]) {
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1)
    }
  })

  test('the same seed gives the same report', () => {
    expect(simulate({ months: 5, daysPerMonth: 28, team: DEFAULT_TEAM, seed: 9 })).toEqual(
      simulate({ months: 5, daysPerMonth: 28, team: DEFAULT_TEAM, seed: 9 }),
    )
  })
})

describe('checkBar', () => {
  const base: SimReport = {
    days: 100,
    players: { careful: 2, bold: 2, reckless: 1, mixed: 2 },
    scoreCounts: { careful: [], bold: [], reckless: [], mixed: [] },
    failRate: { careful: 0, bold: 0.25, reckless: 0.4, mixed: 0.2 },
    meanScore: { careful: 4.5, bold: 4, reckless: 4.2, mixed: 4.3 },
    monthWinShare: { careful: 0.3, bold: 0.4, reckless: 0.1, mixed: 0.2 },
    tieForFirstRate: 0.75,
    ladderLengthCounts: [0, 0, 0, 0, 40, 40, 20],
    fallbackRate: 0,
  }

  test('passes at the bar', () => {
    expect(checkBar(base).pass).toBe(true)
  })

  const wins = (share: Partial<SimReport['monthWinShare']>): SimReport => ({
    ...base,
    monthWinShare: { ...base.monthWinShare, ...share },
  })
  const bold = (rate: number): SimReport => ({ ...base, failRate: { ...base.failRate, bold: rate } })

  test('each check fails on its own side of the threshold', () => {
    // careful month-win share: 0.10 to 0.50
    expect(checkBar(wins({ careful: 0.09 })).pass).toBe(false)
    expect(checkBar(wins({ careful: 0.1 })).pass).toBe(true)
    expect(checkBar(wins({ careful: 0.5, bold: 0.2 })).pass).toBe(true)
    expect(checkBar(wins({ careful: 0.51, bold: 0.2 })).pass).toBe(false)
    // no type over half
    expect(checkBar(wins({ bold: 0.5 })).pass).toBe(true)
    expect(checkBar(wins({ bold: 0.51 })).pass).toBe(false)
    expect(checkBar(wins({ reckless: 0.51 })).pass).toBe(false)
    // bold fail rate: 0.15 to 0.35
    expect(checkBar(bold(0.14)).pass).toBe(false)
    expect(checkBar(bold(0.15)).pass).toBe(true)
    expect(checkBar(bold(0.35)).pass).toBe(true)
    expect(checkBar(bold(0.36)).pass).toBe(false)
  })

  test('daily ties do not affect the verdict', () => {
    expect(checkBar({ ...base, tieForFirstRate: 0.99 }).pass).toBe(true)
  })

  test('formatReport names every check and the verdict', () => {
    const text = formatReport(base, checkBar(base))
    expect(text).toContain('careful month-win share')
    expect(text).toContain('largest month-win share')
    expect(text).toContain('bold fail rate')
    expect(text).toContain('VERDICT: PASS')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/points.test.ts convex/lib/clueLadder/simulate.test.ts`
Expected: FAIL, cannot resolve `./points.ts` and `./simulate.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// convex/lib/clueLadder/points.ts
import type { ScoringSystem } from '../scoring.ts'

/**
 * The clue ladder scores 1–6 and missed days with the team's own points, but X
 * is fixed at -1 (owner decision 2026-10-14). With a team's default X of -3,
 * locking in one clue early is a losing bet, and the simulation dry run showed
 * careful players winning about 90% of months. Plan 1 reuses this for the
 * team scoreboard.
 */
export const CLUE_LADDER_FAILED_POINTS = -1

export function clueLadderSystem(team: ScoringSystem): ScoringSystem {
  return { ...team, failed: CLUE_LADDER_FAILED_POINTS }
}
```

```ts
// convex/lib/clueLadder/simulate.ts
import { pointsFor, type ScoringSystem } from '../scoring.ts'
import { DEFAULT_SYSTEM } from '../scoringSystem.ts'
import { DEFAULT_PARAMS, generatePuzzle, type GeneratorParams } from './generate.ts'
import { clueLadderSystem } from './points.ts'
import { createRng, type Rng } from './rng.ts'

/**
 * The score-spread simulation from spec section 8. Players are modelled as
 * perfect counters of remaining orders, so careful play here is an upper
 * bound on what real careful players achieve.
 */
export type Strategy = 'careful' | 'bold' | 'reckless' | 'mixed'
export const STRATEGIES: readonly Strategy[] = ['careful', 'bold', 'reckless', 'mixed']
export const THRESHOLDS = { careful: 1, bold: 2, reckless: 3 } as const
export const FAIL = 7

export const DEFAULT_TEAM: readonly Strategy[] = [
  'careful',
  'careful',
  'bold',
  'bold',
  'reckless',
  'mixed',
  'mixed',
]

/** Attempts (1–6, or FAIL) for one player who locks in at `threshold` or fewer orders left. */
export function playDay(remaining: readonly number[], threshold: number, rng: Rng): number {
  for (let i = 0; i < remaining.length; i++) {
    const left = remaining[i]
    if (left <= threshold) return rng.int(left) === 0 ? i + 1 : FAIL
  }
  // Unreachable for a valid ladder, whose last count is 1.
  return FAIL
}

function thresholdFor(strategy: Strategy, rng: Rng): number {
  if (strategy === 'mixed') return rng.pick([1, 2, 3])
  return THRESHOLDS[strategy]
}

type PerStrategy<T> = Record<Strategy, T>
const perStrategy = <T>(make: () => T): PerStrategy<T> => ({
  careful: make(),
  bold: make(),
  reckless: make(),
  mixed: make(),
})

export type SimReport = {
  days: number
  players: PerStrategy<number>
  /** scoreCounts[s][k] = player-days scoring k (1–7) under strategy s; index 0 unused. */
  scoreCounts: PerStrategy<number[]>
  failRate: PerStrategy<number>
  meanScore: PerStrategy<number>
  /** Share of months won, ties split equally. Sums to 1 across strategies. */
  monthWinShare: PerStrategy<number>
  /** Share of days on which two or more players share the best score. */
  tieForFirstRate: number
  /** ladderLengthCounts[n] = days whose ladder had n clues. */
  ladderLengthCounts: number[]
  fallbackRate: number
}

export function simulate(opts: {
  months: number
  daysPerMonth: number
  team: readonly Strategy[]
  seed: number
  params?: GeneratorParams
  system?: ScoringSystem
}): SimReport {
  const { months, daysPerMonth, team, seed } = opts
  const params = opts.params ?? DEFAULT_PARAMS
  // The TEAM's system; X is replaced by the clue ladder's fixed value.
  const system = clueLadderSystem(opts.system ?? DEFAULT_SYSTEM)
  const rng = createRng(seed)

  const players = perStrategy(() => 0)
  for (const s of team) players[s]++
  const scoreCounts = perStrategy(() => [0, 0, 0, 0, 0, 0, 0, 0])
  const monthWins = perStrategy(() => 0)
  const ladderLengthCounts = [0, 0, 0, 0, 0, 0, 0]
  let tieDays = 0
  let fallbacks = 0

  for (let m = 0; m < months; m++) {
    const totals = team.map(() => 0)
    for (let d = 0; d < daysPerMonth; d++) {
      const puzzle = generatePuzzle(rng.int(0x100000000), params)
      ladderLengthCounts[puzzle.clues.length]++
      if (puzzle.fallback) fallbacks++
      const scores = team.map((strategy) => playDay(puzzle.remaining, thresholdFor(strategy, rng), rng))
      scores.forEach((score, i) => {
        scoreCounts[team[i]][score]++
        totals[i] += pointsFor(score, system)
      })
      const best = Math.min(...scores)
      if (scores.filter((s) => s === best).length >= 2) tieDays++
    }
    const top = Math.max(...totals)
    const winners = team.filter((_, i) => totals[i] === top)
    for (const s of winners) monthWins[s] += 1 / winners.length
  }

  const days = months * daysPerMonth
  const failRate = perStrategy(() => 0)
  const meanScore = perStrategy(() => 0)
  const monthWinShare = perStrategy(() => 0)
  for (const s of STRATEGIES) {
    const counts = scoreCounts[s]
    const n = counts.reduce((a, b) => a + b, 0)
    failRate[s] = n === 0 ? 0 : counts[FAIL] / n
    meanScore[s] = n === 0 ? 0 : counts.reduce((sum, c, k) => sum + c * k, 0) / n
    monthWinShare[s] = months === 0 ? 0 : monthWins[s] / months
  }

  return {
    days,
    players,
    scoreCounts,
    failRate,
    meanScore,
    monthWinShare,
    tieForFirstRate: days === 0 ? 0 : tieDays / days,
    ladderLengthCounts,
    fallbackRate: days === 0 ? 0 : fallbacks / days,
  }
}

export type BarCheck = { name: string; value: number; target: string; pass: boolean }
export type BarResult = { pass: boolean; checks: BarCheck[] }

/** Spec section 8's bar. The owner may revise these numbers. */
export function checkBar(report: SimReport): BarResult {
  const careful = report.monthWinShare.careful
  const largest = Math.max(...STRATEGIES.map((s) => report.monthWinShare[s]))
  const bold = report.failRate.bold
  // Daily ties are reported, not judged: seven players on a 1–6 scale share
  // the best score most days at every setting (dry run, 2026-10-14).
  const checks: BarCheck[] = [
    {
      name: 'careful month-win share',
      value: careful,
      target: '0.10 to 0.50',
      pass: careful >= 0.1 && careful <= 0.5,
    },
    { name: 'largest month-win share', value: largest, target: '<= 0.50', pass: largest <= 0.5 },
    { name: 'bold fail rate', value: bold, target: '0.15 to 0.35', pass: bold >= 0.15 && bold <= 0.35 },
  ]
  return { pass: checks.every((c) => c.pass), checks }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

export function formatReport(report: SimReport, bar: BarResult): string {
  const lines: string[] = []
  lines.push(`Simulated days: ${report.days}  (fallback ladders: ${pct(report.fallbackRate)})`)
  const lengths = [3, 4, 5, 6].map((n) => `${n}: ${report.ladderLengthCounts[n] ?? 0}`).join('  ')
  lines.push(`Ladder lengths  ${lengths}`)
  lines.push('')
  lines.push('strategy   players  mean   fail    month wins   scores 1..6, X')
  for (const s of STRATEGIES) {
    if (report.players[s] === 0) continue
    const counts = report.scoreCounts[s].slice(1).join(' ')
    lines.push(
      `${s.padEnd(10)} ${String(report.players[s]).padEnd(8)} ${report.meanScore[s].toFixed(2).padEnd(6)} ` +
        `${pct(report.failRate[s]).padEnd(7)} ${pct(report.monthWinShare[s]).padEnd(12)} ${counts}`,
    )
  }
  lines.push('')
  lines.push(`Tie for first: ${pct(report.tieForFirstRate)} of days`)
  lines.push('')
  for (const c of bar.checks) {
    lines.push(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.value.toFixed(3)} (target ${c.target})`)
  }
  lines.push(`VERDICT: ${bar.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/simulate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/clueLadder/points.ts convex/lib/clueLadder/points.test.ts convex/lib/clueLadder/simulate.ts convex/lib/clueLadder/simulate.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): score-spread simulation and bar check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Simulation runner script

**Files:**
- Create: `scripts/clue-ladder-sim.mjs`

This is a thin CLI over Task 6, so it has no unit test. Task 6's tests cover all the logic, and Step 2 below runs the script itself.

- [ ] **Step 1: Write the script**

```js
// scripts/clue-ladder-sim.mjs
/**
 * Clue ladder score-spread simulation (spec section 8; plan
 * docs/superpowers/plans/2026-10-14-clue-ladder-simulation.md).
 *
 *   node scripts/clue-ladder-sim.mjs [--months 500] [--seed 1] [--samples 3]
 *
 * Imports the TypeScript engine directly; Node 25 strips types on import.
 * Pure computation: touches no network and no Convex deployment.
 * Exit code 0 when the bar passes, 1 when it fails.
 */
import { parseArgs } from 'node:util'
import { clueText } from '../convex/lib/clueLadder/clues.ts'
import { generatePuzzle } from '../convex/lib/clueLadder/generate.ts'
import { SHAPE_SYMBOLS } from '../convex/lib/clueLadder/orders.ts'
import {
  checkBar,
  DEFAULT_TEAM,
  formatReport,
  simulate,
} from '../convex/lib/clueLadder/simulate.ts'

const { values } = parseArgs({
  options: {
    months: { type: 'string', default: '500' },
    seed: { type: 'string', default: '1' },
    samples: { type: 'string', default: '3' },
  },
})
const months = Number(values.months)
const seed = Number(values.seed)
const samples = Number(values.samples)

for (let i = 0; i < samples; i++) {
  const puzzle = generatePuzzle(seed * 1000 + i)
  console.log(`Sample puzzle ${i + 1}: answer ${puzzle.answer.map((s) => SHAPE_SYMBOLS[s]).join(' ')}`)
  puzzle.clues.forEach((clue, k) => {
    console.log(`  ${k + 1}. ${clueText(clue)}   (${puzzle.remaining[k]} left)`)
  })
  console.log('')
}

const report = simulate({ months, daysPerMonth: 28, team: DEFAULT_TEAM, seed })
const bar = checkBar(report)
console.log(`Team: ${DEFAULT_TEAM.join(', ')}  ·  ${months} months of 28 days  ·  seed ${seed}`)
console.log('')
console.log(formatReport(report, bar))
process.exitCode = bar.pass ? 0 : 1
```

- [ ] **Step 2: Run it**

Run: `node scripts/clue-ladder-sim.mjs --months 50 --samples 2 > "$SCRATCH/sim.log" 2>&1; echo "exit $?"`, where `$SCRATCH` is the session scratchpad. Then read `sim.log`.
Expected: two sample puzzles whose "left" counts strictly decrease to 1, a report table, three PASS/FAIL lines and a VERDICT. The exit code may be 0 or 1 at this point; Task 8 deals with the verdict. If Node errors on a `.ts` import, check `node --version` is at least 22.18; the repo is developed on 25.

- [ ] **Step 3: Run lint on the script**

Run: `pnpm lint > "$SCRATCH/lint.log" 2>&1; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/clue-ladder-sim.mjs .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): simulation runner script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Run, tune and record

**Files:**
- Modify (only if tuning): `convex/lib/clueLadder/generate.ts` (`DEFAULT_PARAMS`)

- [ ] **Step 1: Run the full simulation at two seeds**

Run each separately, writing to a file and reading the exit code:
`node scripts/clue-ladder-sim.mjs --months 500 --seed 1 > "$SCRATCH/sim-1.log" 2>&1; echo "exit $?"`
`node scripts/clue-ladder-sim.mjs --months 500 --seed 2 > "$SCRATCH/sim-2.log" 2>&1; echo "exit $?"`
Expected: both complete in under a few minutes. The verdict is what we are measuring, so either exit code is acceptable here.

- [ ] **Step 2: If both seeds PASS, go to Step 4.**

- [ ] **Step 3: If either FAILS, tune `DEFAULT_PARAMS` and rerun Step 1. At most three rounds.**

Change one knob per round and record each round's numbers in the Beads notes.

X is fixed at −1 by owner decision. Do **not** change `CLUE_LADDER_FAILED_POINTS` to make the bar pass; only `DEFAULT_PARAMS` is tunable here.

| Failing check | Knob to turn | Why |
|---|---|---|
| bold fail rate > 0.35 | Lower `beforeLastWeights` key `2`; raise keys `3`/`4` | Bold locks in at even odds only on "2 left" days, so fewer of them means fewer Xs (dry run: all-`2` gave 51%) |
| bold fail rate < 0.15 | Raise key `2` | The reverse |
| careful month-win share out of 0.10–0.50, or any type > 0.50 | Shift `beforeLastWeights` one step either way and compare: try one round each direction | The effect's direction depends on X and was not measured at X = −1; measure, don't assume |

The dry run at X = −1 with the starting params gave careful 15%, bold 44%, reckless 13%, mixed 29% and bold fail 25%, all inside the bar. So tuning should only be needed if the real code differs from the plan.

After each change, rerun `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/` and confirm it passes, since generator tests depend on the params.

**If three rounds do not clear the bar, stop.** File a Beads issue under wordle-teams-9j7o.2.3 titled "Clue ladder simulation misses the bar", with the last report pasted into its description. Then report to the owner and do not continue to the app plans. The spec says to return to the mechanic in this case.

- [ ] **Step 4: Run all four gates separately**

```bash
TZ=UTC pnpm test:once > "$SCRATCH/t.log" 2>&1; echo "test $?"
pnpm typecheck > "$SCRATCH/tc.log" 2>&1; echo "tc $?"
pnpm lint > "$SCRATCH/l.log" 2>&1; echo "lint $?"
pnpm build > "$SCRATCH/b.log" 2>&1; echo "build $?"
```
Expected: all four print `0`. If any fails, read its log, fix the cause and rerun all four.

- [ ] **Step 5: Record results**

Append to wordle-teams-9j7o.2.3 with a quoted heredoc. Include both seeds' report tables, the final `DEFAULT_PARAMS`, the number of tuning rounds, and the PASS/FAIL verdict. Use `bd update wordle-teams-9j7o.2.3 --append-notes "$(cat <<'EOF' ... EOF)"`.

- [ ] **Step 6: Commit and push**

```bash
git add convex/lib/clueLadder/generate.ts .beads/issues.jsonl
git commit -F - <<'EOF'
chore(clue-ladder): simulation results recorded; generator params tuned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git pull --rebase && git push
```

If `generate.ts` is unchanged, commit only `.beads/issues.jsonl`, with subject `chore(clue-ladder): simulation results recorded`.

- [ ] **Step 7: Report to the owner**

Send the two report tables, the verdict and, if it passed, a proposal to write the three app plans (game abstraction, play surface, clue ladder).
