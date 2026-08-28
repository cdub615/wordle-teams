import { describe, expect, test } from 'vitest'
import {
  alreadyRemindedToday,
  enteredOn,
  hasRecentActivity,
  isDueThisHour,
  localParts,
  needsWeekendOptIn,
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
