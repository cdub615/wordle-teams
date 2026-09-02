import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer } from './fixtures.ts'
import {
  mySettingsFor,
  setReminderMethodFor,
  updateReminderMethodsFor,
  updateReminderTimeFor,
  updateTimeZoneFor,
  markPwaInstalledFor,
} from './settings.ts'

const modules = import.meta.glob('./**/*.ts')

describe('updateReminderMethodsFor', () => {
  test('accepts email and push, in any combination', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))

    for (const methods of [[], ['email'], ['push'], ['email', 'push']]) {
      await t.run(async (ctx) => updateReminderMethodsFor(ctx, playerId, methods))
      const player = await t.run(async (ctx) => ctx.db.get(playerId))
      expect(player!.reminderDeliveryMethods).toEqual(methods)
    }
  })

  test('rejects anything else', async () => {
    // The schema cannot express this: reminderDeliveryMethods is
    // v.array(v.string()) because narrowing it would be validated against every
    // COPIED row on push, and schema.ts:44-66 records what that cost when
    // firstName was narrowed. So the constraint lives here, and this is the
    // test that it exists.
    //
    // 'Email' pins case-sensitivity specifically: it is rejected today only
    // because nothing lowercases the input before comparing against METHODS,
    // and a mutant that added a `.toLowerCase()` survived until this case was
    // added.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    for (const bad of ['sms', 'Email']) {
      await expect(
        t.run(async (ctx) => updateReminderMethodsFor(ctx, playerId, [bad])),
      ).rejects.toThrow()
    }
  })

  test('rejects duplicates', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await expect(
      t.run(async (ctx) => updateReminderMethodsFor(ctx, playerId, ['email', 'email'])),
    ).rejects.toThrow()
  })
})

describe('updateReminderTimeFor', () => {
  test('accepts each of the eighteen offered times', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    for (let hour = 5; hour <= 22; hour += 1) {
      const time = `${String(hour).padStart(2, '0')}:00:00`
      await t.run(async (ctx) => updateReminderTimeFor(ctx, playerId, time))
      const player = await t.run(async (ctx) => ctx.db.get(playerId))
      expect(player!.reminderDeliveryTime).toBe(time)
    }
  })

  test('rejects a malformed time', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    for (const bad of ['9am', '25:00:00', '09:00', '', '09:00:00 ']) {
      await expect(
        t.run(async (ctx) => updateReminderTimeFor(ctx, playerId, bad)),
      ).rejects.toThrow()
    }
  })

  test('rejects a well-formed time the picker does not offer', async () => {
    // The gap a shape-only check misses: '23:30:00' is a perfectly valid
    // 'HH:MM:SS' string, but lib/reminders.ts's isDueThisHour can only ever
    // match an on-the-hour value, because the cron ticks on the hour. A
    // shape-only validator would have stored this and silently never reminded
    // that player again. '04:00:00' pins the other boundary — one hour before
    // the earliest offered time, 05:00:00.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    for (const bad of ['23:30:00', '24:00:00', '23:60:00', '04:00:00']) {
      await expect(
        t.run(async (ctx) => updateReminderTimeFor(ctx, playerId, bad)),
      ).rejects.toThrow()
    }
  })
})

describe('updateTimeZoneFor', () => {
  test('stores a zone Intl can resolve', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => updateTimeZoneFor(ctx, playerId, 'America/Chicago'))
    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.timeZone).toBe('America/Chicago')
  })

  test('rejects a zone Intl cannot resolve', async () => {
    // An unresolvable zone would throw inside the reminder sweep, at 06:00 on
    // some future morning, taking the whole batch down with it. Refuse it at
    // the door. See the PRECONDITION note on localParts in lib/reminders.ts.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    for (const bad of ['Mars/Olympus_Mons', '', 'GMT+5', '  UTC ']) {
      await expect(
        t.run(async (ctx) => updateTimeZoneFor(ctx, playerId, bad)),
      ).rejects.toThrow()
    }
  })
})

describe('markPwaInstalledFor', () => {
  // NOT "and is idempotent": the helper unconditionally patches hasPwa: true,
  // with no branch on the prior value, so a second call cannot be observably
  // different from the first under any mutant this suite plants. Asserting it
  // would be a claim this test cannot actually falsify. What IS real, and
  // documented on the helper itself, is that hasPwa is SET-ONLY — nothing ever
  // clears it, so a player who later uninstalls the PWA keeps it true.
  test('sets hasPwa to true', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', aPlayer({ hasPwa: false })),
    )
    await t.run(async (ctx) => markPwaInstalledFor(ctx, playerId))
    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.hasPwa).toBe(true)
  })
})

