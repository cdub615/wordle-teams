// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// renders the real component through @testing-library/react. Named
// `.hook.test.ts` and written with `createElement` by hand for the reasons
// notifications-tab.hook.test.ts and next-step-card.hook.test.ts spell out at
// their tops: the include glob is `src/**/*.test.ts`, so there is no JSX here.
//
// WHY THIS FILE EXISTS. Everything the share half does is invisible to lint,
// typecheck and build. Deleting the AbortError branch compiles. Calling the
// clipboard even when a share sheet exists compiles. Neither is observable
// without executing the handler against a browser that has — or has not — the
// two APIs, and this is the app's FIRST use of either, so there was no
// precedent to inherit a test from.
//
// THE GLOBALS ARE OWNED HERE, EXPLICITLY, NOT BORROWED FROM THE AMBIENT jsdom.
// jsdom implements neither `navigator.share` nor `navigator.clipboard`, and its
// object graph is uneven in ways that bite: `window.sessionStorage` is a real
// Storage while `window.localStorage` is a plain object with no `getItem`. A
// test that trusted the ambient value would report a mutant as the wrong
// failure, because the TypeError would land in the component's own catch. So
// every test below installs exactly the browser it means to describe and
// `afterEach` removes both properties again.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import { InvitePlayerDialog } from './invite-player-dialog.tsx'
import type { Id } from '../../../convex/_generated/dataModel'

