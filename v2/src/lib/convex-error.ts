import { ConvexError } from 'convex/values'
import { SYSTEM_VALUE_MAX, SYSTEM_VALUE_MIN } from '../../convex/lib/scoringSystem.ts'
import type { AccessCode } from '../../convex/access'

/**
 * The typed code behind a thrown ConvexError, or null for anything else.
 *
 * The parent design's error-handling contract is "mutations throw ConvexError
 * with typed codes; UI maps codes to sonner toasts". Everything that is not one
 * of ours — a dropped connection, a platform 5xx — returns null and gets the
 * generic recovery message, which is the case that must never lose a board.
 */
export function convexErrorCode(error: unknown): AccessCode | null {
  if (!(error instanceof ConvexError)) return null
  const data = error.data as { code?: string } | undefined
  const code = data?.code
  if (
    code === 'UNAUTHENTICATED' ||
    code === 'NO_PLAYER' ||
    code === 'NOT_A_MEMBER' ||
    code === 'INVALID_BOARD' ||
    code === 'NOT_TEAM_OWNER' ||
    code === 'INVALID_TEAM' ||
    code === 'INVALID_DATE' ||
    code === 'OWNER_NOT_REMOVABLE' ||
    code === 'INVALID_SYSTEM' ||
    code === 'INVALID_EMAIL' ||
    code === 'INVALID_NAME' ||
    code === 'INVALID_REMINDER_METHOD' ||
    code === 'INVALID_REMINDER_TIME' ||
    code === 'INVALID_TIME_ZONE' ||
    code === 'INVALID_PUSH_ENDPOINT'
  ) {
    return code
  }
  return null
}

/**
 * Copy for the typed codes, shared by every screen that surfaces a
 * ConvexError. `boardErrorMessage` and `dashboardErrorMessage` below differ
 * only in what they say when `error` is NOT one of these — that fallback
 * depends on whether the user was submitting something or just loading a
 * page, but the typed cases themselves don't.
 *
 * Exhaustive over AccessCode on purpose: if access.ts's AccessCode ever grows
 * a member, the `default` branch's `never` assignment stops compiling —
 * for BOTH callers below, since both delegate here — instead of silently
 * routing the new code to a generic message. See the comment on AccessCode
 * itself.
 *
 * EXPORTED for one caller that has no ConvexError to map: routes/complete-
 * profile.tsx checks isCompleteName locally before it submits, and shows this
 * exact string for INVALID_NAME. It reuses the copy rather than writing its own
 * so a client-side rejection and the server's rejection of the same name cannot
 * read differently. Reach for the three wrappers below in every other case —
 * they are what turn an unknown failure into something useful.
 */
