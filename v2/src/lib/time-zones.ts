/**
 * The time zone picker's options, ported verbatim from v1
 * (src/components/app-bar/user-dialog.tsx:50-103) — five regional groups, 26
 * zones total, each carrying a long label for the desktop trigger and a short
 * one for the mobile trigger. See notifications-tab.tsx's `useMediaQuery`
 * usage for where the split is read.
 *
 * Not exhaustive of IANA's zone list — it is v1's curated shortlist, and
 * widening it is a product decision for another task, not something this
 * port should do quietly.
 */
export type TimeZoneOption = { value: string; label: string; shortLabel: string }
export type TimeZoneGroup = { label: string; items: Array<TimeZoneOption> }

export const TIME_ZONE_GROUPS: Array<TimeZoneGroup> = [
  {
    label: 'North America',
    items: [
      { value: 'America/New_York', label: 'Eastern Standard Time (EST)', shortLabel: 'EST' },
      { value: 'America/Chicago', label: 'Central Standard Time (CST)', shortLabel: 'CST' },
      { value: 'America/Denver', label: 'Mountain Standard Time (MST)', shortLabel: 'MST' },
      { value: 'America/Los_Angeles', label: 'Pacific Standard Time (PST)', shortLabel: 'PST' },
      { value: 'America/Anchorage', label: 'Alaska Standard Time (AKST)', shortLabel: 'AKST' },
      { value: 'Pacific/Honolulu', label: 'Hawaii Standard Time (HST)', shortLabel: 'HST' },
    ],
  },
  {
    label: 'Europe & Africa',
    items: [
      { value: 'Europe/London', label: 'Greenwich Mean Time (GMT)', shortLabel: 'GMT' },
      { value: 'Europe/Paris', label: 'Central European Time (CET)', shortLabel: 'CET' },
      { value: 'Europe/Athens', label: 'Eastern European Time (EET)', shortLabel: 'EET' },
      { value: 'Europe/Lisbon', label: 'Western European Summer Time (WEST)', shortLabel: 'WEST' },
      { value: 'Africa/Harare', label: 'Central Africa Time (CAT)', shortLabel: 'CAT' },
      { value: 'Africa/Nairobi', label: 'East Africa Time (EAT)', shortLabel: 'EAT' },
    ],
  },
  {
    label: 'Asia',
    items: [
      { value: 'Europe/Moscow', label: 'Moscow Time (MSK)', shortLabel: 'MSK' },
      { value: 'Asia/Kolkata', label: 'India Standard Time (IST)', shortLabel: 'IST' },
      { value: 'Asia/Shanghai', label: 'China Standard Time (CST)', shortLabel: 'CST' },
      { value: 'Asia/Tokyo', label: 'Japan Standard Time (JST)', shortLabel: 'JST' },
      { value: 'Asia/Seoul', label: 'Korea Standard Time (KST)', shortLabel: 'KST' },
      { value: 'Asia/Makassar', label: 'Indonesia Central Standard Time (WITA)', shortLabel: 'WITA' },
    ],
  },
  {
    label: 'Australia & Pacific',
    items: [
      { value: 'Australia/Perth', label: 'Australian Western Standard Time (AWST)', shortLabel: 'AWST' },
      { value: 'Australia/Darwin', label: 'Australian Central Standard Time (ACST)', shortLabel: 'ACST' },
      { value: 'Australia/Sydney', label: 'Australian Eastern Standard Time (AEST)', shortLabel: 'AEST' },
      { value: 'Pacific/Auckland', label: 'New Zealand Standard Time (NZST)', shortLabel: 'NZST' },
      { value: 'Pacific/Fiji', label: 'Fiji Time (FJT)', shortLabel: 'FJT' },
    ],
  },
  {
    label: 'South America',
    items: [
      { value: 'America/Argentina/Buenos_Aires', label: 'Argentina Time (ART)', shortLabel: 'ART' },
      { value: 'America/La_Paz', label: 'Bolivia Time (BOT)', shortLabel: 'BOT' },
      { value: 'America/Sao_Paulo', label: 'Brasilia Time (BRT)', shortLabel: 'BRT' },
      { value: 'America/Santiago', label: 'Chile Standard Time (CLT)', shortLabel: 'CLT' },
    ],
  },
]

