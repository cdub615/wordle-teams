// The board-entry reminder email — Phase 6's third sender (see email.ts's doc
// comment). Kept out of the cron/query logic that will decide who gets one,
// same split inviteEmails.ts and authEmails.ts make.
//
// Hand-written HTML, matching those two. Two emails written the same way beats
// two email systems; this makes three, still one system.

import { escapeHtml } from './lib/html.ts'

/**
 * Both images are ported from v1's Novu template
 * (src/app/novu/emails/board-entry-reminder-email.tsx), which hardcoded two
 * Supabase Storage URLs. Supabase retires in Phase 9, so this template serves
 * both from our own origin instead of pointing at infrastructure that will be
 * gone:
 *
 *  - wordle-teams-title.png is fetched into public/ as part of this task.
 *  - wt-icon-192x192.png already existed in public/ (the PWA icon) and stands
 *    in for v1's separate wt-icon.png — same mark, one fewer asset to host.
 *
 * `siteUrl` is a parameter rather than a hardcoded origin so the same code
 * serves beta and production without a branch, matching how signInUrl reaches
 * teamInviteEmail from its single caller.
 *
 * ESCAPED EVERYWHERE IT LANDS IN THE HTML — both `<img src>` attributes and
 * both links, the call-to-action button and the wordmark below it — for the
 * same reason inviteEmails.ts escapes `signInUrl`:
 * escaping stops the value breaking OUT of the attribute, it does not
 * validate what the attribute then means, so a hostile scheme or a stray
 * quote would still emerge intact rather than being rejected. That gap is
 * accepted for the same reason it is there: `siteUrl` is server-configured
 * (SITE_URL), never user input. It is escaped anyway, because "this
 * particular argument happens to be safe today" is not a reason to skip the
 * same defence its sibling template applies unconditionally.
 *
 * BOTH IMAGES SIT IN AN EXPLICIT `#0d0d0d` PANEL, DELIBERATELY, NOT ON THE
 * WHITE CARD DIRECTLY. Both PNGs were measured with zero transparent pixels
 * and a dominant colour of `#0d0d0d` at 77% and 85% respectively — on white
 * they are solid near-black rectangles, and Outlook's Word rendering engine
 * drops `border-radius` entirely, so the icon becomes a black SQUARE where a
 * circle was intended. `PANEL_COLOR` matches the artwork's own measured
 * dominant colour, so the panel and the image read as one continuous dark
 * shape rather than a mismatched frame around it. Set with both the
 * `bgcolor` HTML attribute and a CSS `background-color` on the same `<td>`:
 * Outlook honours `bgcolor` where it can drop an inline style, so either one
 * missing still leaves the other.
 *
 * This is presentation, not a security boundary, but the owner made the call
 * (2026-08-28) rather than re-cutting the assets, so it is pinned by a test
 * rather than left to the next person's judgment.
 */
const PANEL_COLOR = '#0d0d0d'

/**
 * The call-to-action button's fill and ink.
 *
 * THE FILL IS LIGHT ON PURPOSE, which is the opposite of inviteEmails.ts's
 * solid dark "Join the team" button, and not a style preference.
 * `wordle-teams-cih` records that the `bgcolor` + inline `background-color`
 * pairing is best-effort rather than guaranteed: a dark-mode client can
 * rewrite either one. When the fill is lost the label falls back onto the
 * white card, so the label colour has to be legible THERE, not only on the
 * fill — and no single colour reads on both `#ffffff` and a near-black fill,
 * so the fill is the half that has to give. Dark ink on a light fill is
 * legible whether the fill applies, is dropped, or is inverted along with the
 * ink; white-on-dark is a white-on-white button the moment the fill goes.
 *
 * `BUTTON_INK` doubles as a 2px border so the button still reads as a button
 * against the white card, where its own fill is nearly invisible.
 *
 * MEASURED, not asserted — this file's own §2 lesson in
 * docs/design-system/V2-ADDENDUM.md is that a plausible contrast table was
 * wrong in 5 of 7 light pairs, and following it would have made a PASSING
 * badge fail. So: `#1c2024` on `#f6f7f9` is 15.29:1, and on `#ffffff` — the
 * case that matters, the fill stripped — 16.39:1. The border clears 1.4.11's
 * 3:1 at the same 16.39:1. The fill itself is 1.07:1 against the card, which
 * is why the border is load-bearing rather than decorative.
 *
 * The "no single colour reads on both" claim is true but close: the best of
 * all 256 greys is `#787878` at 4.40:1, a 2% miss on AA.
 */
const BUTTON_BG = '#f6f7f9'
const BUTTON_INK = '#1c2024'

