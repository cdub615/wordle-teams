/**
 * Pure Wordle display logic, ported from v1 (src/components/wordle-board.tsx
 * and src/components/app-grid-items/scores-table/table-config.tsx).
 *
 * Kept separate from the components so the duplicate-letter rules — the part
 * most likely to regress — can be unit tested without a DOM.
 */

export type TileState = 'correct' | 'present' | 'absent' | 'empty'

const countLetters = (str: string, letter: string) =>
  str?.split('')?.filter((c) => c === letter)?.length ?? 0

/**
 * Tile state for each of the five columns of one guess.
 *
 * Faithful port of v1's getLetterColorsForWord, including its two-pass
 * duplicate handling, which is the subtle part:
 *
 *   Pass 1 — exact matches claim the letter and count it. A letter that exists
 *   elsewhere in the answer is 'present' only while the running count for that
 *   letter has not exceeded how many times it appears in the answer; past that
 *   it degrades to 'absent'.
 *
 *   Pass 2 — a 'present' tile is demoted to 'absent' if the running count has
 *   overshot AND a LATER column scored 'correct' for the same letter. Without
 *   this, "EERIE" against an answer with one E would light two tiles.
 *
 * An empty or absent answer yields all-'empty', matching v1, which renders the
 * bare grid until an answer exists.
 */
export function tileStates(answer: string, guess: string): Array<TileState> {
  const states: Array<TileState> = ['empty', 'empty', 'empty', 'empty', 'empty']
  if (!guess) return states
  if (!answer || answer.length !== 5) return states

  const seen = new Map<string, number>()

  for (let i = 0; i < 5; i++) {
    const letter = guess[i]
    if (!letter) {
      states[i] = 'empty'
      continue
    }
    if (letter === answer[i]) {
      seen.set(letter, (seen.get(letter) ?? 0) + 1)
      states[i] = 'correct'
      continue
    }
    if (answer.includes(letter)) {
      seen.set(letter, (seen.get(letter) ?? 0) + 1)
      states[i] =
        (seen.get(letter) ?? 0) <= countLetters(answer, letter) ? 'present' : 'absent'
      continue
    }
    states[i] = 'absent'
  }

  for (let i = 0; i < 5; i++) {
    if (states[i] !== 'present') continue
    const letter = guess[i]
    const overshot = (seen.get(letter) ?? 0) > countLetters(answer, letter)
    const laterGreenSameLetter = states
      .slice(i + 1)
      .some((s, offset) => s === 'correct' && guess[i + 1 + offset] === letter)
    if (overshot && laterGreenSameLetter) states[i] = 'absent'
  }

  return states
}

/** Pad a guess list out to the board's six rows. Non-mutating, unlike v1's padArray. */
export function toRows(guesses: Array<string>, rows = 6): Array<string> {
  return Array.from({ length: rows }, (_, i) => guesses[i] ?? '')
}

export type ScoreCell = number | 'X' | ''

/**
 * What one day's cell shows in the scores table. Ported from v1's table-config.
 *
 *   no score, day already past      -> 0     (a missed day scores zero)
 *   no score, today or later        -> ''    (not due yet)
 *   score present, 7 attempts       -> 'X'   (failed)
 *   score present, 0/absent, not past -> ''  (started but nothing recorded yet)
 *   otherwise                       -> the attempt count
 *
 * Weekends on a team with playWeekends off render 'N/A' instead; that is a
 * column-level rule and lives in the cell component, matching v1.
 */
export function scoreCell(opts: {
  attempts?: number | null
  hasScore: boolean
  isBeforeToday: boolean
}): ScoreCell {
  const { attempts, hasScore, isBeforeToday } = opts
  if (!hasScore) return isBeforeToday ? 0 : ''
  if (!attempts && !isBeforeToday) return ''
  if (attempts === 7) return 'X'
  return attempts ?? 0
}
