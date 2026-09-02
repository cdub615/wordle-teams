import { describe, expect, test } from 'vitest'
import { e2eTeamLegacyId, isE2eEmail, isE2ePlayerRow, isE2eTraffic, realRecipients } from './e2e.ts'

// The addresses here are throwaway e2e shapes and example.test, never anybody's
// real address — this repository is public.
const E2E = 'e2e+abc123@wordleteams.com'
const REAL = 'ada@example.test'

describe('isE2eEmail', () => {
  test('accepts the throwaway shape', () => {
    expect(isE2eEmail(E2E)).toBe(true)
  })

  test('is case-insensitive, because auth lowercases and callers may not', () => {
    expect(isE2eEmail('E2E+ABC@WordleTeams.COM')).toBe(true)
  })

  test.each([
    ['a real address', REAL],
    ['the right domain without the e2e+ prefix', 'ada@wordleteams.com'],
    ['an e2e+ prefix on somebody else’s domain', 'e2e+abc@example.test'],
    ['a bare plus with no tag', 'e2e+@wordleteams.com'],
    ['the domain as a subdomain of somewhere else', 'e2e+abc@wordleteams.com.evil.test'],
    // PINS THE LEADING ANCHOR, and it is the dangerous direction. Without `^` —
    // or with `.test()` swapped for a `.search() >= 0` — this real person is
    // reclassified as e2e traffic, and on a deployment with the flag set their
    // genuine invitation is dropped silently with the suite fully green. Every
    // other fixture here gives the same verdict with or without `^`.
    ['a real local part that merely ENDS in the throwaway shape', 'ada.e2e+news@wordleteams.com'],
    // Pins the escaped dot in the domain.
    ['a domain differing only where the dot is', 'e2e+abc@wordleteamsXcom'],
    ['an empty string', ''],
  ])('rejects %s', (_label, email) => {
    expect(isE2eEmail(email)).toBe(false)
  })
})

describe('isE2eTraffic', () => {
  test('an e2e address on a deployment in test mode is e2e traffic', () => {
    expect(isE2eTraffic(E2E, 'true')).toBe(true)
  })

  // THE PRODUCTION HALF — a requirement, not yet a fact. E2E_TEST_MODE MUST NOT
  // be set on the deployment that becomes production, so that an address
  // matching the throwaway shape is treated as an ordinary user there and gets
  // its real mail. But beta carries its environment into production at cutover;
  // wordle-teams-7az is the step that clears it and is still OPEN. These cases
  // pin what the predicate does with the flag off — they cannot pin that the
  // flag is off.
  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['the string "false"', 'false'],
    // Guards the exact-comparison: anything truthy-but-not-'true' must not pass.
    ['some other truthy string', '1'],
    ['the wrong case', 'TRUE'],
  ])('an e2e address is NOT e2e traffic when the mode flag is %s', (_label, mode) => {
    expect(isE2eTraffic(E2E, mode)).toBe(false)
  })

  // THE OTHER HALF. A machine running tests still sends real mail to real
  // people — a genuine invitation is never swallowed by the flag alone.
  test('a real address is NOT e2e traffic even in test mode', () => {
    expect(isE2eTraffic(REAL, 'true')).toBe(false)
  })
})

describe('realRecipients', () => {
  test('a lone real address survives, as an array', () => {
    expect(realRecipients(REAL, 'true')).toEqual([REAL])
  })

  test('a lone throwaway address is removed in test mode', () => {
    expect(realRecipients(E2E, 'true')).toEqual([])
  })

  test('the same address survives when the flag is off', () => {
    expect(realRecipients(E2E, undefined)).toEqual([E2E])
  })

  // THE REASON THIS FILTERS INSTEAD OF DECIDING A WHOLE SEND. Phase 6's
  // reminders address several people at once; suppressing the message because
  // one recipient is a throwaway account would drop the other's mail.
  test('a mixed batch keeps the real people and drops the throwaways', () => {
    const other = 'grace@example.test'
    expect(realRecipients([E2E, REAL, 'e2e+two@wordleteams.com', other], 'true')).toEqual([
      REAL,
      other,
    ])
  })

  test('order is preserved, so a batch stays aligned with whatever it was built from', () => {
    const a = 'a@example.test'
    const b = 'b@example.test'
    expect(realRecipients([b, E2E, a], 'true')).toEqual([b, a])
  })

  test('a batch of only throwaways empties completely', () => {
    expect(realRecipients([E2E, 'e2e+two@wordleteams.com'], 'true')).toEqual([])
  })

  test('an absent field is an empty array, not a crash', () => {
    expect(realRecipients(undefined, 'true')).toEqual([])
  })

  test('an already-empty batch stays empty', () => {
    expect(realRecipients([], 'true')).toEqual([])
  })

  test('nothing is dropped when the flag is off, however the batch is shaped', () => {
    expect(realRecipients([E2E, REAL], 'false')).toEqual([E2E, REAL])
  })
})

