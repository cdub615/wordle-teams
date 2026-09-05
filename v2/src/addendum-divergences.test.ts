import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * V2-ADDENDUM SECTION 7a COUNTS ITSELF HONESTLY.
 *
 * WHY THIS EXISTS. That section opens with a spelled-out count and the sentence
 * "Anything else the audit finds is a bug." A reader who trusts it treats every
 * divergence past the stated number as a defect to chase, so the number is
 * load-bearing rather than decorative.
 *
 * IT HAS DRIFTED TWICE. Phase 7 Task 16 found the header saying EIGHTEEN while
 * the table held THIRTY-NINE — twenty-one real divergences sitting under a
 * sentence inviting the audit to treat them as bugs. Task 16 corrected it to
 * forty-three and wrote a paragraph, in that file, immediately above the number,
 * explaining why it matters. **The next nine rows went in without it anyway**,
 * and on 2026-09-03 the header still said forty-three against a table of
 * fifty-two (`wordle-teams-4m2t`).
 *
 * PROSE DID NOT PREVENT IT, which is the whole argument for this file. A comment
 * cannot enforce an invariant that a person has to remember at the moment they
 * are thinking about something else.
 *
 * THE NUMBERING IS PINNED TOO, and that is not padding: adding row 50 after a
 * table that already had rows 50-52 produced a duplicate, because the author
 * (me) grepped for `^| 4[0-9] ` and concluded 49 was last. It was not.
 */
const addendum = readFileSync(
  new URL('../../docs/design-system/V2-ADDENDUM.md', import.meta.url),
  'utf8',
)

/** The section 7a table only — other tables in this file also start `| N |`. */
const section = (() => {
  const start = addendum.indexOf('## 7a.')
  expect(start, 'section 7a is gone from V2-ADDENDUM.md').toBeGreaterThan(-1)
  const next = addendum.indexOf('\n## ', start + 1)
  return addendum.slice(start, next === -1 ? undefined : next)
})()

const rowNumbers = [...section.matchAll(/^\| (\d+) \|/gm)].map(([, n]) => Number(n))

/** The count is written as a word, matching the document's prose style. */
const NUMBER_WORDS: Record<string, number> = {
  Eighteen: 18, Thirty: 30, Forty: 40, Fifty: 50, Sixty: 60, Seventy: 70,
  'Forty-one': 41, 'Forty-two': 42, 'Forty-three': 43, 'Forty-four': 44,
  'Forty-five': 45, 'Forty-six': 46, 'Forty-seven': 47, 'Forty-eight': 48,
  'Forty-nine': 49, 'Fifty-one': 51, 'Fifty-two': 52, 'Fifty-three': 53,
  'Fifty-four': 54, 'Fifty-five': 55, 'Fifty-six': 56, 'Fifty-seven': 57,
  'Fifty-eight': 58, 'Fifty-nine': 59, 'Sixty-one': 61, 'Sixty-two': 62,
  'Sixty-three': 63, 'Sixty-four': 64, 'Sixty-five': 65, 'Sixty-six': 66,
}

describe('the divergence table and its header agree', () => {
  test('the table is found and is not empty', () => {
    // Without this the two assertions below pass vacuously on a parse that
    // silently matched nothing — the failure mode this file is written against.
    expect(rowNumbers.length).toBeGreaterThan(40)
  })

  test('rows are numbered contiguously from 1', () => {
    expect(rowNumbers).toEqual(rowNumbers.map((_, i) => i + 1))
  })

  test('THE HEADER COUNT EQUALS THE NUMBER OF ROWS', () => {
    const stated = section.match(/^\*\*([A-Z][a-z]+(?:-[a-z]+)?) known differences/m)
    expect(stated, 'section 7a no longer opens with "<Word> known differences"').not.toBeNull()

    const word = stated![1]
    const value = NUMBER_WORDS[word]
    expect(
      value,
      `"${word}" is not in this test's number-word map — add it, and update the header`,
    ).toBeDefined()

    expect(
      value,
      `the header says ${word} (${value}) but the table holds ${rowNumbers.length} rows. ` +
        'A reader is told anything past the stated number is a bug, so this gap turns ' +
        'real divergences into false defects. It has happened twice.',
    ).toBe(rowNumbers.length)
  })
})
