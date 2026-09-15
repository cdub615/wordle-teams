// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real form; `.hook.test.ts` and `createElement` for the same
// reasons as every other component test in src/.
//
// WHY THIS FILE EXISTS. Splitting board entry by data source (form.tsx) left
// two facts undefended, both of which survive tsc, eslint, the unit suite AND
// the e2e suite:
//
//   1. WHICH PLAYER'S SCORES THE TEAM BRANCH PREFILLS FROM. getTeamMonth
//      returns EVERY member's scores, so the branch has to find the caller's
//      row by id. Flip that `===` to `!==` and the form prefills from a
//      TEAMMATE's board — someone else's answer, in your entry form, one submit
//      away from being written to your own day. e2e cannot see it because
//      signInWithTeam builds a ONE-MEMBER team, where find(!==) returns
//      undefined, falls through `?? []` and is indistinguishable from a fresh
//      board. The cruder mutant `data.players[0]?.scores` does die today — but
//      at TS6133 'myPlayerId' is declared but never read, i.e. by
//      noUnusedLocals, not by anything asserting the scoping.
//
//   2. THE SOLO `playWeekends` DEFAULT. It is the one genuinely new product
//      decision in the team-less work — it decides which days a player with no
//      team may select — and it shipped with a five-line justification comment
//      and zero assertions.
//
// DatePicker IS MOCKED TO A PROBE, and `playWeekends` is asserted at that prop
// rather than through the rendered calendar deliberately: date-picker.hook.test.ts:101
// ("weekends are withheld from a team that does not play them") already owns
// what the picker DOES with the flag. What is unowned, and what this file
// pins, is which value each branch hands it.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import { BoardEntryForm } from './form.tsx'
import { monthOf, toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { boardIsValid } from '../../../convex/lib/board.ts'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * The real clock, like convex/scores.test.ts's `today`. pickDefaultDay returns
 * today whenever today is in the month asked for and playable, so building the
 * fixtures around it makes "the selected day" deterministic whenever this runs,
 * rather than only in September 2026.
 */
const today = toPuzzleDay(new Date())
const thisMonth = monthOf(today)

const TEAM_ID = 'team-1' as Id<'teams'>
const ME = 'player-me'
const TEAMMATE = 'player-mate'

type TeamMonth = {
  team: { playWeekends: boolean }
  players: Array<{ id: string; scores: Array<Record<string, unknown>> }>
}

let teamMonth: TeamMonth
let myMonth: Array<Record<string, unknown>>
/** Every Convex query the render actually asked for, in order. */
let requested: Array<string>

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({
    queryKey: [getFunctionName(ref), args],
  }),
  useConvexMutation: () => vi.fn(),
  // isPro is false in this file's mock, so step one renders the upgrade offer,
  // and useStartUpgrade behind it reaches createProCheckout through an action.
  // Nothing here exercises it; it only has to exist.
  useConvexAction: () => vi.fn(),
}))

/**
 * The mutations the form fired, and the toasts it raised. Module-level (through
 * `vi.hoisted`, because `vi.mock` is lifted above any const it would otherwise
 * close over) rather than per-render spies, so the Enter key's two outcomes can
 * be told apart.
 */
const { fired, warnings } = vi.hoisted(() => ({
  fired: [] as Array<Record<string, unknown>>,
  warnings: [] as Array<string>,
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    const name = queryKey[0]
    requested.push(name)
    if (name === getFunctionName(api.scores.getTeamMonth)) return { data: teamMonth }
    if (name === getFunctionName(api.scores.getMyPlayerId)) return { data: ME }
    if (name === getFunctionName(api.scores.getMyMonth)) return { data: myMonth }
    throw new Error(`Board entry asked for an unexpected query: ${name}`)
  },
  useQuery: () => ({ data: false }),
  useMutation: () => ({
    mutateAsync: async (args: Record<string, unknown>) => {
      fired.push(args)
      return null
    },
  }),
}))

// The real toaster is a live region of its own, so leaving it unmocked would make
// `getByRole('status')` ambiguous the moment a toast appeared — and this file now
// renders a live region of its own (the coach line) to assert on.
vi.mock('sonner', () => ({
  toast: {
    warning: (message: string) => warnings.push(message),
    success: () => {},
    error: () => {},
  },
}))

/**
 * A probe, not the real picker. Renders the two props this file is about so
 * they can be read straight off the DOM, and hands the test its `onSelect` —
 * which is the only way `day` can become undefined (pickDefaultDay always
 * returns one).
 */
let selectDay: ((day: string | undefined) => void) | null = null
vi.mock('#/components/date-picker.tsx', () => ({
  DatePicker: ({
    day,
    playWeekends,
    onSelect,
  }: {
    day?: string
    playWeekends?: boolean
    onSelect?: (day: string | undefined) => void
  }) => {
    selectDay = onSelect ?? null
    return createElement('div', {
      'data-testid': 'date-picker',
      'data-day': day ?? '',
      'data-play-weekends': String(playWeekends),
    })
  },
}))

/**
 * THE REAL BOARD, NOT A STUB. This file used to mock BoardInput away; the
 * keystroke stream is form.tsx's now, and the only honest place to assert it is
 * the board a player actually sees.
 *
 * jsdom implements no scrolling at all, so `scrollIntoView` is absent and
 * scrollActiveRowIntoView would throw on the first keystroke.
 *
 * IT COUNTS RATHER THAN DOING NOTHING, which is the difference between a stub
 * that keeps the suite alive and one that can see a bug. form.tsx's rule that a
 * refused keystroke must not be written back exists ENTIRELY to stop this effect
 * firing on keys that changed nothing — with a no-op stub, stripping that rule
 * leaves every test in the repo green.
 */
let scrolls = 0
/**
 * AND WHICH ELEMENT IT WAS AIMED AT, which is the only geometry-free way to see
 * either of the two scroll bugs this file now pins. jsdom reports every box as
 * 0x0, so "is the answer visible" is unanswerable here — but "was the scroll
 * aimed at the answer zone or at a board tile" is a fact about the DOM, and it
 * is precisely the fact both bugs got wrong.
 *
 * A `function`, NOT AN ARROW, because `this` is the element scrollIntoView was
 * called on and an arrow has none.
 */
let scrollTargets: Array<Element> = []
Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
  scrolls += 1
  scrollTargets.push(this)
}

