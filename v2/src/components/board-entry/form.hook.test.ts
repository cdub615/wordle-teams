// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real form; `.hook.test.ts` and `createElement` for the same
// reasons as every other component test in src/.
//
// WHY THIS FILE EXISTS. Splitting board entry by data source (form.tsx) left
// two facts undefended, both of which survive tsc, eslint, the unit suite AND
// the e2e suite:
//
//   1. WHICH PLAYER'S SCORES THE TEAM BRANCH PREFILLS FROM. getTeamMonth
//      returns EVERY member's scores, so the branch has to find the caller's
//      row by id. Flip that `===` to `!==` and the form prefills from a
//      TEAMMATE's board — someone else's answer, in your entry form, one submit
//      away from being written to your own day. e2e cannot see it because
//      signInWithTeam builds a ONE-MEMBER team, where find(!==) returns
//      undefined, falls through `?? []` and is indistinguishable from a fresh
//      board. The cruder mutant `data.players[0]?.scores` does die today — but
//      at TS6133 'myPlayerId' is declared but never read, i.e. by
//      noUnusedLocals, not by anything asserting the scoping.
//
//   2. THE SOLO `playWeekends` DEFAULT. It is the one genuinely new product
//      decision in the team-less work — it decides which days a player with no
//      team may select — and it shipped with a five-line justification comment
//      and zero assertions.
//
// DatePicker IS MOCKED TO A PROBE, and `playWeekends` is asserted at that prop
// rather than through the rendered calendar deliberately: date-picker.hook.test.ts:101
// ("weekends are withheld from a team that does not play them") already owns
// what the picker DOES with the flag. What is unowned, and what this file
// pins, is which value each branch hands it.
import { cleanup, render, screen } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import { BoardEntryForm } from './form.tsx'
import { monthOf, toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * The real clock, like convex/scores.test.ts's `today`. pickDefaultDay returns
 * today whenever today is in the month asked for and playable, so building the
 * fixtures around it makes "the selected day" deterministic whenever this runs,
 * rather than only in September 2026.
 */
const today = toPuzzleDay(new Date())
const thisMonth = monthOf(today)

const TEAM_ID = 'team-1' as Id<'teams'>
const ME = 'player-me'
const TEAMMATE = 'player-mate'

type TeamMonth = {
  team: { playWeekends: boolean }
  players: Array<{ id: string; scores: Array<Record<string, unknown>> }>
}

let teamMonth: TeamMonth
let myMonth: Array<Record<string, unknown>>
/** Every Convex query the render actually asked for, in order. */
let requested: Array<string>

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({
    queryKey: [getFunctionName(ref), args],
  }),
  useConvexMutation: () => vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    const name = queryKey[0]
    requested.push(name)
    if (name === getFunctionName(api.scores.getTeamMonth)) return { data: teamMonth }
    if (name === getFunctionName(api.scores.getMyPlayerId)) return { data: ME }
    if (name === getFunctionName(api.scores.getMyMonth)) return { data: myMonth }
    throw new Error(`Board entry asked for an unexpected query: ${name}`)
  },
  useQuery: () => ({ data: false }),
  useMutation: () => ({ mutateAsync: vi.fn() }),
}))

/**
 * A probe, not the real picker. Renders the two props this file is about so
 * they can be read straight off the DOM.
 */
vi.mock('#/components/date-picker.tsx', () => ({
  DatePicker: ({ day, playWeekends }: { day?: string; playWeekends?: boolean }) =>
    createElement('div', {
      'data-testid': 'date-picker',
      'data-day': day ?? '',
      'data-play-weekends': String(playWeekends),
    }),
}))

/** The board grid is BoardInput's business; nothing here asserts through it. */
vi.mock('./board-input.tsx', () => ({ BoardInput: () => null }))

beforeEach(() => {
  requested = []
  myMonth = []
  teamMonth = { team: { playWeekends: true }, players: [] }
})

afterEach(cleanup)

const answerText = () => document.getElementById('answer')?.textContent ?? null
const picker = () => screen.getByTestId('date-picker')

