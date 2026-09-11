// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime, because this renders the real
// control. `.hook.test.ts` matches the existing precedents, and `.test.ts`
// rather than `.test.tsx` because vitest.config.ts's glob is `src/**/*.test.ts`
// — so the elements below go through `createElement` by hand.
//
// WHY THIS FILE EXISTS RATHER THAN LEAVING IT TO e2e. e2e IS NOT A GATE here:
// .github/workflows/deploy-v2.yml runs lint, typecheck, test:once and build and
// never runs Playwright, so a promise protected only by a spec can be deleted
// by a green pipeline. The promise in question is the one the whole feature
// rests on — THE IMPORT NEVER SAVES ANYTHING — and it belongs in a gate.
//
// jsdom has no canvas (getContext('2d') returns null) and no ClipboardEvent, so
// the decode is stood in for and the paste is dispatched as a plain Event with
// clipboardData attached. adapter.ts types those structurally precisely so this
// is possible; see its own test file.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ImportScreenshot } from './import-screenshot.tsx'
import type { BoardParse } from '#/lib/board-import/parse.ts'

const shot = () => new File([new Uint8Array([1, 2, 3])], 'wordle.png', { type: 'image/png' })

const pasteOf = (file: File | null) => {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: file === null ? [] : [{ kind: 'file', type: file.type, getAsFile: () => file }],
      files: [],
    },
  })
  return event
}

/** Stands in for the canvas jsdom does not have. */
function stubCanvas(width = 300, height = 600) {
  vi.stubGlobal('createImageBitmap', async () => ({ width, height, close: () => {} }))
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return Object.getPrototypeOf(document).createElement.call(document, tag)
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4),
        }),
      }),
    } as unknown as HTMLElement
  }) as typeof document.createElement)
}

describe('ImportScreenshot', () => {
  beforeEach(() => vi.stubGlobal('console', { ...console, error: vi.fn() }))
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('offers all three ways in', () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { read: async () => [] } })
    render(createElement(ImportScreenshot, { onParsed: vi.fn(), answer: '' }))

    expect(screen.getByRole('button', { name: /paste screenshot/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /import screenshot/i })).toBeTruthy()
    expect(screen.getByLabelText(/wordle screenshot/i)).toBeTruthy()
    expect(screen.getByText(/drop one here/i)).toBeTruthy()
  })

  // THE PATH THE FEATURE IS NAMED AFTER, and the reason the listener is on the
  // document rather than on this element: a screenshot is pasted while the
  // player is looking at the sheet, not while this div has focus — and the
  // board itself cancels every paste that reaches it.
  test('reads a screenshot pasted anywhere in the document', async () => {
    stubCanvas()
    const onParsed = vi.fn()
    render(createElement(ImportScreenshot, { onParsed, answer: '' }))

    document.dispatchEvent(pasteOf(shot()))

    await waitFor(() => expect(onParsed).toHaveBeenCalledTimes(1))
    const parse = onParsed.mock.calls[0][0] as BoardParse
    // A blank image, so there is no board in it — which is the honest outcome
    // and exactly what the caller must be handed rather than an exception.
    expect(parse.outcome).toBe('no-board')
  })

  test('lets a plain text paste through to whatever the player was typing into', () => {
    stubCanvas()
    const onParsed = vi.fn()
    render(createElement(ImportScreenshot, { onParsed, answer: '' }))

    const event = pasteOf(null)
    document.dispatchEvent(event)

    expect(onParsed).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  test('swallows the paste once it knows there is an image, so nothing types it', async () => {
    stubCanvas()
    render(createElement(ImportScreenshot, { onParsed: vi.fn(), answer: '' }))

    const event = pasteOf(shot())
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  test('stops listening once it is disabled, and once it unmounts', () => {
    stubCanvas()
    const onParsed = vi.fn()
    const view = render(createElement(ImportScreenshot, { onParsed, answer: '', disabled: true }))
    document.dispatchEvent(pasteOf(shot()))
    expect(onParsed).not.toHaveBeenCalled()

    view.rerender(createElement(ImportScreenshot, { onParsed, answer: '', disabled: false }))
    view.unmount()
    document.dispatchEvent(pasteOf(shot()))
    expect(onParsed).not.toHaveBeenCalled()
  })

  test('says what happened, in words a player can act on', async () => {
    stubCanvas()
    render(createElement(ImportScreenshot, { onParsed: vi.fn(), answer: '' }))

    document.dispatchEvent(pasteOf(shot()))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no wordle board/i))
  })

  // A DECODE THAT FAILS MUST NOT TAKE THE FORM WITH IT. An unsupported format
  // or a truncated file is an ordinary thing for a player to paste, and manual
  // entry has to keep working.
  test('reports a broken image instead of throwing', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('unsupported')
    })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    const onParsed = vi.fn()
    render(createElement(ImportScreenshot, { onParsed, answer: '' }))

    document.dispatchEvent(pasteOf(shot()))

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/could not read that image/i))
    expect(onParsed).not.toHaveBeenCalled()
  })
})

