// @vitest-environment jsdom
//
// THE PLAY PAGE'S WIRING (wordle-teams-9j7o.2.3.2.13). play-view.hook.test.ts
// covers what each state shows; this covers what the container SENDS: start
// once on open, the date the `today` query answered for, the clue count on
// screen, the scratch flushed before lock-in, and which failures are toasts.
//
// Mocked one layer down, at @convex-dev/react-query and useQuery, so the real
// useMutation, useScratchSaver and play view run. Each mutation is keyed by the
// function's own name, so repointing a call at the wrong function fails here.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { api } from '../../../convex/_generated/api'
import type { Order } from '../../../convex/lib/clueLadder/orders.ts'
import { ClueLadderPlayPage } from './play-page.tsx'
import type { ClueLadderTodayView } from './today.ts'

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const { calls, mutations, toastError, toastSuccess, queryArgs } = vi.hoisted(() => ({
  /** Every mutation call in order, as [name, args]. */
  calls: [] as Array<[string, unknown]>,
  mutations: new Map<string, (args: unknown) => Promise<unknown>>(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  queryArgs: [] as unknown[],
}))

/** What `api.clueLadder.today` answers this render; undefined is in flight. */
let answer: { enabled: false } | { enabled: true; play: ClueLadderTodayView } | undefined

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
  useConvexMutation: (ref: FunctionReference<'mutation'>) => {
    const name = getFunctionName(ref)
    return (args: unknown) => {
      calls.push([name, args])
      const impl = mutations.get(name)
      if (!impl) throw new Error(`the play page called an unexpected mutation: ${name}`)
      return impl(args)
    }
  },
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
      if (queryKey[0] !== getFunctionName(api.clueLadder.today)) {
        throw new Error(`the play page asked for an unexpected query: ${queryKey[0]}`)
      }
      queryArgs.push(queryKey[1])
      return { data: queryKey[1] === 'skip' ? undefined : answer }
    },
  }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, search, children }: { to: string; search?: unknown; children?: ReactNode }) =>
    createElement('a', { href: to, 'data-search': JSON.stringify(search ?? null) }, children),
}))

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))

const START = getFunctionName(api.clueLadder.start)
const NEXT = getFunctionName(api.clueLadder.nextClue)
const SAVE = getFunctionName(api.clueLadder.saveScratch)
const LOCK = getFunctionName(api.clueLadder.lockIn)

const ok = () => Promise.resolve(null)
const order: Order = ['star', 'circle', 'square', 'triangle', 'diamond']

/** The client's own clock reads this day. */
const CLIENT_DAY = '2026-10-20'
/** The day `today` answered for: the server's, when the client's was implausible. */
const SERVER_DAY = '2026-10-17'

const playing = (over: Partial<Extract<ClueLadderTodayView, { status: 'playing' }>> = {}): ClueLadderTodayView => ({
  status: 'playing',
  date: SERVER_DAY,
  cluesRevealed: 2,
  clues: ['The triangle is at one end.', 'The circle is not in the third slot.'],
  scratch: [...order],
  ...over,
})
const solved: ClueLadderTodayView = {
  status: 'solved',
  date: SERVER_DAY,
  cluesRevealed: 2,
  clues: ['The triangle is at one end.', 'The circle is not in the third slot.'],
  scratch: [...order],
  lockedAtClue: 2,
  lockedOrder: [...order],
  answer: [...order],
  remaining: [24, 1],
  possibleAtLockIn: [order],
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12))
  calls.length = 0
  queryArgs.length = 0
  mutations.clear()
  for (const name of [START, NEXT, SAVE, LOCK]) mutations.set(name, ok)
  mutations.set(NEXT, () => Promise.resolve({ noMoreClues: false, cluesRevealed: 3 }))
  toastError.mockReset()
  toastSuccess.mockReset()
  answer = undefined
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function page(team?: string) {
  const client = new QueryClient()
  const tree = () => createElement(QueryClientProvider, { client }, createElement(ClueLadderPlayPage, { team }))
  const { rerender } = render(tree())
  return { rerender: () => rerender(tree()) }
}

