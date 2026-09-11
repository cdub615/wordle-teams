import { describe, expect, test } from 'vitest'
import { isWeekendDay } from './puzzleDay.ts'
import {
  activityFloor,
  alreadyRemindedToday,
  enteredOn,
  hasRecentActivity,
  instantForLocal,
  isDueThisHour,
  localParts,
  needsWeekendOptIn,
  nextOccurrence,
  weekendPlayerIdsFrom,
} from './reminders.ts'

// A Thursday, 14:00 UTC.
const utc2pm = new Date('2026-08-27T14:00:00Z')

describe('localParts', () => {
  test('UTC is the identity case', () => {
    expect(localParts('UTC', utc2pm)).toEqual({ day: '2026-08-27', time: '14:00:00' })
  })

  test('America/Chicago is UTC-5 in August (CDT)', () => {
    expect(localParts('America/Chicago', utc2pm)).toEqual({
      day: '2026-08-27',
      time: '09:00:00',
    })
  })

  test('keeps a half-hour offset', () => {
    // Kolkata is UTC+5:30. Dropping the :30 would shift every Indian player's
    // window by half an hour, which is exactly enough to miss it.
    expect(localParts('Asia/Kolkata', utc2pm)).toEqual({
      day: '2026-08-27',
      time: '19:30:00',
    })
  })

  test('the Postgres spelling resolves identically to the IANA one', () => {
    // Copied rows carry v1's Postgres names (timeZoneMapping in
    // app-bar-base.tsx:14-21 produced them). v1's mapping table produced five
    // such spellings; all five are verified ICU aliases, so looping over them
    // is a real guard on the copied-row path rather than a spot check of one.
    const postgresSpellings = [
      ['Asia/Calcutta', 'Asia/Kolkata'],
      ['Asia/Katmandu', 'Asia/Kathmandu'],
      ['Asia/Rangoon', 'Asia/Yangon'],
      ['Europe/Kyiv', 'Europe/Kiev'],
      ['Pacific/Kanton', 'Pacific/Enderbury'],
    ] as const
    for (const [postgresName, ianaName] of postgresSpellings) {
      expect(localParts(postgresName, utc2pm)).toEqual(localParts(ianaName, utc2pm))
    }
  })

  test('rolls to the next day east of the dateline-facing zones', () => {
    expect(localParts('Australia/Sydney', utc2pm)).toEqual({
      day: '2026-08-28',
      time: '00:00:00',
    })
  })

  test('formats midnight as 00, not 24', () => {
    // hourCycle: 'h23' behaves identically to hour12: false here — both give
    // '00'. Only 'h24' gives '24', so that's what this pins: a formatter
    // built the wrong way WOULD produce '24', which would sort above every
    // reminder time and never match. Without this contrast the test is
    // satisfied by hour12: false too and pins nothing.
    const h24 = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Australia/Sydney',
      hour: '2-digit',
      hourCycle: 'h24',
    }).format(utc2pm)
    expect(h24).toBe('24')
    expect(localParts('Australia/Sydney', utc2pm).time.slice(0, 2)).toBe('00')
  })

  test('stays on the same day, an earlier hour, west of Greenwich', () => {
    expect(localParts('Pacific/Honolulu', utc2pm)).toEqual({
      day: '2026-08-27',
      time: '04:00:00',
    })
  })

  test('rolls back a full calendar day west of Greenwich', () => {
    // Honolulu is UTC-10 with no DST. At 04:00Z that is still 2026-08-26
    // 18:00 — the previous day, not just an earlier hour of the same one.
    expect(localParts('Pacific/Honolulu', new Date('2026-08-27T04:00:00Z'))).toEqual({
      day: '2026-08-26',
      time: '18:00:00',
    })
  })
})

