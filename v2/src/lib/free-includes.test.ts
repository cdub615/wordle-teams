// @vitest-environment node
//
// node rather than the suite's default edge-runtime, because the two disk tests
// below read the filesystem, and so does the surface census at the foot of the
// file. That is the whole point of the first two, in pro-benefits.test.ts's words:
// a path that does not resolve is a claim nobody checked.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  longestSharedRun,
  notAFile,
  SHARED_RUN_LIMIT,
  words,
} from '#/test-support/copy-claims.ts'
import { importedModulesOf, runtimeImportsOf } from '#/test-support/source-ast.ts'
import { PRO_BENEFITS } from './pro-benefits.ts'
import { FREE_TEAM_LIMIT } from '../../convex/lib/teamLimits.ts'
import { FREE_MONTHS } from '../../convex/lib/monthWindow.ts'
import { FREE_INCLUDES, freeInclusionsFor } from './free-includes.ts'

/** Every line a reader of the free column actually sees, title and body apart. */
const lines = FREE_INCLUDES.flatMap((inclusion) => [inclusion.title, inclusion.body])

/**
 * Every file one entry's sentence rests on. BOTH disk-touching tests below read
 * this, so neither can end up checking a subset of what an entry claims — which is
 * exactly the defect `alsoGrantedIn` was added to fix.
 */
const pathsOf = (inclusion: (typeof FREE_INCLUDES)[number]) => [
  inclusion.checkedAgainst,
  ...inclusion.alsoGrantedIn,
]

/** src/, whose every module is a candidate surface for the census below. */
const SRC = resolve(__dirname, '..')

/**
 * Every module under src/, so the census can ask which of them name this
 * inventory.
 *
 * THE SEVENTH WALKER IN THIS REPO, AND THE COUNT IS NOT AN ACCIDENT.
 * src/checkout-entry-point.test.ts enumerates the six that came before it and
 * states the rule for consolidating them: worth doing when two of them want the
 * SAME filter, not when a seventh appears. This one wants that file's filter
 * exactly — `.ts`/`.tsx`, `.test.ts` excluded — so it is the first pair that
 * qualifies, and it is left as a copy anyway because the two suites ask different
 * questions of the result and because wordle-teams-vxkr's consolidation is about
 * the copy-claim idioms, not the walkers. Named here so it is a decision on record
 * rather than a tally nobody kept.
 */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
    })

