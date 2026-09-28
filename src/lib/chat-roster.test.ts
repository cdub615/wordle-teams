import { describe, expect, test } from 'vitest'
import { rosterEntryFor, type RosterMember } from './chat-roster.ts'

const member = (id: string, firstName: string, lastName: string, image: string | null = null): RosterMember => ({
  id,
  firstName,
  lastName,
  image,
})

const ADA = member('p1', 'Ada', 'Lovelace', 'https://example.test/ada.webp')
const BEA = member('p2', 'Bea', 'Byron')
const ROSTER = [ADA, BEA]

describe('rosterEntryFor', () => {
  test('a member on the roster gets their name and an avatar record together', () => {
    expect(rosterEntryFor(ROSTER, 'p1')).toEqual({
      name: 'Ada Lovelace',
      author: { image: 'https://example.test/ada.webp', initials: 'AL' },
    })
  })

  // A member with nothing uploaded still gets a RECORD — initials, no image.
  // That is a different answer from "not on the roster", and message-list.tsx
  // gates the whole avatar element on the difference.
  test('a member with no uploaded picture still gets a record, with initials and no image', () => {
    expect(rosterEntryFor(ROSTER, 'p2')).toEqual({
      name: 'Bea Byron',
      author: { image: null, initials: 'BB' },
    })
  })

  // Messages deliberately outlive their author leaving the team, so this is
  // documented behaviour rather than a fallback.
  test('a player id off the roster is a former member, with no avatar record at all', () => {
    expect(rosterEntryFor(ROSTER, 'gone')).toEqual({ name: 'Former member', author: null })
  })

  // "Not loaded yet" is NOT the claim "not a member". getMyTeams is undefined
  // for the few renders before it resolves, and calling a live teammate a
  // former member for a few hundred milliseconds is a lie the UI would tell.
  test('an unresolved roster withholds the name rather than calling a live teammate departed', () => {
    expect(rosterEntryFor(undefined, 'p1')).toEqual({ name: '', author: null })
  })

  /**
   * THE PROPERTY THIS MODULE EXISTS FOR, and the reason the name and the
   * avatar are returned together by one function rather than resolved by two.
   *
   * If the two lookups could ever disagree about who is on the roster, the
   * specific way it surfaces is a FACE rendered beside the words "Former
   * member" — handing back exactly the identity that label exists to
   * withhold. Nothing structural stops a future edit from reintroducing a
   * second `members.find(...)`; this assertion is what fails when it does.
   *
   * It is stated over every id shape the route can pass, present and absent,
   * against a loaded and an unresolved roster, rather than as a third
   * example — an example pins one case, and the risk here is a case nobody
   * enumerated.
   */
  test('an avatar record is never returned beside a name that is not a member name', () => {
    const rosters: Array<ReadonlyArray<RosterMember> | undefined> = [ROSTER, [], undefined]
    const ids = ['p1', 'p2', 'gone', '']

    for (const roster of rosters) {
      for (const id of ids) {
        const { name, author } = rosterEntryFor(roster, id)

        if (author !== null) {
          expect(name).not.toBe('Former member')
          expect(name).not.toBe('')
        }
        if (name === 'Former member' || name === '') expect(author).toBeNull()
      }
    }
  })
})
