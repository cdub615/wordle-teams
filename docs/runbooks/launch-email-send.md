# Launch email — send plan

Companion to `docs/runbooks/2026-cutover.md`. Covers `wordle-teams-7e3c` (the
terms-change notification) and `wordle-teams-puw4` (who is actually on the list).

Drafts live in `emails/`. **Nothing in this file sends anything.** The send is a
manual action in the Resend dashboard, taken by the owner, after §5.2 passes.

---

## 0. THE ONE THING TO READ IF YOU READ NOTHING ELSE

**Two requirements point in opposite directions, and the gap is real.**

- `wordle-teams-7e3c`: the email **must go out at or before the point chat reaches
  production**, because it is the notification the Terms promise.
- Runbook §1.5 / §5.2: the email **must not go out until after the DNS flip**, because
  the PWA paragraph cannot be decided until the owner opens their installed v1 app.

**Chat is not behind a flag.** `src/routes/chat.tsx` guards on authentication only,
and `src/routes/app.tsx:1339` links to it straight from the dashboard. So chat reaches
production at the instant DNS flips — which is *before* the earliest moment the email
is allowed to go.

There is no ordering that satisfies both literally. Three ways out, in preference order:

1. **Accept a short, bounded gap — recommended.** Make §5.2 the *first* post-flip
   action, not one item in a list, and send within the hour. The substance of the
   non-materiality argument survives a gap measured in hours: both documents have read
   "September 6, 2026" for over three weeks, and no production user can have posted a
   chat message before the flip, so no data was ever collected under the old wording.
   What makes this safe is preparation, not speed — see §1: everything except one
   deletion and one button is done *before* the flip.
2. **Gate chat.** Hide the dashboard link and 404 the route until the email has gone.
   Closes the gap exactly, costs a code change and a deploy on cutover day, and adds a
   second flip to remember. Only worth it if the gap in (1) cannot be kept to hours.
3. **Send before the flip with the PWA block deleted.** *Rejected.* It bets the one
   irreversible artefact on an unverified assumption, which is the exact trade §1.5
   exists to refuse.

**Whichever is chosen, record it here before cutover day.** Do not decide it at 6am
with DNS waiting.

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

- [ ] **1.3 Fill the postal address.** Every draft carries
      `[POSTAL ADDRESS — REQUIRED BEFORE SENDING]` in the footer. A commercial email
      needs a physical mailing address; leaving the placeholder in is both a CAN-SPAM
      problem and visibly unfinished. Set it in the Audience footer settings or edit it
      into all three files.

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

## 4. The PWA block — a deletion, not a decision

Every draft carries:

```
<!-- PWA-BLOCK:START  DELETE THIS ENTIRE BLOCK UNLESS RUNBOOK 5.2 FAILED -->
  ...
<!-- PWA-BLOCK:END -->
```

**Expected outcome: delete it.** `src/routes/me.tsx` redirects `/me` → `/app` carrying
the query string, both manifests omit `scope` so the hop cannot eject a standalone
window into the browser, and `src/routes.test.ts` pins both halves.

**Keep it only if §5.2 actually fails** — the owner opens their long-installed v1 PWA
after the flip and it does *not* land on the dashboard.

It is written out in full, in the state where it is needed, so that the decision at
send time is a deletion rather than composition under time pressure.

**DO NOT SEND BEFORE §5.2.** The email cannot be recalled, and "re-install the app" is
both alarming and, if wrong, the thing that makes a working install stop working.

---

## 5. Send order

1. **Flip DNS** (runbook §4.6).
2. **§5.2 immediately** — owner opens the existing v1 PWA install, confirms `/me` lands
   on the dashboard. This is the gate. Nothing below happens until it passes or fails.
3. **Delete or keep the PWA block** in all three files, per §4.
4. **Re-verify** `https://wordleteams.com/terms` and `/privacy` both load and read
   "September 6, 2026". They are now being served by the Worker, not Vercel.
5. **Send A** (~8). Smallest and warmest list, so it doubles as live fire. Read the
   Resend delivery report before continuing.
6. **Send B** (~62), once A shows clean delivery.
7. **Send C** (~331), once B has settled. Largest list and the highest reputation
   exposure, so it goes last.
8. **Close `wordle-teams-7e3c`** with the send timestamps, and note in `puw4` which
   counts the send actually used.

---

## 6. Not in this plan

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
