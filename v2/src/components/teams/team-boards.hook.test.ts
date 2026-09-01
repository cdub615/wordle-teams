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

const board = (puzzleDay: string, answer: string) => ({
  puzzleDay,
  answer,
  guesses: ['CRANE', answer],
})

// Thursday 20 August 2026, mid-morning local. Chosen so "today" is a weekday
// (the weekend rules have their own coverage in team-boards-model.test.ts) and
// so there are days on both sides of it inside the month.
const NOW = new Date(2026, 7, 20, 10, 0, 0)

const panel = () => createElement(TeamBoards, { teamId: TEAM_ID, month: MONTH })

// react-dom/client's own act() checks this flag; @testing-library/react sets it
// for its render(), but the hand-rolled hydrateRoot below is outside that.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
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
    // ...but it did render — otherwise the four absences above are vacuous.
    expect(container.textContent).toContain('Team Boards')
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
  test('opens on today and renders one slide per member, in roster order', () => {
    render(panel())
    expect(dayLabel('August 20, 2026')).toBeTruthy()
    expect(slides().map((slide) => slide.name)).toEqual(['Ada Lovelace', 'Alan Turing'])
  })

  test("a member with no board for the day gets the 'no board' message, not an empty grid", () => {
    render(panel())
    expect(slides()).toEqual([
      { name: 'Ada Lovelace', message: null, hasBoard: true, letters: 'CRANESPEED' },
      { name: 'Alan Turing', message: MISSING_MESSAGE, hasBoard: false, letters: '' },
    ])
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

  test('Next is disabled on today, and Previous on the first day of the month', () => {
    render(panel())
    expect(dayLabel('Next day').hasAttribute('disabled')).toBe(true)
    expect(dayLabel('Previous day').hasAttribute('disabled')).toBe(false)

    for (let step = 0; step < 19; step++) fireEvent.click(dayLabel('Previous day'))
    expect(dayLabel('August 1, 2026')).toBeTruthy()
    expect(dayLabel('Previous day').hasAttribute('disabled')).toBe(true)
    expect(dayLabel('Next day').hasAttribute('disabled')).toBe(false)
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
    // The whole attribute set, not a lookup: a `month={currentMonth}` added
    // beside the right one, or a prop silently dropped, is a change to this
    // list. `currentMonth` is the CLOCK'S month and would put the panel on a
    // different month from the table above it.
    expect([...rendered[0]]).toEqual([
      ['teamId', "{teamParam as Id<'teams'>}"],
      ['month', '{monthParam}'],
      ['className', '"md:row-span-3"'],
    ])
  })
})