describe('FREE_INCLUDES', () => {
  test('lists exactly the six things a free account gets today', () => {
    // A COUNT AND ORDER ASSERTION, deliberately, and toEqual on the whole list
    // rather than toHaveLength: a reorder, a deletion and a reworded id all have
    // to fail, and only the full list does that. This file is copy, and copy is
    // the one thing typecheck, lint and build cannot check — pro-benefits.test.ts
    // carries the same assertion over the other column for the same reason.
    //
    // THE ORDER IS WHAT /pricing RENDERS, top to bottom, so this is a claim about
    // the page as well as about the list.
    expect(FREE_INCLUDES.map((inclusion) => inclusion.id)).toEqual([
      'teams',
      'months',
      'benchmark',
      'team-fact',
      'chat',
      'reminders',
    ])
  })

  test('pins the six titles, which are shipped copy and nothing else can see', () => {
    // THE SENTENCES ARE THE DELIVERABLE AND THIS IS THE ONLY GATE OVER THEM.
    // Every surface that describes the free tier now renders these strings rather
    // than writing its own — components/pricing/tier-table.tsx renders all six,
    // components/home/also-free.tsx and components/home/insights-payoff.tsx render
    // two each — so before this assertion existed a reworded title shipped behind
    // four green gates. Measured before this assertion was written: rewording the
    // `chat` title left every test in the suite passing.
    //
    // ONE SOURCE PLUS ONE TEST IS NOT THE DEFECT wordle-teams-wty4.1.14.11 WAS
    // RAISED ABOUT, and the difference is worth stating because the two look alike
    // from a distance. That issue was two SURFACES holding two copies of one
    // sentence, which had to be edited in lockstep and drifted when they were not.
    // A deliberate reword here is one edit to the copy and one to the list below
    // it, in the same file — the shape pro-benefits.test.ts's own id assertion
    // argues for, copy being the one thing typecheck, lint and build cannot check.
    //
    // THERE IS A THIRD EDIT FOR FOUR OF THE SIX, AND IT IS OUTSIDE THE GATES.
    // e2e/routes.spec.ts transcribes the landing's whole h3 outline, which spells
    // out `benchmark`, `team-fact`, `chat` and `reminders` by title — its own
    // comment records why it is transcribed rather than derived. So rewording one
    // of those four costs three files across two test files, and the one this
    // suite cannot see goes red in CI rather than here. Editing all three is the
    // price of an outline pin; being ambushed by the third is not.
    //
    // TITLES ONLY, AND THAT IS THE LINE. A body is a long sentence that changes
    // for legitimate reasons — a clause corrected, a hedge removed — and pinning
    // six of them here would turn every such edit into a diff of two identical
    // paragraphs. The two load-bearing fragments are pinned where they are
    // rendered instead: tier-table.hook.test.ts holds the free column to "last
    // board you entered" and "teammates", so the two bodies that carry a
    // capability a reader could be misled about still fail on a reword.
    expect(FREE_INCLUDES.map((inclusion) => inclusion.title)).toEqual([
      'Two teams',
      'Three months of scores',
      'How your last board measured up',
      'A team fact every day',
      'Team chat, and a push when it moves',
      'Reminders',
    ])
  })

  test('a selection comes back in the order it was asked for', () => {
    // THE ONE PROPERTY `freeInclusionsFor` EXISTS TO HAVE, and it needed an order
    // this array does not have to be visible at all. Both of the landing's
    // selections — ['chat', 'reminders'] and ['benchmark', 'team-fact'] — read the
    // same either way, so the assertions in marketing-copy.test.ts cannot tell
    // `ids.map` from `FREE_INCLUDES.filter((entry) => ids.includes(entry.id))`:
    // measured, the filter body leaves this the only failing test in the suite.
    //
    // WHICH MATTERS BEFORE THE NEXT CONSUMER, not after. A surface declaring an
    // order this file does not have is the first thing that would silently render
    // its highlights back to front, and the guarantee it would be relying on is
    // stated in freeInclusionsFor's own comment.
    expect(freeInclusionsFor(['reminders', 'chat']).map((i) => i.id)).toEqual([
      'reminders',
      'chat',
    ])
  })

  test('no entry reaches for Pro’s vocabulary', () => {
    // THE SAME FIVE WORDS marketing-copy.test.ts REFUSES, OVER THE SIX ENTRIES
    // THEMSELVES. That file holds the sentences IT wrote; these are checked here
    // because this is where they live, and because /pricing shows all six to the
    // same visitor who has not signed up. Holding them only through the landing's
    // corpus would cover four of six, and only for as long as the landing went on
    // selecting those four — dropping `chat` from ALSO_FREE would quietly take it
    // out of the checked set, which is the shape of hole this file exists to close.
    //
    // EACH WORD IS A DEFECT THAT REACHED A DRAFT, in that file's account of them:
    // "unlimited" is what feature-cards.tsx shipped over a three-month window,
    // "paste"/"screenshot" is the import that board-entry/form.tsx renders only
    // for `isPro === true`, and "custom"/"customizable" is scoring-system-card.tsx's
    // canEdit. All five describe something Pro buys, so a free entry saying one is
    // selling what it cannot give.
    const prose = lines.join(' ').toLowerCase()

    for (const word of ['unlimited', 'paste', 'screenshot', 'customizable', 'custom']) {
      expect(prose, `a free inclusion says "${word}"`).not.toContain(word)
    }
  })

  test('every checkedAgainst path exists on disk, as a file', () => {
    // THE PROPERTY THAT KEEPS THIS HONEST, and it has to touch the filesystem to
    // have it. A suffix check (`/\.tsx?$/`) would pass for 'nonsense.ts' while the
    // comment claimed the entry named real code.
    //
    // `notAFile` IS THE HOUSE VERSION (wordle-teams-vxkr) and carries the rest of
    // the argument: a directory resolves too, so `checkedAgainst: 'convex'` would
    // satisfy an existence test and say nothing at all about which file makes the
    // claim true. The reason it returns names which of the two happened.
    for (const inclusion of FREE_INCLUDES) {
      for (const named of pathsOf(inclusion)) {
        expect(notAFile(resolve(__dirname, '../..', named)), named).toBeNull()
      }
    }
  })

  test('records which two entries name the file that grants the thing', () => {
    // THE PARTITION ITSELF, EXACT IN BOTH DIRECTIONS, which is the shape
    // pro-benefits.test.ts pins `serverEnforced` with. It matters here because the
    // grep below runs over this filter and nothing else: a wrong `true` greps a
    // file that was never going to mention `isPro` and reports a guard it is not
    // performing, and a wrong `false` stops grepping the one file a gate would
    // actually appear in.
    //
    // FOUR OF SIX ARE false, A HIGHER PROPORTION THAN PRO'S TWO OF FIVE, and the
    // reason is in the field's doc comment: a free grant is usually the ABSENCE of
    // a gate somewhere else, so the file worth naming for a reader is the constant
    // or the view, not the branch.
    expect(FREE_INCLUDES.filter((inclusion) => inclusion.grantedHere).map((i) => i.id)).toEqual([
      'chat',
      'reminders',
    ])

    // AND WHICH OF THEM SELLS TWO THINGS, exactly, for the same reason: the grep
    // iterates these arrays, so emptying one would shrink what is checked while
    // the entry went on promising both halves. `chat` sells the thread and the
    // push (chatNotify.ts); `reminders` sells the nudge and the fact that its time
    // and method are yours (settings.ts patches both fields).
    expect(
      Object.fromEntries(
        FREE_INCLUDES.filter((i) => i.alsoGrantedIn.length > 0).map((i) => [i.id, i.alsoGrantedIn]),
      ),
    ).toEqual({
      chat: ['convex/chatNotify.ts'],
      reminders: ['convex/settings.ts'],
    })
  })

  test('neither file that grants a free capability gates it on isPro', () => {
    // THE ASSERTION THAT WOULD CATCH THE DEFECT THIS LIST IS MOST EXPOSED TO.
    // A free claim that goes stale has no moment of discovery — nobody complains
    // that a thing they were not charged for is missing — so the way this column
    // goes wrong is by describing a GATED capability as part of the free product.
    //
    // A GREP FOR THE PREDICATE, NOT A COMPARISON AGAINST A LIST OF IDS. Ids are a
    // closed union, so `id !== 'chat'` is something TypeScript already knows and
    // a test of it proves nothing. `isPro` is the actual shape of every gate in
    // this codebase — `isProFor` on the server, the `amIPro` query's `isPro` in
    // the client — so this fails on the day somebody gates team chat or reminders.
    //
    // AND ONLY THOSE TWO, WHICH IS THE POINT OF `grantedHere`. An earlier draft of
    // this ran over all six and claimed it would fail "on the day somebody gates
    // team chat, reminders or the free benchmark". The last of those was false:
    // gating Layer 1 means editing convex/lib/insightsAccess.ts, and
    // src/lib/insights-panel.ts — which holds no `isPro` and never will — would go
    // on passing. A guard that names a claim it cannot see is worse than no guard,
    // because the next reader trusts it.
    //
    // EVERY FILE THE SENTENCE RESTS ON, NOT JUST THE FIRST. `chat` sells the
    // thread and the push, and until `alsoGrantedIn` existed the grep saw only
    // convex/chat.ts: somebody gating the push in convex/chatNotify.ts would have
    // updated chatNotify.test.ts, kept all four gates green, and left a shipped
    // sentence and three comments wrong. Same shape one step weaker on
    // `reminders`, whose "at a time you pick" is settled in convex/settings.ts.
    //
    // AND THE ONLY GREP OF ITS KIND, WHICH IS ALSO A DECISION. marketing-copy.test.ts
    // ran a narrower one over the landing's own two entries — convex/chat.ts and
    // convex/reminders.ts, and neither of the two files their second halves depend
    // on — and it was deleted rather than kept once the landing started rendering
    // these entries instead of its own: two mechanisms guarding one fact means the
    // weaker one is what the next reader happens to read.
    for (const inclusion of FREE_INCLUDES.filter((entry) => entry.grantedHere)) {
      for (const named of pathsOf(inclusion)) {
        const source = readFileSync(resolve(__dirname, '../..', named), 'utf8')
        expect(source, `${inclusion.id}: ${named} gates on isPro`).not.toMatch(/isPro/)
      }
    }
  })

  test('no entry lifts a phrase from a Pro benefit', () => {
    // THE PROPERTY TWO COMMENTS ALREADY CLAIMED BEFORE ANYTHING MEASURED IT. The
    // `benchmark` entry calls its own wording "FORCED RATHER THAN PREFERRED" by
    // the four-word rule, and tier-table.hook.test.ts calls the same choice "A
    // GUARD RATHER THAN A PREFERENCE" — but the rule lived in
    // marketing-copy.test.ts over a corpus this list is not in. Measured: a body
    // reading "The last board you entered, and today's team snapshot, set against
    // every past Wordle: …" shares four words with the `insights` benefit, still
    // contains the phrase tier-table.hook.test.ts pins, and passed all 3794 tests.
    //
    // FOUR IS THE THRESHOLD, and `SHARED_RUN_LIMIT` in
    // test-support/copy-claims.ts holds both the number and the argument for it —
    // three fails on a feature's own noun phrase alone ("three months", "two
    // teams"). Measured over this list the maximum is three, "join two teams",
    // which the Pro `teams` body also says, about the cap this one describes.
    //
    // TITLE AND BODY MEASURED SEPARATELY, never concatenated, so a run straddling
    // the join between one entry's title and its body — a phrase no reader ever
    // sees — cannot fail this.
    //
    // The DP's known-answer check — an implementation that returned 0 for
    // everything would satisfy every assertion below it — is copy-claims.test.ts's
    // now, which is what this test stopped carrying when the measure moved.
    const benefitTexts = PRO_BENEFITS.flatMap((benefit) => [benefit.title, benefit.body]).map(words)
    for (const line of lines) {
      for (const benefitText of benefitTexts) {
        const run = longestSharedRun(words(line), benefitText)
        expect(run, `"${line}" vs "${benefitText.join(' ')}"`).toBeLessThan(SHARED_RUN_LIMIT)
      }
    }
  })

  test('every entry states what arrives, never what is withheld', () => {
    // THE HEADER'S EDITORIAL RULE, ENFORCED WHERE THE DATA LIVES. The same
    // negative word list guards the rendered column in tier-table.hook.test.ts,
    // and that test covers this only because the table happens to render the list
    // whole — a render assertion cannot be the home of the rule the DATA is
    // written to. "No custom scoring", "Limited to two teams" and "today only" all
    // land here, whichever surface would have shown them.
    const prose = lines.join(' ')

    expect(prose).not.toMatch(/\bno\b|\bnot\b|\bonly\b|\blimited\b|\bexcept\b|\bwithout\b/i)
  })

  test('uses typographic apostrophes and no typewriter ones', () => {
    // Same rule and same test as pro-benefits.test.ts, plans.test.ts and
    // marketing-copy.test.ts: one page mixing ' and ’ is visible to a reader and to
    // nothing else, and this copy reaches /pricing with no other gate able to see
    // it. (Those three are the whole set. An earlier draft of this line cited "the
    // legal copy", which carries no such test — inherited verbatim from
    // marketing-copy.test.ts, where it is now corrected too.)
    const prose = lines.join(' ')

    expect(prose).not.toContain("'")
    // AND AT LEAST ONE IS PRESENT, so that deleting every apostrophe — which
    // would also satisfy the line above — fails instead of passing.
    expect(prose).toContain('’')
  })

  test('pins the free-tier numbers this copy spells out in words', () => {
    // The idiom pro-benefits.test.ts and plans.test.ts both use, and the
    // inventory's header states the reason: the `teams` body says "two teams" and
    // the `months` entry says "Three months" and "the two before it" as WORDS,
    // because prose cannot embed a template literal. So the constants are pinned
    // here instead, one to each spelled-out number. Change FREE_TEAM_LIMIT or
    // FREE_MONTHS without rewriting the copy and this fails rather than shipping a
    // stale number behind four green gates.
    expect(FREE_TEAM_LIMIT).toBe(2)
    expect(FREE_MONTHS).toBe(3)
  })
})