beforeEach(() => {
  requested = []
  myMonth = []
  teamMonth = { team: { playWeekends: true }, players: [] }
  fired.length = 0
  warnings.length = 0
  selectDay = null
  scrolls = 0
  scrollTargets = []
})

afterEach(cleanup)

/**
 * THE ONE FOCUSABLE THING ON THE ENTRY STEP, and since wordle-teams-5n6n it is a
 * visually-hidden real `<input>` rather than a contentEditable wrapped around the
 * slots and the board. It still answers to `getByRole('group', ...)` because
 * form.tsx puts `role="group"` on it deliberately — that ARIA override is what
 * keeps this selector, and its three siblings in e2e/board-entry.spec.ts, pointing
 * at the entry surface instead of at a `textbox` that holds nothing.
 */
const entryInput = () =>
  screen.getByRole('group', { name: 'Wordle board entry' }) as HTMLInputElement
/** Kept under its old name because every keystroke in this file is aimed at it. */
const region = entryInput
/** The slots and the board, which are pure presentation and focus nothing. */
const presentation = () => screen.getByTestId('entry-presentation')
/** The board half of it, which is no longer a focus target of its own. */
const boardHalf = () => screen.getByRole('region', { name: 'Wordle Board' })
const coach = () => screen.getByTestId('entry-coach')
/**
 * The answer, read off the five slots that replaced the `#answer` box. The caret
 * deliberately contributes no text, so this is the letters and nothing else.
 */
const answerText = () => screen.getAllByTestId('answer-slot').map((slot) => slot.textContent).join('')
/** Which slot the caret is on, or -1. */
const answerCursor = () =>
  screen.getAllByTestId('answer-slot').findIndex((slot) => slot.getAttribute('data-cursor') === 'true')
/** A board row, 1-based, as wordle-board.tsx ids its tiles. */
const boardRow = (row: number) =>
  [1, 2, 3, 4, 5].map((col) => document.getElementById(`${row}-${col}`)?.textContent ?? '').join('')
/** Keystrokes, at the region, with nothing in between them. */
const type = (keys: string) => {
  for (const key of keys) fireEvent.keyDown(region(), { key })
}
const picker = () => screen.getByTestId('date-picker')

/**
 * Board entry now opens on a step that asks which day and how, and the answer
 * field lives on the step after it. What these tests pin — which QUERY feeds
 * the prefill — is unchanged; reaching the field it prefills takes one click.
 */
const goToEntry = () => fireEvent.click(screen.getByRole('button', { name: /enter manually/i }))

describe('the team branch prefills from the CALLER, never a teammate', () => {
  test("a teammate's board on the selected day does not become the caller's prefill", () => {
    // A two-member team is the whole point: this is exactly the shape e2e never
    // builds. The teammate has today's board; the caller has nothing.
    teamMonth = {
      team: { playWeekends: true },
      players: [
        { id: ME, scores: [] },
        {
          id: TEAMMATE,
          scores: [{ id: 'score-mate', puzzleDay: today, answer: 'CRANE', guesses: ['CRANE'] }],
        },
      ],
    }

    render(createElement(BoardEntryForm, { teamId: TEAM_ID, month: thisMonth, onSuccess: () => {} }))

    // The form opened on today, so a mis-scoped lookup WOULD have found the
    // teammate's row — which is what makes the empty answer meaningful rather
    // than vacuous.
    expect(picker().getAttribute('data-day')).toBe(today)
    goToEntry()
    expect(answerText()).toBe('')
  })

  test("the caller's OWN board on that day still prefills", () => {
    // The mirror, and the reason the test above cannot be satisfied by a form
    // that simply never prefills anything.
    teamMonth = {
      team: { playWeekends: true },
      players: [
        { id: ME, scores: [{ id: 'score-me', puzzleDay: today, answer: 'SPEED', guesses: ['SPEED'] }] },
        {
          id: TEAMMATE,
          scores: [{ id: 'score-mate', puzzleDay: today, answer: 'CRANE', guesses: ['CRANE'] }],
        },
      ],
    }

    render(createElement(BoardEntryForm, { teamId: TEAM_ID, month: thisMonth, onSuccess: () => {} }))

    goToEntry()
    expect(answerText()).toBe('SPEED')
  })
})

describe('each branch hands DatePicker the right playWeekends', () => {
  test("the team branch forwards the TEAM's setting", () => {
    teamMonth = { team: { playWeekends: false }, players: [{ id: ME, scores: [] }] }

    render(createElement(BoardEntryForm, { teamId: TEAM_ID, month: thisMonth, onSuccess: () => {} }))

    expect(picker().getAttribute('data-play-weekends')).toBe('false')
  })

  test('a team-less player gets weekends, because a new team would have given them weekends', () => {
    // THE ONE NEW PRODUCT DECISION IN THE TEAM-LESS WORK. There is no team to
    // ask, so the solo branch hardcodes true — create-team-dialog.tsx ships
    // both switches on, so this is what the player will see on the team they
    // are about to create. Choosing false would silently disable weekend entry
    // for someone who never chose that, and every gate would stay green.
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(picker().getAttribute('data-play-weekends')).toBe('true')
  })
})

describe('the dispatcher picks its query by whether there is a team', () => {
  test('no teamId: getMyMonth alone — no getTeamMonth, and no getMyPlayerId either', () => {
    // getMyPlayerId exists only to find the caller's row inside getTeamMonth's
    // multi-player payload. getMyMonth is already scoped to the caller, so
    // asking for it here would be a wasted subscription on the very screen this
    // work exists to make fast.
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(requested).toEqual([getFunctionName(api.scores.getMyMonth)])
  })

  test('a teamId: getTeamMonth and getMyPlayerId, in that order, and never getMyMonth', () => {
    teamMonth = { team: { playWeekends: true }, players: [{ id: ME, scores: [] }] }

    render(createElement(BoardEntryForm, { teamId: TEAM_ID, month: thisMonth, onSuccess: () => {} }))

    expect(requested).toEqual([
      getFunctionName(api.scores.getTeamMonth),
      getFunctionName(api.scores.getMyPlayerId),
    ])
  })

  test('the solo branch still prefills the caller’s own board for the day', () => {
    // Same prefill path as the team branch, fed by the other query — the point
    // of getMyMonth emitting getTeamMonthFor's exact score shape.
    myMonth = [{ id: 'score-solo', puzzleDay: today, answer: 'TOAST', guesses: ['TOAST'] }]

    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    goToEntry()
    expect(answerText()).toBe('TOAST')
  })
})

