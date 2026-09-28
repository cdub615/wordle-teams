import { describe, expect, it } from 'vitest'
import { clockTime } from './clock-time.ts'

/**
 * THE ZONE AND THE LOCALE ARE PINNED IN EVERY CASE, AND THAT IS NOT DECORATION.
 * This repo has shipped a date test that killed its mutant on the author's
 * machine and passed under `TZ=UTC`, which is what CI runs. The mechanism is a
 * parameter rather than an env var or a mock: `clockTime` takes both, so every
 * assertion names what it is asserting in and the host can reach none of them.
 * The app passes neither and gets the reader's own zone and conventions, which
 * are the only ones a clock in their own app can honestly use.
 *
 * MOVED HERE FROM components/chat/use-chat-sync.test.ts WITH THE FUNCTION
 * (wordle-teams-8klr). settings/notifications-tab.tsx now formats the reminder
 * hour with it, and a settings component may not import out of the chat module.
 */
const utc = (iso: string) => Date.parse(iso)

describe('clockTime', () => {
  // The four locales the coordinator named, on one instant.
  it('asks the locale whether this is 2:05 PM or 14:05', () => {
    const instant = utc('2026-08-20T14:05:00Z')
    expect(clockTime(instant, 'UTC', 'en-US')).toBe('2:05 PM')
    expect(clockTime(instant, 'UTC', 'en-GB')).toBe('14:05')
    expect(clockTime(instant, 'UTC', 'de-DE')).toBe('14:05')
    expect(clockTime(instant, 'UTC', 'fr-FR')).toBe('14:05')
  })

  // ICU 72 changed the separator before AM/PM from U+0020 to U+202F, so without
  // the normalisation these bytes depend on which ICU the host was built
  // against — the locale trap's cousin, and it would split this suite between a
  // developer's Node and CI's.
  it('separates the day period with an ordinary space, whatever ICU emits', () => {
    const rendered = clockTime(utc('2026-08-20T14:05:00Z'), 'UTC', 'en-US')
    expect(rendered).toBe('2:05 PM')
    expect(rendered).not.toMatch(/[\u202f\u00a0]/)
  })

  it('reads the zone it is given, not the one the host is in', () => {
    const instant = utc('2026-08-20T02:30:00Z')
    expect(clockTime(instant, 'UTC', 'en-GB')).toBe('02:30')
    expect(clockTime(instant, 'America/New_York', 'en-GB')).toBe('22:30')
  })

  // MIDNIGHT IS THE CASE `{ hour: 'numeric' }` GETS WRONG, and the reason this
  // asks for `timeStyle: 'short'` instead: a 24-hour clock writes it `00:05`,
  // never `0:05`, and a 12-hour one writes `12:05 AM`, never `00:05 AM`.
  it('writes midnight the way each locale writes midnight', () => {
    const instant = utc('2026-08-20T00:05:00Z')
    expect(clockTime(instant, 'UTC', 'en-GB')).toBe('00:05')
    expect(clockTime(instant, 'UTC', 'en-US')).toBe('12:05 AM')
  })
})