describe('mySettingsFor', () => {
  test('reads back all four fields, and null for an unset timeZone', async () => {
    // toEqual, not toMatchObject: an extra field on the wire is exactly the kind
    // of thing the wrapper-vs-helper split in this file exists to catch, and a
    // partial match would let one slip through unnoticed.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert(
        'players',
        aPlayer({ hasPwa: true, reminderDeliveryMethods: ['push'], reminderDeliveryTime: '09:00:00' }),
      ),
    )
    const settings = await t.run(async (ctx) => mySettingsFor(ctx, playerId))
    expect(settings).toEqual({
      timeZone: null,
      reminderDeliveryTime: '09:00:00',
      reminderDeliveryMethods: ['push'],
      hasPwa: true,
    })
  })

  test('reads back a stored timeZone verbatim, never a default', async () => {
    // Pins against a mutant that defaults an absent/odd timeZone to 'UTC'
    // instead of null — a silent wrong-zone guess is worse than an honest null,
    // because the reminder sweep would schedule against it as if the player
    // had actually said so.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', aPlayer({ timeZone: 'America/Chicago' })),
    )
    const settings = await t.run(async (ctx) => mySettingsFor(ctx, playerId))
    expect(settings.timeZone).toBe('America/Chicago')
  })
})

describe('setReminderMethodFor', () => {
  // wordle-teams-069. The client used to compute the whole array from the row
  // it had rendered with and send that, so a write issued after a slow browser
  // flow carried a stale view of the OTHER method. The push permission prompt
  // is MODAL and can stay open for minutes, which is the window.
  //
  // These tests exercise the fix at the level the bug lives at: the read and
  // the write are in ONE transaction, so what is stored is composed from the
  // current row rather than from whatever the client last saw.

  // STARTING STATE IS ALWAYS EXPLICIT. aPlayer() defaults to ['email'], and a
  // first draft of these tests leaned on that without saying so — which made
  // 'adds a method' pass while its email half was a no-op against a value that
  // was already there.
  const player = async (methods: Array<string> = []) => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', aPlayer({ reminderDeliveryMethods: methods })),
    )
    return {
      t,
      playerId,
      methods: async () =>
        (await t.run(async (ctx) => ctx.db.get(playerId)))!.reminderDeliveryMethods,
    }
  }

  test('adds a method without disturbing the other one', async () => {
    const { t, playerId, methods } = await player()
    await t.run(async (ctx) => setReminderMethodFor(ctx, playerId, 'email', true))
    await t.run(async (ctx) => setReminderMethodFor(ctx, playerId, 'push', true))
    expect(await methods()).toEqual(['email', 'push'])
  })

  test('removes a method without disturbing the other one', async () => {
    const { t, playerId, methods } = await player(['email', 'push'])
    await t.run(async (ctx) => setReminderMethodFor(ctx, playerId, 'push', false))
    expect(await methods()).toEqual(['email'])
  })

  // THE LOST UPDATE THIS EXISTS TO PREVENT, written as the sequence that used to
  // produce it: the client renders with ['email'], the player turns Email OFF in
  // another tab, and only THEN does the slow push flow complete. The old code
  // sent `[...currentMethods, 'push']` built from the stale render and put
  // 'email' back. Composing from the row cannot.
  test('a write issued against a stale view does not resurrect a removed method', async () => {
    const { t, playerId, methods } = await player(['email'])

    // The other tab wins the race.
    await t.run(async (ctx) => setReminderMethodFor(ctx, playerId, 'email', false))
    // The slow flow finally lands, knowing only that PUSH should go on.
    await t.run(async (ctx) => setReminderMethodFor(ctx, playerId, 'push', true))

    expect(await methods()).toEqual(['push'])
  })

  test('enabling twice is idempotent rather than a duplicate', async () => {
    const { t, playerId, methods } = await player()
    await t.run(async (ctx) => setReminderMethodFor(ctx, playerId, 'email', true))
    await t.run(async (ctx) => setReminderMethodFor(ctx, playerId, 'email', true))
    expect(await methods()).toEqual(['email'])
  })

  test('disabling one that is already off is a no-op, not an error', async () => {
    const { t, playerId, methods } = await player()
    await t.run(async (ctx) => setReminderMethodFor(ctx, playerId, 'push', false))
    expect(await methods()).toEqual([])
  })

  // Validated on the METHOD, not only on the resulting array. Disabling an
  // unknown method produces an array that is itself valid — the filter simply
  // matches nothing — so delegating validation to updateReminderMethodsFor
  // alone would let a typo through silently in exactly one direction.
  test.each([true, false])('rejects an unknown method when enabled=%s', async (enabled) => {
    const { t, playerId } = await player()
    await expect(
      t.run(async (ctx) => setReminderMethodFor(ctx, playerId, 'carrier-pigeon', enabled)),
    ).rejects.toThrow()
  })
})
