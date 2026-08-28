import { describe, expect, test } from 'vitest'
import { canonicalTimeZone, timeZoneMapping } from './time-zones.ts'

describe('canonicalTimeZone', () => {
  test('null (no time zone stored yet) passes through as null', () => {
    expect(canonicalTimeZone(null)).toBeNull()
  })

  test('an IANA spelling nothing maps from passes through unchanged', () => {
    expect(canonicalTimeZone('America/Chicago')).toBe('America/Chicago')
  })

  // The regression this table exists to fix: a row copied from v1 carries
  // the Postgres spelling v1 wrote (app-bar-base.tsx's original mapping,
  // IANA -> Postgres), and TIME_ZONE_GROUPS only lists the IANA one.
  // Asia/Kolkata is the only one of the five pairs TIME_ZONE_GROUPS actually
  // offers — see time-zones.ts's doc comment on why the other four still
  // resolve here but stay unrepresented in the picker.
  test('the Postgres spelling of a zone the picker offers resolves to the IANA one', () => {
    expect(canonicalTimeZone('Asia/Calcutta')).toBe('Asia/Kolkata')
  })

  // Every pair this table knows about, matched against the same list
  // convex/lib/reminders.test.ts pins for the sweep — proof the two files
  // agree on which spelling is "the Postgres one" for all five, not just
  // Kolkata.
  test('every mapped pair resolves Postgres -> IANA, matching reminders.test.ts', () => {
    const pairs = [
      ['Asia/Calcutta', 'Asia/Kolkata'],
      ['Asia/Katmandu', 'Asia/Kathmandu'],
      ['Asia/Rangoon', 'Asia/Yangon'],
      ['Europe/Kyiv', 'Europe/Kiev'],
      ['Pacific/Kanton', 'Pacific/Enderbury'],
    ] as const
    for (const [postgresName, ianaName] of pairs) {
      expect(canonicalTimeZone(postgresName)).toBe(ianaName)
    }
  })

  test('the mapping table itself is keyed Postgres -> IANA, not the other way round', () => {
    // Pins the DIRECTION, not just the pairing — a table with the same five
    // pairs but swapped keys/values would pass every test above except this
    // one, since canonicalTimeZone would then map the IANA spelling to the
    // Postgres one, which is exactly backwards from what a copied row needs.
    expect(timeZoneMapping['Asia/Calcutta']).toBe('Asia/Kolkata')
    expect(timeZoneMapping['Asia/Kolkata']).toBeUndefined()
  })
})
