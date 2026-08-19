/**
 * Shared convex-test document factories.
 *
 * Lives outside any `*.test.ts` file deliberately: vitest.config.ts's
 * `include` only collects `convex/**​/*.test.ts` as suites, so this plain
 * module can be imported by multiple test files without re-executing anyone
 * else's `describe` blocks. (convex/lib/*.ts already proves the "plain
 * non-Convex module in this directory" pattern; this is the same thing for
 * test fixtures.) Before this module existed, winners.test.ts imported
 * aPlayer/aTeam straight from scores.test.ts, which re-ran scores.test.ts's
 * entire suite a second time as a side effect of the import.
 */

export const aPlayer = (over: Record<string, unknown> = {}) => ({
  legacyId: '11111111-1111-4111-8111-111111111111',
  email: 'member@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '18:00:00',
  ...over,
})

export const aTeam = (over: Record<string, unknown> = {}) => ({
  legacyId: 206,
  name: 'team 206',
  playerIds: [],
  invited: [],
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
  playWeekends: true,
  showLetters: true,
  ...over,
})
