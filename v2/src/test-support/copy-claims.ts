import { existsSync, statSync } from 'node:fs'

/**
 * THE CHECKS EVERY COPY CLAIM IN THIS REPO IS MADE OF, IN ONE PLACE.
 *
 * WHY A SHARED HOME, in test-support/source-ast.ts's words about itself: it lives
 * in src/ rather than beside one test because two suites need it, and "a copy in
 * each is how a helper drifts into two behaviours". Counted before it was fixed:
 * the longest-shared-run DP, `words` and the threshold stood three times over, in
 * src/lib/plans.test.ts,
 * src/lib/free-includes.test.ts and src/components/home/marketing-copy.test.ts; the
 * `existsSync` + `statSync().isFile()` pair stood four times, once each in
 * src/lib/pro-benefits.test.ts and free-includes.test.ts and twice inside
 * marketing-copy.test.ts. wordle-teams-qul0 is the issue those copies were filed
 * under, and the fourth corpus for the measure — the landing's own prose against
 * the free inventory — is what would have made it a fourth copy rather than a
 * shared one.
 *
 * SAME RULE AS source-ast.ts AND element-tree.ts: THESE ARE QUERIES, NEVER
 * PROJECT ASSERTIONS. Nothing here knows what any surface says, which file an
 * entry names, or which corpus is being measured; each suite states its own
 * expectations and supplies its own failure message. `SHARED_RUN_LIMIT` is the
 * one value here with an opinion in it, and the opinion is about the MEASURE
 * rather than about any one corpus — which is why the per-corpus measurements
 * stay at the call sites that made them.
 *
 * IT IMPORTS node:fs AT MODULE SCOPE, AND THAT COSTS THE WORD-MEASURE CALLERS
 * NOTHING. plans.test.ts needs only `words` and the DP and runs under the suite's
 * default edge-runtime environment; measured, `node:fs` resolves there —
 * vitest's edge environment still runs on Node and Vite externalises the builtin.
 * Were that ever to stop being true it would stop loudly, in a suite that fails
 * to import, rather than silently.
 *
 * Nothing in the app imports this module, so it reaches no bundle, and
 * vitest.config.ts's include glob matches only `*.test.ts`, so it is not
 * collected as a suite of its own either. copy-claims.test.ts holds its
 * known-answer checks, which is what lets the call sites stop carrying their own.
 */

/**
 * Words to word-lists, for the shared-run measure below.
 *
 * TWO DECISIONS, both from plans.test.ts where this began. Typographic
 * apostrophes are normalised to typewriter ones, so `we’ll` and `we'll` are one
 * word rather than two unrelated ones. And punctuation becomes WHITESPACE rather
 * than vanishing — hyphens included, so "two-team" cannot hide an overlap with
 * "two team", and so "month, not" does not fuse into a single token that matches
 * nothing.
 */
export const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .split(' ')
    .filter(Boolean)

/**
 * The longest run of CONSECUTIVE shared words between two word-lists — the
 * classic longest-common-substring DP, over words rather than characters.
 *
 * CONSECUTIVE IS THE WHOLE MEASURE. Two sentences about one feature share that
 * feature's vocabulary in any order and that is not a defect; what a reader
 * registers as one sentence said twice is a shared PHRASE. A bag-of-words
 * overlap would fail the honest copy and pass the lifted clause.
 */
export const longestSharedRun = (a: string[], b: string[]) => {
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

/**
 * A shared run this long or longer is one sentence said twice. Asserted as
 * `toBeLessThan(SHARED_RUN_LIMIT)`, so three consecutive shared words pass and
 * four fail.
 *
 * FOUR, AND BOTH SIDES OF THE CHOICE WERE MEASURED RATHER THAN GUESSED — the
 * argument is plans.test.ts's, where the number was first picked. Independent copy
 * tops out at TWO consecutive shared words where it has been measured: across all
 * ten distinct PRO_BENEFITS titles and bodies, the longest run between any two of
 * them is 2 ("your own", `scoring`'s title against `insights`' body). So 3 is
 * where coincidence ends in general — but copy ABOUT a feature is not
 * independent of that feature's own entry, and legitimately shares its noun
 * phrase: "three months", "two teams", "a screenshot". At a threshold of 3 the
 * noun phrase plus one function word ("past three months", "join two teams")
 * fails, which is an obstacle to writing the sentence at all rather than a defect
 * caught. Four leaves room for the feature's vocabulary and still fails a lifted
 * clause.
 *
 * WHAT THAT BUYS AND WHAT IT DOES NOT. It killed both defects that reached a
 * screen as a visible stutter, in the upgrade dialog where the measure started:
 * `insights` at 4 ("your team’s whole month") and `import` at 6 ("fill the board
 * in for you"). It would NOT have caught `teams`, whose old "Pro lifts the
 * two-team limit" shared 3 with its body ("Pro lifts the cap"), nor `months` at
 * 2; both were reworded by eye and sit below any threshold that lets the copy
 * above them be written. This is a floor on phrase reuse, not a substitute for
 * reading the page — and the mutants above are worth re-running if the number is
 * ever changed, in every suite that imports it.
 *
 * WHAT CENTRALISING IT COSTS, WHICH IS THE HALF A SHARED CONSTANT HIDES. Four
 * corpora now loosen together. Measured: editing this line to 8 reddens exactly ONE
 * test — the pin in copy-claims.test.ts — while every collision assertion in
 * plans.test.ts, free-includes.test.ts and marketing-copy.test.ts goes on passing at
 * a threshold nobody chose for them. Before, the number stood as three separate `4`
 * literals and all three had to be edited to do that. The pin is what makes the edit
 * visible at all, and it is deliberately the whole of the compensation: a per-corpus
 * threshold would be four numbers to argue about where the argument above applies to
 * all of them equally.
 */
export const SHARED_RUN_LIMIT = 4

/**
 * null when `path` IS a file on disk; otherwise the reason it is not.
 *
 * WHY A PATH IS A CLAIM AT ALL, in pro-benefits.test.ts's words: a path that does
 * not resolve is a claim nobody checked. Every `gatedAt` and `checkedAgainst` in
 * this repo answers "which file makes this sentence true", and a suffix check
 * (`/\.tsx?$/`) would pass for 'nonsense.ts' while the comment beside it claimed
 * the entry named real code.
 *
 * `.isFile()` AND NOT JUST `existsSync`, WHICH IS THE HALF WORTH SPELLING OUT. A
 * directory resolves too — `checkedAgainst: 'convex'` passes existsSync and says
 * nothing at all about which file carries the rule.
 *
 * A REASON RATHER THAN A BOOLEAN, so that one assertion at the call site loses no
 * diagnosis where there used to be two: "expected 'resolves, but not to a file'
 * to be null" says which of the two ways it failed, which `toBe(true)` on a
 * conjunction cannot. RESOLUTION IS THE CALLER'S — these paths are written
 * relative to v2/ and each suite resolves them from its own directory, the way
 * source-ast.ts leaves reading to the caller.
 */
export const notAFile = (path: string): string | null => {
  if (!existsSync(path)) return 'does not resolve to anything on disk'
  return statSync(path).isFile() ? null : 'resolves, but not to a file'
}
