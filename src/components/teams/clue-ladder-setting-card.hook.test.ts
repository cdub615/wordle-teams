// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { mutationErrorMessage } from '#/lib/convex-error.ts'

let switchOn = true
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
    return { data: { enabled: switchOn } }
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
    fireEvent.click(screen.getByRole('switch', { name: 'Clue ladder' }))
    expect(mutate.mock.calls[0][0]).toEqual({ teamId, enabled: true })
    expect(mutationRefs).toContain(getFunctionName(api.games.setTeamClueLadder))
  })

  test('the owner can switch it off', () => {
    render(createElement(ClueLadderSettingCard, { teamId, isOwner: true, enabled: true }))
    expect(screen.getByRole('switch', { name: 'Clue ladder' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch', { name: 'Clue ladder' }))
    expect(mutate.mock.calls[0][0]).toEqual({ teamId, enabled: false })
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
})
