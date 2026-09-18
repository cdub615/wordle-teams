import { describe, expect, test } from 'vitest'
import { correctedMonth, fallbackMonths } from './dashboard-months.ts'

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
