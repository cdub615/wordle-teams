// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real component. `.hook.test.ts` matches the existing
// precedents — Header, settings/profile-tab, chat/message-list — and `.test.ts`
// rather than `.test.tsx` because vitest.config.ts's glob is
// `src/**/*.test.ts`, so the elements below go through `createElement` by hand.
//
// WHY THIS FILE EXISTS: wordle-teams-wty4.1.5. The entry board's tiles now step
// up to h-16 only when there is VERTICAL room for them, because a 6-row board
// at 64px a tile plus the dialog's chrome needs ~700px and any browser window
// shorter than that scrolled. The board used for VIEWING a teammate's game
// (teams/team-boards.tsx) must keep the design system's plain `md:h-16` — it is
// not in a height-constrained dialog and has no reason to shrink.
//
// THAT SCOPING IS THE WHOLE POINT AND IT IS EXACTLY WHAT WOULD REGRESS. Both
// boards render from this one component, so the tempting simplification is to
// apply the height-aware sizing to all of it. These tests fail if anyone does.
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { WordleBoard } from './wordle-board.tsx'

afterEach(cleanup)

/**
 * The first tile of the first row, which carries the sizing classes.
 *
 * `[id="1-1"]` rather than `#1-1`: the tiles are id'd by row and column, and a
 * CSS id selector cannot begin with a digit. Valid HTML, unselectable with `#`.
 */
const firstTile = () =>
  document.querySelector('[data-slot="wordle-board"] [id="1-1"]') as HTMLElement

const GUESSES = ['crane', 'slate', '', '', '', '']

describe('tile sizing is height-aware ONLY on the entry board', () => {
  test('the entry board steps up to h-16 only when the viewport is tall enough', () => {
    render(createElement(WordleBoard, { guesses: GUESSES, answer: 'slate', boardEntry: true }))

    const className = firstTile().className
    // The step-up is conditional on BOTH width and height. Width alone is what
    // the display board uses; height is what this bug was about.
    expect(className).toMatch(/min-height/)
    expect(className).toContain('h-14')
  })

  test('the entry board does NOT carry the unconditional md:h-16', () => {
    render(createElement(WordleBoard, { guesses: GUESSES, answer: 'slate', boardEntry: true }))

    // THE REGRESSION THIS CATCHES: a plain `md:h-16` here puts a 64px tile back
    // on a short laptop, which is the exact state that scrolled.
    expect(firstTile().className).not.toMatch(/(^|\s)md:h-16(\s|$)/)
  })

  test('the DISPLAY board keeps the design system\'s plain md:h-16', () => {
    render(createElement(WordleBoard, { guesses: GUESSES, answer: 'slate' }))

    const className = firstTile().className
    expect(className).toMatch(/(^|\s)md:h-16(\s|$)/)
    // It is not in a height-constrained dialog, so it must not inherit the
    // entry board's shrinking.
    expect(className).not.toMatch(/min-height/)
  })

  test('both boards agree on the mobile size, which was never the problem', () => {
    render(createElement(WordleBoard, { guesses: GUESSES, answer: 'slate', boardEntry: true }))
    const entry = firstTile().className
    cleanup()
    render(createElement(WordleBoard, { guesses: GUESSES, answer: 'slate' }))
    const display = firstTile().className

    expect(entry).toContain('h-14')
    expect(display).toContain('h-14')
  })
})
