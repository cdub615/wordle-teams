import { describe, expect, test } from 'vitest'
import { correctedMonth, fallbackMonths, isServableMonth } from './dashboard-months.ts'
import { monthWindowFor } from '../../convex/lib/monthWindow.ts'

describe('correctedMonth', () => {
  test('is null when the month on screen is inside the window', () => {
    expect(
      correctedMonth({ monthParam: '2026-07', months: ['2026-08', '2026-07', '2026-06'] }),
    ).toBeNull()
  })

  test('is null while the window is still loading, and null with no month yet', () => {
    // NOT months[0]. An absent window means the query has not answered, and
    // navigating on it would move the reader off the month they asked for and
    // then have to move them back. An absent monthParam belongs to useSearchSync,
    // which fills it — this must not race that.
    expect(correctedMonth({ monthParam: '2019-01', months: undefined })).toBeNull()
    expect(correctedMonth({ monthParam: '2019-01', months: [] })).toBeNull()
    expect(correctedMonth({ monthParam: undefined, months: ['2026-08'] })).toBeNull()
  })

  test('falls back to the newest month when the month on screen is outside the window', () => {
    // Viewing March 2023 on an old team and switching to one created last month
    // leaves ?month= naming a month the new team cannot show. Same for a Pro
    // subscriber's bookmark after a downgrade, and for a roster change that takes
    // the team's oldest board away with a departing member. All three are
    // corrected identically — see dashboard-months.ts's header for why the spec
    // stopped trying to tell them apart.
    expect(
      correctedMonth({ monthParam: '2023-03', months: ['2026-08', '2026-07', '2026-06'] }),
    ).toBe('2026-08')
  })

  test('always returns a member of the window it was given', () => {
    // THE PROPERTY THE EFFECT'S TERMINATION ACTUALLY RESTS ON, asserted directly
    // rather than inferred from the round-trip test below — which, on its own,
    // would also pass for `return months[months.length - 1]`.
    const months = ['2026-08', '2026-07', '2026-06']

    expect(months).toContain(correctedMonth({ monthParam: '2019-01', months }))
  })

  test('is idempotent — fed its own output, it does nothing', () => {
    // The same property resolveDashboardSearch and resolveInsightsSearch are each
    // tested for, and the only thing standing between the effect that consumes
    // this and an infinite redirect. It holds because element 0 of a window is
    // always currentMonth — see monthWindow.ts, which labels that DO NOT BREAK
    // THAT INVARIANT.
    const months = ['2026-08', '2026-07', '2026-06']
    const once = correctedMonth({ monthParam: '2023-03', months })

    expect(once).not.toBeNull()
    expect(correctedMonth({ monthParam: once as string, months })).toBeNull()
  })
})

describe('fallbackMonths', () => {
  test('is the free window, newest first', () => {
    expect(fallbackMonths('2026-08', '2026-08')).toEqual(['2026-08', '2026-07', '2026-06'])
  })

  test('includes the month on screen even when it is older than the free window', () => {
    // WITHOUT THIS THE DAY PICKER GOES DEAD MID-LOAD. team-boards.tsx sets its
    // DatePicker's `minDay` from the OLDEST month in this array, so a Pro viewer
    // sitting on 2026-02 would, for the length of one round trip, get a minDay of
    // 2026-06 — after every day in the month on screen — and react-day-picker
    // would disable the whole visible grid and both arrows.
    expect(fallbackMonths('2026-08', '2026-02')).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-02',
    ])
  })

  test('never duplicates a month', () => {
    expect(fallbackMonths('2026-08', '2026-07')).toEqual(['2026-08', '2026-07', '2026-06'])
  })

  test('puts a future month on screen at element 0 rather than dropping it', () => {
    // NOT A DESIGN GOAL, PINNED SO THE SELF-HEALING STAYS TRUE. `validateSearch`
    // admits any well-formed 'YYYY-MM', so this list is reachable by hand-typed
    // URL. What matters is that the month on screen is still SELECTABLE in both
    // controls for the one round trip before correctedMonth moves the reader back
    // — a dropdown that does not contain its own current value renders a label
    // with no matching row.
    expect(fallbackMonths('2026-08', '2030-01')).toEqual([
      '2030-01',
      '2026-08',
      '2026-07',
      '2026-06',
    ])
  })
})

