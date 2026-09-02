// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real component. Named `.hook.test.ts` to match the two
// existing precedents — src/components/settings/notifications-tab.hook.test.ts
// and src/lib/use-local-capture.hook.test.ts — and `.test.ts` rather than
// `.test.tsx` because vitest.config.ts's glob is `src/**/*.test.ts`, so the
// elements below go through `createElement` by hand.
//
// THIS FILE EXISTS BECAUSE THE MODEL IS NOT THE PART THAT BROKE.
// team-boards-model.test.ts pins the arithmetic exhaustively, and every one of
// those tests would still pass if the component never called any of it, called
// it with the server's date, or wired the day arrows backwards. v1's defect was
// in exactly that layer: the day was resolved during render in a component that
// also renders on the server, so server and client disagreed about "today" for
// every viewer not on UTC. The first test below is that bug, reproduced as a
// hydration mismatch; the rest are the wiring the model cannot see.
//
// NOTE ON GATES: `pnpm test:once` runs this file, and CI runs test:once
// (.github/workflows/deploy-v2.yml). Playwright is NOT in the gates — see
// wt-ksh.8.49 — which is why the concealment rule is pinned here and not only
// in e2e.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act, createElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import TeamBoards from './team-boards.tsx'
import { CONCEALED_MESSAGE, MISSING_MESSAGE } from './team-boards-model.ts'
import { codeOf, parseSource } from '#/test-support/source-ast.ts'
import type { Id } from '../../../convex/_generated/dataModel'

/** Set per test, read by the mocked `useSuspenseQuery`. */
let teamMonth: {
  team: { id: string; name: string; playWeekends: boolean; showLetters: boolean }
  players: Array<{
    id: string
    firstName: string
    lastName: string
    scores: Array<{ puzzleDay: string; answer: string; guesses: Array<string> }>
  }>
}
let myPlayerId: string | null

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>) => ({ queryKey: [getFunctionName(ref)] }),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: ({ queryKey }: { queryKey: Array<string> }) =>
    queryKey[0] === getFunctionName(api.scores.getMyPlayerId)
      ? { data: myPlayerId }
      : { data: teamMonth },
}))

const TEAM_ID = 'team_1' as Id<'teams'>
const MONTH = '2026-08'
/**
 * Written out here rather than exported from the component, which is the same
 * choice made for every other literal in this file: the assertions are about
 * what a viewer READS, so importing the string would let a reworded message
 * pass. CONCEALED_MESSAGE and MISSING_MESSAGE are imported because they are
 * v1's strings verbatim and the model already owns them.
 */
const EMPTY_MONTH_MESSAGE = 'No days to show in this month yet'

const board = (puzzleDay: string, answer: string) => ({
  puzzleDay,
  answer,
  guesses: ['CRANE', answer],
})

// Thursday 20 August 2026, mid-morning local. Chosen so "today" is a weekday
// (the weekend rules have their own coverage in team-boards-model.test.ts) and
// so there are days on both sides of it inside the month.
const NOW = new Date(2026, 7, 20, 10, 0, 0)

/** Records every month navigation the panel asks its parent for. */
const monthChanges: Array<string> = []

/**
 * The three months the dropdown offers for August 2026, newest first — the
 * shape `monthOptions` produces, which is what bounds the day picker
 * (wordle-teams-5vv3). June is the oldest, so `2026-06-01` is the picker's
 * floor.
 */
const MONTHS = ['2026-08', '2026-07', '2026-06']

const panel = (month: string = MONTH, months: Array<string> = MONTHS) =>
  createElement(TeamBoards, {
    teamId: TEAM_ID,
    month,
    months,
    onMonthChange: (next: string) => monthChanges.push(next),
  })

