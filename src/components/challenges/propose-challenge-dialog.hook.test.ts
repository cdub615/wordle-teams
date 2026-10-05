// @vitest-environment jsdom
//
// jsdom, `.test.ts` with createElement and no jest-dom, for the reasons
// challenges.hook.test.ts gives at its top. Presence is `not.toBeNull()` on a
// `queryBy…`, absence `toBeNull()`.
//
// THE SPECIFICATION FOR TASK 12b (zic8.2.19), numbered as the plan numbers its
// behaviours: the card's "Challenge a team" control (1-3) and the dialog it
// opens (4-9). Both take plain props — routes/team.tsx owns the mutations — so
// the "mutations" here are vi.fn()s whose arguments are the assertion.
//
// THE BROWSER'S SHARE APIS ARE OWNED HERE, as invite-player-dialog.hook.test.ts
// owns them: jsdom implements neither, so each test installs exactly the
// browser it describes and afterEach removes both.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConvexError } from 'convex/values'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { typedCodeMessage } from '#/lib/convex-error.ts'
import { ChallengesCard } from './challenges-card.tsx'
import { LINK_NOT_SHARED, ProposeChallengeDialog } from './propose-challenge-dialog.tsx'
import type { ChallengesView } from './types.ts'
import type { AccessCode } from '../../../convex/access'
import type { Id } from '../../../convex/_generated/dataModel'

const { toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
}))

const teamId = (value: string) => value as Id<'teams'>
const CURRENT = teamId('team-current')
const TOKEN = '00112233445566778899aabbccddeeff'

