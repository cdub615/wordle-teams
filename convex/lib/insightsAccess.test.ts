import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  INSIGHTS_TRIAL_DAYS,
  LAUNCH_AT,
  LAUNCH_AT_IS_PLACEHOLDER,
  PLACEHOLDER_LAUNCH_AT,
  hasFullTeamMonth,
  insightsAccess,
  shouldStartTrial,
  trialCanStart,
  trialEndsAtFor,
  trialRatherThanPro,
} from './insightsAccess.ts'

const DAY = 86_400_000
const LAUNCH = Date.UTC(2026, 8, 20) // a real-looking launch, for the rule's tests

describe('LAUNCH_AT', () => {
  /**
   * THE CUTOVER EDIT LANDED 2026-09-30 AND THESE TWO CHANGED WITH IT, which is
   * what they were for. Their predecessors asserted the placeholder still stood
   * ("is still the obvious placeholder, and says so", and a fails-safe pin that
   * no board could start a trial) so that setting the real instant would be a
   * deliberate edit with a failing test pointing at it rather than a silent
   * drift. Both fired on the edit, exactly as written.
   *
   * WHAT REPLACES THEM HAS TO STILL BE ABLE TO FAIL. Asserting merely "not the
   * placeholder any more" would pass for every wrong value anyone could type,
   * which is the same vacuity the file warns about elsewhere — so the real
   * instant is pinned exactly, and the behaviour either side of it is pinned
   * through the DEFAULT `launchAt`, i.e. against LAUNCH_AT itself rather than
   * against the local `LAUNCH` fixture the rule's own tests use.
   */
  test('is the real cutover instant, not the placeholder', () => {
    expect(LAUNCH_AT_IS_PLACEHOLDER).toBe(false)
    expect(LAUNCH_AT).not.toBe(PLACEHOLDER_LAUNCH_AT)
    // Pinned exactly. 2026-09-30T00:00:00Z — deliberately backdated to the start
    // of launch day so no window exists where /pricing is silent but the constant
    // is set; insightsAccess.ts's own comment on the value has the reasoning.
    expect(new Date(LAUNCH_AT).toISOString()).toBe('2026-09-30T00:00:00.000Z')
  })

  test('a board entered before launch still starts nothing; one after starts the trial', () => {
    // The fails-safe pin's successor. Same job — nobody gets a trial by accident
    // — but now the accident it guards against is a LAUNCH_AT that drifted
    // earlier, not one that was never set. Both directions, and the boundary.
    expect(shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH_AT - 1 })).toBe(false)
    expect(shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH_AT })).toBe(true)
    expect(shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH_AT + DAY })).toBe(true)
    // And the property that actually matters on launch day: a board entered NOW
    // starts a trial. This is the assertion that would have read `false` for the
    // whole of the placeholder era.
    expect(shouldStartTrial({ trialEndsAt: undefined, enteredAt: Date.now() })).toBe(true)
  })
})

describe('shouldStartTrial', () => {
  test('a board entered after launch starts the clock', () => {
    expect(
      shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH + DAY, launchAt: LAUNCH }),
    ).toBe(true)
  })

  test('a board entered exactly at launch starts it', () => {
    expect(shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH, launchAt: LAUNCH })).toBe(
      true,
    )
  })

  // The first of the two opposite directions the rule is entirely about.
  test('a board entered BEFORE launch does not', () => {
    expect(
      shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH - 1, launchAt: LAUNCH }),
    ).toBe(false)
    expect(
      shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH - 400 * DAY, launchAt: LAUNCH }),
    ).toBe(false)
  })

  // The second. A player already holding a clock never gets another.
  test('a second board does not re-stamp, so the trial cannot be extended', () => {
    const running = LAUNCH + 10 * DAY
    expect(
      shouldStartTrial({ trialEndsAt: running, enteredAt: LAUNCH + DAY, launchAt: LAUNCH }),
    ).toBe(false)
  })

  test('not even after the trial has already expired', () => {
    // Otherwise a lapsed player entering a board would silently get a second
    // free month, and every month after that.
    const expired = LAUNCH - 100 * DAY
    expect(
      shouldStartTrial({ trialEndsAt: expired, enteredAt: LAUNCH + DAY, launchAt: LAUNCH }),
    ).toBe(false)
  })
})

