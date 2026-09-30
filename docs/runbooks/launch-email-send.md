# Launch email — send plan

Companion to `docs/runbooks/2026-cutover.md`. Covers `wordle-teams-7e3c` (the
terms-change notification) and `wordle-teams-puw4` (who is actually on the list).

Drafts live in `emails/`. **Nothing in this file sends anything.** The send is a
manual action in the Resend dashboard, taken by the owner, after §5.2 passes.

---

## 0. DECIDED — 2026-09-30

**Both open questions in this plan are settled. Neither is a decision for cutover day.**

### 0a. The ordering conflict: accept the bounded gap

Two requirements pointed in opposite directions. `wordle-teams-7e3c` requires the email
to go out at or before the point chat reaches production. Runbook §1.5/§5.2 forbade
sending until after the DNS flip. **Chat is not behind a flag** — `src/routes/chat.tsx`
guards on authentication only and `src/routes/app.tsx:1339` links it from the dashboard
— so chat goes live the instant DNS flips, which is strictly before the earliest moment
the email could go. No ordering satisfied both literally.

**The owner accepted a short bounded gap, sending the same day as the launch.** The
substance of the non-materiality argument survives a gap of hours: both documents have
read "September 6, 2026" for over three weeks, so the terms landed well ahead of the
feature, and no production user can have posted a chat message before the flip — nobody's
data was ever collected under the old wording. Gating chat was considered and rejected as
more cutover-day complexity than the exposure warrants.

### 0b. The PWA paragraph: it ships, permanently

**The block is no longer conditional and §5.2 is no longer a send gate.** It ships in
every send, which removes the gate, the placeholder and the composition-under-pressure
risk in one go.

**That is only safe because the voice changed with it.** As first drafted it was an
imperative — "please add it again" — addressed to every recipient. Sent to a working
install that is not a no-op: removing and re-adding a PWA clears its storage, so the
reader is signed out and has to redo OTP or a social sign-in. It is now **conditional**,
opens by saying almost every install carries across untouched, and gives the fix only to
someone whose icon actually misbehaves. Nobody with a working install has any reason to
act on it.

`src/routes/me.tsx` still redirects `/me` → `/app` carrying the query string, so the
expectation remains that no reader needs this at all.

**§5.2 is now an ordinary post-flip smoke check.** Still worth doing. No longer blocking.

---

## 1. Before the flip — do all of this in advance

Cutover day should leave exactly two actions: delete a block, press send.

- [ ] **1.1 Re-run the export.** The numbers below are a 2026-09-28 snapshot and they
      drift (players grew 533 → 564 between 08-20 and 09-28).

      ```
      node scripts/export-resend-audience-prod.mjs
      ```

      Gitignored, local-only, reads production read-only, writes the CSV outside the
      repo. **Re-read the printed counts** — the segment sizes below are illustrative,
      the CSV is authoritative.

- [ ] **1.2 Create the Resend Audience** and import the CSV. Confirm all five custom
      properties survived the import: `membership_status`, `days_since_last_board`,
      `signup_year`, `team_count`, `time_zone`. The segmentation is worthless without
      `days_since_last_board`.

- [x] **1.3 The postal address — DECIDED 2026-09-30: send without one.**

      ```
      node scripts/build-launch-email.mjs --all --no-address
      ```

      This **removes** the footer line. It does not blank it and it does not leave the
      placeholder — shipping `[POSTAL ADDRESS — REQUIRED BEFORE SENDING]` to 401 people is
      the one outcome the build refuses outright, with or without the flag. The footer
      reads "You are getting this because you have a Wordle Teams account." above the
      unsubscribe link, which is clean rather than visibly unfinished.

      **The flag is required every time and there is no default.** Omitting it with no
      address set fails the build. That is the safe direction: forgetting the decision
      stops the build rather than silently shipping a placeholder.

      **What was weighed, so this is not re-litigated at send time.** CAN-SPAM wants a
      valid physical address in *commercial* email, and a launch announcement is
      commercial. The app's reminders, OTP and invites carry none and are fine, but they
      are **transactional** under the primary-purpose test, so they are not a precedent for
      this one. Against that: enforcement against a 401-recipient send by a solo developer
      is very unlikely, and the practical exposure is reputational rather than legal. The
      owner weighed both and chose to send without an address for this launch.

      **TO REVERSE IT, set a value and drop the flag** — nothing else changes:

      ```
      echo "Wordle Teams, PO Box 123, City ST 00000" > .launch-postal-address
      node scripts/build-launch-email.mjs --all
      ```

      The tracked drafts keep the placeholder permanently precisely so this stays a
      one-line reversal. `.launch-postal-address` is gitignored because **this repo is
      PUBLIC** and a home address pasted into `emails/` would be committed and permanent.
      A city/state/zip with no street line is rejected by the build: it is not one of the
      three forms 16 CFR 316.2 accepts (street address, USPS-registered PO box, CMRA
      private mailbox), so it discloses your area without satisfying the rule.
      `LAUNCH_POSTAL_ADDRESS_UNCHECKED=1` overrides that check for an address it cannot parse.

      **An earlier version of this step said to set the address in "the Audience footer
      settings". Do not rely on that** — it was asserted without checking. Resend broadcasts
      hand you the whole HTML body, so anything in the footer has to be in the HTML.

