// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// renders the real component. `.hook.test.ts` matches the existing precedents,
// and `.test.ts` rather than `.test.tsx` because vitest.config.ts's glob is
// `src/**/*.test.ts`, so elements go through `createElement` by hand.
//
// WHY THIS FILE EXISTS: the dedupe below is invisible to every gate. Deleting
// the emitted-set guard type-checks, lints, builds and passes every other
// test — the card simply fires onboarding_view on every reactive invalidation
// and drowns the LogSnag channel, which is only observable in production.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type MouseEvent, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextStepCard } from './next-step-card.tsx'
import {
  GRADUATION_BODY,
  GRADUATION_CTA,
  GRADUATION_TITLE,
  MODEL_LINE,
  type OnboardingFacts,
} from '#/lib/onboarding-tasks.ts'

const sent: string[] = []

vi.mock('#/lib/funnel.ts', () => ({
  trackFunnel: (event: { name: string; tasks?: string; task?: string }) => {
    sent.push([event.name, event.tasks ?? event.task ?? ''].join(':'))
  },
  SIGNIN_PARAM: 'signin',
}))

// A plain anchor. The real Link needs a RouterProvider and nothing here is
// about routing — routes.test.ts and e2e own the destinations.
//
// `...rest` IS NOT OPTIONAL, for the reason no-team-card.hook.test.ts spells
// out: the CTA is `<Button asChild><Link/></Button>`, and asChild means Slot
// renders no element of its own and MERGES its props onto the child. A mock
// that destructures only `to` and `children` drops the merged className AND —
// far worse here — the onClick that carries onboarding_insights_click, so the
// click test would go green against a link that reports nothing.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    onClick,
    ...rest
  }: {
    to: string
    children?: ReactNode
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  }) =>
    createElement(
      'a',
      {
        href: to,
        ...rest,
        // PULLED OUT AND RE-ATTACHED RATHER THAN LEFT IN `rest`, so this mock
        // can do the one thing a real Link does that matters to a click test:
        // preventDefault. jsdom implements no navigation, so a bare anchor
        // click prints "Not implemented: navigation to another Document" from
        // jsdom itself on every run. The handler is still passed through
        // untouched, so a Slot merge that stopped delivering it still fails.
        onClick: (event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault()
          onClick?.(event)
        },
      },
      children,
    ),
}))

/** Board, team and invite all done — the state that used to render nothing. */
const graduated: OnboardingFacts = {
  enteredBoard: true,
  hasTeam: true,
  hasInvited: true,
  dismissed: false,
}

const nothing: OnboardingFacts = {
  enteredBoard: false,
  hasTeam: false,
  hasInvited: false,
  dismissed: false,
}

const noop = () => {}
const handlers = { onBoard: noop, onTeam: noop, onInvite: noop, onDismiss: noop }

beforeEach(() => {
  sent.length = 0
})
afterEach(cleanup)

