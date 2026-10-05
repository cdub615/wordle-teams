// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime, because these render the real
// components. `.test.ts` with createElement, NOT `.test.tsx`: vitest.config.ts
// collects `src/**/*.test.ts` only, so a `.tsx` suite would be skipped silently.
//
// THE SPECIFICATION FOR THE TEAM PAGE'S CHALLENGES UI (zic8.2.12, Task 12a),
// numbered as the plan numbers its behaviours. Every component takes plain
// props, so nothing here touches Convex; only the router's Link is stubbed, for
// the nudge.
//
// NO toBeInTheDocument: jest-dom is not a dependency. Presence is
// `not.toBeNull()` and absence `toBeNull()` on a `queryBy…`.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { addDays, toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { ChallengeScoreboard } from './challenge-scoreboard.tsx'
import { PendingChallengeRow } from './pending-challenge-row.tsx'
import { ChallengesCard } from './challenges-card.tsx'
import { ChallengeNudge } from './challenge-nudge.tsx'
import type {
  ActiveChallenge,
  ChallengeId,
  ChallengeSideView,
  ChallengesView,
  PendingChallenge,
} from './types.ts'

// A plain anchor whose href is what the real router would serialize, so the
// nudge's `to` AND its `search` are both visible to an assertion.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, search, children, className }: {
    to: string
    search?: Record<string, string>
    children?: ReactNode
    className?: string
  }) =>
    createElement(
      'a',
      { href: search ? `${to}?${new URLSearchParams(search).toString()}` : to, className },
      children,
    ),
}))

// Radix Popover (the Cancel confirmation) measures its content; jsdom has no
// ResizeObserver. Same stub as login-signin-failure.hook.test.ts.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
})

const id = (value: string) => value as ChallengeId

function aSide(overrides: Partial<ChallengeSideView> = {}): ChallengeSideView {
  return {
    teamId: 'team-a' as ChallengeSideView['teamId'],
    teamName: 'Alphas',
    boards: 12,
    attempts: 41,
    average: 3.456,
    members: [],
    ...overrides,
  }
}

function anActive(overrides: Partial<ActiveChallenge> = {}): ActiveChallenge {
  return {
    challengeId: id('challenge-1'),
    startDay: '2026-10-05',
    endDay: '2026-10-31',
    viewerIsChallenger: true,
    challenger: aSide(),
    opponent: aSide({
      teamId: 'team-b' as ChallengeSideView['teamId'],
      teamName: 'Bravos',
      boards: 15,
      attempts: 60,
      average: 4,
    }),
    outcome: 'challenger',
    ...overrides,
  }
}

const member = (playerId: string, name: string, average: number, boards: number) => ({
  playerId: playerId as ChallengeSideView['members'][number]['playerId'],
  name,
  boards,
  attempts: Math.round(average * boards),
  average,
})

function board(
  challenge: ActiveChallenge,
  { pro = false, viewerIsOwner = false, onCancel = vi.fn(), onUpgrade = vi.fn() } = {},
) {
  return render(
    createElement(ChallengeScoreboard, { challenge, pro, viewerIsOwner, onCancel, onUpgrade }),
  )
}