/**
 * THE FEATURE, AND THE REASON THIS TASK COULD NOT BE SPLIT ACROSS COMMITS.
 *
 * Board entry used to hold TWO focus targets with a keydown handler each — the
 * `#answer` box and the board's own contentEditable — so a player who finished
 * the answer had to DISCOVER that the board needed clicking, and the keystroke
 * they discovered it with vanished. Everything below types without ever clicking
 * between the two halves, which is the whole of what changed.
 */
describe('one keystroke stream, from the answer into the board', () => {
  const openEntry = () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
  }

  test('the fifth answer letter hands the caret to the board, with no click in between', () => {
    openEntry()

    type('CRAN')
    expect(answerText()).toBe('CRAN')
    // Still in the answer: the caret is on slot 4 and no tile is marked.
    expect(answerCursor()).toBe(4)
    expect(screen.queryByTestId('board-cursor')).toBeNull()

    type('E')
    expect(answerText()).toBe('CRANE')
    // THE HAND-OFF. No click, no Tab, no focus change — the caret is on the
    // board's first tile and the answer no longer has one.
    expect(answerCursor()).toBe(-1)
    expect(screen.getByTestId('board-cursor').id).toBe('1-1')

    // And the very next keystroke lands there.
    type('S')
    expect(boardRow(1)).toBe('S')
    expect(answerText()).toBe('CRANE')
  })

  test('rows advance on their own', () => {
    openEntry()
    type('CRANE')
    type('SLATE')
    type('B')

    expect(boardRow(1)).toBe('SLATE')
    expect(boardRow(2)).toBe('B')
    expect(screen.getByTestId('board-cursor').id).toBe('2-2')
  })

  /**
   * THE CORRECTION GESTURE, IN ONE PRESS. Type the answer, the caret hands
   * itself to the board, then change your mind about the last letter.
   *
   * The walk-back used to move the zone and delete NOTHING, so this press did
   * nothing visible and the replacement letter was then refused 'answer-full'
   * and did nothing either — two dead keystrokes in the commonest correction
   * there is. The rule now is that backspace removes exactly one thing at every
   * position (owner decision; entry-cursor.ts's `backspace` doc).
   */
  test('backspace walks back out of an empty board and eats the answer’s last letter', () => {
    openEntry()
    type('CRANE')
    expect(answerCursor()).toBe(-1)

    fireEvent.keyDown(region(), { key: 'Backspace' })
    expect(answerText()).toBe('CRAN')
    expect(answerCursor()).toBe(4)

    // And the replacement lands, rather than being refused as 'answer-full'.
    type('K')
    expect(answerText()).toBe('CRANK')
    // Five letters again, so the caret hands itself straight back to the board.
    expect(screen.getByTestId('board-cursor').id).toBe('1-1')
  })

  /**
   * THE DEAD END, CLOSED AT THE UI LEVEL RATHER THAN ONLY IN THE PURE MODULE.
   * `moveZone` refusing is necessary and not sufficient: a wiring that drops
   * `refused` on the floor leaves the player with the original silent no-op and a
   * green unit suite. This is what makes the board safe to render at full
   * strength with no lock and no dim.
   */
  test('an early click on the board is explained rather than swallowed', () => {
    openEntry()
    type('CR')

    fireEvent.mouseDown(boardHalf())

    expect(coach().textContent).toMatch(/answer first/i)
    // The caret did not move, so the next letter still goes to the answer.
    expect(answerCursor()).toBe(2)
    type('A')
    expect(answerText()).toBe('CRA')
    expect(boardRow(1)).toBe('')
  })

  test('a click back on the answer takes the caret back, and typing follows it', () => {
    openEntry()
    type('CRANE')
    type('SL')

    fireEvent.mouseDown(screen.getByRole('group', { name: /Today's Wordle answer/i }))

    // The trailing caret past a complete answer, which is the state a player
    // reaches by asking to correct one.
    expect(answerCursor()).toBe(4)
    fireEvent.keyDown(region(), { key: 'Backspace' })
    expect(answerText()).toBe('CRAN')
    // ...and the board they had typed is untouched.
    expect(boardRow(1)).toBe('SL')
  })
})

/**
 * THE COACH LINE. It is the entire accessibility mitigation for collapsing two
 * focus stops into one: a screen-reader user cannot see the caret hand itself
 * over, and hearing this line is how they learn that it did.
 */
describe('the coach line', () => {
  const openEntry = () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
  }

  test('is a polite live region, and its text changes at the hand-off', () => {
    openEntry()

    expect(coach().getAttribute('aria-live')).toBe('polite')
    expect(coach().getAttribute('role')).toBe('status')
    const before = coach().textContent
    expect(before).toMatch(/type today's answer/i)

    type('CRANE')

    expect(coach().textContent).not.toBe(before)
    expect(coach().textContent).toMatch(/first guess/i)
  })

  test('says nothing new for a Shift press', () => {
    openEntry()
    type('CRANE')
    const line = coach().textContent

    fireEvent.keyDown(region(), { key: 'Shift' })
    fireEvent.keyDown(region(), { key: 'ArrowLeft' })

    // 'not-a-letter' is the caller's to IGNORE — announcing it on every Shift
    // press in a live region is worse than silence.
    expect(coach().textContent).toBe(line)
  })

  /**
   * `valid` IS `submitDisabled === false`, NOT `boardIsValid(...)`. Two
   * conditions make this form submittable — a day AND a complete board — and
   * passing only the second would tell a player with no day to press Submit,
   * OUT LOUD, while Submit sits disabled.
   *
   * `pickDefaultDay` always returns a day, so the day is cleared here through the
   * picker's own `onSelect`: this pins the COMPOSITION, which is the part a
   * future edit can get wrong, rather than a path a player reaches today.
   */
  test('a complete board with no day does NOT say to press Enter or Submit', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    act(() => selectDay?.(undefined))
    goToEntry()

    type('CRANE')
    type('CRANE')

    // The board itself is complete — the mirror below proves it.
    expect(boardRow(1)).toBe('CRANE')
    expect(coach().textContent).not.toMatch(/press Enter or Submit/i)
    // And the line agrees with the buttons, which is the point.
    for (const button of screen.getAllByRole('button', { name: /^submit$/i })) {
      expect(button.hasAttribute('disabled')).toBe(true)
    }
  })

  test('the same board WITH a day does say it', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()

    type('CRANE')
    type('CRANE')

    expect(coach().textContent).toMatch(/press Enter or Submit/i)
    for (const button of screen.getAllByRole('button', { name: /^submit$/i })) {
      expect(button.hasAttribute('disabled')).toBe(false)
    }
  })
})

