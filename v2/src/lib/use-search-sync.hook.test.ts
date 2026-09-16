// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts): driving a real
// hook through @testing-library/react needs a DOM to mount into, and this one
// reads and writes localStorage. `.hook.test.ts` matches the precedents beside
// it, and `.test.ts` rather than `.test.tsx` because vitest.config.ts's glob is
// `src/**/*.test.ts`.
//
// WHAT THIS REPLACES (wordle-teams-1ubk). These properties lived inside
// InsightsRoute and Dashboard, neither of which is exported or renderable under
// vitest, so routes/-insights.hook.test.ts held three of them as
// `expect(routeCode).toContain(...)` over the route's text — and spent a
// paragraph explaining why it had to. Source-text matchers pin the TEXT: rename
// a local and they fail for nothing; restructure the effect and they pass while
// the property is gone. Everything below is behaviour.
//
// WHAT THE RESOLVERS ALREADY OWN, and is deliberately not repeated here:
// dashboard-search.test.ts and insights-search.test.ts cover WHICH team and
// month get chosen, including the idempotence that keeps this effect from
// looping. This file is about the effect around them — when it runs, what it is
// handed, and what it writes.
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { STORAGE_KEY } from './dashboard-search.ts'
import { useSearchSync } from './use-search-sync.ts'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'

/**
 * A localStorage this file fully controls.
 *
 * jsdom's own is shared across tests in a worker and, in this environment,
 * arrives without a usable `clear` — app-menu.hook.test.ts stubs the same shape
 * for the same reason. A fresh Map per test also means no test can see a key
 * another one wrote, which matters here because the subject IS what gets
 * written.
 */
function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  } as Storage
}

afterEach(cleanup)
beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

const TEAMS = [{ id: 'team_a' }, { id: 'team_b' }]

/**
 * Mounts the hook and reports every resolver input and every navigation.
 *
 * THE RESOLVER IS A SPY THAT RECORDS AND RETURNS WHAT IT IS TOLD, rather than a
 * real one: what is under test here is what the effect HANDS a resolver and what
 * it does with the answer. Feeding it a real resolver would make every assertion
 * below depend on that resolver's rules as well, which have their own tests.
 *
 * IT IS DECLARED OUTSIDE THE HOOK CALL, so its identity is stable across
 * renders — the same requirement the real call sites meet by passing
 * module-level functions, and the thing `navigate` below is really about.
 */
const mount = (
  options: {
    teamParam?: string
    monthParam?: string
    teams?: Array<{ id: string; createdAt?: number }>
    answer?: { team: string; month: string } | null
  } = {},
) => {
  const seen: Array<Record<string, unknown>> = []
  const went: Array<unknown> = []
  const answer: { team: string; month: string } | null =
    'answer' in options ? (options.answer ?? null) : { team: 'team_a', month: '2026-09' }
  const resolve = (input: Record<string, unknown>) => {
    seen.push(input)
    return answer
  }
  const navigate = (o: unknown) => went.push(o)
  const view = renderHook(() =>
    useSearchSync({
      teamParam: options.teamParam,
      monthParam: options.monthParam,
      teams: 'teams' in options ? options.teams : TEAMS,
      resolve,
      navigate,
      to: '/app',
    }),
  )
  return { seen, went, view }
}

describe('when the effect runs', () => {
  test('navigates once the resolver asks for it', () => {
    const { went } = mount({ teamParam: undefined, monthParam: undefined })
    expect(went).toEqual([{ to: '/app', search: { team: 'team_a', month: '2026-09' }, replace: true }])
  })

  test('REPLACES rather than pushes, because nobody asked to come here', () => {
    // The effect's navigations are corrections. Pushing them would make Back a
    // trap: the reader would land on the URL the effect just corrected and be
    // corrected forward again. The controls' own navigations DO push, and that
    // asymmetry is stated at the call sites.
    const { went } = mount()
    expect((went[0] as { replace: boolean }).replace).toBe(true)
  })

  test('does nothing at all when the resolver returns null', () => {
    // Null is "the URL is already right", which is the steady state on every
    // render after the first. A navigate here would be the infinite redirect
    // the resolvers' idempotence tests exist to prevent.
    const { went } = mount({ answer: null })
    expect(went).toEqual([])
  })
})

describe('what the resolver is handed', () => {
  test('the current month, from the BROWSER’s clock rather than the server’s', () => {
    // wordle-teams-uc5. The fallback month has to come from the viewer's local
    // clock: reading it in UTC makes the server and the client disagree on the
    // first and last days of a month. `monthOf(toPuzzleDay(new Date()))` is the
    // same expression the hook uses, and toPuzzleDay deliberately reads the
    // LOCAL date getters — so this compares against the browser's answer, not a
    // literal that would drift.
    const { seen } = mount()
    expect(seen[0].currentMonth).toBe(monthOf(toPuzzleDay(new Date())))
  })

  test('the remembered team, read out of localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'team_b')
    const { seen } = mount()
    expect(seen[0].storedTeam).toBe('team_b')
  })

  test('null for storedTeam when nothing is remembered, never undefined', () => {
    // The resolvers compare `storedTeam` against team ids and rely on a miss
    // simply failing to match; `getItem` returns null and that is the contract
    // they are written against.
    const { seen } = mount()
    expect(seen[0].storedTeam).toBeNull()
  })

  test('an empty array while the roster is still in flight, not undefined', () => {
    // `teams ?? []` RATHER THAN AN EARLY RETURN: with nothing to select the
    // resolver returns null, which is exactly the "do nothing" an early return
    // would produce, and the resolvers are typed for an array.
    const { seen } = mount({ teams: undefined })
    expect(seen[0].teams).toEqual([])
  })

  test('the params as they stand, undefined included', () => {
    const { seen } = mount({ teamParam: 'team_b', monthParam: undefined })
    expect(seen[0].teamParam).toBe('team_b')
    expect(seen[0].monthParam).toBeUndefined()
  })
})

