// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, because this renders the
// real Radix dialog and reads the classes that actually landed on the element.
// `.hook.test.ts` and `createElement` by hand for the reasons
// app-menu.hook.test.ts spells out at its top.
//
// WHY IT EXISTS (wordle-teams-2uet). shadcn's stock DialogContent is
// `w-full max-w-lg ... sm:rounded-lg`, which below 640px is a panel spanning
// the whole viewport with square corners against the screen edges. FIVE of the
// seven call sites in this app independently pasted the same correction —
// `w-11/12 rounded-lg` — onto it. When five of seven callers fix the same
// thing, the fix is the intended default and the component is wrong; the two
// that had not pasted it rendered edge-to-edge on a phone.
//
// The correction now lives in the component, so what has to be pinned is that
// it SURVIVES: it type-checks, lints and builds identically either way, and
// `cn`'s tailwind-merge silently drops whichever of two conflicting utilities
// it likes less. Nothing but a rendered element can see which one won.
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { Dialog, DialogContent, DialogTitle } from './dialog.tsx'

afterEach(cleanup)

/** DialogContent needs an open Dialog root for Radix's context. */
function mount(className?: string) {
  render(
    createElement(
      Dialog,
      { open: true },
      createElement(DialogContent, { className }, createElement(DialogTitle, null, 'Title')),
    ),
  )
  return screen.getByRole('dialog').className.split(/\s+/)
}

describe('a dialog is inset and rounded on a phone by default', () => {
  test('the panel is narrowed off the screen edges', () => {
    // 11/12 leaves a 1/24 gutter on each side. `w-full` must be GONE rather
    // than merely overridden — both would be in the class list, and which one
    // wins would then be a fact about stylesheet order.
    const classes = mount()
    expect(classes).toContain('w-11/12')
    expect(classes).not.toContain('w-full')
  })

  test('and its corners are rounded at every width, not only at sm and up', () => {
    // The pairing is the whole bug: `sm:rounded-lg` alone is right for a
    // full-bleed panel meeting the edge squarely, and wrong the instant the
    // panel is inset. Square corners on an inset panel just look broken.
    const classes = mount()
    expect(classes).toContain('rounded-lg')
  })

  test('desktop is unchanged: max-w-lg still caps the width', () => {
    // 11/12 of any viewport wider than ~558px exceeds 32rem, so max-width wins
    // and the dialog is the same size it has always been on a laptop. This is a
    // phone-only change, and this is the assertion that says so.
    expect(mount()).toContain('max-w-lg')
  })

  test('a caller adding its own padding keeps the inset and the rounding', () => {
    // settings-dialog.tsx passes `px-3 py-4 md:p-6`. tailwind-merge only drops
    // a default when the caller CONFLICTS with it, and padding does not
    // conflict with width — but that is a property of the merge, not a promise,
    // so it is asserted rather than assumed.
    const classes = mount('px-3 py-4 md:p-6')
    expect(classes).toContain('w-11/12')
    expect(classes).toContain('rounded-lg')
    expect(classes).toContain('px-3')
  })

  test('a caller that genuinely wants full bleed can still say so', () => {
    // The default is a default, not a lock. No caller wants this today — the
    // two that rendered edge-to-edge did so by omission, and board-entry's
    // Dialog only mounts above 768px at all — but a future one that does should
    // opt out explicitly and visibly, at the call site, rather than by editing
    // this component out from under the other six.
    const classes = mount('w-full rounded-none')
    expect(classes).toContain('w-full')
    expect(classes).not.toContain('w-11/12')
  })
})

describe("the safe-area handling this change must not disturb", () => {
  test('the height is still bounded by the larger of 1rem and either inset', () => {
    // wordle-teams-8h2p. The box is CENTRED, so padding cannot move it off an
    // edge — bounding its height is the whole fix, and `max()` of both insets
    // clears the notch and the home indicator even when they differ.
    expect(screen.queryByRole('dialog')).toBeNull()
    const classes = mount()
    expect(
      classes.some((name) => name.startsWith('max-h-[calc(100dvh') && name.includes('safe-area-inset-top') && name.includes('safe-area-inset-bottom')),
      'the safe-area height bound is gone',
    ).toBe(true)
  })

  test('and the overflow that makes the bounded part reachable is still there', () => {
    // Bounding the height WITHOUT this would clip the overflow instead of
    // scrolling it, and Radix locks body scroll while the dialog is open, so
    // there would be no way to reach what was cut off.
    expect(mount()).toContain('overflow-y-auto')
  })
})
