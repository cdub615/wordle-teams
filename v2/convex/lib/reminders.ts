/**
 * Eligibility arithmetic for the daily board-entry reminder.
 *
 * Pure by construction — no Convex, no I/O, no env, no clock. `deliver` and
 * `maintain` (convex/reminders.ts) each read the clock once and pass instants
 * — or strings already resolved from them — in, which is what makes every rule
 * here directly testable, including the ones that only misbehave in a
 * particular timezone at a particular hour. The one piece of module state,
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
 * THE ONE v1 BUG THIS FILE USED TO PORT UNCHANGED IS GONE WITH ITS FUNCTION.
 * That was `isDueThisHour`'s midnight window, deleted along with the hourly
 * sweep that was its only caller. What the window cost, and why the picker's
 * eighteen times are still required server-side, is recorded on REMINDER_TIMES
 * below.
 */
import { addDays, isWeekendDay, type PuzzleDay } from './puzzleDay.ts'

/** A wall-clock time of day, 'HH:MM:SS', in some player's zone. */
export type LocalTime = string

/**
 * The reminder times the app offers, and the ONLY ones the server accepts.
 *
 * MEMBERSHIP IS ENFORCED SERVER-SIDE, AND THE REASON OUTLIVED THE FUNCTION THAT
 * MOTIVATED IT. v1's picker offered exactly these eighteen
 * (board-entry-reminders.tsx:86-103) and nothing checked them; a shape-only
 * check accepts '23:30:00'. Under the old hourly sweep that value could never
 * match for a player in a whole-hour-offset zone — see the measurement below,
 * which is narrower than the claim the deleted function made — and that player
 * was silently never reminded. Per-player scheduling would now honour
 * '23:30:00' perfectly well, so the hazard is no longer "never matches" but
 * "the UI offers eighteen options and the server would accept any string",
 * which is a validation gap either way. settings.ts's updateReminderTimeFor is
 * where it is closed.
 *
 * TWO THINGS STILL REST ON THIS GUARD, neither of which needs the deleted
 * function. `warnIfWallClockDrifted` (convex/reminders.ts) resolves each
 * scheduled instant back into the player's zone and compares it against the
 * stored `reminderDeliveryTime`, so an unpadded or off-grid value — '9:00:00' —
 * would schedule correctly and still warn; that function's "ONE SHAPE OF FALSE
 * POSITIVE" paragraph names this check as the thing that keeps a warning from
 * it trustworthy. And refusing any value outside the eighteen still rules out
 * the v1 midnight-wrap class of bug by construction.
 *
 * WIDENING THIS LIST IS NOW SAFE IN A WAY IT WAS NOT BEFORE, and that is worth
 * recording: nextOccurrence resolves any wall-clock time in any zone, including
 * ones that are ambiguous or nonexistent across a DST transition — it takes the
 * first of the two occurrences, and the instant just BEFORE the gap,
 * respectively. (NOT after the gap. That version of the sentence has now been
 * written twice and measured wrong twice; instantForLocal's own doc comment
 * carries the measurement, `America/Chicago` 2026-03-08 02:30 resolving to
 * 01:30 local.)
 *
 * THE OLD isDueThisHour COULD NOT, AND WHAT IT LOST WAS ONE HOUR-WIDE BAND
 * STRADDLING LOCAL MIDNIGHT — the same width in every zone. MEASURED over all
 * 1440 minute-of-day values against all 24 ticks, for each offset shape: the
 * cron fired at UTC :00 and both bounds were resolved in the player's zone, so
 * the window's minutes were that zone's own offset minutes, and the one window
 * spanning local midnight had its lower bound sorting ABOVE its upper as a
 * string. The band lost is (23:MM, 24:00) union [00:00, 00:MM) where MM is the
 * offset's minutes — exactly 59 values every time:
 *
 *     +00   23:01..23:59
 *     +30   23:31..23:59  and  00:00..00:29
 *     +45   23:46..23:59  and  00:00..00:44
 *
 * So '23:30:00' was unmatchable at +00 and fine at +30 — but '23:45:00' is lost
 * at +30 too, and a reader widening this list must check the band rather than
 * the example. TWO EARLIER VERSIONS GOT THIS WRONG IN OPPOSITE DIRECTIONS: the
 * deleted function's own comment stated the +00 case as universal, and the
 * first draft of this paragraph said a half-hour zone lost [00:00, 00:30)
 * "instead", omitting the 23:31..23:59 half and implying 23:45 was safe there.
 * The uniform rule above is both simpler and correct.
 *
 * THESE ARE NOT HYPOTHETICAL OFFSETS. Three of the five Postgres spellings
 * v1's own timeZoneMapping produced, and which lib/reminders.test.ts pins as
 * ICU aliases on the copied-row path, are non-whole-hour: Asia/Calcutta
 * (+05:30), Asia/Rangoon (+06:30) and Asia/Katmandu (+05:45) — offsets read
 * back from Intl here, not recalled. So both shapes above were reachable from
 * v1's picker. (How many production players sat in one is not something this
 * session measured; the table holds 57 distinct zones.) That function is gone;
 * the guard is what keeps the whole class out by construction.
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
 * from here — same reason REMINDER_TIMES does: `deliver` (convex/reminders.ts)
 * needs the same list to decide who gets claimed and which literal to
 * `.includes()` against, and a second copy in each module risks the exact
 * shape of drift REMINDER_TIMES's own doc comment above warns about — a
 * value that stores fine and looks right in the UI but silently never
 * matches on the other side — just for methods instead of times.
 */
