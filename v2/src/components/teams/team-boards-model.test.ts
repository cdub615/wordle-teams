import { describe, expect, test } from 'vitest'
import {
  stepDay,
  CONCEALED_MESSAGE,
  MISSING_MESSAGE,
  navigableDays,
  resolveDay,
  teamBoardsView,
  wrapSlide,
  type TeamPlayer,
} from './team-boards-model.ts'

// August 2026: the 1st and 2nd are Sat/Sun, the 3rd is a Monday, the 29th and
// 30th are Sat/Sun and the 31st is a Monday. Same month the sibling
// pick-default-day.test.ts anchors on, for the same reason: the weekend edges
// sit at both ends of it.
const AUG = '2026-08'

const aScore = (puzzleDay: string, answer = 'SPEED') => ({
  puzzleDay,
  answer,
  guesses: ['CRANE', answer],
})

const players: Array<TeamPlayer> = [
  { id: 'p1', firstName: 'Ada', lastName: 'Lovelace', scores: [aScore('2026-08-10'), aScore('2026-08-11')] },
  { id: 'p2', firstName: 'Alan', lastName: 'Turing', scores: [aScore('2026-08-11', 'CRANE')] },
]

describe('navigableDays', () => {
  test('the current month stops at today, inclusive', () => {
    const days = navigableDays({ month: AUG, playWeekends: true, today: '2026-08-05' })
    expect(days).toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'])
  })

  test('a past month runs to its own last day, not to today', () => {
    const days = navigableDays({ month: AUG, playWeekends: true, today: '2026-09-15' })
    expect(days).toHaveLength(31)
    expect(days[0]).toBe('2026-08-01')
    expect(days[days.length - 1]).toBe('2026-08-31')
  })

  test('weekends are excluded when the team does not play them', () => {
    const days = navigableDays({ month: AUG, playWeekends: false, today: '2026-09-15' })
    // Asserted as the whole set, not by sampling: the 1st/2nd and 29th/30th are
    // the four weekend days at the very edges of the month, which is exactly
    // where an off-by-one in the filter would hide.
    expect(days).toEqual([
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
      '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
      '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
      '2026-08-31',
    ])
  })

  test('the future-day bound and the weekend filter both apply, not one or the other', () => {
    // Today is Saturday the 8th. A team that does not play weekends must get
    // the 7th (Friday) as the last day — dropping either rule alone gives the
    // 8th or the 28th instead.
    const days = navigableDays({ month: AUG, playWeekends: false, today: '2026-08-08' })
    expect(days[days.length - 1]).toBe('2026-08-07')
  })

  test('there are no days before hydration, when the viewer date is unknown', () => {
    // THE HAZARD THIS PANEL IS BUILT AROUND. The server cannot know the
    // viewer's date, and guessing it in UTC is v1's bug (V2-ADDENDUM 7a rows
    // 14, 15). No today means no day, which means the placeholder.
    expect(navigableDays({ month: AUG, playWeekends: true, today: undefined })).toEqual([])
  })

  test('a month that has not started yet has nothing to show', () => {
    expect(navigableDays({ month: '2026-12', playWeekends: true, today: '2026-08-05' })).toEqual([])
  })
})