describe('the remembered team', () => {
  test('is written from `?team=`', () => {
    mount({ teamParam: 'team_b' })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('team_b')
  })

  test('is NOT cleared when the param is absent', () => {
    // A missing param is the state on first load, before the effect above has
    // filled it in. Clearing here would throw away the very value that load is
    // about to select from.
    localStorage.setItem(STORAGE_KEY, 'team_b')
    mount({ teamParam: undefined })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('team_b')
  })

  test('is written even for a param naming no team the viewer has', () => {
    // NOT CONDITIONAL ON VALIDITY, and deliberately so: a stale or foreign
    // `?team=` is written for the render or two before the effect replaces it.
    // Harmless, because every reader re-validates against the roster before
    // selecting anything — so a value nobody can use is inert.
    mount({ teamParam: 'not_a_team_of_mine' })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('not_a_team_of_mine')
  })
})

describe('the effect does not re-run on every render', () => {
  /*
    THE TRAP wordle-teams-1ubk EXISTED TO FIX RATHER THAN TO SPREAD.

    routes/app.tsx used to pass `navigate: (search) => void navigate({ ... })` —
    a FRESH FUNCTION on every render, sitting in this effect's dependency array,
    so the sync effect re-ran on every render of the dashboard. /insights never
    had the flaw, because it passed useNavigate's own result, which is
    useCallback-stable.

    A generalised hook that kept the closure shape would have handed the flaw to
    /insights instead of taking it off /app. So the hook takes the stable
    function plus a `to` and builds the argument itself — and this is the test
    that says so, by re-rendering with everything unchanged and counting.
  */
  test('a re-render with the same inputs resolves once, not twice', () => {
    const { seen, view } = mount({ teamParam: 'team_a', monthParam: '2026-09' })
    expect(seen).toHaveLength(1)
    view.rerender()
    view.rerender()
    expect(seen).toHaveLength(1)
  })

  test('and still once while the roster is UNDEFINED, which is the fresh-array trap', () => {
    // THE CASE THE TEST ABOVE CANNOT SEE, and it is the one the hook's own
    // comment warns about: `teams ?? []` in the DEPENDENCY ARRAY is a fresh
    // array on every render — but only when `teams` is undefined, because
    // otherwise `??` hands back the very same reference. So a resolved roster
    // makes that mutant invisible, and the in-flight one is what catches it.
    // Planted and confirmed: moving `teams ?? []` into the deps fails here and
    // nowhere else.
    const { seen, view } = mount({ teams: undefined, answer: null })
    expect(seen).toHaveLength(1)
    view.rerender()
    view.rerender()
    expect(seen).toHaveLength(1)
  })

  test('and it DOES re-run when a param actually moves', () => {
    // The other half: an effect that never re-ran would pass the test above just
    // as well and would stop correcting the URL entirely.
    const seen: Array<Record<string, unknown>> = []
    const resolve = (input: Record<string, unknown>) => {
      seen.push(input)
      return null
    }
    const navigate = () => undefined
    const view = renderHook(
      ({ month }: { month: string }) =>
        useSearchSync({
          teamParam: 'team_a',
          monthParam: month,
          teams: TEAMS,
          resolve,
          navigate,
          to: '/app',
        }),
      { initialProps: { month: '2026-09' } },
    )
    expect(seen).toHaveLength(1)
    view.rerender({ month: '2026-08' })
    expect(seen).toHaveLength(2)
    expect(seen[1].monthParam).toBe('2026-08')
  })
})

describe('hydration', () => {
  /*
    THE CLOCK IS READ IN AN EFFECT, WHICH IS THE WHOLE POINT. useHydrated is
    false on the first render and flips in its own effect, so under
    @testing-library/react — which wraps renders in `act` and flushes effects —
    both passes have run by the time these assertions look. That makes "waits for
    hydration" hard to observe from the outside, and the assertion below is the
    honest version of it: the resolver is called ONCE, not twice, which is what a
    guard that lets the pre-hydration pass through would break.

    IT IS NOT A SUBSTITUTE FOR READING THE HOOK. What the guard really prevents
    is an SSR render reading `new Date()` at all; jsdom has no server pass to
    exercise. The rule is stated in one place now (this hook's header) and
    routes/team.tsx's effect states the contrast — it reads localStorage and
    never the clock, so it needs no guard.
  */
  test('the pre-hydration pass does not reach the resolver', () => {
    const { seen } = mount()
    expect(seen).toHaveLength(1)
  })
})
