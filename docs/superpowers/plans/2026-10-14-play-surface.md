# Play Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the clue ladder's screens and the two places a team meets it: a Wordle / Clue ladder switch on the dashboard scores, and an owner-only on/off toggle in team settings.

**Architecture:** The play screens are presentational components driven by props, each tested in jsdom. Plan 3 adds the server functions and the route that feeds them. The scores switch and the owner toggle are fully wired now, to `api.scores.getTeamGameMonth`, `api.scores.monthWindow`, `api.games.clueLadderSwitch` and `api.games.setTeamClueLadder` from plan 1. The scores grid is pulled out of `ScoresTable` into `ScoresGrid`, which takes attempts per day, so Wordle and the clue ladder render through one grid.

**Tech Stack:** React 19, TanStack Router, `@convex-dev/react-query`, Tailwind, Radix (Popover, Switch), lucide-react, Vitest with jsdom and `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-10-14-clue-ladder-design.md`, section 6. Build order step 2.

---

## Scope, and three departures from the spec

**In:** shape icons, the play board (slots and tray), the clue list with **Next clue** and **Lock in**, the finished screen, the dashboard card, the clue ladder scores table, the dashboard switch, the owner toggle.

**Moved to plan 3:** the play route (`/play/clue-ladder`), mounting the dashboard card, the share action and its `#N` numbering. All three need plan 3's `today` query, so building them here would mean stubbing data that plan 3 then replaces. The components they mount are built and tested here.

**Departures, each to be confirmed by the owner:**

1. **Tap only, no drag.** The spec says "tap a shape, then a slot, or drag". HTML drag-and-drop does not work on phones, and touch dragging needs its own pointer handling and tests. Tap covers every move. Drag is filed as a follow-up.
2. **The scores switch is not in the URL.** It is state on the dashboard, and resets to Wordle on reload. Putting it in `?game=` means changing four navigations whose exact text `src/routes.test.ts` pins. The switch still survives team and month changes, because the dashboard stays mounted.
3. **The clue ladder table carries its own legend**, one line built from the system the query returns: points for clues 1–6, X and a missed day. `ScoringLegend` reads Wordle's month and shows Wordle's X, which would be wrong here.

## Ground rules for every task

- Component tests are `*.hook.test.ts` (not `.tsx`; `vitest.config.ts` only includes `.ts`). Line 1 is `// @vitest-environment jsdom`. Render with `createElement` and `@testing-library/react`, and `afterEach(cleanup)`.
- A test that opens a Radix Popover needs the ResizeObserver stub from `src/components/challenges/challenges.hook.test.ts:46-52`.
- Imports from `convex/lib/` use relative paths with `.ts`. Import `GameId` and other server types with `import type`, so no server module reaches the client bundle.
- `$SCRATCH` means the session scratchpad. Run one file with `TZ=UTC pnpm exec vitest run <path> > "$SCRATCH/x.log" 2>&1; echo "exit $?"`. **Never pipe a gate into `tail`/`grep`.**
- Commit with a quoted heredoc. End the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`.
- After each task: `bd close <id>`, include `.beads/issues.jsonl` in the commit, then check `git show HEAD:.beads/issues.jsonl` records the issue as closed. If not, `git add .beads/issues.jsonl && git commit --amend --no-edit`.
- Before each commit run all four gates separately: `TZ=UTC pnpm test:once`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- Never run a `convex` CLI command; `.env.local` holds a production key.

## Beads issues

Epic: `wordle-teams-9j7o.3.2.1`. Each task blocks the next. Claim each with `bd update <id> --claim`.

| Task | Issue |
|---|---|
| 1 Shape icons | `wordle-teams-9j7o.3.2.1.1` |
| 2 Board | `wordle-teams-9j7o.3.2.1.2` |
| 3 Clues and controls | `wordle-teams-9j7o.3.2.1.3` |
| 4 Finished screen | `wordle-teams-9j7o.3.2.1.4` |
| 5 Dashboard card | `wordle-teams-9j7o.3.2.1.5` |
| 6 Scores grid for any game | `wordle-teams-9j7o.3.2.1.6` |
| 7 Dashboard switch | `wordle-teams-9j7o.3.2.1.7` |
| 8 Owner toggle | `wordle-teams-9j7o.3.2.1.8` |
| 9 Gates and record | `wordle-teams-9j7o.3.2.1.9` |

## File structure

| File | Responsibility |
|---|---|
| `src/components/clue-ladder/shape-icon.tsx` | `SHAPE_NAMES`, `ShapeIcon`, `ShapeRow` |
| `src/lib/clue-ladder-board.ts` | Pure slot rules: `EMPTY_SLOTS`, `placeShape`, `clearSlot`, `trayShapes`, `filledOrder` |
| `src/components/clue-ladder/board.tsx` | `ClueLadderBoard`: slots above a tray, tap to place |
| `src/components/clue-ladder/controls.tsx` | `ClueLadderControls`: clue list, Next clue, Lock in with one confirm |
| `src/components/clue-ladder/finished.tsx` | `ClueLadderFinished`: answer, ladder, the orders still possible, share |
| `src/components/clue-ladder/card.tsx` | `ClueLadderCard`: the dashboard card's four states |
| `src/components/scores-table.tsx` | `ScoresGrid` extracted; `ScoresTable` becomes its Wordle wrapper |
| `src/components/game-scores-table.tsx` | `GameScoresTable`: month gate, `getTeamGameMonth`, legend |
| `src/components/game-switch.tsx` | `GameSwitch`: Wordle / Clue ladder |
| `src/routes/app.tsx` | Switch state and the swap between the two tables |
| `src/components/teams/clue-ladder-setting-card.tsx` | Owner toggle |
| `src/routes/team.tsx` | Mounts the toggle |

---

### Task 1: Shape icons

**Files:**
- Create: `src/components/clue-ladder/shape-icon.tsx`
- Test: `src/components/clue-ladder/shape-icon.hook.test.ts`

The five shapes differ by outline, not colour (spec section 6). Each icon draws in `currentColor` with no fill.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { SHAPES } from '../../../convex/lib/clueLadder/orders.ts'
import { SHAPE_NAMES, ShapeIcon, ShapeRow } from './shape-icon.tsx'

afterEach(cleanup)

describe('ShapeIcon', () => {
  test.each(SHAPES)('%s has a text label for screen readers', (shape) => {
    render(createElement(ShapeIcon, { shape }))
    expect(screen.getByRole('img', { name: SHAPE_NAMES[shape] })).toBeTruthy()
  })

  test('every shape has a distinct name', () => {
    expect(new Set(SHAPES.map((s) => SHAPE_NAMES[s])).size).toBe(SHAPES.length)
  })

  test('a decorative icon is hidden from screen readers', () => {
    const { container } = render(createElement(ShapeIcon, { shape: 'star', decorative: true }))
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  test('shapes are outlines, not fills', () => {
    const { container } = render(createElement(ShapeIcon, { shape: 'circle' }))
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('fill')).toBe('none')
    expect(svg?.getAttribute('stroke')).toBe('currentColor')
  })
})

describe('ShapeRow', () => {
  test('reads as one labelled image, in order', () => {
    render(createElement(ShapeRow, { order: ['star', 'circle', 'square', 'triangle', 'diamond'], label: 'Answer' }))
    expect(screen.getByRole('img', { name: 'Answer: star, circle, square, triangle, diamond' })).toBeTruthy()
    // The five icons inside are decorative; only the row is announced.
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `TZ=UTC pnpm exec vitest run src/components/clue-ladder/shape-icon.hook.test.ts > "$SCRATCH/p1.log" 2>&1; echo "exit $?"`
Expected: exit 1, cannot find `./shape-icon.tsx`.

- [ ] **Step 3: Implement**

```tsx
import type { Shape } from '../../../convex/lib/clueLadder/orders.ts'
import { cn } from '#/lib/utils.ts'

