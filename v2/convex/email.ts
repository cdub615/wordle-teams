import { Resend } from '@convex-dev/resend'
import { components } from './_generated/api'
import { realRecipients } from './lib/e2e.ts'
import type { EmailId, SendEmailOptions } from '@convex-dev/resend'
import type { ActionCtx, MutationCtx } from './_generated/server'

/**
 * The only way to send mail from this codebase.
 *
 * THE CLIENT IS DELIBERATELY NOT EXPORTED. Two senders have shipped here and the
 * throwaway-address guard had to be added to one of them after the fact:
 * invitePlayer sent real invitations from the PRODUCTION sending domain to
 * mailboxes that had never existed, twice per e2e run, until it was caught
 * (wordle-teams-96l). Nothing made that easy to notice, because a raw client was
 * in scope and calling it was the obvious thing to do.
 *
 * So the guard moved to the choke point. Phase 6's reminders are the third
 * sender and are covered by construction — not because anybody remembered, but
 * because there is no unguarded client to reach for. Keep it that way: if a
 * future caller needs something this wrapper does not expose, widen the wrapper
 * rather than exporting `resend`.
 *
 * testMode stays FALSE. The component's own test mode is narrower than it
 * sounds: the local part must be exactly delivered, bounced or complained
 * (optionally +tagged) at Resend's probe domain, so an ordinary name on that
 * same domain is rejected too. It would break real sign-in mail on localhost,
 * where the owner signs in. Suppression here is by address, not by deployment.
 */
const resend = new Resend(components.resend, { testMode: false })

/**
 * Enqueue an email, minus any throwaway e2e recipients.
 *
 * Returns the component's `EmailId` for the send, or `null` when every intended
 * recipient was suppressed. Callers that ignore the result are fine; one that
 * needs to know whether mail went out should check for `null` rather than
 * assume. The branded id is kept rather than widened to `string` so that
 * widening this wrapper later to expose status/cancel costs nothing.
 *
 * Only the OBJECT form is accepted. The component has one other signature, a
 * positional overload deprecated in favour of this one — and the @deprecated tag
 * is stripped from its built .d.ts, so nothing warns you. Not re-exposing it
 * keeps a single shape to guard.
 */
export async function sendEmail(
  ctx: MutationCtx | ActionCtx,
  options: SendEmailOptions,
): Promise<EmailId | null> {
  const e2eTestMode = process.env.E2E_TEST_MODE

  // AN EMPTY RECIPIENT LIST FROM THE CALLER IS A BUG, NOT A SUPPRESSION, and the
  // two must not collapse into the same quiet `null`. Phase 6's reminders build
  // their recipients from a query; if that returns nothing because of a filter
  // or index mistake, a silent skip is indistinguishable from correct
  // suppression — including in the mail oracle. Loud here, quiet below.
  // (Passing `undefined` for the mode means "filter nothing", so this counts
  // what the caller actually asked for.)
  if (realRecipients(options.to, undefined).length === 0) {
    throw new Error('sendEmail was given no recipients')
  }

  // FILTERED PER RECIPIENT, not decided per message — `to`, `cc` and `bcc` are
  // each `string | string[]`, so one send can address several people, and a
  // batch holding a throwaway account alongside a real one must still reach the
  // real one. See realRecipients, where that rule is tested.
  //
  // `to` DECIDES. A message nobody was addressed to is not a message, even when
  // a real address sits in `cc` — promoting a copy into the `to` line would
  // invent intent and disclose that they were copied. Pinned in email.test.ts.
  const to = realRecipients(options.to, e2eTestMode)
  if (to.length === 0) return null

  const cc = realRecipients(options.cc, e2eTestMode)
  const bcc = realRecipients(options.bcc, e2eTestMode)

  return await resend.sendEmail(ctx, {
    ...options,
    to,
    // Absent stays absent: an empty array is not the same as no field. The
    // component forwards `cc: []` to the Resend API rather than omitting it,
    // which is a request we have no reason to make.
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
  })
}
