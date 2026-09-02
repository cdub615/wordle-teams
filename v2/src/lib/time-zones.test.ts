import { describe, expect, test } from 'vitest'
import { unlistedZoneOption, canonicalTimeZone, timeZoneMapping } from './time-zones.ts'

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

describe('unlistedZoneOption', () => {
  test('returns null for a zone the picker already offers', () => {
    // The common case. Returning an option here would render the zone twice —
    // once in "Your time zone" and once in its real regional group.
    expect(unlistedZoneOption('America/New_York')).toBeNull()
    expect(unlistedZoneOption('Asia/Kolkata')).toBeNull()
  })

  test('returns null when nothing is stored, so the placeholder still shows', () => {
    // A player who has never opened the tab genuinely HAS no zone, and
    // "Select a time zone" is the truthful thing to say to them.
    expect(unlistedZoneOption(null)).toBeNull()
  })

  test('describes a stored zone the picker does not offer', () => {
    // The four zones wordle-teams-54s named: they canonicalise correctly and
    // were still unrepresented, because the list never offered them.
    for (const zone of ['Europe/Kyiv', 'Asia/Katmandu', 'Asia/Rangoon', 'Pacific/Kanton']) {
      const option = unlistedZoneOption(zone)
      expect(option, `${zone} produced no option`).not.toBeNull()
      expect(option!.value).toBe(zone)
      // The value is what the Select stores, so it must be the zone itself and
      // never a nearby curated one — replacing it is the bug being fixed.
      expect(option!.label).not.toBe('Select a time zone')
    }
  })

  test('the label names the city and its offset, not the raw identifier', () => {
    const option = unlistedZoneOption('Europe/Kyiv')!
    expect(option.label).toContain('Kyiv')
    expect(option.label).toMatch(/GMT[+-]/)
    expect(option.shortLabel).toMatch(/GMT[+-]/)
    // No slash and no underscore: this is shown to a person.
    expect(option.label).not.toContain('/')
  })

  test('a three-segment identifier still yields the locality', () => {
    // 'America/Indiana/Indianapolis' — the last segment is the city in every
    // IANA shape, and the underscore has to go. NOT Buenos_Aires, which reads
    // like the obvious example and IS in the curated list, so it returns null
    // and asserts nothing. (It did, at first.)
    const option = unlistedZoneOption('America/Indiana/Indianapolis')
    expect(option, 'the example zone is curated after all — pick another').not.toBeNull()
    expect(option!.label).toContain('Indianapolis')
    expect(option!.label).not.toContain('_')
  })

  test('an identifier this runtime does not know still describes itself', () => {
    // Intl THROWS on an unknown zone rather than returning anything. Falling
    // through to the placeholder here would be the exact bug this fixes, so the
    // city is still returned with no offset.
    const option = unlistedZoneOption('Mars/Olympus_Mons')
    expect(option).not.toBeNull()
    expect(option!.label).toBe('Olympus Mons')
    expect(option!.shortLabel).toBe('Olympus Mons')
  })
})
