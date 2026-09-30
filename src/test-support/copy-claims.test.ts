// @vitest-environment node
//
// node rather than the suite's default edge-runtime, because `notAFile` reads the
// filesystem — the same opening line, for the same reason, as every suite that
// calls it.
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { longestSharedRun, notAFile, SHARED_RUN_LIMIT, words } from './copy-claims.ts'

/**
 * WHY THIS SUITE EXISTS, and it is the reason source-ast.test.ts gives for its
 * own: the helpers next door cannot throw. They hand back a number, a word-list
 * and a null — and a measure that answered 0 for everything, or a disk check that
 * answered null for everything, would satisfy every assertion in every suite that
 * calls them while guarding nothing at all.
 *
 * THIS IS THE KNOWN-ANSWER CHECK THREE SUITES USED TO CARRY INLINE. plans.test.ts,
 * free-includes.test.ts and marketing-copy.test.ts each opened their shared-run
 * test by measuring one sentence pair whose answer they knew, because the DP was
 * theirs and nothing else checked it. The DP is one function with one test now, so
 * each of those keeps a line naming this file instead — the trade wordle-teams-qul0
 * was raised to make, and it is only sound while the assertions below are here.
 */

describe('words', () => {
  test('normalises the apostrophe a designer typed', () => {
    // `we’ll` and `we'll` are one word. Without this, a lifted clause written
    // with the other quote mark measures as two unrelated tokens and the
    // shared-run guard reports no overlap at all.
    expect(words('we’ll fill the board')).toEqual(["we'll", 'fill', 'the', 'board'])
    expect(words("we'll fill the board")).toEqual(["we'll", 'fill', 'the', 'board'])
  })

  test('turns punctuation into whitespace rather than deleting it', () => {
    // "month, not" must be two tokens. Deleting the comma instead would fuse
    // them into `monthnot`, which matches nothing and silently shortens every
    // run measured across a clause boundary.
    expect(words('month, not today')).toEqual(['month', 'not', 'today'])
    expect(words('Wordle — check it')).toEqual(['wordle', 'check', 'it'])
  })

  test('splits a hyphenated compound, so it cannot hide an overlap', () => {
    // The decision plans.test.ts recorded: "two-team" against "two team" is a
    // three-word overlap and has to measure as one.
    expect(longestSharedRun(words('the two-team limit'), words('the two team limit'))).toBe(4)
  })

  test('drops the empty tokens the substitution leaves behind', () => {
    expect(words('  ...  ')).toEqual([])
    expect(words('Two teams.')).toEqual(['two', 'teams'])
  })
})

describe('longestSharedRun', () => {
  test('finds the six-word clause every caller used to check it with', () => {
    // THE CASE ITSELF IS THE INHERITANCE. This exact pair — an upgrade headline
    // against the `import` benefit's body — is the collision that made the
    // measure necessary, and it is the known answer plans.test.ts,
    // free-includes.test.ts and marketing-copy.test.ts each asserted before
    // trusting their own copy of the DP.
    expect(
      longestSharedRun(
        words('let a screenshot fill the board in for you'),
        words(
          'Paste or upload a screenshot of your Wordle and we’ll fill the board in for you — check it and submit.',
        ),
      ),
    ).toBe(6)
  })

  test('answers 0 when nothing is shared, and is not fooled by scattered words', () => {
    expect(longestSharedRun(words('two teams'), words('custom scoring'))).toBe(0)
    // Every word of the first appears in the second, in a different order and
    // never adjacent: a bag-of-words overlap would score this 4, and the reason
    // the measure is consecutive is that this is honest copy.
    expect(longestSharedRun(words('board month your the'), words('your board, the whole month'))).toBe(
      1,
    )
  })

  test('finds a run in the middle of both lines, not just at a start', () => {
    expect(
      longestSharedRun(words('and then the thread moves along'), words('you get the thread moves')),
    ).toBe(3)
  })

  test('is symmetric, and safe on an empty side', () => {
    const a = words('the last board you entered')
    const b = words('set against every board you entered today')
    expect(longestSharedRun(a, b)).toBe(3)
    expect(longestSharedRun(b, a)).toBe(3)
    expect(longestSharedRun(a, [])).toBe(0)
    expect(longestSharedRun([], a)).toBe(0)
  })

  test('the threshold is the number the corpora are written against', () => {
    // Pinned so that a change to it is a diff on this line as well as on the
    // constant — its doc comment carries the argument for four and names the two
    // mutants worth re-running if it ever moves.
    expect(SHARED_RUN_LIMIT).toBe(4)
  })
})

describe('notAFile', () => {
  test('says nothing about a path that is a file', () => {
    expect(notAFile(resolve(__dirname, 'copy-claims.ts'))).toBeNull()
  })

  test('tells a missing path from a directory, which is the point of the reason', () => {
    // A directory RESOLVES, which is why `existsSync` alone was never enough:
    // `checkedAgainst: 'convex'` would have passed it while naming no file at
    // all. The two failures read differently so the diagnosis survives the
    // single assertion at each call site.
    expect(notAFile(resolve(__dirname, 'no-such-file.ts'))).toBe(
      'does not resolve to anything on disk',
    )
    expect(notAFile(resolve(__dirname, '..'))).toBe('resolves, but not to a file')
  })
})
