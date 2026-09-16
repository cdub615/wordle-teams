// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, and `.hook.test.ts` with
// createElement by hand, because vitest.config.ts's glob is `src/**/*.test.ts` —
// a .tsx file would simply not run. Same shape as every other component test here.
//
// WHY THIS FILE EXISTS: THE RULES HERE ARE ALL ABOUT WHAT IS *ABSENT*, and an
// absent control is the one defect a screenshot of a healthy account never
// shows. One team must see NO team dropdown — that is most accounts, and their
// page must be unchanged by this feature — and the free branch must see no
// month dropdown at all. Both are `&&`s that a later edit can widen without
// anything else in the suite noticing.
//
// THE ACCESSIBLE NAMES ARE ASSERTED BY ROLE AND NAME, NEVER BY TEXT. A static
// `aria-label` OVERRIDES a button's text content for the accessibility tree, so
// a trigger reading "Team" on screen can be announced as "Team" and nothing
// else — the selection invisible to a screen reader while perfectly visible in
// a screenshot. getByRole with a name is the only query that can tell the
// difference.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { TeamScopeControls, showsTeamPicker } from './team-scope-controls.tsx'

afterEach(cleanup)

const teams = [
  { id: 'team_a', name: 'Ada’s Analysts' },
  { id: 'team_b', name: 'Turing Test' },
]

/**
 * Radix opens a DropdownMenu on POINTERDOWN, not on click — `fireEvent.click`
 * alone leaves the menu shut and every assertion about its contents trivially
 * passing against an empty list. Lifted from app-menu.hook.test.ts, which pays
 * for the same lesson on the same primitive.
 */
const open = (name: string) =>
  fireEvent.pointerDown(screen.getByRole('button', { name }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  })

const controls = (props: Partial<Parameters<typeof TeamScopeControls>[0]> = {}) =>
  render(
    createElement(TeamScopeControls, {
      teams,
      teamId: 'team_a',
      onTeamChange: () => undefined,
      ...props,
    }),
  )

const monthScope = (value = '2026-09', onChange: (month: string) => void = () => undefined) => ({
  value,
  // Newest first, the order teamMonthOptions returns — see insights-months.ts.
  options: ['2026-09', '2026-08', '2026-07'],
  onChange,
})

describe('the team dropdown appears only when there is a team to choose', () => {
  test('one team renders NO team control at all', () => {
    // THE CASE MOST ACCOUNTS ARE IN. A dropdown whose only option is the thing
    // already selected is furniture, and this card is small enough that a
    // control nobody can use costs real width in the header.
    controls({ teams: [teams[0]], teamId: 'team_a' })
    expect(screen.queryByTestId('insights-scope-team')).toBeNull()
  })

  test('one team and no month renders the whole component as nothing', () => {
    // Not merely an empty row: the header this sits in must collapse to exactly
    // the title it had before this component existed.
    const { container } = controls({ teams: [teams[0]], teamId: 'team_a' })
    expect(screen.queryByTestId('insights-scope-controls')).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  test('two teams renders it', () => {
    controls()
    expect(screen.queryByTestId('insights-scope-team')).not.toBeNull()
  })

  test('showsTeamPicker states the same rule once, for the callers that need it', () => {
    // daily-team-fact.tsx has no title, so its header exists only when there is
    // a control to put in it — which means routes/insights.tsx has to ask this
    // question too. Exported so `length > 1` has one spelling rather than two.
    expect(showsTeamPicker([])).toBe(false)
    expect(showsTeamPicker([teams[0]])).toBe(false)
    expect(showsTeamPicker(teams)).toBe(true)
  })
})

describe('the month dropdown appears only when a month scope is passed', () => {
  test('absent by default — the free branch, where today has no month to choose', () => {
    controls()
    expect(screen.queryByTestId('insights-scope-month')).toBeNull()
  })

  test('present when scoped — the pro branch', () => {
    controls({ month: monthScope() })
    expect(screen.queryByTestId('insights-scope-month')).not.toBeNull()
  })

  test('a one-team pro account still gets the month dropdown, and no team one', () => {
    // The two rules are independent, which is the whole reason they are two
    // `&&`s rather than one branch: a solo team has months to look through.
    controls({ teams: [teams[0]], teamId: 'team_a', month: monthScope() })
    expect(screen.queryByTestId('insights-scope-team')).toBeNull()
    expect(screen.queryByTestId('insights-scope-month')).not.toBeNull()
  })

  test('offers every month it is given, in the order it is given them', () => {
    controls({ month: monthScope() })
    open('Month: Sep 2026')
    expect(screen.queryAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Sep 2026',
      'Aug 2026',
      'Jul 2026',
    ])
  })
})

describe('the accessible name carries the current selection', () => {
  test('the team trigger names the selected team', () => {
    controls()
    expect(screen.queryByRole('button', { name: 'Team: Ada’s Analysts' })).not.toBeNull()
  })

  test('the month trigger names the selected month', () => {
    controls({ month: monthScope('2026-07') })
    expect(screen.queryByRole('button', { name: 'Month: Jul 2026' })).not.toBeNull()
  })

  test('a long team name is truncated on screen but NOT in the accessible name', () => {
    // The visible label shortens by character count for a trigger that is
    // capped in CSS; a screen reader user should not have to sit through the
    // ellipsis, nor be left unable to tell two similarly-prefixed teams apart.
    const long = { id: 'team_c', name: 'The Wednesday Afternoon Wordle Society' }
    controls({ teams: [...teams, long], teamId: 'team_c' })

    const trigger = screen.getByTestId('insights-scope-team')
    expect(trigger.textContent).toContain('The Wednesday A...')
    expect(trigger.getAttribute('aria-label')).toBe(
      'Team: The Wednesday Afternoon Wordle Society',
    )
  })

  test('a teamId no team matches says so rather than naming nothing', () => {
    // Reachable for the render or two before the route's effect corrects a
    // stale `?team=`. An empty accessible name would be worse than a wrong one.
    controls({ teamId: 'team_gone' })
    expect(screen.queryByRole('button', { name: 'Team: No team selected' })).not.toBeNull()
  })
})

describe('choosing navigates', () => {
  test('picking a team hands the id back', () => {
    const onTeamChange = vi.fn()
    controls({ onTeamChange })

    open('Team: Ada’s Analysts')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Turing Test' }))

    expect(onTeamChange).toHaveBeenCalledWith('team_b')
  })

  test('picking a month hands the month back', () => {
    const onChange = vi.fn()
    controls({ month: monthScope('2026-09', onChange) })

    open('Month: Sep 2026')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Aug 2026' }))

    // THE PuzzleMonth, NOT THE LABEL. `?month=` is 'YYYY-MM'; handing back
    // 'Aug 2026' would round-trip through validateSearch's shape gate and be
    // dropped, leaving the control apparently dead.
    expect(onChange).toHaveBeenCalledWith('2026-08')
  })
})
