import type { Bitmap } from './bitmap.ts'
import { feedbackFor } from './feedback.ts'
import { resolveBoard, resolveRow } from './repair.ts'
import { classifyColours } from './stages/colour.ts'
import type { ColourOptions, MarkGrid } from './stages/colour.ts'
import { detectLattice } from './stages/lattice.ts'
import type { Lattice, LatticeOptions } from './stages/lattice.ts'
import { readRow } from './stages/glyphs.ts'
import type { GlyphOptions } from './stages/glyphs.ts'
import type { LetterScores, Mark, RowObservation } from './types.ts'
import { acceptedGuesses } from './wordlist.ts'

/**
 * Screenshot in, board out. Stages 1 to 3 feed Part 1's resolveBoard.
 *
 * NOTHING HERE IS ALLOWED TO RETURN NOTHING. Every outcome carries whatever was
 * recovered, because the caller is a form the user is about to confirm: a board
 * with four of six rows read is four rows they do not have to type, and a total
 * failure that still knows the board's geometry is still worth something. The
 * shipping bar the spec sets is "knows when it failed", not "never wrong" —
 * which is only affordable because no parse is ever saved without a confirm.
 *
 * THE TWO COLOUR READINGS ARE RESOLVED HERE, not in Stage 2. Stage 2 cannot
 * tell 'present' from 'correct' without knowing the word, so it hands over both
 * mappings; whichever one colours a real accepted guess against the answer is
 * the right one. That is the same constraint that repairs a shaky glyph, used
 * for a second purpose.
 */

export type ParseOutcome =
  /** Every played row resolved to a word. */
  | 'ok'
  /** Some rows resolved and some did not. The ones that did are still worth having. */
  | 'partial'
  /** Stage 1 found no five-wide lattice. Not a Wordle board, or not enough of one. */
  | 'no-board'
  /** A lattice of coloured squares with NO LETTERS: the emoji grid people post. */
  | 'share-card'
  /** A board, but nothing has been played on it yet. */
  | 'nothing-played'
  /** Colours that no board produces. */
  | 'unreadable-colours'
  /** Letters were read and not one row matched an accepted guess. */
  | 'no-consistent-word'

export type ParsedGuess = {
  /** Which row of the lattice this was, so a gap in the board is visible. */
  readonly row: number
  readonly word: string
  readonly marks: ReadonlyArray<Mark>
}

export type UnresolvedRow = {
  readonly row: number
  /** What Stage 2 read, when it got that far. */
  readonly marks: ReadonlyArray<Mark> | null
  /** The reader's first choice per tile — a starting point for the user, not an answer. */
  readonly letters: string
}

/**
 * Everything the IMAGE had to say, before the answer was taken into account.
 *
 * THE ANSWER IS NOT READ FROM THE IMAGE — it is a CONSTRAINT the image can only
 * supply when the board was solved. Stages 1 to 3 are entirely
 * answer-independent: the lattice, the colours and the glyphs come out
 * identical whether or not anybody knows the word. Only Stage 4's second
 * constraint uses it, which is why an answer arriving later needs no second
 * look at the pixels — see resolveWithAnswer.
 *
 * A few kilobytes, so it costs nothing to carry. A decoded phone screenshot is
 * twelve megabytes, and keeping one alive to re-read later would be the
 * expensive way to obtain the same result.
 */
export type ParseEvidence = {
  /** Lattice row indices that carried a submitted guess. */
  readonly rows: ReadonlyArray<number>
  /** Per played row, per tile: what the reader thought each letter was. */
  readonly letters: ReadonlyArray<ReadonlyArray<LetterScores>>
  /** The one or two candidate mark grids Stage 2 could not choose between. */
  readonly readings: ReadonlyArray<MarkGrid>
  readonly unreadable: ReadonlyArray<number>
}

export type BoardParse = {
  readonly outcome: ParseOutcome
  readonly answer: string | null
  readonly guesses: ReadonlyArray<ParsedGuess>
  readonly unresolved: ReadonlyArray<UnresolvedRow>
  /** Kept even on failure: the geometry is worth something to the caller. */
  readonly lattice: Lattice | null
  /** Null when there was never a board to gather any. */
  readonly evidence: ParseEvidence | null
}

export type ParseOptions = {
  readonly lattice?: LatticeOptions
  readonly colour?: ColourOptions
  readonly glyphs?: GlyphOptions
  /** The day's answer, when the caller knows it. The entry form asks. */
  readonly answer?: string | null
  /** Defaults to the shipped accepted-guess list. */
  readonly words?: ReadonlyArray<string>
}

