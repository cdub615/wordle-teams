import { describe, expect, test } from 'vitest'
import {
  GRADUATION_BODY,
  GRADUATION_CTA,
  GRADUATION_TITLE,
  MODEL_LINE,
  canDismissCard,
  cardHeading,
  incompleteTasks,
  shouldShowCard,
  shouldShowGraduation,
  taskSetKey,
  type OnboardingFacts,
} from './onboarding-tasks.ts'

/** Every fact false — a brand-new self-signup who has done nothing. */
const nothing: OnboardingFacts = {
  enteredBoard: false,
  hasTeam: false,
  hasInvited: false,
  dismissed: false,
  inLeague: true,
}

describe('incompleteTasks', () => {
  // PUBLIC LEAGUES (zic8.3, spec §8.4). The "Join the opener wars" offer goes ONLY
  // to a player who has never joined a league, and as an onboarding step only
  // to one with no team — a team player who has never joined gets the
  // dashboard card's picker instead (leagues-card), so offering it here too
  // would be the duplicate the owner ruled out.
  test('a teamless player not in a league is offered the league', () => {
    expect(incompleteTasks({ ...nothing, inLeague: false })).toEqual([
      { id: 'board', title: "Enter today's board", hint: 'About 10 seconds' },
      { id: 'league', title: 'Join the opener wars', hint: 'Pick a side — your boards count whatever word you start with.' },
      { id: 'team', title: 'Create a team', hint: 'Where scores get compared' },
    ])
  })

  test('the league step disappears once in a league, and is never offered to a player with a team', () => {
    expect(
      incompleteTasks({ ...nothing, enteredBoard: true, inLeague: true }).map((t) => t.id),
    ).toEqual(['team'])
    expect(
      incompleteTasks({ enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false, inLeague: false }),
    ).toEqual([])
  })

  test('an invited joiner owes only the board', () => {
    // completeProfileFor auto-joins them to a populated team, so create and
    // invite are both already satisfied on arrival. See convex/players.ts:226.
    const joiner: OnboardingFacts = { ...nothing, hasTeam: true, hasInvited: true }
    expect(incompleteTasks(joiner).map((t) => t.id)).toEqual(['board'])
  })

  test('the 456 shape — played, made a team of one — owes only the invite', () => {
    const soloTeam: OnboardingFacts = { ...nothing, enteredBoard: true, hasTeam: true }
    expect(incompleteTasks(soloTeam).map((t) => t.id)).toEqual(['invite'])
  })

  test('every task carries its copy, attached to the right id', () => {
    // TWO FIXTURES RATHER THAN ONE, because 'team' and 'invite' can no longer
    // appear together: one wants hasTeam false and the other wants it true.
    // All three copies are still asserted, which is what this test is for.
    expect(incompleteTasks(nothing)).toEqual([
      { id: 'board', title: "Enter today's board", hint: 'About 10 seconds' },
      { id: 'team', title: 'Create a team', hint: 'Where scores get compared' },
    ])
    expect(incompleteTasks({ ...nothing, hasTeam: true })).toEqual([
      { id: 'board', title: "Enter today's board", hint: 'About 10 seconds' },
      { id: 'invite', title: 'Invite someone', hint: 'A scoreboard needs someone to score against' },
    ])
  })

  test('the invite task needs a team first, because it has nowhere to point without one', () => {
    // THE DEAD END THIS PREVENTS, and the reason the gate is here rather than
    // in the route. Without `hasTeam &&`, a brand-new signup — the 87%
    // wordle-teams-456 is about — is shown a live "Invite someone" button that
    // fires onboarding_task_click and navigates to /team with no team id, and
    // routes/team.tsx redirects it straight back to /app. Nothing happens, and
    // the funnel gains a click that can never convert.
    //
    // NOT the precedence the header forbids: board and team remain independent
    // of each other and of this. This is "the action is impossible", not "do
    // this one second".
    expect(incompleteTasks(nothing).map((t) => t.id)).toEqual(['board', 'team'])
    expect(incompleteTasks(nothing).map((t) => t.id)).not.toContain('invite')

    // And it appears the moment a team exists — the gate defers the task, it
    // does not delete it.
    expect(incompleteTasks({ ...nothing, hasTeam: true }).map((t) => t.id)).toEqual([
      'board',
      'invite',
    ])
  })

  test('a card never shows more than two tasks, since team and invite are exclusive', () => {
    // Guards the claim incompleteTasks' own comment makes, over every one of
    // the eight fact combinations rather than the two spot-checked above.
    for (const enteredBoard of [false, true]) {
      for (const hasTeam of [false, true]) {
        for (const hasInvited of [false, true]) {
          const ids = incompleteTasks({ enteredBoard, hasTeam, hasInvited, dismissed: false, inLeague: true }).map(
            (t) => t.id,
          )
          expect(ids.length).toBeLessThanOrEqual(2)
          expect(ids.includes('team') && ids.includes('invite')).toBe(false)
          // The invite task never reaches a player with no team, in ANY
          // combination — this is the assertion the dead end would trip.
          if (!hasTeam) expect(ids).not.toContain('invite')
        }
      }
    }
  })
})

