import { formatInTimeZone } from 'date-fns-tz'

// Which calendar day a board belongs to.
//
// daily_scores.date is a timestamptz — an instant, not a day. The app used to decide
// the day with isSameDay(new Date(s.date), day), which resolves that instant in the
// timezone of whatever is executing. That is the viewer's zone in the browser and UTC
// on the server, so the same board could land in two different columns: a hydration
// mismatch on /me (wordle-teams-dyp), and, more quietly, teammates in different zones
// disagreeing about which day someone played.
//
// The rule here is that a board belongs to the day it was for the person who played
// it. Their zone is read from the database (players.time_zone), never from the
// runtime, so the server and the client compute the same answer.
//
// Measured against production when this was chosen: of 7495 rows, 734 land on a
// different day in UTC than in America/Chicago, 582 differ between UTC and the
// player's own zone, and there are 57 distinct player timezones. There is no single
// existing convention in the data to preserve, so this picks the one that matches
// what a Wordle day means to the person playing.

// Only 8 production rows belong to a player with no recorded timezone, and the app's
// audience is centred on US Central, so that is the fallback rather than UTC — UTC
// would push a late-evening board to the following day for exactly the people most
// likely to be missing the field.
export const HOME_TIME_ZONE = 'America/Chicago'

const zoneOf = (timeZone?: string | null) => (timeZone && timeZone.length > 0 ? timeZone : HOME_TIME_ZONE)

/**
 * The calendar day an instant falls on, in the given zone, as 'yyyy-MM-dd'.
 *
 * A string key rather than a Date on purpose: two Dates can only be compared for
 * "same day" by reading their parts, which puts us straight back into runtime-local
 * territory. Strings compare exactly and sort correctly.
 */
export const dayKeyOf = (instant: string | Date, timeZone?: string | null): string =>
  formatInTimeZone(new Date(instant), zoneOf(timeZone), 'yyyy-MM-dd')

/**
 * The key for a specific calendar day, built from its parts.
 *
 * Takes numbers rather than a Date because callers construct days as
 * `new Date(year, monthIndex, i)`, whose parts are only stable when read back in the
 * same runtime that built it.
 */
export const dayKeyOfParts = (year: number, monthIndex: number, day: number): string =>
  `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** The key for a Date's calendar day, read in the given zone. */
export const dayKeyOfDate = (day: Date, timeZone?: string | null): string => dayKeyOf(day, timeZone)

/**
 * Today, in the viewing user's recorded zone.
 *
 * Used to decide whether a dayless cell is a miss (already past) or simply not played
 * yet (today or future). That question is inherently viewer-relative, so it takes the
 * viewer's zone — but from their player record, not from the runtime clock's zone, so
 * the server and the client agree even though they sit in different zones.
 *
 * Not absolutely mismatch-proof: both sides still read their own clock, so a render
 * that straddles midnight in the viewer's zone can disagree. That window is seconds
 * wide and unavoidable without passing a server timestamp down, where the old
 * behaviour disagreed for hours every day for anyone outside UTC.
 */
export const todayKeyIn = (timeZone?: string | null): string => dayKeyOf(new Date(), timeZone)