// react-dom/client's own act() checks this flag; @testing-library/react sets it
// for its render(), but the hand-rolled hydrateRoot below is outside that.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  monthChanges.length = 0
  // Only Date is faked. Faking timers wholesale would take setTimeout and the
  // message channel with it, which React's scheduler needs to flush anything.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  teamMonth = {
    team: { id: TEAM_ID, name: 'The Team', playWeekends: true, showLetters: true },
    players: [
      {
        id: 'p1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        scores: [board('2026-08-19', 'CRANE'), board('2026-08-20', 'SPEED')],
      },
      { id: 'p2', firstName: 'Alan', lastName: 'Turing', scores: [board('2026-08-19', 'CRANE')] },
    ],
  }
  myPlayerId = 'p1'
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * The track's slides, parsed. Read off the scroll container's own children, so
 * this is the complete set — a slide rendered anywhere else would be missing
 * from every assertion below rather than quietly passing, and a slide that
 * stopped being a child of the track would show up as a length change.
 */
function slides() {
  const track = screen.getByLabelText('Team boards, scrollable by player')
  return Array.from(track.children).map((slide) => ({
    name: slide.children[0]?.textContent ?? null,
    message: slide.querySelector('p')?.textContent ?? null,
    hasBoard: slide.querySelector('[data-slot="wordle-board"]') !== null,
    letters: Array.from(slide.querySelectorAll('[data-state]'))
      .map((tile) => tile.textContent)
      .join(''),
  }))
}

const dayLabel = (label: string) => screen.getByRole('button', { name: label })

describe('the SSR/client date divergence — v1 team-boards.tsx lines 28-33', () => {
  test('the server renders no day-derived content at all', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(panel())

    // The placeholder, and nothing that depended on knowing the viewer's date:
    // no track, no slides, no names, no tiles.
    expect(container.querySelector('[aria-label="Team boards, scrollable by player"]')).toBeNull()
    expect(container.querySelectorAll('[data-slot="wordle-board"]')).toHaveLength(0)
    expect(container.textContent).not.toContain('Ada')
    expect(container.textContent).not.toContain('Alan')
    // And no DATE, which is the most day-derived string the panel has: the
    // picker's own label. A server that resolved a day would print one here.
    expect(container.textContent).not.toMatch(/August \d+, 2026/)
    // ...but it did render — otherwise the five absences above are vacuous.
    expect(container.textContent).toContain('Team Boards')
  })

  test('before hydration the panel is a SKELETON, not the empty-month message', () => {
    // The two placeholder branches are deliberately different states (see the
    // component's comment at the early return) and nothing distinguished them:
    // swapping the two branches over left the whole suite green, which made
    // both the skeleton and the message dead as far as the gates could see.
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(panel())

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1)
    expect(container.textContent).not.toContain(EMPTY_MONTH_MESSAGE)
  })

  // Torn down here rather than at the end of the test below, and that is not
  // tidiness: a failing assertion aborts the test body, so an inline unmount
  // leaves the hydrated container in document.body and every later `screen`
  // query in this file becomes ambiguous. The first run of this suite against a
  // mutant turned one real failure into thirteen for exactly that reason.
  let hydrated: { root: ReturnType<typeof hydrateRoot>; container: HTMLElement } | undefined
  afterEach(() => {
    if (!hydrated) return
    const { root, container } = hydrated
    hydrated = undefined
    act(() => root.unmount())
    container.remove()
  })

  test('THE v1 BUG: hydrating after the date has rolled over produces no mismatch', () => {
    // The two sides of v1's defect, staged in one process: the server resolves
    // "now" on one calendar day and the client resolves it on another. In
    // production the two differ because the server is UTC and the viewer is
    // not — the same instant, two dates. Here the instant is moved instead,
    // which reaches the identical place: two renders of the same element that
    // disagree about today.
    //
    // With the useHydrated() gate, BOTH sides render the placeholder and agree.
    // Remove the gate — resolve the day during render, as v1 does — and the
    // server markup describes the 20th while the client's hydrating render
    // describes the 21st, which React reports through onRecoverableError as a
    // console.error. This test is the difference.
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.innerHTML = renderToStaticMarkup(panel())

    vi.setSystemTime(new Date(2026, 7, 21, 0, 30, 0))

    // hydrateRoot's own onRecoverableError, not a console.error spy: React
    // reports a hydration mismatch here FIRST and only logs as a side effect of
    // having no handler, so this is the bounded signal rather than a substring
    // hunt through whatever else the console collected.
    const recoverable: Array<unknown> = []
    act(() => {
      hydrated = {
        container,
        root: hydrateRoot(container, panel(), {
          onRecoverableError: (error) => recoverable.push(error),
        }),
      }
    })

    expect(recoverable).toEqual([])
    // And once hydrated it shows the CLIENT's day, not the server's.
    expect(container.textContent).toContain('August 21, 2026')
  })
})

