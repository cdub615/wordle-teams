import { describe, expect, test } from 'vitest'
// Test-only: do not copy this convex->src import into runtime code.
import { TIME_ZONE_GROUPS } from '../../src/lib/time-zones.ts'
import { REGIONS, regionOf } from './regions.ts'

// wordle-teams-zic8.3.21.1. regionOf runs on the board write path, so it must
// never throw, and a table typo silently sends a player to the wrong region.
// The per-region lists below duplicate the table ON PURPOSE: a typo in the
// table is exactly what a second, independent copy catches.

const A = 'America/'
const lists: Array<[string, Array<string>]> = [
  [
    'US Eastern',
    [
      ...[
        'New_York', 'Detroit', 'Kentucky/Louisville', 'Kentucky/Monticello', 'Louisville',
        'Indiana/Indianapolis', 'Indianapolis', 'Fort_Wayne', 'Indiana/Vincennes',
        'Indiana/Winamac', 'Indiana/Marengo', 'Indiana/Petersburg', 'Indiana/Vevay',
        'Toronto', 'Montreal', 'Nipigon', 'Thunder_Bay', 'Iqaluit', 'Pangnirtung',
        'Halifax', 'Glace_Bay', 'Moncton', 'Goose_Bay', 'St_Johns',
        'Atikokan', 'Coral_Harbour', 'Blanc-Sablon', 'Miquelon',
      ].map((c) => A + c),
      'US/Eastern', 'US/Michigan', 'US/East-Indiana', 'Canada/Eastern', 'Canada/Atlantic',
      'Canada/Newfoundland', 'EST5EDT', 'EST',
    ],
  ],
  [
    'US Central',
    [
      ...[
        'Chicago', 'Indiana/Knox', 'Knox_IN', 'Indiana/Tell_City', 'Menominee',
        'North_Dakota/Center', 'North_Dakota/New_Salem', 'North_Dakota/Beulah',
        'Winnipeg', 'Rainy_River', 'Rankin_Inlet', 'Resolute', 'Regina', 'Swift_Current',
      ].map((c) => A + c),
      'US/Central', 'US/Indiana-Starke', 'Canada/Central', 'Canada/Saskatchewan', 'CST6CDT',
    ],
  ],
  [
    'US Mountain',
    [
      ...[
        'Denver', 'Boise', 'Phoenix', 'Shiprock', 'Edmonton', 'Cambridge_Bay', 'Yellowknife',
        'Inuvik', 'Creston', 'Dawson_Creek', 'Fort_Nelson', 'Whitehorse', 'Dawson',
      ].map((c) => A + c),
      'US/Mountain', 'US/Arizona', 'Navajo', 'Canada/Mountain', 'Canada/Yukon', 'MST7MDT', 'MST',
    ],
  ],
  [
    'US Pacific',
    [A + 'Los_Angeles', A + 'Vancouver', 'US/Pacific', 'Canada/Pacific', 'PST8PDT'],
  ],
  [
    'Alaska',
    [
      ...['Anchorage', 'Juneau', 'Sitka', 'Metlakatla', 'Yakutat', 'Nome'].map((c) => A + c),
      'US/Alaska',
    ],
  ],
  [
    'Hawaii',
    ['Pacific/Honolulu', 'Pacific/Johnston', A + 'Adak', A + 'Atka', 'US/Hawaii', 'US/Aleutian', 'HST'],
  ],
  [
    'UK & Ireland',
    [
      ...['London', 'Dublin', 'Belfast', 'Guernsey', 'Isle_of_Man', 'Jersey'].map((c) => 'Europe/' + c),
      'GB', 'GB-Eire', 'Eire',
    ],
  ],
  [
    'Europe',
    [
      ...['Reykjavik', 'Azores', 'Madeira', 'Canary', 'Faroe', 'Faeroe', 'Jan_Mayen'].map((c) => 'Atlantic/' + c),
      ...['Nuuk', 'Godthab', 'Danmarkshavn', 'Scoresbysund', 'Thule'].map((c) => A + c),
      'Asia/Istanbul', 'Asia/Nicosia', 'Europe/Istanbul', 'Europe/Nicosia', 'W-SU',
      'Iceland', 'Poland', 'Portugal', 'Turkey', 'WET', 'CET', 'MET', 'EET',
    ],
  ],
  [
    'Africa',
    [
      'Atlantic/Cape_Verde', 'Atlantic/St_Helena',
      ...['Antananarivo', 'Comoro', 'Mayotte', 'Mauritius', 'Reunion', 'Mahe'].map((c) => 'Indian/' + c),
      'Egypt', 'Libya',
    ],
  ],
  ['Asia', ['Japan', 'ROK', 'PRC', 'ROC', 'Hongkong', 'Singapore', 'Israel', 'Iran']],
  [
    'Latin America & Caribbean',
    [
      'Atlantic/Bermuda', 'Atlantic/Stanley', 'Atlantic/South_Georgia', 'Cuba', 'Jamaica',
      'Pacific/Easter', 'Chile/EasterIsland',
      // negative guards: must NOT be pulled into US Eastern
      A + 'Nassau', A + 'Puerto_Rico', A + 'Panama',
    ],
  ],
  ['Australia & Pacific', ['Kwajalein', 'NZ-CHAT', 'US/Samoa']],
]

