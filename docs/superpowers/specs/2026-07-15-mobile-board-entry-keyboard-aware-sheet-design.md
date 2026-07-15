# Mobile Board-Entry: Keyboard-Aware Scrollable Sheet

**Date:** 2026-07-15
**Status:** Design — awaiting approval
**Area:** `src/components/action-buttons/board-entry/*`, `src/components/action-buttons/board-entry-button.tsx`, `src/components/ui/sheet.tsx` (read-only reference), new `src/lib/hooks/`

## Problem

On mobile, board entry renders as a Radix Dialog–based `Sheet` with `side="top"` (`board-entry-button.tsx`). `SheetContent` is `position: fixed; top: 0`, auto-height, with **no internal scroll region**. Focusing the `contentEditable` answer/board fields summons the **native mobile keyboard**.

On **iOS Safari**, opening the keyboard does **not** shrink the layout viewport (nor `100vh`/`100dvh`), so the fixed panel does not reflow. The result:

- Only the first few of the 6 guess rows are visible; the rest — and the **Submit** button — sit *behind* the keyboard.
- The user cannot reach them without dismissing the keyboard (Enter on the virtual keyboard).
- Finger-scrolling does nothing: Radix locks body scroll and there is no `overflow-y: auto` region to scroll.

This surfaced after the 16px font fix (which stopped the focus-zoom); the layout problem was previously masked by the zoom behavior.

## Goal

When the native keyboard is open on mobile board entry:

- All 6 board rows are reachable via finger-scroll.
- The **Submit** button (and Cancel) stay visible and tappable, pinned above the keyboard.
- The row currently being typed into auto-scrolls into view.
- The native keyboard is retained (the on-screen-keyboard approach was tried previously and abandoned due to quirks).
- The desktop Dialog experience is unchanged.

## Approach

**Drive layout off the `visualViewport` API.** iOS Safari does not resize the layout viewport when the keyboard opens, but it *does* update `window.visualViewport` (`height` shrinks to the area above the keyboard; `offsetTop` reflects any viewport shift). We bound the sheet to that visible area and give it an internal scroll region plus a sticky footer.

A CSS-only route (`interactive-widget=resizes-content` viewport meta + `100dvh`) was rejected: it only affects Android Chrome; iOS Safari ignores `interactive-widget`, so it does not fix the reported case.

`side="top"` is retained — we only bound the panel's height/offset so it sits above the keyboard; the slide-from-top animation is unchanged.

## Components & Changes

### 1. New hook — `src/lib/hooks/use-visual-viewport.ts`

Single-purpose, reusable, SSR-safe.

- Reads `window.visualViewport`; subscribes to its `resize` and `scroll` events.
- Returns `{ height, offsetTop }` describing the visible area above the keyboard.
- Fallback when the API is unavailable: `{ height: window.innerHeight, offsetTop: 0 }`.
- Cleans up listeners on unmount. Guards against `window`/`visualViewport` being undefined during SSR.

**Interface:** `useVisualViewport(): { height: number; offsetTop: number }`
**Depends on:** browser `visualViewport` API only.

### 2. `board-entry-button.tsx` — mobile Sheet only

- Call `useVisualViewport()` in the component.
- On the mobile `<SheetContent side="top">`, apply an inline `style={{ height, top: offsetTop }}` and classes to make it a flex column that clips overflow (`flex flex-col overflow-hidden`), so its children own scrolling.
- The desktop `<Dialog>` branch is left exactly as-is.

### 3. `form.tsx` — mobile-only layout, via responsive classes

- Wrap the header (date + answer) and the `WordleBoardInput` board in a scroll region: `flex-1 overflow-y-auto` (with appropriate `-webkit-overflow-scrolling` behavior). This is what restores finger-scroll and lets rows scroll into view.
- Make the existing mobile `SheetFooter` (Cancel + Submit) `sticky bottom-0` with a solid `bg-background` (and top padding/border as needed) so it pins above the keyboard.
- All changes are scoped to the mobile-visible elements; the desktop Dialog path (which uses `WordleBoardInput`'s own `md:visible` submit button and hides the `SheetFooter` via `md:invisible md:h-0`) is unaffected. Use `md:` variants where a class must not apply on desktop.

### 4. Auto-scroll the active row — `form.tsx`

- Each board row already renders with `id="word-${wordIndex}"` (`wordle-board.tsx`).
- Compute the active row index = index of the first guess with fewer than 5 letters (mirrors `utils.ts` `handleLetter`).
- In a `useEffect` keyed on `guesses` / `answer` (and on field focus), call `document.getElementById('word-' + activeIndex)?.scrollIntoView({ block: 'nearest' })`, scoped within the scroll region, so the row being typed stays visible without manual scrolling.

## Data Flow

`visualViewport` events → `useVisualViewport` state → inline height/offset on mobile `SheetContent` → flex column bounds the scroll region and pins the sticky footer. Typing updates `guesses`/`answer` → effect scrolls the active `#word-N` into view. No new global state, no network, no server changes.

## Edge Cases

- **`visualViewport` unavailable** (older browsers): fall back to `innerHeight`/`0`; the layout is still bounded and scrollable — degraded but functional.
- **Keyboard dismissed:** hook reports full height; sheet expands back to normal. No stuck/clipped state.
- **Orientation change / keyboard height change:** hook is reactive via `resize`; layout updates.
- **Answer field vs. board field focus:** answer sits near the top and remains visible; board rows are handled by `scrollIntoView`.
- **`position: fixed` + iOS keyboard quirk:** tracking `top: offsetTop` and `height` from `visualViewport` is the standard mitigation; verified on-device.
- **Desktop / tablet ≥ 768px:** uses the Dialog, none of this applies. Explicitly verify no regression.

## Testing / Verification

- **Manual, iOS Safari (primary)** via `dev.wordleteams.com`: open board entry, focus the answer then the board; confirm all 6 rows are reachable by finger-scroll, Submit and Cancel stay visible and tappable, the active row auto-scrolls into view, and no focus-zoom occurs.
- **Android Chrome:** sanity check the same flow.
- **Desktop Dialog:** confirm unchanged.
- **Optional unit test:** `useVisualViewport` fallback logic when `visualViewport` is undefined.

## Out of Scope

- On-screen keyboard (react-simple-keyboard) — previously abandoned.
- Changing the sheet `side`.
- Desktop Dialog layout.
- The `dev`-branch auto-deploy investigation (tracked separately).

## Acceptance Criteria

1. On iOS Safari mobile board entry with the keyboard open, the user can finger-scroll to every one of the 6 guess rows.
2. Submit and Cancel remain visible and tappable above the keyboard at all times while typing.
3. The row currently being typed into is scrolled into view automatically.
4. No focus-zoom regression (16px inputs preserved).
5. The desktop Dialog board-entry experience is visually and behaviorally unchanged.
6. When `visualViewport` is unavailable, the sheet still renders as a bounded, scrollable panel (no crash, no clipped-without-scroll state).