/**
 * The keystroke stream itself, through the REAL board. These moved here from
 * board-input.hook.test.ts when the handler did: the shapes are the ones
 * prefillFrom produces from a screenshot, and wordle-teams-lz3w is what happens
 * when two places answer "which row is active" for themselves.
 */
describe('the stream on a board that is not a prefix', () => {
  const openWith = (guesses: Array<string>, answer = 'CRANE') => {
    myMonth = [{ id: 'score-1', puzzleDay: today, answer, guesses }]
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
  }

  test('a prefilled board opens with the caret on the board, not on a full answer', () => {
    openWith(['', '', 'SLATE'])
    // The answer arrived complete, so there is nothing to type into it — leaving
    // the caret there would refuse the player's first keystroke.
    expect(answerText()).toBe('CRANE')
    expect(answerCursor()).toBe(-1)
    expect(screen.getByTestId('board-cursor').id).toBe('1-1')
  })

  test('backspace never touches a row the cursor is not in', () => {
    openWith(['', '', 'SLATE'])
    fireEvent.keyDown(region(), { key: 'Backspace' })
    // Nothing is behind the caret at row 0 column 0, and there IS board content
    // below it, so nothing is deleted and nothing is walked back into.
    expect(boardRow(3)).toBe('SLATE')
    expect(boardRow(1)).toBe('')
    expect(answerText()).toBe('CRANE')
  })

  test('types into the first row with room, gap or no gap', () => {
    openWith(['', '', 'SLATE'])
    type('c')
    expect(boardRow(1)).toBe('C')
    expect(boardRow(3)).toBe('SLATE')
  })

  test('types into row 0 when only the LAST row is filled', () => {
    openWith(['', '', '', '', '', 'SLATE'])
    type('c')
    expect(boardRow(1)).toBe('C')
    expect(boardRow(6)).toBe('SLATE')
  })

  /**
   * THE GATE REMOVED IN T7, PINNED AT THE LEVEL THAT NOW OWNS THE KEYSTROKE.
   *
   * `boardIsValid` is TRUE for this board — answer PIVOT, rows 0, 2 and 5 filled,
   * every row either empty or five long, last row full — and yet row 1 is a gap
   * the player still has to type into. The old handler consulted `boardIsValid`
   * and went dead here while `cursorFor` pointed the caret straight at row 1: A
   * CARET ON A ROW YOU CANNOT TYPE INTO, which is wordle-teams-lz3w restated as a
   * question about the board answered by whole-board validity instead of by
   * asking where the cursor is.
   *
   * An equivalent test existed at 764de0bf against BoardInput's own handler and
   * was lost when the handler moved to form.tsx. MEASURED: re-adding the gate to
   * form.tsx's handleKeyDown passed all 3192 tests in all 176 files.
   */
  test('keeps typing into the gap on a board boardIsValid already calls valid', () => {
    const guesses = ['CRANE', '', 'SLATE', '', '', 'TRAIN']
    // Both spellings, because the form passes `existing !== undefined` and this
    // board arrives WITH an existing score — the gate would be just as wrong.
    expect(boardIsValid('PIVOT', guesses, true)).toBe(true)
    expect(boardIsValid('PIVOT', guesses, false)).toBe(true)

    openWith(guesses, 'PIVOT')

    // The caret is on the gap, not on the "finished" board.
    expect(screen.getByTestId('board-cursor').id).toBe('2-1')
    type('x')
    expect(boardRow(2)).toBe('X')
    expect(boardRow(1)).toBe('CRANE')
    expect(boardRow(6)).toBe('TRAIN')
  })

  test('Tab and Ctrl/Cmd combos are left to the browser', () => {
    openWith(['', '', 'SLATE'])
    // fireEvent returns false when the event was preventDefault'd.
    expect(fireEvent.keyDown(region(), { key: 'Tab' })).toBe(true)
    expect(fireEvent.keyDown(region(), { key: 'v', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(region(), { key: 'v', metaKey: true })).toBe(true)
    expect(boardRow(1)).toBe('')
  })

  /**
   * A KEYBOARD-ONLY PLAYER HAS TO BE ABLE TO SCROLL. The board is inside an
   * `overflow-y-auto` container and every key but Tab used to be
   * preventDefault'd, so ArrowDown, PageDown, Home, End and F5 were all dead —
   * the rows below the fold unreachable without a mouse, and no way to reload.
   *
   * WHO DOES THE SCROLLING CHANGED WITH THE FOCUS TARGET, AND THAT IS MEASURED.
   * While focus sat on a contentEditable INSIDE the scroll container, leaving
   * these keys unprevented was enough: Chromium scrolled the nearest scrollable
   * ancestor of the focused node. Focus is on an input OUTSIDE that container now
   * (it has to be — see form.tsx), and Chromium walks up from the FOCUSED element,
   * so the browser's answer became "scroll nothing". Measured at 390x380 in
   * headless Chromium, board scroller max 317: old shape PageDown/ArrowDown/End
   * moved scrollTop 0 -> 317, new shape 0 -> 0. So the form scrolls the container
   * itself and prevents these keys.
   *
   * F5 AND F12 ARE THE OTHER HALF AND ARE UNCHANGED: they still reach the browser.
   */
  test('the scrolling keys scroll the board, and function keys still reach the browser', () => {
    openWith(['', '', 'SLATE'])
    const scroller = document.querySelector('.overflow-y-auto') as HTMLElement
    expect(scroller).toBeTruthy()

    // fireEvent returns false when the event was preventDefault'd. Each of these
    // is handled here now rather than left to a browser that would scroll the
    // dialog instead of the board.
    for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
      expect(fireEvent.keyDown(region(), { key })).toBe(false)
    }

    // AND THE CONTAINER IS WHAT MOVED. jsdom reports every box as 0x0, so the
    // page- and end-relative distances all resolve to 0 and only the fixed step
    // is observable — which is enough to prove the write lands on the scroller
    // rather than being computed and dropped.
    scroller.scrollTop = 0
    fireEvent.keyDown(region(), { key: 'ArrowDown' })
    expect(scroller.scrollTop).toBe(40)
    fireEvent.keyDown(region(), { key: 'ArrowUp' })
    expect(scroller.scrollTop).toBe(0)

    // Nothing to scroll sideways, so these are left alone, and F5/F12 must still
    // reach the browser or a keyboard-only player cannot reload.
    for (const key of ['ArrowLeft', 'ArrowRight', 'F5', 'F12']) {
      expect(fireEvent.keyDown(region(), { key })).toBe(true)
    }

    // And none of them typed anything.
    expect(boardRow(1)).toBe('')
  })

  /**
   * SPACE IS THE EXCEPTION AND STAYS PREVENTED, though the reason changed with
   * the shape. It used to be here because Space inserts a character into an
   * editing host and `insertCompositionText` (wordle-teams-5n6n) meant no guard
   * could be trusted to catch everything. There is no editing host now: focus
   * sits in a one-line `<input>`, where Space scrolls nothing and only types, so
   * letting it through would buy a keyboard-only player nothing.
   */
  test('Space is still prevented, because it types', () => {
    openWith(['', '', 'SLATE'])
    expect(fireEvent.keyDown(region(), { key: ' ' })).toBe(false)
  })

  test('every other key is preventDefaulted, so nothing lands in the DOM', () => {
    openWith(['', '', 'SLATE'])
    expect(fireEvent.keyDown(region(), { key: 'c' })).toBe(false)
    expect(fireEvent.keyDown(region(), { key: 'Backspace' })).toBe(false)
    expect(fireEvent.keyDown(region(), { key: 'Enter' })).toBe(false)
  })
})

describe('Enter, from anywhere in the region', () => {
  test('submits a complete board', async () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
    type('CRANE')
    type('CRANE')

    fireEvent.keyDown(region(), { key: 'Enter' })

    await waitFor(() => expect(fired).toHaveLength(1))
    expect(fired[0]).toMatchObject({ answer: 'CRANE', puzzleDay: today })
  })

  /**
   * THE ENTER MIRROR OF THE COACH LINE'S no-day TEST, and the bug it pins is
   * sharper than the coach line's.
   *
   * `boardIsValid` is TRUE here and `submitDisabled` is also true, because there
   * is no day. Asking only `boardIsValid` sends this down the SUCCESS branch,
   * which clicks a `#board-submit` that is `disabled` — and `click()` on a
   * disabled button does nothing at all. No mutation, no toast, no sign the key
   * was pressed: a silently swallowed keystroke in the feature built to abolish
   * them. The warning is the honest answer, and it is what the button's own
   * state says.
   *
   * Unreachable through the real picker today — date-picker.tsx guards
   * `if (!picked) return` — which is the same standing as the coach-line case
   * above, and the same reason to pin the composition rather than the path.
   */
  test('warns rather than silently doing nothing when the board is complete but the day is not', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    act(() => selectDay?.(undefined))
    goToEntry()
    type('CRANE')
    type('CRANE')
    // The BOARD is complete: this is not an incomplete-board test wearing a hat.
    expect(boardIsValid('CRANE', ['CRANE', '', '', '', '', ''], false)).toBe(true)
    expect(boardRow(1)).toBe('CRANE')

    fireEvent.keyDown(region(), { key: 'Enter' })

    expect(fired).toEqual([])
    expect(warnings).toEqual(['Board must be complete to submit'])
  })

  test('warns instead of submitting an incomplete one', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
    type('CRA')

    fireEvent.keyDown(region(), { key: 'Enter' })

    expect(fired).toEqual([])
    expect(warnings).toEqual(['Board must be complete to submit'])
  })
})

