# Continuous board entry

**Date:** 2026-09-14
**Issue:** wordle-teams-wty4.1.6 (P2) · epic wordle-teams-wty4.1 · phase wordle-teams-wty4
**Status:** design approved, plan pending

## What we are building and why

Manual board entry becomes one continuous keystroke stream. A player opens step 2, types
the day's answer, and keeps typing their guesses — the cursor hands itself from the
answer to the board, rows advance on their own, and backspace walks back. One click to
start, none after.

The question this issue was filed with was "is manual board entry unintuitive?", and the
issue proposed answering it with the funnel or a watched session. Neither was available:
`lib/funnel.ts`'s `send()` still has no destination (`wordle-teams-dfb8`), and the owner
chose to answer it by design review instead. What that review found is below, and one
part of it is not a matter of opinion.

### The measured finding

**With no answer entered, typing on the board does nothing at all.** Probed 2026-09-14
against the real function:

```
applyLetter('C', answer='', guesses=['','','','','',''])
  → ['', '', '', '', '', '']        unchanged
```

`applyLetter` (`src/components/board-entry/board-input.tsx`) bails on
`current === answer`. With an empty board the first row with room is `''`, and with no
answer typed `answer` is `''` — so the guard is true, and every keystroke is swallowed.
Silently: no toast, no shake, no message.

The guard is correct and deliberate for its intended case. v1 stops there so that typing
past a solved row cannot start a seventh guess. The empty-board collision is an accident
of `''` being a legal value on both sides.

So a player who skips the answer field and clicks the board — the Wordle-shaped thing on
the screen, and the obvious target — meets an application that is completely
unresponsive. Not a wrong result. Nothing. That is a far better explanation for
"70 of 392 players have ever entered a board" than any layout problem, and it was
invisible to every gate: it type-checks, lints, builds, and passes every test.

### The root cause behind the rest

Both the answer field and the board are `contentEditable` divs with `caret-transparent`,
with every key `preventDefault`'d — the `#answer` div in `form.tsx` and the board wrapper
in `board-input.tsx`. Nothing is typed into the DOM; keystrokes are intercepted and
re-rendered as state. (Anchors, not line numbers: both have moved once already.)

That was the right call and it must survive this change. It is how the mobile keyboard
opens without a focus-zoom, how no caret sits over the tiles, and how native insertions
(paste, IME commits, swipe-typing, dictation) are kept out of the React-owned
`<WordleBoard>` subtree.

The cost nobody priced is that both surfaces wear the complete visual language of a text
input while supporting none of its behaviour. The answer field carries
`border border-input bg-background rounded-md h-10` — it is pixel-for-pixel a shadcn
`Input`. Players bring input expectations to it: a caret, click-to-position,
select-a-letter-to-fix-it, paste. It has none of them. **A focused box with a bright ring
and no blinking caret is the standard signature of a disabled field.**

Four of the five frictions the owner reported are that one cause:

| Reported | Cause |
| --- | --- |
| Empty field and empty board, unclear what to do | No rendered caret anywhere |
| Unclear you must click the board next | Two independent focus targets, nothing announcing the second |
| Unclear rows advance by themselves | Nothing marks the active cell, so advancement is invisible |
| Unclear the answer can be corrected | Backspace works; nothing suggests it |

The fifth — "unclear you can correct a board after submitting" — is a different problem
and is out of scope here. See *Out of scope*.

## Decisions taken, and what was ruled out

**Continuous, over three alternatives** (owner, 2026-09-14). Four models were built as a
live mockup and compared by typing in them. The alternatives and why they lost:

- **Guided** — keep two zones, add slots, a cursor in each, and a locked board. Fixes the
  dead end and the missing caret, but leaves two things to click. Rejected as solving the
  symptom while keeping the gap a player gets lost in.
- **Guess-first** — stop asking for the answer, since on a solved board it *is* the last
  guess; ask only when the player missed it. The strongest idea on offer and it removes a
  whole field from the common path. Ruled out because tiles cannot be coloured until the
  answer is known, so the board would resolve all at once at the end instead of row by
  row — a larger change to what entry feels like than this issue should make. Worth
  revisiting on its own merits later; not folded in here.
