import { describe, expect, it } from 'vitest'
import { feedbackFor } from './feedback.ts'

describe('feedbackFor', () => {
  it('marks an exact match all correct', () => {
    expect(feedbackFor('CRANE', 'CRANE')).toEqual([
      'correct', 'correct', 'correct', 'correct', 'correct',
    ])
  })

  it('marks a letter in the wrong place as present', () => {
    expect(feedbackFor('CRANE', 'NACRE')).toEqual([
      'present', 'present', 'present', 'present', 'correct',
    ])
  })

  // THE DUPLICATE-LETTER RULE, which is where every naive implementation is
  // wrong. SPEED has two Es and ERASE has two, so both Es are paid for.
  it('gives a present mark to each duplicate the answer can pay for', () => {
    expect(feedbackFor('SPEED', 'ERASE')).toEqual([
      'present', 'absent', 'present', 'present', 'absent',
    ])
  })

  // AND THE OTHER HALF OF IT: a green LATER in the word must not be starved by
  // a yellow EARLIER in it. One-pass implementations mark the first E yellow
  // and then have nothing left for the last E, which is green.
  it('lets a later correct letter claim the count before an earlier one', () => {
    expect(feedbackFor('EERIE', 'THREE')).toEqual([
      'present', 'absent', 'correct', 'absent', 'correct',
    ])
  })

  it('is case insensitive on both sides', () => {
    expect(feedbackFor('crane', 'CRANE')).toEqual(feedbackFor('CRANE', 'crane'))
  })
})
