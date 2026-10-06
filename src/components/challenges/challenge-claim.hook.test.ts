// @vitest-environment jsdom
//
// jsdom, `.test.ts` with createElement and no jest-dom, for the reasons
// challenges.hook.test.ts gives at its top. Presence is `not.toBeNull()` on a
// `queryBy…`, absence `toBeNull()`.
//
// THE SPECIFICATION FOR TASK 13 (zic8.2.13), numbered as the plan numbers its
// behaviours. The page body takes plain props — routes/challenge.$token.tsx
// owns the mutation and the navigation — so `onClaim` is a vi.fn() and its
// arguments are the assertion. Behaviours 1 and 2's STASH half (who is stashed
// for, who is cleared) is a route decision and lives in
// lib/use-pending-challenge.hook.test.ts; what this file pins of them is what
// the page SAYS.
//
// A PLAIN ANCHOR FOR Link, as no-team-card.hook.test.ts mocks it and for the
// reason it gives: `...rest` carries what Button's asChild Slot merges in.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConvexError } from 'convex/values'
import { createElement, useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { typedCodeMessage } from '#/lib/convex-error.ts'
import { PENDING_CHALLENGE_KEY, rememberPendingChallenge } from '#/lib/pending-challenge.ts'
import type { AccessCode } from '../../../convex/access'
import type { Id } from '../../../convex/_generated/dataModel'

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
    createElement('a', { href: to, ...rest }, children),
}))

const { ChallengeClaim, TERMINAL_REFUSALS } = await import('./challenge-claim.tsx')
type Props = Parameters<typeof ChallengeClaim>[0]
type TerminalRefusal = Props['outcome'] & string

const teamId = (value: string) => value as Id<'teams'>
const ALPHAS = { id: teamId('team-a'), name: 'Alphas' }
const BRAVOS = { id: teamId('team-b'), name: 'Bravos' }

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
  sessionStorage.clear()
})

afterEach(cleanup)

/**
 * The page as the route mounts it: `outcome` held in state and set by
 * `onTerminal`, exactly as routes/challenge.$token.tsx wires it, so a terminal
 * refusal is seen end to end rather than as two halves.
 */
function page(overrides: Partial<Omit<Props, 'outcome' | 'onTerminal'>> = {}) {
  const onClaim = vi.fn<Props['onClaim']>().mockResolvedValue(undefined)
  const onClaimed = vi.fn<Props['onClaimed']>()
  const onTerminal = vi.fn<Props['onTerminal']>()
  function Harness() {
    const [outcome, setOutcome] = useState<TerminalRefusal | null>(null)
    return createElement(ChallengeClaim, {
      state: 'ready',
      teams: [ALPHAS],
      onClaim,
      onClaimed,
      ...overrides,
      outcome,
      onTerminal: (code: TerminalRefusal) => {
        onTerminal(code)
        setOutcome(code)
      },
    })
  }
  const result = render(createElement(Harness))
  return { ...result, onClaim: overrides.onClaim ?? onClaim, onClaimed, onTerminal }
}

const radios = () => screen.queryAllByRole('radio')
const acceptButton = () => screen.queryByRole('button', { name: /^Accept for |^Choose a team/ })
const isDisabled = (element: HTMLElement | null) => element?.hasAttribute('disabled') ?? false
const refusal = (code: AccessCode) => new ConvexError({ code })

