// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real component through @testing-library/react. `.hook.
// test.ts` matches the sibling precedent, settings/notifications-tab.hook.
// test.ts — and `.test.ts` rather than `.test.tsx` because vitest.config.ts's
// glob is `src/**/*.test.ts`, so the one element below goes through
// `createElement` by hand.
//
// THIS FILE'S REASON TO EXIST IS THE `hasUpload` GATE. `image` is non-null for
// a Google sign-in too, and a version of this component that showed "Remove
// picture" whenever `image` was set would type-check, lint, build, and look
// right on a screenshot of exactly the account that must NOT see it — a
// player whose only picture came from Google, offered a button that deletes
// nothing. The two "Remove picture" tests below are the ones that would fail
// if `hasUpload` were swapped for `image` (or a plain truthiness check on it).
//
// IT ALSO DRIVES THE UPLOAD PATH, RATHER THAN LEAVING IT AS THE ONLY
// UNEXERCISED ORCHESTRATION IN THE FILE. `resizeToSquare` needs canvas, which
// jsdom does not implement, so it is mocked here the same way any Convex call
// is — the arithmetic it wraps (cropRectFor) already has its own coverage in
// src/lib/avatar.test.ts, and what is worth pinning at THIS layer is that
// `onPick` calls it, POSTs the result to the URL Convex hands back, reads
// `storageId` out of the JSON body, and hands that to `setAvatar` — not
// whether a real image can be resized in a test runner with no canvas.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import { AvatarEncodingError } from '#/lib/avatar.ts'
import { typedCodeMessage } from '#/lib/convex-error.ts'
import ProfileTab from './profile-tab.tsx'

const {
  setAvatarMock,
  removeAvatarMock,
  updateNameMock,
  generateUploadUrlMock,
  resizeToSquareMock,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  setAvatarMock: vi.fn().mockResolvedValue(null),
  removeAvatarMock: vi.fn().mockResolvedValue(null),
  updateNameMock: vi.fn().mockResolvedValue(null),
  generateUploadUrlMock: vi.fn().mockResolvedValue('https://upload.example/one-shot'),
  resizeToSquareMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

/** Set per test, read by the mocked `useQuery`. `undefined` means "still loading". */
let me: { firstName: string; lastName: string; image: string | null; hasUpload: boolean } | null | undefined

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>) => ({ queryKey: [getFunctionName(ref)] }),
  // KEYED BY NAME, matching notifications-tab.hook.test.ts's discipline: a
  // mutant that pointed one control at the wrong Convex function asks this
  // for a mutation it does not recognise and fails loudly instead of quietly
  // running the wrong mutation.
  useConvexMutation: (ref: FunctionReference<'mutation'>) => {
    const name = getFunctionName(ref)
    if (name === getFunctionName(api.players.generateAvatarUploadUrl)) return generateUploadUrlMock
    if (name === getFunctionName(api.players.setAvatar)) return setAvatarMock
    if (name === getFunctionName(api.players.removeAvatar)) return removeAvatarMock
    if (name === getFunctionName(api.players.updateName)) return updateNameMock
    throw new Error(`ProfileTab asked for an unexpected mutation: ${name}`)
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: me, error: null }),
  // `mutateAsync` IS the injected function, so a rejection propagates exactly
  // as react-query's does — same idiom as notifications-tab.hook.test.ts.
  useMutation: ({ mutationFn }: { mutationFn: (args: unknown) => Promise<unknown> }) => ({
    mutateAsync: mutationFn,
    isPending: false,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

// jsdom has no canvas, so resizeToSquare's real body (createImageBitmap, a
// <canvas>, canvas.toBlob) cannot run here at all — this is the same
// constraint src/lib/avatar.ts's own doc comment names. cropRectFor's
// arithmetic is covered directly in src/lib/avatar.test.ts; this file's job is
// only to prove `onPick` calls this and does the right thing with what it
// returns.
// The REAL AvatarEncodingError alongside the mocked resize, because the
// component narrows on it with `instanceof` — a stubbed-out class would make
// that check throw inside its own catch block and swallow every upload error.
// Importing the genuine class is also what lets the test below prove the
// encoder's own message survives instead of being replaced by the fallback.
vi.mock('#/lib/avatar.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/lib/avatar.ts')>()),
  resizeToSquare: resizeToSquareMock,
}))