// The one list of "plausible now" instants both the headline property and the
// fails-safe pin below read, so a claim that the two look at the same set is
// enforced rather than eyeballed from two hand-typed arrays.
const PLAUSIBLE_NOWS = [Date.now(), Date.UTC(2026, 11, 25), Date.UTC(2030, 0, 1)]

describe('trialCanStart', () => {
  // THE HEADLINE PROPERTY, not a truth table: /pricing's trial section and the
  // server's decision must not be able to disagree, or the page is back to
  // advertising a trial the server refuses to stamp — the exact bug this
  // predicate exists to close.
  //
  // VACUOUS TODAY, LOAD-BEARING ONCE LAUNCH_AT IS SET: every instant in
  // PLAUSIBLE_NOWS is well before the 2099 placeholder, so both sides
  // currently read `false` and this test cannot yet observe the two
  // disagreeing. It starts doing real work — able to actually fail — the
  // moment the owner's cutover edit lands and `now >= LAUNCH_AT` becomes
  // reachable for a real instant.
  //
  // `trialEndsAt: undefined` is held fixed on the shouldStartTrial side
  // DELIBERATELY, not incidentally: shouldStartTrial also says no to a player
  // who already holds a trial, and that refusal is a fact about the PLAYER,
  // not about whether the product is offering trials at all. /pricing has no
  // player to ask, so the only question in scope is the timing half, and
  // holding trialEndsAt at "no trial yet" is what isolates that half.
  test('agrees with shouldStartTrial for a player with no trial yet, for plausible instants', () => {
    for (const now of PLAUSIBLE_NOWS) {
      expect(trialCanStart({ now }), `now=${new Date(now).toISOString()}`).toBe(
        shouldStartTrial({ trialEndsAt: undefined, enteredAt: now }),
      )
    }
  })

  // Both sides of the boundary AND the boundary instant itself, with an
  // explicit launchAt the way shouldStartTrial's own tests use `LAUNCH` —
  // vacuous otherwise, per shouldStartTrial's own comment on testing a
  // threshold in only one direction. This is also the test that would catch
  // `>=` silently becoming `>`: at `now === launchAt` exactly, shouldStartTrial
  // stays `true` (its own "exactly at launch starts it" test), so a `>` here
  // would report `false` and disagree.
  test('agrees with shouldStartTrial across the launch boundary, given the same launchAt', () => {
    for (const now of [LAUNCH - DAY, LAUNCH, LAUNCH + DAY]) {
      expect(
        trialCanStart({ now, launchAt: LAUNCH }),
        `now = LAUNCH ${(now - LAUNCH) / DAY >= 0 ? '+' : ''}${(now - LAUNCH) / DAY} day(s)`,
      ).toBe(shouldStartTrial({ trialEndsAt: undefined, enteredAt: now, launchAt: LAUNCH }))
    }
  })

  // The same "fails safe" property LAUNCH_AT's own describe block pins for
  // shouldStartTrial, restated for trialCanStart: while LAUNCH_AT stands at
  // its 2099 placeholder, nothing /pricing does can make the trial section
  // claim a trial is on for any now a real visitor could have. Like that
  // sibling pin, this is EXPECTED TO FAIL once the owner's cutover edit lands
  // — LAUNCH_AT_IS_PLACEHOLDER flips first and the assertion below it catches
  // that, deliberately, the same way the LAUNCH_AT describe block's own test
  // does.
  test('now that LAUNCH_AT is set, a real now can start it — and one before it cannot', () => {
    // Successor to the fails-safe pin that asserted LAUNCH_AT_IS_PLACEHOLDER and
    // that NO plausible now could start a trial. That flipped on the cutover edit,
    // deliberately and as its own comment predicted.
    //
    // THE SIBLING TEST ABOVE STOPPED BEING VACUOUS AT THE SAME MOMENT. Its comment
    // says it is "VACUOUS TODAY, LOAD-BEARING ONCE LAUNCH_AT IS SET" because every
    // instant in PLAUSIBLE_NOWS sat before 2099 so both sides read false and it
    // could not observe a disagreement. Every one of them is now at or after
    // LAUNCH_AT, so it compares two trues and can genuinely fail.
    expect(LAUNCH_AT_IS_PLACEHOLDER).toBe(false)
    expect(trialCanStart({ now: LAUNCH_AT - 1 })).toBe(false)
    for (const now of PLAUSIBLE_NOWS) {
      expect(trialCanStart({ now }), `now=${new Date(now).toISOString()}`).toBe(true)
    }
  })

  // NOT A BUG: pinned so the asymmetry reads as intended rather than something
  // a future editor "fixes" into agreement. shouldStartTrial has no
  // placeholder concept — it only compares timestamps — so AT the instant the
  // sentinel represents it would say yes. trialCanStart's gate refuses that
  // same instant on any call where the effective launchAt is the sentinel,
  // because while launchAt IS the placeholder the product is not offering a
  // trial AT ALL, and /pricing saying nothing is the safe direction.
  //
  // USES PLACEHOLDER_LAUNCH_AT DIRECTLY, NOT LAUNCH_AT, so this pin survives
  // the owner's cutover edit rather than breaking at it: LAUNCH_AT changes at
  // cutover (by design), PLACEHOLDER_LAUNCH_AT never does. Passing it as both
  // `now` and an explicit `launchAt` tests the sentinel property on its own
  // terms, independent of whatever LAUNCH_AT currently holds.
  test('diverges from shouldStartTrial at the literal placeholder instant, deliberately', () => {
    expect(
      shouldStartTrial({
        trialEndsAt: undefined,
        enteredAt: PLACEHOLDER_LAUNCH_AT,
        launchAt: PLACEHOLDER_LAUNCH_AT,
      }),
    ).toBe(true)
    expect(
      trialCanStart({ now: PLACEHOLDER_LAUNCH_AT, launchAt: PLACEHOLDER_LAUNCH_AT }),
    ).toBe(false)
  })
})