/**
 * THE ENTRY SURFACE'S SHAPE, which is the part of this task no gate can otherwise
 * see.
 */
describe('the entry surface', () => {
  test('the one focus target is a real input, and neither zone is a second one', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()

    expect(entryInput().tagName).toBe('INPUT')
    expect(entryInput().getAttribute('contenteditable')).toBeNull()
    expect(entryInput().getAttribute('tabindex')).toBe('2')
    expect(document.activeElement).toBe(entryInput())
    // The presentation holds the letters and takes no focus at all.
    expect(presentation().getAttribute('tabindex')).toBeNull()
    expect(boardHalf().getAttribute('tabindex')).toBeNull()
    expect(presentation().contains(entryInput())).toBe(false)
  })

  /**
   * NOTHING IN THE ENTRY SURFACE IS AN EDITING HOST, AND THIS TEST EXISTS TO STOP
   * THAT BEING REINSTATED BY HABIT (wordle-teams-5n6n).
   *
   * `contentEditable` on a wrapper is a one-word edit somebody makes to get a
   * mobile keyboard, which is exactly how the board came to live inside one. The
   * cost is not theoretical: `beforeinput` for an IME commit is dispatched with
   * `cancelable: false`, so no handler can refuse the insertion, and composed text
   * dropped into a tile the player does not retype survives every re-render.
   *
   * ASSERTED OVER THE WHOLE SUBTREE, not just the wrapper, because the next
   * version of that mistake is a `contentEditable` on the slots row or on a single
   * tile. `[contenteditable]` catches the attribute however it is spelled;
   * `isContentEditable` would be a jsdom-specific property that is always false.
   */
  test('nothing in the entry surface is contentEditable', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()

    const form = presentation().closest('form')
    expect(form).toBeTruthy()
    expect((form as HTMLElement).querySelectorAll('[contenteditable]')).toHaveLength(0)
    // The tiles specifically — the place the bug was unrepairable.
    expect(document.getElementById('1-1')?.getAttribute('contenteditable')).toBeNull()
  })

  /**
   * THE INPUT HOLDS THE NAME AND THE DESCRIPTION, BECAUSE IT HOLDS THE FOCUS.
   *
   * `role="group"` on an `<input>` is a deliberate ARIA override (form.tsx says
   * so). Without it the element reports as `textbox` — a lie about a field with no
   * text in it — and every `getByRole('group', { name: 'Wordle board entry' })` in
   * this file and in e2e/board-entry.spec.ts stops resolving.
   *
   * `font-size: 16px` IS A CONSTRAINT, NOT A LOOK: iOS Safari zooms the viewport
   * when focus enters an input below it, on a surface whose height is already
   * bound to the visual viewport. jsdom cannot see the zoom, but it can see the
   * declaration, which is the only thing that keeps it from being tidied away.
   */
  test('the input is named as a group, not a textbox, and cannot trigger iOS zoom', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()

    expect(entryInput().getAttribute('role')).toBe('group')
    expect(entryInput().style.fontSize).toBe('16px')
  })

  /**
   * A TAP ON THE PRESENTATION MUST NOT BLUR THE INPUT.
   *
   * The thing a player touches is no longer the thing that holds focus, so
   * mousedown's default action — moving focus to what was pressed — would drop the
   * keyboard on a phone and take the caret off screen with it (the caret is gated
   * on `focused`). Cancelling it is what makes the input immovable, and it is
   * three characters somebody could delete as dead code.
   */
  test('mousedown on the slots or a tile is prevented, so focus never leaves the input', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
    type('CRANE')

    // fireEvent returns false when the event was preventDefault'd, and both of
    // these bubble to the presentation wrapper's one handler.
    expect(fireEvent.mouseDown(screen.getByRole('group', { name: /Today's Wordle answer/i }))).toBe(
      false,
    )
    expect(fireEvent.mouseDown(document.getElementById('1-1') as HTMLElement)).toBe(false)
    expect(document.activeElement).toBe(entryInput())
  })

  /**
   * NO BUTTON INSIDE THE PRESENTATION. The constraint that forced this — no
   * interactive control inside a contentEditable — has dissolved with the editing
   * host, but the SPLIT is what keeps both submits addressable and keeps
   * `document.getElementById('board-submit')` resolving for the Enter key, so it
   * is still asserted. See board-input.tsx.
   */
  test('the presentation contains no controls, and both submits are still on the page', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()

    expect(presentation().querySelectorAll('button, input, a, [tabindex]')).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: /^submit$/i })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeTruthy()
    expect(document.getElementById('board-submit')).toBeTruthy()
  })

  /**
   * A RENDERED CARET IMPLIES A FOCUSED INPUT.
   *
   * `cursorFor` answers a question about the BOARD — where would the next letter
   * go — and knows nothing about focus, so drawing it unconditionally painted a
   * blinking caret on a surface that could not receive a keystroke. That shipped
   * on the unreadable-import branch: focus on BODY, the coach saying "Type
   * today's answer", the caret blinking, and every key going nowhere — a screen
   * pixel-identical to the manual path that works. Gating on focus is what makes
   * that class of bug unable to recur rather than fixing the one branch.
   *
   * IT CARRIES MORE WEIGHT SINCE THE CARET AND THE FOCUS TARGET BECAME DIFFERENT
   * ELEMENTS. The caret is drawn on the slots and the tiles; focus lives on a
   * 1px invisible input. `focused` is the only thing tying them together, so a
   * `focused` that stopped tracking the input would leave a caret blinking over a
   * surface with no keyboard behind it and nothing else in the repo would notice.
   */
  test('draws no caret in either zone while the input is unfocused', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()

    // Focused: the answer caret is on slot 0 — otherwise this test is vacuous.
    expect(document.activeElement).toBe(region())
    expect(answerCursor()).toBe(0)

    fireEvent.blur(region())
    expect(answerCursor()).toBe(-1)
    expect(screen.queryByTestId('answer-caret')).toBeNull()

    // And the same in the board zone, where the caret is a ring on a tile.
    fireEvent.focus(region())
    type('CRANE')
    expect(screen.getByTestId('board-cursor')).toBeTruthy()
    fireEvent.blur(region())
    expect(screen.queryByTestId('board-cursor')).toBeNull()
  })

  test('says what the model is, once, for a screen reader', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()

    const described = region().getAttribute('aria-describedby')
    expect(described).toBe('entry-instructions')
    expect(document.getElementById('entry-instructions')?.textContent).toMatch(/five-letter answer/i)
  })
})