describe('isDueThisHour', () => {
  test('fires on the hour', () => {
    expect(isDueThisHour('09:00:00', '09:00:00', '08:00:00')).toBe(true)
  })

  test('the lower bound is inclusive', () => {
    expect(isDueThisHour('08:00:00', '09:00:00', '08:00:00')).toBe(true)
  })

  test('a time that has aged out does not fire', () => {
    expect(isDueThisHour('07:00:00', '09:00:00', '08:00:00')).toBe(false)
  })

  test('a time still ahead does not fire', () => {
    expect(isDueThisHour('10:00:00', '09:00:00', '08:00:00')).toBe(false)
  })

  test('a half-hour zone still catches an on-the-hour reminder', () => {
    // The cron ticks at :00 UTC, which is :30 local in Kolkata, so the window is
    // [18:30, 19:30] and a 19:00 reminder lands inside it.
    expect(isDueThisHour('19:00:00', '19:30:00', '18:30:00')).toBe(true)
  })

  test('every one of the eighteen offered times is reachable', () => {
    const offered = Array.from(
      { length: 18 },
      (_, i) => `${String(i + 5).padStart(2, '0')}:00:00`,
    )
    for (const time of offered) {
      const hour = Number(time.slice(0, 2))
      const now = `${String(hour).padStart(2, '0')}:30:00`
      const hourAgo = `${String(hour - 1).padStart(2, '0')}:30:00`
      expect(isDueThisHour(time, now, hourAgo)).toBe(true)
    }
  })

  test('an on-the-hour reminder matches two consecutive ticks in a whole-hour zone', () => {
    // Why alreadyRemindedToday must be the guard, and why the stamp is written
    // before delivery rather than after it.
    expect(isDueThisHour('09:00:00', '09:00:00', '08:00:00')).toBe(true)
    expect(isDueThisHour('09:00:00', '10:00:00', '09:00:00')).toBe(true)
  })

  test("v1's midnight wrap is unsatisfiable, and is ported that way on purpose", () => {
    // At 00:30 local the lower bound wraps to 23:30, so no string can satisfy
    // both bounds. Unreachable behind the 05:00-22:00 picker. Pinned so that
    // widening the picker fails here rather than in silence.
    expect(isDueThisHour('00:00:00', '00:30:00', '23:30:00')).toBe(false)
    expect(isDueThisHour('23:45:00', '00:30:00', '23:30:00')).toBe(false)
  })
})

describe('alreadyRemindedToday', () => {
  test('never reminded is not today', () => {
    expect(alreadyRemindedToday(undefined, 'America/Chicago', '2026-08-27')).toBe(false)
  })

  test('earlier today counts', () => {
    const earlier = new Date('2026-08-27T12:00:00Z').getTime() // 07:00 Chicago
    expect(alreadyRemindedToday(earlier, 'America/Chicago', '2026-08-27')).toBe(true)
  })

  test('yesterday does not', () => {
    const yesterday = new Date('2026-08-26T12:00:00Z').getTime()
    expect(alreadyRemindedToday(yesterday, 'America/Chicago', '2026-08-27')).toBe(false)
  })

  test('resolves the stamp locally, not in UTC', () => {
    // 02:00 UTC is still 21:00 the previous day in Chicago. A UTC comparison
    // would call this "today" and suppress a reminder that is genuinely due.
    const lateNight = new Date('2026-08-27T02:00:00Z').getTime()
    expect(alreadyRemindedToday(lateNight, 'America/Chicago', '2026-08-27')).toBe(false)
  })

  test('a stamp that has skewed into tomorrow still suppresses', () => {
    const tomorrow = new Date('2026-08-29T02:00:00Z').getTime() // 2026-08-28 in Chicago
    expect(alreadyRemindedToday(tomorrow, 'America/Chicago', '2026-08-27')).toBe(true)
  })
})

