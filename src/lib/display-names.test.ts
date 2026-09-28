import { describe, expect, test } from 'vitest'
import { displayNamesFor } from './display-names.ts'

const people = (...pairs: Array<[string, string, string]>) =>
  pairs.map(([id, firstName, lastName]) => ({ id, firstName, lastName }))

const labels = (...pairs: Array<[string, string, string]>) => [
  ...displayNamesFor(people(...pairs)).values(),
]

describe('displayNamesFor', () => {
  test('a unique first name stands alone', () => {
    expect(labels(['1', 'Ada', 'Lovelace'], ['2', 'Grace', 'Hopper'])).toEqual(['Ada', 'Grace'])
  })

  // The whole point of the rule: BOTH colliding players get the initial, not
  // just the second one seen.
  test('a shared first name gives BOTH players their last initial', () => {
    expect(labels(['1', 'Ada', 'Lovelace'], ['2', 'Ada', 'Byron'])).toEqual(['Ada L', 'Ada B'])
  })

  test('a third sharer is disambiguated too', () => {
    expect(labels(['1', 'Ada', 'Lovelace'], ['2', 'Ada', 'Byron'], ['3', 'Ada', 'King'])).toEqual([
      'Ada L',
      'Ada B',
      'Ada K',
    ])
  })

  test('collisions are per first name, not global', () => {
    expect(
      labels(['1', 'Ada', 'Lovelace'], ['2', 'Ada', 'Byron'], ['3', 'Grace', 'Hopper']),
    ).toEqual(['Ada L', 'Ada B', 'Grace'])
  })

  test('the map is keyed by id, so the caller can look up by player', () => {
    const map = displayNamesFor(people(['p1', 'Ada', 'Lovelace']))
    expect(map.get('p1')).toBe('Ada')
  })

  // An empty last name must not produce "Ada undefined" — the exact bug
  // lib/initials.ts exists to not reproduce, via lastName[0] on ''.
  test('a colliding player with no last name gets no stray undefined', () => {
    expect(labels(['1', 'Ada', ''], ['2', 'Ada', 'Byron'])).toEqual(['Ada', 'Ada B'])
  })

  test('an empty roster is an empty map, not a crash', () => {
    expect(displayNamesFor([]).size).toBe(0)
  })

  test('case differences are different names, matching the table today', () => {
    // Documents current behaviour rather than asserting it is ideal: the table
    // compares raw first names, so 'ada' and 'Ada' do not collide. Changing
    // that is a product decision, not a refactor.
    expect(labels(['1', 'ada', 'Lovelace'], ['2', 'Ada', 'Byron'])).toEqual(['ada', 'Ada'])
  })
})