/**
 * WHAT KEYDOWN CANNOT COVER NOW GOES SOMEWHERE HARMLESS INSTEAD OF BEING FOUGHT
 * OFF — the shape change behind wordle-teams-5n6n.
 *
 * keydown does not cover paste, IME composition commits, or mobile swipe-typing /
 * predictive text / dictation: they insert with NO per-character keydown. The old
 * answer was to cancel them, with `onBeforeInput`, `onPaste` and a native
 * `beforeinput` listener on a contentEditable wrapped around the slots and the
 * board. THAT ANSWER WAS INCOMPLETE BY CONSTRUCTION: `beforeinput` for
 * `inputType: insertCompositionText` is dispatched `cancelable: false`, so an IME
 * commit walked straight through all three and the composed text stayed in the
 * tile it landed in.
 *
 * The answer now is that there is nowhere for an insertion to land. The slots and
 * the board are not editable, so they accept nothing; everything a keyboard,
 * clipboard or IME can produce goes into the hidden input, where the value is read
 * by nobody and wiped on `compositionend`.
 *
 * WHAT THIS FILE CAN AND CANNOT SEE. jsdom has no editing host, no composition and
 * no IME, so the ABSENCE of an insertion path is what is assertable here — the
 * contentEditable test above — and a real composition is measured in
 * e2e/board-entry.spec.ts through CDP instead. What IS assertable is the drain,
 * because it is plain DOM.
 */
describe('the hidden input is a dead end for anything that lands in it', () => {
  const open = () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
  }

  /**
   * DRAINED WHEN THE COMPOSITION ENDS, NOT WHILE IT RUNS.
   *
   * Draining on every `input` was measured to restart the IME —
   * `compositionstart ×10` for one ten-update word — which in a real CJK keyboard
   * tears the candidate window down mid-choice. So the assertion has two halves
   * and the FIRST one is the load-bearing one: mid-composition the value is left
   * exactly alone.
   */
  test('a composition is left alone while it runs and wiped when it commits', () => {
    open()
    const input = entryInput()

    fireEvent.compositionStart(input)
    input.value = 'か'
    fireEvent.input(input)
    expect(input.value).toBe('か')

    input.value = '漢'
    fireEvent.compositionEnd(input)
    expect(input.value).toBe('')
  })

  /**
   * AND ANYTHING THAT ARRIVES OUTSIDE A COMPOSITION IS WIPED AT ONCE — a paste, a
   * drop, dictation. None of it is cancelled any more, because none of it can
   * reach the board; it is simply thrown away.
   */
  test('a non-composing insertion is wiped immediately', () => {
    open()
    const input = entryInput()

    input.value = 'ZZZZZ'
    fireEvent.input(input)
    expect(input.value).toBe('')
  })

  /**
   * AND NOTHING THAT LANDS IN IT REACHES THE BOARD. The value is not read on
   * submit, on render, or anywhere else — the letters come from React state — so a
   * field full of junk changes nothing on screen.
   */
  test('whatever is in the input has no effect on the answer or the board', () => {
    open()
    type('CRANE')
    const input = entryInput()

    input.value = 'ZZZZZ'
    fireEvent.input(input)

    expect(answerText()).toBe('CRANE')
    expect(boardRow(1)).toBe('')
  })
})