describe('ChallengeScoreboard', () => {
  test('1. both team names, both averages to ONE decimal, both board counts', () => {
    board(anActive())
    expect(screen.queryByText('Alphas')).not.toBeNull()
    expect(screen.queryByText('Bravos')).not.toBeNull()
    // 3.456 rounds to one place; 4 is padded to one place, never "4".
    expect(screen.queryByText('3.5')).not.toBeNull()
    expect(screen.queryByText('4.0')).not.toBeNull()
    expect(screen.queryByText('4')).toBeNull()
    expect(screen.queryByText(/\b12 boards\b/)).not.toBeNull()
    expect(screen.queryByText(/\b15 boards\b/)).not.toBeNull()
  })

  test('2. the window start, as "since 5 Oct", from startDay', () => {
    board(anActive({ startDay: '2026-10-05' }))
    expect(screen.queryByText('since 5 Oct')).not.toBeNull()
    cleanup()
    board(anActive({ startDay: '2026-11-01', endDay: '2026-12-31' }))
    expect(screen.queryByText('since 1 Nov')).not.toBeNull()
  })

  // ON ACCEPTANCE DAY THE WINDOW HAS NOT OPENED: it starts the day after, so
  // "since <tomorrow>" would name a day that has not happened.
  test.each([
    { today: '2026-10-05', startDay: '2026-10-06', label: 'starts 6 Oct' },
    { today: '2026-10-06', startDay: '2026-10-06', label: 'since 6 Oct' },
    { today: '2026-10-07', startDay: '2026-10-06', label: 'since 6 Oct' },
  ])('2. on $today a window starting $startDay reads "$label"', ({ today, startDay, label }) => {
    render(
      createElement(ChallengeScoreboard, {
        challenge: anActive({ startDay }),
        pro: false,
        viewerIsOwner: false,
        onCancel: vi.fn(),
        today,
      }),
    )
    expect(screen.queryByText(label)).not.toBeNull()
  })

  /**
   * 3. Named FROM THE VIEWER'S SIDE. Every (outcome, viewerIsChallenger) pair,
   * because the mapping is the easiest thing here to get backwards and a test
   * that only ever views as the challenger cannot see it inverted for the
   * opponent.
   */
  test.each([
    { outcome: 'challenger', viewerIsChallenger: true, verdict: "You're ahead" },
    { outcome: 'challenger', viewerIsChallenger: false, verdict: 'Alphas is ahead' },
    { outcome: 'opponent', viewerIsChallenger: true, verdict: 'Bravos is ahead' },
    { outcome: 'opponent', viewerIsChallenger: false, verdict: "You're ahead" },
    { outcome: 'tie', viewerIsChallenger: true, verdict: 'Level' },
    { outcome: 'tie', viewerIsChallenger: false, verdict: 'Level' },
  ] as const)(
    '3. $outcome viewed as challenger=$viewerIsChallenger reads "$verdict"',
    ({ outcome, viewerIsChallenger, verdict }) => {
      board(anActive({ outcome, viewerIsChallenger }))
      expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(verdict)
    },
  )

  test.each([true, false])(
    '3. void (viewer challenger=%s) reads "Not enough boards yet" and NAMES NO WINNER anywhere',
    (viewerIsChallenger) => {
      const { container } = board(anActive({ outcome: 'void', viewerIsChallenger }), {
        viewerIsOwner: true,
      })
      expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Not enough boards yet')
      expect(container.textContent).not.toMatch(/ahead|level|won|win|lead|behind/i)
    },
  )

  test('4. with pro and rows: a member table under each team, rows labelled by name', () => {
    board(
      anActive({
        challenger: aSide({ members: [member('p1', 'Ada', 3.25, 6), member('p2', 'Grace', 3.75, 6)] }),
        opponent: aSide({
          teamId: 'team-b' as ChallengeSideView['teamId'],
          teamName: 'Bravos',
          members: [member('p3', 'Alan', 4, 15)],
        }),
      }),
      { pro: true },
    )
    const tables = screen.queryAllByRole('table')
    expect(tables).toHaveLength(2)
    const [mine, theirs] = tables
    expect(within(mine).queryByText('Ada')).not.toBeNull()
    expect(within(mine).queryByText('Grace')).not.toBeNull()
    expect(within(mine).queryByText('3.3')).not.toBeNull()
    expect(within(theirs).queryByText('Alan')).not.toBeNull()
    expect(within(theirs).queryByText('Ada')).toBeNull()
    // No upgrade hint for a Pro viewer.
    expect(screen.queryByText(/part of Pro/)).toBeNull()
  })

  test('4. with pro, a side with NO rows gets no table — never an empty one', () => {
    board(
      anActive({
        challenger: aSide({ members: [member('p1', 'Ada', 3.25, 6)] }),
        opponent: aSide({ teamId: 'team-b' as ChallengeSideView['teamId'], teamName: 'Bravos', members: [] }),
      }),
      { pro: true },
    )
    const tables = screen.queryAllByRole('table')
    expect(tables).toHaveLength(1)
    expect(within(tables[0]).queryByText('Ada')).not.toBeNull()
  })

  test('4. without pro: no member table, and a one-line upgrade hint that opens the upgrade', () => {
    const onUpgrade = vi.fn()
    // Rows present ON PURPOSE: the component does not gate, but `pro` still
    // chooses the hint — the server is what strips the rows.
    board(anActive({ challenger: aSide({ members: [member('p1', 'Ada', 3.25, 6)] }) }), {
      pro: false,
      onUpgrade,
    })
    expect(screen.queryAllByRole('table')).toEqual([])
    expect(screen.queryByText('Each player’s average is part of Pro.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })

  test('5. Cancel renders only for the owner', () => {
    board(anActive(), { viewerIsOwner: false })
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    cleanup()
    board(anActive(), { viewerIsOwner: true })
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeNull()
  })

  test('5. Cancel, once confirmed, calls onCancel(challengeId)', () => {
    const onCancel = vi.fn()
    board(anActive({ challengeId: id('challenge-42') }), { viewerIsOwner: true, onCancel })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // Not on the first click: cancelling freezes the contest for both rosters.
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'End challenge' }))
    expect(onCancel).toHaveBeenCalledExactlyOnceWith('challenge-42')
  })
})

const NOW = 1_800_000_000_000

function aPending(overrides: Partial<PendingChallenge> = {}): PendingChallenge {
  return {
    challengeId: id('pending-1'),
    direction: 'incoming',
    otherTeamName: 'Rivals',
    isLink: false,
    expiresAt: NOW + 60_000,
    proposedByViewer: false,
    ...overrides,
  }
}

function row(
  challenge: PendingChallenge,
  {
    viewerIsOwner = false,
    now = NOW,
    onAccept = vi.fn(),
    onDecline = vi.fn(),
    onWithdraw = vi.fn(),
  } = {},
) {
  return render(
    createElement(PendingChallengeRow, {
      challenge,
      viewerIsOwner,
      now,
      onAccept,
      onDecline,
      onWithdraw,
    }),
  )
}

const buttonNames = () => screen.queryAllByRole('button').map((button) => button.textContent)

describe('PendingChallengeRow', () => {
  test('6. incoming: the other team named, Accept and Decline, and NO numbers of any kind (AC3)', () => {
    const onAccept = vi.fn()
    const onDecline = vi.fn()
    const { container } = row(aPending({ challengeId: id('pending-7') }), {
      viewerIsOwner: true,
      onAccept,
      onDecline,
    })
    expect(container.textContent).toContain('Rivals')
    expect(buttonNames()).toEqual(['Accept', 'Decline'])
    expect(container.textContent).not.toMatch(/\d/)

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAccept).toHaveBeenCalledExactlyOnceWith('pending-7')
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(onDecline).toHaveBeenCalledExactlyOnceWith('pending-7')
  })

  test('6. incoming: any member may answer, owner or not', () => {
    row(aPending(), { viewerIsOwner: false })
    expect(buttonNames()).toEqual(['Accept', 'Decline'])
  })

  test.each([
    { proposedByViewer: true, viewerIsOwner: false, shown: true },
    { proposedByViewer: false, viewerIsOwner: true, shown: true },
    { proposedByViewer: true, viewerIsOwner: true, shown: true },
    { proposedByViewer: false, viewerIsOwner: false, shown: false },
  ])(
    '7. outgoing: Withdraw shown=$shown for proposer=$proposedByViewer owner=$viewerIsOwner',
    ({ proposedByViewer, viewerIsOwner, shown }) => {
      const onWithdraw = vi.fn()
      row(aPending({ direction: 'outgoing', proposedByViewer, challengeId: id('pending-9') }), {
        viewerIsOwner,
        onWithdraw,
      })
      expect(buttonNames()).toEqual(shown ? ['Withdraw'] : [])
      if (shown) {
        fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
        expect(onWithdraw).toHaveBeenCalledExactlyOnceWith('pending-9')
      }
    },
  )

  test('7. outgoing to a named team says who it is waiting for', () => {
    const { container } = row(aPending({ direction: 'outgoing', proposedByViewer: true }))
    expect(container.textContent).toContain('Rivals')
  })

  test('8. a link proposal (otherTeamName null): "Waiting for a team to claim your link"', () => {
    row(aPending({ direction: 'outgoing', otherTeamName: null, isLink: true, proposedByViewer: true }))
    expect(screen.queryByText('Waiting for a team to claim your link')).not.toBeNull()
  })

  test.each([
    { label: 'incoming', direction: 'incoming' as const },
    { label: 'outgoing (proposer and owner)', direction: 'outgoing' as const },
  ])('9. $label at expiresAt <= now: "Expired", and NO actions (AC5)', ({ direction }) => {
    for (const expiresAt of [NOW, NOW - 1]) {
      row(aPending({ direction, proposedByViewer: true, expiresAt }), { viewerIsOwner: true })
      expect(screen.queryByText('Expired')).not.toBeNull()
      expect(buttonNames()).toEqual([])
      cleanup()
    }
    // One millisecond earlier it was live — so the above is the clock.
    row(aPending({ direction, proposedByViewer: true, expiresAt: NOW + 1 }), { viewerIsOwner: true })
    expect(screen.queryByText('Expired')).toBeNull()
    expect(buttonNames().length).toBeGreaterThan(0)
  })
})