/** Lower case, because they are read inside sentences ("Answer: star, circle, …"). */
export const SHAPE_NAMES: Readonly<Record<Shape, string>> = {
  triangle: 'triangle',
  square: 'square',
  circle: 'circle',
  diamond: 'diamond',
  star: 'star',
}

const OUTLINES: Readonly<Record<Shape, React.ReactNode>> = {
  triangle: <polygon points="12,3 21,20 3,20" />,
  square: <rect x="4" y="4" width="16" height="16" />,
  circle: <circle cx="12" cy="12" r="8.5" />,
  diamond: <polygon points="12,2.5 21.5,12 12,21.5 2.5,12" />,
  star: <polygon points="12,2.5 14.9,8.6 21.5,9.3 16.6,13.8 18,20.4 12,17 6,20.4 7.4,13.8 2.5,9.3 9.1,8.6" />,
}

/**
 * One shape, drawn as an outline in the current text colour. SHAPES DIFFER BY
 * OUTLINE, NEVER BY COLOUR (spec section 6), so the game reads the same to a
 * colour-blind player and in either theme.
 */
export function ShapeIcon({
  shape,
  decorative = false,
  className,
}: {
  shape: Shape
  /** True when a parent already announces the shape, as ShapeRow and the board's buttons do. */
  decorative?: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      className={cn('size-6', className)}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': SHAPE_NAMES[shape] })}
    >
      {OUTLINES[shape]}
    </svg>
  )
}

/** A full or partial order, announced once as a sentence rather than shape by shape. */
export function ShapeRow({
  order,
  label,
  className,
}: {
  order: ReadonlyArray<Shape>
  label: string
  className?: string
}) {
  return (
    <div
      role="img"
      aria-label={`${label}: ${order.map((shape) => SHAPE_NAMES[shape]).join(', ')}`}
      className={cn('flex gap-1', className)}
    >
      {order.map((shape, i) => (
        <ShapeIcon key={i} shape={shape} decorative />
      ))}
    </div>
  )
}
```

If `React.ReactNode` is not in scope (the file does not import React as a namespace), use `import type { ReactNode } from 'react'` and `Record<Shape, ReactNode>`.

- [ ] **Step 4: Run it to verify it passes**

Run the Step 2 command. Expected: exit 0.

- [ ] **Step 5: Gates and commit**

```bash
bd close wordle-teams-9j7o.3.2.1.1
git add src/components/clue-ladder/shape-icon.tsx src/components/clue-ladder/shape-icon.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): shape icons, outline only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Board

**Files:**
- Create: `src/lib/clue-ladder-board.ts`, `src/lib/clue-ladder-board.test.ts`
- Create: `src/components/clue-ladder/board.tsx`, `src/components/clue-ladder/board.hook.test.ts`

The rules for moving shapes are pure and tested on their own. The component holds only which tray shape is selected.

**The rules.** Five slots, each a shape or empty. Placing a shape puts it in the slot; if it already sat in another slot, that slot empties (a shape is never in two places). Whatever was in the target slot goes back to the tray. Tapping a filled slot with nothing selected empties it.

- [ ] **Step 1: Write the failing rule tests** (`src/lib/clue-ladder-board.test.ts`)

```ts
import { describe, expect, test } from 'vitest'
import { clearSlot, EMPTY_SLOTS, filledOrder, placeShape, trayShapes } from './clue-ladder-board.ts'

describe('placeShape', () => {
  test('puts a tray shape in an empty slot', () => {
    expect(placeShape(EMPTY_SLOTS, 'star', 2)).toEqual([null, null, 'star', null, null])
  })

  test('moves a placed shape rather than copying it', () => {
    const slots = placeShape(EMPTY_SLOTS, 'star', 0)
    expect(placeShape(slots, 'star', 4)).toEqual([null, null, null, null, 'star'])
  })

  test('the shape it replaces goes back to the tray', () => {
    const slots = placeShape(EMPTY_SLOTS, 'star', 0)
    const next = placeShape(slots, 'circle', 0)
    expect(next).toEqual(['circle', null, null, null, null])
    expect(trayShapes(next)).toContain('star')
  })

  test('leaves its input alone', () => {
    const slots = placeShape(EMPTY_SLOTS, 'star', 0)
    placeShape(slots, 'circle', 1)
    expect(slots).toEqual(['star', null, null, null, null])
  })
})

describe('clearSlot', () => {
  test('empties one slot', () => {
    expect(clearSlot(['star', 'circle', null, null, null], 0)).toEqual([null, 'circle', null, null, null])
  })
})

describe('trayShapes', () => {
  test('lists unplaced shapes in a fixed order', () => {
    expect(trayShapes(['circle', null, 'triangle', null, null])).toEqual(['square', 'diamond', 'star'])
  })
})

describe('filledOrder', () => {
  test('is null until every slot is filled', () => {
    expect(filledOrder(['circle', null, 'triangle', null, null])).toBeNull()
  })

  test('is the order once full', () => {
    const full = ['star', 'circle', 'square', 'triangle', 'diamond'] as const
    expect(filledOrder(full)).toEqual(full)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `TZ=UTC pnpm exec vitest run src/lib/clue-ladder-board.test.ts > "$SCRATCH/p2.log" 2>&1; echo "exit $?"`
Expected: exit 1.

- [ ] **Step 3: Implement the rules** (`src/lib/clue-ladder-board.ts`)

```ts
import { isOrder, SHAPES, SLOT_COUNT, type Order, type Shape } from '../../convex/lib/clueLadder/orders.ts'

/** The player's arrangement: one entry per slot, null where empty. Matches clueLadderPlays.scratch. */
export type Slots = ReadonlyArray<Shape | null>

export const EMPTY_SLOTS: Slots = Array.from({ length: SLOT_COUNT }, () => null)

/** Put `shape` in slot `index`. It leaves any other slot it sat in; whatever was at `index` returns to the tray. */
export function placeShape(slots: Slots, shape: Shape, index: number): Slots {
  return slots.map((current, i) => (i === index ? shape : current === shape ? null : current))
}

export function clearSlot(slots: Slots, index: number): Slots {
  return slots.map((current, i) => (i === index ? null : current))
}

/** Shapes not in any slot, in SHAPES order so the tray never reshuffles under the player's thumb. */
export function trayShapes(slots: Slots): Array<Shape> {
  return SHAPES.filter((shape) => !slots.includes(shape))
}

/** The arrangement as an order once every slot holds a different shape, else null. */
export function filledOrder(slots: Slots): Order | null {
  const shapes = slots.filter((shape): shape is Shape => shape !== null)
  return shapes.length === SLOT_COUNT && isOrder(shapes) ? shapes : null
}
```

Check `isOrder` in `convex/lib/clueLadder/orders.ts:38` accepts `readonly string[]` and checks for five distinct shapes. If it only checks membership and length, `filledOrder` is still correct, because `placeShape` never puts one shape in two slots.

- [ ] **Step 4: Run it to verify it passes.** Expected: exit 0.

- [ ] **Step 5: Write the failing component test** (`src/components/clue-ladder/board.hook.test.ts`)

```ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EMPTY_SLOTS } from '#/lib/clue-ladder-board.ts'
import { ClueLadderBoard } from './board.tsx'