describe('what the panel shows once hydrated', () => {
  test("opens on today with one slide per member in roster order, and a 'no board' message rather than an empty grid", () => {
    render(panel())
    expect(dayLabel('August 20, 2026')).toBeTruthy()
    expect(slides()).toEqual([
      { name: 'Ada Lovelace', message: null, hasBoard: true, letters: 'CRANESPEED' },
      { name: 'Alan Turing', message: MISSING_MESSAGE, hasBoard: false, letters: '' },
    ])
  })

  test('a month with nothing playable in it yet says so, rather than spinning forever', () => {
    // September, from an August "today": every day of it is in the future, so
    // `navigableDays` is empty AFTER hydration too. Only reachable by hand —
    // the month picker offers this month and the two before it — but the
    // alternative branch is a skeleton that never resolves.
    const { container } = render(panel('2026-09'))

    expect(screen.getByText(EMPTY_MONTH_MESSAGE)).toBeTruthy()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0)
  })

  test("the team's showLetters:false setting reaches the board", () => {
    teamMonth.team.showLetters = false
    render(panel())
    // The tiles are still there, and still coloured; only the letters go.
    expect(slides()[0].hasBoard).toBe(true)
    expect(slides()[0].letters).toBe('')
  })
})

describe('concealment is wired to the selected day, not just to the model', () => {
  test("today's boards are withheld until the viewer has entered their own", () => {
    myPlayerId = 'p2' // Alan has no board on the 20th
    render(panel())

    expect(slides()).toEqual([
      { name: 'Ada Lovelace', message: CONCEALED_MESSAGE, hasBoard: false, letters: '' },
      { name: 'Alan Turing', message: CONCEALED_MESSAGE, hasBoard: false, letters: '' },
    ])
    // Ada's answer is not merely invisible, it is not in the document.
    expect(screen.queryByText('SPEED')).toBeNull()
  })

  test('stepping back a day reveals it — the rule is about TODAY, not about the viewer', () => {
    myPlayerId = 'p2'
    render(panel())
    expect(slides()[0].message).toBe(CONCEALED_MESSAGE)

    fireEvent.click(dayLabel('Previous day'))

    expect(dayLabel('August 19, 2026')).toBeTruthy()
    expect(slides()).toEqual([
      { name: 'Ada Lovelace', message: null, hasBoard: true, letters: 'CRANECRANE' },
      { name: 'Alan Turing', message: null, hasBoard: true, letters: 'CRANECRANE' },
    ])
  })
})

