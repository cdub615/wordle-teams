/**
 * Eligibility arithmetic for the daily board-entry reminder.
 *
 * Pure by construction — no Convex, no I/O, no env, no clock. `sweep`
 * (convex/reminders.ts) reads the clock once and passes instants — or strings
 * already resolved from them — in, which is what makes every rule here
 * directly testable, including the ones that only misbehave in a particular
 * timezone at a particular hour. The one piece of module state,
 * `formatterCache` below, is a memo rather than a purity violation — every
 * export here is still referentially transparent because of it, not despite
 * it.
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
 * The only two delivery methods that exist. Case-sensitive: 'Email' is
 * rejected. Lives here rather than in settings.ts, and settings.ts imports it
 * from here — same reason REMINDER_TIMES does: `sweep` (convex/reminders.ts)
 * needs the same list to decide who gets claimed and which literal to
 * `.includes()` against, and a second copy in each module risks the exact
 * shape of drift REMINDER_TIMES's own doc comment above warns about — a
 * value that stores fine and looks right in the UI but silently never
 * matches on the other side — just for methods instead of times.
 */
export const METHODS = ['email', 'push'] as const

/**
 * One `Intl.DateTimeFormat` per distinct `timeZone`, reused across every call.
 *
 * SAFE TO SHARE. A formatter is stateless for formatting — `formatToParts`
 * takes the instant as an argument and returns a fresh array every time — so
 * reusing one across players and across calls cannot leak anything from one
 * player's read into another's.
 *
 * NO CACHE-POISONING PATH FROM BAD INPUT. Only a zone that has already been
 * constructed successfully is ever inserted (see localParts below), so a
 * garbage `timeZone` from a copied Supabase row is rejected every time and
 * never reaches this map. That is NOT the same as saying the map itself is
 * small — the valid key space is bigger than the 418 IANA names ICU knows:
 * `+05:30`, `+0530` and `-23:59` are all accepted and key separately, and
 * `utc` and `UTC` occupy two entries. The actual bound is the number of
 * DISTINCT valid `players.timeZone` strings this isolate happens to observe —
 * around 57 today, the figure this file's own header cites — not the shape of
 * the input space, and not the 393-odd player COUNT. (Corrected: this first
 * said 393, which confused rows with zones. Players share zones heavily, which
 * is the whole reason a per-zone memo pays for itself.)
 *
 * MODULE-LEVEL AND CROSS-INVOCATION ON PURPOSE. `localParts` sits on the
 * per-player delivery path (see nextOccurrence's doc comment on the cost that
 * matters there), not only in tests, and a Convex isolate can serve many
 * invocations while warm — surviving across them is the point, not a side
 * effect to guard against.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>()

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
 * The constructor is only ever called directly here, ON A CACHE MISS, so that
 * an invalid zone still throws exactly as before rather than being papered
 * over by a cached failure.
 */
export function localParts(
  timeZone: string,
  at: Date,
): { day: PuzzleDay; time: LocalTime } {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatterCache.set(timeZone, formatter)
  }

  const parts = formatter.formatToParts(at)

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
 * duplicate matches PER ZONE over 399 days, i.e. 18 reminder times x 399 days
 * exactly; 28,728 across the four) an on-the-hour reminder satisfies the upper
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

const utcOf = (day: PuzzleDay, time: LocalTime): number => {
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute, second] = time.split(':').map(Number)
  return Date.UTC(year, month - 1, date, hour, minute, second)
}

/**
 * The instant at which `day` + `time` is the wall clock in `timeZone`.
 *
 * PROBE AND CORRECT, NOT AN OFFSET TABLE. There is no API that inverts
 * `Intl.DateTimeFormat`, so this guesses the instant as if the zone were UTC,
 * formats that guess BACK through localParts, and shifts by the difference.
 * Two or three rounds converge for every EXISTING wall clock, because the
 * drift is the offset and applying it can only be wrong again by the amount a
 * DST boundary moved inside the correction — which the next round absorbs.
 *
 * FOUR ROUNDS IS LOAD-BEARING, NOT BELT-AND-BRACES. For a wall clock a
 * spring-forward erased, the probe never converges: it oscillates forever
 * between the instant just before the gap and the instant just after it, and
 * the PARITY of the round count is what decides which side this returns — see
 * AMBIGUOUS AND NONEXISTENT TIMES below. Changing 4 to 3 or 5 silently flips
 * which side every nonexistent time in production resolves to; it is not a
 * tidy-up.
 *
 * NOTHING TIME-DEPENDENT IS STORED OR ASSUMED. The zone's offset is asked for
 * at the moment of asking, which is the same reason the sweep this replaces
 * was DST-safe.
 *
 * AMBIGUOUS AND NONEXISTENT TIMES. A fall-back makes a wall clock happen
 * twice; this returns the FIRST — verified at America/Chicago's 2026-11-01
 * 01:30, which resolves to the first occurrence, 06:30Z. THIS HALF IS ALSO
 * REACHABLE IN PRODUCTION, not just the nonexistent one below: `Pacific/
 * Easter`'s fall-back makes 21:00 local happen twice on its transition day
 * (2026-04-04, 2027-04-03 and 2028-04-01), and `21:00:00` is one of the
 * eighteen offered REMINDER_TIMES. The consequence: a Pacific/Easter player
 * whose reminder is set for 21:00 gets the EARLIER of the two identical wall
 * clocks — a choice this function makes deliberately, not an accident of
 * which one the probe happened to land on.
 *
 * A spring-forward erases a wall clock entirely. With an EVEN round count
 * this converges to the instant just BEFORE the gap, one hour early — not
 * after it, as an earlier version of this comment claimed before a spec
 * review measured `instantForLocal('America/Chicago', '2026-03-08',
 * '02:30:00')` and found it landed on 01:30 local, not 03:30.
 *
 * THIS IS REACHABLE IN PRODUCTION, not merely theoretical: `Pacific/Easter`'s
 * spring-forward erases 22:00-22:59 local (measured on its transition day in
 * 2026-09-05, 2027-09-04 and 2028-09-02), and `22:00:00` is one of the
 * eighteen offered REMINDER_TIMES. The consequence, weighed and accepted
 * rather than missed: a Pacific/Easter player whose reminder is set for 22:00
 * fires at 21:00 local, one hour early, on that one day a year. Walking the
 * delivery chain across the transition shows no spin and no drift from
 * it — the gaps between consecutive reminders run 24h, 23h, 24h, because
 * `nextOccurrence` recomputes from scratch every time and the wall clock
 * self-corrects to 22:00 again the very next day.
 *
 * PRECONDITION: `timeZone` must be a zone ICU accepts — see localParts, whose
 * RangeError this propagates unchanged. Callers skip the player rather than
 * letting one bad copied row abort anything. `day` and `time` are not
 * similarly guarded, but degrade the same way rather than silently: a
 * malformed value — `('UTC', 'not-a-day', '09:00:00')`, `('UTC',
 * '2026-09-11', 'oops')` — reaches `Date.UTC` as `NaN` and throws `RangeError:
 * Invalid time value` from the same `formatToParts` call, the class callers
 * already catch. Accidental rather than designed, but worth stating since a
 * caller relies on it.
 */