beforeEach(() => {
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

// ───────────────────────────── the control ─────────────────────────────

function card(view: ChallengesView) {
  const onChallenge = vi.fn()
  const onUpgrade = vi.fn()
  const result = render(
    createElement(ChallengesCard, {
      view,
      isOwner: false,
      acceptsChallenges: undefined,
      now: 0,
      onAccept: vi.fn(),
      onDecline: vi.fn(),
      onWithdraw: vi.fn(),
      onCancel: vi.fn(),
      onSetAcceptsChallenges: vi.fn(),
      onUpgrade,
      onChallenge,
    }),
  )
  return { ...result, onChallenge, onUpgrade }
}

const enabled = (pro: boolean): ChallengesView => ({
  enabled: true,
  pro,
  active: [],
  pending: [],
  records: [],
})

const control = () => screen.getByRole('button', { name: 'Challenge a team' })

describe('the "Challenge a team" control', () => {
  test('1. a Pro viewer gets the button, and it opens the dialog — not the upgrade', () => {
    const { onChallenge, onUpgrade } = card(enabled(true))
    // Visible TEXT, not only an accessible name (wordle-teams-390).
    expect(control().textContent).toBe('Challenge a team')
    fireEvent.click(control())
    expect(onChallenge).toHaveBeenCalledTimes(1)
    expect(onUpgrade).not.toHaveBeenCalled()
  })

  test('2. a free viewer gets the SAME label as an upgrade affordance, never a disabled button', () => {
    const { onChallenge, onUpgrade } = card(enabled(false))
    expect(control().textContent).toBe('Challenge a team')
    expect(control().hasAttribute('disabled')).toBe(false)
    expect(control().getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(control())
    expect(onUpgrade).toHaveBeenCalledTimes(1)
    // THE MUTANT THIS EXISTS FOR: a free viewer handed the dialog, to be
    // refused PRO_REQUIRED by the server one tap later.
    expect(onChallenge).not.toHaveBeenCalled()
  })

  test('3. a dark deployment renders neither', () => {
    const { container } = card({ enabled: false })
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('button', { name: 'Challenge a team' })).toBeNull()
  })
})

// ───────────────────────────── the dialog ─────────────────────────────

const TEAMS = [
  { id: teamId('team-a'), name: 'Alphas' },
  { id: CURRENT, name: 'Current Crew' },
  { id: teamId('team-b'), name: 'Bravos' },
]

type DialogProps = Parameters<typeof ProposeChallengeDialog>[0]

function dialog({
  teams = TEAMS,
  proposeToTeam = vi.fn<DialogProps['proposeToTeam']>().mockResolvedValue('challenge-1'),
  proposeByLink = vi.fn<DialogProps['proposeByLink']>().mockResolvedValue(TOKEN),
  onOpenChange = vi.fn<DialogProps['onOpenChange']>(),
}: {
  teams?: typeof TEAMS
  proposeToTeam?: Mock<DialogProps['proposeToTeam']>
  proposeByLink?: Mock<DialogProps['proposeByLink']>
  onOpenChange?: Mock<DialogProps['onOpenChange']>
} = {}) {
  const props = {
    open: true,
    onOpenChange,
    teamId: CURRENT,
    teamName: 'Current Crew',
    teams,
    proposeToTeam,
    proposeByLink,
  }
  const result = render(createElement(ProposeChallengeDialog, props))
  return { ...result, props, proposeToTeam, proposeByLink, onOpenChange }
}

/** The team buttons, in order: the buttons inside the dialog's team list. */
const teamButtons = () => within(screen.getByRole('list')).queryAllByRole('button')
const teamNames = () => teamButtons().map((button) => button.textContent)
const linkButton = () => screen.getByRole('button', { name: /create a challenge link/i })

const refusal = (code: AccessCode) => new ConvexError({ code })

/** A promise the test settles by hand, so "in flight" is a state it can look at. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('4. your other teams', () => {
  test('every team from getMyTeams EXCEPT the current one, in order', () => {
    dialog()
    expect(teamNames()).toEqual(['Alphas', 'Bravos'])
  })

  test('each calls proposeToTeam({ challengerTeamId: current, opponentTeamId })', async () => {
    const { proposeToTeam } = dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Bravos' }))
    await waitFor(() => expect(proposeToTeam).toHaveBeenCalledTimes(1))
    expect(proposeToTeam).toHaveBeenCalledWith({
      challengerTeamId: CURRENT,
      opponentTeamId: teamId('team-b'),
    })
  })

  test('with no other team: one line pointing at the link, instead of an empty list', () => {
    dialog({ teams: [{ id: CURRENT, name: 'Current Crew' }] })
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByText(/not on any other team.*link/i)).not.toBeNull()
    // The link option it points at is still there.
    expect(linkButton().hasAttribute('disabled')).toBe(false)
  })
})

describe('5. a challenge link', () => {
  test('mints with the current team, and shares /challenge/<token> through the share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const { writeText } = browser({ share, clipboard: true })
    const { proposeByLink } = dialog()
    fireEvent.click(linkButton())

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(proposeByLink).toHaveBeenCalledExactlyOnceWith({ challengerTeamId: CURRENT })
    expect(share.mock.calls[0][0]).toMatchObject({
      url: `${window.location.origin}/challenge/${TOKEN}`,
    })
    // Share sheet first: the clipboard is the fallback, not a second action.
    expect(writeText).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  test('no share sheet: copied to the clipboard, with a LASTING "Link copied"', async () => {
    const { writeText } = browser({ clipboard: true })
    dialog()
    expect(screen.queryByText('Link copied to your clipboard.')).toBeNull()
    fireEvent.click(linkButton())

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        `${window.location.origin}/challenge/${TOKEN}`,
      ),
    )
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Link copied to your clipboard.')).not.toBeNull()
  })

  test('"Link copied" does not survive closing and reopening the dialog', async () => {
    browser({ clipboard: true })
    const { rerender, props } = dialog()
    fireEvent.click(linkButton())
    await waitFor(() => expect(screen.queryByText('Link copied to your clipboard.')).not.toBeNull())
    rerender(createElement(ProposeChallengeDialog, { ...props, open: false }))
    rerender(createElement(ProposeChallengeDialog, { ...props, open: true }))
    expect(screen.queryByText('Link copied to your clipboard.')).toBeNull()
  })

  test('a dismissed share sheet says nothing at all', async () => {
    const abort = Object.assign(new Error('Share canceled'), { name: 'AbortError' })
    const share = vi.fn().mockRejectedValue(abort)
    browser({ share, clipboard: true })
    dialog()
    fireEvent.click(linkButton())

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(linkButton().hasAttribute('disabled')).toBe(false))
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  test('with neither API it says so, instead of blaming the mint', async () => {
    browser({})
    const { proposeByLink } = dialog()
    fireEvent.click(linkButton())

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(proposeByLink).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0][0]).not.toBe('Could not create a challenge link')
    expect(toastError.mock.calls[0][0]).toBe(LINK_NOT_SHARED)
  })

  // AFTER THE MINT THE PROPOSAL EXISTS. A share that fails for any reason but a
  // dismissal must not say "could not create": the user would retry, and each
  // retry leaves another unclaimable row holding one of the team's slots.
  test('a share that fails after the mint says the challenge was made, and how to clear it', async () => {
    const denied = Object.assign(new Error('Not allowed'), { name: 'NotAllowedError' })
    browser({ share: vi.fn().mockRejectedValue(denied), clipboard: true })
    const { proposeByLink } = dialog()
    fireEvent.click(linkButton())

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(proposeByLink).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(LINK_NOT_SHARED)
    expect(LINK_NOT_SHARED).toMatch(/withdraw/i)
  })
})

test('6. the dialog says the link cannot be recovered, and what to do instead', () => {
  dialog()
  expect(screen.queryByText(/You can withdraw it and make a new one\./)).not.toBeNull()
})

const PROPOSE_REFUSALS = [
  'PRO_REQUIRED',
  'CHALLENGE_LIMIT_REACHED',
  'CHALLENGE_EXISTS',
  'CHALLENGES_REFUSED',
  'CHALLENGES_DISABLED',
] as const satisfies ReadonlyArray<AccessCode>

describe('7. every refusal surfaces its own copy, and the dialog stays open', () => {
  test.each(PROPOSE_REFUSALS)('proposeToTeam refused %s', async (code) => {
    const proposeToTeam = vi.fn<DialogProps['proposeToTeam']>().mockRejectedValue(refusal(code))
    const { onOpenChange } = dialog({ proposeToTeam })
    fireEvent.click(screen.getByRole('button', { name: 'Alphas' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith(typedCodeMessage(code))
    expect(toastSuccess).not.toHaveBeenCalled()
    // OPEN, so the user can pick another team — and the buttons usable again.
    expect(onOpenChange).not.toHaveBeenCalled()
    await waitFor(() => expect(teamButtons().every((b) => !b.hasAttribute('disabled'))).toBe(true))
  })

  // The link path's own refusals: it has no opponent, so only the checks that
  // need none can fire (proposeByLinkFor).
  test.each(['PRO_REQUIRED', 'CHALLENGE_LIMIT_REACHED', 'CHALLENGES_DISABLED'] as const)(
    'proposeByLink refused %s',
    async (code) => {
      const share = vi.fn().mockResolvedValue(undefined)
      browser({ share, clipboard: true })
      const proposeByLink = vi.fn<DialogProps['proposeByLink']>().mockRejectedValue(refusal(code))
      const { onOpenChange } = dialog({ proposeByLink })
      fireEvent.click(linkButton())

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(typedCodeMessage(code)))
      expect(share).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
    },
  )

  test('an untyped failure gets the fallback, not a typed code’s copy', async () => {
    const proposeToTeam = vi.fn<DialogProps['proposeToTeam']>().mockRejectedValue(new Error('offline'))
    dialog({ proposeToTeam })
    fireEvent.click(screen.getByRole('button', { name: 'Alphas' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not send that challenge'))
  })
})

describe('8. no double submit', () => {
  test('while a proposal is in flight every team button and the link button are disabled', async () => {
    const inFlight = deferred<string>()
    const proposeToTeam = vi.fn<DialogProps['proposeToTeam']>().mockReturnValue(inFlight.promise)
    const { proposeByLink } = dialog({ proposeToTeam })

    fireEvent.click(screen.getByRole('button', { name: 'Alphas' }))
    await waitFor(() => expect(linkButton().hasAttribute('disabled')).toBe(true))
    expect(teamButtons()).toHaveLength(2)
    for (const button of teamButtons()) expect(button.hasAttribute('disabled')).toBe(true)

    // And the taps do nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Bravos' }))
    fireEvent.click(linkButton())
    expect(proposeToTeam).toHaveBeenCalledTimes(1)
    expect(proposeByLink).not.toHaveBeenCalled()

    await act(async () => inFlight.resolve('challenge-1'))
  })

  test('a link in flight disables the team buttons too', async () => {
    browser({ clipboard: true })
    const inFlight = deferred<string>()
    const proposeByLink = vi.fn<DialogProps['proposeByLink']>().mockReturnValue(inFlight.promise)
    const { proposeToTeam } = dialog({ proposeByLink })

    fireEvent.click(linkButton())
    await waitFor(() => expect(linkButton().hasAttribute('disabled')).toBe(true))
    for (const button of teamButtons()) expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Alphas' }))
    expect(proposeToTeam).not.toHaveBeenCalled()

    await act(async () => inFlight.resolve(TOKEN))
    await waitFor(() => expect(linkButton().hasAttribute('disabled')).toBe(false))
  })
})

test('9. a successful direct proposal: "Challenge sent to <team>", and the dialog closes', async () => {
  const { onOpenChange } = dialog()
  fireEvent.click(screen.getByRole('button', { name: 'Bravos' }))

  await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
  expect(toastSuccess).toHaveBeenCalledExactlyOnceWith('Challenge sent to Bravos')
  expect(toastError).not.toHaveBeenCalled()
})
