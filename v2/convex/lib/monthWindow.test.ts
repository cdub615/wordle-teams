import { describe, expect, test } from 'vitest'
import { FREE_MONTHS, monthWindowFor, proTeaserMonth, serverFloorFor } from './monthWindow.ts'

describe('monthWindowFor — free', () => {
  test('is the current month and the two before it, newest first', () => {
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: false })).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
    ])
  })

  test('walks back across a year boundary', () => {
    expect(monthWindowFor({ currentMonth: '2026-01', earliestMonth: null, pro: false })).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ])
  })

  test('ignores earliestMonth entirely — a free window does not depend on the team', () => {
    // A MUTATION GUARD, not a restatement. If the free branch ever starts
    // consulting earliestMonth, a team younger than three months would silently
    // get a shorter list than every other team, and nothing else here would say so.
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: '2026-08', pro: false })).toEqual(
      monthWindowFor({ currentMonth: '2026-08', earliestMonth: '2019-01', pro: false }),
    )
  })
})

describe('monthWindowFor — pro', () => {
  test('spans earliestMonth through currentMonth inclusive, newest first', () => {
    expect(monthWindowFor({ currentMonth: '2026-03', earliestMonth: '2025-12', pro: true })).toEqual([
      '2026-03',
      '2026-02',
      '2026-01',
      '2025-12',
    ])
  })

  test('is uncapped in practice — a team dating to 2023 reaches 2023', () => {
    // THE POINT OF THE WHOLE FEATURE. insights-months.ts caps its own window at
    // twelve so it can render without scroll math; this one must not, because a
    // cap is exactly the regression a migrating v1 Pro subscriber would feel.
    const months = monthWindowFor({ currentMonth: '2026-09', earliestMonth: '2023-03', pro: true })

    expect(months).toHaveLength(43)
    expect(months[months.length - 1]).toBe('2023-03')
  })

  test('IS NEVER NARROWER THAN THE FREE WINDOW', () => {
    // THE REGRESSION THIS WHOLE SPEC EXISTS TO CLOSE, REINTRODUCED INSIDE IT.
    // Without the max(FREE_MONTHS, span) floor, a team younger than three months
    // gives its PRO owner a one- or two-row dropdown while the FREE members
    // beside them still get three — so upgrading visibly REMOVES months. Every
    // team created during the launch window this work is aimed at is in range.
    // The first draft of this file asserted the broken behaviour as correct.
    for (const earliestMonth of [null, '2026-08', '2026-07', '2026-06', '2026-05']) {
      const pro = monthWindowFor({ currentMonth: '2026-08', earliestMonth, pro: true })
      const free = monthWindowFor({ currentMonth: '2026-08', earliestMonth, pro: false })

      expect(pro.length).toBeGreaterThanOrEqual(free.length)
      expect(pro.length).toBeGreaterThanOrEqual(FREE_MONTHS)
    }
  })

  test('with no boards at all, is still the free window', () => {
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: null, pro: true })).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
    ])
  })

  test('clamps an earliestMonth in the future rather than producing a negative span', () => {
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: '2026-11', pro: true })).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
    ])
  })

  test('survives a malformed earliestMonth without producing an empty window', () => {
    // upsertBoard TAKES puzzleDay AS A BARE v.string() AND VALIDATES NOTHING
    // (wordle-teams-qvqi), so '' is a storable puzzle day and monthOf('') is ''.
    // That makes the span NaN, Array.from({length: NaN}) returns [], and the
    // element-0 invariant below is violated for a REACHABLE input — with
    // serverFloorFor then reading months[-1] and throwing inside getTeamMonth,
    // taking the dashboard down for every Pro member of the team rather than for
    // the author. The cause is filed separately; this is the blast shield.
    for (const earliestMonth of ['', '1', 'x', '2026', 'not-a-month']) {
      const months = monthWindowFor({ currentMonth: '2026-08', earliestMonth, pro: true })

      expect(months.length).toBeGreaterThanOrEqual(FREE_MONTHS)
      expect(months[0]).toBe('2026-08')
    }
  })

  test('caps an absurdly old earliestMonth rather than building a 12,000-entry list', () => {
    const months = monthWindowFor({ currentMonth: '2026-08', earliestMonth: '1000-01', pro: true })

    expect(months.length).toBeLessThanOrEqual(120)
    expect(months[0]).toBe('2026-08')
  })
})