describe('shouldShowCard', () => {
  test('shows while any task is incomplete', () => {
    expect(shouldShowCard(nothing)).toBe(true)
  })

  test('does NOT retire when every task is complete — it graduates', () => {
    // THIS TEST ASSERTED THE OPPOSITE UNTIL wordle-teams-wty4.1.14.6, and is
    // rewritten rather than deleted because the behaviour it guarded is the
    // behaviour that changed. The card used to vanish here, which threw away
    // the one moment a player has proved they are willing to set things up;
    // it now shows the graduation nudge, and `shouldShowCard` is the predicate
    // that says "draw a card at all" rather than "draw the checklist".
    const done: OnboardingFacts = {
      enteredBoard: true,
      hasTeam: true,
      hasInvited: true,
      dismissed: false,
      inLeague: true,
    }
    expect(shouldShowCard(done)).toBe(true)
    expect(shouldShowGraduation(done)).toBe(true)
  })

  test('a dismissal hides it once the player has a team', () => {
    expect(shouldShowCard({ ...nothing, hasTeam: true, dismissed: true })).toBe(false)
  })

  test('a dismissal still does NOT hide it for a player with a board but no team', () => {
    // CORRECTED 2026-09-29, and it was wrong in the first cut of this rule: a
    // board does NOT put anything on /app. routes/app.tsx returns early at
    // `teams.length === 0` (line 882) and TodayPanel is mounted ~500 lines below
    // that return, so the team-less branch shows the onboarding card, two
    // dialogs and a visually-hidden <h1> — entering a board changes none of it.
    expect(shouldShowCard({ ...nothing, enteredBoard: true, dismissed: true })).toBe(true)
  })

  test('a dismissal does NOT hide it while the dashboard would be empty', () => {
    // THE WHOLE POINT OF canDismissCard. A player with no team and no board has
    // nothing else on /app — routes/app.tsx's zero-teams branch renders this card
    // and little else — so honouring the dismissal leaves a blank main section,
    // which is what was reported on dev. The card outlives the stamp until there
    // is something behind it.
    expect(shouldShowCard({ ...nothing, dismissed: true })).toBe(true)
  })

  test('re-shows for an account that ALREADY dismissed with nothing to show', () => {
    // The reason this rule lives in shouldShowCard rather than only in the X.
    // Hiding the button stops the NEXT player reaching this state; it does nothing
    // for the ones already in it, whose `players.onboardingDismissedAt` is already
    // stamped. Reading the stamp through this predicate repairs them on next load
    // with no migration and no write.
    const stranded: OnboardingFacts = {
      enteredBoard: false,
      hasTeam: false,
      hasInvited: false,
      dismissed: true,
      inLeague: true,
    }
    expect(shouldShowCard(stranded)).toBe(true)
  })

  test('what hides the card is a dismissal AND something to show, in every combination', () => {
    // Over every fact combination, because the predicate is two booleans now and a
    // spot check cannot tell a rewritten rule from a coincidence. If a future edit
    // reintroduces a task-count condition, this is where it fails.
    for (const enteredBoard of [false, true]) {
      for (const hasTeam of [false, true]) {
        for (const hasInvited of [false, true]) {
          expect(shouldShowCard({ enteredBoard, hasTeam, hasInvited, dismissed: false, inLeague: true })).toBe(true)
          const dismissed = { enteredBoard, hasTeam, hasInvited, dismissed: true, inLeague: true }
          expect(shouldShowCard(dismissed)).toBe(!canDismissCard(dismissed))
        }
      }
    }
  })
})