beforeEach(() => {
  me = { firstName: 'Ada', lastName: 'Lovelace', image: null, hasUpload: false }
  resizeToSquareMock.mockResolvedValue(new Blob(['fake'], { type: 'image/webp' }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const firstNameInput = () => screen.getByLabelText('First name') as HTMLInputElement
const lastNameInput = () => screen.getByLabelText('Last name') as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: 'Save name' })
const fileInput = () => screen.getByTestId('avatar-file') as HTMLInputElement
const pickFile = (file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })) =>
  fireEvent.change(fileInput(), { target: { files: [file] } })

describe('the name fields', () => {
  test('show the current name', () => {
    render(createElement(ProfileTab))

    expect(firstNameInput().value).toBe('Ada')
    expect(lastNameInput().value).toBe('Lovelace')
  })

  test('Save is disabled once either field is emptied', () => {
    render(createElement(ProfileTab))

    expect(saveButton().hasAttribute('disabled')).toBe(false)

    fireEvent.change(firstNameInput(), { target: { value: '' } })
    expect(saveButton().hasAttribute('disabled')).toBe(true)

    fireEvent.change(firstNameInput(), { target: { value: 'Ada' } })
    expect(saveButton().hasAttribute('disabled')).toBe(false)

    fireEvent.change(lastNameInput(), { target: { value: '' } })
    expect(saveButton().hasAttribute('disabled')).toBe(true)
  })
})

describe('Remove picture is gated on hasUpload, not on image', () => {
  test('absent when hasUpload is false, even with a non-null social image', () => {
    // THE WHOLE POINT OF THE `hasUpload` FIELD: a Google account has a real,
    // non-null `image` and no upload to remove. A gate on `image` instead
    // would pass every other test in this file and still be wrong here.
    me = { firstName: 'Ada', lastName: 'Lovelace', image: 'https://google.example/photo.jpg', hasUpload: false }
    render(createElement(ProfileTab))

    expect(screen.queryByRole('button', { name: 'Remove picture' })).toBeNull()
  })

  test('present when hasUpload is true', () => {
    me = { firstName: 'Ada', lastName: 'Lovelace', image: 'https://storage.example/upload.webp', hasUpload: true }
    render(createElement(ProfileTab))

    expect(screen.queryByRole('button', { name: 'Remove picture' })).not.toBeNull()
  })
})

describe('an encoder failure reports WHY, not the generic line', () => {
  /**
   * THE REGRESSION THIS PINS. An iPhone upload failed on beta with "that image
   * could not be used. Try a different one." — the server's deliberately
   * reason-free INVALID_AVATAR copy — because canvas.toBlob had silently
   * fallen back to PNG and a 256px PNG of a photo blew the 100 KB cap. The
   * player had no way to know that.
   *
   * resizeToSquare now refuses to upload something the server will reject and
   * throws AvatarEncodingError with the actual reason. That message must reach
   * the toast: mutationErrorMessage returns its FALLBACK for anything that is
   * not a ConvexError, so without the instanceof narrowing in the component
   * this test fails and the player is back to a generic line about their own
   * photo.
   */
  test('surfaces the encoder message rather than the fallback copy', async () => {
    resizeToSquareMock.mockRejectedValue(
      new AvatarEncodingError('too-large', 'That picture could not be made small enough. Try a different one.'),
    )
    render(createElement(ProfileTab))
    pickFile()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError).toHaveBeenCalledWith(
      'That picture could not be made small enough. Try a different one.',
    )
    // It never reached the network, which is the other half of the fix — the
    // client stops sending what it already knows will be refused.
    expect(generateUploadUrlMock).not.toHaveBeenCalled()
    expect(setAvatarMock).not.toHaveBeenCalled()
  })

  test('still uses the fallback for anything that is NOT an encoder failure', async () => {
    resizeToSquareMock.mockRejectedValue(new Error('something else entirely'))
    render(createElement(ProfileTab))
    pickFile()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError).toHaveBeenCalledWith('Could not update your picture.')
  })
})

