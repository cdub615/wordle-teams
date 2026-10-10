/**
 * REGIONS (spec v2 §4.3/§4.4): a player's saved IANA time zone → the region
 * group they play for. Client-safe: no imports.
 *
 * NEW US OR CANADIAN ZONES MUST BE ADDED BY HAND. America/* falls back to
 * Latin America, and no test notices: the coverage test only checks non-null.
 *
 * ORDER IS EXPLICIT TABLE, THEN PREFIX FALLBACK, THEN NULL. The table holds
 * every US and Canadian zone (they cannot use a prefix: America/* is mostly
 * Latin America), the UK and Ireland, and the few non-continent prefixes.
 * Canada folds into the US groups (owner, 2026-10-09); Atlantic and
 * Newfoundland Canada into US Eastern, the nearest. UTC, Etc/* and Antarctica/*
 * are null: no region, and the page says so.
 * Legacy link names (US/Eastern, Canada/Pacific, GB, Asia/Calcutta…) are listed
 * because v1 rows were copied verbatim (src/lib/time-zones.ts).
 *
 * NEVER THROWS: the board write path calls this for every score.
 */
export type Region = { slug: string; name: string }

export const REGIONS = [
  { slug: 'us-eastern', name: 'US Eastern' },
  { slug: 'us-central', name: 'US Central' },
  { slug: 'us-mountain', name: 'US Mountain' },
  { slug: 'us-pacific', name: 'US Pacific' },
  { slug: 'alaska', name: 'Alaska' },
  { slug: 'hawaii', name: 'Hawaii' },
  { slug: 'uk-ireland', name: 'UK & Ireland' },
  { slug: 'europe', name: 'Europe' },
  { slug: 'africa', name: 'Africa' },
  { slug: 'asia', name: 'Asia' },
  { slug: 'australia-pacific', name: 'Australia & Pacific' },
  { slug: 'latin-america', name: 'Latin America & Caribbean' },
] as const satisfies ReadonlyArray<Region>

type Slug = (typeof REGIONS)[number]['slug']
const BY_SLUG = new Map<string, Region>(REGIONS.map((r) => [r.slug, r]))

/** One slug for a run of zones; keeps each block below to its list. */
function block(slug: Slug, zones: ReadonlyArray<string>): Array<[string, Slug]> {
  return zones.map((z) => [z, slug])
}