describe('resolveDay', () => {
  const august = navigableDays({ month: AUG, playWeekends: true, today: '2026-08-20' })

  test('the default is the last navigable day, which in the current month is today', () => {
    expect(resolveDay(august, undefined)).toBe('2026-08-20')
  })

  test('a day the viewer picked is honoured', () => {
    expect(resolveDay(august, '2026-08-04')).toBe('2026-08-04')
  })

  test('a picked day from a month no longer in view is dropped, not carried over', () => {
    // What happens on a month switch: `picked` still holds the old month's day.
    // Honouring it would show a day the loaded data has no scores for at all.
    expect(resolveDay(august, '2026-07-04')).toBe('2026-08-20')
  })

  test('a picked day the team can no longer navigate to is dropped', () => {
    // Turning playWeekends off while a Saturday is selected.
    const weekdays = navigableDays({ month: AUG, playWeekends: false, today: '2026-08-20' })
    expect(resolveDay(weekdays, '2026-08-15')).toBe('2026-08-20')
  })

  test('the default is weekend-filtered, so it can never be a day the picker disables', () => {
    // v1's own bug, in the one place it reached this panel: its getDate()
    // returned `new Date()` for the current month with no regard for
    // playWeekends, so a Saturday landed as the selected day of a team whose
    // date picker renders Saturdays disabled.
    const weekdays = navigableDays({ month: AUG, playWeekends: false, today: '2026-08-08' })
    expect(resolveDay(weekdays, undefined)).toBe('2026-08-07')
  })

  test('no navigable days resolves to no day', () => {
    expect(resolveDay([], undefined)).toBeUndefined()
    expect(resolveDay([], '2026-08-04')).toBeUndefined()
  })
})

describe('teamBoardsView', () => {
  test('one slide per member, in roster order, named First Last', () => {
    const { boards } = teamBoardsView({
      players,
      day: '2026-08-11',
      today: '2026-08-20',
      myPlayerId: 'p1',
    })
    expect(boards.map((board) => board.playerId)).toEqual(['p1', 'p2'])
    expect(boards.map((board) => board.playerName)).toEqual(['Ada Lovelace', 'Alan Turing'])
  })

  test('a past day shows the boards that exist and names the ones that do not', () => {
    const { boards, concealed } = teamBoardsView({
      players,
      day: '2026-08-10',
      today: '2026-08-20',
      myPlayerId: 'p1',
    })
    expect(concealed).toBe(false)
    expect(boards.map((board) => board.state)).toEqual(['board', 'missing'])
    expect(boards[0]).toEqual({
      playerId: 'p1',
      playerName: 'Ada Lovelace',
      state: 'board',
      answer: 'SPEED',
      guesses: ['CRANE', 'SPEED'],
      message: null,
    })
    expect(boards[1].message).toBe(MISSING_MESSAGE)
    // The absent board carries nothing to render, so a state check alone
    // cannot be got round by leaking the letters into a hidden slide.
    expect(boards[1].answer).toBe('')
    expect(boards[1].guesses).toEqual([])
  })

  test("today is concealed until the viewer has entered their own board", () => {
    const { boards, concealed } = teamBoardsView({
      players,
      day: '2026-08-11',
      today: '2026-08-11',
      myPlayerId: 'p1', // Ada HAS a board on the 11th...
    })
    // ...so nothing is concealed.
    expect(concealed).toBe(false)
    expect(boards.map((board) => board.state)).toEqual(['board', 'board'])

    const asAlan = teamBoardsView({
      players,
      day: '2026-08-10',
      today: '2026-08-10',
      myPlayerId: 'p2', // Alan has NOT played the 10th
    })
    expect(asAlan.concealed).toBe(true)
    // EVERY slide, Ada's real board included — that is the point of the rule.
    expect(asAlan.boards.map((board) => board.state)).toEqual(['concealed', 'concealed'])
    expect(asAlan.boards.map((board) => board.message)).toEqual([CONCEALED_MESSAGE, CONCEALED_MESSAGE])
    // And the answer must not travel to the client-side slide it is hidden on.
    expect(asAlan.boards.map((board) => board.answer)).toEqual(['', ''])
    expect(asAlan.boards.map((board) => board.guesses)).toEqual([[], []])
  })

  test('a member with no board on a concealed day is not singled out', () => {
    // The concealed message replaces the "no board" one, so a teammate who has
    // not played today cannot be told apart from one who has.
    const { boards } = teamBoardsView({
      players,
      day: '2026-08-10',
      today: '2026-08-10',
      myPlayerId: 'p2',
    })
    // Ada played the 10th, Alan did not; both slides read identically.
    expect(boards[0].message).toBe(boards[1].message)
    expect(boards[0].message).toBe(CONCEALED_MESSAGE)
  })

  test('a past day is never concealed, however little the viewer has played', () => {
    const { concealed, boards } = teamBoardsView({
      players,
      day: '2026-08-10',
      today: '2026-08-20', // the viewer has played nothing near today
      myPlayerId: 'p2',
    })
    expect(concealed).toBe(false)
    expect(boards[0].state).toBe('board')
  })

  test('an unknown viewer conceals rather than reveals', () => {
    // v1's `?? false` fall-through, kept: getMyPlayerId returns null for anyone
    // without a player row, and a null id must not open today's boards.
    const { concealed } = teamBoardsView({
      players,
      day: '2026-08-11',
      today: '2026-08-11',
      myPlayerId: null,
    })
    expect(concealed).toBe(true)
  })

  test("another member's board on the day does not unlock the viewer's view", () => {
    // p2 played the 11th and p1 did not; viewing as p1 must still conceal.
    const oneSided: Array<TeamPlayer> = [
      { id: 'p1', firstName: 'Ada', lastName: 'Lovelace', scores: [] },
      { id: 'p2', firstName: 'Alan', lastName: 'Turing', scores: [aScore('2026-08-11')] },
    ]
    expect(
      teamBoardsView({ players: oneSided, day: '2026-08-11', today: '2026-08-11', myPlayerId: 'p1' })
        .concealed,
    ).toBe(true)
  })

  test('a board on a different day does not count as having played today', () => {
    expect(
      teamBoardsView({ players, day: '2026-08-11', today: '2026-08-11', myPlayerId: 'p2' }).concealed,
    ).toBe(false)
    // p2's only score IS the 11th, so the case above is the positive control
    // for this one: p1 viewing the 10th, holding a board on the 11th only.
    const p1On10th = teamBoardsView({
      players: [players[1], { ...players[0], scores: [aScore('2026-08-11')] }],
      day: '2026-08-10',
      today: '2026-08-10',
      myPlayerId: 'p1',
    })
    expect(p1On10th.concealed).toBe(true)
  })

  test('an empty roster produces no slides and conceals nothing it does not have', () => {
    const { boards, concealed } = teamBoardsView({
      players: [],
      day: '2026-08-11',
      today: '2026-08-20',
      myPlayerId: 'p1',
    })
    expect(boards).toEqual([])
    expect(concealed).toBe(false)
  })
})