export function boardEntryReminderEmail({
  firstName,
  siteUrl,
}: {
  firstName: string
  siteUrl: string
}) {
  // No date in the subject. v1's default —
  // `Board Entry Reminder ${formatDate(new Date(), 'M/dd/yy')}` — is a Zod
  // default evaluated ONCE at module load, so a long-running server stamps
  // every reminder for every day with the date it happened to boot on. The
  // fix is not "pass today's date in instead": the cron that will call this
  // (a later task) already sends one reminder per calendar day, and the mail
  // itself is about "today" from the reader's point of view, not a machine-
  // readable date a subject line would need to carry. Leaving it out removes
  // the bug instead of relocating it to a parameter every caller must
  // remember to pass correctly.
  const subject = 'Reminder to enter your Wordle board — Wordle Teams'

  // Trimmed, not just checked for truthiness. A whitespace-only name is
  // truthy, so `firstName ? ... : 'Hello,'` alone would produce the literal
  // "Hello    ," — exactly the broken greeting this guard exists to prevent.
  //
  // firstName === '' is UNREACHABLE here: isCompleteName (lib/invite.ts)
  // trims before checking, so a native signup can never produce it, and
  // schema.ts's note on this field (schema.ts:44-66) describes a population —
  // the 151 nameless production accounts — that the copy's isNamed filter
  // (scripts/lib/copy-filters.mjs) excludes from ever reaching v2 at all
  // (confirmed zero such rows on beta, 2026-08-21). A WHITESPACE-ONLY name,
  // though, IS reachable: isNamed is `Boolean(first_name && last_name)`,
  // which a string of spaces satisfies, and upsertPlayers (migrate.ts)
  // inserts the copied row with no trim of its own. The copy is the one
  // writer that can still deliver a blank-ish name, which is what this
  // trims for.
  const trimmedName = firstName.trim()
  const greeting = trimmedName ? `Hello ${trimmedName},` : 'Hello,'

  const site = escapeHtml(siteUrl)
  const titleImage = `${site}/wordle-teams-title.png`
  const iconImage = `${site}/wt-icon-192x192.png`
  // `/app`, NOT THE BARE ORIGIN. The mail exists to send a player somewhere
  // they can enter a board. It reached the dashboard for as long as `/` WAS
  // the dashboard; Phase 7 Task 1 moved the dashboard to /app and gave `/`
  // back to the marketing landing, so the bare origin would now deliver a
  // just-reminded player to a sales page.
  //
  // TWO LINKS CARRY IT IN THE HTML — the call-to-action button and the
  // wordmark beside the sign-off icon — and the text part carries the same
  // URL on its own labelled line. The wordmark alone was never a call to
  // action: the owner's call (2026-08-31) is that a mail whose entire purpose
  // is "go enter your board" gets a real button, which it had never had.
  //
  // Escaped for the HTML, raw for the text part, for the reason the text
  // block below gives.
  const appUrl = `${site}/app`
  const appUrlText = `${siteUrl}/app`

  // A plain-text part is not optional politeness: some clients render it by
  // preference, and a mail with no text alternative scores worse with spam
  // filters. Same reasoning as inviteEmails.ts and authEmails.ts.
  //
  // NOT ESCAPED. The text part is not markup, so escaping it would show a
  // reader the literal &amp; in a name containing an ampersand. `siteUrl` is
  // plain text here too, same as `signInUrl` in inviteEmails.ts's text part.
  const text = [
    greeting,
    '',
    "It looks like you have not yet entered your Wordle board for today. Don't miss out on those potential points!",
    '',
    // The text half of the call to action. A mail that asks the reader to go
    // do something and gives a text-only client nothing to copy has the same
    // hole the HTML half had. Labelled rather than naked, so it doesn't read
    // as a second copy of the signature's origin two lines further down.
    `Enter your board: ${appUrlText}`,
    '',
    'Best of luck!',
    '',
    'Wordle Teams',
    siteUrl,
    '',
    // v2 replaced v1's user-dropdown-avatar with a hamburger "Account menu"
    // button next to it (settings/user-menu.tsx, Phase 6 Task 6) — the
    // Notifications item v1 describes still lives inside that menu, just
    // behind a differently-labelled trigger.
    'If you do not wish to receive these reminders, or want to change when you',
    'receive them, open the Account menu button in the header and choose',
    'Notifications.',
  ].join('\n')

  const escapedName = escapeHtml(trimmedName)
  const escapedGreeting = escapedName ? `Hello ${escapedName},` : 'Hello,'

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2024;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr>
        <td>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
            <tr>
              <td align="center" bgcolor="${PANEL_COLOR}" style="background-color:${PANEL_COLOR};border-radius:8px;padding:24px;">
                <img src="${titleImage}" width="200" height="39" alt="Wordle Teams" style="display:block;margin:0 auto;max-width:100%;border-radius:4px;" />
              </td>
            </tr>
          </table>
          <h1 style="margin:0 0 24px;font-size:20px;font-weight:600;">Reminder to enter your Wordle board into Wordle Teams</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">${escapedGreeting}</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">It looks like you have not yet entered your Wordle board for today. Don&rsquo;t miss out on those potential points!</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td bgcolor="${BUTTON_BG}" style="background-color:${BUTTON_BG};border-radius:8px;">
                <a href="${appUrl}" style="display:inline-block;background-color:${BUTTON_BG};color:${BUTTON_INK};border:2px solid ${BUTTON_INK};border-radius:8px;padding:10px 20px;text-decoration:none;font-size:15px;font-weight:600;">Enter your board</a>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">Best of luck!</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td bgcolor="${PANEL_COLOR}" style="background-color:${PANEL_COLOR};border-radius:9999px;padding:6px;line-height:0;">
                <img src="${iconImage}" width="32" height="32" alt="" style="display:block;border-radius:9999px;" />
              </td>
              <td style="padding-left:8px;font-size:15px;line-height:1.6;vertical-align:middle;">
                <a href="${appUrl}" style="color:#1c2024;text-decoration:none;">Wordle Teams</a>
              </td>
            </tr>
          </table>
          <hr style="border:none;border-top:1px solid #eaeaea;margin:0 0 24px;" />
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
            If you do not wish to receive these reminders, or want to change when
            you receive them, open the Account menu button in the header and
            choose Notifications.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}