const nothing = (outcome: ParseOutcome, lattice: Lattice | null): BoardParse => ({
  outcome,
  answer: null,
  guesses: [],
  unresolved: [],
  lattice,
  evidence: null,
})

/** The reader's first choice, or a dot where it had none. */
function topLetter(scores: LetterScores): string {
  let best: string | null = null
  let bestScore = 0
  for (const [letter, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = letter
      bestScore = score
    }
  }
  return best ?? '.'
}

export function parseBoard(bitmap: Bitmap, options: ParseOptions = {}): BoardParse {
  const found = detectLattice(bitmap, options.lattice)
  if (!found.ok) return nothing('no-board', null)
  const lattice = found.lattice

  const colours = classifyColours(bitmap, lattice, options.colour)
  if (!colours.ok) {
    return nothing(colours.reason === 'no-played-rows' ? 'nothing-played' : 'unreadable-colours', lattice)
  }

  const letters = colours.rows.map((row) => readRow(bitmap, lattice.tiles[row], options.glyphs))

  // A SHARE CARD IS A REAL INPUT, not a misread, and saying so specifically is
  // the difference between "we cannot read your screenshot" and "that is the
  // emoji grid, paste the board itself". Coloured squares, no text anywhere.
  if (letters.every((row) => row.every((scores) => Object.keys(scores).length === 0))) {
    return nothing('share-card', lattice)
  }

  const words = options.words ?? acceptedGuesses()
  const supplied = options.answer ?? null

  // BOTH MAPPINGS ARE TRIED AND THE PIXELS PICK THE WINNER.
  //
  // Taking the first reading that merely RESOLVES is not good enough, and this
  // is not a corner case — it failed most of the round-trip property test. With
  // ~13,000 accepted guesses, almost any mark pattern has some word that fits
  // it, so a present/correct swap does not fail: it quietly returns a different
  // real word. PRUDE against FOLIE came back as CRUDO that way.
  //
  // The reading the GLYPH READER agrees with is the right one, so each attempt
  // is scored by how much of the letter confidence its words actually account
  // for. The wrong mapping has to find words the reader never saw, and scores
  // far lower for it. That is the same evidence Stage 4 uses to break a tie
  // between words, applied one level up to break the tie between readings.
  const evidence: ParseEvidence = {
    rows: colours.rows,
    letters,
    readings: colours.readings,
    unreadable: colours.unreadable,
  }

  return resolveFrom(evidence, lattice, words, supplied)
}

/**
 * Picks the best reading of the evidence under a given answer.
 *
 * Shared by the first parse and by resolveWithAnswer, so the two cannot drift:
 * an answer arriving later has to be weighed exactly as one supplied up front.
 */
function resolveFrom(
  evidence: ParseEvidence,
  lattice: Lattice | null,
  words: ReadonlyArray<string>,
  supplied: string | null,
): BoardParse {
  let best: { parse: Omit<BoardParse, 'evidence'>; score: number } | null = null
  for (const reading of evidence.readings) {
    const attempt = attemptReading(reading, evidence.letters, evidence, words, supplied, lattice)
    if (best === null || attempt.score > best.score) best = attempt
  }

  const parse: Omit<BoardParse, 'evidence'> = best?.parse ?? nothing('no-consistent-word', lattice)
  return { ...parse, evidence }
}

/**
 * The same board, resolved again now that the answer is known.
 *
 * WHY THERE IS NO SECOND PARSE HERE, which is the whole point of this function.
 * Nothing about the image is read differently when the answer is known —
 * lattice, colours and glyphs are all answer-independent — so re-reading the
 * pixels would recompute identical intermediates and differ only in the last
 * step. This runs only that last step, off evidence the first parse already
 * built, in well under a millisecond and with no bitmap or blob kept alive.
 *
 * WHEN IT IS WORTH DOING. On a SOLVED board, never: the winning row IS the
 * answer, so the first parse already derived it and used it everywhere, and
 * across the real corpus it got 18 of 18 right that way. On an UNSOLVED board
 * it is the opposite — there is no winning row, so Stage 4's second constraint
 * was simply unavailable and every row leaned on the word list and the glyph
 * reader alone. That is exactly where the corpus lost rows: one screenshot read
 * DRYLY for WRYLY, and knowing the answer recovers it, because WRYLY colours
 * .CCCC against DRYLY while DRYLY colours CCCCC.
 *
 * It cannot rescue everything and does not pretend to. SLATE and BLATE colour
 * identically against DRYLY — both all-absent — so no answer can separate them.
 */