/**
 * WRITE BACK ONLY WHAT CHANGED, PINNED BY COUNTING THE SCROLLS.
 *
 * Every operation in entry-cursor.ts returns its input NORMALISED through
 * `toRows` — a FRESH array — whether or not anything moved, so writing the
 * result back unconditionally hands form.tsx a new `guesses` identity on a key
 * that changed nothing and re-fires `useEffect(scrollActiveRowIntoView, ...)`.
 * On a phone that is the board jumping under the player's thumb on every Shift
 * press.
 *
 * NOTHING ELSE IN THIS REPO CAN SEE THAT. jsdom has no scrolling, so the
 * `scrollIntoView` every other test needs stubbed is also the only observable
 * this rule has: MEASURED, stripping both guards — `applyEntry`'s field-by-field
 * comparison and the refusal skip in the letter branch — left all 3192 tests
 * green against a no-op stub.
 */
describe('a keystroke that changes nothing writes nothing', () => {
  const openEntry = () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
  }

  test('a refused keystroke does not re-scroll the board', () => {
    openEntry()
    type('CRANE')
    type('S')
    const settled = scrolls
    // A real letter DID scroll — otherwise the assertion below is vacuous.
    expect(settled).toBeGreaterThan(0)

    // 'not-a-letter', three ways: a modifier, an arrow, and a printable
    // character that is not a letter. Each returns the board normalised.
    fireEvent.keyDown(region(), { key: 'Shift' })
    fireEvent.keyDown(region(), { key: 'ArrowLeft' })
    fireEvent.keyDown(region(), { key: '5' })

    expect(scrolls).toBe(settled)
  })

  test('a refused click on the board does not re-scroll it either', () => {
    openEntry()
    type('CR')
    const settled = scrolls

    // `moveZone` refuses this while the answer is short, and its `next` is the
    // input normalised — a fresh array that must not be written.
    fireEvent.mouseDown(boardHalf())

    expect(coach().textContent).toMatch(/answer first/i)
    expect(scrolls).toBe(settled)
  })

  test('typing into the ANSWER does not scroll the board, and the hand-off does', () => {
    openEntry()
    // Four letters, all of them in the answer zone: the board is untouched and
    // the zone has not moved, so there is nothing for the effect to react to.
    type('CRAN')
    expect(scrolls).toBe(0)

    // The fifth hands the caret over — a zone change with no focus event, which
    // is exactly why `zone` is in the effect's deps.
    type('E')
    expect(scrolls).toBeGreaterThan(0)
  })
})

/**
 * THE ANSWER ROW MUST NOT READ AS A SEVENTH BOARD ROW (wordle-teams-wty4.1.7).
 *
 * WHAT WENT WRONG. The slots shipped at `w-72 md:w-80` — the board grid's exact
 * width — so five slots lined up column-for-column with five tiles, in the same
 * square cells with the same border and no label above them. The owner's
 * screenshot of it is a board with seven rows.
 *
 * WHAT THESE TWO TESTS CAN AND CANNOT SEE, stated plainly because it is the
 * whole reason they are written against CLASS NAMES. jsdom has no layout engine
 * and no Tailwind, so nothing here can measure a rendered width; what it CAN do
 * is read the utility the caller passes and refuse the two edits most likely to
 * undo this by habit — putting the board's width back on the slots, and putting
 * the focus ring back on the region. The rendered widths are measured in a real
 * Chromium instead (224px against 288/320, slots 41.59px wide with 4px gutters
 * and no overlap), which is the only place that number is a fact.
 */
describe('the answer row is visibly not part of the board', () => {
  const openEntry = () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
  }

  /**
   * Tailwind's spacing scale: `w-56` is 14rem is 224px. Returns the base width
   * and the `md:` one, which is the base again when there is no md override.
   */
  const widths = (className: string) => {
    const base = /(?:^|\s)w-(\d+)(?:\s|$)/.exec(className)
    const md = /(?:^|\s)md:w-(\d+)(?:\s|$)/.exec(className)
    if (!base) throw new Error(`no width utility in ${JSON.stringify(className)}`)
    return { base: Number(base[1]) * 4, md: md ? Number(md[1]) * 4 : Number(base[1]) * 4 }
  }

  test('the slots row is narrower than the board at both breakpoints, and above the overlap floor', () => {
    openEntry()

    const slots = widths(screen.getByRole('group', { name: /Wordle answer/i }).className)
    const grid = document.querySelector('[data-slot="wordle-board"] .grid')
    const board = widths((grid as HTMLElement).className)

    // The board is unchanged: 288px on a phone, 320px from md. If this fails the
    // comparison below has moved, not the thing it is defending.
    expect(board).toEqual({ base: 288, md: 320 })

    expect(slots.base).toBeLessThan(board.base)
    expect(slots.md).toBeLessThan(board.md)

    /**
     * 216px IS A HARD FLOOR, NOT A STYLE PREFERENCE. `AnswerSlots`' slots carry
     * `min-w-10`, so five of them plus four `gap-1` gutters cannot fit in less
     * — and below it they OVERLAP rather than overflow: measured at 108px, slot
     * 0 spans [0,40] while slot 1 starts at 22.39. A future trim that keeps
     * "narrower than the board" true can still cross this line.
     */
    expect(slots.base).toBeGreaterThanOrEqual(216)
    expect(slots.md).toBeGreaterThanOrEqual(216)
  })

  /**
   * THE PRESENTATION HAS NO FOCUS RING, AND THE CARET IS WHAT REPLACED IT.
   *
   * Removed at the owner's direction: one ring around the answer AND the board
   * said only "something here has focus", which is what made the two zones read
   * as one control. Re-adding `focus:ring-2` is a one-word edit somebody makes
   * out of habit while tidying focus styles, hence this.
   *
   * `focus:outline-none` IS GONE TOO, AND ITS ABSENCE IS NOW THE HONEST STATE
   * RATHER THAN A REGRESSION. It existed to suppress the UA's default outline on
   * an element that took focus; this element cannot take focus at all since the
   * keyboard moved to a hidden input, so a `focus:` variant here would be a class
   * that can never match — exactly the kind of no-op this file's other comments
   * refuse elsewhere.
   *
   * THE SECOND HALF IS NOT DECORATION. Removing a visible focus indicator with
   * nothing in its place is a WCAG 2.4.7 failure, so this test refuses the ring
   * ONLY TOGETHER WITH the thing that stands in for it: a focused input with an
   * EMPTY answer draws a caret in the first slot. Both halves have to hold, or
   * there is a state with focus and no indicator at all.
   */
  test('the presentation carries no focus-ring class, and a focused empty answer shows a caret instead', () => {
    openEntry()

    expect(presentation().className).not.toMatch(/ring/)
    // Nor anywhere else on the surface: a ring re-added to the answer zone
    // wrapper would read exactly as the one that was removed.
    expect(presentation().className).not.toMatch(/focus:/)

    // Nothing typed: this is the state a player lands in when the step opens.
    expect(answerText()).toBe('')
    expect(answerCursor()).toBe(0)
    expect(screen.getAllByTestId('answer-caret')).toHaveLength(1)
  })
})