/**
 * Postgres spelling -> IANA spelling.
 *
 * v1's app-bar-base.tsx ran the OPPOSITE mapping (IANA -> Postgres) BEFORE
 * every save, because `AT TIME ZONE` needed the Postgres spelling — so every
 * row v1 ever wrote, and everything scripts/copy-from-supabase.mjs copies
 * verbatim, carries the RIGHT-hand spelling below, never the left. This table
 * exists to undo that on the way back out: see `canonicalTimeZone`, its only
 * caller, and convex/lib/reminders.test.ts's identically-paired
 * `postgresSpellings` case, which proves Intl resolves both spellings of each
 * pair to the same answer.
 *
 * REVISION NOTE: an earlier version of this file had this table running the
 * OTHER direction and called it "now cosmetic... ported anyway so that a
 * copied row and a natively-created row spell the same zone identically."
 * Both claims were wrong. Convex asking Intl instead of Postgres asking `AT
 * TIME ZONE` does not make the SPELLING stop mattering — it only makes Intl,
 * rather than Postgres, the thing both spellings have to resolve identically
 * against, which reminders.test.ts's case already establishes they do. What
 * still breaks is `notifications-tab.tsx`'s own display code: it looks a
 * stored zone up in TIME_ZONE_GROUPS by exact string match, which only lists
 * the IANA spelling, so a copied 'Asia/Calcutta' row missed every entry and
 * fell through to "Select a time zone" — telling a player their zone was
 * unset when the sweep (reminders.test.ts) was resolving it correctly the
 * whole time. Nothing was cosmetic; nothing had zero importers before this
 * revision made it have one.
 *
 * STILL ONLY FIXES DISPLAY FOR 'Asia/Calcutta' IN PRACTICE. TIME_ZONE_GROUPS
 * is v1's curated 26-zone shortlist, and Kolkata is the only one of these
 * five aliased zones it lists — Kathmandu, Yangon, Kiev/Kyiv and Enderbury/
 * Kanton all normalise correctly through this table too, but to a zone the
 * picker still does not offer, so those four keep showing the placeholder
 * regardless. That gap is TIME_ZONE_GROUPS's, not this table's, and closes
 * only if the picker widens.
 */
export const timeZoneMapping: { [key: string]: string } = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kyiv': 'Europe/Kiev',
  'Pacific/Kanton': 'Pacific/Enderbury',
}

/**
 * Normalises a stored time zone to the spelling TIME_ZONE_GROUPS lists, so a
 * row copied from v1 (Postgres spelling) and a row written natively by this
 * app (IANA spelling) both look themselves up successfully. Passes an
 * unrecognised value through unchanged — this is a lookup table of exactly
 * five known aliases, not a general IANA normaliser, so a zone it does not
 * know about (including every native v2 write, which is already IANA) is
 * assumed to already be in the spelling the picker wants.
 */
export function canonicalTimeZone(zone: string | null): string | null {
  if (zone === null) return null
  return timeZoneMapping[zone] ?? zone
}

/**
 * The stored zone as a pickable option, WHEN THE CURATED LIST DOES NOT OFFER IT.
 *
 * WHY THIS EXISTS (wordle-teams-54s). The picker offers 27 zones; production
 * players span 57. A copied player whose zone is not one of the 27 opened the
 * Notifications tab and saw "Select a time zone" — the placeholder, as though
 * nothing were configured — even though a zone IS set and the reminder sweep
 * resolves it correctly. The placeholder then invited them to pick, and picking
 * REPLACED a correct zone with a neighbouring one, silently moving when their
 * daily email arrives.
 *
 * Inherited from v1 rather than introduced here, but it matters more now: Phase
 * 6 made the stored zone decide when a reminder fires, where in v1 the setting
 * was largely decorative for anyone who never opened the dialog.
 *
 * THIS IS THE SMALLEST OF THE THREE OPTIONS ON THAT ISSUE and deliberately so.
 * Widening the list toward full IANA, or grouping by offset, are product
 * decisions about a curated list; showing a player the zone they actually have
 * is a correctness fix, and it is what the acceptance criteria asks for.
 *
 * IT IS NOT THE CANONICALISATION FIX. canonicalTimeZone above translates v1's
 * Postgres spellings, and of the five aliased pairs only Asia/Calcutta lands in
 * the picker. Asia/Katmandu, Asia/Rangoon, Europe/Kyiv and Pacific/Kanton
 * normalise correctly and STILL had no option to select, because the list never
 * offered them in either version. This is what covers those.
 *
 * THE LABEL IS DERIVED, NOT INVENTED. The city comes off the IANA identifier
 * and the offset from Intl, so it describes the zone the player actually has
 * rather than approximating it with a nearby curated one — the whole failure
 * being fixed. Shape matches the curated entries: "Name (ABBR)".
 *
 * @returns null when the zone is unset or already offered — the caller then
 *          behaves exactly as before.
 */
export function unlistedZoneOption(canonicalZone: string | null): TimeZoneOption | null {
  if (!canonicalZone) return null
  if (TIME_ZONE_GROUPS.some((group) => group.items.some((i) => i.value === canonicalZone))) {
    return null
  }

  // 'America/Indiana/Indianapolis' -> 'Indianapolis'. The last segment is the
  // locality in every IANA identifier shape, including the three-part ones.
  const city = (canonicalZone.split('/').pop() ?? canonicalZone).replace(/_/g, ' ')

  let offset = ''
  try {
    offset =
      new Intl.DateTimeFormat('en-US', { timeZone: canonicalZone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value ?? ''
  } catch {
    // An identifier this runtime does not know. Intl THROWS on those rather
    // than returning anything, and the honest answer is still the stored name —
    // falling through to the placeholder is the bug this function exists for.
  }

  return {
    value: canonicalZone,
    label: offset ? `${city} (${offset})` : city,
    shortLabel: offset || city,
  }
}