- **Today** — the baseline, kept in the mockup only to reproduce the dead end.

**No locked or dimmed board** (owner, 2026-09-14). Because the hand-off is automatic, the
board is never the thing a player has to find, which makes a lock a safety net for one
case rather than a teaching device. Ruled out: dimming on open (a dialog that opens
looking half-disabled is its own kind of confusing) and dimming on an early click (a third
visual state to build, spec and test, for a case the hand-off exists to prevent). Clicking
the grid early keeps the cursor on the answer and the coach line answers the click.

**`caret-transparent` and the `contentEditable` interception stay.** They are the reason
the mobile keyboard behaves, and this change does not touch them. What changes is that a
caret is now *rendered* rather than native.

## Architecture

The repo's existing division holds: everything that decides is pure and tested directly;
components are shells. This is the same argument `convex/lib/avatar.ts` makes for the
server — a decision inside a component that needs a real DOM is a decision no cheap test
can reach.

### New units

**`src/components/board-entry/entry-cursor.ts`** — the state machine, pure. Owns every
rule about where a keystroke lands. Absorbs today's `applyLetter` and `applyBackspace`.

```ts
type Zone = 'answer' | 'board'
type EntryState = { answer: string; guesses: string[]; zone: Zone }

typeLetter(state: EntryState, key: string): EntryState
backspace(state: EntryState): EntryState
moveZone(state: EntryState, zone: Zone): EntryState
cursorFor(state: EntryState):
  | { zone: 'answer'; index: number }
  | { zone: 'board'; row: number; index: number }
  | null          // nothing left to type: solved, or six full rows
```

**`src/components/board-entry/entry-coach.ts`** — the coach line as a function of state,
pure. One place for the strings, so copy can be reviewed without reading a component.

**`src/components/board-entry/answer-slots.tsx`** — five slots rendering the answer with
the active-slot caret. Replaces the `#answer` box.

### Modified

**`board-input.tsx`** — keeps `WordleBoard` and its wrapper. Loses its own `keydown`
handler and its focus target; gains an active-cell prop. Its exported `applyLetter` and
`applyBackspace` move to `entry-cursor.ts`.

**`form.tsx`** — owns the single focusable region and routes `keydown` into the machine.

## Behaviour

The rules the state machine must implement, stated so they can be tested one at a time.

**Typing in the answer zone.** Append while `answer.length < 5`. **The fifth letter sets
`zone = 'board'`** — this is the hand-off, and it is the whole feature.

