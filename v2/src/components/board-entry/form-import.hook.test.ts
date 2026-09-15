// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime, because this renders the real
// form. `.hook.test.ts` and `.test.ts` for the same reasons as its neighbours.
//
// WHY A SECOND FILE RATHER THAN MORE OF form.hook.test.ts. That file mocks
// every mutation to one shared spy, which is right for what it asserts (which
// QUERY fed the prefill) and useless here, where the whole question is which of
// TWO mutations fired and with what. Its mocks are module-level and cannot be
// varied per test, so this is a separate module rather than a rewrite of one
// that is already pinning something.
//
// WHAT IT PINS: the two promises Stage 5 is, in the place a gate can see them.
// e2e IS NOT A GATE in this repo — deploy-v2.yml runs lint, typecheck,
// test:once and build and never Playwright — so "no parse is ever written
// without an explicit confirm" would otherwise be protected by nothing that
// could fail a pipeline.
//
// THE SCREENSHOT IS A REAL RENDERED BOARD, through the real parser. jsdom has
// no canvas, so the decode is stood in for with a bitmap from the Task 1
// renderer; everything downstream of that — lattice, colour, glyphs, repair —
// is the shipping code.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import { fillRect } from '#/lib/board-import/bitmap.ts'
import { renderPlayedBoard } from '#/lib/board-import/testing/board-fixture.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { BoardEntryForm } from './form.tsx'

const today = toPuzzleDay(new Date())
const thisMonth = today.slice(0, 7)

const ANSWER = 'CRANE'
const GUESSES = ['SLATE', 'CRANE']

/** Every mutation the form fired, by name, in order. */
let fired: Array<{ name: string; args: Record<string, unknown> }>
/** Set by the one test that needs the correction log to fail. */
let failingMutation: string | null
/** What amIPro answers. `undefined` is the in-flight state, and it matters. */
let proAnswer: boolean | undefined

/**
 * REACT'S PASSIVE EFFECTS, DRAINED — the thing a focus assertion has to wait
 * for and the reason three of them below are `await`ed rather than read.
 *
 * The form focuses the entry region from a `useEffect`, so the focus lands in a
 * SEPARATE turn from the render that shows the note. `await waitFor(...)` on
 * the note returns as soon as the note is in the DOM, which is inside that
 * render's commit and before the effect has run — every focus assertion made
 * synchronously after one is therefore reading a half-finished update and
 * passing on the scheduler's goodwill.
 *
 * For the POSITIVE assertion that cost is measured: a red on the whole
 * `vitest run` gate at roughly 1 run in 25 (wordle-teams-45kz), with
 * `document.activeElement` still `<body>` — a focus that had not landed, not a
 * wrong element.
 *
 * THE TWO NEGATIVE ONES ARE NOT MEASURED TO LOSE, and that is stated rather
 * than assumed: mutating the form to focus on EVERY import is still caught by
 * both of them today. What they share with the positive is the ordering
 * dependence — `not.toBe(region())` is equally satisfied by a focus that
 * simply has not happened YET — and the difference is only that losing it is
 * silent instead of red. The flush removes the dependence from all three
 * rather than waiting to find out which way each one falls.
 */
const flushEffects = () => act(async () => {})

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({
    queryKey: [getFunctionName(ref), args],
  }),
  // The NAME, not a spy: it is what lets useMutation below tell the board
  // submit and the correction log apart.
  useConvexMutation: (ref: FunctionReference<'mutation'>) => getFunctionName(ref),
  // The upsell reaches checkout through useStartUpgrade, which uses an ACTION.
  useConvexAction: (ref: FunctionReference<'action'>) => async () => {
    fired.push({ name: getFunctionName(ref), args: {} })
    return { url: null, reason: 'not-configured' }
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    const name = queryKey[0]
    if (name === getFunctionName(api.scores.getMyMonth)) return { data: [] }
    throw new Error(`Board entry asked for an unexpected query: ${name}`)
  },
  useQuery: ({ queryKey }: { queryKey: [string, unknown] }) =>
    queryKey[0] === getFunctionName(api.teams.amIPro) ? { data: proAnswer } : { data: undefined },
  useMutation: ({ mutationFn }: { mutationFn: string }) => ({
    mutateAsync: async (args: Record<string, unknown>) => {
      fired.push({ name: mutationFn, args })
      if (mutationFn === failingMutation) throw new Error('the log is down')
      return null
    },
  }),
}))