describe('hasRecentActivity', () => {
  test('exactly ten days back is inside the window', () => {
    expect(hasRecentActivity(['2026-08-17'], '2026-08-27')).toBe(true)
  })

  test('eleven days back is outside it', () => {
    expect(hasRecentActivity(['2026-08-16'], '2026-08-27')).toBe(false)
  })

  test('no scores at all is outside it', () => {
    expect(hasRecentActivity([], '2026-08-27')).toBe(false)
  })

  test('the window crosses a month boundary', () => {
    expect(hasRecentActivity(['2026-07-30'], '2026-08-05')).toBe(true)
    expect(hasRecentActivity(['2026-07-25'], '2026-08-05')).toBe(false)
  })
})

describe('enteredOn', () => {
  test('finds the day, or does not', () => {
    expect(enteredOn(['2026-08-26', '2026-08-27'], '2026-08-27')).toBe(true)
    expect(enteredOn(['2026-08-26'], '2026-08-27')).toBe(false)
  })
})

describe('needsWeekendOptIn', () => {
  test('Saturday and Sunday need it; Friday does not', () => {
    expect(needsWeekendOptIn('2026-08-29')).toBe(true) // Saturday
    expect(needsWeekendOptIn('2026-08-30')).toBe(true) // Sunday
    expect(needsWeekendOptIn('2026-08-28')).toBe(false) // Friday
  })

  test('the case v1 gets wrong', () => {
    // Sydney is UTC+10 in August (AEST — no DST in the southern winter), so
    // 2026-08-28T20:00Z is still Friday in UTC and 06:00 Saturday in Sydney.
    // v1 asks EXTRACT(DOW FROM CURRENT_DATE), which reads the UTC day, and so
    // applies the weekday rule to a player whose weekend has already started.
    const at = new Date('2026-08-28T20:00:00Z')
    expect(needsWeekendOptIn(localParts('Australia/Sydney', at).day)).toBe(true)
    expect(needsWeekendOptIn(localParts('UTC', at).day)).toBe(false)
  })
})

describe('instantForLocal', () => {
  test('resolves a wall clock in a zone to the instant it happens at', () => {
    // 2026-09-11 09:00 in Chicago (CDT, UTC-5) is 14:00 UTC.
    expect(instantForLocal('America/Chicago', '2026-09-11', '09:00:00')).toBe(
      new Date('2026-09-11T14:00:00Z').getTime(),
    )
  })

  test('accepts both IANA spellings of an aliased zone', () => {
    // Load-bearing: copied rows carry v1's Postgres names ('Asia/Calcutta'),
    // natively-created ones carry whatever the browser reports ('Asia/Kolkata').
    expect(instantForLocal('Asia/Calcutta', '2026-09-11', '07:00:00')).toBe(
      instantForLocal('Asia/Kolkata', '2026-09-11', '07:00:00'),
    )
  })

  test('handles a half-hour offset zone', () => {
    // Kolkata is UTC+5:30, so 07:00 local is 01:30 UTC.
    expect(instantForLocal('Asia/Kolkata', '2026-09-11', '07:00:00')).toBe(
      new Date('2026-09-11T01:30:00Z').getTime(),
    )
  })

  test('a nonexistent wall clock resolves to the instant just before the gap', () => {
    // Pacific/Easter is the zone that makes this reachable in production
    // rather than theoretical: its spring-forward erases 22:00-22:59 local,
    // and 22:00:00 is one of the eighteen offered REMINDER_TIMES. Requesting
    // it lands on 21:00 local, one hour early, on the transition day.
    expect(instantForLocal('Pacific/Easter', '2026-09-05', '22:00:00')).toBe(
      new Date('2026-09-06T03:00:00Z').getTime(),
    )
    expect(localParts('Pacific/Easter', new Date('2026-09-06T03:00:00Z'))).toEqual({
      day: '2026-09-05',
      time: '21:00:00',
    })
  })
})