describe('1. signed out', () => {
  test('"Opening a challenge" / "One moment…", and it names nothing', () => {
    const { container } = page({ state: 'signed-out', teams: [ALPHAS] })
    expect(screen.getByRole('heading').textContent).toBe('Opening a challenge')
    expect(container.textContent).toContain('One moment…')
    // Nothing about a team, nothing to press, nothing about the link's fate.
    expect(container.textContent).not.toContain('Alphas')
    expect(container.textContent).not.toContain('challenged')
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryAllByRole('link')).toEqual([])
  })

  test('the loading state says the same and offers nothing either', () => {
    const { container } = page({ state: 'loading', teams: [] })
    expect(screen.getByRole('heading').textContent).toBe('Opening a challenge')
    // NOT the no-team state: an unanswered team list is not an empty one.
    expect(container.textContent).not.toContain('You need a team')
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})

// A FAILED LOOKUP IS NOT A SLOW ONE (zic8.2.21 M12). If getMyTeams or
// needsProfile errors, the route used to leave the page on "One moment…" for
// ever. It says so instead, and offers nothing: there is no action here that
// would succeed where the subscription failed, and a refresh is the retry.
describe('1a. the team lookup failed', () => {
  test('one message, nothing to press, and not the loading copy', () => {
    const { container } = page({ state: 'error', teams: [] })
    expect(screen.getByRole('heading').textContent).toBe(
      'Something went wrong loading your teams. Refresh to try again.',
    )
    expect(container.textContent).not.toContain('One moment…')
    expect(container.textContent).not.toContain('You need a team')
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryAllByRole('link')).toEqual([])
  })

  test('even with teams already listed, nothing can be claimed from it', () => {
    page({ state: 'error', teams: [ALPHAS, BRAVOS] })
    expect(radios()).toEqual([])
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})

describe('2. signed in with a player row', () => {
  test("says they've been challenged, how accepting works, and lists their teams", () => {
    const { container } = page({ teams: [ALPHAS, BRAVOS] })
    expect(screen.getByRole('heading').textContent).toBe("You've been challenged")
    expect(container.textContent).toContain(
      'A team accepts on behalf of all its members, and the challenge starts tomorrow.',
    )
    expect(radios()).toHaveLength(2)
    expect(screen.getByLabelText('Alphas')).not.toBeNull()
    expect(screen.getByLabelText('Bravos')).not.toBeNull()
  })
})

describe('3. choosing the team', () => {
  test('one team: it is pre-selected and the button reads "Accept for <team>"', () => {
    page({ teams: [ALPHAS] })
    expect(radios()).toHaveLength(1)
    expect(radios()[0].getAttribute('aria-checked')).toBe('true')
    expect(acceptButton()?.textContent).toBe('Accept for Alphas')
    expect(isDisabled(acceptButton())).toBe(false)
  })

  test('several: nothing pre-selected, and the button disabled until one is chosen', () => {
    // BOTH HALVES OF THE MUTANT LIST'S BEHAVIOUR 3: a pre-selection, or an
    // enabled button with no choice, would let one tap accept for a team the
    // holder never picked.
    const { onClaim } = page({ teams: [ALPHAS, BRAVOS] })
    expect(radios()).toHaveLength(2)
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false'])
    expect(isDisabled(acceptButton())).toBe(true)
    fireEvent.click(acceptButton()!)
    expect(onClaim).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Bravos'))
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    expect(acceptButton()?.textContent).toBe('Accept for Bravos')
    expect(isDisabled(acceptButton())).toBe(false)
  })
})

describe('4. no team at all', () => {
  test('says a team is needed, links to /app, and offers no button', () => {
    const { container } = page({ teams: [] })
    expect(container.textContent).toContain('You need a team to accept a challenge')
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/app'])
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(radios()).toEqual([])
  })
})

describe('5. accepting', () => {
  test('claims for the chosen team, disabled while in flight, then clears, toasts and hands over', async () => {
    rememberPendingChallenge('tok')
    let resolve!: () => void
    const onClaim = vi.fn<Props['onClaim']>(
      () => new Promise<void>((done) => (resolve = done)),
    )
    const { onClaimed } = page({ teams: [ALPHAS, BRAVOS], onClaim })
    fireEvent.click(screen.getByLabelText('Bravos'))
    fireEvent.click(acceptButton()!)

    expect(onClaim.mock.calls).toEqual([[BRAVOS.id]])
    // IN FLIGHT: a second tap would claim a link that is about to be spent.
    expect(isDisabled(acceptButton())).toBe(true)
    fireEvent.click(acceptButton()!)
    expect(onClaim).toHaveBeenCalledTimes(1)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(onClaimed).not.toHaveBeenCalled()

    await act(async () => resolve())

    expect(toastSuccess.mock.calls).toEqual([['Challenge accepted']])
    expect(onClaimed.mock.calls).toEqual([[BRAVOS.id]])
    expect(sessionStorage.getItem(PENDING_CHALLENGE_KEY)).toBeNull()
    expect(toastError).not.toHaveBeenCalled()
    // STILL disabled after success: the page is about to be replaced, and the
    // link is spent — a tap in between would only earn a dead-link refusal.
    expect(isDisabled(acceptButton())).toBe(true)
  })
})

describe('6. terminal refusals replace the page with one message and no buttons', () => {
  test('the codes are exactly the two the plan names', () => {
    expect([...TERMINAL_REFUSALS].sort()).toEqual(['CHALLENGES_DISABLED', 'CHALLENGE_LINK_INVALID'])
  })

  for (const code of ['CHALLENGE_LINK_INVALID', 'CHALLENGES_DISABLED'] as const) {
    test(code, async () => {
      rememberPendingChallenge('tok')
      const onClaim = vi.fn<Props['onClaim']>().mockRejectedValue(refusal(code))
      const { container, onTerminal } = page({ teams: [ALPHAS, BRAVOS], onClaim })
      fireEvent.click(screen.getByLabelText('Alphas'))
      fireEvent.click(acceptButton()!)

      await waitFor(() => expect(onTerminal.mock.calls).toEqual([[code]]))
      expect(screen.getByRole('heading').textContent).toBe(typedCodeMessage(code))
      // ONE message: the heading is the whole page.
      expect(container.textContent).toBe(typedCodeMessage(code))
      expect(screen.queryAllByRole('button')).toEqual([])
      expect(radios()).toEqual([])
      expect(toastError).not.toHaveBeenCalled()
      expect(sessionStorage.getItem(PENDING_CHALLENGE_KEY)).toBeNull()
    })
  }

  test('the dead-link copy is the one message for every cause', () => {
    // The server folds unknown, expired, claimed and withdrawn into one code;
    // the page shows that code's copy and nothing that could tell them apart.
    expect(typedCodeMessage('CHALLENGE_LINK_INVALID')).toBe('That challenge link is no longer valid.')
  })
})

// THE VIEWER'S OWN LINK (wordle-teams-zic8.2.23). CHALLENGE_OWN_PROPOSAL is
// about WHO is claiming, not which team they picked, so every team in the
// picker would be refused the same way — leaving the picker up invites them to
// try each one. It is not a dead link either: the link is still good for
// anyone else, so it is not one of TERMINAL_REFUSALS and onTerminal is not
// told. The page says whose move it is and links back to the team page.
describe('6a. claiming your own link ends the page for you, not for the link', () => {
  const OWN_LINK =
    'This is your own challenge link. Share it with another team — someone there has to accept it.'

  test('one message, a link to /team, no picker, no toast, and not a terminal refusal', async () => {
    const onClaim = vi
      .fn<Props['onClaim']>()
      .mockRejectedValue(refusal('CHALLENGE_OWN_PROPOSAL'))
    const { onTerminal, onClaimed } = page({ teams: [ALPHAS, BRAVOS], onClaim })
    fireEvent.click(screen.getByLabelText('Alphas'))
    fireEvent.click(acceptButton()!)

    await waitFor(() => expect(screen.getByRole('heading').textContent).toBe(OWN_LINK))
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/team'])
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(radios()).toEqual([])
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(onTerminal).not.toHaveBeenCalled()
    expect(onClaimed).not.toHaveBeenCalled()
  })

  // NOT THIS BRANCH'S TO FORGET. useChallengeArrival already clears the stash
  // for a signed-in player on arrival (use-pending-challenge.ts, row three), so
  // by the time a claim can be refused there is nothing left; and this refusal
  // says nothing about the link, which another team can still claim.
  test('leaves the pending-challenge stash alone', async () => {
    rememberPendingChallenge('tok')
    const onClaim = vi
      .fn<Props['onClaim']>()
      .mockRejectedValue(refusal('CHALLENGE_OWN_PROPOSAL'))
    page({ teams: [ALPHAS], onClaim })
    fireEvent.click(acceptButton()!)
    await waitFor(() => expect(screen.getByRole('heading').textContent).toBe(OWN_LINK))
    expect(sessionStorage.getItem(PENDING_CHALLENGE_KEY)).toBe('tok')
  })

  // The code's GENERIC copy is the team page's (a dual-member proposer pressing
  // Accept there); this page says its own thing above, and does not borrow it.
  test('the generic own-proposal copy is unchanged, and is not what this page says', () => {
    expect(typedCodeMessage('CHALLENGE_OWN_PROPOSAL')).toBe(
      'Someone else on your team has to accept a challenge you sent.',
    )
    expect(typedCodeMessage('CHALLENGE_OWN_PROPOSAL')).not.toBe(OWN_LINK)
  })
})

describe('7. recoverable refusals toast and leave the picker', () => {
  const RECOVERABLE = [
    'CHALLENGE_LIMIT_REACHED',
    'CHALLENGE_EXISTS',
    'CHALLENGES_REFUSED',
    'INVALID_TEAM',
    'INVALID_DATE',
  ] as const

  for (const code of RECOVERABLE) {
    test(code, async () => {
      rememberPendingChallenge('tok')
      const onClaim = vi.fn<Props['onClaim']>().mockRejectedValue(refusal(code))
      const { onTerminal, onClaimed } = page({ teams: [ALPHAS, BRAVOS], onClaim })
      fireEvent.click(screen.getByLabelText('Alphas'))
      fireEvent.click(acceptButton()!)

      await waitFor(() => expect(toastError.mock.calls).toEqual([[typedCodeMessage(code)]]))
      // The picker is still there, and usable: another team can be tried.
      expect(screen.getByRole('heading').textContent).toBe("You've been challenged")
      expect(radios()).toHaveLength(2)
      expect(isDisabled(acceptButton())).toBe(false)
      fireEvent.click(screen.getByLabelText('Bravos'))
      expect(acceptButton()?.textContent).toBe('Accept for Bravos')
      expect(onTerminal).not.toHaveBeenCalled()
      expect(onClaimed).not.toHaveBeenCalled()
      expect(toastSuccess).not.toHaveBeenCalled()
      // The link is still good, so the stash is not this refusal's to clear.
      expect(sessionStorage.getItem(PENDING_CHALLENGE_KEY)).toBe('tok')
    })
  }

  test('an untyped failure gets the fallback and leaves the picker too', async () => {
    const onClaim = vi.fn<Props['onClaim']>().mockRejectedValue(new Error('network'))
    page({ teams: [ALPHAS], onClaim })
    fireEvent.click(acceptButton()!)
    await waitFor(() =>
      expect(toastError.mock.calls).toEqual([['Could not accept that challenge']]),
    )
    expect(isDisabled(acceptButton())).toBe(false)
  })
})
