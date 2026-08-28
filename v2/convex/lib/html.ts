// Shared HTML escaping for the hand-written email templates (inviteEmails.ts,
// reminderEmails.ts, and any future one). Pulled out once a second template
// needed the same function — see inviteEmails.ts's header for why these are
// hand-written HTML strings rather than react-email components.

/**
 * Escape the five characters that can break out of HTML text or an attribute
 * value.
 *
 * NOT DECORATION. Every caller's argument is something a person typed into a
 * form, or a URL the caller is about to drop into an attribute — and it
 * reaches this function unfiltered before landing inside a document
 * delivered to somebody else's inbox. Text containing `</h1><a href="...">`
 * would otherwise be markup rather than text in every recipient's mail
 * client.
 *
 * Callers apply this ONLY to the HTML part of their template. The subject and
 * the plain-text part are not markup, and escaping them would show a reader
 * the literal `&amp;` in a name containing an ampersand.
 *
 * NOT A URL VALIDATOR. Escaping stops a value breaking OUT of an attribute;
 * it does nothing about what the attribute then MEANS, so a `javascript:`
 * URL passed through here emerges intact. See each caller's own doc comment
 * for why that gap is acceptable for its particular argument — the answer
 * depends on where the value comes from, which this function has no way to
 * know.
 *
 * NOT A HEADER SANITISER either: this only escapes for an HTML document, and
 * has no opinion on what does or doesn't make a value safe inside an email
 * subject or header line. See inviteEmails.ts's note on `teamName`, which is
 * the one place here that also flows into a `subject`.
 */
export function escapeHtml(value: string): string {
  return value
    // First, or it would re-escape the ampersands the other four introduce.
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
