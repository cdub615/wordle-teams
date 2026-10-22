// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'

let switchOn: boolean | undefined = true
let pending = false
const mutate = vi.fn()
const toastError = vi.fn()
const mutationRefs: string[] = []

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
  useConvexMutation: (ref: FunctionReference<'mutation'>) => {
    mutationRefs.push(getFunctionName(ref))
    return vi.fn()
  },
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    if (queryKey[0] !== getFunctionName(api.games.clueLadderSwitch)) throw new Error(`unexpected ${queryKey[0]}`)
    return { data: switchOn === undefined ? undefined : { enabled: switchOn } }
  },
  useMutation: () => ({ mutate, isPending: pending }),
}))
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))

const { ClueLadderSettingCard } = await import('./clue-ladder-setting-card.tsx')

afterEach(cleanup)
beforeEach(() => {
  switchOn = true
  pending = false
  mutate.mockReset()
  toastError.mockReset()
  mutationRefs.length = 0
})

const teamId = 't' as Id<'teams'>

describe('ClueLadderSettingCard', () => {
  test('the owner can switch it on', () => {
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: false }))
    const today = toPuzzleDay(new Date())
    fireEvent.click(screen.getByRole('switch', { name: 'Clue ladder' }))
    expect(mutate.mock.calls[0][0]).toEqual({ teamId, enabled: true, today })
    expect(mutationRefs).toContain(getFunctionName(api.games.setTeamClueLadder))
  })

  test('the owner can switch it off', () => {
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: true }))
    expect(screen.getByRole('switch', { name: 'Clue ladder' }).getAttribute('aria-checked')).toBe('true')
    const today = toPuzzleDay(new Date())
    fireEvent.click(screen.getByRole('switch', { name: 'Clue ladder' }))
    expect(mutate.mock.calls[0][0]).toEqual({ teamId, enabled: false, today })
  })

  test('a member sees nothing', () => {
    const { container } = render(createElement(ClueLadderSettingCard, { teamId, isOwner: false, enabled: true }))
    expect(container.innerHTML).toBe('')
  })

  test('nothing shows while the deployment switch is off', () => {
    switchOn = false
    const { container } = render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: false }))
    expect(container.innerHTML).toBe('')
  })

  test('nothing shows while the deployment switch is still loading', () => {
    switchOn = undefined
    const { container } = render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: false }))
    expect(container.innerHTML).toBe('')
  })

  test('the card is a Games region with a heading, and the switch is described by the help text', () => {
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: false }))
    expect(screen.getByRole('region', { name: 'Games' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Games' })).toBeTruthy()
    const sw = screen.getByRole('switch', { name: 'Clue ladder' })
    expect(sw.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByRole('switch', { description: /Scores are kept\./ })).toBe(sw)
  })

  test('the switch is disabled while a change is in flight', () => {
    pending = true
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: false }))
    expect((screen.getByRole('switch', { name: 'Clue ladder' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('a failed change toasts the error text', () => {
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: false }))
    fireEvent.click(screen.getByRole('switch', { name: 'Clue ladder' }))
    const { onError } = mutate.mock.calls[0][1] as { onError: (e: unknown) => void }
    const error = new ConvexError({ code: 'NOT_TEAM_OWNER' })
    const expected = mutationErrorMessage(error, 'Could not change that setting')
    expect(expected).not.toBe(mutationErrorMessage(new Error('x'), 'Could not change that setting'))
    onError(error)
    expect(toastError).toHaveBeenCalledWith(expected)
  })

  test('the help text says days before it was on are not missed days', () => {
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: false }))
    expect(screen.getByRole('switch', { description: /days before that don't count as missed\./ })).toBeTruthy()
  })

  test('the help text says it is on for every team unless turned off (wordle-teams-9j7o.2.11)', () => {
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: true }))
    expect(screen.getByRole('switch', { description: /It's on for every team unless you turn it off\./ })).toBeTruthy()
  })
})
