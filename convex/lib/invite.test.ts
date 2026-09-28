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
  //
  // The NEWLINE-separated pair is the important one: it is what pasting a
  // column out of a spreadsheet actually produces, and it is the case that
  // fails if the regex ever picks up the `m` flag, under which ^ and $ match
  // at line boundaries and the first line alone satisfies the pattern.
  test('rejects a second @ and a pasted pair of addresses', () => {
    expect(normaliseInviteEmail('ada@@example.test')).toBeNull()
    expect(normaliseInviteEmail('ada@example@test.test')).toBeNull()
    expect(normaliseInviteEmail('ada@example.test,bob@example.test')).toBeNull()
    expect(normaliseInviteEmail('ada@example.test bob@example.test')).toBeNull()
    expect(normaliseInviteEmail('ada@example.test\nbob@example.test')).toBeNull()
    expect(normaliseInviteEmail('ada@example.test\r\nbob@example.test')).toBeNull()
  })

  // Every part of the address must be NON-EMPTY. The 'ada@' and 'ada@example'
  // cases above die on the missing dot rather than on emptiness, which leaves
  // all three + quantifiers in EMAIL_SHAPE unpinned — changing any one of them
  // to * passes every other test here. Each of these three is the sole case
  // that fails for its own quantifier. An address with an empty local part,
  // host or TLD matches nobody's auth email, so storing one creates an invite
  // that can never be accepted — exactly what the shape check exists to stop.
  test('rejects an empty local part, host or TLD', () => {
    expect(normaliseInviteEmail('@example.test')).toBeNull()
    expect(normaliseInviteEmail('ada@.test')).toBeNull()
    expect(normaliseInviteEmail('ada@example.')).toBeNull()
  })

  // 'a b@example.test' above is the only interior-whitespace case and it uses a
  // literal space, so swapping \s for a literal space in the character classes
  // passes the whole suite while letting tabs and newlines through the MIDDLE
  // of an address — where trim() cannot reach them. A tab inside the local part
  // is what a mis-selected spreadsheet paste looks like.
  test('rejects interior whitespace of any kind, not only spaces', () => {
    expect(normaliseInviteEmail('ada\tlovelace@example.test')).toBeNull()
    expect(normaliseInviteEmail('ada\nlovelace@example.test')).toBeNull()
    expect(normaliseInviteEmail('ada@exa\tmple.test')).toBeNull()
    expect(normaliseInviteEmail('ada@example.\ttest')).toBeNull()
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
    // A one-character name is a real name — an initial, or simply a short one —
    // and v1's threshold was the bug, not the save. v2 cannot loop here at all
    // (needsProfile checks for a ROW, never re-reads the name), so the only job
    // left is to not reject legitimate input. Do not "tighten" this to
    // length > 1: completeProfile and the form's canSubmit both call this, so
    // tightening it would lock the same people out of both at once.
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
  // This matters for the profile form's canSubmit predicate, which will judge
  // RAW, UNTRIMMED React state: a user who types ' Ada ' has entered a complete
  // name and the submit button has to be live. Rejecting padded input here
  // would disable the button on input that saves perfectly well.
  //
  // Note this says nothing about what gets STORED — the function returns a
  // verdict, not a value, and completeProfile trims separately before writing.
  test('accepts names that carry surrounding whitespace', () => {
    expect(isCompleteName(' Ada ', ' Lovelace ')).toBe(true)
    expect(isCompleteName('\tX\n', ' Y ')).toBe(true)
  })
})