describe('day navigation', () => {
  test('the arrows step one navigable day at a time, in the right direction', () => {
    render(panel())
    fireEvent.click(dayLabel('Previous day'))
    expect(dayLabel('August 19, 2026')).toBeTruthy()
    fireEvent.click(dayLabel('Previous day'))
    expect(dayLabel('August 18, 2026')).toBeTruthy()
    fireEvent.click(dayLabel('Next day'))
    expect(dayLabel('August 19, 2026')).toBeTruthy()
  })

  test('the arrows skip weekends when the team does not play them', () => {
    // The 17th is a Monday; one step back from it must land on Friday the 14th.
    teamMonth.team.playWeekends = false
    render(panel())
    for (let step = 0; step < 3; step++) fireEvent.click(dayLabel('Previous day'))
    expect(dayLabel('August 17, 2026')).toBeTruthy() // 20 -> 19 -> 18 -> 17
    fireEvent.click(dayLabel('Previous day'))
    expect(dayLabel('August 14, 2026')).toBeTruthy()
  })

  test('Next is disabled on today, at the very top of the window', () => {
    // Today is the last navigable day of the newest month on offer, so forward
    // is genuinely nowhere. Back is not, which is the pair worth asserting
    // together: a `disabled` computed independently of the destination is how a
    // button ends up dead with somewhere to go.
    render(panel())

    expect(dayLabel('Next day').hasAttribute('disabled')).toBe(true)
    expect(dayLabel('Previous day').hasAttribute('disabled')).toBe(false)
  })

  test('PREVIOUS CROSSES INTO THE MONTH BEFORE, rather than stopping at the 1st', () => {
    // wordle-teams-5nmo, and this test asserted the opposite until it: the
    // arrows indexed into the loaded month's days and disabled at its edges, so
    // at August 1st this button was dead while the picker beside it offered
    // July 31st. Stepping off the end is a month navigation, exactly as picking
    // a day outside the month is.
    render(panel())
    for (let step = 0; step < 19; step++) fireEvent.click(dayLabel('Previous day'))
    expect(dayLabel('August 1, 2026')).toBeTruthy()

    expect(dayLabel('Previous day').hasAttribute('disabled')).toBe(false)
    fireEvent.click(dayLabel('Previous day'))

    // It asks the parent for July — the panel cannot show the day until the
    // month's data arrives, which is the parent's job.
    expect(monthChanges).toEqual(['2026-07'])
  })

  test('and lands on the NEAR end of that month, not the far one', () => {
    // July 31st, not July 1st: the viewer is walking a continuous line of days.
    // Rendered at July directly, which is the state the navigation above
    // produces once the parent has moved `?month=`.
    render(panel('2026-07'))
    expect(dayLabel('July 31, 2026')).toBeTruthy()

    // And forward from there returns to August, the near end again.
    fireEvent.click(dayLabel('Next day'))
    expect(monthChanges).toEqual(['2026-08'])
  })

  test('Previous is disabled only at the FLOOR of the window', () => {
    // June is the oldest month the dropdown offers, so its 1st is where back
    // genuinely runs out — the same bound the picker refuses below, from the
    // same `months` array, so the two controls cannot disagree about what
    // exists.
    render(panel('2026-06'))
    for (let step = 0; step < 29; step++) fireEvent.click(dayLabel('Previous day'))
    expect(dayLabel('June 1, 2026')).toBeTruthy()

    expect(dayLabel('Previous day').hasAttribute('disabled')).toBe(true)
    expect(monthChanges).toEqual([])
  })
})

