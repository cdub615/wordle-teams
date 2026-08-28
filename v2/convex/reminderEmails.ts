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
 * the closing link — for the same reason inviteEmails.ts escapes `signInUrl`:
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
          <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">Best of luck!</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td bgcolor="${PANEL_COLOR}" style="background-color:${PANEL_COLOR};border-radius:9999px;padding:6px;line-height:0;">
                <img src="${iconImage}" width="32" height="32" alt="" style="display:block;border-radius:9999px;" />
              </td>
              <td style="padding-left:8px;font-size:15px;line-height:1.6;vertical-align:middle;">
                <a href="${site}" style="color:#1c2024;text-decoration:none;">Wordle Teams</a>
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
