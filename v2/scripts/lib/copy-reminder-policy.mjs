// Which of the five reminder-related fields the copy carries, and when.
//
// THE DECISION (wt-ksh.7.32): reminder settings arrive at CUTOVER, not before.
// A Phase 7 re-copy must not be able to switch reminders on for someone who does
// not know this beta exists and who already receives real reminders from v1.
//
// BOTH HALVES ARE WRITTEN DOWN HERE, which is what that issue asks for instead
// of a silent line deletion:
//
//   WHAT IS REMOVED     timeZone is withheld; reminderDeliveryMethods is sent
//                       EMPTY. Those two together are what decide eligibility.
//   WHAT RESTORES IT    one flag. Pass { includeReminderSettings: true }, which
//                       copy-from-supabase.mjs exposes as --with-reminders. The
//                       cutover runbook (wt-ksh.8.43) runs the final copy with
//                       it, and that single step is the whole restoration.
//
// AND IT IS AN EXPECTED PARITY DIVERGENCE, not a bug: until cutover, beta
// legitimately differs from production on reminder_delivery_methods and
// time_zone. Task 16's §7a table records it; a report that flags it as a defect
// is reading the wrong side.
//
// THE FIVE ARE NOT ONE SET, and treating them as one is the trap. Ranked by what
// they actually do, which is why three of them still cross:
//
//   reminderDeliveryMethods  DANGEROUS  - this is what turns reminders on
//   timeZone                 DANGEROUS  - convex/reminders.ts skips anyone
//                                         without one, so it is the second half
//                                         of eligibility
//   lastBoardEntryReminder   PROTECTIVE - copied forward it SUPPRESSES a
//                                         same-day send. Withholding it would
//                                         make an unwanted reminder MORE likely
//   reminderDeliveryTime     harmless   - inert without the two above
//   hasPwa                   harmless   - display only until push ships
//
// Pure, and separate from copy-from-supabase.mjs, because that script does its
// work at module scope against production and a live deployment and cannot be
// imported by a test. Same reason copy-filters.mjs and verify-filters.mjs exist.
//
// THE ENV KILL SWITCH IS NOT A SUBSTITUTE. REMINDERS_ENABLED is unset on beta
// and convex/reminders.ts:81 gates on it, so a sweep cannot fire regardless. But
// wt-ksh.7.32 records that the switch had become the ONLY thing protecting; this
// is the second layer, and a second layer is only worth having if it holds on
// its own.

/**
 * The reminder-related fields to spread into a shaped player row.
 *
 * `row` carries the already-normalized values (post `opt()` / `ms()`), so this
 * stays a decision about policy and never about Supabase's column shapes.
 *
 * NOTE WHAT IS AN EMPTY ARRAY AND WHAT IS AN ABSENT KEY — the two are not
 * interchangeable, because upsertPlayers does `ctx.db.patch(existing._id, doc)`:
 *
 *   - `reminderDeliveryMethods: []` is sent EXPLICITLY, so a re-run CLEARS a
 *     value some earlier copy already wrote onto a beta row. Omitting the key
 *     would leave that value in place, and a copy that merely stops adding the
 *     field does not undo the copy that added it.
 *   - `timeZone` is OMITTED rather than sent as undefined. Convex treats an
 *     undefined field in a patch as a delete, but it is not a Convex value and
 *     its survival across the HTTP client's arg encoding is not something this
 *     script should be betting the copy on. Omitting stops new values arriving;
 *     anything an earlier copy already wrote has to be measured and cleared
 *     deliberately, not assumed away here.
 */
export function reminderFieldsFor(row, { includeReminderSettings }) {
  const carried = {
    hasPwa: row.hasPwa,
    reminderDeliveryTime: row.reminderDeliveryTime,
    lastBoardEntryReminder: row.lastBoardEntryReminder,
  }

  if (includeReminderSettings) {
    return {
      ...carried,
      // Tested on the VALUE, not on key presence. The caller builds this row as
      // `timeZone: opt(p.time_zone)`, so a player with no time zone in
      // production arrives with the key present and undefined — and sending
      // that would put an undefined into the patch for exactly the players who
      // never had one.
      ...(row.timeZone !== undefined ? { timeZone: row.timeZone } : {}),
      reminderDeliveryMethods: [...(row.reminderDeliveryMethods ?? [])],
    }
  }

  return { ...carried, reminderDeliveryMethods: [] }
}