vi.mock('#/components/date-picker.tsx', () => ({
  DatePicker: ({ day }: { day?: string }) =>
    createElement('div', { 'data-testid': 'date-picker', 'data-day': day ?? '' }),
}))

/**
 * A probe for the board, not the real grid. It reports what it was handed and
 * offers the test a way to change one tile, which is what a CORRECTION is.
 *
 * IT REPORTS THE CURSOR TOO, which is not decoration. form.tsx hands this
 * `cursor={focused ? cursor : null}`, so `data-cursor` is the only place in this
 * file where the form's belief about FOCUS is visible — and the import paths are
 * the ones that reach the entry surface without focusing it. See the stale-focus
 * test at the bottom of this file.
 */
vi.mock('./board-input.tsx', () => ({
  BoardInput: ({
    guesses,
    cursor,
  }: {
    guesses: Array<string>
    cursor?: { zone: string; row?: number; index: number } | null
  }) =>
    createElement('div', {
      'data-testid': 'board',
      'data-guesses': guesses.join(','),
      'data-cursor':
        cursor === null || cursor === undefined ? 'none' : `${cursor.zone}:${cursor.row ?? ''}:${cursor.index}`,
    }),
  // A separate export from BoardInput — once because it had to live outside the
  // contentEditable region, now for layout; see board-input.tsx. Stubbed to
  // nothing so `getByRole('button', { name: /^submit$/ })` below stays the sheet
  // footer's one button.
  BoardSubmit: () => null,
}))

/**
 * jsdom implements no scrolling at all, so `scrollIntoView` is absent and
 * form.tsx's scrollActiveRowIntoView would throw on every render that moves the
 * caret.
 */
Element.prototype.scrollIntoView = () => {}

const UPSERT = getFunctionName(api.scores.upsertBoard)
const LOG = getFunctionName(api.boardImport.logCorrections)

/** A rendered Wordle board, standing in for a pasted screenshot. */
function screenshotOf(answer: string, guesses: Array<string>, options: { withoutLetters?: boolean } = {}) {
  const board = renderPlayedBoard({ answer, guesses, tileSize: 62, ...options })
  vi.stubGlobal('createImageBitmap', async () => ({
    width: board.bitmap.width,
    height: board.bitmap.height,
    close: () => {},
  }))
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return Object.getPrototypeOf(document).createElement.call(document, tag)
    return {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {}, getImageData: () => board.bitmap }),
    } as unknown as HTMLElement
  }) as typeof document.createElement)
}

function paste() {
  const file = new File([new Uint8Array([1])], 'wordle.png', { type: 'image/png' })
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], files: [] },
  })
  document.dispatchEvent(event)
}

const board = () => screen.getByTestId('board').getAttribute('data-guesses')
/** The one line of coaching under the title, which is also what a screen reader hears. */
const coach = () => screen.getByTestId('entry-coach').textContent
/** Board entry now opens on the step that asks which day and how. */
const goToEntry = () => fireEvent.click(screen.getByRole('button', { name: /enter manually/i }))

/**
 * THE ONE FOCUS TARGET ON THE ENTRY STEP, and it is a visually-hidden `<input>`
 * that nothing reads (wordle-teams-5n6n). The `#answer` box and the board's own
 * contentEditable are long gone, and so is the contentEditable region that
 * replaced them: one input serves both halves, one handler serves both, and which
 * half a keystroke lands in is state rather than focus. It still answers to
 * `getByRole('group', ...)` because form.tsx sets that role on it deliberately.
 */
const region = () => screen.getByRole('group', { name: 'Wordle board entry' })
/** The answer, read off the five slots that replaced the `#answer` box. */
const answerText = () => screen.getAllByTestId('answer-slot').map((slot) => slot.textContent).join('')
const typeKeys = (keys: string) => {
  for (const key of keys) fireEvent.keyDown(region(), { key })
}
/**
 * PUT THE CARET BACK ON THE ANSWER. An import that filled the answer in leaves
 * it on the board — there is nothing left to type in the answer — so editing the
 * answer afterwards is a click, which is exactly what a player does.
 */