const callsTo = (name: string) => calls.filter(([n]) => n === name).map(([, args]) => args)
const lockInButton = () => screen.getByRole('button', { name: 'Lock in' }) as HTMLButtonElement
const confirmButton = () => screen.getByRole('button', { name: 'Yes, lock in' }) as HTMLButtonElement

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ClueLadderPlayPage: the query', () => {
  test('asks for today with the client’s own day', () => {
    answer = { enabled: true, play: playing() }
    page()
    expect(queryArgs).toContainEqual({ today: CLIENT_DAY })
  })
})

describe('ClueLadderPlayPage: opening the page starts the game', () => {
  test('start is called once, with the day `today` answered for', async () => {
    answer = { enabled: true, play: { status: 'not-started', date: SERVER_DAY } }
    page()
    await waitFor(() => expect(callsTo(START)).toHaveLength(1))
    expect(callsTo(START)).toEqual([{ today: SERVER_DAY }])
  })

  test('re-renders, a re-sent answer and a re-subscribe do not start it again', async () => {
    answer = { enabled: true, play: { status: 'not-started', date: SERVER_DAY } }
    const p = page()
    await waitFor(() => expect(callsTo(START)).toHaveLength(1))
    answer = { enabled: true, play: { status: 'not-started', date: SERVER_DAY } }
    p.rerender()
    p.rerender()
    // The subscription drops (a reconnect) and comes back still not started.
    answer = undefined
    p.rerender()
    answer = { enabled: true, play: { status: 'not-started', date: SERVER_DAY } }
    p.rerender()
    await Promise.resolve()
    expect(callsTo(START)).toHaveLength(1)
  })

  test('a game already under way is not started', async () => {
    answer = { enabled: true, play: playing() }
    page()
    await Promise.resolve()
    expect(callsTo(START)).toEqual([])
  })

  test('a failed start is a toast through mutationErrorMessage', async () => {
    const error = new ConvexError({ code: 'CLUE_LADDER_DISABLED' })
    mutations.set(START, () => Promise.reject(error))
    answer = { enabled: true, play: { status: 'not-started', date: SERVER_DAY } }
    page()
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledExactlyOnceWith(
        mutationErrorMessage(error, "Couldn't start today's clue ladder."),
      ),
    )
    expect(toastError.mock.calls[0][0]).not.toBe("Couldn't start today's clue ladder.")
  })
})

describe('ClueLadderPlayPage: Next clue', () => {
  test('sends the day `today` answered for and the clue count on screen', async () => {
    answer = { enabled: true, play: playing({ cluesRevealed: 2 }) }
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Next clue' }))
    await waitFor(() => expect(callsTo(NEXT)).toEqual([{ today: SERVER_DAY, expectedRevealed: 2 }]))
  })

  test('Next clue is off while its call is in flight, so a double tap sends one', async () => {
    const next = deferred()
    mutations.set(NEXT, () => next.promise)
    answer = { enabled: true, play: playing() }
    page()
    const button = () => screen.getByRole('button', { name: 'Next clue' }) as HTMLButtonElement
    fireEvent.click(button())
    await waitFor(() => expect(button().disabled).toBe(true))
    fireEvent.click(button())
    expect(callsTo(NEXT)).toHaveLength(1)
    next.resolve({ noMoreClues: false, cluesRevealed: 3 })
    await waitFor(() => expect(button().disabled).toBe(false))
  })

  test('no more clues turns Next clue off', async () => {
    mutations.set(NEXT, () => Promise.resolve({ noMoreClues: true }))
    answer = { enabled: true, play: playing() }
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Next clue' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next clue' }) as HTMLButtonElement).disabled).toBe(true),
    )
  })

  test('a failure is a toast through mutationErrorMessage', async () => {
    const error = new ConvexError({ code: 'ALREADY_FINISHED' })
    mutations.set(NEXT, () => Promise.reject(error))
    answer = { enabled: true, play: playing() }
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Next clue' }))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledExactlyOnceWith(mutationErrorMessage(error, "Couldn't show the next clue.")),
    )
  })
})