describe('isServableMonth', () => {
  // The free window every account is entitled to, around 2026-08. Written out
  // rather than derived so a change to FREE_MONTHS shows up here as a failure
  // rather than being absorbed by the test's own arithmetic.
  const CURRENT = '2026-08'

  test('is true for a month inside the free window before the query has answered', () => {
    // THE CASE THAT KEEPS AN ORDINARY LOAD OFF THE SKELETON, and the reason this
    // guard costs nothing on the path almost every reader takes. `loadedWindow`
    // is undefined on the first render of every dashboard; if the free window did
    // not settle it, every load would wait a round trip to draw anything.
    expect(isServableMonth({ monthParam: '2026-08', currentMonth: CURRENT, loadedWindow: undefined })).toBe(true)
    expect(isServableMonth({ monthParam: '2026-06', currentMonth: CURRENT, loadedWindow: undefined })).toBe(true)
  })

  test('is false for a month outside the free window while the window is in flight', () => {
    // THE DEFECT ITSELF (wordle-teams-alr7). This is the render on which the six
    // getTeamMonth queries used to go out with a month the server refuses — on a
    // team switch that preserved `?month=`, and on a first load from a bookmarked
    // or shared URL. False here is what holds the body back until the effect can
    // correct the param.
    expect(isServableMonth({ monthParam: '2026-05', currentMonth: CURRENT, loadedWindow: undefined })).toBe(false)
    expect(isServableMonth({ monthParam: '2020-01', currentMonth: CURRENT, loadedWindow: undefined })).toBe(false)
  })

  test('is true once the loaded window contains the month, however far back', () => {
    // A Pro viewer on a team with history. The month is nowhere near the free
    // window, and the ONLY thing that makes it servable is the answer having
    // arrived — which is exactly the distinction the second disjunct carries.
    expect(
      isServableMonth({
        monthParam: '2020-01',
        currentMonth: CURRENT,
        loadedWindow: ['2026-08', '2026-07', '2026-06', '2020-01'],
      }),
    ).toBe(true)
  })

  test('is false when the loaded window has arrived and does NOT contain the month', () => {
    // The team switch, one render later: the new team's window is here and the
    // month on screen is not in it. Still false, because `correctedMonth` has not
    // navigated yet — the effect runs after this render commits.
    expect(
      isServableMonth({
        monthParam: '2020-01',
        currentMonth: CURRENT,
        loadedWindow: ['2026-08', '2026-07', '2026-06'],
      }),
    ).toBe(false)
  })

  test('is true for a future month on screen only once the window says so', () => {
    // `validateSearch` admits any well-formed 'YYYY-MM', so '2030-01' is
    // reachable by hand. It is not in the free window and it is not in any real
    // window, so this holds the body and `correctedMonth` sends the reader to
    // element 0. Pinned because `fallbackMonths` treats a future month the
    // opposite way — it keeps it, so the controls can render it — and the two
    // must not be assumed to agree.
    expect(isServableMonth({ monthParam: '2030-01', currentMonth: CURRENT, loadedWindow: undefined })).toBe(false)
    expect(
      isServableMonth({ monthParam: '2030-01', currentMonth: CURRENT, loadedWindow: ['2026-08', '2026-07', '2026-06'] }),
    ).toBe(false)
  })

  test('the pre-hydration render is always servable, so SSR is unchanged', () => {
    // routes/app.tsx passes `clockMonth ?? monthParam` as `currentMonth`, and
    // `clockMonth` is undefined on SSR and on the client's first render. So
    // `currentMonth === monthParam` there, the free window is built AROUND the
    // month on screen, and this cannot hold the body back on a render that has to
    // match the server. Asserted for an ancient month precisely because that is
    // the one the guard exists to catch a moment later.
    expect(isServableMonth({ monthParam: '2020-01', currentMonth: '2020-01', loadedWindow: undefined })).toBe(true)
  })

  test('whatever monthWindowFor produces is servable, which is what makes it terminate', () => {
    // THE TERMINATION PROPERTY, ASSERTED AGAINST THE REAL RULE rather than a
    // hand-written array. `correctedMonth` answers with element 0 of the loaded
    // window, so the guard must return true for that value on the very next
    // render or the skeleton never lifts. Element 0 is `currentMonth` for every
    // input — convex/lib/monthWindow.ts labels that DO NOT BREAK THAT INVARIANT —
    // and the free window contains it, so this holds even with the window back to
    // undefined, which is what a team switch does.
    const window = monthWindowFor({ currentMonth: CURRENT, earliestMonth: '2020-01', pro: true })
    const corrected = correctedMonth({ monthParam: '2019-01', months: window })

    expect(corrected).not.toBeNull()
    expect(isServableMonth({ monthParam: corrected as string, currentMonth: CURRENT, loadedWindow: window })).toBe(true)
    expect(isServableMonth({ monthParam: corrected as string, currentMonth: CURRENT, loadedWindow: undefined })).toBe(true)
  })

  test('EVERY month of EVERY window a team can produce is servable once loaded', () => {
    // The claim the whole guard rests on, checked rather than asserted in prose:
    // `spanFor` floors every window at FREE_MONTHS and counts back from
    // `currentMonth`, so no team and no tier can produce a window whose members
    // this rejects. If that floor is ever removed, this fails here rather than
    // stranding a Pro viewer on a permanent skeleton.
    for (const pro of [false, true]) {
      for (const earliestMonth of [null, '2026-09', '2026-07', '2023-03', '1000-01']) {
        const window = monthWindowFor({ currentMonth: CURRENT, earliestMonth, pro })
        for (const month of window) {
          expect(
            isServableMonth({ monthParam: month, currentMonth: CURRENT, loadedWindow: window }),
            `${month} of the ${pro ? 'pro' : 'free'} window for earliestMonth ${earliestMonth}`,
          ).toBe(true)
        }
      }
    }
  })
})