const selectAnswer = () =>
  fireEvent.mouseDown(screen.getByRole('group', { name: /Today's Wordle answer/i }))
/**
 * A HAND CORRECTION, TYPED. It used to be a `setGuesses` call handed out by the
 * board probe; the board no longer owns a setter, because the form owns the
 * stream. Backspacing the board empty and retyping it is what the interaction
 * actually is — there is no click-to-position on this board — and it leaves the
 * rows the player did not change byte-identical, which is what the correction
 * log is diffed on.
 */
const retypeBoard = (rows: Array<string>) => {
  const letters = (board() ?? '').split(',').join('').length
  for (let index = 0; index < letters; index++) fireEvent.keyDown(region(), { key: 'Backspace' })
  typeKeys(rows.join(''))
}

beforeEach(() => {
  fired = []
  failingMutation = null
  proAnswer = true
  vi.stubGlobal('console', { ...console, error: vi.fn() })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('importing a screenshot into the entry form', () => {
  test('fills the board in from a pasted screenshot', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))
    expect(answerText()).toBe('CRANE')
  })

  // THE PROMISE THE WHOLE FEATURE RESTS ON. A parse that saved itself would
  // make every misread a bad row in the table; a parse that only fills the form
  // in makes one a correction. Nothing about the shipping bar — "knows when it
  // failed", not "never wrong" — is affordable without this.
  test('writes NOTHING until the player presses submit', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()
    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))

    // The board is on screen and correct, and still nothing has been sent.
    expect(fired).toEqual([])
  })

  test('submits what is on screen once the player confirms it', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()
    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(fired.some((call) => call.name === UPSERT)).toBe(true))
    const submit = fired.find((call) => call.name === UPSERT)
    expect(submit?.args).toMatchObject({ answer: 'CRANE', guesses: ['SLATE', 'CRANE', '', '', '', ''] })
  })

  // THE CORRECTION LOG IS THE LABELLED CORPUS. One row per tile, because a
  // wrong row is usually one wrong glyph and a row-level record would lose the
  // only part Stage 3 can learn from.
  test('logs the tile the player corrected, and only that tile', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()
    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))

    // The player fixes one letter: SLATE was actually SLANE... no — they say
    // the first guess was SLIME, which differs in two tiles.
    retypeBoard(['SLIME', 'CRANE'])
    await waitFor(() => expect(board()).toBe('SLIME,CRANE,,,,'))
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(fired.some((call) => call.name === LOG)).toBe(true))
    const log = fired.find((call) => call.name === LOG)
    expect(log?.args.puzzleDay).toBe(today)
    expect(log?.args.corrections).toEqual([
      { target: 'guess', row: 0, column: 2, read: 'A', actual: 'I' },
      { target: 'guess', row: 0, column: 3, read: 'T', actual: 'M' },
    ])
  })

  test('logs nothing when the player confirmed the parse unchanged', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()
    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(fired.some((call) => call.name === UPSERT)).toBe(true))
    expect(fired.some((call) => call.name === LOG)).toBe(false)
  })

  // THE BOARD IS THE USER'S WORK AND THE LOG IS A MEASUREMENT. By the time the
  // log is written the board is already saved, so a failure there must never
  // reach the player as a failed submit — they would retype a board that is
  // sitting safely in the table.
  test('saves the board even when the correction log cannot be written', async () => {
    failingMutation = LOG
    screenshotOf(ANSWER, GUESSES)
    let onSuccessCalled = false
    render(
      createElement(BoardEntryForm, {
        month: thisMonth,
        onSuccess: () => {
          onSuccessCalled = true
        },
      }),
    )

    paste()
    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))
    retypeBoard(['SLIME', 'CRANE'])
    await waitFor(() => expect(board()).toBe('SLIME,CRANE,,,,'))
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

    // The log was attempted and threw...
    await waitFor(() => expect(fired.some((call) => call.name === LOG)).toBe(true))
    // ...and the board still went in, and the sheet still closed.
    expect(fired.some((call) => call.name === UPSERT)).toBe(true)
    expect(onSuccessCalled).toBe(true)
  })

  // A PARSE ONLY BLAMES ITSELF FOR TILES IT CLAIMED. Typing into a row the
  // parse never read is the player doing the work, not the parser being wrong,
  // and logging it would make the corpus claim Stage 3 misread tiles it never
  // saw.
  test('logs nothing when the player fills the board in by hand', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    goToEntry()
    // The answer first, then the board — which is the order the stream imposes
    // now, and the order a player types in anyway.
    typeKeys('CRANE')
    typeKeys('SLATECRANE')
    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(fired.some((call) => call.name === UPSERT)).toBe(true))
    expect(fired.some((call) => call.name === LOG)).toBe(false)
  })
})