describe('trialEndsAtFor', () => {
  test('runs one month from the board that started it', () => {
    expect(trialEndsAtFor(LAUNCH)).toBe(LAUNCH + INSIGHTS_TRIAL_DAYS * DAY)
    expect(INSIGHTS_TRIAL_DAYS).toBe(30)
  })
})

describe('insightsAccess', () => {
  const free = { isPro: false, trialEndsAt: undefined, now: LAUNCH }

  test('a free player with no trial still sees Layers 1 and 3', () => {
    // The shape that protects the spec's hard constraint: nothing previously
    // free moves behind the paywall, and a free player always has something.
    const access = insightsAccess(free)
    expect(access.layer1).toBe('free')
    expect(access.layer3).toBe('free')
    expect(access.layer2).toBe('none')
    expect(access.layer4).toBe('none')
    expect(access.trialActive).toBe(false)
    expect(access.trialEndsAt).toBeNull()
  })

  test('pro sees everything in full', () => {
    const access = insightsAccess({ ...free, isPro: true })
    expect(access).toMatchObject({
      layer1: 'full',
      layer2: 'full',
      layer3: 'full',
      layer4: 'full',
      trialActive: false,
    })
  })

  test('a running trial grants Layers 2 and 3, and deliberately not 1 or 4', () => {
    // The spec says "one month of Layers 2 and 3" and this is that read taken
    // literally. If the owner wants the trial to include Layer 1's full history,
    // this expectation is the thing that should change first.
    const access = insightsAccess({ ...free, trialEndsAt: LAUNCH + DAY })
    expect(access.layer2).toBe('full')
    expect(access.layer3).toBe('full')
    expect(access.layer1).toBe('free')
    expect(access.layer4).toBe('none')
    expect(access.trialActive).toBe(true)
    expect(access.trialEndsAt).toBe(LAUNCH + DAY)
  })

  // Both sides of the boundary, because a threshold tested one way is vacuous.
  test('the trial is live one millisecond before it ends', () => {
    const access = insightsAccess({ ...free, trialEndsAt: LAUNCH + 1 })
    expect(access.trialActive).toBe(true)
    expect(access.layer2).toBe('full')
  })

  test('and over at the instant it ends', () => {
    const access = insightsAccess({ ...free, trialEndsAt: LAUNCH })
    expect(access.trialActive).toBe(false)
    expect(access.layer2).toBe('none')
    expect(access.trialEndsAt).toBeNull()
  })

  test('an expired trial takes nothing away from the free tier', () => {
    const access = insightsAccess({ ...free, trialEndsAt: LAUNCH - 400 * DAY })
    expect(access.layer1).toBe('free')
    expect(access.layer3).toBe('free')
  })

  test('pro outranks an expired trial', () => {
    const access = insightsAccess({ isPro: true, trialEndsAt: LAUNCH - DAY, now: LAUNCH })
    expect(access.layer2).toBe('full')
    expect(access.trialActive).toBe(false)
  })
})