describe('the date picker reaches every month the dropdown offers', () => {
  // THE HALF THE ARROW TESTS ABOVE ARE BLIND TO. Every day-navigation test
  // clicks an arrow; nothing reached the picker, so `onSelect` could be replaced
  // by a no-op and the bounds deleted from the call site with the suite still
  // green. src/components/date-picker.hook.test.ts pins what the props DO;
  // these pin that this panel passes them and listens to the result.
  //
  // WHAT CHANGED IN wordle-teams-5vv3, because these tests used to assert the
  // opposite: the picker was clamped to the LOADED month with minDay/maxDay, on
  // the reasoning that getTeamMonth has no data outside it. That reasoning was
  // sound and the conclusion was wrong — reaching another month is a
  // NAVIGATION, not a day with no data, and the panel now asks its parent to
  // move `?month=` instead of refusing to offer the day.

  /** Every day the open calendar offers, read off its `data-day` cells. */
  const offeredDays = () =>
    Array.from(screen.getByRole('grid').querySelectorAll<HTMLElement>('td[data-day]'))
      .filter((cell) => cell.querySelector('button')?.hasAttribute('disabled') === false)
      .map((cell) => cell.dataset.day)

  const pageBack = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Go to the Previous Month' }))

  test('it OPENS on the day being viewed, not on the clock month', () => {
    // wordle-teams-p5mw, fixed as part of this. react-day-picker resolves its
    // initial month as `month || defaultMonth || today` and never consults
    // `selected` (helpers/getInitialMonth.js:14), so with neither passed the
    // calendar opened on August while the panel showed July — every day in the
    // grid disabled by the old maxDay, and the viewer had to page back before
    // there was anything to click. The version of this test that stood here had
    // to perform that page-back itself, which is how the bug got documented
    // instead of fixed.
    render(panel('2026-07'))
    fireEvent.click(dayLabel('July 31, 2026'))

    expect(offeredDays()).toContain('2026-07-15')
  })

  test('a day in an EARLIER month is offered, and picking it asks for that month', () => {
    // The owner's complaint: viewing an earlier day meant going up to the month
    // dropdown first. Now the picker reaches it, and because getTeamMonth loads
    // one month the panel turns that into a navigation for its parent.
    render(panel())
    fireEvent.click(dayLabel('August 20, 2026'))
    pageBack()

    expect(offeredDays()).toContain('2026-07-15')

    fireEvent.click(screen.getByRole('grid').querySelector('td[data-day="2026-07-15"] button')!)

    expect(monthChanges).toEqual(['2026-07'])
  })

  test('but a day in the SAME month is not a navigation', () => {
    // The parent must not be asked to move `?month=` for an ordinary
    // within-month pick — that would push a redundant history entry on every
    // click, and re-run the route's loader for data it already holds.
    render(panel())
    fireEvent.click(dayLabel('August 20, 2026'))
    fireEvent.click(screen.getByRole('grid').querySelector('td[data-day="2026-08-19"] button')!)

    expect(dayLabel('August 19, 2026')).toBeTruthy()
    expect(monthChanges).toEqual([])
  })

  test('the floor is the OLDEST month the dropdown offers, and no further', () => {
    // THE BOUND THAT REPLACED THE MONTH CLAMP, and the reason it is not simply
    // unbounded: v2 has no pro month gate yet — monthOptions returns three
    // months for everyone — so an unbounded picker would hand every player
    // unlimited history now, and the pro expansion would later have to take it
    // away. `months` is that same array, so the two controls cannot disagree.
    render(panel())
    fireEvent.click(dayLabel('August 20, 2026'))

    pageBack()
    pageBack()
    expect(offeredDays()).toContain('2026-06-15')

    // May is outside the window, so no MAY day is offered. Asserted as "no day
    // in that month" rather than "nothing at all": `showOutsideDays` and
    // `fixedWeeks` mean May's last week paints June 1st-6th, which are inside
    // the window and correctly still selectable. An empty-grid assertion looked
    // right and failed on exactly those six days.
    pageBack()
    expect(offeredDays().filter((day) => day?.startsWith('2026-05'))).toEqual([])
    expect(offeredDays().length).toBeGreaterThan(0)
  })

  test('picking a day from the calendar moves the panel to it', () => {
    render(panel())
    fireEvent.click(dayLabel('August 20, 2026'))
    fireEvent.click(screen.getByRole('grid').querySelector('td[data-day="2026-08-19"] button')!)

    expect(dayLabel('August 19, 2026')).toBeTruthy()
    // And the boards moved with it: on the 20th Alan has none, on the 19th he does.
    expect(slides()).toEqual([
      { name: 'Ada Lovelace', message: null, hasBoard: true, letters: 'CRANECRANE' },
      { name: 'Alan Turing', message: null, hasBoard: true, letters: 'CRANECRANE' },
    ])
  })
})