describe('the two-step flow', () => {
  // THE BUG THAT STARTED THE EPIC. Board entry used to focus the answer field
  // on mount, so the software keyboard opened with the panel and covered 55%
  // of an iPhone screen — the 6x5 board was cropped after two rows. Step one
  // has nothing focusable that raises a keyboard, and that is the fix.
  test('opens on the choice step with nothing focused', () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(screen.getByTestId('board-entry-choose')).toBeTruthy()
    expect(screen.queryByTestId('board')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Wordle board entry' })).toBeNull()
    // Nothing in the panel has taken focus off the body.
    expect(document.activeElement).toBe(document.body)
  })

  test('offers the day and all three ways to enter a board', () => {
    // The Paste button is feature-detected, so a browser with no clipboard read
    // hides it — which is why it has to be stubbed here to be seen at all.
    vi.stubGlobal('navigator', { ...navigator, clipboard: { read: async () => [] } })
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(screen.getByTestId('date-picker').getAttribute('data-day')).toBe(today)
    expect(screen.getByRole('button', { name: /paste screenshot/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /import screenshot/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /enter manually/i })).toBeTruthy()
  })

  // Typing is what the player asked for here, so the keyboard is now correct.
  test('focuses the answer when the player chooses to type, and not before', () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    goToEntry()

    expect(screen.getByTestId('board')).toBeTruthy()
    expect(document.activeElement).toBe(region())
  })

  // Arriving from an import must NOT focus: the board is already filled in, and
  // raising a keyboard over it to confirm it would be the original bug with an
  // extra step in front of it.
  test('does not focus the answer when the board arrived from a screenshot', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))
    await flushEffects()
    expect(document.activeElement).not.toBe(region())
  })

  // Going back is free because `answer` and `guesses` are the form's own state,
  // not the step's. A player who mistyped the date must not lose the board.
  test('keeps a part-typed board when the player goes back to change the day', () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    goToEntry()
    typeKeys('CRANE')
    typeKeys('SLATE')
    fireEvent.click(screen.getByRole('button', { name: new RegExp(today) }))

    expect(screen.getByTestId('board-entry-choose')).toBeTruthy()
    goToEntry()
    expect(board()).toBe('SLATE,,,,,')
  })
})