describe('trialExpired — the distinction a prompt cannot be written without', () => {
  // THE WHOLE POINT OF THIS FIELD. Before it, a player whose trial ended and a
  // player who never had one were indistinguishable: both got
  // trialActive:false, trialEndsAt:null. A prompt built on that would either
  // stay silent for the person it is for, or nag someone who never had a trial.
  test('a trial that has ended reads as expired', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: 1_000, now: 2_000 })
    expect(access.trialActive).toBe(false)
    expect(access.trialExpired).toBe(true)
  })

  test('never having had a trial is NOT expired', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: undefined, now: 2_000 })
    expect(access.trialActive).toBe(false)
    expect(access.trialExpired).toBe(false)
  })

  test('a running trial is neither active-and-expired nor expired', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: 3_000, now: 2_000 })
    expect(access.trialActive).toBe(true)
    expect(access.trialExpired).toBe(false)
  })

  // Strictly after, matching trialActive's own boundary rule, and tested on both
  // sides because a threshold tested in one direction is vacuous.
  test('the instant it ends, it is expired and not active', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: 2_000, now: 2_000 })
    expect(access.trialActive).toBe(false)
    expect(access.trialExpired).toBe(true)
  })

  // A PRO PLAYER IS NOT SHOWN AN UPGRADE PROMPT, even though their trial did
  // technically end. This is the field's one non-obvious rule and it is why the
  // prompt can render straight from it without a second condition.
  test('a pro player whose trial ended is not expired, because they upgraded', () => {
    const access = insightsAccess({ isPro: true, trialEndsAt: 1_000, now: 2_000 })
    expect(access.trialExpired).toBe(false)
  })

  test('a pro player who never had a trial is not expired either', () => {
    const access = insightsAccess({ isPro: true, trialEndsAt: undefined, now: 2_000 })
    expect(access.trialExpired).toBe(false)
  })
})


/**
 * hasFullTeamMonth — THE ONE DEFINITION OF "WHOLE MONTH, OR JUST TODAY'S FACT"
 * (wordle-teams-iht.3.1).
 *
 * It is a one-line predicate and it is tested anyway, because of what is about
 * to be built on it: wordle-teams-iht.3.2 makes the SERVER's teamMonth payload
 * depend on this answer, so getting it wrong stops being a rendering bug and
 * becomes the whole month shipped to a viewer who has not paid for it.
 */
describe('hasFullTeamMonth', () => {
  test('full yes, free no', () => {
    expect(hasFullTeamMonth('full')).toBe(true)
    expect(hasFullTeamMonth('free')).toBe(false)
  })

  test("'none' is not a full month either, though layer3 is never 'none' today", () => {
    // insightsAccess returns 'full' or 'free' for layer3 and nothing else. This
    // pins the CLOSED default for a value that does not occur yet, so a third
    // tier added later cannot open the payload by being unhandled.
    expect(hasFullTeamMonth('none')).toBe(false)
  })

  test('A TRIAL IS A FULL MONTH, which is why this is not an isPro check', () => {
    // The trap this predicate's name exists to avoid. A trialist is 'full' on
    // Layer 3 and 'free' on Layer 1 AT THE SAME TIME, so anything reading the
    // tier as "is a paying customer" gets trials wrong whichever way it guesses.
    const trial = insightsAccess({
      isPro: false,
      trialEndsAt: Date.now() + 86_400_000,
      now: Date.now(),
    })
    expect(trial.trialActive).toBe(true)
    expect(hasFullTeamMonth(trial.layer3)).toBe(true)
    // ...and the same object is NOT full on Layer 1, which is the asymmetry.
    expect(trial.layer1).toBe('free')
  })

  test('it agrees with insightsAccess for every tier it actually produces', () => {
    // Derived from the source of truth rather than restated, so this cannot
    // drift from insightsAccess the way three hand-written comparisons did.
    const now = Date.now()
    const free = insightsAccess({ isPro: false, trialEndsAt: undefined, now })
    const pro = insightsAccess({ isPro: true, trialEndsAt: undefined, now })
    const expired = insightsAccess({ isPro: false, trialEndsAt: now - 1, now })

    expect(hasFullTeamMonth(free.layer3)).toBe(false)
    expect(hasFullTeamMonth(pro.layer3)).toBe(true)
    expect(hasFullTeamMonth(expired.layer3)).toBe(false)
  })
})