export function resolveWithAnswer(
  parse: BoardParse,
  answer: string,
  words: ReadonlyArray<string> = acceptedGuesses(),
): BoardParse {
  if (parse.evidence === null) return parse
  return resolveFrom(parse.evidence, parse.lattice, words, answer.toUpperCase())
}

/** How much of what the reader saw a candidate word actually accounts for. */
function confidenceIn(observation: RowObservation, word: string): number {
  let total = 0
  for (let i = 0; i < word.length; i++) total += observation.letters[i][word[i]] ?? 0
  return total
}

/**
 * Resolves the board under one colour reading, keeping whatever it recovers.
 *
 * ROW BY ROW WHEN THE BOARD AS A WHOLE WILL NOT GO. resolveBoard is deliberately
 * all-or-nothing — one unreadable row fails it — and a user looking at five
 * rows they do not have to retype is far better served than one looking at
 * none.
 *
 * A ROW THE READER SAW NOTHING IN IS NOT RESOLVED, whatever comes back for it.
 * With every letter confidence at zero, resolveRow still returns the first word
 * the colours admit — a real word, arrived at by no evidence at all, and
 * indistinguishable in the result from one that was actually read. Those are
 * demoted to unresolved rather than shown to the user as a reading.
 */
function attemptReading(
  reading: MarkGrid,
  letters: ReadonlyArray<ReadonlyArray<LetterScores>>,
  colours: Pick<ParseEvidence, 'rows' | 'unreadable'>,
  words: ReadonlyArray<string>,
  supplied: string | null,
  lattice: Lattice | null,
): { parse: Omit<BoardParse, 'evidence'>; score: number } {
  const observations = toObservations(letters, reading)
  const guesses: Array<ParsedGuess> = []
  const unresolved: Array<UnresolvedRow> = [...unreadableRows(colours.unreadable)]
  let score = 0

  const whole = resolveBoard(observations, words, supplied)
  let answer = whole.ok ? whole.answer : deriveAnswer(observations, words, supplied)

  observations.forEach((observation, index) => {
    const row = colours.rows[index]
    const resolved = whole.ok
      ? ({ ok: true, word: whole.words[index] } as const)
      : resolveRow(observation, words, answer)

    const confidence = resolved.ok ? confidenceIn(observation, resolved.word) : 0
    if (resolved.ok && confidence > 0) {
      score += confidence
      guesses.push({
        row,
        word: resolved.word,
        // FROM THE RULES, NOT FROM THE PIXELS. Once the word and the answer are
        // both known, Wordle's own colouring is more trustworthy than anything
        // read off a screenshot, and it cannot disagree with the word shown.
        marks: answer === null ? observation.marks : feedbackFor(resolved.word, answer),
      })
      return
    }
    unresolved.push({ row, marks: observation.marks, letters: letters[index].map(topLetter).join('') })
  })

  // An answer derived from a row that then turned out to be unresolvable is not
  // an answer. It is the same guess wearing a different hat.
  if (answer !== null && supplied === null && !guesses.some((guess) => guess.word === answer)) answer = null

  const outcome: ParseOutcome =
    guesses.length === 0 ? 'no-consistent-word' : unresolved.length === 0 ? 'ok' : 'partial'

  return {
    parse: {
      outcome,
      answer,
      guesses,
      unresolved: [...unresolved].sort((a, b) => a.row - b.row),
      lattice,
    },
    score,
  }
}

/**
 * The answer, when the caller has none: the all-correct row IS it.
 *
 * The same two passes resolveBoard uses, and for the same reason — reading that
 * row wants the answer as a constraint, and it is the answer.
 */
function deriveAnswer(
  observations: ReadonlyArray<RowObservation>,
  words: ReadonlyArray<string>,
  supplied: string | null,
): string | null {
  if (supplied !== null) return supplied.toUpperCase()
  const winning = observations.findIndex((row) => row.marks.every((mark) => mark === 'correct'))
  if (winning === -1) return null
  const derived = resolveRow(observations[winning], words, null)
  return derived.ok && confidenceIn(observations[winning], derived.word) > 0 ? derived.word : null
}

function toObservations(
  letters: ReadonlyArray<ReadonlyArray<LetterScores>>,
  reading: MarkGrid,
): Array<RowObservation> {
  return letters.map((row, index) => ({ letters: row, marks: reading[index] }))
}

function unreadableRows(rows: ReadonlyArray<number>): Array<UnresolvedRow> {
  return rows.map((row) => ({ row, marks: null, letters: '.....' }))
}
