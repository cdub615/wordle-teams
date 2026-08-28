// The team-invite email. Kept out of teams.ts so the copy can be read and
// changed without picking through mutation logic — the same split authEmails.ts
// makes for the sign-in code.
//
// Hand-written HTML rather than react-email, matching authEmails.ts. The design
// named react-email for this phase; it is deferred to Phase 6, where reminders
// add a third and fourth email and actually make the case for a component
// library. Two emails written the same way beats two email systems.

import { escapeHtml } from './lib/html.ts'

/**
 * @param teamName   the team they are being invited to.
 *
 *                   REACHES `subject` RAW, newlines included — requireName
 *                   (teams.ts) only trims, so an interior CRLF survives. That
 *                   is accepted rather than overlooked: Resend takes these as
 *                   JSON fields over HTTPS rather than assembling a header
 *                   block from them, and the header that would actually
 *                   matter for injection, `to:`, cannot carry a newline at
 *                   all, because EMAIL_SHAPE's `[^\s@]+` segments reject
 *                   whitespace (lib/invite.ts). escapeHtml (lib/html.ts) has
 *                   no opinion on this — it only escapes for the HTML part,
 *                   below — so this paragraph, not that function's doc
 *                   comment, is where the header-injection question is
 *                   actually answered.
 * @param inviterName the inviter's first name — v1's Supabase template was
 *                    anonymous, and "Ada invited you" is far more legible than
 *                    "You have been invited"
 * @param signInUrl  where to go. There is no token: the invite lives in
 *                   teams.invited, and completing a profile at that address is
 *                   what claims it. Same model as v1, minus the Supabase magic
 *                   link whose PKCE round-trip was one of the three causes of
 *                   v1's invite->join failure (amendment A2).
 *
 *                   ESCAPED, BUT ITS SCHEME IS NOT CHECKED. Escaping stops the
 *                   value breaking OUT of the attribute; it does nothing about
 *                   what the attribute then means, so a `javascript:` URL would
 *                   emerge intact. That is acceptable only because this argument
 *                   is server-built from SITE_URL by the single caller
 *                   (invitePlayer in teams.ts) and never carries user input —
 *                   not because escaping addressed it. A scheme check is
 *                   deliberately not added here: it could only throw, and a throw
 *                   in the mail template rolls back the invite transaction that
 *                   already succeeded. If this ever takes a caller-supplied URL,
 *                   validate it at that caller.
 */
export function teamInviteEmail({
  teamName,
  inviterName,
  signInUrl,
}: {
  teamName: string
  inviterName: string
  signInUrl: string
}) {
  const subject = `${inviterName} invited you to ${teamName} on Wordle Teams`

  // A plain-text part is not optional politeness: some clients render it by
  // preference, and a mail with no text alternative scores worse with spam
  // filters.
  const text = [
    `${inviterName} invited you to join ${teamName} on Wordle Teams.`,
    '',
    `Sign in with this email address to join: ${signInUrl}`,
    '',
    "If you don't know who that is, you can ignore this email.",
    '',
    'Wordle Teams',
    'https://wordleteams.com',
  ].join('\n')

  const team = escapeHtml(teamName)
  const inviter = escapeHtml(inviterName)
  const href = escapeHtml(signInUrl)

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2024;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr>
        <td>
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Wordle Teams</p>
          <h1 style="margin:0 0 24px;font-size:20px;font-weight:600;">You&rsquo;ve been invited to ${team}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${inviter} invited you to join <strong>${team}</strong> on Wordle Teams.</p>
          <p style="margin:0 0 24px;">
            <a href="${href}" style="display:inline-block;background:#1c2024;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;">Join the team</a>
          </p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6b7280;">Sign in with this email address and the team will be waiting for you.</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
            If you don&rsquo;t know who that is, you can ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}
