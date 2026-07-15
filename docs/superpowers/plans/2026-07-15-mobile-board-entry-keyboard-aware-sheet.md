# Keyboard-Aware Scrollable Mobile Board-Entry Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On mobile board entry, when the native keyboard is open, make all 6 guess rows finger-scrollable and keep Submit/Cancel visible above the keyboard, without regressing the desktop Dialog.

**Architecture:** A `visualViewport`-driven React hook reports the visible area above the keyboard. The mobile `SheetContent` is bounded to that area and becomes a flex column: a scrollable region (header + board) plus a pinned footer (Cancel/Submit). An effect scrolls the active guess row into view as the user types. iOS Safari does not resize the layout viewport for the keyboard, so `visualViewport` — not `100dvh` — is the source of truth.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Radix Dialog (via `ui/sheet.tsx`). No test framework exists in this repo; verification is `tsc --noEmit` + `pnpm lint` + on-device manual testing (matching existing conventions — introducing a test harness is out of scope).

---

## Testing note

This repo has **no unit-test framework** (no vitest/jest, no `test` script; CI only runs a Supabase type-drift check). Per the writing-plans "follow existing patterns" rule, we do **not** add one for this UI change. Automated verification per task = TypeScript compile (`pnpm exec tsc --noEmit`) and lint (`pnpm lint`). Behavioral verification = the manual on-device checklist in Task 5.

## File Structure

- **Create** `src/lib/hooks/use-visual-viewport.tsx` — hook returning `{ height, offsetTop }` of the area above the keyboard. Single responsibility; mirrors the existing `use-media-query.tsx` pattern.
- **Modify** `src/components/action-buttons/board-entry-button.tsx` — bound the mobile `SheetContent` to the visual viewport and make it a flex column.
- **Modify** `src/components/action-buttons/board-entry/form.tsx` — wrap header + board in a scroll region, pin the footer as a flex child, add the active-row auto-scroll effect and board `onFocus` hook-up.
- **Modify** `src/components/action-buttons/board-entry/wordle-board-input.tsx` — accept and attach an `onBoardFocus` callback so focusing the board scrolls the active row into view.

Desktop is unaffected because `DialogContent` is a `grid` with no `max-height`: `flex-1`/`overflow-y-auto` are inert there, and the mobile footer is already `md:invisible md:h-0`.

---

### Task 1: `useVisualViewport` hook

**Files:**
- Create: `src/lib/hooks/use-visual-viewport.tsx`

- [ ] **Step 1: Create the hook file**

Create `src/lib/hooks/use-visual-viewport.tsx` with exactly:

```tsx
import * as React from 'react'

export type VisualViewportState = {
  height: number
  offsetTop: number
}

function readViewport(): VisualViewportState {
  if (typeof window === 'undefined') return { height: 0, offsetTop: 0 }
  const vv = window.visualViewport
  if (vv) return { height: vv.height, offsetTop: vv.offsetTop }
  return { height: window.innerHeight, offsetTop: 0 }
}

/**
 * Tracks the visual viewport (the area above the on-screen keyboard).
 * iOS Safari does not shrink the layout viewport when the keyboard opens,
 * but it does update `window.visualViewport`, so this is the reliable source
 * of truth for bounding fixed overlays above the keyboard.
 *
 * Returns { height: 0, offsetTop: 0 } during SSR and { innerHeight, 0 } when
 * the visualViewport API is unavailable.
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = React.useState<VisualViewportState>(readViewport)

  React.useEffect(() => {
    const vv = window.visualViewport
    const update = () => setState(readViewport())
    update()

    if (vv) {
      vv.addEventListener('resize', update)
      vv.addEventListener('scroll', update)
      return () => {
        vv.removeEventListener('resize', update)
        vv.removeEventListener('scroll', update)
      }
    }

    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return state
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no errors). `window.visualViewport` is typed in the DOM lib; no extra types needed.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hooks/use-visual-viewport.tsx
git commit -m "feat: add useVisualViewport hook for keyboard-aware layout"
```

---

### Task 2: Bound the mobile `SheetContent` to the visual viewport

**Files:**
- Modify: `src/components/action-buttons/board-entry-button.tsx`

- [ ] **Step 1: Import the hook**

At the top of `board-entry-button.tsx`, add the import alongside the existing `useMediaQuery` import:

```tsx
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { useVisualViewport } from '@/lib/hooks/use-visual-viewport'
```

- [ ] **Step 2: Call the hook in the component**

Inside `BoardEntryButton`, add the hook call next to the existing state (just below `const isDesktop = useMediaQuery('(min-width: 768px)')`):

```tsx
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const { height, offsetTop } = useVisualViewport()
```

- [ ] **Step 3: Apply the bound + flex-column layout to the mobile `SheetContent`**

Replace the mobile `SheetContent` opening tag:

```tsx
      <SheetContent side={'top'}>
```

with:

```tsx
      <SheetContent
        side={'top'}
        className='flex flex-col gap-0 overflow-hidden'
        style={{ maxHeight: height || undefined, top: offsetTop }}
      >
```

Notes:
- `maxHeight: height || undefined` caps the sheet at the visible area when measured, and falls back to no cap (current behavior) when `height` is `0` (SSR / API missing).
- `gap-0` neutralizes `SheetContent`'s base `gap-4`, which would otherwise activate once the element becomes `flex`.
- `top: offsetTop` keeps the top-anchored sheet aligned to the visible area if iOS shifts the viewport (`offsetTop` is `0` in the normal case).

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.
Run: `pnpm lint`
Expected: PASS (no new warnings/errors in this file).

- [ ] **Step 5: Commit**

```bash
git add src/components/action-buttons/board-entry-button.tsx
git commit -m "feat: bound mobile board-entry sheet to visual viewport"
```

---

### Task 3: Scroll region + pinned footer in the form

**Files:**
- Modify: `src/components/action-buttons/board-entry/form.tsx`

- [ ] **Step 1: Make the form a flex column**

Change the `<form>` opening tag (currently line ~118):

```tsx
    <form onSubmit={handleSubmit} className={cn(submitting ? 'animate-pulse' : '')}>
```

to:

```tsx
    <form onSubmit={handleSubmit} className={cn('flex flex-col min-h-0 flex-1', submitting ? 'animate-pulse' : '')}>
```

(`flex-1`/`min-h-0` are inert on desktop, where the `grid` `DialogContent` has no bounded height.)

- [ ] **Step 2: Wrap header + board in a scroll region**

The four `<input hidden .../>` elements stay directly under `<form>` (unchanged). Wrap the date/answer row `<div>` and the `<WordleBoardInput ... />` in a new scroll container. Concretely, insert an opening `<div className='flex-1 min-h-0 overflow-y-auto'>` immediately after the last hidden input (before `<div className="flex items-center space-x-4 ...">`), and a closing `</div>` immediately after the `<WordleBoardInput ... />` closing tag (before `<SheetFooter ...>`).

Resulting structure (abbreviated — inner content of the date/answer div and WordleBoardInput props are unchanged):

```tsx
      <input hidden readOnly aria-readonly name="scoreId" value={scoreId} />
      <input hidden readOnly aria-readonly name="scoreDate" value={date?.toISOString()} />
      <input hidden readOnly aria-readonly name="guesses" value={guesses} />
      <input hidden readOnly aria-readonly name="answer" value={answer} />
      <div className='flex-1 min-h-0 overflow-y-auto'>
        <div className="flex items-center space-x-4 md:space-x-4 w-full md:px-4 ml-2">
          {/* ...existing date + answer content, unchanged... */}
        </div>
        <WordleBoardInput
          guesses={guesses}
          setGuesses={setGuesses}
          answer={answer}
          tabIndex={3}
          submitting={submitting}
          submitDisabled={submitDisabled}
          scoreId={scoreId}
        />
      </div>
      <SheetFooter className="pt-2 flex flex-row space-x-2 w-full shrink-0 bg-background md:invisible md:h-0 md:p-0">
        {/* ...existing Cancel + Submit buttons, unchanged... */}
      </SheetFooter>
```

- [ ] **Step 3: Pin the footer**

In the `SheetFooter` className, add `shrink-0 bg-background` (shown above) so the footer keeps its height and paints a solid background at the bottom of the bounded flex column — i.e. directly above the keyboard. Do not remove the existing `md:invisible md:h-0 md:p-0` (keeps it hidden on desktop).

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.
Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/action-buttons/board-entry/form.tsx
git commit -m "feat: scrollable board region + pinned footer in mobile board entry"
```

---

### Task 4: Auto-scroll the active guess row into view

**Files:**
- Modify: `src/components/action-buttons/board-entry/form.tsx`
- Modify: `src/components/action-buttons/board-entry/wordle-board-input.tsx`

- [ ] **Step 1: Add the scroll helper + effect in `form.tsx`**

`useEffect` is already imported in `form.tsx`. Add this helper and effect inside the `WordleBoardForm` component, above the `return`:

```tsx
  const scrollActiveRowIntoView = () => {
    const activeIndex = guesses.findIndex((g) => g.length < 5)
    const idx = activeIndex === -1 ? guesses.length - 1 : activeIndex
    document.getElementById(`word-${idx}`)?.scrollIntoView({ block: 'nearest' })
  }

  useEffect(() => {
    scrollActiveRowIntoView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guesses])
```

Rationale: `guesses` is the padded 6-element array; the first entry with `< 5` letters is the row being typed (mirrors `handleLetter` in `utils.ts`). When the board is full (`-1`), target the last row. `block: 'nearest'` avoids unnecessary jumps. Keyed on `guesses` only — the answer field lives at the top of the scroll region and stays visible, so answer edits do not trigger a board-row scroll.

- [ ] **Step 2: Pass the focus callback to the board**

Where `WordleBoardInput` is rendered in `form.tsx` (inside the new scroll region), add the `onBoardFocus` prop:

```tsx
        <WordleBoardInput
          guesses={guesses}
          setGuesses={setGuesses}
          answer={answer}
          tabIndex={3}
          submitting={submitting}
          submitDisabled={submitDisabled}
          scoreId={scoreId}
          onBoardFocus={scrollActiveRowIntoView}
        />
