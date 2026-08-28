/**
 * Eligibility arithmetic for the daily board-entry reminder.
 *
 * Pure by construction — no Convex, no I/O, no env, no clock. `sweep`
 * (convex/reminders.ts) reads the clock once and passes instants — or strings
 * already resolved from them — in, which is what makes every rule here
 * directly testable, including the ones that only misbehave in a particular
 * timezone at a particular hour.
 *
 * THE RULES ARE v1's, MINUS TWO BUGS. `get_players_for_reminder`
 * (supabase/migrations/20250416172516_limit_daily_reminders.sql) resolves the
 * weekend check and the ten-day activity window against CURRENT_DATE, which is
 * the SERVER's day. That is the same defect the schema note on
 * dailyScores.puzzleDay documents: 733 of production's 7468 score rows land on
 * a different calendar day in UTC than in America/Chicago, across 57 player
 * timezones. Here every rule resolves in the player's own zone. See
 * divergences 14 and 15.
 *
 * The one v1 bug that is ported UNCHANGED is the midnight window — see
 * isDueThisHour.
 */
import { addDays, isWeekendDay, type PuzzleDay } from './puzzleDay.ts'

/** A wall-clock time of day, 'HH:MM:SS', in some player's zone. */
export type LocalTime = string

/**
 * The reminder times the app offers, and the ONLY ones the server accepts.
 *
 * v1's picker offers exactly these eighteen (board-entry-reminders.tsx:86-103)
 * and nothing enforced it server-side. That gap is real, not theoretical: a
 * shape-only check accepts '23:30:00', which isDueThisHour can never match,
 * because the cron ticks on the hour. The row stores fine, the UI looks right,
 * and the player is silently never reminded.
 *
 * Exported so the settings UI renders FROM this list rather than keeping a
 * second copy in sync with it.
 */
export const REMINDER_TIMES: ReadonlyArray<LocalTime> = Array.from(
  { length: 18 },
  (_, i) => `${String(i + 5).padStart(2, '0')}:00:00`,
)

/**
 * Resolve an instant into a player's local calendar day and wall-clock time.
 *
 * `hourCycle: 'h23'` IS LOAD-BEARING, but not for the reason a first guess
 * suggests. `hour12: false` also resolves to `h23` and behaves identically —
 * it is not the hazard. The real hazard is OMITTING the option: `en-US`
 * then defaults to `h12`, so 14:00 formats as '02' with a separate `dayPeriod`
 * part, and every afternoon reminder would compare against a morning string.
 * `'h23'` is used because, unlike `hour12: false`, it states the intent
 * directly.
 *
 * Accepts both IANA spellings of an aliased zone, which is load-bearing:
 * copied rows carry v1's Postgres names ('Asia/Calcutta'), natively-created
 * ones carry whatever the browser reports ('Asia/Kolkata'), and both must reach
 * the same answer.
 *
 * PRECONDITION: `timeZone` must be a zone ICU accepts. `''`, `'GMT+5'` and
 * `'  UTC '` all throw `RangeError` from the `Intl.DateTimeFormat`
 * constructor, and nothing upstream guarantees a valid value —
 * `schema.ts:79` types the stored timeZone as unvalidated `v.optional(v.string())`,
 * so an empty string from a copied row reaches here unchanged. The caller
 * must catch this and skip that player rather than let it abort the batch.
 */
export function localParts(
  timeZone: string,
  at: Date,
): { day: PuzzleDay; time: LocalTime } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value

  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
  }
}

/**
 * v1's one-hour window, ported exactly: the reminder time must fall in
 * [an hour ago, now], both bounds inclusive, both resolved in the player's
 * zone.
 *
 * BOTH BOUNDS ARE PASSED IN rather than derived here, because deriving "an hour
 * ago" from a wall-clock string means doing timezone arithmetic on a string. The
 * caller has the instant and can format it twice.
 *
 * THE MIDNIGHT WRAP IS A v1 BUG AND IS PORTED. When the hour spans midnight the
 * lower bound wraps to 23:xx while the upper stays at 00:xx, so no value can
 * satisfy both and nobody is reminded. It is unreachable today: the picker
 * offers exactly eighteen times, 05:00:00 through 22:00:00
 * (board-entry-reminders.tsx:86-103). It is left alone rather than fixed so the
 * ported rule stays comparable with production, and pinned in the tests so that
 * widening the picker fails loudly instead of quietly dropping reminders.
 *
 * BOTH BOUNDS INCLUSIVE MEANS DOUBLE-MATCHING IS THE NORMAL CASE, not an edge
 * case. The cron ticks at :00 UTC. In any whole-hour-offset zone (measured:
 * America/Chicago, Australia/Sydney, Europe/London, Pacific/Honolulu — 7182
 * duplicate matches over 399 days) an on-the-hour reminder satisfies the upper
 * bound on one tick and the lower bound on the next. Half-hour zones like
 * Asia/Kolkata don't hit this. It is safe only because `alreadyRemindedToday`
 * absorbs it — which means the stamp MUST be written unconditionally, before
 * delivery is attempted, or a majority-zone player gets reminded twice a day.
 */
export function isDueThisHour(
  reminderTime: LocalTime,
  nowLocalTime: LocalTime,
  hourAgoLocalTime: LocalTime,
): boolean {
  return reminderTime <= nowLocalTime && reminderTime >= hourAgoLocalTime
}

/**
 * The once-per-day guard, resolved in the player's zone.
 *
 * v1: `last_board_entry_reminder IS NULL OR last < DATE_TRUNC('day', now AT
 * TIME ZONE tz)`. Negated, that is "the stamp's local day is today or later".
 * `>=` rather than `===` so a clock skew into tomorrow still suppresses rather
 * than double-sending.
 */
export function alreadyRemindedToday(
  lastReminder: number | undefined,
  timeZone: string,
  localDay: PuzzleDay,
): boolean {
  if (lastReminder === undefined) return false
  return localParts(timeZone, new Date(lastReminder)).day >= localDay
}

/**
 * v1's "has played recently" gate: at least one board in the trailing ten days,
 * inclusive of the tenth. Stops the reminder chasing people who have already
 * left.
 *
 * `days` is the puzzleDay list from ONE index range query — see sweep.
 */
export function hasRecentActivity(days: Array<PuzzleDay>, localDay: PuzzleDay): boolean {
  const floor = addDays(localDay, -10)
  return days.some((day) => day >= floor)
}

/** Whether today's board is already in. */
export function enteredOn(days: Array<PuzzleDay>, localDay: PuzzleDay): boolean {
  return days.includes(localDay)
}

/**
 * Whether the weekend opt-in rule applies at all — i.e. whether it is the
 * weekend WHERE THE PLAYER IS. v1 asks the server. See divergence 14.
 */
export function needsWeekendOptIn(localDay: PuzzleDay): boolean {
  return isWeekendDay(localDay)
}