function enabled(overrides: Partial<Extract<ChallengesView, { enabled: true }>> = {}): ChallengesView {
  return { enabled: true, pro: false, active: [], pending: [], records: [], ...overrides }
}

function card(
  view: ChallengesView,
  {
    isOwner = false,
    // NO DEFAULT, deliberately: a destructuring default would turn the
    // `undefined` case 13 exists to test into `true` before the card saw it.
    acceptsChallenges,
    onSetAcceptsChallenges = vi.fn(),
    acceptsPending = false,
  }: {
    isOwner?: boolean
    acceptsChallenges?: boolean
    onSetAcceptsChallenges?: (accepts: boolean) => void
    acceptsPending?: boolean
  } = {},
) {
  return render(
    createElement(ChallengesCard, {
      view,
      isOwner,
      acceptsChallenges,
      now: NOW,
      onAccept: vi.fn(),
      onDecline: vi.fn(),
      onWithdraw: vi.fn(),
      onCancel: vi.fn(),
      onSetAcceptsChallenges,
      acceptsPending,
    }),
  )
}

const EMPTY = 'No challenges in progress.'

describe('ChallengesCard', () => {
  test('10. enabled: false renders NOTHING — no heading, no empty state, no switch', () => {
    // As the OWNER, so the switch's own gate is not what hides it.
    const { container } = card({ enabled: false }, { isOwner: true })
    expect(container.innerHTML).toBe('')
  })

  test('10. (control) enabled renders the section', () => {
    card(enabled())
    expect(screen.queryByRole('region', { name: 'Challenges' })).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Challenges' })).not.toBeNull()
  })

  test('11. enabled with nothing live: a one-line empty state', () => {
    card(enabled())
    expect(screen.queryByText(EMPTY)).not.toBeNull()
  })

  test('11. the empty state goes as soon as anything is live — active or pending', () => {
    card(enabled({ active: [anActive()] }))
    expect(screen.queryByText(EMPTY)).toBeNull()
    cleanup()
    card(enabled({ pending: [aPending()] }))
    expect(screen.queryByText(EMPTY)).toBeNull()
  })

  test('11. a record alone is not "live": the empty state still shows beside it', () => {
    card(
      enabled({
        records: [
          {
            opponentTeamId: 'team-z' as ActiveChallenge['challenger']['teamId'],
            opponentName: 'Zetas',
            record: { won: 1, lost: 0, tied: 0, noResult: 0 },
          },
        ],
      }),
    )
    expect(screen.queryByText(EMPTY)).not.toBeNull()
  })

  test('12. head to head: "<name> — won W, lost L, tied T", and "N no result" only when non-zero', () => {
    const teamId = (value: string) => value as ActiveChallenge['challenger']['teamId']
    card(
      enabled({
        records: [
          { opponentTeamId: teamId('t1'), opponentName: 'Rivals', record: { won: 2, lost: 1, tied: 0, noResult: 0 } },
          { opponentTeamId: teamId('t2'), opponentName: 'Others', record: { won: 0, lost: 3, tied: 1, noResult: 2 } },
        ],
      }),
    )
    const items = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual([
      'Rivals — won 2, lost 1, tied 0',
      'Others — won 0, lost 3, tied 1, 2 no result',
    ])
  })

  test('13. the accept-challenges switch renders only for the owner', () => {
    card(enabled(), { isOwner: false })
    expect(screen.queryByRole('switch')).toBeNull()
    cleanup()
    card(enabled(), { isOwner: true })
    expect(screen.queryByRole('switch', { name: 'Accept challenges' })).not.toBeNull()
  })

  test.each([
    { acceptsChallenges: true, checked: 'true', flipped: false },
    { acceptsChallenges: false, checked: 'false', flipped: true },
    // ABSENT MEANS ON: the schema field is optional and every older team lacks it.
    { acceptsChallenges: undefined, checked: 'true', flipped: false },
  ])(
    '13. acceptsChallenges=$acceptsChallenges shows checked=$checked and flips to $flipped',
    ({ acceptsChallenges, checked, flipped }) => {
      const onSetAcceptsChallenges = vi.fn()
      card(enabled(), { isOwner: true, acceptsChallenges, onSetAcceptsChallenges })
      const toggle = screen.getByRole('switch', { name: 'Accept challenges' })
      expect(toggle.getAttribute('aria-checked')).toBe(checked)
      fireEvent.click(toggle)
      expect(onSetAcceptsChallenges).toHaveBeenCalledExactlyOnceWith(flipped)
    },
  )

  // WHILE THE SWITCH'S MUTATION IS IN FLIGHT it does not move (it reads
  // getMyTeams), so a second click would resend the same value and the user's
  // toggle-back would be silently lost.
  test('13. the switch is disabled while its change is in flight', () => {
    const onSetAcceptsChallenges = vi.fn()
    card(enabled(), { isOwner: true, acceptsPending: true, onSetAcceptsChallenges })
    const toggle = screen.getByRole('switch', { name: 'Accept challenges' })
    expect(toggle.hasAttribute('disabled')).toBe(true)
    fireEvent.click(toggle)
    expect(onSetAcceptsChallenges).not.toHaveBeenCalled()
  })

  test('2. the card tells each scoreboard the viewer\'s day, so a window opening tomorrow reads "starts"', () => {
    const tomorrow = addDays(toPuzzleDay(new Date(NOW)), 1)
    card(enabled({ active: [anActive({ startDay: tomorrow })] }))
    expect(screen.queryByText(/^starts /)).not.toBeNull()
  })
})

describe('ChallengeNudge', () => {
  test('14. incoming: the line, linking to /team?team=<teamId>', () => {
    render(createElement(ChallengeNudge, { teamId: 'team-123', incoming: true }))
    const link = screen.getByRole('link', { name: 'Your team has been challenged' })
    expect(link.getAttribute('href')).toBe('/team?team=team-123')
  })

  test.each([false, undefined])('14. incoming=%s renders nothing', (incoming) => {
    const { container } = render(createElement(ChallengeNudge, { teamId: 'team-123', incoming }))
    expect(container.innerHTML).toBe('')
  })
})
