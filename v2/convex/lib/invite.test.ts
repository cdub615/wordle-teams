import { describe, expect, test } from 'vitest'
import { isCompleteName, normaliseInviteEmail } from './invite.ts'

describe('normaliseInviteEmail', () => {
  test('trims and lowercases', () => {
    expect(normaliseInviteEmail('  Ada.Lovelace@Example.TEST ')).toBe('ada.lovelace@example.test')
  })

  test('accepts an already-normal address unchanged', () => {
    expect(normaliseInviteEmail('ada@example.test')).toBe('ada@example.test')
  })

  test('rejects empty, whitespace and malformed input', () => {
    expect(normaliseInviteEmail('')).toBeNull()
    expect(normaliseInviteEmail('   ')).toBeNull()
    expect(normaliseInviteEmail('ada')).toBeNull()
    expect(normaliseInviteEmail('ada@')).toBeNull()
    expect(normaliseInviteEmail('ada@example')).toBeNull()
    expect(normaliseInviteEmail('a b@example.test')).toBeNull()
  })

  // The 'trims and lowercases' case above pads with SPACES only, so a trim
  // narrowed to / +/ would pass every other test in this file. Addresses reach
  // the invite form by paste — out of a spreadsheet cell, a mail client's To:
  // line — and those carry tabs and newlines, not spaces. A surviving \n makes
  // the address fail EMAIL_SHAPE and the invite is rejected as malformed while
  // looking perfectly correct in the input box.
  test('strips tabs and newlines, not only spaces', () => {
    expect(normaliseInviteEmail('\tada@example.test\n')).toBe('ada@example.test')
    expect(normaliseInviteEmail('\r\n  ada@example.test  \r\n')).toBe('ada@example.test')
  })

  // EMAIL_SHAPE is permissive ON PURPOSE (see its comment) and nothing else
  // here pins that, so a later "tightening" to something like /^[a-z0-9.]+@/
  // would pass the whole suite while silently locking real people out. These
  // are the shapes that such a regex breaks first, and the resulting bug is
  // invisible from the inside: the inviter sees no error worth acting on and
  // the invitee simply never gets an email.
  test('accepts unusual but valid local parts and subdomains', () => {
    expect(normaliseInviteEmail('ada+wordle@example.test')).toBe('ada+wordle@example.test')
    expect(normaliseInviteEmail("o'hara@example.test")).toBe("o'hara@example.test")
    expect(normaliseInviteEmail('ada_lovelace-1@mail.example.test')).toBe(
      'ada_lovelace-1@mail.example.test',
    )
  })

  // Both sides of the @ exclude @ itself, and no test above depends on that:
  // loosening only the domain half to [^\s]+ passes all six original tests.
  // Two addresses pasted at once is the realistic input here, and it MUST be
  // rejected rather than stored — teams.invited holding a comma-joined blob
  // matches nobody's auth email, so it is an invite that can never be accepted.
  test('rejects a second @ and a pasted pair of addresses', () => {
    expect(normaliseInviteEmail('ada@@example.test')).toBeNull()
    expect(normaliseInviteEmail('ada@example@test.test')).toBeNull()
    expect(normaliseInviteEmail('ada@example.test,bob@example.test')).toBeNull()
    expect(normaliseInviteEmail('ada@example.test bob@example.test')).toBeNull()
  })

  // The load-bearing property behind "normalise on WRITE, compare
  // case-insensitively on READ": the stored form has to be a FIXED POINT, or
  // re-normalising a row on its way back out could produce a different key than
  // the one it was written under and the read-side comparison would miss it.
  test('is idempotent — re-normalising a stored address changes nothing', () => {
    const once = normaliseInviteEmail('  Ada.Lovelace@Example.TEST ')
    expect(once).not.toBeNull()
    expect(normaliseInviteEmail(once as string)).toBe(once)
  })

  // The A2 bug itself, stated directly. v1 stored the address as typed and
  // matched it case-sensitively against auth's lowercased email, so an invite
  // sent to a mixed-case address could never be accepted. Every casing of one
  // address has to collapse to a single key for that to be impossible.
  test('collapses casing variants of one address to a single key', () => {
    const variants = [
      'ada@example.test',
      'Ada@Example.test',
      'ADA@EXAMPLE.TEST',
      ' aDa@ExAmPlE.tEsT ',
    ]
    const keys = new Set(variants.map(normaliseInviteEmail))
    expect(keys).toEqual(new Set(['ada@example.test']))
  })
})

describe('isCompleteName', () => {
  test('accepts ordinary names', () => {
    expect(isCompleteName('Ada', 'Lovelace')).toBe(true)
  })

  test('accepts a ONE-CHARACTER name', () => {
    // v1 saves any non-empty name but guards the redirect on length > 1, so a
    // one-character name saves and then redirects to /complete-profile forever.
    // The guard and the validation share this function precisely so that the
    // loop cannot exist. Do not "tighten" this to length > 1.
    expect(isCompleteName('X', 'Y')).toBe(true)
  })

  test('rejects empty or whitespace-only parts', () => {
    expect(isCompleteName('', 'Lovelace')).toBe(false)
    expect(isCompleteName('Ada', '')).toBe(false)
    expect(isCompleteName('   ', 'Lovelace')).toBe(false)
    expect(isCompleteName('Ada', '   ')).toBe(false)
    // Tabs and newlines too, for the same reason as the address case: the
    // spaces-only cases above would pass a trim narrowed to / +/.
    expect(isCompleteName('\t', 'Lovelace')).toBe(false)
    expect(isCompleteName('Ada', '\n')).toBe(false)
  })

  // The trim decides COMPLETENESS; it is not a demand that the caller pre-trim.
  // The guard reads back whatever completeProfile stored, so if a padded name
  // could save but not clear the guard we would be back to v1's redirect loop
  // by a different route. Padded input is complete input, on both sides.
  test('accepts names that carry surrounding whitespace', () => {
    expect(isCompleteName(' Ada ', ' Lovelace ')).toBe(true)
    expect(isCompleteName('\tX\n', ' Y ')).toBe(true)
  })
})