describe('isE2ePlayerRow', () => {
  // The prune deletes on this predicate, so every case below is a row that
  // either does or does not get destroyed. Each fixture is a shape that was
  // actually MEASURED on the local backend on 2026-08-26, not an invented one.

  test('the seed shape: an e2e address carrying the e2e- legacyId', () => {
    expect(isE2ePlayerRow({ email: E2E, legacyId: `e2e-${E2E}` })).toBe(true)
  })

  test('address only, no legacyId — 605 rows born in the real signup flow', () => {
    expect(isE2ePlayerRow({ email: E2E })).toBe(true)
  })

  // THE CASE THE ADDRESS RULE ALONE MISSES, and the reason the predicate is a
  // union at all. 32 rows looked like this: an older spec's `second-e2e+…` local
  // part, which does not START with `e2e+`, so the anchored E2E_ADDRESS regex —
  // correctly, see its own test above — rejects it. Only the seed's legacyId
  // reaches them. Delete this branch and 32 rows become immortal.
  test('legacyId only, when the address does not start with the e2e+ tag', () => {
    const email = 'second-e2e+1755555555555-1@wordleteams.com'
    expect(isE2eEmail(email)).toBe(false)
    expect(isE2ePlayerRow({ email, legacyId: `e2e-${email}` })).toBe(true)
  })

  test('an older seed that stamped only the local part is still caught', () => {
    // 203 rows carried `e2e-<local part>` rather than `e2e-<full address>`. The
    // rule is a PREFIX test, not an equality against the row's own email, which
    // is what keeps those reachable.
    expect(isE2ePlayerRow({ email: E2E, legacyId: 'e2e-abc123' })).toBe(true)
  })

  test.each([
    ['a real player with no legacyId', { email: REAL }],
    // THE ROW THIS PREDICATE EXISTS TO NOT DELETE. A copied player's legacyId is
    // a Supabase uuid; its first hyphen is at index 8, and `e2e-` puts one at
    // index 3, so no uuid can begin with the marker. The fixture is chosen to
    // start with the literal characters `e2e` to pin exactly that: it is the
    // POSITION of the hyphen doing the work, not the absence of those letters.
    [
      'a copied player whose uuid happens to begin e2e',
      { email: REAL, legacyId: 'e2e12345-1111-4111-8111-111111111111' },
    ],
    ['a real address at the product domain', { email: 'ada@wordleteams.com' }],
    ['an e2e+ tag on somebody else’s domain', { email: 'e2e+abc@example.test' }],
  ])('leaves %s alone', (_label, row) => {
    expect(isE2ePlayerRow(row)).toBe(false)
  })
})

describe('e2eTeamLegacyId', () => {
  // WHY THIS EXISTS AT ALL. e2eSeed.ensureTeamFor used to find the account's
  // team with `ctx.db.query('teams').collect()` — a filter over the WHOLE table,
  // which put every team in the mutation's read set. Under parallel Playwright
  // workers any concurrent insert then invalidated it, and Convex failed the
  // mutation outright:
  //
  //   OptimisticConcurrencyControlFailure: Documents read from or written to the
  //   "teams" table changed while this mutation was being run and on every
  //   subsequent retry.
  //
  // Observed 2026-09-01 on e2e/invites.spec.ts:119. Six specs call the seed, and
  // the cost is quadratic in the number of callers, so it worsened as the suite
  // grew (wt-ksh.8.51). A deterministic id per address makes the lookup an
  // indexed `by_legacyId` point read, so the read set is one document.

  test('is stable for the same address', () => {
    expect(e2eTeamLegacyId(E2E)).toBe(e2eTeamLegacyId(E2E))
  })

  test('is case- and whitespace-insensitive, because the seed lowercases too', () => {
    expect(e2eTeamLegacyId('  E2E+ABC123@WordleTeams.com  ')).toBe(e2eTeamLegacyId(E2E))
  })

  test('differs between addresses', () => {
    expect(e2eTeamLegacyId('e2e+one@wordleteams.com')).not.toBe(e2eTeamLegacyId('e2e+two@wordleteams.com'))
  })

  // THE BAND IS THE SAFETY PROPERTY, and it is what the old `Date.now()` was
  // really buying. schema.ts defines `legacyId === undefined` as "born in v2,
  // not copied", so a seeded row must carry SOME value or it inflates Phase 7's
  // reconciliation bucket — but that value must never match a real Supabase
  // team id, or `by_legacyId` could adopt a seeded row into the copy.
  test('lands far above any real Supabase team id, and above the old Date.now() band', () => {
    for (const address of ['e2e+a@wordleteams.com', 'e2e+b@wordleteams.com', 'e2e+zzz@wordleteams.com']) {
      const id = e2eTeamLegacyId(address)
      expect(id).toBeGreaterThanOrEqual(9_000_000_000_000)
      expect(id).toBeLessThan(9_001_000_000_000)
      // Comfortably inside the range Convex and JSON can carry exactly.
      expect(Number.isSafeInteger(id)).toBe(true)
    }
  })

  test('is an integer, never a float', () => {
    expect(Number.isInteger(e2eTeamLegacyId(E2E))).toBe(true)
  })
})