describe('the import confirm step', () => {
  const note = () => screen.getByTestId('board-import-note').textContent ?? ''

  test('confirms what it read, with the board filled in and a Submit', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))
    expect(note()).toMatch(/read 2 guesses/i)
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeTruthy()
    // And still nothing written, which is the promise the whole feature rests on.
    expect(fired).toEqual([])
  })

  test('goes back to the choice step without losing what it read', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()
    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))

    fireEvent.click(screen.getByRole('button', { name: new RegExp(today) }))
    expect(screen.getByTestId('board-entry-choose')).toBeTruthy()

    goToEntry()
    expect(board()).toBe('SLATE,CRANE,,,,')
  })

  // A SHARE CARD DESERVES ITS OWN SENTENCE. "That is the emoji grid, paste the
  // board itself" is actionable; "we could not read that" is not, and the two
  // failures look identical to whoever pasted it.
  test('names a share card and drops into manual entry', async () => {
    screenshotOf(ANSWER, GUESSES, { withoutLetters: true })
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(note()).toMatch(/emoji grid/i))
    // Manual entry, with an empty board to type into — not a dead end.
    expect(board()).toBe(',,,,,')
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeTruthy()
  })

  test('says there is no board in an image that has none, and still lets them type', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 300, height: 300, close: () => {} }))
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return Object.getPrototypeOf(document).createElement.call(document, tag)
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({ width: 300, height: 300, data: new Uint8ClampedArray(300 * 300 * 4).fill(255) }),
        }),
      } as unknown as HTMLElement
    }) as typeof document.createElement)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(note()).toMatch(/no wordle board/i))
    expect(board()).toBe(',,,,,')

    /**
     * AND IT FOCUSES, which this branch did not used to do. It drops the player
     * into MANUAL ENTRY — the parse recovered nothing, so their only remaining
     * action is to type — on a screen pixel-identical to the working "Enter
     * manually" one, caret and all. Unfocused, that caret blinked over a region
     * where every keystroke went nowhere: the original dead end relocated.
     */
    await waitFor(() => expect(document.activeElement).toBe(region()))
    expect(screen.getAllByTestId('answer-slot')[0].getAttribute('data-cursor')).toBe('true')
    typeKeys('CRANE')
    expect(answerText()).toBe('CRANE')
  })

  // A ROW THE PARSE COULD NOT READ STAYS BLANK AND IS NAMED. prefillFrom
  // refuses to fill it with the reader's first-choice letters, because the
  // board is positional and a half-read row in the wrong place is worse than an
  // empty one — so the only honest thing left is to say which row it was.
  test('names the rows it could not read rather than guessing at them', async () => {
    const board6 = renderPlayedBoard({ answer: ANSWER, guesses: GUESSES, tileSize: 62 })
    // Flatten the first row's tiles to a single grey: colours intact, letters gone,
    // which is what an unreadable row looks like to Stage 2.
    for (let column = 0; column < 5; column++) {
      fillRect(board6.bitmap, board6.tiles[0][column], [90, 90, 90])
    }
    vi.stubGlobal('createImageBitmap', async () => ({
      width: board6.bitmap.width,
      height: board6.bitmap.height,
      close: () => {},
    }))
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return Object.getPrototypeOf(document).createElement.call(document, tag)
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {}, getImageData: () => board6.bitmap }),
      } as unknown as HTMLElement
    }) as typeof document.createElement)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(board()).toBe(',CRANE,,,,'))
    expect(note()).toMatch(/row 1 could not be read/i)

    /**
     * AND THE COACH LINE SAYS SO TOO, BECAUSE THIS BOARD IS A DEAD END
     * (wordle-teams-x7ds). The row the reader missed is row 1 and the row that
     * SOLVED the board is row 2, so `cursorFor` returns null, `typeLetter`
     * refuses every key as 'board-solved', and `backspace` — whose cursor is row
     * 0 column 0 with content below it, which is a gapped board rather than the
     * walk-back — deletes nothing. The player can neither type nor delete.
     *
     * THIS LINE USED TO READ "Keep typing. Backspace goes back a letter": two
     * instructions, both false, on arrival and with no keystroke pressed. Only the
     * import note above made the board recoverable at all.
     *
     * ASSERTED HERE RATHER THAN ONLY IN entry-coach.test.ts because the unit test
     * can only show that coachFor answers this STATE correctly. That the state is
     * reachable — by an ordinary partial parse of a real screenshot, not by a
     * corrupt row — is a fact about this pipeline, and the test above already
     * proves the pipeline produces it.
     */
    expect(coach()).toBe(
      'Row 1 is blank, and a later row already solves this — tap the answer to edit it',
    )

    // THE TRAP ITSELF, so the line above is pinned as TRUE rather than merely as
    // the current string. Both gestures the old copy named are no-ops here.
    typeKeys('X')
    expect(board()).toBe(',CRANE,,,,')
    fireEvent.keyDown(region(), { key: 'Backspace' })
    expect(board()).toBe(',CRANE,,,,')

    // AND THE WAY OUT COMPOSES: tapping the answer is what the line tells them to
    // do, and the answer-zone line then tells them how to change it — which
    // un-solves the board and gives row 1 back.
    selectAnswer()
    expect(coach()).toBe("Answer's in — backspace to change it")
    fireEvent.keyDown(region(), { key: 'Backspace' })
    expect(answerText()).toBe('CRAN')
    typeKeys('X')
    expect(answerText()).toBe('CRANX')
    typeKeys('S')
    expect(board()).toBe('S,CRANE,,,,')
  })
})

