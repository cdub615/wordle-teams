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
   * A COMPLETE ANSWER IS NOT ASKED FOR AGAIN (wordle-teams-x7ds).
   *
   * The old line here was "Type today's answer — five letters", and the argument
   * for it was that 'answer-full' changes no text, so the live region stays quiet.
   * THE LIVE-REGION HALF OF THAT WAS TRUE AND THE LINE WAS STILL WRONG: it is
   * wrong BEFORE the refusal. Tapping a complete answer moves the zone with
   * `refused` null, and a player who has done nothing but tap is then told to type
   * an answer they have already typed, where every key is silently refused.
   *
   * SO THE ASSERTION IS THE STATE, NOT THE REFUSAL — the pair below is the point.
   * The refusal changes nothing, which is what "the refusals stay silent" means.
   */
  test('a complete answer is told how to change it, not asked for again', () => {
    expect(line({ answer: 'CRANE' })).toBe("Answer's in — backspace to change it")
    expect(line({ answer: 'CRANE' }, 'answer-full')).toBe("Answer's in — backspace to change it")
  })

  /**
   * AND AN INCOMPLETE ONE IS STILL ASKED FOR, which is what stops the test above
   * being satisfied by a function that never asks for an answer at all.
   */
  test('a partial answer is still asked for', () => {
    expect(line({ answer: 'CRAN' })).toBe("Type today's answer — five letters")
  })

  /**
   * `>=`, NOT `===`. coachFor is the one place that reads UNNORMALISED state:
   * convex/schema.ts stores the answer unconstrained, so a six-letter answer
   * reaches this function intact while `typeLetter` — which normalises first —
   * refuses every key as 'answer-full'. With `===` the corrupt board's owner is
   * told to type an answer that cannot be typed.
   */
  test('an over-long stored answer counts as complete, because typeLetter treats it as one', () => {
    expect(line({ answer: 'CRANES' })).toBe("Answer's in — backspace to change it")
  })

  /**
   * THE CARET IN THE MIDDLE OF THE BOARD, WHICH HAPPENS NOWHERE ELSE, and it is
   * reached by an ordinary partial import: `prefillFrom` places each parsed row at
   * its parsed POSITION and leaves an unread one blank, so a board solved on a
   * later row arrives exactly like this, with the answer the solve supplied.
   *
   * THE LINE HAS NOW BEEN WRONG TWICE, AND FOR OPPOSITE REASONS. x7ds found it
   * saying "Keep typing. Backspace goes back a letter" when `typeLetter` refused
   * every key and `backspace` deleted nothing — both instructions false — and
   * replaced it with copy that sent the player to the answer zone, which was then
   * the only escape. wordle-teams-1nvo removed the dead end: `openSlot` accepts a
   * letter in a gap BEFORE the solving row, so the answer zone is no longer
   * involved and the instruction is simply to type the row.
   *
   * ASSERTED WITHOUT THE REFUSAL FIRST, because that is the case that matters: the
   * import lands on the confirm step with `refused` null and the line has to be
   * right there, before any key is pressed.
   */
  test('a blank gap row is named, with the instruction to type it', () => {
    const gapped = { answer: 'CRANE', zone: 'board' as const, guesses: ['', 'CRANE', '', '', '', ''] }
    expect(line(gapped)).toBe('Row 1 is blank — type the guess that goes there')
    expect(line(gapped, 'board-solved')).toBe('Row 1 is blank — type the guess that goes there')
  })

  /**
   * THE ROW NUMBER IS READ OFF THE CARET, NOT HARDCODED. Without this the test
   * above passes against a function that says "Row 1" for every gapped board, and
   * row 1 is the only row the common case names — so the one assertion that can
   * tell the difference is a gap somewhere else.
   */
  test('the named row is the one the caret is on', () => {
    expect(
      line({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', '', 'CRANE', '', '', ''] }),
    ).toBe('Row 2 is blank — type the guess that goes there')
  })

  /**
   * AND "BLANK" HAS TO BE TRUE OF IT. Once the player starts the gap row it is no
   * longer blank, and the ordinary keep-typing line is both accurate and the right
   * thing to say — so the special line stands down rather than describing a row
   * that now has letters in it.
   *
   * THIS IS ALSO THE CASE THAT FORCED THE SWITCH TO `cursorFor`. The scan this
   * replaced looked for the first EMPTY row before the solve, which here is row 2
   * — while the caret is on row 1, mid-word. It would have named the wrong row.
   */
  test('a gap row that is already started falls back to keep-typing', () => {
    expect(
      line({ answer: 'CRANE', zone: 'board', guesses: ['SLA', '', 'CRANE', '', '', ''] }),
    ).toBe('Keep typing. Backspace goes back a letter')
  })

  /**
   * AND IT IS ONLY SAID FOR A GAP. A solve with nothing blank before it has no
   * caret at all (`openSlot` refuses every remaining slot), so there is no row to
   * name and the ordinary line stands. That shape is unreachable through the app —
   * a parse reads only played rows and a solve ends the game, so nothing follows
   * the solving row — which is exactly why the guard is here rather than a comment
   * asserting it cannot happen.
   */
  test('a solve with no blank row above it keeps the ordinary line', () => {
    expect(
      line({ answer: 'CRANE', zone: 'board', guesses: ['CRANE', 'SLATE', '', '', '', ''] }),
    ).toBe('Keep typing. Backspace goes back a letter')
  })

  /**
   * A LOWERCASE STORED ANSWER STILL FINDS THE SOLVE. coachFor reads unnormalised
   * state, so both queries it asks — `solvedRow` and `cursorFor` — normalise for
   * it. A local `row === answer` scan over here would miss this and go back to
   * telling the player to keep typing.
   */
  test('the solve is found through a lowercase stored answer', () => {
    expect(
      line({ answer: 'crane', zone: 'board', guesses: ['', 'CRANE', '', '', '', ''] }),
    ).toBe('Row 1 is blank — type the guess that goes there')
  })

  /**
   * 'board-full' WITH `valid` FALSE STAYS SILENT, AND THAT IS AN OWNER DECISION
   * TAKEN WITH THE OTHER TWO IN FRONT OF THEM (wordle-teams-x7ds), not the
   * "same edge case as above" this comment used to claim — the case above turned
   * out to be an ordinary partial import and got copy of its own.
   *
   * WHAT MAKES THIS ONE DIFFERENT IS THAT THE LINE IS HALF TRUE AND THE HALF THAT
   * IS TRUE IS THE WAY OUT. It takes a stored row LONGER than five letters, which
   * neither typing nor a parse can produce — boardIsValid's "every guess 0 or 5"
   * rejects it, so no write in this app creates it. "Keep typing" is false there,
   * but "Backspace goes back a letter" is TRUE and it recovers the board: nextSlot
   * is null, so `backspace` erases from the last row. A player who follows the
   * line gets unstuck, which is the opposite of the two cases above.
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