describe('the carousel, without a carousel library', () => {
  // jsdom lays nothing out: every offsetLeft is 0 and Element.scrollTo does not
  // exist. Both are stubbed so the SLIDE THE ARROWS TARGET is observable —
  // with real zeroes, a wrap to the last slide and a step to the next one are
  // the same call and neither test below could fail.
  let scrollTo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
      configurable: true,
      get(this: HTMLElement) {
        const siblings = this.parentElement?.children
        return siblings ? Array.prototype.indexOf.call(siblings, this) * 100 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
  })

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetLeft')
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  })

  test('Next player moves one slide forward', () => {
    render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Next player' }))
    expect(scrollTo).toHaveBeenCalledWith({ left: 100, behavior: 'smooth' })
  })

  test('Previous player from the first slide WRAPS to the last — v1 ran loop: true', () => {
    teamMonth.players.push({ id: 'p3', firstName: 'Grace', lastName: 'Hopper', scores: [] })
    render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Previous player' }))
    // Three slides, so the last one sits at 200. A non-wrapping implementation
    // clamps to 0 here and this is the assertion that catches it.
    expect(scrollTo).toHaveBeenCalledWith({ left: 200, behavior: 'smooth' })
  })

  test('THE SNAP ITSELF: the track and EVERY slide carry the scroll-snap classes', () => {
    // The whole of V2-ADDENDUM §7a row 31 rests on this. "The two things v1's
    // carousel actually does are the snap and opts={{loop:true}}" — the loop is
    // pinned twice (wrapSlide directly, and the two arrow tests above), and
    // before this test the snap was pinned nowhere: stripping `snap-x
    // snap-mandatory` from the track, or `snap-center` from the slides, left
    // the suite green and the panel a free-scrolling div.
    //
    // jsdom lays nothing out, so snapping BEHAVIOUR is out of reach here; what
    // is in reach is that the classes are on the elements, over the track's
    // whole child list rather than a sample of it.
    teamMonth.players.push({ id: 'p3', firstName: 'Grace', lastName: 'Hopper', scores: [] })
    render(panel())
    const track = screen.getByLabelText('Team boards, scrollable by player')

    expect(track.className).toContain('overflow-x-auto')
    expect(track.className).toContain('snap-x')
    expect(track.className).toContain('snap-mandatory')

    const children = Array.from(track.children)
    expect(children).toHaveLength(3)
    // basis-full is half of it: one slide exactly fills the track, which is
    // also what makes the scroll handler's scrollLeft / clientWidth an index
    // rather than an approximation.
    expect(children.map((slide) => [slide.className.includes('snap-center'), slide.className.includes('basis-full')])).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ])
  })

  test('a swipe moves the index the ARROWS step from', () => {
    // Nothing else in this file fires a scroll, so deleting the onScroll
    // handler outright was green. It is the only thing that tells the arrows
    // where a touch swipe left the track; without it they step from a stale
    // index, which on a two-member team means the arrow does nothing visible.
    render(panel())
    const track = screen.getByLabelText('Team boards, scrollable by player')
    // jsdom reports 0 for both, and the handler's own guard bails on a zero
    // width, so the track is given the geometry the offsetLeft stub implies.
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 100 })
    track.scrollLeft = 100

    fireEvent.scroll(track)
    fireEvent.click(screen.getByRole('button', { name: 'Next player' }))

    // Two slides, and the swipe left us on the second: Next WRAPS to the first.
    // Without the handler the arrows still think they are on the first and
    // target 100.
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' })
  })

  test('switching to a smaller team clamps the index the arrows step from', () => {
    // The hazard the clamp's comment names, exercised. Three members, swipe to
    // the last, then the viewer switches team and the roster shrinks under it.
    teamMonth.players.push({ id: 'p3', firstName: 'Grace', lastName: 'Hopper', scores: [] })
    const view = render(panel())
    const track = screen.getByLabelText('Team boards, scrollable by player')
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 100 })
    track.scrollLeft = 200
    fireEvent.scroll(track)

    teamMonth.players = teamMonth.players.slice(0, 2)
    view.rerender(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Next player' }))

    // Clamped to the last of two slides, Next wraps to the first. Unclamped,
    // index 2 of a 2-slide track steps to 1 and targets 100 instead.
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' })
  })

  test('a viewer who asked for reduced motion gets an instant jump, not a smooth one', () => {
    // `behavior: 'smooth'` in a scripted scrollTo is not reliably damped by the
    // UA — the claim that scroll-snap got this for free was retracted on
    // wordle-teams-ry1 — so the panel asks. jsdom ships no matchMedia at all,
    // which is why the component optional-calls it and why the other tests in
    // this describe are the 'smooth' half of this pair.
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes('reduce') }))
    vi.stubGlobal('matchMedia', matchMedia)

    render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Next player' }))

    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    expect(scrollTo).toHaveBeenCalledWith({ left: 100, behavior: 'auto' })
    vi.unstubAllGlobals()
  })

  test('a one-member team has no player arrows at all', () => {
    teamMonth.players = [teamMonth.players[0]]
    render(panel())
    expect(screen.queryByRole('button', { name: 'Next player' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous player' })).toBeNull()
    // The day arrows are a different pair and must survive.
    expect(dayLabel('Previous day')).toBeTruthy()
  })
})

describe('the panel is mounted on the dashboard', () => {
  // THE ONE THING EVERY TEST ABOVE IS BLIND TO. They all render TeamBoards
  // directly, so deleting the element from routes/app.tsx leaves the whole file
  // green, lint and tsc silent (nothing else imports it) and the build happy —
  // and the feature simply gone. The dashboard route cannot be imported under
  // vitest (createFileRoute registers against a router that does not exist), so
  // its SOURCE is the artefact, read with the compiler rather than a regex for
  // the reason src/test-support/source-ast.ts sets out at length: a substring
  // match is satisfied by the name sitting in a comment or a dead const.
  test('routes/app.tsx renders it, once, with the viewed team and month', () => {
    // Resolved with node:path off the module's own directory, never through
    // `new URL(..., import.meta.url)`. jsdom replaces the global `URL` with its
    // own class, and neither node:fs nor fileURLToPath will take an instance of
    // it — "The URL must be of scheme file", however file-scheme it is. The
    // sibling suites that hand readFileSync a bare URL all run under the
    // default edge-runtime environment, where the global is node's own.
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../routes/app.tsx')
    const source = codeOf(readFileSync(path, 'utf8'))
    const file = parseSource('app.tsx', source)

    const rendered: Array<Map<string, string>> = []
    const walk = (node: ts.Node) => {
      const tag = ts.isJsxSelfClosingElement(node)
        ? node.tagName
        : ts.isJsxOpeningElement(node)
          ? node.tagName
          : undefined
      if (tag?.getText(file) === 'TeamBoards') {
        const element = node as ts.JsxSelfClosingElement | ts.JsxOpeningElement
        rendered.push(
          new Map(
            element.attributes.properties
              .filter(ts.isJsxAttribute)
              .map((attribute) => [
                attribute.name.getText(file),
                attribute.initializer?.getText(file) ?? '',
              ]),
          ),
        )
      }
      ts.forEachChild(node, walk)
    }
    walk(file)

    expect(rendered).toHaveLength(1)

    // THE PROP NAMES, EXHAUSTIVELY. A `month={currentMonth}` added beside the
    // right one, or a prop silently dropped, is a change to this list —
    // `currentMonth` is the CLOCK'S month and would put the panel on a different
    // month from the table above it.
    expect([...rendered[0].keys()]).toEqual([
      'teamId',
      'month',
      'months',
      'onMonthChange',
      'className',
    ])

    expect(rendered[0].get('teamId')).toBe("{teamParam as Id<'teams'>}")
    expect(rendered[0].get('month')).toBe('{monthParam}')
    expect(rendered[0].get('className')).toBe('"md:row-span-3"')

    // `monthOptions(currentMonth)` — THE SAME CALL the MonthPicker is driven
    // by, which is what makes the day picker and the arrows offer exactly the
    // months the dropdown does. A different window here, or a literal array, is
    // how the controls silently drift apart.
    expect(rendered[0].get('months')).toBe('{monthOptions(currentMonth)}')

    // ASSERTED BY CONTENT RATHER THAN AS ONE EXACT STRING, because the handler
    // is now a multi-line object literal and pinning its formatting would make
    // this fail on a prettier run. The two facts that matter are that it
    // navigates, and that it does NOT reset scroll — the second being the whole
    // of wordle-teams-rpql's first item: this panel sits far down the grid, and
    // resetting scroll threw a phone reader to the top of the page on every
    // month crossing.
    const onMonthChange = rendered[0].get('onMonthChange') ?? ''
    expect(onMonthChange).toContain('navigate(')
    expect(onMonthChange).toContain('search: { team: teamParam, month }')
    expect(onMonthChange).toContain('resetScroll: false')
  })
})

/**
 * THE CAROUSEL SCROLLS SIDEWAYS AND ONLY SIDEWAYS (wordle-teams-iv09).
 *
 * Owner-reported from a phone: dragging vertically over the boards scrolled the
 * carousel instead of the page, so a mistouch in that area trapped the page
 * scroll. TWO COMPOUNDING CAUSES, and both are asserted because either one
 * alone reproduces it.
 *
 * ASSERTED ON CLASS ATTRIBUTES, WHICH IS WHAT jsdom CAN SEE. There is no layout
 * engine here — every element measures 0x0 — so no test in this repo can
 * observe a scrollHeight exceeding a clientHeight, or a touch drag chaining to
 * the page. What CAN be pinned is the markup that decides both, and the markup
 * is where the defect was. The behavioural half belongs to a real browser;
 * e2e/team-boards.spec.ts drives this panel.
 */
describe('the boards carousel does not become a vertical scroll container', () => {
  const track = () => screen.getByLabelText('Team boards, scrollable by player')

  test('the track declares BOTH axes, because declaring one decides the other', () => {
    // THE SPEC DETAIL THAT MAKES THIS A BUG RATHER THAN A NON-STATEMENT: when
    // one overflow axis is not `visible`, the other computes from `visible` to
    // AUTO. So `overflow-x-auto` alone does not leave the y axis alone — it
    // makes the element scrollable in both directions, and a downward drag
    // scrolls the track rather than the page.
    render(panel())

    expect(track().className).toContain('overflow-x-auto')
    expect(track().className).toContain('overflow-y-hidden')
  })

  test('NOT touch-action, which is the plausible wrong fix', () => {
    // `touch-action: pan-x` looks like the direct expression of "only pan
    // horizontally here" and is the opposite of what is wanted: the property is
    // intersected from the hit-test element up through its ancestors, so
    // setting it here disables vertical panning for the PAGE as well whenever a
    // gesture starts inside the carousel. That is the reported bug, reached from
    // the other direction, and it would look like a fix in review.
    render(panel())

    expect(track().className).not.toContain('touch-action')
    expect(track().className).not.toMatch(/\btouch-pan-x\b/)
  })

  test('a slide is a column whose board takes only the space the name leaves', () => {
    // THE OVERFLOW ITSELF, WHICH IS WHAT THE TRACK HAD TO SCROLL. The slide is
    // 450px. The name row is `h-[24px]` plus `mb-2`, so 32px. The board wrapper
    // was `h-full` — which resolves against the SLIDE, 450px, not the 418px
    // actually left beneath the name — so every slide held 482px of content in
    // a 450px box, on every screen size, regardless of the board's contents.
    //
    // `flex-1` takes what remains instead of the whole box. `min-h-0` is what
    // permits a flex child to shrink below its content's intrinsic height at
    // all: the default `min-height: auto` would reinstate the overflow with
    // flex-1 still in place, which is the subtle half and the likelier revert.
    render(panel())

    const slide = track().firstElementChild
    expect(slide?.className).toContain('flex-col')

    const boardWrapper = slide?.lastElementChild
    expect(boardWrapper?.className).toContain('flex-1')
    expect(boardWrapper?.className).toContain('min-h-0')
    expect(boardWrapper?.className).not.toContain('h-full')
  })
})
