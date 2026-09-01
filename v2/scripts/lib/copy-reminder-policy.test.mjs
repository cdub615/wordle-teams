import { describe, expect, test } from 'vitest'
import { reminderFieldsFor } from './copy-reminder-policy.mjs'

// wt-ksh.7.32, as assertions rather than as a claim in a comment.
//
// THE DECISION THIS ENCODES: reminder settings arrive at CUTOVER, not before, so
// that a Phase 7 re-copy cannot switch reminders on for someone who does not
// know this beta exists and who already gets real reminders from v1.
//
// copy-from-supabase.mjs does its work at module scope against production and a
// live deployment, so it cannot be imported by a test. The decision that governs
// which of the five reminder fields cross therefore lives here, where it is
// pinned, exactly as copy-filters.mjs and verify-filters.mjs do for the row
// filters.
//
// The env kill switch (REMINDERS_ENABLED, unset on beta) protects regardless.
// That is not a reason to weaken this: wt-ksh.7.32 records that the switch is
// now the ONLY thing protecting rather than a second layer, and this restores
// the second layer.

/** A production player with reminders fully switched on — the case that matters. */
const enrolled = () => ({
  hasPwa: true,
  timeZone: 'America/Chicago',
  reminderDeliveryMethods: ['email', 'push'],
  reminderDeliveryTime: '18:00',
  lastBoardEntryReminder: 1756700000000,
})

describe('reminderFieldsFor, before cutover', () => {
  const held = () => reminderFieldsFor(enrolled(), { includeReminderSettings: false })

  // The acceptance criterion of wt-ksh.7.32, stated exactly: no player may be
  // left holding a non-empty reminderDeliveryMethods.
  test('reminderDeliveryMethods is emptied — this is what turns reminders on', () => {
    expect(held().reminderDeliveryMethods).toEqual([])
  })

  // AN EMPTY ARRAY, NOT AN ABSENT KEY, and the difference is the whole point on
  // a RE-RUN. upsertPlayers does ctx.db.patch(existing._id, doc), so a key the
  // shaped row omits leaves whatever an earlier copy already wrote sitting on
  // the beta row. Sending [] overwrites it. A copy that merely stops adding the
  // field does not undo the one that added it.
  test('sends an explicit empty array, so a re-run CLEARS what an earlier copy wrote', () => {
    const out = held()
    expect('reminderDeliveryMethods' in out).toBe(true)
    expect(Array.isArray(out.reminderDeliveryMethods)).toBe(true)
  })

  // The second half of eligibility: convex/reminders.ts skips anyone without a
  // timeZone, so withholding it is a second independent reason no copied player
  // can be swept up.
  test('timeZone is withheld entirely', () => {
    expect('timeZone' in held()).toBe(false)
  })

  // PROTECTIVE, AND THEREFORE KEPT. Copied forward, lastBoardEntryReminder
  // SUPPRESSES a same-day send. Dropping it with the rest would be the one
  // change that makes an unwanted reminder MORE likely, not less — which is the
  // trap in treating "reminder fields" as a single undifferentiated set.
  test('lastBoardEntryReminder still crosses, because it suppresses rather than enables', () => {
    expect(held().lastBoardEntryReminder).toBe(1756700000000)
  })

  // Inert without the two above, and both are display/config only. Withholding
  // them would create parity divergences that buy nothing.
  test('reminderDeliveryTime and hasPwa still cross, being inert on their own', () => {
    expect(held().reminderDeliveryTime).toBe('18:00')
    expect(held().hasPwa).toBe(true)
  })

  test('a player with reminders already off is unchanged by the policy', () => {
    const off = { hasPwa: false, reminderDeliveryMethods: [], reminderDeliveryTime: '09:00' }
    const out = reminderFieldsFor(off, { includeReminderSettings: false })
    expect(out.reminderDeliveryMethods).toEqual([])
    expect(out.hasPwa).toBe(false)
    expect(out.reminderDeliveryTime).toBe('09:00')
  })

  // The array is not shared with the caller's row, so a later mutation of one
  // cannot reach the other.
  test('does not hand back the production row own array', () => {
    const row = enrolled()
    expect(reminderFieldsFor(row, { includeReminderSettings: false }).reminderDeliveryMethods).not.toBe(
      row.reminderDeliveryMethods,
    )
  })
})

describe('reminderFieldsFor, at cutover', () => {
  // The other half, written down as wt-ksh.7.32 requires: the omission is
  // reversible by ONE flag, and the runbook flips it. If this ever stops
  // passing, the cutover step that restores reminders is broken.
  test('every one of the five crosses unchanged', () => {
    expect(reminderFieldsFor(enrolled(), { includeReminderSettings: true })).toEqual({
      hasPwa: true,
      timeZone: 'America/Chicago',
      reminderDeliveryMethods: ['email', 'push'],
      reminderDeliveryTime: '18:00',
      lastBoardEntryReminder: 1756700000000,
    })
  })

  test('an absent timeZone stays absent rather than becoming a key', () => {
    const out = reminderFieldsFor(
      { hasPwa: false, reminderDeliveryMethods: [], reminderDeliveryTime: '09:00' },
      { includeReminderSettings: true },
    )
    expect('timeZone' in out).toBe(false)
  })

  // How the caller ACTUALLY builds the row: `timeZone: opt(p.time_zone)`, which
  // is undefined for a player who never set one. That arrives as a key that is
  // present and undefined, and it must not be forwarded as a patch field — the
  // players it would affect are precisely the ones who never had a time zone.
  test('a timeZone key that is present but undefined is not forwarded', () => {
    const out = reminderFieldsFor(
      { hasPwa: false, timeZone: undefined, reminderDeliveryMethods: [], reminderDeliveryTime: '09:00' },
      { includeReminderSettings: true },
    )
    expect('timeZone' in out).toBe(false)
  })
})
