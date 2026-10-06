// @vitest-environment jsdom
//
// jsdom so `navigator` is a real object to install the two APIs onto. jsdom
// implements NEITHER `navigator.share` nor `navigator.clipboard`, so every test
// installs exactly the browser it describes and `afterEach` removes both again —
// the same ownership invite-player-dialog.hook.test.ts takes, and for its
// reason: a test trusting the ambient value reports a mutant as the wrong
// failure.
//
// THE DIALOGS' OWN SUITES ARE THE BEHAVIOURAL PROOF. invite-player-dialog's
// hook test passes UNCHANGED across the extraction (zic8.2.19), and that is the
// evidence the extraction preserved behaviour. This file pins the helper's
// contract directly — the outcome each browser yields — so the challenge dialog
// can rely on it without re-testing the order.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { shareLink } from './share-link.ts'

const ARGS = { url: 'https://example.test/x/123', title: 'A title' }

function browser({ share, clipboard }: { share?: () => Promise<void>; clipboard?: boolean }) {
  const writeText = vi.fn().mockResolvedValue(undefined)
  if (share) {
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share })
  }
  if (clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText },
    })
  }
  return { writeText }
}

afterEach(() => {
  // @ts-expect-error neither property is in lib.dom's Navigator as optional
  delete navigator.share
  // @ts-expect-error same
  delete navigator.clipboard
})

describe('shareLink', () => {
  test('share sheet first, with the title and url, and the clipboard left alone', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const { writeText } = browser({ share, clipboard: true })
    await expect(shareLink(ARGS)).resolves.toBe('shared')
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'A title', url: ARGS.url })
    expect(writeText).not.toHaveBeenCalled()
  })

  test('a dismissed sheet is "dismissed", not a rejection', async () => {
    const abort = Object.assign(new Error('Share canceled'), { name: 'AbortError' })
    browser({ share: vi.fn().mockRejectedValue(abort), clipboard: true })
    await expect(shareLink(ARGS)).resolves.toBe('dismissed')
  })

  test('any other share failure is rethrown, as itself', async () => {
    const failure = new Error('nope')
    browser({ share: vi.fn().mockRejectedValue(failure), clipboard: true })
    await expect(shareLink(ARGS)).rejects.toBe(failure)
  })

  test('no share sheet: the clipboard gets the url', async () => {
    const { writeText } = browser({ clipboard: true })
    await expect(shareLink(ARGS)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledExactlyOnceWith(ARGS.url)
  })

  test('neither API: "unavailable", without throwing', async () => {
    browser({})
    await expect(shareLink(ARGS)).resolves.toBe('unavailable')
  })
})
