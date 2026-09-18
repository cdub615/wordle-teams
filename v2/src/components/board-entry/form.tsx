import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Keyboard, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { FormEventHandler, KeyboardEvent, KeyboardEventHandler } from 'react'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { DatePicker } from '#/components/date-picker.tsx'
import { BoardInput, BoardSubmit } from './board-input.tsx'
import { AnswerSlots } from './answer-slots.tsx'
import { ImportScreenshot } from './import-screenshot.tsx'
import { ImportUpsell } from './import-upsell.tsx'
import { correctionsFrom, importSummary, prefillFrom } from './import-prefill.ts'
import { pickDefaultDay } from './pick-default-day.ts'
import { ANSWER_LENGTH, backspace, cursorFor, moveZone, typeLetter } from './entry-cursor.ts'
import type { EntryState, Refusal, Zone } from './entry-cursor.ts'
import { coachFor } from './entry-coach.ts'
import { boardErrorMessage } from '#/lib/convex-error.ts'
import { cn } from '#/lib/utils.ts'
import { boardIsValid, toRows } from '../../../convex/lib/board.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { resolveWithAnswer } from '#/lib/board-import/parse.ts'
import type { BoardParse } from '#/lib/board-import/parse.ts'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FunctionReturnType } from 'convex/server'

const EMPTY_ROWS = ['', '', '', '', '', '']

/**
 * HOW FAR EACH SCROLLING KEY MOVES THE BOARD, and why the form scrolls it itself.
 *
 * The board is inside an `overflow-y-auto` container and a keyboard-only player
 * has to be able to reach the rows below the fold. That used to be the BROWSER's
 * job: focus sat on a contentEditable INSIDE that container, so leaving these
 * keys unprevented let Chromium scroll the nearest scrollable ancestor, which was
 * the board scroller.
 *
 * MOVING FOCUS ONTO AN INPUT OUTSIDE THE CONTAINER TOOK THAT AWAY, AND IT WAS
 * MEASURED BOTH WAYS. At 390x380, board scroller max scrollTop 317: with the old
 * contentEditable, PageDown/ArrowDown/End moved it 0 -> 317. With focus on the
 * hidden input, the same three keys moved it 0 -> 0 — Chromium walks up from the
 * FOCUSED element to find something to scroll, and the input is not inside the
 * scroller. (It has to be outside: see the input's own note.) So the scrolling is
 * done here instead, against the same container, and these keys are prevented
 * rather than left to a browser that would otherwise scroll the dialog.
 *
 * ARROWLEFT/ARROWRIGHT ARE ABSENT AND THAT IS NOT AN OVERSIGHT: there is nothing
 * to scroll horizontally. They are still in NAVIGATION_KEYS, so handleKeyDown
 * enters that branch, finds no entry here and RETURNS — before `preventDefault`
 * and before `typeLetter`. They therefore reach the browser (where an empty
 * one-line input does nothing with them) and produce no refusal, so nothing
 * reaches the coach line. That is unchanged from the old shape, which had the
 * same early exit; an earlier draft of this comment claimed they fell through to
 * `typeLetter` as 'not-a-letter', and they never have.
 *
 * `0.9` FOR A PAGE, matching what a browser does: a page-scroll overlaps a line or
 * two so the reader keeps their place. `40` IS ONE TILE ROW at the entry board's
 * short-viewport size (`h-14` plus the grid's `gap-1`), so an arrow key moves the
 * board by a row, which is the unit this content actually has.
 */
const SCROLL_KEYS = {
  ArrowUp: (node: HTMLElement) => node.scrollTop - 40,
  ArrowDown: (node: HTMLElement) => node.scrollTop + 40,
  PageUp: (node: HTMLElement) => node.scrollTop - node.clientHeight * 0.9,
  PageDown: (node: HTMLElement) => node.scrollTop + node.clientHeight * 0.9,
  Home: () => 0,
  End: (node: HTMLElement) => node.scrollHeight,
} as const

/**
 * Keys the form must not treat as letters, beyond Tab and the modifier combos:
 * the scrolling keys above, the two horizontal arrows that scroll nothing, and
 * F5 to reload. Space is NOT here: see handleKeyDown.
 */
const NAVIGATION_KEYS = new Set([...Object.keys(SCROLL_KEYS), 'ArrowLeft', 'ArrowRight'])
const FUNCTION_KEY = /^F\d{1,2}$/

/** Row-by-row, because entry-cursor.ts always returns a FRESH array. See applyEntry. */
const rowsEqual = (a: Array<string>, b: Array<string>) =>
  a.length === b.length && a.every((row, index) => row === b[index])

/**
 * THE LAST ROW THE PLAYER HAS ACTUALLY TYPED IN, or -1 when none of them is.
 *
 * A SCROLL TARGET AND NOTHING ELSE. Read the warning in entry-cursor.ts's
 * `backspace` before reaching for this: a reverse scan for "the last row with
 * content" was DELETED from that function because it was being used to answer
 * "where does the next letter go", which is a different question with one
 * canonical answer (`nextSlot`). Those two disagreeing on a gapped import board
 * is wordle-teams-lz3w — a live bug where backspace deleted from a row the
 * cursor was nowhere near.
 *
 * So the rule is structural, not stylistic: this is module-private, it is
 * UNEXPORTED, it has "content" rather than "next"/"active"/"cursor" in its name,
 * and it is called from exactly one place — `scrollActiveRowIntoView`'s null-cursor
 * fallback, where "which row is the player LOOKING at" genuinely is the question
 * and `cursorFor` has, correctly, declined to answer. Nothing about letter
 * placement may call it. If it ever wants to live in entry-cursor.ts, that is the
 * signal it is being misused.
 *
 * WHY IT EXISTS AT ALL: `guesses` is `toRows`-normalised to six rows always, so
 * the `guesses.length - 1` this replaced was the constant 5 (wordle-teams-3lmg).
 */
const lastRowWithContent = (guesses: Array<string>): number => {
  for (let row = guesses.length - 1; row >= 0; row -= 1) {
    if (guesses[row].length > 0) return row
  }
  return -1
}

/**
 * One month of the caller's own scores.
 *
 * Derived from getMyMonth's return type rather than written out, so the two
 * queries that feed this form cannot drift apart silently: getMyMonth exists
 * precisely to emit the shape getTeamMonthFor already emits (scores.ts:204-209),
 * and a change to either that broke the pairing would fail here at typecheck.
 */
type MyScores = FunctionReturnType<typeof api.scores.getMyMonth>

/**
 * Board entry. Ports v1's form.tsx AS IT STANDS ON dev, per amendment A3 — not
 * the version the 2026-07-16 design was written against.
 *
 * The three behaviours a335ae8 added, which a faithful port of the older code
 * would have regressed:
 *   1. handleSubmit is wrapped in try/catch
 *   2. setSubmitting(false) runs in `finally`, so the form can never be left
 *      stuck mid-submit
 *   3. the sheet closes ONLY on success — it used to close unconditionally and
 *      throw away everything the user had typed
 *
 * The third a335ae8 behaviour, a warning toast when the winner update failed, is
 * designed out rather than dropped: the winner write shares upsertBoard's
 * transaction, so the board landing while the standings go stale is no longer a
 * reachable state.
 *
 * OWNS NO QUERY, deliberately. Everything below this line is the form exactly
 * as it was; what moved out is the pair of reads that used to sit at the top,
 * because they are the ONLY part of board entry that ever needed a team. See
 * BoardEntryForm at the bottom of this file for why that had to become a
 * component boundary rather than a condition.
 */