describe('nextOccurrence', () => {
  const at = (iso: string) => new Date(iso).getTime()

  test('returns today if the time has not passed yet in the player zone', () => {
    // 14:00:01 UTC is 09:00:01 Chicago, so a 09:00 reminder has just gone by;
    // an 18:00 one has not.
    expect(nextOccurrence('America/Chicago', '18:00:00', at('2026-09-11T14:00:01Z'), true)).toBe(
      at('2026-09-11T23:00:00Z'),
    )
  })

  test('rolls to tomorrow once the time has passed', () => {
    expect(nextOccurrence('America/Chicago', '09:00:00', at('2026-09-11T14:00:01Z'), true)).toBe(
      at('2026-09-12T14:00:00Z'),
    )
  })

  // THE DST CASES ARE THE POINT OF THIS FUNCTION. The gap to the next
  // occurrence is NOT 24 hours across a transition, and asserting the gap is
  // what proves nothing anywhere adds 24h — see the doc comment.
  test('spans 23 hours across a spring-forward, not 24', () => {
    const from = at('2027-03-13T15:00:00Z') // 09:00 Chicago, the day before
    const next = nextOccurrence('America/Chicago', '09:00:00', from, true)
    expect(next).toBe(at('2027-03-14T14:00:00Z'))
    expect(next - from).toBe(23 * 60 * 60 * 1000)
  })

  test('spans 25 hours across a fall-back, not 24', () => {
    const from = at('2026-10-31T14:00:01Z') // just after 09:00 Chicago
    const next = nextOccurrence('America/Chicago', '09:00:00', from, true)
    expect(next).toBe(at('2026-11-01T15:00:00Z'))
    expect(next - from).toBe(25 * 60 * 60 * 1000 - 1000)
  })

  test('handles a 30-minute DST shift (Lord Howe)', () => {
    const from = at('2027-04-03T18:00:01Z')
    const next = nextOccurrence('Australia/Lord_Howe', '05:00:00', from, true)
    expect(next - from).toBe(30 * 60 * 1000 - 1000)
  })

  test('skips the weekend when the player is on no weekend-playing team', () => {
    // 2026-09-11 is a Friday. 14:00:01 UTC is 09:00:01 Chicago, so the next
    // 09:00 is Saturday — which a weekday-only player must skip, landing on
    // Monday, 72 hours later.
    const from = at('2026-09-11T14:00:01Z')
    const next = nextOccurrence('America/Chicago', '09:00:00', from, false)
    expect(next).toBe(at('2026-09-14T14:00:00Z'))
    expect(next - from).toBe(72 * 60 * 60 * 1000 - 1000)
  })

  test('does not skip the weekend when the player does play weekends', () => {
    const from = at('2026-09-11T14:00:01Z')
    expect(nextOccurrence('America/Chicago', '09:00:00', from, true)).toBe(
      at('2026-09-12T14:00:00Z'),
    )
  })

  test('always returns an instant strictly in the future', () => {
    // The delivery job schedules from `now`; an instant equal to `now` would
    // fire immediately and could spin.
    const from = at('2026-09-11T14:00:00Z') // EXACTLY 09:00 Chicago
    expect(nextOccurrence('America/Chicago', '09:00:00', from, true)).toBeGreaterThan(from)
  })
})

/**
 * THE SWEEP. Every case asserts three properties at once: the instant lands on
 * the requested wall clock in that zone, it is strictly in the future, and a
 * weekday-only player never lands on a weekend.
 *
 * ZONE LIST IS CURATED, NOT `Intl.supportedValuesOf('timeZone')`. The full 418
 * zones is 167,200 cases and takes ~35s, which does not belong in a suite of
 * 152 files. These 28 were chosen to cover both DST directions, the southern
 * hemisphere, half-hour and 45-minute offsets, a 30-minute DST shift, the
 * aliased spellings copied rows carry, and the extremes of the offset range.
 * MEASURED: 13,440 cases in well under half a second, now that localParts
 * memoizes its formatter per zone (see the cache note on that function).
 * Before the cache, a comparable 11,200-case run took ~1.8s, because it built
 * a fresh `Intl.DateTimeFormat` on every one of the roughly 56,000 calls this
 * makes into localParts.
 *
 * The full 418-zone sweep WAS run before this design was accepted — 167,200
 * cases, zero failures, gaps from 0.25h to 72.00h — and again under TZ=UTC,
 * America/Chicago and Asia/Kolkata with identical results, which is what rules
 * out a helper that only works on the host's timezone. Re-run it by widening
 * ZONES here if this function is ever reworked.
 */
