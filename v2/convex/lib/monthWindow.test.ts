import { describe, expect, test } from 'vitest'
import { FREE_MONTHS, monthWindowFor, proTeaserMonth, serverFloorFor } from './monthWindow.ts'
import { addMonths } from './puzzleDay.ts'

/**
 * Shared between the element-0 invariant below and the serverFloorFor /
 * monthWindowFor relationship test at the bottom of the file — both need the
 * same spread of pro/free, with/without earliestMonth, and in- and
 * out-of-range inputs, and a second copy drifting from this one is exactly
 * how the two tests would stop agreeing on what "every input" means.
 */
const inputs: Array<{ currentMonth: string; earliestMonth: string | null; pro: boolean }> = [
  { currentMonth: '2026-08', earliestMonth: null, pro: false },
  { currentMonth: '2026-08', earliestMonth: null, pro: true },
  { currentMonth: '2026-08', earliestMonth: '2023-03', pro: true },
  { currentMonth: '2026-08', earliestMonth: '2026-08', pro: true },
  { currentMonth: '2026-08', earliestMonth: '2099-01', pro: true },
  { currentMonth: '2026-08', earliestMonth: '', pro: true },
  { currentMonth: '2026-01', earliestMonth: '2025-11', pro: false },
]

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

  test('a future earliestMonth yields the free window', () => {
    // NAMED FOR WHAT ACTUALLY KILLS IT. spanFor also clamps a future
    // earliestMonth to currentMonth before subtracting, but that clamp is
    // belt-and-braces and unobservable on its own: without it the span would
    // go negative, and the Math.max(span, FREE_MONTHS) floor lifts that back
    // up to FREE_MONTHS regardless, landing on exactly this result either way.
    // This test dies to the FLOOR, not the clamp — see spanFor's comment.
    expect(monthWindowFor({ currentMonth: '2026-08', earliestMonth: '2026-11', pro: true })).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
    ])
  })

  test('survives a malformed earliestMonth without producing an empty window', () => {
    // '' IS A STORED puzzle day on rows nothing ever validated — migrate.ts's
    // verbatim v1 copies, e2eSeed.ts's inserts, and everything written before
    // upsertBoardFor grew its check (wordle-teams-qvqi) — and monthOf('') is ''.
    // That makes the span NaN, Array.from({length: NaN}) returns [], and the
    // element-0 invariant below is violated for a REACHABLE input — with
    // serverFloorFor then reading months[-1] and throwing inside
    // getTeamMonthFor (convex/scores.ts), taking the dashboard down for every Pro
    // member of the team rather than for the author. The write path is closed
    // now; this is the blast shield for the rows that predate it.
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
  // DO NOT BREAK THIS. src/lib/dashboard-months.ts falls back to element 0 for
  // an out-of-window ?month=, and that fallback settles — rather than the effect
  // behind it navigating forever — only because the fallback value is itself
  // always a member of the window it is judged against. Its own suite asserts
  // the idempotence directly; this is the half that lives on THIS side of the
  // dependency. insights-months.ts records the identical property for
  // resolveInsightsSearch, in the same words.

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
    // NOT a catch for `monthWindowFor(...).at(-1)` — with the FREE_MONTHS floor
    // in place, no window this function can build is ever empty, so `.at(-1)`
    // would return a well-formed month here too and this test would pass
    // either way. (The first test in this describe block is what actually
    // pins that: a naive `.at(-1)` implementation reads the CLIENT window's
    // oldest month directly, with no SERVER_SLACK_MONTHS subtracted, so it
    // would return '2026-06' there instead of the asserted '2026-05'.) What
    // this test pins is the return TYPE across a spread of malformed and
    // out-of-range earliestMonth values — that the result is always a
    // well-formed 'YYYY-MM' string, never undefined, so a caller can rely on
    // that shape without a null check.
    for (const earliestMonth of ['', 'x', null, '2099-01', '1000-01']) {
      expect(serverFloorFor({ currentMonth: '2026-08', earliestMonth, pro: true })).toMatch(
        /^\d{4}-\d{2}$/,
      )
    }
  })

  test.each(inputs)(
    'is exactly one month below the oldest month monthWindowFor reaches, for %j',
    (input) => {
      // THE CONTRACT wordle-teams-kusd's TASK 3 SERVER GATE DEPENDS ON: the
      // floor getTeamMonthFor enforces must sit exactly one month below what
      // the dropdown built from monthWindowFor actually offers, for every
      // input, or the gate refuses a month the client just showed. After the
      // Fix 1 refactor this holds because both sides derive their length from
      // the same `spanFor` seam — serverFloorFor via oldestOfferedFor, and
      // monthWindowFor by walking countBack over spanFor(input) - 1 months, so
      // its last element lands on that same value. The two do NOT share a call
      // to oldestOfferedFor, which is why this is worth pinning: the agreement
      // is structural rather than literal, and splitting spanFor would break it
      // silently.
      const months = monthWindowFor(input)
      const oldest = months[months.length - 1]

      expect(serverFloorFor(input)).toBe(addMonths(oldest, -1))
    },
  )
})

describe('proTeaserMonth', () => {
  test('names the earliest month when it is older than the free window', () => {
    expect(proTeaserMonth({ currentMonth: '2026-08', earliestMonth: '2023-03', pro: false })).toBe(
      '2023-03',
    )
  })

  test('names a month the Pro window can actually deliver, even for an ancient earliestMonth', () => {
    // THE DEFECT THIS GUARDS AGAINST. This function used to hand back
    // `earliestMonth` verbatim, so a team with an old earliestMonth left by a
    // row no write-path check ever saw (wordle-teams-qvqi) — '1000-01' here — could
    // be teased a month far older than what spanFor's MAX_MONTHS cap lets the
    // Pro window itself reach: a free player upgrades and gets 2016-09, not
    // the 1000-01 they were promised. Asserted as a RELATIONSHIP, not a
    // hardcoded month, so this keeps holding as MAX_MONTHS or the calendar
    // move: whatever the teaser names must be a month Pro's own window
    // contains.
    const input = { currentMonth: '2026-08', earliestMonth: '1000-01', pro: false }
    const teased = proTeaserMonth(input)
    const proWindow = monthWindowFor({ ...input, pro: true })

    expect(teased).not.toBeNull()
    expect(proWindow).toContain(teased)
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