/**
 * trialRatherThanPro — "is the TRIAL why this player has these blocks" — which is
 * the question every piece of trial language on the surface has to ask, and the
 * one three of them got wrong by asking `trialActive` instead (wordle-teams-cpqf).
 *
 * THE PRO-WITH-A-RUNNING-CLOCK ROW IS THE WHOLE POINT. It is not a contrived
 * combination: nothing in the write path consults isPro before stamping
 * insightsTrialEndsAt, and by the owner's decision nothing will, so EVERY
 * subscriber who has played since launch is in exactly this state. It is the
 * state the owner reported from the live site.
 *
 * ROWS BUILT THROUGH insightsAccess WHERE THEY CAN BE, not from hand-written
 * literals, for the reason hasFullTeamMonth's last row gives: a fixture that
 * agrees with the predicate by construction proves nothing about the pairing of
 * trialActive with layer4 that the real resolver produces.
 */
describe('trialRatherThanPro', () => {
  const now = Date.now()
  const inAWeek = now + 7 * 86_400_000

  test('a trialist is on the trial rather than on Pro', () => {
    const trial = insightsAccess({ isPro: false, trialEndsAt: inAWeek, now })
    expect(trial.trialActive).toBe(true)
    expect(trialRatherThanPro(trial)).toBe(true)
  })

  test('A PRO PLAYER WHOSE TRIAL CLOCK IS STILL RUNNING IS NOT ON A TRIAL', () => {
    // The reported bug, stated as the predicate's defining case. `trialActive` is
    // true here and says nothing about who is paying; layer4 is what separates
    // them.
    const proMidTrial = insightsAccess({ isPro: true, trialEndsAt: inAWeek, now })
    expect(proMidTrial.trialActive).toBe(true)
    expect(proMidTrial.layer4).toBe('full')
    expect(trialRatherThanPro(proMidTrial)).toBe(false)
  })

  test('a pro player who never had a trial is not on one either', () => {
    const pro = insightsAccess({ isPro: true, trialEndsAt: undefined, now })
    expect(trialRatherThanPro(pro)).toBe(false)
  })

  test('a free player is not on a trial, and nor is an expired one', () => {
    const free = insightsAccess({ isPro: false, trialEndsAt: undefined, now })
    const expired = insightsAccess({ isPro: false, trialEndsAt: now - 1, now })
    expect(trialRatherThanPro(free)).toBe(false)
    expect(trialRatherThanPro(expired)).toBe(false)
  })

  test('it reads the two fields it is given and nothing else', () => {
    // Pick<> is satisfied by the pair alone, which is what lets the panel ask
    // without holding a whole InsightsAccess. Both directions of layer4 are here
    // so the comparison cannot be `=== 'none'` by accident — 'free' is not a
    // value layer4 takes today, and a predicate written against 'none' would
    // quietly answer the wrong thing if it ever did.
    expect(trialRatherThanPro({ trialActive: true, layer4: 'none' })).toBe(true)
    expect(trialRatherThanPro({ trialActive: true, layer4: 'free' })).toBe(true)
    expect(trialRatherThanPro({ trialActive: true, layer4: 'full' })).toBe(false)
    expect(trialRatherThanPro({ trialActive: false, layer4: 'none' })).toBe(false)
  })
})