/**
 * WHERE THE SCROLL IS AIMED — BOTH BUGS REPORTED FROM A REAL IPHONE, AND BOTH
 * INVISIBLE TO EVERY OTHER TEST IN THIS REPO.
 *
 * `scrollActiveRowIntoView` picks an ELEMENT and calls `scrollIntoView` on it.
 * jsdom has no layout, so what that does to a scrollport is unobservable here —
 * but WHICH ELEMENT is a pure DOM fact, and in both bugs the element was wrong.
 * That is the whole assertion surface of this block, and it is enough:
 *
 *   1. THE ANSWER ZONE WAS THE WHOLE SURFACE (wordle-teams-ddjl). `answerZoneRef` sat on a div that
 *      wrapped the label AND the slots AND the six-row board — about 440px of it
 *      against a 139px scroller on a phone with the keyboard up. Per CSSOM-View,
 *      `scrollIntoView({ block: 'nearest' })` on a target taller than the
 *      scrollport that already overlaps it does NOTHING, so the answer branch had
 *      silently no-opped since the day it was written. Backspace the board empty,
 *      the caret correctly returns to the answer, the coach line says so — and
 *      the viewport stays on the board rows, with the answer above the fold and
 *      unreachable. A player could not correct a typo in their own answer.
 *      MEASURED in a real Chromium at 390x380: ref 440px vs clientHeight 139,
 *      scrollTop delta 0 before, -301 after.
 *
 *   2. A NULL CURSOR MEANT ROW SIX (wordle-teams-3lmg). `guesses` is `toRows`-normalised to six rows
 *      always, so the board branch's `guesses.length - 1` fallback was the
 *      constant 5 — and `cursorFor` returns null exactly on a SOLVE. Solve in two
 *      and the view jumped to empty row 6, taking both of the player's rows off
 *      the top at the moment they were about to submit. MEASURED at 390x380:
 *      scrollTop 73 -> 313 of a 317 maximum before, and unmoved at 73 after.
 *
 * WHY CONTAINMENT RATHER THAN A `data-testid` EQUALITY for the first one. The bug
 * is not "the ref moved to a different div", it is "the ref's subtree is too
 * big": what has to hold is that the slots are inside the scroll target and the
 * BOARD IS NOT. Asserting that directly survives any future re-nesting that keeps
 * the property, and fails every one that loses it. MUTATION-CHECKED both ways —
 * moving the ref back onto `entry-presentation` fails the first test, restoring
 * `guesses.length - 1` fails the second.
 */
describe('the scroll is aimed at the thing the player is looking at', () => {
  const openEntry = () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
  }

  /** The element the LAST scroll was aimed at. */
  const lastTarget = () => {
    const target = scrollTargets.at(-1)
    if (target === undefined) throw new Error('nothing was scrolled at all')
    return target
  }

  test('backspacing the board empty scrolls the ANSWER ZONE, and it does not contain the board', () => {
    openEntry()
    type('CRANE')
    type('SLATE')
    // The board is where the scrolling has been aimed so far — assert it, or the
    // difference this test is about is not a difference. Row 2, because filling
    // row 1 moves `nextSlot` on.
    expect(lastTarget().id).toBe('2-1')

    // Five backspaces empty row 1; the sixth walks back into the answer zone,
    // which is the moment the player is trying to reach.
    for (let index = 0; index < 6; index += 1) fireEvent.keyDown(region(), { key: 'Backspace' })
    expect(coach().textContent).toMatch(/type today's answer/i)
    expect(answerCursor()).toBe(4)

    const target = lastTarget()
    // THE SLOTS ARE INSIDE IT — without this the test passes against a ref on any
    // empty div, which scrolls the player nowhere useful.
    const slots = screen.getAllByTestId('answer-slot')
    expect(slots).toHaveLength(5)
    for (const slot of slots) expect(target.contains(slot)).toBe(true)

    // AND THE BOARD IS NOT. This is the bug: a target containing all six rows is
    // taller than the scrollport and `block: 'nearest'` is specified to do
    // nothing with it.
    expect(target.contains(boardHalf())).toBe(false)
    for (let row = 1; row <= 6; row += 1) {
      expect(target.contains(document.getElementById(`${row}-1`))).toBe(false)
    }
  })

  test('a board solved in two scrolls to row 2, not to empty row 6', () => {
    openEntry()
    type('CRANE')
    type('SLATE')
    // The solving guess. `cursorFor` returns null from here on, which is correct
    // — there is nothing left to type — and is exactly when the fallback runs.
    type('CRANE')

    expect(boardRow(2)).toBe('CRANE')
    expect(boardRow(3)).toBe('')
    expect(answerCursor()).toBe(-1)
    expect(lastTarget().id).toBe('2-1')
  })

  test('six full rows still scroll to row 6, which is where the content ends', () => {
    openEntry()
    type('CRANE')
    type('SLATE'.repeat(6))

    expect(boardRow(6)).toBe('SLATE')
    expect(lastTarget().id).toBe('6-1')
  })
})