/**
 * THE SURFACES, AS A CLOSED SET.
 *
 * WHAT IS ALREADY TRUE WITHOUT A TEST, so that nothing below pretends to buy it.
 * A surface's declared ids RESOLVE by construction: `freeInclusionsFor` takes
 * `FreeInclusion['id']`, a closed union, so an id no entry uses does not compile,
 * and an entry deleted while the union keeps its name throws at import — the
 * account is in that function's own comment. WHICH ids each landing section
 * declares is pinned in components/home/marketing-copy.test.ts, exactly in both
 * directions, and NOTHING IS ORPHANED because components/pricing/tier-table.tsx
 * renders `FREE_INCLUDES` whole: components/pricing/tier-table.hook.test.ts
 * asserts every entry's title and body in the rendered free column and pins that
 * column's heading outline to the inventory's titles, so an entry no surface shows
 * is a red test there rather than an unadvertised capability.
 *
 * WHAT IS NOT TRUE WITHOUT THE TEST BELOW, which is the one gap left: a FOURTH
 * surface. Nothing so far is answerable for a module that has not been written
 * yet, and the guard a new one would slip past is the duplication measure —
 * marketing-copy.test.ts holds ONE file's authored prose to the inventory, by
 * enumeration, so a new page selecting two entries and writing its own paragraph
 * around them lands exactly where the landing's three original copies did, with
 * every gate green. This census is what makes that arrival loud.
 */
