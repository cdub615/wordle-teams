import { describe, expect, test } from 'vitest'
import { REMINDER_TIMES } from '../../../convex/lib/reminders.ts'
import { label } from './notifications-tab.tsx'

describe('label', () => {
  test('05:00:00, the lower bound of REMINDER_TIMES, formats as 5 AM', () => {
    expect(label('05:00:00')).toBe('5 AM')
  })

  test('noon is 12 PM, not 0 PM', () => {
    expect(label('12:00:00')).toBe('12 PM')
  })

  test('an afternoon hour subtracts 12 and switches to PM', () => {
    expect(label('13:00:00')).toBe('1 PM')
  })

  test('22:00:00 is the latest offered time', () => {
    expect(label('22:00:00')).toBe('10 PM')
  })

  // Pins the display format against every value the UI can actually offer —
  // REMINDER_TIMES, not a hand-picked subset — so widening the picker in
  // lib/reminders.ts cannot silently produce a value this never checked.
  test('every offered reminder time formats without throwing', () => {
    for (const time of REMINDER_TIMES) {
      expect(() => label(time)).not.toThrow()
      expect(label(time)).toMatch(/^\d{1,2} (AM|PM)$/)
    }
  })

  // A value outside REMINDER_TIMES is reachable only from data older than
  // updateReminderTimeFor's validation (convex/settings.ts) — nothing this
  // UI writes can produce one. Sliced and rounded, '23:30:00' would print
  // '11 PM': a plausible, on-the-hour-looking string that is neither what is
  // stored nor a time convex/lib/reminders.ts's isDueThisHour can ever match.
  // The raw value, odd-looking as it is, is the honest answer.
  test('a time the picker never offers is shown raw, not rounded to a false hour', () => {
    expect(label('23:30:00')).toBe('23:30:00')
  })
})