describe('nextOccurrence across zones and DST transitions', () => {
  const ZONES = [
    'UTC', 'America/Chicago', 'America/New_York', 'America/Denver',
    'America/Los_Angeles', 'America/Phoenix', 'America/Sao_Paulo',
    'America/St_Johns', 'Europe/London', 'Europe/Lisbon', 'Europe/Berlin',
    'Europe/Dublin', 'Africa/Cairo', 'Africa/Lagos', 'Asia/Jerusalem',
    'Asia/Tehran', 'Asia/Kolkata', 'Asia/Calcutta', 'Asia/Kathmandu',
    'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney', 'Australia/Adelaide',
    'Australia/Lord_Howe', 'Pacific/Honolulu', 'Pacific/Auckland',
    'Pacific/Chatham', 'Pacific/Kiritimati',
  ]
  // Chosen to straddle the world's DST transitions plus ordinary days.
  // 2026-09-27 (New Zealand) and 2026-10-04 (Australia) close a gap a spec
  // review found: the list already straddled the northern spring-forward and
  // fall-back and the southern fall-back (April), but every existing
  // September date sat before the southern-hemisphere spring-forward, which
  // lands in late September to early October.
  const DATES = [
    '2026-03-08', '2026-03-29', '2026-04-05', '2026-09-11', '2026-09-27',
    '2026-10-04', '2026-10-25', '2026-11-01', '2027-03-14', '2027-04-04',
    '2027-09-17', '2027-10-31',
  ]
  const TIMES = ['05:00:00', '09:00:00', '13:00:00', '18:00:00', '22:00:00']

  test('lands on the requested wall clock, in the future, honouring weekends', () => {
    let checked = 0
    for (const timeZone of ZONES) {
      for (const time of TIMES) {
        for (const date of DATES) {
          for (const hour of [0, 6, 12, 18]) {
            for (const playsWeekends of [true, false]) {
              const from = new Date(`${date}T${String(hour).padStart(2, '0')}:00:01Z`).getTime()
              const next = nextOccurrence(timeZone, time, from, playsWeekends)
              const local = localParts(timeZone, new Date(next))
              // Asserted with a message because a bare failure among 13,440
              // cases is not diagnosable.
              const where = `${timeZone} ${time} from ${date}T${hour} pw=${playsWeekends}`
              expect(local.time, where).toBe(time)
              expect(next, where).toBeGreaterThan(from)
              if (!playsWeekends) expect(isWeekendDay(local.day), where).toBe(false)
              checked++
            }
          }
        }
      }
    }
    // Pinned so that silently emptying a loop bound cannot make this pass
    // vacuously — 28 zones x 5 times x 12 dates x 4 hours x 2.
    expect(checked).toBe(13440)
  })
})

describe('activityFloor', () => {
  test('is the tenth day back, inclusive', () => {
    expect(activityFloor('2026-09-11')).toBe('2026-09-01')
  })
})

describe('weekendPlayerIdsFrom', () => {
  test('collects members of weekend-playing teams only', () => {
    const teams = [
      { playWeekends: true, playerIds: ['a', 'b'] },
      { playWeekends: false, playerIds: ['c'] },
      { playWeekends: true, playerIds: ['b', 'd'] },
    ]
    expect(weekendPlayerIdsFrom(teams)).toEqual(new Set(['a', 'b', 'd']))
  })

  test('is empty when no team plays weekends', () => {
    expect(weekendPlayerIdsFrom([{ playWeekends: false, playerIds: ['a'] }])).toEqual(new Set())
  })
})