- [ ] **1.4 Build all three broadcasts** from `emails/*.html`, **PWA block still in**,
      each pointed at its segment filter (§2).

- [ ] **1.5 Send a test of each to yourself** and open them on a phone, in dark mode,
      and in Gmail. Check specifically:
      - `{{{FIRST_NAME|there}}}` resolves, and degrades to "there" on a nameless row
      - `{{{RESEND_UNSUBSCRIBE_URL}}}` resolves and the link works
      - the Terms and Privacy links both land on **production** and show
        "September 6, 2026" — a 404 here voids the whole notification
      - the tile row renders as tiles, not as five stacked boxes

- [ ] **1.6 Decide §0** and write the decision into this file.

---

## 2. The segments

401 contacts. **82% never entered a board.** A single email written for returning
players misses four fifths of the list, which is what `wordle-teams-puw4` is for.

The split is one column: `days_since_last_board`.

| | Segment | Filter | ~n | The job |
|---|---|---|---|---|
| **A** | `emails/launch-a-active.html` | `days_since_last_board` ≤ 30 | 8 | Tell people who are *currently playing* what changed. This is the only segment where "here is what is new" is the right frame. |
| **B** | `emails/launch-b-lapsed.html` | `days_since_last_board` set **and** > 30 | 62 | Their history survived the migration. Lead with that, then reminders — falling out of the habit is the most likely reason they stopped. |
| **C** | `emails/launch-c-never-played.html` | `days_since_last_board` empty | 331 | Not a release announcement. A first board, in ten seconds. No Pro pitch at all. |

A + B = 70, which is every contact who has ever entered a board. A ∪ B ∪ C = 401 with
no overlap, because the three filters partition one column.

**B must never receive C's copy.** Telling somebody who entered two hundred boards that
they never started is the one mistake here that cannot be walked back.

**Why three and not two.** Merging A into B is defensible (both have played) and only
costs tone. Merging B into C is not, for the reason above. Merging A into C would tell
the eight most engaged users on the platform that they never began.

### Tone constraints

- **Pro framing stays modest.** Production holds exactly **one** `pro` subscriber
  (and `cancelled` 2, `expired` 2, `new` 396). Pro appears as a single quiet line in A
  and B and is **absent from C**.
- **Every product claim traces to a tested source** — `src/lib/free-includes.ts`,
  `src/lib/pro-benefits.ts`, `src/components/home/marketing-copy.ts`,
  `src/lib/plans.ts`. If a claim and the product disagree, the email is the bug.

---

## 3. The legal line — required in all three

> Team chat is new, so our **Terms** and **Privacy Policy** have been updated to cover it.

Linked to `https://wordleteams.com/terms` and `https://wordleteams.com/privacy`.

It sits in its own ruled block above the footer in every draft, marked
`LEGAL NOTICE - REQUIRED, NEVER DELETE`. **It is not footer fine print**, because the
whole purpose of the send is that it counts as notification.

Background: the 2026-09-06 amendment added a new category of User Content (chat
messages), named teammates as a disclosure recipient, and added a retention rule. The
Terms say a material revision will be notified. Rather than adjudicate materiality, the
owner made the question moot by notifying. The 2026-09-02 reissue was judged
non-material because it only *narrowed* claims; this one expands them, so that
precedent does not transfer.

Both documents read "September 6, 2026" and `src/legal-copy.test.ts:97` requires them to
share a date, so they can only ever move together.

**Worth a sentence of thought at cutover:** v1's copies at `src/app/terms/page.tsx` and
`src/app/privacy/page.tsx` were deliberately not updated, because v1 has no chat. The
two versions diverge on purpose for the first time, which ends a convention. Once DNS
flips, v1's copies are unreachable anyway and the divergence stops mattering — but it
should stop mattering *because someone decided that*, not by accident.

---

## 4. The PWA paragraph — permanent