describe('ClueLadderPlayPage: the board and Lock in', () => {
  /** Takes the star out of slot 1 and puts it back: one local change, the same full board. */
  function moveStar() {
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1, star' }))
    fireEvent.click(screen.getByRole('button', { name: 'star' }))
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1, empty' }))
  }

  function confirmLockIn() {
    fireEvent.click(lockInButton())
    fireEvent.click(confirmButton())
  }

  test('the waiting scratch is saved, with the day `today` answered for, before lockIn is sent', async () => {
    const save = deferred()
    mutations.set(SAVE, () => save.promise)
    answer = { enabled: true, play: playing() }
    page()
    moveStar()
    confirmLockIn()
    await waitFor(() => expect(callsTo(SAVE)).toHaveLength(1))
    expect(callsTo(SAVE)).toEqual([{ today: SERVER_DAY, scratch: order }])
    // lockIn waits for the save to settle.
    await Promise.resolve()
    expect(callsTo(LOCK)).toEqual([])
    save.resolve(null)
    await waitFor(() => expect(callsTo(LOCK)).toEqual([{ today: SERVER_DAY, order }]))
    expect(calls.map(([name]) => name)).toEqual([SAVE, LOCK])
  })

  test('confirm is off from the click until lockIn settles, so a double tap sends one lockIn', async () => {
    const save = deferred()
    const lock = deferred()
    mutations.set(SAVE, () => save.promise)
    mutations.set(LOCK, () => lock.promise)
    answer = { enabled: true, play: playing() }
    page()
    moveStar()
    confirmLockIn()
    // Still flushing the scratch: lockIn has not been sent, and the confirm is already off.
    await waitFor(() => expect(confirmButton().disabled).toBe(true))
    fireEvent.click(confirmButton())
    save.resolve(null)
    await waitFor(() => expect(callsTo(LOCK)).toHaveLength(1))
    expect(confirmButton().disabled).toBe(true)
    fireEvent.click(confirmButton())
    await Promise.resolve()
    expect(callsTo(LOCK)).toHaveLength(1)
    lock.resolve({ status: 'solved', lockedAtClue: 2 })
    await waitFor(() => expect(confirmButton().disabled).toBe(false))
  })

  test('ALREADY_FINISHED from lockIn is not an error: an earlier tap already locked in', async () => {
    mutations.set(LOCK, () => Promise.reject(new ConvexError({ code: 'ALREADY_FINISHED' })))
    answer = { enabled: true, play: playing() }
    page()
    confirmLockIn()
    await waitFor(() => expect(callsTo(LOCK)).toHaveLength(1))
    await waitFor(() => expect(confirmButton().disabled).toBe(false))
    expect(toastError).not.toHaveBeenCalled()
  })

  test('any other lockIn failure is a toast through mutationErrorMessage', async () => {
    const error = new ConvexError({ code: 'INVALID_ORDER' })
    mutations.set(LOCK, () => Promise.reject(error))
    answer = { enabled: true, play: playing() }
    page()
    confirmLockIn()
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledExactlyOnceWith(mutationErrorMessage(error, "Couldn't lock in. Try again.")),
    )
  })

  test('a plain failure gets the fallback copy', async () => {
    mutations.set(LOCK, () => Promise.reject(new Error('network')))
    answer = { enabled: true, play: playing() }
    page()
    confirmLockIn()
    await waitFor(() => expect(toastError).toHaveBeenCalledExactlyOnceWith("Couldn't lock in. Try again."))
  })
})

describe('ClueLadderPlayPage: off, and the way back', () => {
  test('nothing loads before `today` answers', () => {
    page()
    expect(screen.queryByRole('button', { name: 'Lock in' })).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  test('off, or on none of the player’s teams: says so, starts nothing, and goes back to the same team', async () => {
    answer = { enabled: false }
    page('team-a')
    expect(screen.getByText("The clue ladder isn't on for any of your teams.")).toBeTruthy()
    const back = screen.getByRole('link', { name: 'Back to team scores' })
    expect(back.getAttribute('href')).toBe('/app')
    expect(back.dataset.search).toBe(JSON.stringify({ team: 'team-a' }))
    await Promise.resolve()
    expect(calls).toEqual([])
  })

  test('finished: the back link under the result keeps the team', () => {
    answer = { enabled: true, play: solved }
    page('team-b')
    const back = screen.getByRole('link', { name: 'Back to team scores' })
    expect(back.dataset.search).toBe(JSON.stringify({ team: 'team-b' }))
  })
})