describe('the answer, asked for only when the board did not carry one', () => {
  const note = () => screen.getByTestId('board-import-note').textContent ?? ''

  // A SOLVED BOARD CARRIES ITS OWN ANSWER in the winning row, and the parser
  // reads it there — 18 of 18 across the real corpus. Asking would be friction,
  // and focusing the field would raise a keyboard over a board that is already
  // correct.
  test('never asks when the parse read the answer off the board', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))
    expect(answerText()).toBe('CRANE')
    expect(note()).not.toMatch(/not solved/i)
    await flushEffects()
    expect(document.activeElement).not.toBe(region())
    // AND THE CARET IS ON THE BOARD, not on an answer with no letters left to
    // take: the import filled it in, so the board is all that is left to do.
    expect(
      screen.getAllByTestId('answer-slot').some((slot) => slot.getAttribute('data-cursor') === 'true'),
    ).toBe(false)
  })

  // AN UNSOLVED BOARD HAS NO WINNING ROW, so there is nothing to derive from —
  // and Stage 4 lost its second constraint for every row along with it. Typing
  // the answer is then the only thing left to do, which is the one confirm case
  // where a keyboard is help rather than an interruption.
  test('asks, and focuses, when the board was not solved', async () => {
    screenshotOf('DRYLY', ['SLATE', 'BROIL', 'WRYLY'])
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(note()).toMatch(/not solved/i))
    expect(answerText()).toBe('')
    // `waitFor` rather than `flushEffects` for the one assertion that is
    // waiting for something to ARRIVE: it retries, so it holds whatever the
    // scheduler does, and a focus that never lands still fails on the ceiling.
    await waitFor(() => expect(document.activeElement).toBe(region()))
    // AND THE CARET IS IN THE ANSWER, where the five letters have to go: an
    // import that could not read one must not leave it on the board, where
    // nothing can be typed until the answer is complete.
    expect(screen.getAllByTestId('answer-slot')[0].getAttribute('data-cursor')).toBe('true')
  })

  // THE WIRING, NOT THE CONSTRAINT. The answer is a constraint rather than a
  // field to fill in: once known, every row is resolved again against it, off
  // the evidence the first parse gathered and with no second look at the
  // pixels. What THIS pins is that the re-resolve fires and leaves a coherent
  // board — it cannot show the constraint changing an answer, because glyphs
  // painted from the template table are read perfectly and the reader is never
  // torn. parse.test.ts builds torn evidence by hand to show that.
  test('re-resolves the guesses against the answer once it is typed', async () => {
    screenshotOf('DRYLY', ['SLATE', 'BROIL', 'WRYLY'])
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()
    await waitFor(() => expect(note()).toMatch(/not solved/i))

    typeKeys('DRYLY')

    // The prompt goes once the constraint is in, and the board is the board.
    await waitFor(() => expect(note()).not.toMatch(/not solved/i))
    expect(board()).toBe('SLATE,BROIL,WRYLY,,,')
  })

  // ONCE, AND ONLY ONCE. A player who fixes a letter on the board and then
  // edits the answer must not have their correction thrown away by a fresh
  // resolve of the original evidence.
  test('does not overwrite a hand-corrected board when the answer is edited again', async () => {
    screenshotOf('DRYLY', ['SLATE', 'BROIL', 'WRYLY'])
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()
    await waitFor(() => expect(note()).toMatch(/not solved/i))
    typeKeys('DRYLY')
    await waitFor(() => expect(board()).toBe('SLATE,BROIL,WRYLY,,,'))

    retypeBoard(['CRANE', 'BROIL', 'WRYLY'])
    await waitFor(() => expect(board()).toBe('CRANE,BROIL,WRYLY,,,'))

    // Retype the last letter of the answer: same answer, and the hand
    // correction survives. The caret is on the BOARD by now — completing the
    // answer is what hands it over — so editing the answer is a click first,
    // which is what a player does.
    selectAnswer()
    fireEvent.keyDown(region(), { key: 'Backspace' })
    fireEvent.keyDown(region(), { key: 'Y' })
    await waitFor(() => expect(answerText()).toBe('DRYLY'))
    expect(board()).toBe('CRANE,BROIL,WRYLY,,,')
  })
})