const { createLinkMock, inviteMock, toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  createLinkMock: vi.fn(),
  inviteMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock('@convex-dev/react-query', () => ({
  useConvexMutation: (ref: FunctionReference<'mutation'>) => {
    const name = getFunctionName(ref)
    if (name === getFunctionName(api.inviteLinks.createLink)) return createLinkMock
    if (name === getFunctionName(api.teams.invitePlayer)) return inviteMock
    throw new Error(`invite-player-dialog called an unexpected mutation: ${name}`)
  },
}))

vi.mock('@tanstack/react-query', () => ({
  // `mutateAsync` IS the injected function, so a rejection propagates exactly
  // as react-query's does — the same shape notifications-tab.hook.test.ts uses.
  useMutation: ({ mutationFn }: { mutationFn: (args: unknown) => Promise<unknown> }) => ({
    mutateAsync: mutationFn,
    isPending: false,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
}))

const TOKEN = 'ffeeddccbbaa99887766554433221100'

/** The URL the component is expected to build, given jsdom's own origin. */
const expectedUrl = () => `${window.location.origin}/join/${TOKEN}`

/**
 * Install a share sheet, a clipboard, both or neither. `configurable` so
 * `afterEach` can take them off again; jsdom defines neither, so `delete` on a
 * property this never installed is a no-op rather than an error.
 */
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

function mount() {
  render(
    createElement(InvitePlayerDialog, {
      open: true,
      onOpenChange: vi.fn(),
      teamId: 'team_1' as Id<'teams'>,
      teamName: 'The Wordlers',
    }),
  )
}

const shareButton = () => screen.getByRole('button', { name: /share a link/i })

beforeEach(() => {
  createLinkMock.mockReset().mockResolvedValue(TOKEN)
  inviteMock.mockReset().mockResolvedValue({ status: 'invited', email: 'friend@example.com' })
  toastSuccess.mockReset()
  toastError.mockReset()
  toastInfo.mockReset()
})

afterEach(() => {
  cleanup()
  // @ts-expect-error neither property is in lib.dom's Navigator as optional
  delete navigator.share
  // @ts-expect-error same
  delete navigator.clipboard
})

describe('the share half of the invite dialog', () => {
  test('the control has visible text, which is what wordle-teams-390 is about', () => {
    browser({ clipboard: true })
    mount()
    // getByRole's name would be satisfied by an `aria-label` on an icon-only
    // button, which is exactly the shape that cost v1 its login conversion —
    // a Tooltip never opens on tap and this traffic is heavily iPhone. So the
    // rendered TEXT is asserted, not just the accessible name.
    expect(shareButton().textContent).toContain('Share a link')
  })

  test('hands the link to the native share sheet, and leaves the clipboard alone', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const { writeText } = browser({ share, clipboard: true })
    mount()
    fireEvent.click(shareButton())

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(share).toHaveBeenCalledWith({
      title: 'Join The Wordlers on Wordle Teams',
      url: expectedUrl(),
    })
    // THE POINT OF THIS TEST, and the half a "does it copy?" assertion misses.
    // The sheet is the whole reason a link beats typing an address on a phone;
    // the clipboard is the fallback for desktop. Copying as well would look
    // harmless, pass every gate, and quietly announce "Invite link copied" over
    // a sheet the user is still looking at.
    expect(writeText).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  test('says NOTHING when the user dismisses the share sheet', async () => {
    // What both APIs throw on a dismissal. A real browser throws a DOMException,
    // which is an Error with this name; the component checks the name, so this
    // is the same input.
    const abort = Object.assign(new Error('Share canceled'), { name: 'AbortError' })
    const share = vi.fn().mockRejectedValue(abort)
    browser({ share, clipboard: true })
    mount()
    fireEvent.click(shareButton())

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    // Dismissing a share sheet is a DECISION, not a failure. Telling somebody
    // who just changed their mind that the app is broken is the defect this
    // assertion exists for, and nothing else in the tree can see it.
    await waitFor(() => expect(shareButton().hasAttribute('disabled')).toBe(false))
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  test('but a share that fails for any OTHER reason is reported', async () => {
    // The other side of the AbortError branch: it must be narrow. Swallowing
    // every rejection would also pass the test above and would leave a genuine
    // failure completely silent.
    const share = vi.fn().mockRejectedValue(new Error('nope'))
    browser({ share, clipboard: true })
    mount()
    fireEvent.click(shareButton())

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError.mock.calls[0][0]).toBe('Could not create an invite link')
  })

  test('falls back to the clipboard on a browser with no share sheet', async () => {
    const { writeText } = browser({ clipboard: true })
    mount()
    fireEvent.click(shareButton())

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expectedUrl()))
    expect(toastSuccess).toHaveBeenCalledWith('Invite link copied')
    // The lasting confirmation, since a toast is gone in seconds.
    expect(screen.getByText('Link copied to your clipboard.')).toBeTruthy()
  })

  test('and with neither API it says so, instead of blaming the mint', async () => {
    // BOTH APIS ARE ABSENT OUTSIDE A SECURE CONTEXT — an http:// LAN address is
    // how this app gets opened on a real phone during development. Without the
    // clipboard's own feature check, `navigator.clipboard.writeText` is a
    // TypeError that lands in the component's catch and reports "Could not
    // create an invite link" about a link that was minted successfully.
    browser({})
    mount()
    fireEvent.click(shareButton())

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(createLinkMock).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0][0]).not.toBe('Could not create an invite link')
    expect(toastError.mock.calls[0][0]).toMatch(/email/i)
  })

  test('a refusal from the server keeps its own copy', async () => {
    // mutationErrorMessage maps typed ConvexError codes to their own strings,
    // so the fallback above is only for what the server did not name. Asserted
    // through a plain rejection here: the point is that the fallback is the
    // fallback, not the only message.
    createLinkMock.mockRejectedValue(new Error('offline'))
    browser({ clipboard: true })
    mount()
    fireEvent.click(shareButton())

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not create an invite link'))
  })
})

describe('the email half is untouched by any of that', () => {
  test('submitting the form still invites by email, and mints no link', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    browser({ share, clipboard: true })
    mount()

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'friend@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))

    await waitFor(() => expect(inviteMock).toHaveBeenCalledTimes(1))
    expect(inviteMock.mock.calls[0][0]).toMatchObject({
      teamId: 'team_1',
      email: 'friend@example.com',
    })
    expect(toastSuccess).toHaveBeenCalledWith('Invite sent to friend@example.com')
    // The two paths are independent: pressing one must not run the other.
    expect(createLinkMock).not.toHaveBeenCalled()
    expect(share).not.toHaveBeenCalled()
  })

  test('already_member still keeps the dialog open and clears the field', async () => {
    // One of the five documented outcomes, and the one whose behaviour is
    // easiest to break by editing around it. `onOpenChange` must NOT be called.
    inviteMock.mockResolvedValue({ status: 'already_member' })
    const onOpenChange = vi.fn()
    browser({ clipboard: true })
    render(
      createElement(InvitePlayerDialog, {
        open: true,
        onOpenChange,
        teamId: 'team_1' as Id<'teams'>,
        teamName: 'The Wordlers',
      }),
    )

    const field = screen.getByLabelText('Email') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'friend@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))

    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith('friend@example.com is already on The Wordlers'),
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(field.value).toBe('')
  })
})
