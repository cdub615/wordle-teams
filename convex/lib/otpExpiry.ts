/**
 * HOW LONG A SIGN-IN CODE LASTS, AND HOW TO SAY IT.
 *
 * ONE constant, read by three things that must never disagree: the emailOTP
 * plugin's `expiresIn` (convex/auth.ts), the sentence in the code email
 * (convex/authEmails.ts), and the second asterisked note on /login-error
 * (src/routes/login-error.tsx). They were previously independent, so the email
 * could have promised five minutes while the plugin enforced something else,
 * and nothing would have caught it.
 *
 * IT LIVES IN convex/lib/ RATHER THAN IN authEmails.ts, and that placement is
 * the point of this file existing at all. convex/lib/ is the directory that
 * marks isomorphic code — the only part of convex/ that src/ imports from, as
 * every other cross-boundary import in src/ already does (puzzleDay, board,
 * scoring, reminders, teamLimits). A route reaching into authEmails.ts for the
 * number worked, and the email HTML did not reach dist/client, but nothing said
 * so: the next person to add a server-only import to authEmails.ts would have
 * had no way to know a browser route depended on it.
 */
export const OTP_EXPIRY_SEC = 300

/**
 * Seconds as a phrase a person can read, NEVER ROUNDED.
 *
 * `Math.round(seconds / 60)` is what both readers used to do, and it is wrong
 * below two minutes in the direction that matters: 90 seconds renders as "2
 * minutes", a 33% OVERSTATEMENT of a security-relevant window, which tells
 * someone with a 100-second-old code that it should still work. `Math.floor`
 * only trades that for an understatement ("1 minute" for 90 seconds).
 *
 * So minutes are used only when they are EXACT, and anything else is said in
 * seconds. Every output is literally true of the input, at any value the
 * constant above might take, which is the property a rounded number cannot
 * have. Singular and plural are both handled because "1 minutes" in an
 * authentication email reads as a bug in the product.
 *
 * Deliberately not a general duration formatter: no hours, no "1m 30s", no
 * Intl.RelativeTimeFormat. Two call sites want one short noun phrase, and the
 * expiry has never been anything but a whole number of minutes.
 */
export function humanDuration(seconds: number): string {
  const unit = (count: number, name: string) => `${count} ${name}${count === 1 ? '' : 's'}`
  return seconds >= 60 && seconds % 60 === 0
    ? unit(seconds / 60, 'minute')
    : unit(seconds, 'second')
}

/**
 * The phrase itself, so the email and the page interpolate the SAME STRING
 * rather than each doing their own arithmetic on the same number — which is how
 * the rounding bug came to exist in two places at once.
 */
export const OTP_EXPIRY_LABEL = humanDuration(OTP_EXPIRY_SEC)