describe('wrapSlide', () => {
  test('steps forward and back within range', () => {
    expect(wrapSlide(0, 1, 4)).toBe(1)
    expect(wrapSlide(2, -1, 4)).toBe(1)
  })

  test('wraps off the end and off the start — v1 ran the carousel with loop: true', () => {
    expect(wrapSlide(3, 1, 4)).toBe(0)
    expect(wrapSlide(0, -1, 4)).toBe(3)
  })

  test('a single slide stays put in both directions', () => {
    expect(wrapSlide(0, 1, 1)).toBe(0)
    expect(wrapSlide(0, -1, 1)).toBe(0)
  })

  test('no slides cannot produce a negative or NaN index', () => {
    expect(wrapSlide(0, -1, 0)).toBe(0)
    expect(wrapSlide(0, 1, 0)).toBe(0)
  })
})

/**
 * THE DAY ARROWS, WHICH NOW CROSS MONTHS (wordle-teams-5nmo).
 *
 * They used to index into `navigableDays` for the loaded month and disable at
 * its edges, so at July 1st "Previous day" was dead while the picker beside it
 * offered June 30th — the same friction wordle-teams-5vv3 removed through the
 * other control.
 *
 * `months` IS newest-first throughout, because that is `monthOptions`' order and
 * the component passes it straight through. A LATER month sits at a LOWER index,
 * which is the part of this that is easy to invert.
 */