export const METHODS = ['email', 'push'] as const

/**
 * Whether a player's stored methods contain at least one method that exists.
 *
 * NOT THE SAME QUESTION AS "which methods do they want". `schema.ts` types
 * `reminderDeliveryMethods` as an unvalidated `v.array(v.string())`, and a row
 * copied from Supabase never passed through the settings validator, so it can
 * carry a string like 'sms' that no delivery branch will ever match. A player
 * whose ONLY method is unknown must be treated as having no delivery method at
 * all rather than being claimed and then silently not mailed.
 *
 * Lifted out of `sweep` and `deliver` (convex/reminders.ts), which had the same
 * `.some(...)` expression written twice — the duplication the plan's
 * comment-discipline rule warns travels between copies. `sweep` has since been
 * deleted; `deliver` is the one caller left, and the rule outlived the move
 * because it was extracted before the deletion rather than during it.
 */
export function hasKnownMethod(methods: ReadonlyArray<string>): boolean {
  return methods.some((method) => (METHODS as ReadonlyArray<string>).includes(method))
}

/**
 * Parse REMINDERS_ALLOWLIST into a comparable set of addresses.
 *
 * TRIMMED AND LOWERCASED, and both halves are load-bearing rather than
 * defensive. An operator editing this variable in a dashboard field types
 * ', ' between addresses and may capitalise their own; `players.email` is
 * always stored lowercase, so comparing raw would silently match nobody. The
 * failure mode of getting this wrong is not an error — it is every reminder
 * quietly not being sent, which is exactly what the variable looks like when
 * it is working.
 *
 * EMPTY ENTRIES ARE DROPPED so that a trailing comma, or the empty string
 * itself, yields an EMPTY set rather than a set containing ''. That is what
 * makes `allowsAddress` below read "empty means unrestricted" correctly; a set
 * holding one empty string would restrict delivery to nobody.
 *
 * Takes the raw value rather than reading `process.env` itself, because this
 * module is pure by construction — see the header.
 */
export function allowlistFrom(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((address) => address.trim().toLowerCase())
      .filter((address) => address.length > 0),
  )
}

/**
 * Whether the allowlist permits delivery to this address.
 *
 * AN EMPTY ALLOWLIST IS UNRESTRICTED, which is what production wants at
 * cutover; a populated one restricts delivery to exactly its members, which is
 * what beta wants while it holds copied production rows. Expressed here rather
 * than as `size > 0 && !has(...)` at each call site so the two callers cannot
 * drift on which way round the empty case reads.
 */
export function allowsAddress(allowlist: ReadonlySet<string>, email: string): boolean {
  return allowlist.size === 0 || allowlist.has(email)
}

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
 * at the moment of asking, which is the same reason the deleted hourly sweep
 * was DST-safe — it resolved every bound in the player's zone on every run
 * rather than caching an offset.
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
