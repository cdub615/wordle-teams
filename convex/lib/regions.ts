/**
 * REGIONS (spec v2 §4.3/§4.4): a player's saved IANA time zone → the region
 * group they play for. Client-safe: no imports. Static, so no upkeep.
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
/** `America/<city>` for each bare name. */
const am = (cities: ReadonlyArray<string>) => cities.map((c) => `America/${c}`)

const ZONES: Record<string, Slug> = Object.fromEntries([
  // Eastern, plus Atlantic and Newfoundland Canada (nearest group).
  // Atikokan/Coral_Harbour/Blanc-Sablon keep fixed offsets (EST/AST all year);
  // Atikokan is EST, so Eastern; Blanc-Sablon is AST, so it folds like Atlantic.
  ...block('us-eastern', [
    ...am([
      'New_York', 'Detroit', 'Kentucky/Louisville', 'Kentucky/Monticello', 'Louisville',
      'Indiana/Indianapolis', 'Indianapolis', 'Fort_Wayne', 'Indiana/Vincennes',
      'Indiana/Winamac', 'Indiana/Marengo', 'Indiana/Petersburg', 'Indiana/Vevay',
      'Toronto', 'Montreal', 'Nipigon', 'Thunder_Bay', 'Iqaluit', 'Pangnirtung',
      'Halifax', 'Glace_Bay', 'Moncton', 'Goose_Bay', 'St_Johns',
      'Atikokan', 'Coral_Harbour', 'Blanc-Sablon',
    ]),
    'US/Eastern', 'US/Michigan', 'US/East-Indiana', 'Canada/Eastern', 'Canada/Atlantic',
    'Canada/Newfoundland', 'EST5EDT', 'EST',
  ]),
  ...block('us-central', [
    ...am([
      'Chicago', 'Indiana/Knox', 'Knox_IN', 'Indiana/Tell_City', 'Menominee',
      'North_Dakota/Center', 'North_Dakota/New_Salem', 'North_Dakota/Beulah',
      'Winnipeg', 'Rainy_River', 'Rankin_Inlet', 'Resolute', 'Regina', 'Swift_Current',
    ]),
    'US/Central', 'US/Indiana-Starke', 'Canada/Central', 'Canada/Saskatchewan', 'CST6CDT',
  ]),
  ...block('us-mountain', [
    ...am([
      'Denver', 'Boise', 'Phoenix', 'Shiprock', 'Edmonton', 'Cambridge_Bay', 'Yellowknife',
      'Inuvik', 'Creston', 'Dawson_Creek', 'Fort_Nelson', 'Whitehorse', 'Dawson',
    ]),
    'US/Mountain', 'US/Arizona', 'Navajo', 'Canada/Mountain', 'Canada/Yukon', 'MST7MDT', 'MST',
  ]),
  ...block('us-pacific', [
    ...am(['Los_Angeles', 'Vancouver']),
    'US/Pacific', 'Canada/Pacific', 'PST8PDT',
  ]),
  ...block('alaska', [
    ...am(['Anchorage', 'Juneau', 'Sitka', 'Metlakatla', 'Yakutat', 'Nome']),
    'US/Alaska',
  ]),
  // The Aleutians (Adak) share Hawaii's offset.
  ...block('hawaii', [
    'Pacific/Honolulu', 'Pacific/Johnston', ...am(['Adak', 'Atka']),
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