/**
 * NOBODY RE-SPELLS THE QUESTION (wordle-teams-iht.3.1).
 *
 * THE DEFECT THIS PREVENTS IS THE ONE THAT ALREADY HAPPENED. `layer3 === 'full'`
 * was written out in three places, and team-section.tsx carried a comment
 * telling the next reader that two of them had to keep agreeing. A comment
 * cannot fail a build. This can.
 *
 * IT MATTERS MORE FROM wordle-teams-iht.3.2 ONWARD, when the server's teamMonth
 * payload starts depending on the same answer. A fourth copy that drifts is not
 * a card rendered from the wrong month — it is the whole team month delivered to
 * someone on the free tier. The cheapest moment to stop a fourth copy existing
 * is before it is written.
 *
 * SCANS SOURCE, COMMENT-STRIPPED, for the reason styles.test.ts gives for the
 * same shape of test: the prose in these files quotes the very literal being
 * forbidden — this file included, and team-section.tsx's surviving comment still
 * explains what it used to do — so a raw text match would be satisfied by the
 * explanation rather than by the code.
 */
describe('the tier comparisons live where they are supposed to', () => {
  /** Every .ts/.tsx under a tree, minus tests and generated output. */
  function sourceFiles(dir: string): Array<string> {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' || entry.name === '_generated'
          ? []
          : sourceFiles(path)
      }
      if (!/\.tsx?$/.test(entry.name)) return []
      return /\.test\.tsx?$/.test(entry.name) ? [] : [path]
    })
  }

  // A regex stripper rather than test-support/source-ast's `codeOf`, which is
  // the tool this repo normally reaches for. That module lives under src/, and
  // this file does not import across into src/ — convex/ is a deployed tree and
  // keeping its dependency direction one-way is worth more here than sharing a
  // helper for two lines of work.
  const withoutComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  test('only insightsAccess.ts compares layer3 to a tier literal', () => {
    const comparison = /layer3\s*[!=]==\s*['"]full['"]/

    const offenders = [...sourceFiles('src'), ...sourceFiles('convex')]
      .filter((file) => comparison.test(withoutComments(readFileSync(file, 'utf8'))))
      // Normalised, so the expectation reads the same on any platform.
      .map((file) => file.replace(/\\/g, '/'))

    // Listed rather than counted, so a failure names the file that has to call
    // hasFullTeamMonth instead of a number somebody has to go and chase.
    expect(offenders).toEqual(['convex/lib/insightsAccess.ts'])
  })

  /**
   * THE SAME GUARD FOR layer4, AND IT IS AN ALLOWLIST RATHER THAN "exactly one
   * place" — because layer4 is asked TWO different questions and only one of them
   * belongs to a predicate.
   *
   *  - convex/insights.ts asks Layer 4's OWN question: may this caller see the
   *    global comparison at all. That is the field used for what it is, exactly as
   *    layer3 is used inside hasFullTeamMonth, and it is legitimate.
   *  - trialRatherThanPro asks a DIFFERENT question through the same comparison:
   *    layer4 === 'full' is reachable for exactly the paying population, so it
   *    stands in for an isPro field InsightsAccess does not carry.
   *
   * WHAT THIS CATCHES IS A THIRD SPELLING, which is how wordle-teams-cpqf
   * happened: trial-active-card.tsx hand-wrote the proxy, the two TrialMarker
   * mounts did not, and nothing could fail. A component that re-derives "is this
   * player paying" instead of calling the predicate lands in this list and has to
   * argue for itself here.
   *
   * SORTED, unlike the layer3 test above, which can expect a single element and
   * ignore traversal order. readdirSync order is not guaranteed across platforms,
   * so two entries need pinning down.
   */
  test('only insightsAccess and the Layer 4 payload gate compare layer4 to a tier', () => {
    const comparison = /layer4\s*[!=]==\s*['"]full['"]/

    const offenders = [...sourceFiles('src'), ...sourceFiles('convex')]
      .filter((file) => comparison.test(withoutComments(readFileSync(file, 'utf8'))))
      .map((file) => file.replace(/\\/g, '/'))
      .sort()

    expect(offenders).toEqual(['convex/insights.ts', 'convex/lib/insightsAccess.ts'])
  })
})
