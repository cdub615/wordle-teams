// @vitest-environment jsdom
//
// jsdom, `.test.ts` with createElement and no jest-dom, for the reasons
// challenges.hook.test.ts gives at its top.
//
// THE CHALLENGES CARD'S OWN ERROR BOUNDARY (zic8.2.21 M5). A challengesForTeam
// failure used to reach the route's DashboardError and replace the whole /team
// page — member management included — for a section that is an extra. These
// render the real boundary (TanStack Router's CatchBoundary, unmocked) around a
// child that throws, beside a sibling standing in for the rest of the page.
// routes.test.ts pins that routes/team.tsx actually wraps the card in it.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }))
vi.mock('#/lib/sentry-capture.ts', () => ({ captureError }))

const { ChallengesBoundary } = await import('./challenges-boundary.tsx')

const failure = new Error('challengesForTeam failed')

function Throws(): never {
  throw failure
}

function Fine() {
  return createElement('p', null, 'the card')
}

/** The rest of the page, OUTSIDE the boundary, and the card inside it. */
function page(resetKey: string, child: () => ReactElement) {
  return createElement(
    'div',
    null,
    createElement('p', null, 'Members'),
    createElement(ChallengesBoundary, { resetKey, children: createElement(child) }),
  )
}

beforeEach(() => {
  captureError.mockClear()
  // React logs every caught render error; the throw is the point here.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChallengesBoundary', () => {
  test('a throw inside it leaves the rest of the page, and says ONE muted line', () => {
    const { container } = render(page('team-1', Throws))
    // The sibling survived: the error stopped at the card.
    expect(screen.queryByText('Members')).not.toBeNull()
    const line = screen.getByText("Challenges couldn't load.")
    expect(line.className).toContain('text-muted-foreground')
    // And nothing else: no heading, no retry, no error text.
    expect(container.textContent).toBe("MembersChallenges couldn't load.")
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryAllByRole('heading')).toEqual([])
  })

  test('the failure is reported, since the route boundary that used to see it no longer does', () => {
    render(page('team-1', Throws))
    expect(captureError).toHaveBeenCalledWith(failure, { boundary: 'challenges' })
  })

  test('(control) with nothing thrown, it renders its child and nothing of its own', () => {
    const { container } = render(page('team-1', Fine))
    expect(container.textContent).toBe('Membersthe card')
    expect(captureError).not.toHaveBeenCalled()
  })

  test('a new resetKey (another team) tries again rather than keeping the error', () => {
    const { rerender } = render(page('team-1', Throws))
    expect(screen.queryByText("Challenges couldn't load.")).not.toBeNull()
    rerender(page('team-2', Fine))
    expect(screen.queryByText("Challenges couldn't load.")).toBeNull()
    expect(screen.queryByText('the card')).not.toBeNull()
  })
})
