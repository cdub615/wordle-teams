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
 */
Element.prototype.scrollIntoView = () => {}

beforeEach(() => {
  requested = []
  myMonth = []
  teamMonth = { team: { playWeekends: true }, players: [] }
  fired.length = 0
  warnings.length = 0
  selectDay = null
})

afterEach(cleanup)

/** The ONE focusable thing on the entry step: answer slots and board together. */
const region = () => screen.getByRole('group', { name: 'Wordle board entry' })
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

  test('backspace walks back out of an empty board into the answer', () => {
    openEntry()
    type('CRANE')
    expect(answerCursor()).toBe(-1)

    // The board is empty, so the only thing behind the caret is the answer. The
    // first Backspace moves there; it does not also delete.
    fireEvent.keyDown(region(), { key: 'Backspace' })
    expect(answerText()).toBe('CRANE')
    expect(answerCursor()).toBe(4)

    fireEvent.keyDown(region(), { key: 'Backspace' })
    expect(answerText()).toBe('CRAN')
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

  test('Tab and Ctrl/Cmd combos are left to the browser', () => {
    openWith(['', '', 'SLATE'])
    // fireEvent returns false when the event was preventDefault'd.
    expect(fireEvent.keyDown(region(), { key: 'Tab' })).toBe(true)
    expect(fireEvent.keyDown(region(), { key: 'v', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(region(), { key: 'v', metaKey: true })).toBe(true)
    expect(boardRow(1)).toBe('')
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
 * THE REGION'S BOUNDARY, which is the part of this task no gate can otherwise
 * see.
 */
describe('the entry region', () => {
  test('is the one focus target, and the board half is not a second one', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()

    expect(region().getAttribute('contenteditable')).toBe('true')
    expect(region().getAttribute('tabindex')).toBe('2')
    expect(document.activeElement).toBe(region())
    expect(boardHalf().getAttribute('contenteditable')).toBeNull()
    expect(boardHalf().getAttribute('tabindex')).toBeNull()
  })

  /**
   * NO BUTTON INSIDE THE EDITING HOST. A button in a contentEditable is
   * focusable-inside-editable, sits in a subtree whose every key event is
   * preventDefault'd, and browsers disagree about whether it is even clickable
   * there — which is why board-input.tsx exports its desktop submit separately.
   */
  test('contains no button, and both submits are still on the page', () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()

    expect(region().querySelectorAll('button, input, a, [tabindex]')).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: /^submit$/i })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeTruthy()
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
 * THE GUARDS THAT KEYDOWN CANNOT PROVIDE, and the most dangerous thing on the
 * region.
 *
 * keydown does not cover paste, IME composition commits, or mobile swipe-typing /
 * predictive text / dictation — all of which insert via `beforeinput` with NO
 * per-character keydown. This node is an editing host wrapped around a React-owned
 * subtree (the slots AND the board), so a native insertion here corrupts the DOM
 * React thinks it owns: the wrong board on submit, or a `removeChild`
 * reconciliation crash. Neither is visible to any other gate in this repo.
 */
describe('nothing can be typed into the region natively', () => {
  const open = () => {
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))
    goToEntry()
  }

  /**
   * The REAL native event, dispatched by hand: @testing-library's `fireEvent` has
   * no `beforeInput` helper, and this is the event a swipe-typed word arrives on.
   * `dispatchEvent` returns false when something called preventDefault.
   */
  const beforeInput = (target: Element) =>
    target.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: 'x' }),
    )

  // `beforeinput` is cancelable; `input` is not, which is why the guard is on it.
  test('beforeinput is cancelled', () => {
    open()
    expect(beforeInput(region())).toBe(false)
  })

  test('paste is cancelled', () => {
    open()
    expect(fireEvent.paste(region())).toBe(false)
  })

  test('so is an insertion aimed at a tile deep inside it', () => {
    open()
    const tile = document.getElementById('1-1')
    expect(tile).toBeTruthy()
    // It bubbles to the region's handler, which is the point of putting the
    // guard on the editing host rather than on each half.
    expect(beforeInput(tile as HTMLElement)).toBe(false)
    expect(fireEvent.paste(tile as HTMLElement)).toBe(false)
  })
})