describe('canDismissCard', () => {
  test('false for a player with no team', () => {
    expect(canDismissCard(nothing)).toBe(false)
  })

  test('A TEAM IS THE ONLY THING THAT UNLOCKS IT, and a board specifically does not', () => {
    // THE ORIGINAL RULE SAID `hasTeam || enteredBoard` AND THAT WAS WRONG —
    // corrected 2026-09-29 after the owner pointed out that entering a board with
    // no team still leaves the dashboard empty. It does: routes/app.tsx returns
    // early at `teams.length === 0` (line 882), and every panel that could render
    // a board — TodayPanel at line ~1419, ScoresTable, TeamBoards — is below it.
    // What the team-less branch renders is the onboarding card, CreateTeamDialog,
    // the passkey offer and a visually-hidden <h1>. `boardSurface` is on that
    // branch, but it is BoardEntrySurface, a dialog keyed to `boardOpen` — not
    // content.
    //
    // So a team is not merely SUFFICIENT, it is NECESSARY: it is what moves the
    // player onto the dashboard branch at all.
    expect(canDismissCard({ ...nothing, hasTeam: true })).toBe(true)
    expect(canDismissCard({ ...nothing, enteredBoard: true })).toBe(false)
    expect(canDismissCard({ ...nothing, hasTeam: true, enteredBoard: true })).toBe(true)
  })

  test('ignores every fact except hasTeam', () => {
    // An invite is not content on /app — it is someone else's pending state — so
    // it must not unlock the dismissal. And whether the player already dismissed
    // cannot decide whether they MAY: that would make the rule self-satisfying
    // for exactly the accounts it exists to repair.
    expect(canDismissCard({ ...nothing, hasInvited: true })).toBe(false)
    expect(canDismissCard({ ...nothing, dismissed: true })).toBe(false)
    // And hasTeam alone carries it regardless of what the others say.
    for (const enteredBoard of [false, true]) {
      for (const hasInvited of [false, true]) {
        for (const dismissed of [false, true]) {
          for (const inLeague of [false, true]) {
            const rest = { enteredBoard, hasInvited, dismissed, inLeague }
            expect(canDismissCard({ hasTeam: true, ...rest })).toBe(true)
            expect(canDismissCard({ hasTeam: false, ...rest })).toBe(false)
          }
        }
      }
    }
  })
})

describe('shouldShowGraduation', () => {
  const done: OnboardingFacts = {
    enteredBoard: true,
    hasTeam: true,
    hasInvited: true,
    dismissed: false,
    inLeague: true,
  }

  test('true once nothing is outstanding', () => {
    expect(shouldShowGraduation(done)).toBe(true)
  })

  test('false while any task remains, in every combination that leaves one', () => {
    // The two states are EXCLUSIVE and EXHAUSTIVE over an undismissed player:
    // exactly one of "checklist" and "graduation" is true, so the card can
    // never draw both and can never draw neither while it is visible.
    for (const enteredBoard of [false, true]) {
      for (const hasTeam of [false, true]) {
        for (const hasInvited of [false, true]) {
          const facts = { enteredBoard, hasTeam, hasInvited, dismissed: false, inLeague: true }
          const remaining = incompleteTasks(facts).length
          expect(shouldShowGraduation(facts)).toBe(remaining === 0)
          expect(shouldShowGraduation(facts)).toBe(shouldShowCard(facts) && remaining === 0)
        }
      }
    }
  })

  test('a dismissal silences the nudge as well as the checklist', () => {
    // THE WHOLE ARGUMENT FOR REUSING `dismissed` RATHER THAN ADDING A FLAG. A
    // player who closed this card has said they do not want it; honouring that
    // for the checklist and then showing them a second thing in the same slot
    // would be the migration-free version of ignoring them.
    expect(shouldShowGraduation({ ...done, dismissed: true })).toBe(false)
  })
})

