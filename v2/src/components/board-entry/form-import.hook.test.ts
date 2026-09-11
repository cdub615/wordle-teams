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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
/** What BoardInput is currently showing, and how a test edits it. */
let setGuessesFromTest: ((guesses: Array<string>) => void) | null

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
 */
vi.mock('./board-input.tsx', () => ({
  BoardInput: ({ guesses, setGuesses }: { guesses: Array<string>; setGuesses: (g: Array<string>) => void }) => {
    setGuessesFromTest = setGuesses
    return createElement('div', { 'data-testid': 'board', 'data-guesses': guesses.join(',') })
  },
}))

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
/** Board entry now opens on the step that asks which day and how. */
const goToEntry = () => fireEvent.click(screen.getByRole('button', { name: /enter manually/i }))

beforeEach(() => {
  fired = []
  failingMutation = null
  proAnswer = true
  setGuessesFromTest = null
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
    expect(document.getElementById('answer')?.textContent).toBe('CRANE')
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
    setGuessesFromTest?.(['SLIME', 'CRANE', '', '', '', ''])
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
    setGuessesFromTest?.(['SLIME', 'CRANE', '', '', '', ''])
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
    setGuessesFromTest?.(['SLATE', 'CRANE', '', '', '', ''])
    const answerField = document.getElementById('answer')
    if (answerField !== null) {
      for (const key of 'CRANE') fireEvent.keyDown(answerField, { key })
    }
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
    expect(document.getElementById('answer')).toBeNull()
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
    expect(document.activeElement).toBe(document.getElementById('answer'))
  })

  // Arriving from an import must NOT focus: the board is already filled in, and
  // raising a keyboard over it to confirm it would be the original bug with an
  // extra step in front of it.
  test('does not focus the answer when the board arrived from a screenshot', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))
    expect(document.activeElement).not.toBe(document.getElementById('answer'))
  })

  // Going back is free because `answer` and `guesses` are the form's own state,
  // not the step's. A player who mistyped the date must not lose the board.
  test('keeps a part-typed board when the player goes back to change the day', () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    goToEntry()
    setGuessesFromTest?.(['SLATE', '', '', '', '', ''])
    fireEvent.click(screen.getByRole('button', { name: new RegExp(today) }))

    expect(screen.getByTestId('board-entry-choose')).toBeTruthy()
    goToEntry()
    expect(board()).toBe('SLATE,,,,,')
  })
})

describe('the import confirm step', () => {
  const note = () => screen.getByRole('status').textContent ?? ''

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
  })
})

describe('the answer, asked for only when the board did not carry one', () => {
  const note = () => screen.getByRole('status').textContent ?? ''
  const answerField = () => document.getElementById('answer')
  const typeAnswer = (word: string) => {
    const field = answerField()
    if (field === null) throw new Error('no answer field')
    for (const key of word) fireEvent.keyDown(field, { key })
  }

  // A SOLVED BOARD CARRIES ITS OWN ANSWER in the winning row, and the parser
  // reads it there — 18 of 18 across the real corpus. Asking would be friction,
  // and focusing the field would raise a keyboard over a board that is already
  // correct.
  test('never asks when the parse read the answer off the board', async () => {
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()

    await waitFor(() => expect(board()).toBe('SLATE,CRANE,,,,'))
    expect(answerField()?.textContent).toBe('CRANE')
    expect(note()).not.toMatch(/not solved/i)
    expect(document.activeElement).not.toBe(answerField())
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
    expect(answerField()?.textContent).toBe('')
    expect(document.activeElement).toBe(answerField())
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

    typeAnswer('DRYLY')

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
    typeAnswer('DRYLY')
    await waitFor(() => expect(board()).toBe('SLATE,BROIL,WRYLY,,,'))

    setGuessesFromTest?.(['CRANE', 'BROIL', 'WRYLY', '', '', ''])
    await waitFor(() => expect(board()).toBe('CRANE,BROIL,WRYLY,,,'))

    // Retype the last letter of the answer: same answer, and the hand
    // correction survives.
    const field = answerField()
    if (field !== null) {
      fireEvent.keyDown(field, { key: 'Backspace' })
      fireEvent.keyDown(field, { key: 'Y' })
    }
    await waitFor(() => expect(answerField()?.textContent).toBe('DRYLY'))
    expect(board()).toBe('CRANE,BROIL,WRYLY,,,')
  })
})

describe('what the correction log may and may not blame the parser for', () => {
  const answerField = () => document.getElementById('answer')
  const typeAnswer = (word: string) => {
    const field = answerField()
    if (field === null) throw new Error('no answer field')
    for (const key of word) fireEvent.keyDown(field, { key })
  }
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
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/not solved/i))

    // Type it, then change your mind about the last letter.
    typeAnswer('DRYLY')
    await waitFor(() => expect(board()).toBe(lost.join(',')))
    const field = answerField()
    if (field !== null) {
      fireEvent.keyDown(field, { key: 'Backspace' })
      fireEvent.keyDown(field, { key: 'S' })
    }
    await waitFor(() => expect(answerField()?.textContent).toBe('DRYLS'))

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
    await waitFor(() => expect(answerField()?.textContent).toBe('CRANE'))

    // The winning row and the answer are the SAME row on a solved board, so a
    // misread there is a misread of both — correcting one without the other
    // would leave a board Wordle could not have produced, and boardIsValid
    // rightly refuses it.
    const field = answerField()
    if (field !== null) {
      fireEvent.keyDown(field, { key: 'Backspace' })
      fireEvent.keyDown(field, { key: 'K' })
    }
    await waitFor(() => expect(answerField()?.textContent).toBe('CRANK'))
    setGuessesFromTest?.(['SLATE', 'CRANK', '', '', '', ''])
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