describe('loading vs no player row are different states', () => {
  // THE DISTINCTION THAT MATTERS: `useQuery` answers `undefined` before the
  // round trip resolves and `null` once it has, for a signed-in session with
  // no player row yet (myName's own doc comment). Collapsing the two would
  // flash "finish setting up your profile" at every cold load, for everyone,
  // before their own data has even arrived.
  test('shows a loading state, not the no-player message, while the query is in flight', () => {
    me = undefined
    render(createElement(ProfileTab))

    expect(screen.queryByText(typedCodeMessage('NO_PLAYER'))).toBeNull()
    expect(screen.queryByLabelText('First name')).toBeNull()
  })

  test('a resolved null renders the NO_PLAYER guidance instead of the form', () => {
    // THE STATE TASK 9 MAKES REACHABLE: app-menu.tsx renders the settings
    // dialog for any authenticated user with no needsProfile gate, so a
    // player who has not finished onboarding can open this tab. Without this
    // branch, "Change picture" is ENABLED and its upload flow ends in
    // setAvatar throwing NO_PLAYER — telling them to finish their profile
    // only after they have already tried. This asserts the form never
    // appears in the first place.
    me = null
    render(createElement(ProfileTab))

    expect(screen.queryByText(typedCodeMessage('NO_PLAYER'))).not.toBeNull()
    expect(screen.queryByLabelText('First name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change picture' })).toBeNull()
  })
})

describe('the upload path', () => {
  test('a successful pick resizes, uploads, attaches, and reports success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ storageId: 'kg2abc123' }) }),
    )
    render(createElement(ProfileTab))

    pickFile()

    await waitFor(() => expect(setAvatarMock).toHaveBeenCalledWith({ storageId: 'kg2abc123' }))
    expect(resizeToSquareMock).toHaveBeenCalledTimes(1)
    expect(generateUploadUrlMock).toHaveBeenCalledWith({})
    expect(toastSuccess).toHaveBeenCalledWith('Picture updated')
    expect(toastError).not.toHaveBeenCalled()
  })

  test('a failed upload calls setAvatar with nothing and reports the fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(createElement(ProfileTab))

    pickFile()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    // The generic fallback, NOT the internal `new Error('Upload failed')`
    // message the component throws to get here — that string is for this
    // file's control flow, never for the player to read.
    expect(toastError).toHaveBeenCalledWith('Could not update your picture.')
    expect(setAvatarMock).not.toHaveBeenCalled()
  })

  test('the file input is reset afterwards, so picking the same file twice fires change again', async () => {
    // jsdom's own file-input `.value` getter is a permanent '' regardless of
    // what is assigned to it (measured directly: assigning files via
    // fireEvent.change and then reading `.value` back is '' before this
    // component ever touches it), so asserting on the element's OWN `.value`
    // proves nothing here. Installing a setter spy on the instance is what
    // actually shows the component's `finally` block runs — this is exactly
    // the write `fileRef.current.value = ''` performs, observed directly
    // rather than through a jsdom getter that cannot reflect it.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ storageId: 'kg2abc123' }) }),
    )
    render(createElement(ProfileTab))

    const input = fileInput()
    const valueSetter = vi.fn()
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: valueSetter })

    pickFile()

    await waitFor(() => expect(setAvatarMock).toHaveBeenCalled())
    expect(valueSetter).toHaveBeenCalledWith('')
  })
})

describe('Remove picture and Save name reach the right mutation with the right arguments', () => {
  test('clicking Remove picture calls removeAvatar and reports success', async () => {
    me = { firstName: 'Ada', lastName: 'Lovelace', image: 'https://storage.example/upload.webp', hasUpload: true }
    render(createElement(ProfileTab))

    fireEvent.click(screen.getByRole('button', { name: 'Remove picture' }))

    await waitFor(() => expect(removeAvatarMock).toHaveBeenCalledWith({}))
    expect(toastSuccess).toHaveBeenCalledWith('Picture removed')
  })

  test('clicking Save name calls updateName with the current field values', async () => {
    render(createElement(ProfileTab))

    fireEvent.change(firstNameInput(), { target: { value: 'Grace' } })
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(updateNameMock).toHaveBeenCalledWith({ firstName: 'Grace', lastName: 'Lovelace' }),
    )
    expect(toastSuccess).toHaveBeenCalledWith('Name updated')
  })
})