**Typing in the board zone.** Refuse outright while `answer.length !== 5`. This is the
dead end closed *by construction* rather than by accident: it is an explicit, stated
refusal, and it is additionally unreachable, because no transition sets `zone = 'board'`
while the answer is incomplete. Otherwise append to the first row with room. Stop when a
row equals the answer (v1's rule, preserved) or when all six rows are full.

**Backspace.** In the answer zone, shorten the answer. In the board zone, delete from the
last filled row — and **when no row is filled, set `zone = 'answer'`** rather than
dead-ending, so the stream walks back as smoothly as it walks forward.

**Clicking.** Clicking the answer slots sets `zone = 'answer'`, which is the escape hatch
for a player on row five who spots a typo in the answer and should not have to backspace
thirty times. Clicking the board sets `zone = 'board'` only when the answer is complete;
before that the cursor stays put and the coach line explains why.

**Enter.** Unchanged: submit when the board is valid, warn when it is not.

**After an import.** `handleImport` prefills the answer and guesses. Set `zone = 'board'`
when the prefilled answer is complete, `'answer'` when it is not; the cursor lands on the
first row with room.

### The rendered caret

In the answer zone, a 2px blinking bar in the active slot. On the board, an accent ring
on the active tile. Both derive from `cursorFor`, so there is exactly one definition of
"where the next letter goes" and the two renderings cannot disagree.

Tiles and slots get a short scale animation as a letter lands, behind
`prefers-reduced-motion`. That is what makes a keystroke feel received, which is the
thing today's board never does.

### Scroll

`scrollActiveRowIntoView` currently fires on `onBoardFocus`. Focus no longer moves, so it
must fire when the zone changes to `'board'` and when the active row advances.

## Mobile

One focus target is strictly better than two here. The keyboard opens once on entering
step 2 and never dismisses, where today moving focus from the answer div to the board div
is a real focus change that can bounce the keyboard on iOS.

The two-step split is unchanged and stays for its original reason: step 1 raises no
keyboard, which is what stopped entry opening with the keyboard covering 55% of an iPhone
screen.

## Accessibility

**This change has a real accessibility cost and it is recorded rather than glossed.**
Collapsing two focus stops into one removes a keyboard user's ability to Tab between the
answer and the board.

Mitigations, all required:

- The coach line becomes `role="status"` with `aria-live="polite"`, so the hand-off is
  **heard** when it cannot be seen. It must announce the transition explicitly — a line
  that only says "now type your guesses" when the zone changes is what carries the
  feature for a screen-reader user.
- The region carries `aria-label="Wordle board entry"`.
- The answer slots carry a label reporting position and contents.
- Visually-hidden instructions, referenced by `aria-describedby`, state the model once:
  type the answer, then the guesses, backspace to go back.

**If that trade proves unacceptable in review, the fallback is keeping the board tabbable
as a second focus stop** while the automatic hand-off continues to work for everyone else.
The hand-off and the second stop are not in conflict; the single focus target is a
simplification, not a requirement.

## Testing

- **`entry-cursor.test.ts`** — pure and exhaustive: hand-off on the fifth letter, refusal
  to type into the board before the answer, walk-back from an empty board, the solved-row
  stop, the full-board stop, both click transitions, and the post-import zone.
- **The dead-end regression, named as such.** A test asserting that a letter typed with an
  empty answer is refused *and that the refusal is reachable as a distinct outcome* rather
  than an unchanged array. An assertion that the array is unchanged would pass against
  today's bug.
- **`entry-coach.test.ts`** — the line for each state.
- **`form.hook.test.ts`** — extended: the rendered caret moves, the hand-off happens with
  no click between the answer and the first guess, and the live region announces it.
- **e2e: a complete board entered with zero clicks after step 2 opens.** This is the
  acceptance criterion in executable form and the one that would have caught the original
  bug. Note that e2e sits outside the four CI gates, so it is not a substitute for the
  unit coverage above.

Existing `board-input.test.ts` coverage of `applyLetter`/`applyBackspace` migrates with
the functions.

## Acceptance criteria

1. A player can enter a complete board — answer and guesses — with one click and no
   further pointer interaction.
2. Typing into the board before the answer is complete is refused explicitly, and the
   refusal is reachable as a distinct outcome in a test.
3. A caret is visible at all times in exactly one place, and it moves without being
   clicked.
4. Backspace walks from the board back into the answer.
5. Clicking the answer slots returns the cursor there from anywhere.
6. The coach line announces the hand-off through an `aria-live` region.
7. All four gates green, plus the e2e zero-click spec.

## Out of scope

- **Correcting a board after submitting.** A discoverability question about the edit path
  from the scoreboard, not about the entry model. It is the one item on the owner's list
  that this design does not address, and it should be filed separately rather than folded
  in.
- **Guess-first answer derivation.** Considered, ruled out above, worth its own issue.
- **Screenshot import accuracy** — `wordle-teams-418`.
- **Scoring**, and any change to what a board means.
- **The step-1 day/method split** — unchanged.
- **`lib/funnel.ts`'s destination** — `wordle-teams-dfb8`. This design deliberately does
  not depend on it.

## References

- Live model comparison, built 2026-09-14:
  https://claude.ai/code/artifact/81de2c8d-6da4-4a03-820f-dd85afe94116
- `wordle-teams-wty4.1.6` — the issue, and its funnel/watched-session framing
- `wordle-teams-418` — screenshot import, whose re-scope re-opened share-text import
- `wordle-teams-qt4` — the onboarding tour, re-scoped to "what is still unexplained"