describe('stepDay', () => {
  // A Thursday, so weekday/weekend edges are their own cases below.
  const TODAY = '2026-08-20'
  const MONTHS = ['2026-08', '2026-07', '2026-06']

  const step = (
    month: string,
    day: string | undefined,
    delta: 1 | -1,
    { playWeekends = true, today = TODAY, months = MONTHS } = {},
  ) =>
    stepDay({
      months,
      month,
      days: navigableDays({ month, playWeekends, today }),
      day,
      playWeekends,
      today,
      delta,
    })

  test('inside the month it is just the next day', () => {
    expect(step('2026-08', '2026-08-19', 1)).toEqual({ day: '2026-08-20', month: '2026-08' })
    expect(step('2026-08', '2026-08-19', -1)).toEqual({ day: '2026-08-18', month: '2026-08' })
  })

  test('stepping BACK off the first day lands on the previous month LAST day', () => {
    // The near end, not the far one: the viewer is walking a continuous line of
    // days, so they arrive at July 31st rather than July 1st.
    expect(step('2026-08', '2026-08-01', -1)).toEqual({ day: '2026-07-31', month: '2026-07' })
  })

  test('stepping FORWARD off the last day lands on the next month FIRST day', () => {
    // From June, whose last day is the 30th, into July's 1st.
    expect(step('2026-06', '2026-06-30', 1)).toEqual({ day: '2026-07-01', month: '2026-07' })
  })

  test('it never steps past today, even with a later month in the window', () => {
    // August is the current month and the 20th is today, so forward from there
    // is nowhere — `navigableDays` already excludes the rest of August, and
    // there is no later month on offer.
    expect(step('2026-08', TODAY, 1)).toBeNull()
  })

  test('and never before the oldest month the dropdown offers', () => {
    // June 1st is the floor of the window. Back from it is outside what the
    // month dropdown itself would offer, so the arrow is disabled rather than
    // reaching a month the other control denies.
    expect(step('2026-06', '2026-06-01', -1)).toBeNull()
  })

  test('it SKIPS a month in the window that has no navigable day', () => {
    // THE CASE A NAIVE `months[index + 1]` GETS WRONG, and it is not
    // hypothetical: navigableDays filters `day <= today`, so a month can be on
    // offer and hold nothing. Here "today" is the 1st of July, which makes July
    // navigable (one day) but a window listing August above it entirely future.
    // Stepping forward from July 1st must find nothing rather than land on
    // August and resolve to undefined, which renders the empty-month card
    // behind an arrow that looked enabled.
    expect(step('2026-07', '2026-07-01', 1, { today: '2026-07-01' })).toBeNull()
  })

  test('it respects playWeekends when it crosses', () => {
    // 1 August 2026 is a Saturday and the 2nd a Sunday, so a team that does not
    // play weekends has July 31st (a Friday) as the day before August 3rd —
    // and the crossing has to use the NEW month's rules, not the old month's
    // day list.
    expect(step('2026-08', '2026-08-03', -1, { playWeekends: false })).toEqual({
      day: '2026-07-31',
      month: '2026-07',
    })
  })

  test('no day at all means no step, in either direction', () => {
    // Pre-hydration, and the empty-month card. `day` is undefined there and
    // both arrows must be disabled rather than throwing on an index of -1.
    expect(step('2026-08', undefined, 1)).toBeNull()
    expect(step('2026-08', undefined, -1)).toBeNull()
  })

  test('a month outside the window still steps WITHIN itself, but cannot leave', () => {
    // Reachable by hand-editing ?month=. The first draft of this test asserted
    // that such a month steps nowhere at all, and the implementation disagreed —
    // correctly. Walking March's own days is coherent: the panel has March's
    // data loaded and the arrows are moving inside it. What must not happen is
    // CROSSING, because the destination month would be one the dropdown never
    // offered and the viewer would have no way back to it.
    expect(step('2026-03', '2026-03-15', -1)).toEqual({ day: '2026-03-14', month: '2026-03' })
    expect(step('2026-03', '2026-03-01', -1)).toBeNull()
    expect(step('2026-03', '2026-03-31', 1)).toBeNull()
  })
})