describe('regionOf: explicit table', () => {
  for (const [name, zones] of lists) {
    test.each(zones)(`%s -> ${name}`, (zone) => {
      expect(regionOf(zone)?.name).toBe(name)
    })
  }
})

describe('regionOf: prefix fallback', () => {
  test.each([
    ['Europe/Paris', 'Europe'],
    ['Europe/Moscow', 'Europe'],
    ['Asia/Kolkata', 'Asia'],
    ['Australia/Perth', 'Australia & Pacific'],
    ['Pacific/Auckland', 'Australia & Pacific'],
    ['Pacific/Fiji', 'Australia & Pacific'],
    ['America/Sao_Paulo', 'Latin America & Caribbean'],
    ['America/Mexico_City', 'Latin America & Caribbean'],
    ['Africa/Nairobi', 'Africa'],
  ])('%s -> %s', (zone, name) => {
    expect(regionOf(zone)?.name).toBe(name)
  })
})

describe('regionOf: no region', () => {
  test.each(['UTC', 'Etc/GMT+5', 'Antarctica/McMurdo', '', 'Not/AZone'])('%j -> null', (zone) => {
    expect(regionOf(zone)).toBeNull()
  })
  test('null and undefined -> null', () => {
    expect(regionOf(null)).toBeNull()
    expect(regionOf(undefined)).toBeNull()
  })
})

describe('regionOf: re-pointed link/target pairs', () => {
  test('Greenland is Europe', () => {
    for (const c of ['Nuuk', 'Godthab', 'Danmarkshavn', 'Scoresbysund', 'Thule'])
      expect(regionOf(A + c)?.slug).toBe('europe')
  })
  test('each link agrees with its target', () => {
    expect(regionOf('Asia/Istanbul')).toEqual(regionOf('Europe/Istanbul'))
    expect(regionOf('Asia/Nicosia')).toEqual(regionOf('Europe/Nicosia'))
    expect(regionOf('Pacific/Easter')).toEqual(regionOf('Chile/EasterIsland'))
    expect(regionOf('W-SU')).toEqual(regionOf('Europe/Moscow'))
    expect(regionOf('Pacific/Easter')?.slug).toBe('latin-america')
    expect(regionOf('America/Miquelon')?.slug).toBe('us-eastern')
  })
})

describe('regionOf: Postgres spellings', () => {
  test.each([
    ['Asia/Calcutta', 'Asia/Kolkata'],
    ['Asia/Katmandu', 'Asia/Kathmandu'],
    ['Asia/Rangoon', 'Asia/Yangon'],
    ['Europe/Kyiv', 'Europe/Kiev'],
    ['Pacific/Kanton', 'Pacific/Enderbury'],
  ])('%s and %s map to the same region', (pg, iana) => {
    expect(regionOf(pg)).not.toBeNull()
    expect(regionOf(iana)).toEqual(regionOf(pg))
  })
})

describe('REGIONS', () => {
  test('every region is reached by at least one listed zone', () => {
    const reached = new Set(lists.flatMap(([, zones]) => zones.map((z) => regionOf(z)?.slug)))
    for (const r of REGIONS) expect(reached.has(r.slug), r.slug).toBe(true)
  })
  test('slugs and names are unique', () => {
    expect(new Set(REGIONS.map((r) => r.slug)).size).toBe(REGIONS.length)
    expect(new Set(REGIONS.map((r) => r.name)).size).toBe(REGIONS.length)
  })
})

describe('regionOf: coverage', () => {
  // Cannot detect a mis-bucketed America/* zone: it only checks non-null.
  test('every zone Node knows has a region, except UTC, Etc/* and Antarctica/*', () => {
    const unmapped = Intl.supportedValuesOf('timeZone').filter(
      (z) => regionOf(z) === null && z !== 'UTC' && !z.startsWith('Etc/') && !z.startsWith('Antarctica/'),
    )
    expect(unmapped).toEqual([])
  })
  test("every zone in the app's picker (TIME_ZONE_GROUPS) has a region", () => {
    for (const g of TIME_ZONE_GROUPS) for (const i of g.items) expect(regionOf(i.value), i.value).not.toBeNull()
  })
})
