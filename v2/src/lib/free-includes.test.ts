// @vitest-environment node
//
// node rather than the suite's default edge-runtime, because the two disk tests
// below read the filesystem. That is the whole point of them, in
// pro-benefits.test.ts's words: a path that does not resolve is a claim nobody
// checked.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { PRO_BENEFITS } from './pro-benefits.ts'
import { FREE_TEAM_LIMIT } from '../../convex/lib/teamLimits.ts'
import { FREE_MONTHS } from '../../convex/lib/monthWindow.ts'
import { FREE_INCLUDES } from './free-includes.ts'

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

/**
 * Words to word-lists, for the shared-run measure below. Lifted from
 * marketing-copy.test.ts, which lifted it from plans.test.ts, including the two
 * decisions that comment records: typographic apostrophes are normalised, and
 * punctuation — hyphens included, so "two-team" cannot hide an overlap with "two
 * team" — becomes whitespace rather than vanishing.
 */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .split(' ')
    .filter(Boolean)

/** Classic longest-common-substring DP over words rather than characters. */
const longestSharedRun = (a: string[], b: string[]) => {
  let longest = 0
  const runs = Array.from({ length: b.length + 1 }, () => 0)
  for (const wordA of a) {
    let diagonal = 0
    for (let j = 0; j < b.length; j += 1) {
      const above = runs[j + 1]
      runs[j + 1] = wordA === b[j] ? diagonal + 1 : 0
      longest = Math.max(longest, runs[j + 1])
      diagonal = above
    }
  }
  return longest
}

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
    // A deliberate reword here is still one edit to the copy and one to the list
    // below it, in the same file, with no surface to keep in step — the shape
    // pro-benefits.test.ts's own id assertion argues for: copy is the one thing
    // typecheck, lint and build cannot check.
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

  test('every checkedAgainst path exists on disk, as a file', () => {
    // THE PROPERTY THAT KEEPS THIS HONEST, and it has to touch the filesystem to
    // have it. A suffix check (`/\.tsx?$/`) would pass for 'nonsense.ts' while the
    // comment claimed the entry named real code.
    //
    // `.isFile()`, NOT JUST `existsSync`. A directory resolves too —
    // `checkedAgainst: 'convex'` would pass existsSync and say nothing at all
    // about which file makes the claim true.
    for (const inclusion of FREE_INCLUDES) {
      for (const named of pathsOf(inclusion)) {
        const path = resolve(__dirname, '../..', named)
        expect(existsSync(path), named).toBe(true)
        expect(statSync(path).isFile(), named).toBe(true)
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
    // FOUR IS THE THRESHOLD plans.test.ts argues for and marketing-copy.test.ts
    // reuses: independent copy in this corpus tops out at two shared words, and
    // three fails on a feature's own noun phrase alone ("three months", "two
    // teams"). Measured over this list the maximum is three — "join two teams",
    // which the Pro `teams` body also says, about the cap this one describes.
    //
    // TITLE AND BODY MEASURED SEPARATELY, never concatenated, so a run straddling
    // the join between one entry's title and its body — a phrase no reader ever
    // sees — cannot fail this.
    //
    // The DP is checked against a known answer first, because an implementation
    // that returned 0 for everything would satisfy every assertion below it.
    expect(
      longestSharedRun(
        words('let a screenshot fill the board in for you'),
        words(
          'Paste or upload a screenshot of your Wordle and we’ll fill the board in for you — check it and submit.',
        ),
      ),
    ).toBe(6)

    const benefitTexts = PRO_BENEFITS.flatMap((benefit) => [benefit.title, benefit.body]).map(words)
    for (const line of lines) {
      for (const benefitText of benefitTexts) {
        const run = longestSharedRun(words(line), benefitText)
        expect(run, `"${line}" vs "${benefitText.join(' ')}"`).toBeLessThan(4)
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
