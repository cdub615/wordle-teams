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
 * Keys the browser must keep, beyond Tab and the modifier combos. The board is
 * inside an `overflow-y-auto` container, so a keyboard-only player needs these to
 * reach the rows below the fold — and F5 to reload. Space is NOT here: see
 * handleKeyDown.
 */
const NAVIGATION_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
])
const FUNCTION_KEY = /^F\d{1,2}$/

/** Row-by-row, because entry-cursor.ts always returns a FRESH array. See applyEntry. */
const rowsEqual = (a: Array<string>, b: Array<string>) =>
  a.length === b.length && a.every((row, index) => row === b[index])

/**
 * One month of the caller's own scores.
 *
 * Derived from getMyMonth's return type rather than written out, so the two
 * queries that feed this form cannot drift apart silently: getMyMonth exists
 * precisely to emit the shape getTeamMonthFor already emits (scores.ts:96-101),
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
   * WHICH HALF OF THE ONE ENTRY REGION THE NEXT KEYSTROKE LANDS IN.
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
  /** Set when the player chose to TYPE, so the entry region takes focus then and not before. */
  const [focusAnswer, setFocusAnswer] = useState(false)
  /**
   * WHETHER THE REGION HAS FOCUS, AND IT GATES THE CARET IN BOTH ZONES.
   *
   * `cursorFor` knows nothing about focus — it answers "where would the next
   * letter go", which is a fact about the BOARD. Drawing that unconditionally
   * rendered a blinking caret on a region that did not have focus and could not
   * receive a keystroke, which is the original dead end with a cursor painted on
   * top of it: it happened on the unreadable-import branch below, pixel-identical
   * to the manual path that works.
   *
   * A RENDERED CARET NOW IMPLIES A FOCUSED REGION. That is the invariant, not a
   * patch for that one branch — it also covers the confirm step, where not
   * focusing is deliberate, and any future branch that forgets.
   */
  const [focused, setFocused] = useState(false)
  /** The ONE focusable thing on the entry step: answer slots and board together. */
  const regionRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

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
   * IT FOCUSES THE REGION, NOT AN ANSWER FIELD. There is no longer an answer
   * field to focus: one contentEditable holds both halves, and which half the
   * keystroke lands in is `zone`, not focus.
   */
  useEffect(() => {
    if (!focusAnswer) return
    regionRef.current?.focus()
    setFocusAnswer(false)
  }, [focusAnswer])

  /**
   * THE NATIVE `beforeinput` GUARD, AND IT IS NOT THE SAME EVENT AS THE
   * `onBeforeInput` PROP ON THE REGION. This was found by dispatching a real
   * `InputEvent('beforeinput')` at the region and watching it go through.
   *
   * React does NOT listen for `beforeinput`. `onBeforeInput` is SYNTHESIZED —
   * react-dom's BeforeInputEventPlugin builds it from `textInput` where the
   * browser has one (Chrome, Safari) and from a `compositionend`/`keypress`
   * fallback where it does not (Firefox). So the prop cancels the legacy
   * `textInput` event, which in Chrome does stop the insertion, and leaves a real
   * `beforeinput` — the one dictation, swipe-typing and predictive text fire, and
   * the only one Firefox has — untouched.
   *
   * WHAT THIS ACTUALLY STOPS: every CANCELABLE insertion. Paste, drag-and-drop,
   * `insertText`, `insertReplacementText` and the rest — measured across all nine
   * inputTypes an adversarial pass could produce, plus CDP-driven insertion and
   * real clipboard paste.
   *
   * WHAT IT CANNOT STOP, AND THIS IS NOT A THEORETICAL GAP:
   * `inputType: 'insertCompositionText'` is dispatched with `cancelable: FALSE`,
   * measured through Chromium's own IME channel. `preventDefault()` on it does
   * nothing, so a composed character lands in the DOM. The submitted payload is
   * unaffected — it comes from React state, which is never read back off these
   * nodes — but the SCREEN can lie, and permanently: React only rewrites a tile's
   * text node when that tile's letter changes, so composed text dropped into a
   * tile survives re-renders. Tracked as wordle-teams-5n6n; the real fix is a
   * MutationObserver or moving off contentEditable, and neither belongs here.
   * `inputMode`/`autoCorrect` on the region below narrow the path to it.
   *
   * The risk this closes is the one that could corrupt DATA: a cancelable native
   * insertion into an editing host wrapped around a React-owned subtree, whose
   * symptom is the WRONG BOARD ON SUBMIT or a `removeChild` reconciliation crash.
   * The prop stays as the belt to this braces.
   *
   * KEYED ON `step` because the region does not exist on step one.
   */
  useEffect(() => {
    const node = regionRef.current
    if (node === null) return
    const block = (event: Event) => event.preventDefault()
    node.addEventListener('beforeinput', block)
    return () => node.removeEventListener('beforeinput', block)
  }, [step])

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
   * THE WHOLE OF THE CARET, IN ONE PLACE, and both halves of the region read it:
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
   * THE ANSWER ZONE SCROLLS TO THE REGION, NOT TO A ROW. The answer slots live
   * INSIDE the scroll container now, above the board, so "which row" is the wrong
   * question while the caret is up there — and answering it with the last row
   * (what a null cursor means, and what this fell back to) would scroll the thing
   * the player is typing into off the top.
   *
   * A NULL CURSOR STILL MEANS THE LAST ROW, unchanged: null is a solved or full
   * board, where the last row is the one being looked at.
   */
  const scrollActiveRowIntoView = () => {
    if (cursor !== null && cursor.zone === 'answer') {
      regionRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }
    const index = cursor === null ? guesses.length - 1 : cursor.row
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(scrollActiveRowIntoView, [guesses, zone])

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
   * back unconditionally re-fires `useEffect(scrollActiveRowIntoView, [guesses])`
   * on every Shift press and on every letter typed into the ANSWER, where the
   * board did not change at all. `rowsEqual` rather than `!==` for exactly that
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
   */
  const selectZone = (next: Zone) => {
    const result = moveZone(entry, next)
    setRefused(result.refused)
    applyEntry(result.next)
    regionRef.current?.focus()
  }

  /**
   * ONE HANDLER, ONE REGION, BOTH ZONES. This replaces the pair that used to sit
   * either side of the boundary — `handleAnswerKeyDown` here and BoardInput's own
   * — which is the whole of what made a player click between them.
   */
  const handleKeyDown: KeyboardEventHandler = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key
    // Tab must reach the browser to move focus. Ctrl/Cmd combos (paste, copy,
    // select-all, ...) must NOT be treated as plain letters — Ctrl+V's keydown
    // has event.key === 'v' with no modifier check, so without this a paste
    // shortcut is typed as a literal "v" instead of ever reaching a real paste
    // attempt. Returning without preventDefault lets the browser proceed with
    // its native action, which is what onBeforeInput/onPaste below intercept.
    if (key === 'Tab' || event.ctrlKey || event.metaKey) return
    /**
     * NAVIGATION AND FUNCTION KEYS REACH THE BROWSER TOO, and leaving them out
     * was a real cost: the board sits in an `overflow-y-auto` container, and with
     * every key but Tab preventDefault'd a keyboard-only player could not scroll
     * it — ArrowDown, PageDown, Home and End were all dead, and so was F5.
     * (Ctrl+R always worked, through the modifier return above, which is exactly
     * the kind of near-miss that hides a bug like this.)
     *
     * SPACE IS DELIBERATELY NOT ON THIS LIST. It inserts a character in an
     * editing host, and `insertCompositionText` (see the effect above) means the
     * beforeinput guard cannot be relied on to catch everything — so the one key
     * that both scrolls AND types stays prevented.
     *
     * Escape is not here because it does not need to be: Radix's dismissable
     * layer listens on the document in the CAPTURE phase and ignores
     * `defaultPrevented`, so the sheet still closes.
     */
    if (NAVIGATION_KEYS.has(key) || FUNCTION_KEY.test(key)) return
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
      className={cn('flex min-h-0 flex-1 flex-col', submitting && 'animate-pulse')}
    >
      {/* THE DAY ROW IS THE DAY ALONE NOW. The answer used to sit beside it in a
          `w-[30%]` column — 108px on a 360px phone — which is where it had to
          leave from: the five answer slots have a 216px intrinsic minimum
          (answer-slots.tsx measured the overlap that happens below it), and the
          answer belongs with the board anyway, because they are one keystroke
          stream and the region has to wrap both. */}
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

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
        {/**
         * ONE REGION OVER BOTH ZONES — the feature, and it is atomic. Two
         * contentEditables with a keydown handler each is what made a player who
         * finished the answer discover that the board needed clicking, and lose
         * the keystroke they discovered it with.
         *
         * `onBeforeInput` AND `onPaste` ARE NOT OPTIONAL, and they are the most
         * dangerous thing on this element. keydown does not cover paste, IME
         * composition commits, or mobile swipe-typing / predictive text /
         * dictation — all of which insert with NO per-character keydown. This
         * node is an editing host wrapped around a LARGER React-owned subtree
         * than board-input's ever was (the slots as well as the board), so a
         * native insertion here corrupts the DOM React thinks it owns: the wrong
         * board on submit, or a `removeChild` reconciliation crash.
         *
         * `onBeforeInput` IS NOT THE NATIVE `beforeinput` EVENT — React
         * synthesizes it from `textInput` — so it is HALF the guard, and the
         * effect above adds the real listener. Both are kept: the prop cancels
         * Chrome's legacy `textInput`, the listener cancels `beforeinput`, and
         * `input` itself is not cancelable at all.
         *
         * NO BUTTON IS INSIDE IT. That is why board-input.tsx exports its desktop
         * submit separately — see the note there — and why Cancel and Submit sit
         * in the sheet footer below rather than anywhere in here.
         *
         * `w-fit` SO THE FOCUS RING HUGS THE CONTENT (wordle-teams-rpql). A
         * full-width region draws a ring around the whole sheet, clipped at both
         * edges by the scroll container's computed `overflow-x`.
         */}
        <div
          ref={regionRef}
          contentEditable
          suppressContentEditableWarning
          tabIndex={2}
          role="group"
          aria-label="Wordle board entry"
          aria-describedby="entry-instructions"
          /**
           * THE MOBILE INPUT HINTS, SET DELIBERATELY. Unset, they resolve to a
           * spell-checked, auto-corrected, auto-capitalised editing host — which
           * is what puts the predictive-text bar over the keyboard, and the
           * predictive bar's commit path is the one `insertCompositionText` hole
           * nothing can cancel (wordle-teams-5n6n). Narrowing the invitation is
           * the only lever this component has over it.
           *
           * `autoCapitalize="characters"` rather than "off": the board and the
           * slots are uppercase, so this is the keyboard agreeing with what is on
           * screen, and `typeLetter` uppercases anyway so it cannot disagree.
           * `enterKeyHint="done"` because Enter here submits the board.
           */
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="characters"
          inputMode="text"
          enterKeyHint="done"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          onBeforeInput={(event) => event.preventDefault()}
          onPaste={(event) => event.preventDefault()}
          className="mx-auto mt-4 flex w-fit select-none flex-col items-center gap-2 rounded-lg caret-transparent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-6 focus:ring-offset-background md:my-2"
        >
          {/* `w-72 md:w-80` IS THE BOARD GRID'S OWN WIDTH (wordle-board.tsx), so
              the five slots line up column-for-column with the five tiles under
              them — and it is comfortably above the 216px floor below which the
              slots overlap each other. */}
          <AnswerSlots
            answer={answer}
            cursorIndex={focused && cursor?.zone === 'answer' ? cursor.index : null}
            onSelect={() => selectZone('answer')}
            className="w-72 md:w-80"
          />
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

      {/* THE MODEL, STATED ONCE, FOR SOMEBODY WHO CANNOT SEE IT. The region names
          itself "Wordle board entry"; this is what that name means. */}
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

          `md:p-0` STILL WINS ON DESKTOP: it is a later, more specific-in-
          source-order padding utility than this one, and tailwind-merge keeps
          both because they are different variants. */}
      <div className="sticky bottom-0 flex w-full shrink-0 flex-row space-x-2 bg-background pb-[env(safe-area-inset-bottom)] pt-2 md:invisible md:h-0 md:p-0">
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