Settled in §0b. The block ships in every send, in its conditional voice. The
`PWA-BLOCK:START` / `PWA-BLOCK:END` markers stay as **delimiters**, not as a deletion
instruction: `src/launch-email.test.ts` pins that the legal notice sits *outside* them,
so the notice can never be mistaken for part of this block.

Do not restore the imperative wording without re-reading §0b — the reason it changed is
not stylistic.

---

## 5. Send order

Steps 1–6 of §1 all happen **before** the flip. What remains on the day:

1. **Flip DNS** (runbook §4.6).
2. **Re-verify both legal pages on production.** `https://wordleteams.com/terms` and
   `/privacy` must load and read "September 6, 2026". They are served by the Worker now,
   not Vercel. **A 404 here voids the notification** — this is the one remaining hard gate.
3. **Rebuild the paste-ready HTML** — `node scripts/build-launch-email.mjs --all --no-address`
   (the flag is the §1.3 decision; without it the build fails rather than guessing). Run it
   *after* any late edit, or you will paste a stale file.
4. **Send A** (~8). Smallest and warmest list, so it doubles as live fire. Read the Resend
   delivery report before continuing.
5. **Send B** (~62), once A shows clean delivery.
6. **Send C** (~331), once B has settled. Largest list and the highest reputation
   exposure, so it goes last.
7. **§5.2 smoke check** — open the installed v1 PWA and confirm `/me` lands on the
   dashboard. No longer blocks the send (§0b); do it anyway, and if it fails, the
   paragraph telling people how to fix it has already gone out.
8. **Close `wordle-teams-7e3c`** with the send timestamps, and note in `puw4` which counts
   the send actually used.

---

## 6. Getting it into Resend

A launch send is a **Broadcast against an Audience**. That is a different path from the
app's transactional mail (`@convex-dev/resend`, used for reminders, OTP and invites) and
needs an account-level API key plus an Audience id — neither of which lives in this repo.
Do not route the launch through the app, and do not add a Resend dependency for it.

**1. Produce the paste-ready HTML.** The files in `emails/` are annotated *source*: their
HTML comments are part of the message body, so they would be delivered to all 401
recipients and visible to anyone viewing source. Strip them:

```
node scripts/build-launch-email.mjs --all --no-address      # -> build/emails/launch-{a,b,c}.html
node scripts/build-launch-email.mjs a --no-address | wl-copy  # or straight to the clipboard
```

It verifies both merge tags and the terms-change notice survived the strip, refuses to emit
a file still carrying the address placeholder, and prints each subject line and segment
filter. `--no-address` is the §1.3 decision. `build/` is gitignored.

**2. Create the Audience** and import the CSV from §1.1. Confirm all five custom
properties survived: `membership_status`, `days_since_last_board`, `signup_year`,
`team_count`, `time_zone`.

**3. Create three broadcasts**, one per segment, each with:

| | Subject | Segment filter |
|---|---|---|
| A | Wordle Teams has been rebuilt | `days_since_last_board <= 30` |
| B | Your Wordle Teams scoreboard is still there | `days_since_last_board > 30` |
| C | It takes about ten seconds to get on the board | `days_since_last_board` is empty |

Paste the built HTML into the **code/HTML** view, not the visual editor — a WYSIWYG
editor will rewrite the table markup and the media queries.

**4. From address.** The transactional senders use `auth@`, `invites@` and `reminders@`
on the verified `wordleteams.com` domain. A launch send wants its own local part
(`hello@` or `launch@`) so a marketing unsubscribe never suppresses sign-in mail for the
same address. Confirm SPF/DKIM are green on the domain before sending.

**5. Test send each one to yourself** and check the list in §1.5 before any real send.

---

## 7. Not in this plan

- **The 163 nameless contacts.** Exported separately; the owner has not decided whether
  they get a send. If they do: `first_name` is blank for all 163, so the greeting has to
  be generic, and roughly half have no team connection of any kind. A cold blast to 163
  stalled signups risks complaints and bounces on **the same sending domain** that has
  to land the real launch email. Send the named audience first, let it settle, warm
  rather than blast.
- **The remaining cutover work** — the §1.3 dry run at `--scope=all` against dev,
  setting `LAUNCH_AT` off its 2099 placeholder (it gates the Pro trial, not chat, so it
  does not interact with §0), and the `wordle-teams-kqfy` identity rehearsal.
- **Anything sent from the app.** Transactional mail goes through `@convex-dev/resend`
  (`convex/convex.config.ts`) for reminders, OTP and invites. A launch send is a Resend
  **Broadcast** against an **Audience** — a different path. Do not route it through the
  app, and do not add a Resend dependency to the repo for it.