describe('the element-0 invariant', () => {
  // DO NOT BREAK THIS. dashboard-months.ts falls back to element 0 for an
  // out-of-window ?month=, and that fallback settles — rather than the effect
  // behind it navigating forever — only because the fallback value is itself
  // always a member of the window it is judged against. insights-months.ts
  // records the identical property for resolveInsightsSearch, in the same words.
  const inputs = [
    { currentMonth: '2026-08', earliestMonth: null, pro: false },
    { currentMonth: '2026-08', earliestMonth: null, pro: true },
    { currentMonth: '2026-08', earliestMonth: '2023-03', pro: true },
    { currentMonth: '2026-08', earliestMonth: '2026-08', pro: true },
    { currentMonth: '2026-08', earliestMonth: '2099-01', pro: true },
    { currentMonth: '2026-08', earliestMonth: '', pro: true },
    { currentMonth: '2026-01', earliestMonth: '2025-11', pro: false },
  ]

  test.each(inputs)('currentMonth is element 0, and the window is never empty, for %j', (input) => {
    const months = monthWindowFor(input)

    expect(months.length).toBeGreaterThan(0)
    expect(months[0]).toBe(input.currentMonth)
  })

  test.each(inputs)('the window is STRICTLY descending for %j', (input) => {
    const months = monthWindowFor(input)

    // STRICTLY, WHICH THE SORT COMPARISON ALONE DOES NOT PROVE.
    // `[...months].sort().reverse()` is satisfied by a non-increasing list, so
    // ['2026-08','2026-08','2026-06'] passes it while a duplicated month would
    // give the dropdown two identical rows and a radio group two items with one
    // value. The uniqueness check is what makes the word "strictly" true.
    expect([...months].sort().reverse()).toEqual(months)
    expect(new Set(months).size).toBe(months.length)
  })
})

describe('serverFloorFor', () => {
  test('is one month below the free window, so a timezone skew cannot refuse a month the dropdown offered', () => {
    // Convex runs UTC; the viewer does not. At a month boundary the two
    // disagree by one month in either direction, so an exact server window
    // would refuse the month the client just offered — breaking the dashboard
    // east of UTC on the 1st of every month. One month of slack is exactly
    // sufficient and has zero margin: do not reduce it.
    expect(serverFloorFor({ currentMonth: '2026-08', earliestMonth: null, pro: false })).toBe('2026-05')
  })

  test('is one month below the pro window', () => {
    expect(serverFloorFor({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: true })).toBe(
      '2023-02',
    )
  })

  test('never returns undefined, whatever the earliestMonth', () => {
    // It must not be implemented as monthWindowFor(...).at(-1): an empty window
    // would make that undefined and addMonths(undefined, -1) throws.
    for (const earliestMonth of ['', 'x', null, '2099-01', '1000-01']) {
      expect(serverFloorFor({ currentMonth: '2026-08', earliestMonth, pro: true })).toMatch(
        /^\d{4}-\d{2}$/,
      )
    }
  })
})

describe('proTeaserMonth', () => {
  test('names the earliest month when it is older than the free window', () => {
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: false })).toBe(
      '2023-03',
    )
  })

  test('is null for a pro player — there is nothing left to tease', () => {
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: true })).toBeNull()
  })

  test('is null when the team has no boards at all', () => {
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: null, pro: false })).toBeNull()
  })

  test('is null when the earliest board is already inside the free window', () => {
    // THE GUARD THAT STOPS A WEEK-OLD TEAM ADVERTISING HISTORY IT DOES NOT HAVE.
    // '2026-06' is the oldest month the free window offers, so there is nothing
    // behind the gate and no row may render.
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '2026-06', pro: false })).toBeNull()
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '2026-07', pro: false })).toBeNull()
  })

  test('is null for a malformed earliestMonth rather than advertising one', () => {
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '', pro: false })).toBeNull()
  })
})
