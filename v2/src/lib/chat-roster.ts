import { initialsFor } from './initials.ts'

/** A team member, reduced to what chat's author resolution reads. */
export type RosterMember = { id: string; firstName: string; lastName: string; image: string | null }

/** What message-list.tsx needs to render one author's avatar, or `null` for nobody to render. */
export type ChatAuthor = { image: string | null; initials: string | null }

/** An author's name and avatar, resolved together against one roster lookup. */
export type RosterEntry = { name: string; author: ChatAuthor | null }

/**
 * An author's display name AND their avatar, from a single roster lookup.
 *
 * ONE FUNCTION BECAUSE THE TWO ANSWERS MUST NOT DISAGREE. These used to be two
 * closures in routes/chat.tsx, each running its own `team.members.find` — two
 * independent opinions about who counts as a current member. The specific way
 * they could diverge is a FACE rendered beside the words "Former member",
 * handing back the exact identity that label exists to withhold. Sharing a
 * `memberFor` closure inside the route fixed it structurally but pinned
 * nothing: a later edit that needs a member for a mention or a reaction writes
 * the obvious second `find`, and it would compile, lint and pass every test in
 * the repo. Returning the pair from here makes the disagreement unwritable,
 * and chat-roster.test.ts's last assertion is what fails if someone tries.
 *
 * src/lib/display-names.ts was extracted for the same class of reason — its
 * own doc comment, "so the table and the today panel cannot disagree". This is
 * that argument one level lower, between a name and the avatar beside it.
 *
 * THREE ANSWERS, NOT TWO, and the third is the subtle one:
 *
 *   ON THE ROSTER — the name, and a record. A member who has never uploaded a
 *   picture still gets a record with `image: null`; message-list.tsx gates the
 *   whole avatar element on the record being non-null, not on the image, so a
 *   member with no photo shows initials and a departed author shows nothing.
 *
 *   OFF THE ROSTER — "Former member" and no record. Documented behaviour
 *   rather than a fallback: messages deliberately outlive their author leaving
 *   the team.
 *
 *   ROSTER NOT RESOLVED YET — an empty name and no record. `undefined` members
 *   is getMyTeams before it settles, which is NOT the claim "this player is not
 *   a member". Saying "Former member" about a live teammate for a few hundred
 *   milliseconds is a lie the UI would tell; withholding the name for that long
 *   is merely quiet. Withholding a FACE for the same moment is not dishonest
 *   either, which is why both halves stay empty here rather than only one.
 */
export function rosterEntryFor(
  members: ReadonlyArray<RosterMember> | undefined,
  playerId: string,
): RosterEntry {
  if (!members) return { name: '', author: null }

  const member = members.find((candidate) => candidate.id === playerId)
  if (!member) return { name: 'Former member', author: null }

  return {
    name: `${member.firstName} ${member.lastName}`,
    author: { image: member.image, initials: initialsFor(member.firstName, member.lastName) },
  }
}
