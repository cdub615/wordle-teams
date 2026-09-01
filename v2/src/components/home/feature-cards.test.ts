import { describe, expect, test } from 'vitest'
import { FEATURES } from './feature-cards.tsx'

/**
 * THE COPY IS THE REQUIREMENT, SO THE COPY IS WHAT IS PINNED.
 *
 * "Ported verbatim from v1" was the hardest thing Phase 7 Task 4 had to get
 * right, and until this file existed there was no test of any kind under
 * src/components/home/: a card could be deleted, reordered or reworded and all
 * four gates stayed green. Mutation testing of that task found exactly that —
 * removing a feature killed nothing.
 *
 * AS DATA, NOT AS RENDERED DOM, BECAUSE THERE IS NO DOM. vitest.config.ts sets
 * `environment: 'edge-runtime'`, so nothing in this repo can render a component
 * (see the note at the top of e2e/routes.spec.ts). FEATURES is exported from
 * feature-cards.tsx precisely so the strings are reachable from this layer;
 * e2e/routes.spec.ts asserts that the six of them reach the page.
 *
 * THE STRINGS ARE SPELLED OUT RATHER THAN COMPARED AGAINST v1's FILE. Reading
 * ../../../../src/components/home/feature-cards.tsx would make v2's unit suite
 * depend on the live v1 tree, which the island rule forbids and which would
 * silently start passing if v1's copy were edited. These are transcriptions,
 * and a diff against v1 is a review job, not a test job.
 */
describe('the six feature cards', () => {
  test('there are exactly six, in v1\'s order', () => {
    // toEqual on the whole list, not `toHaveLength(6)` plus a spot check: a
    // reorder and a swap both have to fail, and only the full list does that.
    expect(FEATURES.map((feature) => feature.title)).toEqual([
      'Create Teams',
      'Wordle Boards',
      'Competitive Scoring',
      'Go Pro',
      'Easy Sign In',
      'Privacy',
    ])
  })

  test('every body is v1\'s copy, to the character', () => {
    expect(FEATURES.map((feature) => feature.body)).toEqual([
      'Invite your friends to join your Wordle team and compete together.',
      'Enter your daily Wordle board and track your progress.',
      'Using our default scoring system or your own, compete to earn the highest score and win.',
      'Become a Pro member to get access to unlimited months, unlimited teams, customizable scoring systems, and more.',
      'No need to manage another username and password. Sign in quickly and easily with your existing accounts.',
      'We take your privacy seriously. We only collect what we need for a seamless sign in experience, and we never sell or share your user data.',
    ])
  })

  test('every card has an icon component to render', () => {
    // The icon is the one field the copy assertions above cannot see. Named
    // rather than counted, because `title` is the render key and a card with a
    // missing icon would throw at render — in a browser, where no gate looks.
    for (const feature of FEATURES) {
      expect(typeof feature.icon, `${feature.title} has no icon`).not.toBe('undefined')
    }
  })
})