function BoardEntryFields({
  myScores,
  playWeekends,
  month,
  onSuccess,
}: {
  myScores: MyScores
  playWeekends: boolean
  month: string
  onSuccess: () => void
}) {
  const upsert = useMutation({ mutationFn: useConvexMutation(api.scores.upsertBoard) })
  const logCorrections = useMutation({ mutationFn: useConvexMutation(api.boardImport.logCorrections) })

  /**
   * THE PRO GATE, and it is UI-ONLY BY DESIGN — Phase 3's decision 1, "read it,
   * gate the UI, enforce nothing". Nothing is enforced on the server because
   * there is nothing to enforce: the parse runs entirely in the browser, costs
   * the backend nothing, and saves through the same upsertBoard any player may
   * already call by typing. A server check here would guard a computation that
   * never reaches the server. Phase 5 owns whether that pattern changes.
   *
   * `=== true`, NOT `!isPro`. amIPro answers `undefined` while it is in flight,
   * so the loose spelling shows a paid-only control to everyone on every cold
   * load and then snatches it away. For a GATE the in-flight default has to be
   * "not yet", which is the opposite of the default the Upgrade button wants —
   * see the note in Header.hook.test.ts about exactly that bug.
   */
  const { data: isPro } = useQuery(convexQuery(api.teams.amIPro, {}))

  const [day, setDay] = useState<string | undefined>(undefined)
  const [answer, setAnswer] = useState('')
  const [guesses, setGuesses] = useState<Array<string>>(EMPTY_ROWS)
  /**
   * WHICH HALF OF THE ONE ENTRY SURFACE THE NEXT KEYSTROKE LANDS IN.
   *
   * It is state rather than a derivation, because it is the one thing about the
   * caret that is not a function of the board: a complete answer with an empty
   * board is BOTH "the answer is finished" and "the player just clicked back to
   * fix it", and only a remembered zone tells those apart. Everything else about
   * the caret — which slot, which tile, whether there is one at all — comes from
   * `cursorFor` below, which takes this as its third field.
   */
  const [zone, setZone] = useState<Zone>('answer')
  /**
   * WHY THE LAST KEYSTROKE DID NOTHING, WHEN IT DID NOTHING — and it is here
   * rather than dropped on the floor because the dead end this feature exists to
   * close is not closed by `entry-cursor.ts` refusing. It is closed by the coach
   * line SAYING SO: a wiring that ignores `refused` leaves the player with the
   * original silent no-op and a green unit suite.
   */
  const [refused, setRefused] = useState<Refusal | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /**
   * The last screenshot parse, kept ONLY so the confirmed board can be diffed
   * against it. It pre-fills the fields and then has no further say: what gets
   * saved is whatever is in `answer` and `guesses` when Submit is pressed,
   * which is how "never write a parse silently" is enforced structurally
   * rather than by a check somebody could forget.
   */
  const [parsed, setParsed] = useState<BoardParse | null>(null)

  /**
   * TWO STEPS, AND THE FIRST ONE HAS NOTHING FOCUSABLE IN IT.
   *
   * Board entry used to open straight onto the answer field and focus it, so
   * the software keyboard opened with the panel and covered 55% of an iPhone
   * screen — the 6x5 board was cropped after two rows and the import control,
   * the date, the answer and the board all fought for what was left. Splitting
   * the choice of DAY AND METHOD out from the entry itself is what fixes that,
   * and it fixes it by removing the keyboard rather than by rearranging around
   * it.
   *
   * The step lives here rather than in BoardEntrySurface because the surface
   * has no opinion about what is inside it — it only picks Dialog or Sheet.
   * Keeping the step here is also what makes going back free: `answer` and
   * `guesses` are this component's state, so a part-typed board survives a
   * return to step one without anything being stashed.
   */
  const [step, setStep] = useState<'choose' | 'entry' | 'confirm'>('choose')
  /** What the import did, in words, carried across the step change that follows it. */
  const [importNote, setImportNote] = useState<string | null>(null)
  /** Rows the parse could not read. Shown, never guessed at. */
  const [missingRows, setMissingRows] = useState<ReadonlyArray<number>>([])
  /**
   * The answer THE IMAGE yielded, captured once and never re-written.
   *
   * `parsed.answer` is not the same thing after a re-resolve: on an unsolved
   * board it holds the answer the PLAYER typed. Diffing against that would log
   * a correction claiming Stage 3 misread an answer it never saw the moment
   * they fixed a typo in it — and the correction log is the labelled corpus
   * board import is measured against, so a false row there is worse than a
   * missing one.
   */
  const [derivedAnswer, setDerivedAnswer] = useState<string | null>(null)
  /** Set when the player chose to TYPE, so the entry input takes focus then and not before. */
  const [focusAnswer, setFocusAnswer] = useState(false)
  /**
   * WHETHER THE ENTRY INPUT HAS FOCUS, AND IT GATES THE CARET IN BOTH ZONES.
   *
   * `cursorFor` knows nothing about focus — it answers "where would the next
   * letter go", which is a fact about the BOARD. Drawing that unconditionally
   * rendered a blinking caret on a surface that did not have focus and could not
   * receive a keystroke, which is the original dead end with a cursor painted on
   * top of it: it happened on the unreadable-import branch below, pixel-identical
   * to the manual path that works.
   *
   * A RENDERED CARET NOW IMPLIES A FOCUSED INPUT. That is the invariant, not a
   * patch for that one branch — it also covers the confirm step, where not
   * focusing is deliberate, and any future branch that forgets. It also carries
   * more weight than it used to: the caret is drawn on elements that are NOT the
   * focus target, so `focused` is the only link between what has focus and what
   * looks like it does.
   */
  const [focused, setFocused] = useState(false)
  /**
   * THE ONE FOCUSABLE THING ON THE ENTRY STEP, AND IT IS A REAL `<input>` THAT
   * NOTHING EVER READS.
   *
   * This used to be a `contentEditable` div wrapped around the answer slots and
   * the board — React-owned content sitting inside an editing host — and the
   * ONLY reason for the editing host was to make a phone raise its keyboard.
   * Nothing was ever typed into it: every key is preventDefault'd and the letters
   * come from React state. That shape cost us wordle-teams-5n6n, because an
   * editing host accepts insertions no handler can refuse — `beforeinput` for
   * `inputType: insertCompositionText` is dispatched with `cancelable: FALSE`, so
   * an IME commit lands in the DOM under React and, in a tile the player does not
   * retype, STAYS THERE (React only rewrites a tile's text node when its letter
   * changes).
   *
   * SO THE KEYBOARD MAGNET AND THE CONTENT ARE NOW TWO DIFFERENT ELEMENTS. This
   * input takes focus, the keyboard and any composition; the slots and the board
   * are plain presentation OUTSIDE it. A composition then lands in a throwaway
   * field whose value is read by nothing and wiped on `compositionend`. Measured
   * in Chromium through CDP's own IME channel: a ten-update composition plus the
   * commit of こんにちは, then three more compositions, left every slot and every
   * tile byte-identical.
   *
   * IT LIVES OUTSIDE THE SCROLL CONTAINER, WHICH IS LOAD-BEARING (see the render).
   */
  const inputRef = useRef<HTMLInputElement>(null)
  /**
   * THE "Wordle Answer" LABEL AND THE FIVE SLOTS. THAT IS ALL, AND THE BOUNDARY
   * IS THE POINT — it exists to be SCROLLED rather than focused, and a scroll
   * target has to FIT in the scrollport to move it.
   *
   * THE LABEL IS IN because scrolling the slots alone would leave it above the
   * scrolled-to edge, on the one viewport short enough for the scroll to do
   * anything — which is the viewport where an unlabelled slots row is hardest to
   * read. THE BOARD IS OUT because it is six rows tall: with it inside, this ref
   * measured 440px against a 139px scroller on a phone and
   * `scrollIntoView({ block: 'nearest' })` was specified to do nothing at all.
   * See the render, and `scrollActiveRowIntoView`.
   */
  const answerZoneRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  /**
   * WHETHER AN IME IS MID-COMPOSITION, AND IT IS WHAT STOPS THE DRAIN BREAKING
   * THE COMPOSITION IT IS DRAINING. See `drainInput` below.
   *
   * A ref rather than state: it is read inside an event handler and must never
   * cause a render — the whole point of this input is that React does not care
   * what is in it.
   */
  const composingRef = useRef(false)

  // Deferred to an effect rather than a useState initialiser: picking the
  // default day calls new Date(), and this component also renders on the server,
  // where "now" is UTC. Same reasoning as v1's team-boards.tsx.
  useEffect(() => {
    const played = new Set(myScores.map((score) => score.puzzleDay))
    setDay(
      pickDefaultDay({
        month,
        today: toPuzzleDay(new Date()),
        playedDays: played,
        playWeekends,
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  // Load whatever is already stored for the selected day.
  const existing = day ? myScores.find((score) => score.puzzleDay === day) : undefined
  useEffect(() => {
    const prefilled = existing?.answer ?? ''
    setAnswer(prefilled)
    setGuesses(toRows(existing?.guesses ?? []))
    /**
     * THE PREFILL MOVES THE CURSOR TOO, and through `moveZone` rather than by
     * assignment so there is one rule about where a complete answer puts the
     * caret. Editing a board that is already saved arrives here with five
     * letters in hand and nothing left to type in the answer — leaving the zone
     * at 'answer' would put the caret on a full answer and refuse the player's
     * first keystroke. THE REFUSAL IS DISCARDED: the system moved, not the
     * player, so nothing reaches the coach line.
     */
    setZone(
      moveZone(
        { answer: prefilled, guesses: toRows(existing?.guesses ?? []), zone: 'answer' },
        prefilled.length === ANSWER_LENGTH ? 'board' : 'answer',
      ).next.zone,
    )
    setRefused(null)
    // A parse belongs to the day it was read for. Carrying it across a date
    // change would diff the new day's board against the old day's screenshot
    // and log corrections for tiles nobody ever saw.
    setParsed(null)
    setDerivedAnswer(null)
    setImportNote(null)
    setMissingRows([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, existing?.id])

  /**
   * FOCUS ONLY WHEN THE PLAYER ASKED TO TYPE. This effect used to run on mount,
   * which is what opened the keyboard with the panel. Arriving at the entry
   * step from an IMPORT must not focus anything: the board is already filled
   * in, and raising a keyboard over it to confirm it would be the original bug
   * with an extra step in front of it.
   *
   * IT FOCUSES THE INPUT, NOT AN ANSWER FIELD AND NOT THE BOARD. There is only
   * one focusable thing on this step and neither zone is it: which half a
   * keystroke lands in is `zone`, which is state, not focus.
   */
  useEffect(() => {
    if (!focusAnswer) return
    inputRef.current?.focus()
    setFocusAnswer(false)
  }, [focusAnswer])

  /**
   * `focused` FALSE WHEN THE INPUT CEASES TO EXIST, WHICH IS WHAT MAKES "A
   * RENDERED CARET IMPLIES A FOCUSED INPUT" AN INVARIANT RATHER THAN A HABIT.
   *
   * REACT DOES NOT FIRE `onBlur` WHEN A FOCUSED ELEMENT UNMOUNTS. The input
   * exists only on the entry and confirm steps, so going BACK to step one takes
   * focus to `<body>` with no blur event at all — and `focused` stayed true.
   * Probed on the real form: after `goToEntry`, focused=true / activeElement=INPUT;
   * after Back, activeElement=BODY; after an import, focused=true with
   * activeElement=BODY.
   *
   * THAT WAS ALREADY TRUE OF THE OLD contentEditable — it carried the identical
   * onFocus/onBlur pair — AND IT WAS HARMLESS ONLY BY COINCIDENCE: the one path
   * that reaches the confirm step without focusing is an import the parser
   * SOLVED, where `cursorFor` returns null anyway. It stops being a coincidence
   * the moment a parse carries an answer for an UNSOLVED board, which it does
   * whenever the player typed the answer before importing (parse.ts keeps a
   * SUPPLIED answer that it would otherwise discard). Then the caret is drawn on
   * a surface whose keyboard does not exist.
   *
   * THE EFFECT'S LIFETIME IS THE INPUT'S LIFETIME, which is why it is keyed on a
   * BOOLEAN rather than on `step`: entry -> confirm keeps the same input mounted
   * and focused, and clearing the flag there would blink the caret off for a
   * player who never lost the keyboard.
   */
  const entryStepIsOpen = step !== 'choose'
  useEffect(() => {
    if (!entryStepIsOpen) return
    return () => setFocused(false)
  }, [entryStepIsOpen])

  /**
   * THROW AWAY WHATEVER LANDED IN THE INPUT, BECAUSE NOTHING READS IT.
   *
   * The input exists to hold focus and raise a keyboard. Letters come from
   * `handleKeyDown`, which preventDefaults every printable key, so in normal use
   * the field never receives a character at all. What DOES reach it is everything
   * keydown cannot refuse: an IME commit, a paste, a drop, dictation. All of that
   * is harmless — the value is read by nobody — but leaving it there would let a
   * stale composition sit in the accessibility tree and would grow without bound.
   *
   * DRAINED ON `compositionend` AND ON A NON-COMPOSING `input`, NEVER ON EVERY
   * `input`. That distinction is measured, not defensive: clearing the value on
   * every `input` event restarts the IME, which reported `compositionstart ×10`
   * for a single ten-update word and would tear down a real candidate window
   * mid-choice. Guarding on `composingRef` gives the clean `compositionstart ×1 /
   * compositionend ×1` lifecycle an IME needs while still leaving the field empty
   * the instant the composition is over.
   */
  const drainInput = () => {
    const node = inputRef.current
    if (node !== null && node.value !== '') node.value = ''
  }

  /**
   * THE ANSWER AS A CONSTRAINT, THE MOMENT WE HAVE ONE.
   *
   * `parsed.answer === null` means the board on screen was NOT SOLVED, so the
   * image never carried an answer to derive — and Stage 4's second constraint,
   * that colouring a candidate word must reproduce the marks, was unavailable
   * for every row. Each one leaned on the word list and the glyph reader alone,
   * which is exactly where the real corpus lost rows.
   *
   * So the moment five letters are in, the same evidence is resolved again with
   * them. NOT a second parse: nothing about the image is read differently, and
   * resolveWithAnswer runs only the step that changes.
   *
   * IT RUNS ONCE, and the guard is the condition itself — the re-resolve sets
   * `parsed.answer`, so this cannot fire again. That is deliberate rather than
   * incidental: a player who fixes a letter on the board and then edits the
   * answer must not have their correction overwritten by a fresh resolve.
   */
  useEffect(() => {
    if (parsed === null || parsed.answer !== null || parsed.evidence === null) return
    if (answer.length !== 5) return

    const resolved = resolveWithAnswer(parsed, answer)
    const prefill = prefillFrom(resolved)
    setParsed(resolved)
    setGuesses(prefill.guesses)
    setImportNote(importSummary(resolved))
    setMissingRows(prefill.missingRows)
  }, [answer, parsed])

  /**
   * THE WHOLE OF THE CARET, IN ONE PLACE, and both halves of the surface read it:
   * `AnswerSlots` takes the answer variant's index, `BoardInput` narrows the
   * board variant to a tile. Neither derives anything of its own, so the two
   * renderings cannot disagree about where the next letter goes.
   */
  const entry: EntryState = { answer, guesses, zone }
  const cursor = cursorFor(entry)

  /**
   * SCROLLED TO THE ROW THE CURSOR IS IN, DERIVED FROM THE SAME `cursor` THE
   * RENDER USES (wordle-teams-mwbb).
   *
   * This used to read `guesses.findIndex((guess) => guess.length < 5)`, which is
   * `nextSlot`'s body inlined — a THIRD answer to "which row is active", three
   * lines from `cursorFor`'s canonical one. Two answers to that question is
   * exactly wordle-teams-lz3w, where typing scanned forwards and backspace
   * scanned backwards and a gapped import board lost a row the cursor was
   * nowhere near. It only picked a scroll target here, so a disagreement scrolled
   * to the wrong row rather than corrupting a board — but the next person to
   * change one of them would not have known to change the other.
   *
   * THE ANSWER ZONE SCROLLS TO THE ANSWER ZONE, NOT TO A ROW. The answer slots live
   * INSIDE the scroll container now, above the board, so "which row" is the wrong
   * question while the caret is up there — and answering it with the last row
   * (what a null cursor means, and what this fell back to) would scroll the thing
   * the player is typing into off the top.
   *
   * A NULL CURSOR MEANS THE LAST ROW **WITH CONTENT**, AND THAT CORRECTION IS A
   * BUG FIX, NOT A TIDY-UP. This read `guesses.length - 1`, and `guesses` is
   * always `toRows`-normalised to SIX rows — so the fallback was always row 6,
   * whatever the player had actually typed. `cursorFor` returns null exactly when
   * nothing more can be typed, which includes a SOLVE: a board solved in two
   * guesses lost its caret (correctly) and then scrolled to empty row 6
   * (wrongly), taking both of the player's rows off the top of the scroller at
   * the moment they were about to submit. Reported from a real iPhone. The same
   * line broke opening a finished board to edit it, where the effect runs on
   * mount with a null cursor. (wordle-teams-3lmg)
   */
  const scrollActiveRowIntoView = () => {
    if (cursor !== null && cursor.zone === 'answer') {
      // `answerZoneRef` IS THE LABEL AND THE SLOTS AND NOTHING ELSE, and that is
      // load-bearing rather than incidental. It used to wrap the board too —
      // roughly 500px of content against a ~139px scroller on a phone with the
      // keyboard up — and per CSSOM-View `scrollIntoView({ block: 'nearest' })`
      // on a target TALLER than the scrollport that already overlaps it does
      // NOTHING. Measured at 390x380: ref height 440 vs clientHeight 139, and the
      // call moved scrollTop by 0. So this branch silently no-opped from the day
      // it was written, and a player who backspaced the board empty got the caret
      // back in an answer zone that was above the fold and unreachable. The board
      // branch below never had the problem because it targets one tile.
      // (wordle-teams-ddjl)
      //
      // `block: 'nearest'` RATHER THAN 'start', now that the target is small
      // enough for either to work. The answer zone is the FIRST thing in the
      // scroller, so when it is off the top 'nearest' and 'start' land in the
      // same place — but 'nearest' is a no-op when the zone is already fully
      // visible, where 'start' would yank the scroller to the top on a move the
      // player can already see. Correct when it has to be, still when it does not.
      answerZoneRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }
    const index = cursor === null ? lastRowWithContent(guesses) : cursor.row
    // Nothing typed and no caret — there is no board to look at, so leave the
    // scroller where the player left it.
    if (index < 0) return
    // An attribute selector, not `#${id}`: wordle-board.tsx's tile ids are
    // "1-1", "2-1", etc, and a CSS ID selector cannot start with a digit —
    // querySelector('#1-1') throws SyntaxError (getElementById has no such
    // restriction, but that only searches the whole document, not this ref).
    scrollContainerRef.current
      ?.querySelector(`[id="${index + 1}-1"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  /**
   * `zone` IS IN THE DEPS BECAUSE FOCUS NO LONGER MOVES. This effect used to ride
   * on the board taking focus (BoardInput's `onBoardFocus`), and the hand-off
   * from the answer to the board is now a state change with no focus event at
   * all — so without `zone` here the first guess can be typed below the fold on a
   * short viewport.
   */
  // `cursor` is NOT in the deps and must not be: it is a fresh object on every
  // render, so depending on it would scroll on every render rather than on every
  // MOVE. Its two inputs that can change the target are here instead — the third,
  // `answer`, can only change the target through `isSolved`, which needs a row
  // equal to it and therefore a `guesses` change too.
  //
  // `entryStepIsOpen` IS THE ONE DEP THAT IS NOT A TARGET INPUT, AND THAT IS THE
  // POINT: it is the condition under which there is anything to scroll AT ALL.
  // Both refs are ATTACHED below the `step === 'choose'` early return — declared
  // above it, but pointing at elements that step one does not render — so on step
  // one they are null and this effect is a no-op. And the PREFILL runs there,
  // setting `answer`, `guesses` and `zone` for a saved board while the scroller
  // does not exist yet. Every target input had therefore already fired and been
  // discarded by the time the entry step mounted, and `step` was in no dep array,
  // so nothing re-fired: opening a saved board to edit it scrolled ZERO times and
  // landed at scrollTop 0 with about 43px of row 1 showing. Measured at 390x380 by
  // counting scrollIntoView calls: 0 before, and 0 after BOTH target fixes in
  // `scrollActiveRowIntoView` above, which is why neither of them could have
  // caught it. (wordle-teams-acnc)
  //
  // THE BOOLEAN, NOT `step`, for the reason the `focused` effect above spells out:
  // entry -> confirm keeps the same scroller mounted with the same content, so
  // firing there would be a scroll the player did not ask for and cannot explain.
  // false -> true is the mount, and it is the only transition that needs one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(scrollActiveRowIntoView, [guesses, zone, entryStepIsOpen])

  const submitDisabled = !day || !boardIsValid(answer, guesses, existing !== undefined)

  /**
   * THE LINE UNDER THE TITLE, AND THE ONLY WAY THE HAND-OFF REACHES SOMEBODY WHO
   * CANNOT SEE THE CURSOR MOVE. Collapsing two focus stops into one took away the
   * event a screen reader announced; this live region is what replaces it.
   *
   * `valid` IS `submitDisabled === false`, NOT `boardIsValid(...)`. Two
   * conditions make a board submittable here — a day AND a valid board — and
   * passing only the second would tell a player with a complete board and no day
   * "press Enter or Submit", out loud, while Submit sits disabled. Composing it
   * from the same flag the button reads is what makes the line and the button
   * unable to disagree.
   */
  const coach = coachFor({ state: entry, refused, valid: submitDisabled === false })

  /**
   * WRITE BACK ONLY WHAT CHANGED.
   *
   * Every operation in entry-cursor.ts returns its input NORMALISED — `toRows`,
   * so a fresh six-element array — whether or not anything moved. Writing that
   * back unconditionally re-fires the `scrollActiveRowIntoView` effect above — it
   * is keyed on `guesses` — on every Shift press and on every letter typed into
   * the ANSWER, where the board did not change at all. (Named rather than quoted
   * as a dep array: that list has changed twice and this copy of it was stale
   * both times.) `rowsEqual` rather than `!==` for exactly that
   * second case: the array is always new, its contents usually are not.
   */
  const applyEntry = (next: EntryState) => {
    if (next.answer !== answer) setAnswer(next.answer)
    if (!rowsEqual(next.guesses, guesses)) setGuesses(next.guesses)
    if (next.zone !== zone) setZone(next.zone)
  }

  /**
   * MOVE THE CARET BETWEEN THE HALVES, and the ONLY way a click does anything
   * here. `moveZone` REFUSES a move into the board while the answer is short, and
   * that refusal — surfaced through the coach line — is why the board renders at
   * full strength with no lock and no dim.
   *
   * IT ALSO PUTS FOCUS BACK ON THE INPUT, which is not a formality now that the
   * thing being clicked is NOT the focus target. Tapping a slot or a tile has to
   * end with the keyboard still up and the caret still drawn, and that is two
   * halves: the presentation wrapper preventDefaults mousedown so the browser
   * never takes focus AWAY, and this puts it back when it never had it (the first
   * tap of an import-confirm board, where nothing was focused at all).
   */
  const selectZone = (next: Zone) => {
    const result = moveZone(entry, next)
    setRefused(result.refused)
    applyEntry(result.next)
    inputRef.current?.focus()
  }

  /**
   * ONE HANDLER, ONE INPUT, BOTH ZONES. This replaces the pair that used to sit
   * either side of the boundary — `handleAnswerKeyDown` here and BoardInput's own
   * — which is the whole of what made a player click between them.
   */
  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    const key = event.key
    // Tab must reach the browser to move focus. Ctrl/Cmd combos (paste, copy,
    // select-all, ...) must NOT be treated as plain letters — Ctrl+V's keydown
    // has event.key === 'v' with no modifier check, so without this a paste
    // shortcut is typed as a literal "v". Returning without preventDefault lets
    // the browser proceed with its native action, and there is nothing left to
    // intercept: the paste lands in the throwaway input above, where `drainInput`
    // wipes it and nothing ever read it in the first place.
    if (key === 'Tab' || event.ctrlKey || event.metaKey) return
    /**
     * NAVIGATION AND FUNCTION KEYS DO NOT TYPE, and leaving them out was a real
     * cost: the board sits in an `overflow-y-auto` container, and with every key
     * but Tab preventDefault'd a keyboard-only player could not scroll it —
     * ArrowDown, PageDown, Home and End were all dead, and so was F5. (Ctrl+R
     * always worked, through the modifier return above, which is exactly the kind
     * of near-miss that hides a bug like this.)
     *
     * F5 AND THE FUNCTION KEYS STILL REACH THE BROWSER UNTOUCHED. THE SCROLLING
     * KEYS NO LONGER CAN, because focus is on an input outside the container they
     * used to scroll — so this form scrolls it, and prevents them. See SCROLL_KEYS.
     *
     * SPACE IS DELIBERATELY NOT ON THIS LIST, and the reason changed with the
     * shape. It used to be here because Space inserts a character into an editing
     * host and nothing could be relied on to refuse it; there is no editing host
     * any more. What is left is simpler: focus sits in a one-line `<input>`, where
     * Space does not scroll ANYTHING — it only types — so letting it through would
     * buy a keyboard-only player nothing and cost an `input` event to drain.
     *
     * Escape is not here because it does not need to be: Radix's dismissable
     * layer listens on the document in the CAPTURE phase and ignores
     * `defaultPrevented`, so the sheet still closes.
     */
    if (FUNCTION_KEY.test(key)) return
    if (NAVIGATION_KEYS.has(key)) {
      const scrollTo = SCROLL_KEYS[key as keyof typeof SCROLL_KEYS]
      const node = scrollContainerRef.current
      // ArrowLeft/ArrowRight have no entry: nothing scrolls horizontally, so they
      // are left to the browser, where an empty one-line input does nothing with
      // them either.
      if (scrollTo === undefined || node === null) return
      node.scrollTop = scrollTo(node)
      event.preventDefault()
      return
    }
    event.preventDefault()

    if (key === 'Backspace') {
      // NO REFUSAL TO REPORT: every way a backspace can do nothing is a state
      // `cursorFor` already draws (entry-cursor.ts's `backspace` doc), so it
      // returns plain state — and whatever the player was last told about a
      // keystroke is stale the moment they press it.
      setRefused(null)
      applyEntry(backspace(entry))
      return
    }

    if (key === 'Enter') {
      setRefused(null)
      /**
       * `submitDisabled`, NOT `boardIsValid(...)` — THE SAME COMPOSITION THE
       * COACH LINE ABOVE INSISTS ON, and for a sharper reason.
       *
       * Two conditions make this form submittable: a day AND a valid board.
       * Asking only the second sends a complete board with no day down the
       * SUCCESS branch, where it clicks a `#board-submit` that is `disabled` —
       * and `HTMLElement.click()` on a disabled button does NOTHING. No
       * mutation, no toast, no sign that a key was pressed: A SILENTLY
       * SWALLOWED KEYSTROKE, in the feature built to abolish silently swallowed
       * keystrokes. Asking the same question the button asks means the two
       * cannot disagree about what Enter does.
       */
      if (!submitDisabled) {
        document.getElementById('board-submit')?.click()
      } else {
        toast.warning('Board must be complete to submit')
      }
      return
    }

    const result = typeLetter(entry, key)
    setRefused(result.refused)
    if (result.refused === null) applyEntry(result.next)
  }

  const handleImport = (parse: BoardParse) => {
    const prefill = prefillFrom(parse)
    // The player's own typed answer wins: they were asked for it, and a parse
    // that disagrees is the thing being checked, not the authority.
    const nextAnswer =
      answer.length !== ANSWER_LENGTH && prefill.answer.length === ANSWER_LENGTH
        ? prefill.answer
        : answer
    if (nextAnswer !== answer) setAnswer(nextAnswer)
    setGuesses(prefill.guesses)
    /**
     * WHERE AN IMPORT LEAVES THE CARET. An import that filled the answer in must
     * not leave the cursor sitting on it — the only thing left to do is the
     * board — and one that could not (an unsolved board carries no answer) must
     * not put it on the board, where nothing can be typed until the answer is
     * five letters long.
     *
     * ROUTED THROUGH `moveZone` SO THERE IS ONE RULE, AND ITS REFUSAL IS
     * DISCARDED: the SYSTEM moved the caret, not the player, so there is nothing
     * to explain and nothing should reach the coach line.
     */
    setZone(
      moveZone(
        { answer: nextAnswer, guesses: prefill.guesses, zone },
        nextAnswer.length === ANSWER_LENGTH ? 'board' : 'answer',
      ).next.zone,
    )
    setRefused(null)
    setParsed(parse)
    setDerivedAnswer(parse.answer)
    setImportNote(importSummary(parse))
    setMissingRows(prefill.missingRows)

    /**
     * ANYTHING RECOVERED GETS CONFIRMED; NOTHING RECOVERED FALLS BACK TO
     * TYPING, carrying the reason with it.
     *
     * parse.guesses is the whole test, and it is the right one because
     * parseBoard never returns nothing: every one of its seven outcomes comes
     * back with whatever it managed, so 'four of six rows' lands on the confirm
     * step with four rows already filled in, and only a parse that recovered
     * NO row at all — no board in the image, a share card, an untouched board —
     * drops through to manual entry.
     *
     * THE CONFIRM BRANCH FOCUSES NOTHING — the board is already there, and a
     * keyboard rising over it to confirm it is the original bug with an extra
     * step in front of it. THE FALLBACK BRANCH FOCUSES, and that is a change: it
     * used to reason that a keyboard would rise over the sentence explaining why
     * the board is empty, but this branch IS manual entry, reached by a player
     * whose only remaining action is to type. Leaving it unfocused put them on a
     * screen pixel-identical to the working "Enter manually" one, with a caret
     * blinking in the answer, where every keystroke went nowhere.
     */
    setStep(parse.guesses.length > 0 ? 'confirm' : 'entry')
    if (parse.guesses.length === 0) setFocusAnswer(true)
    // THE ONE CONFIRM CASE THAT WANTS A KEYBOARD. A board that was not solved
    // carries no answer to derive, and typing five letters is then the only
    // thing left to do before it can be saved — so asking for it and focusing
    // it is help rather than the interruption it would be on a solved board.
    if (parse.guesses.length > 0 && parse.answer === null) setFocusAnswer(true)
  }

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!day) return
    // The `disabled` attribute alone is not a re-entrancy guard — it only
    // takes effect once React commits the re-render, and a fast double-tap
    // can land both clicks inside that window and fire two concurrent
    // upsertBoard mutations. This check is synchronous, before any `await`.
    if (submitting) return
    setSubmitting(true)

    try {
      await upsert.mutateAsync({
        puzzleDay: day,
        answer,
        guesses,
        // The submitter's own local today; the server has no viewer to ask.
        today: toPuzzleDay(new Date()),
      })
      toast.success('Successfully saved board')

      // THE CORRECTION LOG, AND ONLY AFTER THE BOARD IS SAFE. These rows are
      // the labelled corpus wordle-teams-418 asks for — every tile the parse
      // got wrong, as the player corrected it — but they are a measurement, not
      // the user's work. A failure here must never surface as a failed board
      // submit, so it is awaited separately and swallowed with a log line.
      if (parsed !== null) {
        // The GUESSES are diffed against what is on screen, because that is
        // what the parser produced and what the player corrected. The ANSWER is
        // diffed against what the IMAGE gave, which on an unsolved board is
        // nothing at all — so typing one, or fixing a typo in one, is never
        // recorded as the parser having misread it.
        const corrections = correctionsFrom({ ...parsed, answer: derivedAnswer }, { answer, guesses })
        if (corrections.length > 0) {
          try {
            await logCorrections.mutateAsync({ puzzleDay: day, corrections })
          } catch (error) {
            console.error('Board import corrections could not be logged', error)
          }
        }
      }

      // ONLY on success. A failed submit used to close the sheet too, throwing
      // away everything the user had typed.
      onSuccess()
    } catch (error) {
      // Reaching here means the mutation failed: one of our typed codes, or —
      // the case that matters — a dropped mobile connection or a platform error.
      // Without this the promise rejected, setSubmitting(false) never ran, and
      // the form sat spinning forever with the board silently lost.
      console.error('Board submission failed before it could be saved', error)
      toast.error(boardErrorMessage(error))
    } finally {
      // Always runs, so the form can never be left stuck mid-submit.
      setSubmitting(false)
    }
  }

  /**
   * STEP ONE — which day, and how.
   *
   * Nothing here raises a keyboard, which is the whole reason it exists. The
   * date is already filled in by pickDefaultDay, so for most players this is
   * one tap.
   */
  if (step === 'choose') {
    return (
      <div data-testid="board-entry-choose" className="flex min-h-0 flex-1 flex-col gap-4 md:px-4">
        <div className="ml-2 flex flex-col md:ml-0">
          <Label htmlFor="wordle-board-date" className="mb-2 text-xs sm:text-sm">
            Wordle Date
          </Label>
          <DatePicker day={day} onSelect={setDay} playWeekends={playWeekends} tabIndex={1} />
        </div>

        {/* `=== true` and `=== false`, NEVER `!isPro`. amIPro answers undefined
            while it is in flight, and the loose spelling is wrong in BOTH
            directions here: it would show a paid-only control to everyone on
            every cold load, and it would flash an upgrade offer at somebody who
            already pays. In flight, neither appears. */}
        {isPro === true && <ImportScreenshot onParsed={handleImport} answer={answer} />}
        {isPro === false && <ImportUpsell />}

        <Button
          type="button"
          variant="outline"
          className="mx-2 justify-start md:mx-0"
          onClick={() => {
            setStep('entry')
            setFocusAnswer(true)
          }}
        >
          <Keyboard className="mr-2 h-4 w-4" />
          Enter manually
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('relative flex min-h-0 flex-1 flex-col', submitting && 'animate-pulse')}
    >
      {/**
       * THE KEYBOARD MAGNET, AND THE ONLY FOCUSABLE THING ON THIS STEP.
       *
       * IT IS A REAL `<input>` AND NOTHING READS IT. Every letter on screen comes
       * from React state through `handleKeyDown`; this field's `value` is wiped by
       * `drainInput` and is never consulted, submitted (it has no `name`) or
       * rendered. It exists because a software keyboard only opens for a focused
       * form control, and that requirement is the entire reason the answer slots
       * and the board used to sit inside a `contentEditable` — an editing host
       * wrapped around React-owned content, which is what made wordle-teams-5n6n
       * possible at all. Separating the two is the fix: a composition can only
       * land HERE, in a field whose contents are meaningless.
       *
       * IT MUST LIVE OUTSIDE THE SCROLL CONTAINER BELOW, AND THAT IS MEASURED. In
       * Chromium, with this input inside the `overflow-y-auto` div, focusing it
       * yanked the container's `scrollTop` from 400 to 0 — and
       * `focus({ preventScroll: true })` did NOT prevent it, because the jump is
       * the editing host being scrolled to, not the focus call's own scroll.
       * Placed out here it held at 400. `absolute` (against the `relative` on the
       * form) so a 1px box in the flex column cannot add a row of its own.
       *
       * `role="group"` ON AN `<input>` IS A DELIBERATE ARIA OVERRIDE, NOT AN
       * OVERSIGHT. Without it this reports as `textbox`, which is a lie — there is
       * no text in it and nothing a screen-reader user can usefully type into it
       * as text — and it would silently break every
       * `getByRole('group', { name: 'Wordle board entry' })` in the unit and e2e
       * suites, which are how the entry surface is addressed everywhere. The name
       * and the description belong on the focusable element, so they are here and
       * not on the presentation below.
       *
       * `pointer-events-none` SO THE INVISIBLE BOX CANNOT EAT A TAP. It is 1px in
       * the corner; a player aims at a slot or a tile, and the presentation's own
       * mousedown handler is what keeps focus here.
       *
       * `fontSize: 16px` INLINE, AND IT IS NOT COSMETIC: iOS Safari zooms the
       * whole viewport when focus enters an input whose computed font-size is
       * under 16px, and this is a mobile-first surface inside a sheet whose height
       * is already bound to the visual viewport. Spelled as a style rather than a
       * utility so it is greppable and readable from a test — it is a constraint,
       * not a look.
       */}
      <input
        ref={inputRef}
        type="text"
        tabIndex={2}
        role="group"
        aria-label="Wordle board entry"
        aria-describedby="entry-instructions"
        /**
         * THE MOBILE INPUT HINTS, SET DELIBERATELY — and they are now a matter of
         * politeness rather than of safety. Unset, they resolve to a spell-checked,
         * auto-corrected, auto-capitalised field, which puts the predictive-text bar
         * over the keyboard; that bar's commit path is the uncancelable
         * `insertCompositionText` one. It can no longer corrupt anything (there is
         * nothing React-owned for it to land in), but offering a player suggestions
         * for a field that discards everything they give it is noise.
         *
         * `autoCapitalize="characters"` rather than "off": the board and the slots
         * are uppercase, so this is the keyboard agreeing with what is on screen,
         * and `typeLetter` uppercases anyway so it cannot disagree.
         * `enterKeyHint="done"` because Enter here submits the board.
         * `autoComplete="off"` so no browser offers to fill a nameless field.
         */
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="characters"
        autoComplete="off"
        inputMode="text"
        enterKeyHint="done"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        // COMPOSITION BOOKKEEPING, AND THE DRAIN. See `drainInput`: clearing on
        // every `input` restarts the IME (compositionstart ×10 for one word), so
        // the composing flag is what buys the clean 1/1 lifecycle.
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
          drainInput()
        }}
        onInput={(event) => {
          // BOTH TESTS, because they fail in different browsers: the ref covers
          // the window between compositionstart and compositionend, and
          // `isComposing` covers the `input` that carries the commit itself.
          if (composingRef.current || (event.nativeEvent as InputEvent).isComposing) return
          drainInput()
        }}
        style={{ fontSize: '16px' }}
        className="pointer-events-none absolute left-0 top-0 h-px w-px border-0 bg-transparent p-0 opacity-0"
      />

      {/* THE DAY ROW IS THE DAY ALONE NOW. The answer used to sit beside it in a
          `w-[30%]` column — 108px on a 360px phone — which is where it had to
          leave from: the five answer slots have a 216px intrinsic minimum
          (answer-slots.tsx measured the overlap that happens below it), and the
          answer belongs with the board anyway, because they are one keystroke
          stream and one input serves both. */}
      <div className="ml-2 flex w-full shrink-0 items-center space-x-4 md:px-4">
        <div className="flex w-full flex-col">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1 w-fit px-2 text-xs text-muted-foreground"
            onClick={() => setStep('choose')}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            {day ?? 'Pick a day'}
          </Button>
        </div>
      </div>

      {/* THE COACH LINE, AND IT IS THE ENTIRE ACCESSIBILITY MITIGATION FOR
          COLLAPSING TWO FOCUS STOPS INTO ONE. A sighted player watches the caret
          hand itself from the answer to the board; a screen-reader user hears
          THIS, and hears it because the region is `aria-live="polite"` and its
          text changes at the hand-off. It is not decoration.

          A testid as well as the role: sonner's toaster is a live region too, and
          so is the import note above, so `getByRole('status')` is ambiguous the
          moment either is on screen.

          `min-h-8` IS TWO LINES AT THIS SIZE, RESERVED WHETHER OR NOT THEY ARE
          USED. The line changes on almost every keystroke, and a line that grows
          from one row to two would reflow the board underneath it mid-word. */}
      <p
        role="status"
        aria-live="polite"
        data-testid="entry-coach"
        className="mx-2 min-h-8 shrink-0 text-xs text-muted-foreground md:mx-4"
      >
        {coach}
      </p>

      {/* WHAT THE IMPORT DID, in the place the result of it is being looked at.
          It rides both steps: on confirm it says what was read, and on the
          fallback it says why there was nothing to read — which is the only
          thing that makes an empty board after tapping Import comprehensible.

          A share card keeps its own sentence. "That is the shared emoji grid,
          paste the board itself" is actionable; "could not read that" is not,
          and the two failures look identical to a player. */}
      {importNote !== null && (
        <div
          role="status"
          // A testid as well as the role: sonner's toaster is also a live
          // region, so getByRole('status') is ambiguous in a real browser the
          // moment any toast is on screen.
          data-testid="board-import-note"
          className="mx-2 mt-3 shrink-0 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground md:mx-4"
        >
          <p>{importNote}</p>
          {/* NAMED, NEVER GUESSED AT. prefillFrom leaves a row it could not
              read BLANK rather than filling it with the reader's first-choice
              letters: the board is positional, so a half-read row in the wrong
              place is worse than an empty one. Saying which rows they are is
              what keeps that honest rather than merely quiet. */}
          {/* THE ONLY TIME THE ANSWER IS ASKED FOR. A solved board carries it in
              its winning row and the parser reads it there — measured at 18 of
              18 on the real corpus — so asking would be pure friction. An
              UNSOLVED board has no such row, and the answer is then not just
              missing from the form but missing from Stage 4, which loses its
              second constraint for every row. Typing it fixes both. */}
          {step === 'confirm' && parsed?.answer === null && answer.length !== 5 && (
            <p className="mt-1">
              This board was not solved, so the answer is not on it. Type it above and the guesses
              will be checked against it.
            </p>
          )}
          {missingRows.length > 0 && (
            <p className="mt-1">
              {missingRows.length === 1
                ? `Row ${missingRows[0] + 1} could not be read — type it in.`
                : `Rows ${missingRows.map((row) => row + 1).join(', ')} could not be read — type them in.`}
            </p>
          )}
        </div>
      )}

      {/* `data-testid` SO THE SCROLLING KEYS CAN BE MEASURED. jsdom reports every
          box as 0x0, so `Home`, `End` and `PageUp`/`PageDown` all resolve to 0
          there and only the fixed +/-40 step is observable — four of the six keys
          are unprovable under vitest. e2e/board-entry.spec.ts presses them against
          a real `clientHeight`, and needs a stable handle on this element to do
          it; a Tailwind class is not one. */}
      <div
        ref={scrollContainerRef}
        data-testid="entry-scroller"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {/**
         * BOTH ZONES, AND NOT A FOCUS TARGET — THE WHOLE POINT OF THIS SHAPE.
         *
         * This wrapper used to be the `contentEditable` region: one editing host
         * over the answer slots AND the board, carrying `tabIndex`, the ARIA
         * name, a keydown handler and two insertion guards. Collapsing two focus
         * stops into one was right and is kept; putting React-owned content
         * inside an editing host to do it was not. `beforeinput` for an IME
         * commit is dispatched with `cancelable: false`, so the guards could
         * never be complete — and because a click moved the caret into a tile,
         * composed text could land in any tile and STAY (wordle-teams-5n6n).
         *
         * SO THIS IS NOW PLAIN PRESENTATION. No `contentEditable`, no
         * `tabIndex`, no `onBeforeInput`, no `onPaste`, no native `beforeinput`
         * listener — none of which has anything left to guard, because there is
         * no insertion path into a non-editable subtree. Focus, the keyboard and
         * any composition live on the `<input>` at the top of this form.
         *
         * `onMouseDown` PREVENTDEFAULT IS THE ONE HANDLER THAT SURVIVES, AND IT
         * IS LOAD-BEARING. The thing a player taps is no longer the thing that
         * holds focus, so without this a tap on a slot or a tile blurs the input,
         * drops the keyboard on a phone and takes the caret off screen (the
         * caret is gated on `focused`). Mousedown's default action IS the focus
         * change, so cancelling it here means focus never leaves — and it is on
         * the WRAPPER rather than on each half because mousedown bubbles, so one
         * handler covers every slot and every tile. `AnswerSlots` and
         * `BoardInput` still get their own mousedown for `selectZone`; those run
         * first, on the way up, and this cancels the default afterwards.
         *
         * NO FOCUS RING AND NO `focus:outline-none`, BECAUSE THIS CANNOT BE
         * FOCUSED. The ring was removed earlier — one ring around the answer AND
         * the board said only "something here has focus" — and the caret is what
         * replaced it: `cursorIndex` below and `cursor` on BoardInput are BOTH
         * gated on `focused`, so a rendered caret implies a focused input and a
         * blurred input draws none. That is the WCAG 2.4.7 indicator, and
         * e2e/board-entry.spec.ts asserts it is PAINTED rather than merely
         * classed, in both zones.
         *
         * `caret-transparent` IS GONE WITH THE EDITING HOST: a non-editable div
         * has no native caret to suppress. (`AnswerSlots` keeps its own, which
         * is that component's business, not this one's.) `select-none` STAYS —
         * a drag across five letter cells selecting text is still meaningless.
         *
         * `w-fit` SO IT HUGS THE CONTENT (wordle-teams-rpql). It carried the
         * focus ring when that note was written; the sizing outlives both the
         * ring and the editing host, because this is still the thing the answer
         * slots and the board are centred within.
         *
         * IT ALSO CARRIES THE MARGINS NOW, AND THAT IS THE SCROLLING FIX
         * (wordle-teams-ddjl). There
         * used to be an OUTER div here holding `mt-4 md:my-2` — and holding
         * `answerZoneRef`, so the ref wrapped the label AND the slots AND this
         * whole six-row board. Per CSSOM-View, `scrollIntoView({ block: 'nearest' })`
         * on a target TALLER than the scrollport that already overlaps it does
         * NOTHING, so the answer branch of `scrollActiveRowIntoView` silently
         * no-opped from the day it was written: measured at 390x380, 440px of ref
         * against a 139px scroller, scrollTop delta 0. A player who backspaced the
         * board empty got the caret back in an answer zone that was above the fold
         * and unreachable, which is the whole reason they could not fix a typo in
         * the answer.
         *
         * SO THE REF MOVED INWARDS ONTO THE LABEL AND THE SLOTS ALONE, the board
         * became their SIBLING, and the outer div's margins moved here — which
         * leaves exactly one element where there were two.
         *
         * THE MOUSEDOWN GUARD'S COVERAGE IS UNCHANGED BY THAT AND MUST STAY SO.
         * It has to be an ancestor of every slot AND every tile, which is the
         * entire reason it is one handler up here rather than one per half. Do
         * not move it down onto the answer zone; that would drop the board.
         */}
        <div
          data-testid="entry-presentation"
          onMouseDown={(event) => event.preventDefault()}
          className="mx-auto mt-4 flex w-fit select-none flex-col items-center gap-4 md:my-2"
        >
          {/* THE ANSWER ZONE, AND IT IS EXACTLY WHAT `scrollActiveRowIntoView`
              NEEDS TO BE ABLE TO SCROLL TO: the label and the slots, nothing else.

              THE LABEL COMES WITH THE SLOTS, which is what this div is for —
              scrolling the slots alone would leave the label above the
              scrolled-to edge, on the one viewport short enough for the scroll to
              do anything, which is the viewport where an unlabelled slots row is
              hardest to read.

              THE BOARD IS A SIBLING, NOT A CHILD, and that is the fix. Anything
              added inside here is added to the thing the scroller has to fit, so
              keep it small.

              `data-testid` so e2e can measure it against the scroller's client
              rect; jsdom reports every box as 0x0, so the unit test asserts
              CONTAINMENT (slots in, board out) instead. */}
          <div ref={answerZoneRef} data-testid="entry-answer-zone" className="flex flex-col items-center">
            {/* THE LABEL, RESTORED.

              It was in the original plan for this surface and was dropped when the
              old `#answer` input was deleted, which is most of why the slots row
              became anonymous enough to read as another board row.

              IT USED TO BE OUT HERE FOR A SECOND REASON THAT IS GONE: the slots
              and the board sat inside a `contentEditable`, where any text is a
              string the player can overwrite. Nothing below is an editing host any
              more, so the placement is now purely about layout — the label belongs
              to the scrolled-together answer zone, not to the slots row.

              `aria-hidden` SO IT IS NOT ANNOUNCED TWICE, AND THE HIDDEN HALF IS
              THE BETTER ONE. `AnswerSlots`' group already carries an aria-label
              reading "Today's Wordle answer, 2 of 5 letters: C R" — strictly more
              useful than a bare "Wordle Answer", because it carries the live
              count. This is the SIGHTED half of the same label. */}
            <span aria-hidden="true" className="mb-1 block text-center text-xs font-medium sm:text-sm">
              Wordle Answer
            </span>
            {/* `w-56` (224px) IS DELIBERATELY NARROWER THAN THE BOARD — 288px
                (`w-72`) on a phone, 320px (`md:w-80`) from md — AND THAT IS THE
                POINT. The slots used to be exactly the board grid's width, so they
                lined up column-for-column with the tiles and the row read as a
                SEVENTH BOARD ROW: same width, same square cells, same border, no
                label. Breaking the alignment, plus the label above, is what makes
                it read as a separate control.

                224px IS 8px ABOVE THE FLOOR AND THE FLOOR IS HARD. `AnswerSlots`'
                slots carry `min-w-10`, so five of them plus four `gap-1` gutters
                have an intrinsic minimum of 216px — and BELOW that the slots
                OVERLAP rather than overflow cleanly (measured: at 108px, slot 0
                spans [0,40] while slot 1 starts at 22.39). Nothing here may go
                under 216px. */}
            <AnswerSlots
              answer={answer}
              cursorIndex={focused && cursor?.zone === 'answer' ? cursor.index : null}
              onSelect={() => selectZone('answer')}
              className="w-56"
            />
          </div>
          <BoardInput
            guesses={guesses}
            answer={answer}
            // UNADAPTED, both zones. BoardInput narrows it to a tile itself,
            // which is the one place that narrowing may happen. NULL WHILE
            // UNFOCUSED: a caret that cannot be typed into is a lie, and the
            // scroll below still uses the ungated `cursor`, because where the
            // board should be scrolled to does not depend on who has focus.
            cursor={focused ? cursor : null}
            onSelect={() => selectZone('board')}
          />
        </div>
        <BoardSubmit submitting={submitting} disabled={submitDisabled} />
      </div>

      {/* THE MODEL, STATED ONCE, FOR SOMEBODY WHO CANNOT SEE IT. The entry input
          names itself "Wordle board entry"; this is what that name means, and it
          is why that input carries `aria-describedby` pointing here. */}
      <span id="entry-instructions" className="sr-only">
        Type the day&apos;s five-letter answer, then keep typing your guesses. The cursor moves from
        the answer to the board on its own, rows advance on their own, and backspace goes back a
        letter.
      </span>

      {/* Sticky so it pins above the mobile keyboard; hidden on desktop, where
          BoardSubmit above renders the desktop one.

          `pb-[env(safe-area-inset-bottom)]` (wordle-teams-8h2p). This row is
          the last thing in a `side="top"` Sheet whose `maxHeight` is bound to
          the visual viewport, so with the keyboard closed the sheet's bottom
          edge IS the bottom of the screen — and under `viewport-fit=cover`
          that is the physical edge, with the home indicator drawn over the
          last 34px of it. The Sheet's own `p-6` puts 24px below these buttons,
          which is not enough to clear it.

          A bare `env()`, not a `max()`: this element carries `pt-2` and no
          bottom padding at all, so its base here is 0 and the inset is purely
          additive — a `max()` against a non-zero base would move the buttons
          up on every flat screen for nothing. On iOS the inset collapses to 0
          while the software keyboard is up, which is the state where the
          sheet's bottom edge is the keyboard rather than the screen, so the
          two cases agree without a media query.

          `md:hidden`, NOT `md:invisible md:h-0 md:p-0` (wordle-teams-bi8i), AND
          THAT WAS THE DIALOG'S ENTIRE DESKTOP OVERFLOW. `invisible` is
          `visibility: hidden` and `h-0` is a height on THIS box — neither stops
          the two `h-10` buttons INSIDE it laying out. Measured in headless
          Chromium at 1366x768 and 1920x1080: the buttons painted y 665 to 705
          while the form ended at 665, the dialog's `p-4` absorbed 16px of that
          and the remaining 24px escaped as scrollable overflow. It was the WHOLE
          of it — removing the coach line, the answer slots and the focus ring
          together still left exactly +24, because each of those lowers
          scrollHeight and clientHeight by the same amount.

          `display: none` RATHER THAN `overflow: hidden` ON THIS BOX. Clipping
          also takes the overflow to 0, and it is the wrong fix: the box would
          still be here, still 0px tall, still holding two focusable submit
          controls that a keyboard reaches and a screen reader announces on the
          viewport where they are meant to be gone. The goal is a box that
          contributes nothing, not one whose contents are merely out of sight.

          IT IS STILL A REAL SUBMIT ROW UNDER `md`, which is the half that must
          not break: `hidden` applies only from md up, and below it this is the
          only Cancel/Submit on screen. */}
      <div className="sticky bottom-0 flex w-full shrink-0 flex-row space-x-2 bg-background pb-[env(safe-area-inset-bottom)] pt-2 md:hidden">
        <Button type="button" variant="outline" className="w-full" onClick={onSuccess}>
          Cancel
        </Button>
        <Button
          disabled={submitting || submitDisabled}
          aria-disabled={submitting || submitDisabled}
          type="submit"
          className="w-full"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit
        </Button>
      </div>
    </form>
  )
}

/**
 * Prefill for a player who HAS a team: today's reads, unchanged.
 *
 * getMyPlayerId stays here and only here. getTeamMonth returns every member's
 * scores, so this branch has to be told which row is "you"; the solo branch
 * below does not, because getMyMonth is already scoped to the caller.
 */
function TeamBoardEntryForm({
  teamId,
  month,
  onSuccess,
}: {
  teamId: Id<'teams'>
  month: string
  onSuccess: () => void
}) {
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { data: myPlayerId } = useSuspenseQuery(convexQuery(api.scores.getMyPlayerId, {}))

  const myScores = data.players.find((player) => player.id === myPlayerId)?.scores ?? []

  return (
    <BoardEntryFields
      myScores={myScores}
      playWeekends={data.team.playWeekends}
      month={month}
      onSuccess={onSuccess}
    />
  )
}

/**
 * Prefill for a player with NO team.
 *
 * `playWeekends` is true because that is v1's default for a brand-new team —
 * create-team-dialog.tsx ships both switches on — so a team-less player sees
 * the same set of playable days they will see on the team they are about to
 * create. There is no team to ask, and picking false would disable weekends
 * for someone who never chose that.
 */
function SoloBoardEntryForm({ month, onSuccess }: { month: string; onSuccess: () => void }) {
  const { data: myScores } = useSuspenseQuery(convexQuery(api.scores.getMyMonth, { month }))

  return (
    <BoardEntryFields
      myScores={myScores}
      playWeekends={true}
      month={month}
      onSuccess={onSuccess}
    />
  )
}

/**
 * Board entry, whichever query can feed it.
 *
 * SPLIT BY DATA SOURCE, NOT BY CONDITION, and that is forced rather than
 * stylistic. The team prefill needs getTeamMonth and the team-less prefill
 * needs getMyMonth, and exactly one of them may run — but useSuspenseQuery has
 * no `enabled` option in TanStack Query v5, and a hook cannot be called
 * conditionally. Components can be, so the branch is a component boundary.
 *
 * The team path is unchanged by this: TeamBoardEntryForm makes the same two
 * calls this component used to make, in the same order.
 */
export function BoardEntryForm({
  teamId,
  month,
  onSuccess,
}: {
  teamId?: Id<'teams'>
  month: string
  onSuccess: () => void
}) {
  if (teamId === undefined) return <SoloBoardEntryForm month={month} onSuccess={onSuccess} />
  return <TeamBoardEntryForm teamId={teamId} month={month} onSuccess={onSuccess} />
}

export default BoardEntryForm
