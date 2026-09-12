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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import ProfileTab from './profile-tab.tsx'

const { setAvatarMock, removeAvatarMock, updateNameMock, generateUploadUrlMock, toastSuccess, toastError } =
  vi.hoisted(() => ({
    setAvatarMock: vi.fn().mockResolvedValue(null),
    removeAvatarMock: vi.fn().mockResolvedValue(null),
    updateNameMock: vi.fn().mockResolvedValue(null),
    generateUploadUrlMock: vi.fn().mockResolvedValue('https://upload.example/one-shot'),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  }))

/** Set per test, read by the mocked `useQuery`. */
let me: { firstName: string; lastName: string; image: string | null; hasUpload: boolean } | null

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

beforeEach(() => {
  me = { firstName: 'Ada', lastName: 'Lovelace', image: null, hasUpload: false }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const firstNameInput = () => screen.getByLabelText('First name') as HTMLInputElement
const lastNameInput = () => screen.getByLabelText('Last name') as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: 'Save name' })

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