describe('what the correction log may and may not blame the parser for', () => {
  const submit = () => fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

  // THE LOG IS THE LABELLED CORPUS board import is measured against, so a false
  // row in it is worse than a missing one. On an unsolved board the answer came
  // from the PLAYER, not from Stage 3 — recording a correction against it would
  // claim the parser misread an answer it never saw.
  test('never blames the parser for an answer the player supplied', async () => {
    // SIX guesses, none of them the answer: a board that was lost, which is the
    // only kind that is both unsolved AND submittable — boardIsValid wants
    // either a winning last row or all six rows used.
    const lost = ['SLATE', 'BROIL', 'WRYLY', 'CHUNK', 'PLATE', 'SCORE']
    screenshotOf('DRYLY', lost)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()
    await waitFor(() => expect(screen.getByTestId('board-import-note').textContent).toMatch(/not solved/i))

    // Type it, then change your mind about the last letter.
    typeKeys('DRYLY')
    await waitFor(() => expect(board()).toBe(lost.join(',')))
    selectAnswer()
    fireEvent.keyDown(region(), { key: 'Backspace' })
    fireEvent.keyDown(region(), { key: 'S' })
    await waitFor(() => expect(answerText()).toBe('DRYLS'))

    submit()

    await waitFor(() => expect(fired.some((call) => call.name === UPSERT)).toBe(true))
    const log = fired.find((call) => call.name === LOG)
    const corrections = (log?.args.corrections ?? []) as Array<{ target: string }>
    expect(corrections.some((correction) => correction.target === 'answer')).toBe(false)
  })

  // The other half: an answer the parser DID read off a solved board, and then
  // got wrong, is exactly the thing the log exists to capture.
  test('does blame it for an answer it read off the board and got wrong', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()
    await waitFor(() => expect(answerText()).toBe('CRANE'))

    // The winning row and the answer are the SAME row on a solved board, so a
    // misread there is a misread of both — correcting one without the other
    // would leave a board Wordle could not have produced, and boardIsValid
    // rightly refuses it.
    selectAnswer()
    fireEvent.keyDown(region(), { key: 'Backspace' })
    fireEvent.keyDown(region(), { key: 'K' })
    await waitFor(() => expect(answerText()).toBe('CRANK'))
    retypeBoard(['SLATE', 'CRANK'])
    await waitFor(() => expect(board()).toBe('SLATE,CRANK,,,,'))

    submit()

    await waitFor(() => expect(fired.some((call) => call.name === LOG)).toBe(true))
    const log = fired.find((call) => call.name === LOG)
    expect(log?.args.corrections).toContainEqual({
      target: 'answer',
      row: 0,
      column: 4,
      read: 'E',
      actual: 'K',
    })
  })
})

describe('the Pro gate on step one', () => {
  // THE UPSELL IS HERE BECAUSE THIS IS WHERE IT MEANS SOMETHING: the player has
  // opened board entry and is being asked HOW they want to enter a board, which
  // is the one moment "you could paste a screenshot instead" answers the
  // question actually in front of them. It also earns step one for a non-Pro
  // player, who would otherwise see a date and one button.
  test('offers a non-Pro player the upgrade where the import controls would be', () => {
    proAnswer = false
    vi.stubGlobal('navigator', { ...navigator, clipboard: { read: async () => [] } })
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(screen.getByTestId('board-import-upsell')).toBeTruthy()
    expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeTruthy()
    // And none of the real controls.
    expect(screen.queryByRole('button', { name: /paste screenshot/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /import screenshot/i })).toBeNull()
    // Still a way to enter a board by hand, which is the point of the step.
    expect(screen.getByRole('button', { name: /enter manually/i })).toBeTruthy()
  })

  test('reaches checkout through the existing upgrade path', async () => {
    proAnswer = false
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))

    await waitFor(() =>
      expect(fired.some((call) => call.name === getFunctionName(api.polar.createProCheckout))).toBe(true),
    )
  })

  test('gives a Pro player the real controls and no upgrade offer', () => {
    proAnswer = true
    vi.stubGlobal('navigator', { ...navigator, clipboard: { read: async () => [] } })
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(screen.getByRole('button', { name: /paste screenshot/i })).toBeTruthy()
    expect(screen.queryByTestId('board-import-upsell')).toBeNull()
  })

  // THE LOOSE SPELLING IS WRONG IN BOTH DIRECTIONS HERE. `!isPro` is true while
  // amIPro is in flight, so it would show a paid-only control to everyone on
  // every cold load — and `isPro === false` alone would flash an upgrade offer
  // at somebody who already pays. In flight, neither appears.
  test('shows neither the controls nor the offer while amIPro is in flight', () => {
    proAnswer = undefined
    vi.stubGlobal('navigator', { ...navigator, clipboard: { read: async () => [] } })
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(screen.queryByTestId('board-import-upsell')).toBeNull()
    expect(screen.queryByRole('button', { name: /paste screenshot/i })).toBeNull()
    expect(screen.getByRole('button', { name: /enter manually/i })).toBeTruthy()
  })

  // HIDING THE BUTTONS IS NOT ENOUGH. The document paste listener lives inside
  // ImportScreenshot, so a gate that only hid the controls would hand a non-Pro
  // player the whole feature with no button to show for it.
  test('is not listening to the clipboard for a non-Pro player', async () => {
    proAnswer = false
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(screen.getByTestId('board-entry-choose')).toBeTruthy())
    expect(screen.queryByTestId('board')).toBeNull()
    expect(fired).toEqual([])
  })
})