export function typedCodeMessage(code: AccessCode): string {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 'Your session expired. Please sign in again.'
    case 'NO_PLAYER':
      // NOT "your session expired", which is what this shared a case with until
      // Phase 4. Their session is fine — they simply have no player record yet,
      // and signing in again does not help. Before Phase 4 that was a dead end
      // in the literal sense: a cold signup reached the dashboard, pressed the
      // only call to action, and got a message describing the wrong problem,
      // because nothing in v2 could create a player at all (wt-ksh.5.1).
      return 'Finish setting up your profile to continue.'
    case 'NOT_A_MEMBER':
      return 'You are not on that team any more.'
    case 'INVALID_BOARD':
      return 'That board is not complete. Check the answer and your guesses.'
    case 'NOT_TEAM_OWNER':
      // SAYS "OWNER", NOT "THE PERSON WHO CREATED IT", and that is the whole
      // point of the wording. It used to say "created", which was true only
      // while every team's owner was also its creator. Phase 5's softened
      // downgrade reassigns `owner` to the earliest-joined remaining member,
      // so a team's owner is now routinely somebody who did not create it —
      // and the old sentence would have told that person something false about
      // themselves. Nothing would have caught it: these are string literals in
      // a switch, so lint, tsc, build and the whole suite stay green while the
      // copy lies. Keep any future rewording true of the OWNER FIELD alone.
      return "Only this team's owner can change it."
    case 'INVALID_TEAM':
      return 'A team needs a name.'
    case 'INVALID_DATE':
      // Fires when the client's `today` is more than a day off the server
      // clock — a wrong device clock or a hostile client, never a timezone
      // difference. "Refresh and try again" would not fix a genuinely wrong
      // clock, so this points at the actual cause instead.
      return "Your device's clock looks off. Check your date and time settings and try again."
    case 'OWNER_NOT_REMOVABLE':
      // Says "owner" for the reason NOT_TEAM_OWNER above does.
      return "This team's owner can't be removed as a member."
    case 'INVALID_SYSTEM':
      return `Points must be whole numbers between ${SYSTEM_VALUE_MIN} and ${SYSTEM_VALUE_MAX}.`
    case 'INVALID_EMAIL':
      // Thrown by invitePlayerFor and cancelInviteFor (convex/teams.ts) when
      // normaliseInviteEmail rejects the submitted address. Deliberately
      // permissive on the server — see EMAIL_SHAPE in convex/lib/invite.ts — so
      // this fires on a typo, not on an unusual but valid address.
      return 'That does not look like an email address.'
    case 'INVALID_NAME':
      // Says "both" because that is the only way to fail it: completeProfile
      // trims each name and rejects when either side is empty.
      return 'Enter both a first and a last name.'
    case 'INVALID_REMINDER_METHOD':
      // Thrown by updateReminderMethodsFor (convex/settings.ts) on TWO branches
      // — an unrecognised method, and a recognised one repeated — so this has to
      // be true of either. "Reminders can be sent by email or push
      // notification." used to sit here, and was false on the duplicates
      // branch: it describes a constraint ['email','email'] already satisfies.
      // The NOT_TEAM_OWNER hazard applies here too: a literal in a switch, so
      // every gate stays green while the copy lies about which branch fired.
      return 'Choose email, push notification, or both.'
    case 'INVALID_REMINDER_TIME':
      return 'Pick a reminder time from the list.'
    case 'INVALID_TIME_ZONE':
      // NOT "that time zone is not one we recognise" — the user never typed or
      // picked one. updateTimeZoneFor (convex/settings.ts) stores whatever
      // Intl.DateTimeFormat().resolvedOptions().timeZone reports, so a rejection
      // here means the BROWSER handed over something Intl itself cannot
      // resolve, and telling the user their non-existent choice was wrong would
      // be lying about the cause — the same reason INVALID_DATE points at the
      // device clock instead of the input.
      return "We could not read your device's time zone, so reminders can't be scheduled yet."
    case 'INVALID_PUSH_ENDPOINT':
      // Thrown by saveSubscriptionFor (convex/push.ts) when the browser's own
      // PushSubscription.endpoint is not a parseable https: URL. This should
      // never happen from a real browser's Push API — it fires on a hand-built
      // or tampered request — so the copy does not try to explain a cause the
      // user can act on, and it does NOT echo the submitted value back: that
      // value is exactly what this check exists to keep out of view.
      return 'That push subscription is not valid.'
    default: {
      const _exhaustive: never = code
      return _exhaustive
    }
  }
}

/**
 * What to tell the user after a failed board-submission MUTATION (upsertBoard).
 *
 * Do not touch the null-branch wording: it is the a335ae8 message, quoted
 * verbatim, and it earns its specificity — there really is a typed board still
 * on screen for the user to be reassured about.
 */
export function boardErrorMessage(error: unknown): string {
  const code = convexErrorCode(error)
  if (code === null) {
    return 'Could not save your board. Your entry is still here — please try again.'
  }
  return typedCodeMessage(code)
}

/**
 * What to tell the user after a failed page-load QUERY (e.g. getTeamMonth via
 * ScoresTable's useSuspenseQuery).
 *
 * The null case here is NOT an edge case — it's everything that isn't one of
 * our typed codes, which in practice means a dropped connection or a
 * platform 5xx, and it is the single most likely real failure. Unlike
 * boardErrorMessage, nothing was submitted and there is no board to reassure
 * anyone about, so that copy would be actively wrong here.
 */
export function dashboardErrorMessage(error: unknown): string {
  const code = convexErrorCode(error)
  if (code === null) {
    return 'Something went wrong loading this page. Please try again.'
  }
  return typedCodeMessage(code)
}

/**
 * What to tell the user after a failed TEAM mutation.
 *
 * A third sibling of boardErrorMessage and dashboardErrorMessage, and it exists
 * for the same reason they are separate: the typed cases read identically, but
 * the fallback has to say something true about what just failed. `fallback` is
 * the caller's own wording for "this specific thing did not work".
 */
export function mutationErrorMessage(error: unknown, fallback: string): string {
  const code = convexErrorCode(error)
  return code ? typedCodeMessage(code) : fallback
}