describe('the graduation copy', () => {
  // PINNED THE WAY MODEL_LINE IS, and for a sharper reason: every claim here
  // has to be true for a player who has paid nothing. See the constant's own
  // comment for what the free tier actually holds — one benchmarked board and
  // one fact about today.
  test('never mentions Pro, upgrading, trials or paying', () => {
    const copy = [GRADUATION_TITLE, GRADUATION_BODY, GRADUATION_CTA].join(' ').toLowerCase()
    for (const word of ['pro', 'upgrade', 'trial', 'free', 'unlock', '$']) {
      expect(copy).not.toContain(word)
    }
  })

  test('does not promise a trend, a history, or a comparison against other players', () => {
    // THE TWO OVERCLAIMS THE DRAFTED COPY MADE. Layer 1 ranks the opening word
    // against a SIMULATED corpus, not against other people's guesses, and a
    // free player gets today's team standing with nothing historical beside
    // it — so "everyone else's" and "gaining" were both promises the page
    // could not keep.
    const body = GRADUATION_BODY.toLowerCase()
    for (const word of ['everyone', 'gaining', 'trend', 'history', 'over time', 'average']) {
      expect(body).not.toContain(word)
    }
  })

  test('names the two free slices the page actually has', () => {
    expect(GRADUATION_BODY).toContain('opening word')
    expect(GRADUATION_BODY).toContain('today')
    expect(GRADUATION_CTA).toBe('See your insights')
    expect(GRADUATION_TITLE).toBe('You are all set up')
  })
})

describe('cardHeading', () => {
  test('reads "Get started" while more than one task remains', () => {
    expect(cardHeading(nothing)).toBe('Get started')
  })

  test('reads "One more thing" on the last remaining task', () => {
    const soloTeam: OnboardingFacts = { ...nothing, enteredBoard: true, hasTeam: true }
    expect(cardHeading(soloTeam)).toBe('One more thing')
  })

  test('reads "Get started" when nothing remains at all', () => {
    // NO LONGER REACHABLE THROUGH THE CARD, and kept as a pure-function
    // assertion rather than deleted: the zero-task state now renders the
    // graduation heading (GRADUATION_TITLE) instead of calling this, so this
    // pins the fallback branch for any future caller rather than a screen.

    const done: OnboardingFacts = { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false, inLeague: true }
    expect(cardHeading(done)).toBe('Get started')
  })
})

describe('MODEL_LINE', () => {
  // The scoring defaults (convex/fixtures.ts:34) run +5 for one guess down to
  // -3 for a failure — that's the illustration. The rule itself lives in
  // convex/lib/scoring.ts:119's winnerOf: a strict `>` while walking the list
  // in order, so the HIGHEST monthly total wins. An earlier draft of this
  // copy said "lowest", which would teach the wrong rule on the one screen
  // built to explain the model. Pinned so it cannot regress.
  test('says highest wins, never lowest', () => {
    expect(MODEL_LINE).toContain('Highest monthly total wins')
    expect(MODEL_LINE.toLowerCase()).not.toContain('lowest')
  })
})

describe('taskSetKey', () => {
  test('is stable for the same set and distinct across sets', () => {
    // 'board,team' rather than the 'board,team,invite' this once read: the
    // invite task now waits for a team. See the prerequisite test above.
    expect(taskSetKey(incompleteTasks(nothing))).toBe('board,team')
    expect(taskSetKey(incompleteTasks({ ...nothing, hasTeam: true }))).toBe('board,invite')
    expect(taskSetKey(incompleteTasks({ ...nothing, inLeague: false }))).toBe('board,league,team')
  })
})