/**
 * A CARET MUST NEVER OUTLIVE THE INPUT THAT MAKES IT TYPEABLE.
 *
 * form.tsx gates both carets on `focused`, and `focused` is set from the hidden
 * input's own onFocus/onBlur. REACT DOES NOT FIRE `onBlur` WHEN A FOCUSED ELEMENT
 * UNMOUNTS, so going back to step one — which unmounts the input — used to leave
 * `focused` true with `document.activeElement` on `<body>`.
 *
 * THAT WAS HARMLESS ONLY BY COINCIDENCE, AND THIS IS THE PATH WHERE THE
 * COINCIDENCE RUNS OUT. The one way to reach the confirm step WITHOUT focusing is
 * an import whose parse carries an answer (form.tsx only asks for the answer when
 * the parse has none). Normally that means the board was SOLVED, where `cursorFor`
 * returns null and there is no caret to be wrong about. But parse.ts KEEPS a
 * SUPPLIED answer that it would otherwise discard — "an answer derived from a row
 * that then turned out to be unresolvable is not an answer" is guarded on
 * `supplied === null` — and import-screenshot.tsx supplies whatever the player has
 * already typed. So: type the answer, go back, paste an UNSOLVED board, and the
 * form lands on confirm with an answer, an unsolved board, a real board cursor and
 * nothing focused.
 *
 * WITHOUT THE FIX this renders a blinking caret on a tile with no keyboard behind
 * it — the exact dead end wordle-teams-wty4.1.6 was about, with the cursor painted
 * on top of it. The assertion is `data-cursor: 'none'`, which is what
 * `cursor={focused ? cursor : null}` yields once `focused` tracks the input's
 * existence.
 */
describe('focus does not outlive the input it belongs to', () => {
  test('a caret drawn on an unfocused surface is impossible after going back', async () => {
    // An UNSOLVED board: one guess, and it is not the answer.
    screenshotOf('CRANE', ['SLATE'])
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    // 1. The entry step, focused. The probe reports `cursorFor`'s result
    //    UNADAPTED — form.tsx hands BoardInput the whole Cursor and the real
    //    BoardInput is the one place it is narrowed to a tile — so the answer
    //    zone reads 'answer::0'. This is the "before" that makes 'none' at the
    //    end mean "no caret" rather than "no cursor was ever available".
    goToEntry()
    expect(document.activeElement).toBe(region())
    expect(screen.getByTestId('board').getAttribute('data-cursor')).toBe('answer::0')

    // 2. Type the answer. It is what makes the parse below keep an answer for an
    //    unsolved board, and it hands the caret to the board.
    typeKeys('CRANE')
    expect(screen.getByTestId('board').getAttribute('data-cursor')).toBe('board:0:0')

    // 3. Back to step one. The input unmounts, and NOTHING fires a blur.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(today) }))
    expect(screen.getByTestId('board-entry-choose')).toBeTruthy()
    expect(document.activeElement).toBe(document.body)

    // 4. Paste an unsolved board. guesses > 0 and parse.answer is the SUPPLIED
    //    answer, so form.tsx lands on confirm and focuses nothing.
    paste()
    await waitFor(() => expect(board()).toBe('SLATE,,,,,'))
    await flushEffects()

    // The state this test exists for: a real board cursor is available, and
    // nothing is focused.
    expect(answerText()).toBe('CRANE')
    expect(document.activeElement).toBe(document.body)

    // ...so no caret may be drawn. With a stale `focused` this reads 'board:1:0'.
    expect(screen.getByTestId('board').getAttribute('data-cursor')).toBe('none')
  })
})
