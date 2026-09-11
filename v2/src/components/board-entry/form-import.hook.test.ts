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
function screenshotOf(answer: string, guesses: Array<string>) {
  const board = renderPlayedBoard({ answer, guesses, tileSize: 62 })
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

describe('the Pro gate', () => {
  // UI-ONLY BY DESIGN, per Phase 3's decision 1: "read it, gate the UI, enforce
  // nothing". There is nothing to enforce server-side — the parse runs entirely
  // in the browser, costs the backend nothing, and saves through the same
  // upsertBoard any player may already call by typing a board in by hand.
  test('hides import from a player who is not Pro', async () => {
    proAnswer = false
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(screen.queryByTestId('board-import')).toBeNull()
    expect(screen.queryByRole('button', { name: /import screenshot/i })).toBeNull()
  })

  test('shows it to a player who is', () => {
    proAnswer = true
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(screen.getByTestId('board-import')).toBeTruthy()
  })

  // THE STATE THAT REGRESSES. amIPro answers `undefined` while it is in flight,
  // so a `!isPro` gate would flash a paid-only control at every player on every
  // cold load and then take it away. For a gate the in-flight default has to be
  // "not yet" — the opposite of the default the Upgrade button wants, which is
  // the bug Header.hook.test.ts carries its own note about.
  test('shows nothing while amIPro is still in flight', () => {
    proAnswer = undefined
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(screen.queryByTestId('board-import')).toBeNull()
  })

  // The gate hides the control; it must also mean the document listener is not
  // there. Otherwise a non-Pro player pasting a screenshot silently gets the
  // whole feature with no button to show for it.
  test('does not read a pasted screenshot for a non-Pro player', async () => {
    proAnswer = false
    screenshotOf(ANSWER, GUESSES)
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    paste()
    await waitFor(() => expect(screen.getByTestId('board')).toBeTruthy())
    expect(board()).toBe(',,,,,')
    expect(fired).toEqual([])
  })
})