const ZONES: Record<string, Slug> = Object.fromEntries([
  // Eastern, plus Atlantic and Newfoundland Canada (nearest group).
  // Miquelon (French, UTC-3) folds into Eastern, the nearest, like Newfoundland.
  // Atikokan/Coral_Harbour/Blanc-Sablon keep fixed offsets (EST/AST all year);
  // Atikokan is EST, so Eastern; Blanc-Sablon is AST, so it folds like Atlantic.
  ...block('us-eastern', [
    'America/New_York', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Louisville',
    'America/Indiana/Indianapolis', 'America/Indianapolis', 'America/Fort_Wayne', 'America/Indiana/Vincennes',
    'America/Indiana/Winamac', 'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay',
    'America/Toronto', 'America/Montreal', 'America/Nipigon', 'America/Thunder_Bay', 'America/Iqaluit', 'America/Pangnirtung',
    'America/Halifax', 'America/Glace_Bay', 'America/Moncton', 'America/Goose_Bay', 'America/St_Johns',
    'America/Miquelon', 'America/Atikokan', 'America/Coral_Harbour', 'America/Blanc-Sablon',
    'US/Eastern', 'US/Michigan', 'US/East-Indiana', 'Canada/Eastern', 'Canada/Atlantic',
    'Canada/Newfoundland', 'EST5EDT', 'EST',
  ]),
  ...block('us-central', [
    'America/Chicago', 'America/Indiana/Knox', 'America/Knox_IN', 'America/Indiana/Tell_City', 'America/Menominee',
    'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah',
    'America/Winnipeg', 'America/Rainy_River', 'America/Rankin_Inlet', 'America/Resolute', 'America/Regina', 'America/Swift_Current',
    'US/Central', 'US/Indiana-Starke', 'Canada/Central', 'Canada/Saskatchewan', 'CST6CDT',
  ]),
  ...block('us-mountain', [
    'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Shiprock', 'America/Edmonton', 'America/Cambridge_Bay', 'America/Yellowknife',
    'America/Inuvik', 'America/Creston', 'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Whitehorse', 'America/Dawson',
    'US/Mountain', 'US/Arizona', 'Navajo', 'Canada/Mountain', 'Canada/Yukon', 'MST7MDT', 'MST',
  ]),
  ...block('us-pacific', [
    'America/Los_Angeles', 'America/Vancouver',
    'US/Pacific', 'Canada/Pacific', 'PST8PDT',
  ]),
  ...block('alaska', [
    'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome',
    'US/Alaska',
  ]),
  // The Aleutians (Adak) share Hawaii's offset.
  ...block('hawaii', [
    'Pacific/Honolulu', 'Pacific/Johnston', 'America/Adak', 'America/Atka',
    'US/Hawaii', 'US/Aleutian', 'HST',
  ]),
  ...block('uk-ireland', [
    'Europe/London', 'Europe/Dublin', 'Europe/Belfast', 'Europe/Guernsey',
    'Europe/Isle_of_Man', 'Europe/Jersey', 'GB', 'GB-Eire', 'Eire',
  ]),
  // Atlantic/* is not a continent: the island zones are listed by hand.
  ...block('europe', [
    'Atlantic/Reykjavik', 'Atlantic/Azores', 'Atlantic/Madeira', 'Atlantic/Canary',
    'Atlantic/Faroe', 'Atlantic/Faeroe', 'Atlantic/Jan_Mayen',
    // Greenland sits with Iceland and the Faroes.
    'America/Nuuk', 'America/Godthab', 'America/Danmarkshavn', 'America/Scoresbysund',
    'America/Thule',
    // Asia/* links whose targets are Europe/*, and the legacy Moscow link.
    'Asia/Istanbul', 'Asia/Nicosia', 'W-SU',
    'Iceland', 'Poland', 'Portugal', 'Turkey', 'WET', 'CET', 'MET', 'EET',
  ]),
  // Indian/* defaults to Asia (prefix); the African islands are listed.
  ...block('africa', [
    'Atlantic/Cape_Verde', 'Atlantic/St_Helena',
    'Indian/Antananarivo', 'Indian/Comoro', 'Indian/Mayotte', 'Indian/Mauritius',
    'Indian/Reunion', 'Indian/Mahe', 'Egypt', 'Libya',
  ]),
  ...block('asia', ['Japan', 'ROK', 'PRC', 'ROC', 'Hongkong', 'Singapore', 'Israel', 'Iran']),
  ...block('latin-america', [
    'Atlantic/Bermuda', 'Atlantic/Stanley', 'Atlantic/South_Georgia', 'Cuba', 'Jamaica',
    'Pacific/Easter', // Chilean, like Chile/EasterIsland (Chile prefix)
  ]),
  // US/Samoa is American Samoa (Pacific/Pago_Pago), not a US-mainland zone.
  ...block('australia-pacific', ['Kwajalein', 'NZ-CHAT', 'US/Samoa']),
])

const PREFIXES: Record<string, Slug> = {
  Europe: 'europe', Arctic: 'europe',
  Africa: 'africa',
  Asia: 'asia', Indian: 'asia',
  Australia: 'australia-pacific', Pacific: 'australia-pacific', NZ: 'australia-pacific',
  America: 'latin-america', Brazil: 'latin-america', Chile: 'latin-america', Mexico: 'latin-america',
}

export function regionOf(timeZone: string | null | undefined): Region | null {
  if (!timeZone) return null
  // Object.hasOwn: a stored 'constructor' or '__proto__' must not hit the prototype.
  const exact = Object.hasOwn(ZONES, timeZone) ? ZONES[timeZone] : undefined
  if (exact) return BY_SLUG.get(exact)!
  const head = timeZone.split('/')[0]
  const prefix = Object.hasOwn(PREFIXES, head) ? PREFIXES[head] : undefined
  return prefix ? BY_SLUG.get(prefix)! : null
}
