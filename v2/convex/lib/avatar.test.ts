import { describe, expect, test } from 'vitest'
import {
  AVATAR_UPLOAD_LIMIT,
  AVATAR_UPLOAD_WINDOW_MS,
  MAX_AVATAR_BYTES,
  isAllowedAvatarType,
  nextAvatarUploadWindow,
  resolveAvatar,
  shouldSyncSocialImage,
} from './avatar.ts'

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

/**
 * THE FIXED-WINDOW ALGORITHM IS nextPostWindow'S, DELIBERATELY — same shape,
 * different fields and a different limit. See AVATAR_UPLOAD_LIMIT for why the
 * numbers differ so much from chat's, and lib/chat.ts's own note on why each
 * limit gets its own small named function rather than one parameterised twice.
 */
describe('nextAvatarUploadWindow', () => {
  test('a player who has never uploaded opens a fresh window', () => {
    expect(nextAvatarUploadWindow({}, 1_000)).toEqual({
      avatarWindowStartedAt: 1_000,
      avatarUploadsInWindow: 1,
    })
  })

  test('a second request inside the window counts up rather than resetting it', () => {
    expect(
      nextAvatarUploadWindow({ avatarWindowStartedAt: 1_000, avatarUploadsInWindow: 1 }, 2_000),
    ).toEqual({ avatarWindowStartedAt: 1_000, avatarUploadsInWindow: 2 })
  })

  test('the request AT the limit is the last one allowed', () => {
    expect(
      nextAvatarUploadWindow(
        { avatarWindowStartedAt: 1_000, avatarUploadsInWindow: AVATAR_UPLOAD_LIMIT - 1 },
        2_000,
      ),
    ).toEqual({ avatarWindowStartedAt: 1_000, avatarUploadsInWindow: AVATAR_UPLOAD_LIMIT })
  })

  test('the request past the limit is refused', () => {
    expect(
      nextAvatarUploadWindow(
        { avatarWindowStartedAt: 1_000, avatarUploadsInWindow: AVATAR_UPLOAD_LIMIT },
        2_000,
      ),
    ).toBeNull()
  })

  /**
   * A THRESHOLD TESTED IN ONE DIRECTION IS VACUOUS — the same rule
   * insightsAccess's trial boundary is tested under. `>=` is what makes the
   * window a fixed window rather than one that can never expire.
   */
  test('the window expires exactly at the boundary, not a millisecond later', () => {
    const exhausted = {
      avatarWindowStartedAt: 1_000,
      avatarUploadsInWindow: AVATAR_UPLOAD_LIMIT,
    }
    expect(nextAvatarUploadWindow(exhausted, 1_000 + AVATAR_UPLOAD_WINDOW_MS - 1)).toBeNull()
    expect(nextAvatarUploadWindow(exhausted, 1_000 + AVATAR_UPLOAD_WINDOW_MS)).toEqual({
      avatarWindowStartedAt: 1_000 + AVATAR_UPLOAD_WINDOW_MS,
      avatarUploadsInWindow: 1,
    })
  })

  /**
   * `startedAt === undefined` IS CHECKED EXPLICITLY rather than defaulting to 0,
   * for nextPostWindow's stated reason: a 0 default only reads as "expired"
   * while `now` is large, which is true of real timestamps and false of the
   * small values these tests use. Correctness must not depend on how big the
   * clock happens to be.
   */
  test('a count with no window start is treated as never having uploaded', () => {
    expect(nextAvatarUploadWindow({ avatarUploadsInWindow: AVATAR_UPLOAD_LIMIT }, 5)).toEqual({
      avatarWindowStartedAt: 5,
      avatarUploadsInWindow: 1,
    })
  })
})
