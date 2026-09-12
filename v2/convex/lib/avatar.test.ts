import { describe, expect, test } from 'vitest'
import { MAX_AVATAR_BYTES, isAllowedAvatarType, resolveAvatar, shouldSyncSocialImage } from './avatar.ts'

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

/**
 * THE FALLBACK EXISTS BECAUSE THE MIRROR IS NOT THE CALLER'S OWN SOURCE OF
 * TRUTH, and treating it as one is what made a GitHub user's avatar vanish
 * from their own header (2026-09-12, beta).
 *
 * `socialImage` is written by one mutation triggered from one route. A teammate
 * has no other way to see your provider photo, so for THEM the mirror is all
 * there is. But your own session can read Better Auth's `user.image` directly —
 * it is where the mirror's value came from — so routing your own avatar through
 * a database row written by an effect on a page you might not have opened adds
 * a coverage gap, a timing window and a silent-failure mode for nothing.
 */
describe('resolveAvatar fallback', () => {
  const noStorage = { storage: { getUrl: async () => null } }

  test('falls back when the mirror has not been written', async () => {
    expect(await resolveAvatar(noStorage, {}, 'https://github/a')).toBe('https://github/a')
  })

  test('prefers the mirrored value over the fallback when it IS written', async () => {
    expect(
      await resolveAvatar(noStorage, { socialImage: 'https://mirrored' }, 'https://github/a'),
    ).toBe('https://mirrored')
  })

  // A teammate passes no fallback, because they cannot read your Better Auth
  // record. Absent mirror plus absent fallback is initials, as before.
  test('is null with neither, so a teammate still gets initials', async () => {
    expect(await resolveAvatar(noStorage, {})).toBeNull()
  })

  // An upload outranks both. This is the precedence the whole two-field design
  // exists to protect and the fallback must not disturb it.
  test('an UPLOAD still wins over the fallback', async () => {
    const stored = { storage: { getUrl: async () => 'https://convex/stored' } }
    expect(
      await resolveAvatar(stored, { imageId: 'k1' as never, socialImage: 'https://mirrored' }, 'https://github/a'),
    ).toBe('https://convex/stored')
  })
})
