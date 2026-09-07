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
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextStepCard } from './next-step-card.tsx'
import { MODEL_LINE, type OnboardingFacts } from '#/lib/onboarding-tasks.ts'

const sent: string[] = []

vi.mock('#/lib/funnel.ts', () => ({
  trackFunnel: (event: { name: string; tasks?: string; task?: string }) => {
    sent.push([event.name, event.tasks ?? event.task ?? ''].join(':'))
  },
  SIGNIN_PARAM: 'signin',
}))

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
  test('renders all three tasks and the model line for a fresh signup', () => {
    render(createElement(NextStepCard, { facts: nothing, ...handlers }))
    expect(screen.getByText("Enter today's board")).toBeTruthy()
    expect(screen.getByText('Create a team')).toBeTruthy()
    expect(screen.getByText('Invite someone')).toBeTruthy()
    expect(screen.getByText(MODEL_LINE)).toBeTruthy()
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

  test('renders nothing once every task is complete', () => {
    const done = { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false }
    const { container } = render(createElement(NextStepCard, { facts: done, ...handlers }))
    expect(container.textContent).toBe('')
    // SILENCE IS THE OTHER HALF, and textContent alone does not assert it: the
    // blank screen comes from `if (!visible) return null` in the render path,
    // so deleting the effect's own `if (!visible) return` leaves this passing
    // while every activated player emits `onboarding_view:` on every /app load.
    // That empty `tasks` is also exactly the empty-string key taskSetKey's doc
    // comment warns callers about.
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
      'onboarding_view:board,team,invite',
    ])
  })

  test('emits again when the task set actually changes', () => {
    const { rerender } = render(createElement(NextStepCard, { facts: nothing, ...handlers }))
    rerender(createElement(NextStepCard, { facts: { ...nothing, hasTeam: true }, ...handlers }))
    expect(sent.filter((entry) => entry.startsWith('onboarding_view'))).toEqual([
      'onboarding_view:board,team,invite',
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
      'onboarding_view:board,team,invite',
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
    // ALL THREE, because `Record<OnboardingTaskId, () => void>` makes the KEYS
    // exhaustive and says nothing about which callback each key holds. Clicking
    // only one button leaves the other two edges of the map unpinned, and
    // swapping `board` and `team` in it — so that tapping "Enter today's board"
    // opens the Create Team dialog on the screen where signups already stall —
    // type-checks, lints and passes every other test.
    const calls: string[] = []
    render(
      createElement(NextStepCard, {
        facts: nothing,
        onBoard: () => calls.push('board'),
        onTeam: () => calls.push('team'),
        onInvite: () => calls.push('invite'),
        onDismiss: noop,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Enter today's board/ }))
    fireEvent.click(screen.getByRole('button', { name: /Create a team/ }))
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
