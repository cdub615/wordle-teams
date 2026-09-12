import { describe, expect, test } from 'vitest'
import { MAX_AVATAR_BYTES, isAllowedAvatarType, shouldSyncSocialImage } from './avatar.ts'

describe('shouldSyncSocialImage', () => {
  test('syncs when the provider has an image and the player row has none', () => {
    expect(shouldSyncSocialImage(undefined, 'https://lh3.googleusercontent.com/a')).toEqual({
      action: 'set',
      value: 'https://lh3.googleusercontent.com/a',
    })
  })

  test('syncs when the provider image has changed', () => {
    expect(shouldSyncSocialImage('https://old', 'https://new')).toEqual({
      action: 'set',
      value: 'https://new',
    })
  })

  test('does nothing when they already agree, so the common load writes nothing', () => {
    expect(shouldSyncSocialImage('https://same', 'https://same')).toEqual({ action: 'none' })
  })

  // A revoked provider or an unlinked account. An image the provider no longer
  // serves must not persist on the player row.
  test('CLEARS when the provider no longer has one', () => {
    expect(shouldSyncSocialImage('https://old', null)).toEqual({ action: 'clear' })
  })

  test('does nothing when neither side has one', () => {
    expect(shouldSyncSocialImage(undefined, null)).toEqual({ action: 'none' })
  })

  // Better Auth omits `image` entirely for a user who has none, so an absent
  // value and an explicit null are the same fact and must behave the same way.
  // Pinned because treating a bare `undefined` as "unknown, leave it alone"
  // would pass every other test in this file.
  test('CLEARS on an absent incoming value, exactly as on null', () => {
    expect(shouldSyncSocialImage('https://old', undefined)).toEqual({ action: 'clear' })
  })
})

describe('isAllowedAvatarType', () => {
  test.each(['image/webp', 'image/png', 'image/jpeg'])('accepts %s', (type) => {
    expect(isAllowedAvatarType(type)).toBe(true)
  })

  test.each(['text/html', 'application/pdf', 'image/svg+xml', null, undefined])(
    'refuses %s',
    (type) => {
      expect(isAllowedAvatarType(type)).toBe(false)
    },
  )
})

test('the byte cap is well clear of a 256px WebP and well under a phone photo', () => {
  expect(MAX_AVATAR_BYTES).toBe(100_000)
})