describe('the Paste button', () => {
  beforeEach(() => vi.stubGlobal('console', { ...console, error: vi.fn() }))
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const withClipboard = (read: () => Promise<Array<unknown>>) =>
    vi.stubGlobal('navigator', { ...navigator, clipboard: { read } })

  const imageItem = () => ({
    types: ['image/png'],
    getType: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  })

  const paste = () => fireEvent.click(screen.getByRole('button', { name: /paste screenshot/i }))

  // PASTE IS THE PRIMARY PATH ON A PHONE, not a convenience. A screenshot taken
  // with iOS's "Copy and Delete" never reaches Photos, so the file picker finds
  // nothing and the clipboard is the only place the image exists.
  test('is offered before Import, where the browser can read the clipboard', () => {
    withClipboard(async () => [])
    stubCanvas()
    render(createElement(ImportScreenshot, { onParsed: vi.fn(), answer: '' }))

    const buttons = screen.getAllByRole('button').map((button) => button.textContent ?? '')
    expect(buttons[0]).toMatch(/paste screenshot/i)
    expect(buttons[1]).toMatch(/import screenshot/i)
  })

  // Hidden rather than offered-and-apologised-for. Firefox has a clipboard
  // object with writeText and no read at all.
  test('is absent where the browser cannot read images off the clipboard', () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => {} } })
    stubCanvas()
    render(createElement(ImportScreenshot, { onParsed: vi.fn(), answer: '' }))

    expect(screen.queryByRole('button', { name: /paste screenshot/i })).toBeNull()
    expect(screen.getByRole('button', { name: /import screenshot/i })).toBeTruthy()
  })

  test('reads the clipboard and parses what it finds', async () => {
    withClipboard(async () => [imageItem()])
    stubCanvas()
    const onParsed = vi.fn()
    render(createElement(ImportScreenshot, { onParsed, answer: '' }))

    paste()

    await waitFor(() => expect(onParsed).toHaveBeenCalledTimes(1))
  })

  // EACH OUTCOME READS AS HELP. None of them is really an error — they are all
  // things a person does — and "could not read the clipboard" would be a lie
  // about a clipboard that simply had no picture on it.
  test('says what to do when the clipboard holds no image', async () => {
    withClipboard(async () => [{ types: ['text/plain'], getType: async () => new Blob([]) }])
    stubCanvas()
    const onParsed = vi.fn()
    render(createElement(ImportScreenshot, { onParsed, answer: '' }))

    paste()

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no image on the clipboard/i))
    expect(onParsed).not.toHaveBeenCalled()
  })

  test('treats a declined paste prompt as a refusal, not a fault', async () => {
    withClipboard(async () => {
      const error = new Error('nope')
      error.name = 'NotAllowedError'
      throw error
    })
    stubCanvas()
    render(createElement(ImportScreenshot, { onParsed: vi.fn(), answer: '' }))

    paste()

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/did not allow the paste/i))
  })

  test('points at Import when the clipboard cannot be read at all', async () => {
    withClipboard(async () => {
      throw new Error('exploded')
    })
    stubCanvas()
    render(createElement(ImportScreenshot, { onParsed: vi.fn(), answer: '' }))

    paste()

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/still use Import screenshot/i))
  })

  test('stops offering to paste while it is busy', async () => {
    withClipboard(async () => [imageItem()])
    stubCanvas()
    render(createElement(ImportScreenshot, { onParsed: vi.fn(), answer: '' }))

    const button = screen.getByRole('button', { name: /paste screenshot/i })
    fireEvent.click(button)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'))
  })
})