export function instantForLocal(timeZone: string, day: PuzzleDay, time: LocalTime): number {
  const wanted = utcOf(day, time)

  let guess = wanted
  for (let round = 0; round < 4; round++) {
    const back = localParts(timeZone, new Date(guess))
    const drift = wanted - utcOf(back.day, back.time)
    if (drift === 0) return guess
    guess += drift
  }
  return guess
}

/**
 * The next instant at which it is `reminderTime` in `timeZone`, strictly after
 * `from`, skipping Saturday and Sunday unless the player plays weekends.
 *
 * RECOMPUTED FROM SCRATCH EVERY TIME IT IS SCHEDULED. Never derived by adding
 * 24 hours to the last one: that drifts by an hour across every DST transition
 * and the drift accumulates. The tests assert the GAP rather than only the
 * result — 23h across a spring-forward, 25h across a fall-back, 30min for Lord
 * Howe, 72h across a skipped weekend — because the gap is the only thing that
 * distinguishes this from `+24h` on an ordinary day.
 *
 * STRICTLY AFTER `from` IS LOAD-BEARING. The delivery job calls this with
 * `Date.now()` at the exact instant it was itself due, so a non-strict
 * comparison would return that same instant, fire immediately, and spin.
 *
 * THE WEEKEND RULE LIVES HERE rather than in the delivery job, and that is what
 * keeps the job's cost at one document. Asking "is this player on a team that
 * plays weekends" at delivery time means a `teams` scan PER PLAYER, because
 * Convex cannot index array membership — 171 rows times every active player due
 * on a Saturday, a cost that scales with active users and would be larger than
 * the sweep this whole change removes. `playsWeekends` is derived onto the
 * player row by `maintain` instead; see convex/reminders.ts.
 *
 * The ten-day loop bound cannot be reached: two consecutive skipped days is the
 * most the weekend rule can ask for. It exists so that a future rule that
 * skipped more could never hang a mutation.
 */
export function nextOccurrence(
  timeZone: string,
  reminderTime: LocalTime,
  from: number,
  playsWeekends: boolean,
): number {
  let day = localParts(timeZone, new Date(from)).day
  for (let i = 0; i < 10; i++) {
    if (playsWeekends || !isWeekendDay(day)) {
      const at = instantForLocal(timeZone, day, reminderTime)
      if (at > from) return at
    }
    day = addDays(day, 1)
  }
  throw new Error(`[reminders] no next occurrence for ${timeZone} at ${reminderTime}`)
}

/**
 * The oldest day that still counts as recent activity: v1's trailing ten days,
 * inclusive of the tenth.
 *
 * Extracted from the deleted `hasRecentActivity` so the rule survives the move
 * from "collect eleven days and inspect them" to "ask the index whether
 * anything exists at or after this day". The window is the part worth keeping
 * testable; the existence check is the index's job.
 */
export function activityFloor(localDay: PuzzleDay): PuzzleDay {
  return addDays(localDay, -10)
}

/**
 * The players who are on at least one weekend-playing team.
 *
 * Structurally typed rather than taking `Doc<'teams'>` so this stays pure and
 * testable with plain objects — the same reason every other rule in this file
 * takes primitives. Convex cannot index array membership (see schema.ts's note
 * on the `teams` table), so the caller collects the table; this is the rule it
 * applies to the result.
 */
export function weekendPlayerIdsFrom<Id extends string>(
  teams: ReadonlyArray<{ playWeekends: boolean; playerIds: ReadonlyArray<Id> }>,
): Set<Id> {
  const ids = new Set<Id>()
  for (const team of teams) {
    if (!team.playWeekends) continue
    for (const id of team.playerIds) ids.add(id)
  }
  return ids
}
