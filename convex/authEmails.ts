// Sign-in code email. Kept out of auth.ts so the copy can be read and changed
// without picking through plugin configuration.
//
// Deliberately hand-written HTML rather than react-email. The design put the
// react-email work in Phases 4 and 6, and Phase 4 declined it: inviteEmails.ts
// is written the same way, on the argument that two emails written the same way
// beats two email systems. Phase 6 is where reminders add a third and a fourth
// and the case is worth making again; see the note at the top of inviteEmails.ts,
// which is the live version of this decision.

// How long a code is valid, and the phrase for it, both from convex/lib/
// otpExpiry.ts. The constant used to live here and the minutes were computed
// with `Math.round(OTP_EXPIRY_SEC / 60)` in this file AND again on
// /login-error — consistent with each other and wrong together below two
// minutes. See that module for why the phrase is not a rounded number, and why
// it sits in convex/lib/ now that a browser route reads it.
import { OTP_EXPIRY_LABEL } from './lib/otpExpiry.ts'

export function signInCodeEmail(otp: string) {
  const subject = `Your Wordle Teams sign-in code: ${otp}`

  // A plain-text part is not optional politeness: some clients render it by
  // preference, and a mail with no text alternative scores worse with spam
  // filters — which for an authentication email means people simply cannot log
  // in.
  const text = [
    `Your Wordle Teams sign-in code is ${otp}`,
    '',
    `It expires in ${OTP_EXPIRY_LABEL}.`,
    '',
    "If you didn't request this, you can ignore this email — someone may have",
    'typed your address by mistake, and no one can sign in without the code.',
    '',
    'Wordle Teams',
    'https://wordleteams.com',
  ].join('\n')

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2024;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr>
        <td>
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Wordle Teams</p>
          <h1 style="margin:0 0 24px;font-size:20px;font-weight:600;">Your sign-in code</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">Enter this code to finish signing in:</p>
          <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${otp}</p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6b7280;">It expires in ${OTP_EXPIRY_LABEL}.</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
            If you didn&rsquo;t request this, you can ignore this email &mdash; someone may have
            typed your address by mistake, and no one can sign in without the code.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}