```

- [ ] **Step 3: Accept and attach `onBoardFocus` in `wordle-board-input.tsx`**

Add `onBoardFocus` to the props type:

```tsx
type WordleBoardProps = {
  guesses: string[]
  setGuesses: Dispatch<SetStateAction<string[]>>
  answer: string
  tabIndex?: number
  submitting: boolean
  submitDisabled: boolean
  scoreId: number
  onBoardFocus?: () => void
}
```

Destructure it in the component signature:

```tsx
export default function WordleBoardInput({
  guesses,
  setGuesses,
  answer,
  tabIndex,
  submitting,
  submitDisabled,
  scoreId,
  onBoardFocus,
}: WordleBoardProps) {
```

Attach it to the board `contentEditable` `<div>` by adding `onFocus={onBoardFocus}` to that element (the `<div contentEditable={true} onKeyDown={handleBoardKeyDown} ...>`):

```tsx
      <div
        contentEditable={true}
        onKeyDown={handleBoardKeyDown}
        onFocus={onBoardFocus}
        onChange={(e) => e.preventDefault()}
        onInput={(e) => e.preventDefault()}
        className='flex w-full h-fit justify-center mt-4 md:my-6 rounded-lg caret-transparent select-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 focus:ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background'
        role='region'
        aria-label='Wordle Board'
        tabIndex={tabIndex}
      >
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.
Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/action-buttons/board-entry/form.tsx src/components/action-buttons/board-entry/wordle-board-input.tsx
git commit -m "feat: auto-scroll active guess row into view on board entry"
```

---

### Task 5: Full verification (build + on-device)

**Files:** none (verification only).

- [ ] **Step 1: Production build**

Run: `pnpm build`
Expected: build succeeds with no TypeScript/lint errors.

- [ ] **Step 2: Deploy the branch to a Vercel preview for device testing**

Push the branch and open a PR to `dev`:

```bash
git push -u origin feat/board-entry-keyboard-aware-sheet
gh pr create --base dev --head feat/board-entry-keyboard-aware-sheet --title "Keyboard-aware scrollable mobile board-entry sheet" --body "Implements docs/superpowers/specs/2026-07-15-mobile-board-entry-keyboard-aware-sheet-design.md"
```

The PR gets a Vercel preview URL for on-device testing. (Note: merges to `dev` currently require a manual Vercel deploy trigger — see the parked auto-deploy investigation.)

- [ ] **Step 3: Manual checklist — iOS Safari (primary), on the preview URL**

Open board entry on a phone-sized viewport and confirm:
- Focusing the answer field: no zoom; answer visible.
- Focusing the board and typing guesses: the row being typed stays visible (auto-scrolls into view).
- All 6 guess rows are reachable by finger-scroll while the keyboard is open.
- Cancel and Submit stay visible and tappable above the keyboard at all times.
- Dismissing the keyboard: the sheet expands back with no clipped/stuck state.

- [ ] **Step 4: Manual checklist — Android Chrome**

Repeat Step 3's flow; confirm equivalent behavior.

- [ ] **Step 5: Manual checklist — desktop (≥768px)**

Open board entry in the desktop Dialog; confirm layout and behavior are unchanged from before (no inner scrollbar, submit via the board's own button as today).

---

## Self-Review

**Spec coverage:**
- Goal (rows reachable, submit visible, auto-scroll active row, native keyboard kept, desktop unchanged) → Tasks 2-4, verified in Task 5. ✓
- `useVisualViewport` hook w/ fallback → Task 1. ✓
- Bound `SheetContent` mobile-only → Task 2. ✓
- Scroll region + pinned footer, mobile-only via responsive classes → Task 3. ✓
- Auto-scroll active row → Task 4. ✓
- Edge cases (API missing fallback, keyboard close, orientation, desktop) → hook fallback (Task 1), flex `maxHeight` fallback (Task 2), verification (Task 5). ✓
- Acceptance criteria 1-6 → covered by Tasks 2-5. ✓

**Deviation from spec (intentional):** the spec described the footer as `position: sticky bottom-0`. The plan pins it via flexbox instead (footer is a `shrink-0` flex child at the bottom of the bounded flex column). Same visible outcome — footer above the keyboard — but more robust than `sticky` inside a `position: fixed` + `overflow` container on iOS. Auto-scroll is keyed on `guesses` + board `onFocus` (not answer focus), because the answer field sits at the top of the scroll region and is already visible; scrolling to a board row on answer focus would be wrong.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `VisualViewportState { height, offsetTop }` used consistently in Tasks 1-2; `onBoardFocus?: () => void` defined and consumed consistently in Task 4. ✓