afterEach(cleanup)

describe('ClueLadderBoard', () => {
  test('tap a tray shape, then a slot, to place it', () => {
    const onChange = vi.fn()
    render(createElement(ClueLadderBoard, { slots: EMPTY_SLOTS, onChange }))
    fireEvent.click(screen.getByRole('button', { name: 'star' }))
    expect(screen.getByRole('button', { name: 'star' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Slot 3, empty' }))
    expect(onChange).toHaveBeenCalledWith([null, null, 'star', null, null])
  })

  test('tapping a slot with nothing selected empties it', () => {
    const onChange = vi.fn()
    render(createElement(ClueLadderBoard, { slots: ['star', null, null, null, null], onChange }))
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1, star' }))
    expect(onChange).toHaveBeenCalledWith([null, null, null, null, null])
  })

  test('tapping an empty slot with nothing selected does nothing', () => {
    const onChange = vi.fn()
    render(createElement(ClueLadderBoard, { slots: EMPTY_SLOTS, onChange }))
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1, empty' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  test('the tray holds only unplaced shapes', () => {
    render(createElement(ClueLadderBoard, { slots: ['star', null, null, null, null], onChange: vi.fn() }))
    const tray = screen.getByRole('group', { name: 'Shapes to place' })
    expect(tray.querySelectorAll('button')).toHaveLength(4)
  })

  test('disabled stops every move', () => {
    const onChange = vi.fn()
    render(createElement(ClueLadderBoard, { slots: ['star', null, null, null, null], onChange, disabled: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1, star' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/components/clue-ladder/board.hook.test.ts > "$SCRATCH/p2b.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 7: Implement the component** (`src/components/clue-ladder/board.tsx`)

```tsx
import { useState } from 'react'
import type { Shape } from '../../../convex/lib/clueLadder/orders.ts'
import { Button } from '#/components/ui/button.tsx'
import { clearSlot, placeShape, trayShapes, type Slots } from '#/lib/clue-ladder-board.ts'
import { cn } from '#/lib/utils.ts'
import { SHAPE_NAMES, ShapeIcon } from './shape-icon.tsx'

/**
 * Five slots above a tray of the shapes not yet placed. Tap a shape, then a
 * slot. TAP ONLY: drag is a follow-up (plan 2's departure 1), since HTML drag
 * does not work on phones and this is built phone first.
 *
 * Controlled: the caller owns `slots` (plan 3 saves them as the play's scratch).
 * This component owns only which tray shape is picked up.
 */
export function ClueLadderBoard({
  slots,
  onChange,
  disabled = false,
  className,
}: {
  slots: Slots
  onChange: (slots: Slots) => void
  disabled?: boolean
  className?: string
}) {
  const [selected, setSelected] = useState<Shape | null>(null)

  const tapSlot = (index: number) => {
    if (disabled) return
    if (selected) {
      onChange(placeShape(slots, selected, index))
      setSelected(null)
    } else if (slots[index]) {
      onChange(clearSlot(slots, index))
    }
  }

  return (
    <div className={cn('flex flex-col items-center gap-6', className)}>
      <div role="group" aria-label="Your order" className="flex gap-2">
        {slots.map((shape, i) => (
          <Button
            key={i}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={`Slot ${i + 1}, ${shape ? SHAPE_NAMES[shape] : 'empty'}`}
            className="size-14 border-2 border-dashed p-0 data-[filled=true]:border-solid"
            data-filled={shape !== null}
            onClick={() => tapSlot(i)}
          >
            {shape && <ShapeIcon shape={shape} decorative className="size-8" />}
          </Button>
        ))}
      </div>
      <div role="group" aria-label="Shapes to place" className="flex min-h-14 gap-2">
        {trayShapes(slots).map((shape) => (
          <Button
            key={shape}
            type="button"
            variant={selected === shape ? 'default' : 'secondary'}
            disabled={disabled}
            aria-label={SHAPE_NAMES[shape]}
            aria-pressed={selected === shape}
            className="size-14 p-0"
            onClick={() => setSelected(selected === shape ? null : shape)}
          >
            <ShapeIcon shape={shape} decorative className="size-8" />
          </Button>
        ))}
      </div>
    </div>
  )
}
```

Check `src/components/ui/button.tsx` has a `secondary` variant. If not, use `outline`.

- [ ] **Step 8: Run both test files to verify they pass.** Expected: exit 0.

- [ ] **Step 9: Gates and commit**

```bash
bd close wordle-teams-9j7o.3.2.1.2
git add src/lib/clue-ladder-board.ts src/lib/clue-ladder-board.test.ts src/components/clue-ladder/board.tsx src/components/clue-ladder/board.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): play board, tap a shape then a slot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Clues and controls

**Files:**
- Create: `src/components/clue-ladder/controls.tsx`, `src/components/clue-ladder/controls.hook.test.ts`

Lists the revealed clues and offers **Next clue** and **Lock in**. Lock in confirms once, with the spec's words: "One try. If it's wrong, today is an X." Clue text arrives as strings; plan 3's `today` query renders them with `clueText` on the server.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ClueLadderControls } from './controls.tsx'

// Radix Popover measures its content; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

const base = {
  clues: ['The star is not first.', 'The circle is next to the square.'],
  canRevealMore: true,
  canLockIn: false,
  pending: false,
  onNextClue: vi.fn(),
  onLockIn: vi.fn(),
}

describe('ClueLadderControls', () => {
  test('lists the revealed clues, numbered', () => {
    render(createElement(ClueLadderControls, base))
    const items = screen.getByRole('list', { name: 'Clues' }).querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[1].textContent).toContain('Clue 2')
    expect(items[1].textContent).toContain('The circle is next to the square.')
  })

  test('Next clue reveals one more', () => {
    const onNextClue = vi.fn()
    render(createElement(ClueLadderControls, { ...base, onNextClue }))
    fireEvent.click(screen.getByRole('button', { name: 'Next clue' }))
    expect(onNextClue).toHaveBeenCalledTimes(1)
  })

  test('Next clue is disabled when none remain', () => {
    render(createElement(ClueLadderControls, { ...base, canRevealMore: false }))
    expect((screen.getByRole('button', { name: 'Next clue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('Lock in is disabled until all five slots are filled', () => {
    render(createElement(ClueLadderControls, base))
    expect((screen.getByRole('button', { name: 'Lock in' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('Lock in confirms once, then locks in', () => {
    const onLockIn = vi.fn()
    render(createElement(ClueLadderControls, { ...base, canLockIn: true, onLockIn }))
    fireEvent.click(screen.getByRole('button', { name: 'Lock in' }))
    expect(onLockIn).not.toHaveBeenCalled()
    expect(screen.getByText("One try. If it's wrong, today is an X.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, lock in' }))
    expect(onLockIn).toHaveBeenCalledTimes(1)
  })

  test('pending disables both actions', () => {
    render(createElement(ClueLadderControls, { ...base, canLockIn: true, pending: true }))
    expect((screen.getByRole('button', { name: 'Next clue' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Lock in' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/components/clue-ladder/controls.hook.test.ts > "$SCRATCH/p3.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react'
import { ConfirmPopover } from '#/components/confirm-popover.tsx'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'

/**
 * The revealed clues, and the day's two decisions. Next clue is irreversible
 * and costs a point; Lock in is the one try. Presentational: plan 3's route
 * owns the mutations and passes `pending` while one is in flight.
 */
export function ClueLadderControls({
  clues,
  canRevealMore,
  canLockIn,
  pending,
  onNextClue,
  onLockIn,
  className,
}: {
  clues: ReadonlyArray<string>
  canRevealMore: boolean
  /** True once all five slots are filled. */
  canLockIn: boolean
  pending: boolean
  onNextClue: () => void
  onLockIn: () => void
  className?: string
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <ol aria-label="Clues" className="flex flex-col gap-2">
        {clues.map((clue, i) => (
          <li key={i} className="rounded-md border p-3">
            <span className="block text-xs text-muted-foreground">Clue {i + 1}</span>
            {clue}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" disabled={!canRevealMore || pending} onClick={onNextClue}>
          Next clue
        </Button>
        <ConfirmPopover
          open={confirming}
          onOpenChange={setConfirming}
          trigger={
            <Button type="button" className="flex-1" disabled={!canLockIn || pending}>
              Lock in
            </Button>
          }
          message="One try. If it's wrong, today is an X."
          confirmLabel="Yes, lock in"
          pending={pending}
          onConfirm={() => {
            setConfirming(false)
            onLockIn()
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes.** Expected: exit 0.

- [ ] **Step 5: Gates and commit**

```bash
bd close wordle-teams-9j7o.3.2.1.3
git add src/components/clue-ladder/controls.tsx src/components/clue-ladder/controls.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): clue list, Next clue and a one-confirm Lock in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Finished screen

**Files:**
- Create: `src/components/clue-ladder/finished.tsx`, `src/components/clue-ladder/finished.hook.test.ts`

Shows the result, the answer, the ladder of possible orders (`120 → 24 → 6 → 2 → 1`) with the lock-in step marked, and the orders that were still possible at lock-in ("You had a 1 in 2 chance. The other was …"). Then the share line and the caller's actions. `remaining` is the puzzle's count after each clue (`Puzzle.remaining` in `convex/lib/clueLadder/generate.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Order } from '../../../convex/lib/clueLadder/orders.ts'
import { ClueLadderFinished } from './finished.tsx'

afterEach(cleanup)

const answer: Order = ['star', 'circle', 'square', 'triangle', 'diamond']
const other: Order = ['circle', 'star', 'square', 'triangle', 'diamond']

const solved = {
  status: 'solved' as const,
  lockedAtClue: 3,
  answer,
  lockedOrder: answer,
  remaining: [24, 6, 2, 1],
  possibleAtLockIn: [answer, other],
  shareText: 'Clue ladder #4: solved on clue 3',
  onShare: vi.fn(),
}

describe('ClueLadderFinished', () => {
  test('a solve names the clue', () => {
    render(createElement(ClueLadderFinished, solved))
    expect(screen.getByRole('heading', { name: 'Solved on clue 3' })).toBeTruthy()
  })

  test('the answer is announced as one row', () => {
    render(createElement(ClueLadderFinished, solved))
    expect(screen.getByRole('img', { name: 'Answer: star, circle, square, triangle, diamond' })).toBeTruthy()
  })

  test('the ladder runs from 120 and marks the lock-in step', () => {
    render(createElement(ClueLadderFinished, solved))
    const steps = screen.getByRole('list', { name: 'Orders still possible after each clue' }).querySelectorAll('li')
    expect([...steps].map((li) => li.dataset.count)).toEqual(['120', '24', '6', '2', '1'])
    expect(steps[3].dataset.locked).toBe('true')
    expect(steps[3].textContent).toContain('you locked in')
  })

  test('an early lock-in shows the odds and the other order', () => {
    render(createElement(ClueLadderFinished, solved))
    expect(screen.getByText('You had a 1 in 2 chance.')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'The other was: circle, star, square, triangle, diamond' })).toBeTruthy()
  })

  test('a lock-in on the proving clue shows no odds', () => {
    render(createElement(ClueLadderFinished, { ...solved, lockedAtClue: 4, possibleAtLockIn: [answer] }))
    expect(screen.queryByText(/You had a 1 in/)).toBeNull()
  })

  test('an X shows the player’s order beside the answer', () => {
    render(
      createElement(ClueLadderFinished, {
        ...solved,
        status: 'failed' as const,
        lockedOrder: other,
        shareText: 'Clue ladder #4: X',
      }),
    )
    expect(screen.getByRole('heading', { name: 'X' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Your order: circle, star, square, triangle, diamond' })).toBeTruthy()
    // The orders "other" than the one the player chose: here, the answer.
    expect(screen.getByRole('img', { name: 'The other was: star, circle, square, triangle, diamond' })).toBeTruthy()
  })

  test('three or more possibilities use the plural', () => {
    const third: Order = ['square', 'circle', 'star', 'triangle', 'diamond']
    render(createElement(ClueLadderFinished, { ...solved, lockedAtClue: 2, possibleAtLockIn: [answer, other, third] }))
    expect(screen.getByText('You had a 1 in 3 chance.')).toBeTruthy()
    expect(screen.getByText('The others were:')).toBeTruthy()
  })

  test('the share line is shown and Share calls back', () => {
    const onShare = vi.fn()
    render(createElement(ClueLadderFinished, { ...solved, onShare }))
    expect(screen.getByText('Clue ladder #4: solved on clue 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(onShare).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/components/clue-ladder/finished.hook.test.ts > "$SCRATCH/p4.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: Implement**

```tsx
import type { ReactNode } from 'react'
import { ALL_ORDERS, orderKey, type Order } from '../../../convex/lib/clueLadder/orders.ts'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'
import { ShapeRow } from './shape-icon.tsx'

/**
 * The day's explanation (spec section 6). The ladder shows how each clue cut
 * the possible orders, so a player who locked in early can see what the next
 * clue would have settled, and the odds they took.
 */
export function ClueLadderFinished({
  status,
  lockedAtClue,
  answer,
  lockedOrder,
  remaining,
  possibleAtLockIn,
  shareText,
  onShare,
  actions,
  className,
}: {
  status: 'solved' | 'failed'
  lockedAtClue: number
  answer: Order
  lockedOrder: Order
  /** Orders still possible after each clue, in clue order; the last is 1. */
  remaining: ReadonlyArray<number>
  /** The orders that fit every clue revealed at lock-in. Includes the answer. */
  possibleAtLockIn: ReadonlyArray<Order>
  shareText: string
  onShare: () => void
  /** The caller's own buttons, such as back to team scores. */
  actions?: ReactNode
  className?: string
}) {
  const ladder = [ALL_ORDERS.length, ...remaining]
  const others = possibleAtLockIn.filter((order) => orderKey(order) !== orderKey(lockedOrder))

  return (
    <section className={cn('flex flex-col gap-6', className)}>
      <h2 className="text-2xl font-bold">{status === 'solved' ? `Solved on clue ${lockedAtClue}` : 'X'}</h2>

      <div className="flex flex-col gap-2">
        <ShapeRow order={answer} label="Answer" />
        {status === 'failed' && <ShapeRow order={lockedOrder} label="Your order" className="opacity-70" />}
      </div>

      <ol aria-label="Orders still possible after each clue" className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
        {ladder.map((count, i) => (
          <li
            key={i}
            data-count={count}
            data-locked={i === lockedAtClue || undefined}
            className={cn('flex items-center gap-2', i === lockedAtClue && 'font-bold underline')}
          >
            {i > 0 && <span aria-hidden="true">→</span>}
            {count}
            {i === lockedAtClue && <span className="sr-only"> (you locked in here)</span>}
          </li>
        ))}
      </ol>

      {possibleAtLockIn.length > 1 && (
        <div className="flex flex-col gap-2">
          <p>You had a 1 in {possibleAtLockIn.length} chance.</p>
          {others.length === 1 ? (
            <ShapeRow order={others[0]} label="The other was" />
          ) : (
            <>
              <p>The others were:</p>
              {others.map((order) => (
                <ShapeRow key={orderKey(order)} order={order} label="Another possible order" />
              ))}
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="rounded-md border p-3 font-mono text-sm">{shareText}</p>
        <Button type="button" onClick={onShare}>
          Share
        </Button>
        {actions}
      </div>
    </section>
  )
}
```

The `sr-only` span's text is "(you locked in here)", so `textContent` contains "you locked in", as the test expects.

- [ ] **Step 4: Run it to verify it passes.** Expected: exit 0.

- [ ] **Step 5: Gates and commit**

```bash
bd close wordle-teams-9j7o.3.2.1.4
git add src/components/clue-ladder/finished.tsx src/components/clue-ladder/finished.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): finished screen with the ladder and the odds taken

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Dashboard card

**Files:**
- Create: `src/components/clue-ladder/card.tsx`, `src/components/clue-ladder/card.hook.test.ts`

The card's four states from spec section 6. It takes `onOpen` rather than rendering a `<Link>`, because the play route arrives in plan 3; plan 3 mounts the card and passes a navigation.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ClueLadderCard } from './card.tsx'

afterEach(cleanup)

describe('ClueLadderCard', () => {
  test.each([
    [{ status: 'not-started' as const }, 'Play', 'Five shapes, one order. Fewer clues, more points.'],
    [{ status: 'playing' as const, cluesRevealed: 2 }, 'Continue', 'Clue 2'],
    [{ status: 'solved' as const, lockedAtClue: 3 }, 'See the explanation', 'Solved on clue 3'],
    [{ status: 'failed' as const }, 'See the explanation', 'X'],
  ])('%o shows %s', (play, button, text) => {
    const onOpen = vi.fn()
    render(createElement(ClueLadderCard, { play, onOpen }))
    expect(screen.getByText(text)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: button }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('is a labelled region', () => {
    render(createElement(ClueLadderCard, { play: { status: 'not-started' }, onOpen: vi.fn() }))
    expect(screen.getByRole('region', { name: "Today's clue ladder" })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/components/clue-ladder/card.hook.test.ts > "$SCRATCH/p5.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: Implement**

```tsx
import { useId } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'

export type ClueLadderCardPlay =
  | { status: 'not-started' }
  | { status: 'playing'; cluesRevealed: number }
  | { status: 'solved'; lockedAtClue: number }
  | { status: 'failed' }

/**
 * "Today's clue ladder", below the Wordle entry on an opted-in team's
 * dashboard (spec section 6). Plan 3 mounts it and supplies `play` from the
 * `today` query.
 */
export function ClueLadderCard({
  play,
  onOpen,
  className,
}: {
  play: ClueLadderCardPlay
  onOpen: () => void
  className?: string
}) {
  const titleId = useId()
  const [line, action] =
    play.status === 'not-started'
      ? ['Five shapes, one order. Fewer clues, more points.', 'Play']
      : play.status === 'playing'
        ? [`Clue ${play.cluesRevealed}`, 'Continue']
        : play.status === 'solved'
          ? [`Solved on clue ${play.lockedAtClue}`, 'See the explanation']
          : ['X', 'See the explanation']

  return (
    <section
      aria-labelledby={titleId}
      className={cn('flex items-center justify-between gap-4 rounded-md border p-4', className)}
    >
      <div className="min-w-0">
        <h2 id={titleId} className="font-semibold">
          Today's clue ladder
        </h2>
        <p className="text-sm text-muted-foreground">{line}</p>
      </div>
      <Button type="button" onClick={onOpen}>
        {action}
      </Button>
    </section>
  )
}
```

- [ ] **Step 4: Run it to verify it passes.** Expected: exit 0.

- [ ] **Step 5: Gates and commit**

```bash
bd close wordle-teams-9j7o.3.2.1.5
git add src/components/clue-ladder/card.tsx src/components/clue-ladder/card.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): dashboard card in its four states

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Scores grid for any game

**Files:**
- Modify: `src/components/scores-table.tsx`
- Create: `src/components/game-scores-table.tsx`
- Test: `src/components/scores-grid.hook.test.ts`, `src/components/game-scores-table.hook.test.ts`

`ScoresTable` reads Wordle boards and renders the grid in one component. This task splits it: `ScoresGrid`, in the same file, takes attempts per day; `ScoresTable` reads `getTeamMonth` and converts with `wordleDays`. The grid's body, comments and markup move unchanged, so `src/components/scores-table.hook.test.ts`, which reads this file's source, keeps passing **without edits**.

One behaviour to keep exactly: the cell map is `new Map(...)` over the rows, so for a duplicated day the **last** row shows in the cell while `monthTotal` counts the **first**. That is how it works today; do not "fix" it here.

- [ ] **Step 1: Write the failing grid test** (`src/components/scores-grid.hook.test.ts`)

```ts
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import type { Id } from '../../convex/_generated/dataModel'
import { ScoresGrid } from './scores-table.tsx'

afterEach(cleanup)

const system = {
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: 0,
  failed: -1,
  nA: 0,
}
const id = (s: string) => s as Id<'players'>

// A month wholly in the past, so every day is due and the totals are fixed.
const MONTH = '2026-08'

describe('ScoresGrid', () => {
  const players = [
    { id: id('b'), firstName: 'Bea', lastName: 'Two', days: [{ puzzleDay: '2026-08-03', attempts: 2 }] },
    {
      id: id('a'),
      firstName: 'Al',
      lastName: 'One',
      days: [
        { puzzleDay: '2026-08-03', attempts: 1 },
        { puzzleDay: '2026-08-04', attempts: 7 },
      ],
    },
  ]

  test('totals attempts with the given system and sorts by total', () => {
    const { container } = render(
      createElement(ScoresGrid, { teamId: 't' as Id<'teams'>, month: MONTH, players, system, playWeekends: true }),
    )
    const rows = [...container.querySelectorAll('tbody tr')]
    // Al: 5 + (-1) = 4. Bea: 3. Missed days score nA = 0.
    expect(rows.map((r) => r.lastElementChild?.textContent)).toEqual(['4', '3'])
  })

  test('a failed day shows X', () => {
    const { container } = render(
      createElement(ScoresGrid, { teamId: 't' as Id<'teams'>, month: MONTH, players, system, playWeekends: true }),
    )
    const al = container.querySelectorAll('tbody tr')[0]
    expect(al.querySelector('[data-day="2026-08-04"]')?.textContent).toBe('X')
    expect(al.querySelector('[data-day="2026-08-03"]')?.textContent).toBe('1')
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/components/scores-grid.hook.test.ts > "$SCRATCH/p6.log" 2>&1; echo "exit $?"`. Expected: exit 1, `ScoresGrid` is not exported.

- [ ] **Step 3: Split `src/components/scores-table.tsx`**

1. Change the imports. Remove `import { attemptsFor } from '../../convex/lib/board.ts'`. Change the scoring import to:

```ts
import { monthTotal, wordleDays, type AttemptDay, type ScoringSystem } from '../../convex/lib/scoring.ts'
```

2. Rename the existing `export function ScoresTable({ … }) {` to `export function ScoresGrid({`, and change its props to:

```ts
export function ScoresGrid({
  teamId,
  month,
  players,
  system,
  playWeekends,
  myPlayerId,
  className,
  footer,
}: {
  /** Keys the landing scroll (see the effect below); the grid reads no data itself. */
  teamId: Id<'teams'>
  month: string
  players: ReadonlyArray<GridPlayer>
  system: ScoringSystem
  playWeekends: boolean
  myPlayerId?: Id<'players'>
  className?: string
  /** (keep the existing `footer` doc comment here, unchanged) */
  footer?: ReactNode
}) {
```

Keep the existing doc comment above it ("The month grid. DESIGN_SYSTEM.md §8 …") where it is.

3. Delete these two lines from the top of the body:

```ts
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { team, players } = data
```

4. Replace the `rows` computation with:

```ts
  const rows = players
    .map((player) => {
      const byDay = new Map(player.days.map((day) => [day.puzzleDay, day]))
      return {
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        byDay,
        total: monthTotal({
          month,
          days: player.days,
          system,
          playWeekends,
          today,
        }),
      }
    })
    .sort((a, b) => b.total - a.total)
```

5. In the day cell, replace

```tsx
                  const score = row.byDay.get(day)
```

with

```tsx
                  const result = row.byDay.get(day)
```

and the `<ScoreCell … />` with:

```tsx
                      <ScoreCell
                        attempts={result?.attempts}
                        hasScore={result !== undefined}
                        isBeforeToday={day < today}
                        isWeekend={isWeekendDay(day)}
                        playWeekends={playWeekends}
                      />
```

6. Add above `ScoresGrid`:

```ts
/** One row of the grid: a player and their results as attempts per day (7 = X). */
export type GridPlayer = {
  id: Id<'players'>
  firstName: string
  lastName: string
  days: ReadonlyArray<AttemptDay>
}
```

`monthTotal` takes `Array<AttemptDay>`. If `ReadonlyArray` does not assign to it, pass `[...player.days]`.

7. Add after `ScoresGrid`, before `export default`:

```tsx
/**
 * Wordle's month grid: reads the team's boards and hands the grid attempts.
 * The clue ladder's equivalent is GameScoresTable (game-scores-table.tsx).
 */
export function ScoresTable({
  teamId,
  month,
  myPlayerId,
  className,
  footer,
}: {
  teamId: Id<'teams'>
  month: string
  myPlayerId?: Id<'players'>
  className?: string
  footer?: ReactNode
}) {
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { team, players } = data
  return (
    <ScoresGrid
      teamId={teamId}
      month={month}
      players={players.map((player) => ({
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        days: wordleDays(player.scores),
      }))}
      system={team.system}
      playWeekends={team.playWeekends}
      myPlayerId={myPlayerId}
      className={className}
      footer={footer}
    />
  )
}
```

`export default ScoresTable` stays.

- [ ] **Step 4: Run the grid test and the existing table tests**

Run: `TZ=UTC pnpm exec vitest run src/components/scores-grid.hook.test.ts src/components/scores-table.hook.test.ts src/routes.test.ts > "$SCRATCH/p6b.log" 2>&1; echo "exit $?"`
Expected: exit 0. `git diff -- src/components/scores-table.hook.test.ts` is empty.

- [ ] **Step 5: Write the failing GameScoresTable test** (`src/components/game-scores-table.hook.test.ts`)

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

let earliestMonth: string | null = null
const gameMonth = {
  game: 'clueLadder',
  team: {
    id: 't',
    name: 'T',
    playWeekends: true,
    system: { oneGuess: 5, twoGuesses: 3, threeGuesses: 2, fourGuesses: 1, fiveGuesses: 0, sixGuesses: 0, failed: -1, nA: 0 },
    systemEffectiveFrom: null,
  },
  players: [{ id: 'a', firstName: 'Al', lastName: 'One', results: [{ puzzleDay: '2026-08-04', attempts: 7 }] }],
}

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
}))
vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    if (queryKey[0] === getFunctionName(api.scores.monthWindow)) return { data: { earliestMonth } }
    if (queryKey[0] === getFunctionName(api.scores.getTeamGameMonth)) return { data: gameMonth }
    throw new Error(`unexpected query ${queryKey[0]}`)
  },
}))

const { GameScoresTable } = await import('./game-scores-table.tsx')

afterEach(cleanup)
beforeEach(() => {
  earliestMonth = null
})

const props = { teamId: 't' as Id<'teams'>, game: 'clueLadder' as const }

describe('GameScoresTable', () => {
  test('a month before the game’s first play shows a notice, not the grid', () => {
    earliestMonth = '2026-09'
    render(createElement(GameScoresTable, { ...props, month: '2026-08' }))
    expect(screen.getByText('No clue ladder games this month.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('a month with plays shows the grid, with X for a failed day', () => {
    earliestMonth = '2026-08'
    const { container } = render(createElement(GameScoresTable, { ...props, month: '2026-08' }))
    expect(container.querySelector('[data-day="2026-08-04"]')?.textContent).toBe('X')
  })

  test('the legend shows the clue ladder’s points, X at -1', () => {
    earliestMonth = '2026-08'
    render(createElement(GameScoresTable, { ...props, month: '2026-08' }))
    expect(screen.getByText('Points by clue: 1: 5 · 2: 3 · 3: 2 · 4: 1 · 5: 0 · 6: 0 · X: -1 · missed: 0')).toBeTruthy()
  })
})
```

If the repo's other hook tests import the component statically after `vi.mock` (hoisted), do the same instead of the dynamic `await import`.

- [ ] **Step 6: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/components/game-scores-table.hook.test.ts > "$SCRATCH/p6c.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 7: Implement `src/components/game-scores-table.tsx`**

```tsx
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { GameId } from '../../convex/lib/games.ts'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { ScoringSystem } from '../../convex/lib/scoring.ts'
import { ScoresGrid } from '#/components/scores-table.tsx'
import { cn } from '#/lib/utils.ts'

/**
 * A game's month grid other than Wordle's (wordle-teams-9j7o.3.2).
 *
 * THE MONTH PICKER IS WORDLE'S, so it can offer a month before this game's
 * first play. The server serves only the game's own window
 * (getTeamGameMonth's month gate), so asking for such a month would throw into
 * the dashboard's error boundary. This checks first and shows a notice.
 *
 * Mounted only after the viewer flips the dashboard switch, which is after
 * hydration, so reading the clock during render cannot mismatch the server.
 */
export function GameScoresTable({
  teamId,
  month,
  game,
  myPlayerId,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  game: Exclude<GameId, 'wordle'>
  myPlayerId?: Id<'players'>
  className?: string
}) {
  const { data: inputs } = useSuspenseQuery(convexQuery(api.scores.monthWindow, { teamId, game }))
  const firstMonth = inputs.earliestMonth ?? monthOf(toPuzzleDay(new Date()))
  if (month < firstMonth) {
    return (
      <section className={cn('rounded-md border p-4 text-sm text-muted-foreground', className)}>
        No clue ladder games this month.
      </section>
    )
  }
  return <GameMonthGrid teamId={teamId} month={month} game={game} myPlayerId={myPlayerId} className={className} />
}

function GameMonthGrid({
  teamId,
  month,
  game,
  myPlayerId,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  game: Exclude<GameId, 'wordle'>
  myPlayerId?: Id<'players'>
  className?: string
}) {
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamGameMonth, { teamId, month, game }))
  return (
    <ScoresGrid
      teamId={teamId}
      month={month}
      players={data.players.map((player) => ({
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        days: player.results,
      }))}
      system={data.team.system}
      playWeekends={data.team.playWeekends}
      myPlayerId={myPlayerId}
      className={className}
      footer={<ClueLadderLegend system={data.team.system} />}
    />
  )
}

/** ScoringLegend reads Wordle's month and shows Wordle's X, so this game carries its own line. */
function ClueLadderLegend({ system }: { system: ScoringSystem }) {
  const byClue = [
    system.oneGuess,
    system.twoGuesses,
    system.threeGuesses,
    system.fourGuesses,
    system.fiveGuesses,
    system.sixGuesses,
  ]
  return (
    <p className="text-xs text-muted-foreground">
      {`Points by clue: ${byClue.map((points, i) => `${i + 1}: ${points}`).join(' · ')} · X: ${system.failed} · missed: ${system.nA}`}
    </p>
  )
}
```

The string is built in one template literal so it renders as one text node, which `getByText` matches whole.

- [ ] **Step 8: Run it to verify it passes.** Expected: exit 0.

- [ ] **Step 9: Gates and commit**

```bash
bd close wordle-teams-9j7o.3.2.1.6
git add src/components/scores-table.tsx src/components/game-scores-table.tsx src/components/scores-grid.hook.test.ts src/components/game-scores-table.hook.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(scores): ScoresGrid takes attempts; GameScoresTable for the clue ladder

ScoresTable keeps its exact output and becomes the Wordle wrapper. The
clue ladder grid checks its own month window before asking, since the
month picker is Wordle's.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Dashboard switch

**Files:**
- Create: `src/components/game-switch.tsx`, `src/components/game-switch.hook.test.ts`
- Modify: `src/routes/app.tsx`
- Test: `src/routes.test.ts` (append one block)

The switch shows only for a team with the clue ladder on (`selectedTeam.clueLadderEnabled`, which plan 1 made false whenever the deployment switch is off). Its state lives on the dashboard and resets to Wordle on reload (departure 2). TodayPanel and TeamBoards stay Wordle's.

- [ ] **Step 1: Write the failing switch test**

```ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GameSwitch } from './game-switch.tsx'

afterEach(cleanup)

describe('GameSwitch', () => {
  test('marks the shown game as pressed', () => {
    render(createElement(GameSwitch, { value: 'clueLadder', onChange: vi.fn() }))
    expect(screen.getByRole('button', { name: 'Clue ladder' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Wordle' }).getAttribute('aria-pressed')).toBe('false')
  })

  test('switches game', () => {
    const onChange = vi.fn()
    render(createElement(GameSwitch, { value: 'wordle', onChange }))
    fireEvent.click(screen.getByRole('button', { name: 'Clue ladder' }))
    expect(onChange).toHaveBeenCalledWith('clueLadder')
  })

  test('is a labelled group', () => {
    render(createElement(GameSwitch, { value: 'wordle', onChange: vi.fn() }))
    expect(screen.getByRole('group', { name: 'Scores for' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/components/game-switch.hook.test.ts > "$SCRATCH/p7.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: Implement `src/components/game-switch.tsx`**

```tsx
import type { GameId } from '../../convex/lib/games.ts'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'

const LABELS: Readonly<Record<GameId, string>> = { wordle: 'Wordle', clueLadder: 'Clue ladder' }
const ORDER: ReadonlyArray<GameId> = ['wordle', 'clueLadder']

/** Which game the dashboard's scores table shows. aria-pressed buttons, as leagues/group-picker.tsx uses. */
export function GameSwitch({
  value,
  onChange,
  className,
}: {
  value: GameId
  onChange: (game: GameId) => void
  className?: string
}) {
  return (
    <div role="group" aria-label="Scores for" className={cn('flex gap-2', className)}>
      {ORDER.map((game) => (
        <Button
          key={game}
          type="button"
          size="sm"
          variant={game === value ? 'default' : 'outline'}
          aria-pressed={game === value}
          onClick={() => onChange(game)}
        >
          {LABELS[game]}
        </Button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes.** Expected: exit 0.

- [ ] **Step 5: Wire it into `src/routes/app.tsx`**

1. Imports. Add beside the other component imports:

```ts
import { GameSwitch } from '#/components/game-switch.tsx'
import { GameScoresTable } from '#/components/game-scores-table.tsx'
```

and beside the other `convex/lib` type imports (or alone if there are none):

```ts
import type { GameId } from '../../convex/lib/games.ts'
```

2. State. Directly after the `Route.useSearch()` line near the top of `Dashboard` (about line 206), **before any early return**, add:

```ts
  // WHICH GAME THE SCORES TABLE SHOWS (wordle-teams-9j7o.3.2). State, not a
  // search param: four navigations below spell out `search` exactly and
  // src/routes.test.ts pins that text, so `?game=` would mean rewriting all of
  // them for a pilot. It survives team and month changes, since this component
  // stays mounted, and resets to Wordle on reload.
  const [scoresGame, setScoresGame] = useState<GameId>('wordle')
```

3. The table. Replace the `<Suspense …>` block that wraps `<ScoresTable` (it starts with `<Suspense` and a `fallback={` holding `ScoresTableSkeleton`, about lines 1591–1639) with the block below. The existing block is kept **verbatim** as the `else` branch; only the switch and the clue ladder branch are new.

```tsx
      {selectedTeam?.clueLadderEnabled && (
        <GameSwitch value={scoresGame} onChange={setScoresGame} className="md:col-span-3" />
      )}
      {selectedTeam?.clueLadderEnabled && scoresGame === 'clueLadder' ? (
        <Suspense
          fallback={
            <ScoresTableSkeleton month={monthParam} rows={selectedTeam.members.length} className="md:col-span-3" />
          }
        >
          <GameScoresTable
            teamId={teamParam as Id<'teams'>}
            month={monthParam}
            game="clueLadder"
            myPlayerId={myPlayerId ?? undefined}
            className="md:col-span-3"
          />
        </Suspense>
      ) : (
        /* (the existing <Suspense fallback={<ScoresTableSkeleton …/>}> … <ScoresTable … /> … </Suspense>, unchanged) */
      )}
```

Paste the existing block where the comment is, without changing a character inside it. Leave the long comment blocks above it where they are.

- [ ] **Step 6: Pin the gate in `src/routes.test.ts`**

Append at the end of the file. It reads the source the same way the file's other dashboard blocks do (`codeOf` strips comments).

```ts
describe('the dashboard shows the clue ladder only to an opted-in team (wordle-teams-9j7o.3.2)', () => {
  const code = codeOf(readFileSync(new URL('./routes/app.tsx', import.meta.url), 'utf8'))

  test('the switch renders only when the team has the clue ladder on', () => {
    expect(code).toContain('{selectedTeam?.clueLadderEnabled && (')
    expect(code).toContain('<GameSwitch value={scoresGame} onChange={setScoresGame}')
  })

  test('the clue ladder table needs both the team flag and the switch', () => {
    expect(code).toContain("selectedTeam?.clueLadderEnabled && scoresGame === 'clueLadder' ?")
  })

  test('Wordle stays the default', () => {
    expect(code).toContain("useState<GameId>('wordle')")
  })
})
```

Check the top of `src/routes.test.ts` for how it already imports `readFileSync` and `codeOf`, and how other blocks build the path (it may use a helper rather than `new URL`). Match it.

- [ ] **Step 7: Run the tests and all four gates**

```bash
TZ=UTC pnpm exec vitest run src/routes.test.ts src/components/game-switch.hook.test.ts > "$SCRATCH/p7b.log" 2>&1; echo "exit $?"
```

Expected: exit 0. Then all four gates.

- [ ] **Step 8: Commit**

```bash
bd close wordle-teams-9j7o.3.2.1.7
git add src/components/game-switch.tsx src/components/game-switch.hook.test.ts src/routes/app.tsx src/routes.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(dashboard): Wordle / Clue ladder switch on opted-in teams' scores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Owner toggle

**Files:**
- Create: `src/components/teams/clue-ladder-setting-card.tsx`, `src/components/teams/clue-ladder-setting-card.hook.test.ts`
- Modify: `src/routes/team.tsx`

A card on `/team`, shown only to the owner and only while the deployment switch is on (`api.games.clueLadderSwitch`). `enabled` is `selectedTeam.clueLadderEnabled`; while the switch is on, that is exactly the team's own flag. Errors use `mutationErrorMessage`, as the accepts-challenges toggle does (`src/routes/team.tsx:439-447`).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

let switchOn = true
const mutate = vi.fn()

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
  useConvexMutation: () => vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    if (queryKey[0] !== getFunctionName(api.games.clueLadderSwitch)) throw new Error(`unexpected ${queryKey[0]}`)
    return { data: { enabled: switchOn } }
  },
  useMutation: () => ({ mutate, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const { ClueLadderSettingCard } = await import('./clue-ladder-setting-card.tsx')

afterEach(cleanup)
beforeEach(() => {
  switchOn = true
  mutate.mockReset()
})

const teamId = 't' as Id<'teams'>

describe('ClueLadderSettingCard', () => {
  test('the owner can switch it on', () => {
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: false }))
    fireEvent.click(screen.getByRole('switch', { name: 'Clue ladder' }))
    expect(mutate.mock.calls[0][0]).toEqual({ teamId, enabled: true })
  })

  test('the owner can switch it off', () => {
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: true }))
    expect(screen.getByRole('switch', { name: 'Clue ladder' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch', { name: 'Clue ladder' }))
    expect(mutate.mock.calls[0][0]).toEqual({ teamId, enabled: false })
  })

  test('a member sees nothing', () => {
    const { container } = render(createElement(ClueLadderSettingCard, { teamId, isOwner: false, enabled: true }))
    expect(container.innerHTML).toBe('')
  })

  test('nothing shows while the deployment switch is off', () => {
    switchOn = false
    const { container } = render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: false }))
    expect(container.innerHTML).toBe('')
  })
})
```

Match the static-import-after-`vi.mock` style if other hook tests use it.

- [ ] **Step 2: Run it to verify it fails.** Run: `TZ=UTC pnpm exec vitest run src/components/teams/clue-ladder-setting-card.hook.test.ts > "$SCRATCH/p8.log" 2>&1; echo "exit $?"`. Expected: exit 1.

- [ ] **Step 3: Implement**

```tsx
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'

/**
 * The owner opts the team into the clue ladder (wordle-teams-9j7o.3.2).
 *
 * HIDDEN WHILE THE DEPLOYMENT SWITCH IS OFF, not shown disabled: until the
 * pilot ships there is nothing to explain. useQuery, not useSuspenseQuery, so
 * this card never holds up the rest of /team; it simply appears once the
 * switch answers.
 *
 * `enabled` is getMyTeams' clueLadderEnabled, which is the switch AND the
 * team's flag. This renders only while the switch is on, so here it is the
 * team's flag.
 */
export function ClueLadderSettingCard({
  teamId,
  isOwner,
  enabled,
}: {
  teamId: Id<'teams'>
  isOwner: boolean
  enabled: boolean
}) {
  const { data: deployment } = useQuery(convexQuery(api.games.clueLadderSwitch, {}))
  const setClueLadder = useMutation({ mutationFn: useConvexMutation(api.games.setTeamClueLadder) })

  if (!isOwner || !deployment?.enabled) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Games</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="clue-ladder-enabled">Clue ladder</Label>
          <Switch
            id="clue-ladder-enabled"
            checked={enabled}
            disabled={setClueLadder.isPending}
            onCheckedChange={() =>
              setClueLadder.mutate(
                { teamId, enabled: !enabled },
                { onError: (error) => toast.error(mutationErrorMessage(error, 'Could not change that setting')) },
              )
            }
          />
        </div>
        <p className="text-sm text-muted-foreground">
          A daily logic puzzle with its own scoreboard. Your team sees it on the dashboard once it's on.
        </p>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run it to verify it passes.** Expected: exit 0.

- [ ] **Step 5: Mount it in `src/routes/team.tsx`**

Add the import beside the other `#/components/teams/` imports:

```ts
import { ClueLadderSettingCard } from '#/components/teams/clue-ladder-setting-card.tsx'
```

Insert directly after the closing `</div>` of the `<div id="scoring">` block and before the `{/* MY TEAMS SITS LAST …` comment:

```tsx
        {/* Owner only, and only while the clue ladder pilot is switched on for
            this deployment; the card renders nothing otherwise
            (wordle-teams-9j7o.3.2). Beside the scoring system, since both
            decide how this team's scoreboard reads. */}
        <ClueLadderSettingCard
          teamId={selectedTeam.id}
          isOwner={selectedTeam.isOwner}
          enabled={selectedTeam.clueLadderEnabled}
        />
```

If `selectedTeam.id` is typed `string` rather than `Id<'teams'>`, cast as the surrounding code does for `ScoringSystemCard`.

- [ ] **Step 6: Gates and commit**

Run all four gates. Then:

```bash
bd close wordle-teams-9j7o.3.2.1.8
git add src/components/teams/clue-ladder-setting-card.tsx src/components/teams/clue-ladder-setting-card.hook.test.ts src/routes/team.tsx .beads/issues.jsonl
git commit -F - <<'EOF'
feat(team): owner opts the team into the clue ladder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Gates and record

- [ ] **Step 1: Run all four gates separately**

```bash
TZ=UTC pnpm test:once > "$SCRATCH/t.log" 2>&1; echo "test $?"
pnpm typecheck > "$SCRATCH/tc.log" 2>&1; echo "tc $?"
pnpm lint > "$SCRATCH/l.log" 2>&1; echo "lint $?"
pnpm build > "$SCRATCH/b.log" 2>&1; echo "build $?"
```

Expected: all four `0`.

- [ ] **Step 2: Look at it.** Start the dev server against the local backend (see `CLAUDE.md`'s e2e notes; set `CLUE_LADDER_ENABLED=true` there with `--env-file`). As a team owner, switch the clue ladder on in team settings, then check that the dashboard shows the switch and that the clue ladder view shows the notice or an empty grid. Screenshot at 390px and at desktop width. Note anything that looks wrong on the epic. Plan 3 adds the e2e test.

- [ ] **Step 3: Record, close, push**

```bash
bd close wordle-teams-9j7o.3.2.1.9
bd update wordle-teams-9j7o.3.2 --append-notes "$(cat <<'EOF'
Plan 2 (play surface) done: shape icons, board (tap only), clues and controls, finished screen, dashboard card (presentational), ScoresGrid + GameScoresTable, dashboard switch, owner toggle on /team. Plan 3 mounts the card, adds the play route and share. Drag filed as a follow-up.
EOF
)"
bd close wordle-teams-9j7o.3.2.1
git add .beads/issues.jsonl
git commit -F - <<'EOF'
chore(play-surface): plan 2 recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git pull --rebase && git push
```

Confirm both closes landed in `HEAD:.beads/issues.jsonl` before pushing.
