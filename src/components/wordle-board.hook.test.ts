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
import { cleanup, render, screen } from '@testing-library/react'
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

const EMPTY = ['', '', '', '', '', '']

/**
 * THE CURSOR — wordle-teams-wty4.1.6. All 30 tiles used to render identically, so
 * nothing on screen said where the next letter would land and the fact that rows
 * advance by themselves was invisible.
 *
 * THE POSITION IS NOT COMPUTED HERE. It arrives as a prop, from `cursorFor` in
 * board-entry/entry-cursor.ts, which is the single definition shared with the
 * answer slots. A previous version of this feature derived it a second way and the
 * two disagreed on import-prefilled boards (wordle-teams-lz3w).
 */
describe('WordleBoard cursor', () => {
  /**
   * The display board (team-boards.tsx) is not an input and must never grow a
   * caret. The prop is optional and absent there; this is what keeps it so.
   */
  test('renders no cursor when none is given', () => {
    const { container } = render(createElement(WordleBoard, { guesses: EMPTY, answer: 'CRANE' }))
    expect(container.querySelectorAll('[data-cursor="true"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-testid="board-cursor"]')).toHaveLength(0)
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
    const marked = screen.getAllByTestId('board-cursor')
    expect(marked).toHaveLength(1)
    expect(marked[0].id).toBe('1-3')
  })

  /**
   * THE MARK ITSELF, NOT THE ATTRIBUTE DESCRIBING IT. Task 5's first draft of the
   * answer caret rendered its attribute and no caret and passed every test it had.
   * Whatever makes the active tile visibly different must be asserted directly.
   */
  test('the marked tile is visibly distinguished from its neighbours', () => {
    render(
      createElement(WordleBoard, {
        guesses: ['SL', '', '', '', '', ''],
        answer: 'CRANE',
        boardEntry: true,
        cursor: { row: 0, col: 2 },
      }),
    )
    const marked = screen.getByTestId('board-cursor')
    const neighbour = document.getElementById('1-4')
    expect(neighbour).not.toBeNull()
    expect(marked.className).not.toBe(neighbour?.className)
  })

  /**
   * AND THE DIFFERENCE IS THE RING, not the tile's own border colour. The border
   * encodes the tile's RESULT (correct/present/absent/empty); overwriting it would
   * make the active tile read as a different result. The ring draws outside it.
   *
   * Pinned by name because the test above only proves the two classNames differ —
   * it would still pass if the mark were something invisible under jsdom.
   */
  test('the mark is a ring drawn outside the tile, and the border state is untouched', () => {
    render(
      createElement(WordleBoard, {
        guesses: ['SL', '', '', '', '', ''],
        answer: 'CRANE',
        boardEntry: true,
        cursor: { row: 0, col: 2 },
      }),
    )
    const marked = screen.getByTestId('board-cursor')
    const neighbour = document.getElementById('1-4') as HTMLElement
    expect(marked.className).toMatch(/(^|\s)ring-2(\s|$)/)
    expect(marked.className).toMatch(/(^|\s)ring-ring(\s|$)/)
    expect(neighbour.className).not.toMatch(/(^|\s)ring-2(\s|$)/)
    // The state colours are the other component of the tile's appearance and the
    // cursor must not spend them: both tiles are still `empty`.
    expect(marked.getAttribute('data-state')).toBe('empty')
    expect(marked.className).toContain('border-wordle-tile-border')
    expect(neighbour.className).toContain('border-wordle-tile-border')
  })

  test('a cursor on a later row marks a tile in that row', () => {
    render(
      createElement(WordleBoard, {
        guesses: ['SLATE', 'TR', '', '', '', ''],
        answer: 'CRANE',
        boardEntry: true,
        cursor: { row: 1, col: 2 },
      }),
    )
    expect(screen.getByTestId('board-cursor').id).toBe('2-3')
  })

  /**
   * THE SECOND LOCK. team-boards.tsx passes no cursor, but that is a convention a
   * future caller can break by accident — forwarding props wholesale, say. The
   * component gates on `boardEntry` as well, so a board that is only being READ
   * cannot be given a caret by any argument. This is what holds that.
   */
  test('a cursor is ignored entirely unless the board is the entry board', () => {
    const { container } = render(
      createElement(WordleBoard, {
        guesses: ['SL', '', '', '', '', ''],
        answer: 'CRANE',
        cursor: { row: 0, col: 2 },
      }),
    )
    expect(container.querySelectorAll('[data-testid="board-cursor"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-cursor="true"]')).toHaveLength(0)
    expect(document.getElementById('1-3')?.className).not.toMatch(/(^|\s)ring-2(\s|$)/)
  })

  test('an explicit null cursor marks nothing', () => {
    const { container } = render(
      createElement(WordleBoard, {
        guesses: ['SLATE', '', '', '', '', ''],
        answer: 'CRANE',
        boardEntry: true,
        cursor: null,
      }),
    )
    expect(container.querySelectorAll('[data-testid="board-cursor"]')).toHaveLength(0)
  })
})
