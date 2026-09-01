import { describe, expect, test } from 'vitest'
import { celebrationView, type WinnerRow } from './celebration.ts'

/**
 * THE COPY IS ASSERTED AS WHOLE STRINGS, not by substring.
 *
 * v1's defect is precisely that the right words surround the wrong name, so
 * `toContain('won last month')` would pass on the bug this file exists to keep
 * out. Each assertion below is an exact sentence, and the "somebody else won"
 * pair additionally asserts that the VIEWER's name appears nowhere in it — the
 * bounded negative that a substring check cannot express.
 */

const row = (over: Partial<WinnerRow> = {}): WinnerRow => ({
  teamName: 'Wordlers',
  winner: { id: 'p_ada', firstName: 'Ada', lastName: 'Lovelace' },
  hasSeen: false,
  ...over,
})

describe('celebrationView', () => {
  test('the viewer WON: congratulates them by first name', () => {
    expect(celebrationView(row(), 'p_ada')).toEqual({
      shouldOpen: true,
      viewerWon: true,
      title: 'Congratulations Ada!',
      message: 'You won last month for Wordlers. Nice work! 🎉',
    })
  })

  test('SOMEBODY ELSE won: names the WINNER, and never the viewer — v1 names the viewer', () => {
    // v1 renders `{user.firstName} {user.lastName} won!` where `user` is the
    // viewer, so Grace is told "Grace Hopper won!" and then "Grace Hopper won
    // last month for Wordlers. Better luck next time!" in the same dialog.
    const view = celebrationView(row(), 'p_grace')

    expect(view).toEqual({
      shouldOpen: true,
      viewerWon: false,
      title: 'Ada Lovelace won!',
      message: 'Ada Lovelace won last month for Wordlers. Better luck next time!',
    })
    // celebrationView is not given a viewer NAME at all, which is what makes
    // v1's mistake unrepresentable rather than merely absent. This pins that
    // the id it is given is used for the comparison and nothing else.
    expect(view?.title.includes('p_grace')).toBe(false)
    expect(view?.message.includes('p_grace')).toBe(false)
  })

  test('already seen: the copy is unchanged, only shouldOpen goes false', () => {
    // Both halves matter. A `return null` here would take the copy with it, and
    // the dialog is deliberately still readable after the mutation flips this
    // field — see the latch in monthly-winner-celebration.tsx.
    expect(celebrationView(row({ hasSeen: true }), 'p_ada')).toEqual({
      shouldOpen: false,
      viewerWon: true,
      title: 'Congratulations Ada!',
      message: 'You won last month for Wordlers. Nice work! 🎉',
    })
  })

  test('no winner row: null, for both the null and the undefined the query can hand back', () => {
    // `null` is the answer for a month with no winner; `undefined` is what a
    // plain (non-suspending) useQuery holds before it has resolved.
    expect(celebrationView(null, 'p_ada')).toBeNull()
    expect(celebrationView(undefined, 'p_ada')).toBeNull()
  })

  test('no known viewer: null, NOT "somebody else won"', () => {
    // getMyPlayerId is a plain query too, so it is briefly undefined. Treating
    // that as "not the winner" would show the winner the third-person copy for
    // a frame, and would let a render with no identity name a winner at all.
    expect(celebrationView(row(), null)).toBeNull()
    expect(celebrationView(row(), undefined)).toBeNull()
  })
})
