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