describe('the surfaces that render the inventory', () => {
  /** A path under src/, spelled the way the expected list below spells it. */
  const show = (path: string) => path.slice(SRC.length + 1).replaceAll('\\', '/')

  test('exactly three modules name it, and only one of them selects', () => {
    // READ OFF THE IMPORT DECLARATIONS, NOT THE TEXT — checkout-entry-point.test.ts's
    // reason, and it applies more sharply here: components/home/insights-payoff.tsx
    // discusses this inventory by name in its banner and imports nothing of the
    // sort (it renders `PAYOFF_INCLUDES`, which marketing-copy.ts selected), so a
    // `toMatch(/free-includes/)` over raw source would report a fourth surface
    // that does not exist.
    //
    // VALUE OR TYPE, BECAUSE THE DIFFERENCE IS WHAT THE MODULE IS DOING.
    // `importedModulesOf` reports type-only declarations and `runtimeImportsOf`
    // does not, so the pair of them separates the two: also-free.tsx takes the
    // `FreeInclusion` type to key an icon map and receives its entries as a prop,
    // which makes it a renderer rather than a surface with a selection of its own;
    // marketing-copy.ts is the only module that SELECTS (both landing sections);
    // tier-table.tsx takes the array itself, which is what makes /pricing the
    // exhaustive surface.
    //
    // AND IT SAYS NOTHING ABOUT WHAT ANY OF THEM DOES WITH WHAT IT IMPORTS. That is
    // deliberately elsewhere — the rendered column in tier-table.hook.test.ts, the
    // two declared id lists in marketing-copy.test.ts — because an import list
    // cannot see a filter and a claim to the contrary is how a guard starts
    // covering less than its comment says.
    const consumers = Object.fromEntries(
      sourceFiles(SRC)
        .filter((path) => !path.endsWith('.test.ts'))
        .flatMap((path) => {
          const source = readFileSync(path, 'utf8')
          const namesIt = (specifiers: string[]) =>
            specifiers.some((specifier) => specifier.includes('free-includes'))
          if (!namesIt(importedModulesOf(path, source))) return []
          return [[show(path), namesIt(runtimeImportsOf(path, source)) ? 'value' : 'type'] as const]
        }),
    )

    expect(consumers).toEqual({
      'components/home/also-free.tsx': 'type',
      'components/home/marketing-copy.ts': 'value',
      'components/pricing/tier-table.tsx': 'value',
    })
  })

  test('and the walk that produced that list actually covered src/', () => {
    // checkout-entry-point.test.ts's companion assertion, for its reason: regress
    // the walk to `[]` and the census above fails, but so does a broken filter, and
    // the two failures are indistinguishable while only one of them means what the
    // test says. So the root set is pinned to contain a file the filter threw away
    // (this suite), a file it kept and reported, and one it kept and correctly did
    // not report. Containment, never a count — a number would be wrong the next
    // time a component is added.
    const roots = sourceFiles(SRC)

    expect(roots).toContain(join(SRC, 'lib/free-includes.test.ts'))
    expect(roots).toContain(join(SRC, 'components/pricing/tier-table.tsx'))
    expect(roots).toContain(join(SRC, 'components/home/insights-payoff.tsx'))
  })
})