describe('NextStepCard', () => {
  test('renders the two tasks a fresh signup owes, and the model line', () => {
    render(createElement(NextStepCard, { facts: nothing, ...handlers }))
    expect(screen.getByText("Enter today's board")).toBeTruthy()
    expect(screen.getByText('Create a team')).toBeTruthy()
    expect(screen.getByText(MODEL_LINE)).toBeTruthy()

    // AND NOT THE INVITE, WHICH IS THE DEAD END THIS RENDERS THE PROOF OF.
    // incompleteTasks gates 'invite' on hasTeam because /team redirects a
    // team-less player straight back to /app — so before that gate this button
    // was on screen, clickable, and did nothing but emit a funnel click that
    // could never convert. Asserted HERE as well as in onboarding-tasks.test.ts
    // because this is the level a reader checks when they ask "what does a new
    // signup actually see".
    expect(screen.queryByText('Invite someone')).toBeNull()
  })

  test('the invite task appears once a team exists', () => {
    // The other half of the gate: deferred, not deleted.
    render(createElement(NextStepCard, { facts: { ...nothing, hasTeam: true }, ...handlers }))
    expect(screen.getByText('Invite someone')).toBeTruthy()
    expect(screen.queryByText('Create a team')).toBeNull()
  })

  test('an invited joiner sees only the board task', () => {
    const joiner = { ...nothing, hasTeam: true, hasInvited: true }
    render(createElement(NextStepCard, { facts: joiner, ...handlers }))
    expect(screen.getByText("Enter today's board")).toBeTruthy()
    // Satisfied tasks VANISH rather than rendering as pre-checked busywork the
    // user did not do. This is the design's wording and its intent.
    expect(screen.queryByText('Create a team')).toBeNull()
    expect(screen.queryByText('Invite someone')).toBeNull()
  })

  test('graduates rather than vanishing once every task is complete', () => {
    // THIS TEST ASSERTED AN EMPTY CONTAINER UNTIL wordle-teams-wty4.1.14.6.
    // Rewritten, not deleted: the blank screen was the behaviour, and the
    // behaviour changed. What has NOT changed is the silence — see below.
    render(createElement(NextStepCard, { facts: graduated, ...handlers }))
    expect(screen.getByText(GRADUATION_TITLE)).toBeTruthy()
    expect(screen.getByText(GRADUATION_BODY)).toBeTruthy()
    const cta = screen.getByRole('link', { name: GRADUATION_CTA })
    expect(cta.getAttribute('href')).toBe('/insights')
    // AND NOT THE CHECKLIST. The two states are exclusive, and the model line
    // belongs to the one being replaced.
    expect(screen.queryByText(MODEL_LINE)).toBeNull()
    expect(screen.queryByText("Enter today's board")).toBeNull()
  })

  test('the graduation state emits NO onboarding_view — the funnel guard', () => {
    // THE LOAD-BEARING ASSERTION IN THIS FILE, and the reason the card's view
    // effect carries a `tasks.length === 0` test on top of `visible`.
    //
    // Until this card had a second state, `if (!visible) return` did this job
    // by accident: a finished player rendered nothing, so there was nothing to
    // report. Now they render a card, `visible` is true, and taskSetKey([]) is
    // '' — so without the guard EVERY ACTIVATED PLAYER emits an
    // `onboarding_view:` with an empty task set on EVERY /app mount. The
    // per-mount Set cannot save it (each mount is a fresh Set and a genuine
    // new view), and onboarding_view is the DENOMINATOR of the ratio
    // wordle-teams-456 is measured by. MUTATION-TESTED: deleting
    // `|| tasks.length === 0` from the effect turns this test red with
    // ['onboarding_view:'] — an empty task set, which is the exact signature
    // of the defect. It also reddens the CTA test below, which is collateral
    // rather than coverage: that one is about which event a click emits, and
    // it only notices because it asserts the WHOLE `sent` list.
    render(createElement(NextStepCard, { facts: graduated, ...handlers }))
    expect(sent.filter((entry) => entry.startsWith('onboarding_view'))).toEqual([])
    // Nothing at all, in fact — a render is not a click and not a dismissal.
    expect(sent).toEqual([])
  })

  test('the graduation CTA reports onboarding_insights_click, never a task click', () => {
    // A DISTINCT EVENT ON PURPOSE. Adding 'insights' to OnboardingTaskId and
    // reusing onboarding_task_click type-checks and reads fine, and it would
    // put a browse nudge aimed at ALREADY-ACTIVATED players inside the
    // activation click counts — clicks with no matching view, against a
    // denominator that (correctly) never counts this state.
    render(createElement(NextStepCard, { facts: graduated, ...handlers }))
    fireEvent.click(screen.getByRole('link', { name: GRADUATION_CTA }))
    expect(sent).toEqual(['onboarding_insights_click:'])
    expect(sent.filter((entry) => entry.startsWith('onboarding_task_click'))).toEqual([])
  })

  test('a graduated player can still dismiss the card, and it reports', () => {
    // ONE FLAG FOR BOTH STATES (shouldShowGraduation's comment). The control
    // and its label are shared with the checklist deliberately, because
    // app-menu's "Show getting started" is the only way back from either.
    const calls: string[] = []
    render(
      createElement(NextStepCard, {
        facts: graduated,
        ...handlers,
        onDismiss: () => calls.push('x'),
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss getting started' }))
    expect(calls).toEqual(['x'])
    expect(sent).toContain('onboarding_dismiss:')
  })

  test('renders nothing, and says nothing, for a dismissed graduate', () => {
    // THE OTHER HALF OF REUSING `dismissed`: the nudge is silenced by the same
    // gesture as the checklist. Without it this is the state EVERY activated
    // player is in forever, which is the one shape that could make this card a
    // permanent fixture rather than a one-time nod.
    const { container } = render(
      createElement(NextStepCard, { facts: { ...graduated, dismissed: true }, ...handlers }),
    )
    expect(container.textContent).toBe('')
    expect(sent).toEqual([])
  })

  test('renders nothing when dismissed', () => {
    const { container } = render(
      createElement(NextStepCard, { facts: { ...nothing, dismissed: true }, ...handlers }),
    )
    expect(container.textContent).toBe('')
    // As above: a dismissed player must be silent, not merely blank. Without
    // the effect's visibility gate this one emits the full task set forever.
    expect(sent).toEqual([])
  })

  test('emits onboarding_view once per task set, not once per render', () => {
    const { rerender } = render(createElement(NextStepCard, { facts: nothing, ...handlers }))
    rerender(createElement(NextStepCard, { facts: { ...nothing }, ...handlers }))
    rerender(createElement(NextStepCard, { facts: { ...nothing }, ...handlers }))
    expect(sent.filter((entry) => entry.startsWith('onboarding_view'))).toEqual([
      'onboarding_view:board,team',
    ])
  })

  test('emits again when the task set actually changes', () => {
    const { rerender } = render(createElement(NextStepCard, { facts: nothing, ...handlers }))
    rerender(createElement(NextStepCard, { facts: { ...nothing, hasTeam: true }, ...handlers }))
    expect(sent.filter((entry) => entry.startsWith('onboarding_view'))).toEqual([
      'onboarding_view:board,team',
      'onboarding_view:board,invite',
    ])
  })

  test('does not re-emit onboarding_view when an already-seen task set is re-entered', () => {
    // THIS is the test that actually pins the `reported` ref; the two above do
    // not. The effect's deps are [visible, key], both primitives, so React
    // already skips the effect on a rerender that leaves the task set alone —
    // delete the ref entirely and 'once per task set, not once per render'
    // still passes. The ref only earns its place when a set is RE-ENTERED, and
    // these facts do come back: an invite expires and hasInvited goes
    // true -> false, a team is deleted, a dismissal is undone. Without the ref
    // every such round trip puts another onboarding_view in the channel.
    const { rerender } = render(createElement(NextStepCard, { facts: nothing, ...handlers }))
    rerender(createElement(NextStepCard, { facts: { ...nothing, hasTeam: true }, ...handlers }))
    rerender(createElement(NextStepCard, { facts: { ...nothing }, ...handlers }))
    expect(sent.filter((entry) => entry.startsWith('onboarding_view'))).toEqual([
      'onboarding_view:board,team',
      'onboarding_view:board,invite',
    ])
  })

  test('does NOT emit onboarding_complete for someone who arrives already finished', () => {
    // Every activated player mounts this on every /app load with zero tasks.
    // Firing here would emit one completion per page view for the whole
    // activated population and destroy the metric this epic is measured by.
    const done = { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false }
    render(createElement(NextStepCard, { facts: done, ...handlers }))
    expect(sent.filter((entry) => entry.startsWith('onboarding_complete'))).toEqual([])
  })

  test('emits onboarding_complete once when the last task finishes', () => {
    const { rerender } = render(
      createElement(NextStepCard, {
        facts: { ...nothing, hasTeam: true, hasInvited: true },
        ...handlers,
      }),
    )
    rerender(
      createElement(NextStepCard, {
        facts: { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false },
        ...handlers,
      }),
    )
    expect(sent.filter((entry) => entry.startsWith('onboarding_complete'))).toEqual([
      'onboarding_complete:',
    ])
  })

  test('emits onboarding_complete once across a complete / un-complete / re-complete trip', () => {
    // THIS is the test that pins the `completed` latch; the one above does not.
    // The dep is [tasks.length] and that test rerenders into the zero-task
    // state exactly once, so React's memoization supplies the "once" on its
    // own — drop the latch and it still passes. The latch is for the round
    // trip, and these are the same facts coming back that the re-entry test
    // above lists: here the player finishes, deletes their team, and finishes
    // again. Without the latch that player is counted as activated twice, and
    // the activation number is the one thing this epic is measured by.
    const oneLeft = { ...nothing, hasTeam: true, hasInvited: true }
    const done = { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false }
    const { rerender } = render(createElement(NextStepCard, { facts: oneLeft, ...handlers }))
    rerender(createElement(NextStepCard, { facts: done, ...handlers }))
    rerender(createElement(NextStepCard, { facts: { ...done, hasTeam: false }, ...handlers }))
    rerender(createElement(NextStepCard, { facts: done, ...handlers }))
    expect(sent.filter((entry) => entry.startsWith('onboarding_complete'))).toEqual([
      'onboarding_complete:',
    ])
  })

  test('every task button reports its own id and calls its own handler', () => {
    // ALL THREE EDGES, because `Record<OnboardingTaskId, () => void>` makes the
    // KEYS exhaustive and says nothing about which callback each key holds.
    // Clicking only one button leaves the other edges of the map unpinned, and
    // swapping `board` and `team` in it — so that tapping "Enter today's board"
    // opens the Create Team dialog on the screen where signups already stall —
    // type-checks, lints and passes every other test.
    //
    // TWO RENDERS RATHER THAN ONE, and that is forced rather than stylistic:
    // since the invite task gained its hasTeam prerequisite, 'team' and
    // 'invite' cannot be on screen at the same time. Covering all three from a
    // single fixture is no longer possible, and dropping one of them to keep
    // one render would leave exactly the unpinned edge this test exists for.
    const calls: string[] = []
    const spies = {
      onBoard: () => calls.push('board'),
      onTeam: () => calls.push('team'),
      onInvite: () => calls.push('invite'),
      onDismiss: noop,
    }

    const teamless = render(createElement(NextStepCard, { facts: nothing, ...spies }))
    fireEvent.click(screen.getByRole('button', { name: /Enter today's board/ }))
    fireEvent.click(screen.getByRole('button', { name: /Create a team/ }))
    teamless.unmount()

    render(createElement(NextStepCard, { facts: { ...nothing, hasTeam: true }, ...spies }))
    fireEvent.click(screen.getByRole('button', { name: /Invite someone/ }))

    expect(calls).toEqual(['board', 'team', 'invite'])
    expect(sent.filter((entry) => entry.startsWith('onboarding_task_click'))).toEqual([
      'onboarding_task_click:board',
      'onboarding_task_click:team',
      'onboarding_task_click:invite',
    ])
  })

  test('dismiss reports and calls its handler', () => {
    const calls: string[] = []
    render(
      createElement(NextStepCard, { facts: nothing, ...handlers, onDismiss: () => calls.push('x') }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }))
    expect(calls).toEqual(['x'])
    expect(sent).toContain('onboarding_dismiss:')
  })
})