describe('the team branch prefills from the CALLER, never a teammate', () => {
  test("a teammate's board on the selected day does not become the caller's prefill", () => {
    // A two-member team is the whole point: this is exactly the shape e2e never
    // builds. The teammate has today's board; the caller has nothing.
    teamMonth = {
      team: { playWeekends: true },
      players: [
        { id: ME, scores: [] },
        {
          id: TEAMMATE,
          scores: [{ id: 'score-mate', puzzleDay: today, answer: 'CRANE', guesses: ['CRANE'] }],
        },
      ],
    }

    render(createElement(BoardEntryForm, { teamId: TEAM_ID, month: thisMonth, onSuccess: () => {} }))

    // The form opened on today, so a mis-scoped lookup WOULD have found the
    // teammate's row — which is what makes the empty answer meaningful rather
    // than vacuous.
    expect(picker().getAttribute('data-day')).toBe(today)
    expect(answerText()).toBe('')
  })

  test("the caller's OWN board on that day still prefills", () => {
    // The mirror, and the reason the test above cannot be satisfied by a form
    // that simply never prefills anything.
    teamMonth = {
      team: { playWeekends: true },
      players: [
        { id: ME, scores: [{ id: 'score-me', puzzleDay: today, answer: 'SPEED', guesses: ['SPEED'] }] },
        {
          id: TEAMMATE,
          scores: [{ id: 'score-mate', puzzleDay: today, answer: 'CRANE', guesses: ['CRANE'] }],
        },
      ],
    }

    render(createElement(BoardEntryForm, { teamId: TEAM_ID, month: thisMonth, onSuccess: () => {} }))

    expect(answerText()).toBe('SPEED')
  })
})

describe('each branch hands DatePicker the right playWeekends', () => {
  test("the team branch forwards the TEAM's setting", () => {
    teamMonth = { team: { playWeekends: false }, players: [{ id: ME, scores: [] }] }

    render(createElement(BoardEntryForm, { teamId: TEAM_ID, month: thisMonth, onSuccess: () => {} }))

    expect(picker().getAttribute('data-play-weekends')).toBe('false')
  })

  test('a team-less player gets weekends, because a new team would have given them weekends', () => {
    // THE ONE NEW PRODUCT DECISION IN THE TEAM-LESS WORK. There is no team to
    // ask, so the solo branch hardcodes true — create-team-dialog.tsx ships
    // both switches on, so this is what the player will see on the team they
    // are about to create. Choosing false would silently disable weekend entry
    // for someone who never chose that, and every gate would stay green.
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(picker().getAttribute('data-play-weekends')).toBe('true')
  })
})

describe('the dispatcher picks its query by whether there is a team', () => {
  test('no teamId: getMyMonth alone — no getTeamMonth, and no getMyPlayerId either', () => {
    // getMyPlayerId exists only to find the caller's row inside getTeamMonth's
    // multi-player payload. getMyMonth is already scoped to the caller, so
    // asking for it here would be a wasted subscription on the very screen this
    // work exists to make fast.
    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(requested).toEqual([getFunctionName(api.scores.getMyMonth)])
  })

  test('a teamId: getTeamMonth and getMyPlayerId, in that order, and never getMyMonth', () => {
    teamMonth = { team: { playWeekends: true }, players: [{ id: ME, scores: [] }] }

    render(createElement(BoardEntryForm, { teamId: TEAM_ID, month: thisMonth, onSuccess: () => {} }))

    expect(requested).toEqual([
      getFunctionName(api.scores.getTeamMonth),
      getFunctionName(api.scores.getMyPlayerId),
    ])
  })

  test('the solo branch still prefills the caller’s own board for the day', () => {
    // Same prefill path as the team branch, fed by the other query — the point
    // of getMyMonth emitting getTeamMonthFor's exact score shape.
    myMonth = [{ id: 'score-solo', puzzleDay: today, answer: 'TOAST', guesses: ['TOAST'] }]

    render(createElement(BoardEntryForm, { month: thisMonth, onSuccess: () => {} }))

    expect(answerText()).toBe('TOAST')
  })
})
