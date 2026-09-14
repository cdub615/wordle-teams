import { describe, expect, test } from 'vitest'
import { coachFor } from './entry-coach.ts'
import type { EntryState, Refusal } from './entry-cursor.ts'

const EMPTY_ROWS = ['', '', '', '', '', '']

const state = (over: Partial<EntryState> = {}): EntryState => ({
  answer: '',
  guesses: [...EMPTY_ROWS],
  zone: 'answer',
  ...over,
})

const line = (over: Partial<EntryState>, refused: Refusal | null = null, valid = false) =>
  coachFor({ state: state(over), refused, valid })

describe('coachFor', () => {
  test('opens by asking for the answer', () => {
    expect(line({})).toBe("Type today's answer — five letters")
  })

  /**
   * The refusal outranks the zone, because it is a reply to something the
   * player just did. Without this the coach line would go on calmly asking for
   * the answer while the click that was just ignored goes unexplained.
   */
  test('an early click on the board is answered directly', () => {
    expect(line({ answer: 'CRA' }, 'answer-incomplete')).toBe(
      'Answer first — then the board takes over',
    )
  })

  /**
   * 'not-a-letter' IS DELIBERATELY NOT ANNOUNCED. It fires for Shift, arrow
   * keys and F5 as readily as for a printable mistake, and this line is read
   * aloud by a live region. A player pressing an arrow key has not made a
   * mistake and does not need telling.
   */
  test('a key that is not a letter is passed over in silence', () => {
    expect(line({}, 'not-a-letter')).toBe("Type today's answer — five letters")
    expect(line({ answer: 'CRANE', zone: 'board' }, 'not-a-letter')).toBe(
      'Now type your first guess — rows advance on their own',
    )
  })

  test('asks for the first guess once the cursor has handed off', () => {
    expect(line({ answer: 'CRANE', zone: 'board' })).toBe(
      'Now type your first guess — rows advance on their own',
    )
  })

  test('says backspace goes back once a guess is under way', () => {
    expect(line({ answer: 'CRANE', zone: 'board', guesses: ['SL', '', '', '', '', ''] })).toBe(
      'Keep typing. Backspace goes back a letter',
    )
  })

  test('a complete board is told it can submit', () => {
    expect(
      line({ answer: 'CRANE', zone: 'board', guesses: ['CRANE', '', '', '', '', ''] }, null, true),
    ).toBe('Looks complete — press Enter or Submit')
  })

  /**
   * A refusal the branch never matches falls through to the validity line —
   * but 'board-solved' is unmatched in EITHER ordering (the refusal branch only
   * ever tests for 'answer-incomplete'), so this alone cannot show that validity
   * is actually checked first. The ordering itself is pinned by the test below,
   * which uses the one refusal the branch does match.
   */
  test('a refusal the branch does not match falls through to validity', () => {
    expect(
      line(
        { answer: 'CRANE', zone: 'board', guesses: ['CRANE', '', '', '', '', ''] },
        'board-solved',
        true,
      ),
    ).toBe('Looks complete — press Enter or Submit')
  })

  /**
   * THE PRECEDENCE THIS PAIR ACTUALLY DECIDES, and it is reachable rather than
   * theoretical: boardIsValid's empty-board branch returns `hasExistingScore`, so
   * a player CLEARING an existing score has valid: true with an empty answer —
   * and a click on the board at that moment refuses 'answer-incomplete'. Telling
   * them to answer first, when what they have done is already submittable, would
   * be the wrong instruction at the one moment they are finishing.
   *
   * The sibling test above uses 'board-solved', which the refusal branch never
   * matches in EITHER order, so it cannot pin this. Swapping the two rules leaves
   * it green; this one goes red.
   */
  test('validity outranks the refusal the branch actually matches', () => {
    expect(line({}, 'answer-incomplete', true)).toBe('Looks complete — press Enter or Submit')
  })

  /**
   * 'answer-full' DELIBERATELY FALLS THROUGH to the ordinary answer-zone line.
   * A sixth letter never changes the zone (only a successful hand-off does), so
   * the line is byte-identical to the one already on screen before the
   * keystroke — an aria-live region only re-announces on a text change, so this
   * is silence in practice, same spirit as 'not-a-letter', and the five filled
   * slots already show the player why nothing happened.
   */
  test('answer-full falls through to the unchanged answer prompt', () => {
    expect(line({ answer: 'CRANE' }, 'answer-full')).toBe("Type today's answer — five letters")
  })

  /**
   * 'board-solved' can fire with `valid` false: boardIsValid also requires
   * rows[0] to be full, which a gapped board loaded from an unconstrained
   * convex/schema.ts row need not satisfy even when some later row equals the
   * answer. That combination is a corrupt-import edge case, not a state normal
   * typing reaches, so the ordinary keep-typing line is judged good enough
   * rather than inventing copy for it.
   */
  test('board-solved without valid falls through to keep-typing', () => {
    expect(
      line(
        { answer: 'CRANE', zone: 'board', guesses: ['', 'CRANE', '', '', '', ''] },
        'board-solved',
        false,
      ),
    ).toBe('Keep typing. Backspace goes back a letter')
  })

  /**
   * 'board-full' can likewise fire with `valid` false, if an imported row is
   * longer than five letters — boardIsValid's "every guess 0 or 5" check fails
   * even though nextSlot sees no room left. Same corrupt-import edge case as
   * above: the fall-through is deliberate, not an oversight.
   */
  test('board-full without valid falls through to keep-typing', () => {
    expect(
      line(
        {
          answer: 'CRANE',
          zone: 'board',
          guesses: ['CRANEX', 'SLATE', 'SLATE', 'SLATE', 'SLATE', 'SLATE'],
        },
        'board-full',
        false,
      ),
    ).toBe('Keep typing. Backspace goes back a letter')
  })
})
