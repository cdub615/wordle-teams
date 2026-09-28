import { VisuallyHidden } from 'radix-ui'
import { DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs.tsx'
import InstallGuideTab from './install-guide-tab.tsx'
import NotificationsTab from './notifications-tab.tsx'
import ProfileTab from './profile-tab.tsx'
import SecurityTab from './security-tab.tsx'

/**
 * The settings dialog's body — four tabs now, ported from user-dialog.tsx. The
 * `<Dialog>` root and its `open`/`onOpenChange` state live in app-menu.tsx,
 * one level up, because that is where the single "Settings" item that opens it
 * lives.
 *
 * IT TAKES NO `defaultTab` ANY MORE (wordle-teams-mwu0). It used to, because
 * the menu carried THREE items that each deep-linked a tab — Notifications,
 * Profile and Install — and the caller had to say which one it meant. Those
 * three collapsed into one "Settings" item, so every open now starts in the
 * same place, and a prop that can only ever receive one value is plumbing
 * pretending to be a choice. Where it starts is Profile, for the reason the
 * TabsList comment below gives — and that reason was never the CALLER'S: it is
 * an argument about which tab this dialog should open on, and it stands on its
 * own now that nobody is passing anything.
 *
 * `defaultValue`, NOT a controlled `value` — v1 does the same
 * (user-dialog.tsx:117). Once open, which tab is showing is this dialog's own
 * business. Radix mounts DialogContent through a Portal on open and unmounts it
 * on close, so a fresh open genuinely returns to Profile rather than resuming
 * wherever the previous one was left.
 *
 * CARRIES A `DialogTitle`, EVEN THOUGH EACH TAB ALREADY PAINTS ITS OWN
 * VISIBLE HEADING ("Notification Settings" / "Installation"). Radix's
 * DialogPrimitive.Content only wires up `aria-labelledby` when it finds a
 * `Title` descendant — without one, which is what this dialog shipped with
 * originally, a screen reader announces an unnamed "dialog", full stop; the
 * `<h3>` inside NotificationsTab is a plain heading, not a
 * `DialogPrimitive.Title`, and contributes nothing to that computation. This
 * is the only `DialogContent` in the codebase that lacked one —
 * scoring-system-editor.tsx, update-team-dialog.tsx, invite-player-dialog.tsx
 * and create-team-dialog.tsx all have one — and the gap undercut the entire
 * point of Task 6, which exists because v1's own affordance was
 * undiscoverable. `VisuallyHidden` (already a dependency via the `radix-ui`
 * umbrella package — see board-entry/button.tsx for the same pattern) keeps
 * it out of the painted layout rather than duplicating either tab's heading
 * on screen.
 *
 * `email` AND `displayName` ARE OPTIONAL AND EACH RENDERS NOTHING WHEN ABSENT,
 * which is the honest shape: app-menu.tsx reads both from queries that are
 * briefly undefined on a cold load, and a row reading "Signed in as undefined"
 * would be worse than no row.
 */
export function SettingsDialog({
  email,
  displayName,
}: {
  email?: string | null
  displayName?: string | null
}) {
  /*
   * ONLY THE PADDING IS THIS DIALOG'S OWN NOW. It used to carry `w-11/12
   * rounded-lg` as well — and shipped once with the `w-11/12` and not the
   * `rounded-lg`, which is exactly the failure mode of a correction that five
   * separate call sites each had to remember. ui/dialog.tsx carries both as its
   * default since wordle-teams-2uet, so the pair can no longer come apart, and
   * ui/dialog.hook.test.ts asserts the padding below does not knock them off.
   *
   * `px-3 py-4 md:p-6` STAYS, because it is genuinely this dialog's: it holds a
   * tab strip whose triggers need the horizontal room that the shared `p-6`
   * spends on margin.
   */
  return (
    <DialogContent className="px-3 py-4 md:p-6">
      <VisuallyHidden.Root>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
      </VisuallyHidden.Root>
      {/*
        WHICH ACCOUNT THIS IS (wordle-teams-7jpo). The same fact the account
        menu now shows, in the place someone goes when they are deliberately
        looking rather than glancing.

        ABOVE THE TABS RATHER THAN INSIDE ONE, and that is the whole reason it
        is here and not in NotificationsTab: it is true of the dialog, not of a
        tab, and burying it under "Alerts" would make the answer to "which
        account am I?" depend on which tab happened to be open. There is
        no Account tab to put it in and adding one for a single read-only line
        would be a bigger change than the question deserves.

        READ-ONLY ON PURPOSE. Changing the address means changing the account —
        convex/access.ts resolves a session to a player by email alone — so an
        editable field here would imply something this app cannot do.

        THE NAME SITS ABOVE THE ADDRESS, mirroring the account menu's label
        exactly: name first, address beneath it in the muted rank. An address on
        its own at the top of a settings dialog reads as a stray field — it is
        not obvious whose it is or why it is there — where the pair reads as an
        identity, which is what it is.

        THE NAME IS SUPPRESSED WHEN IT WOULD REPEAT THE ADDRESS, the same guard
        and the same reason as the menu's: displayName falls back to the email
        for an account with no name at all, and stacking the same string twice
        looks like a bug and tells that player nothing.
      */}
      {displayName && displayName !== email && (
        <p className="text-foreground mt-1 truncate text-sm font-medium">{displayName}</p>
      )}
      {email && (
        <p className="text-muted-foreground mt-1 mb-3 truncate text-xs">
          Signed in as <span className="text-foreground select-text">{email}</span>
        </p>
      )}
      <Tabs defaultValue="profile">
        <TabsList>
          {/*
            FIRST, AND THEREFORE THE TAB EVERY OPEN LANDS ON, BECAUSE IT IS
            THE IDENTITY TAB. The name-and-address block above already answers
            "which account is this"; Profile is the tab that block is about, so
            the strip opens on it rather than making a visitor land on Alerts
            and hunt sideways for their own picture and name. This is the whole
            of the reason `defaultTab` could go: the argument for landing here
            is the dialog's, not the caller's.
          */}
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {/*
            "Alerts", NOT "Notifications", AND THE REASON IS MEASURED WIDTH
            (wordle-teams-wty4.1.7.7). This is the label that finally makes the
            four-tab strip fit a phone. Measured in headless Chromium against
            this app's compiled stylesheet and its real self-hosted Inter faces,
            triggers at 14px/500 plus 8px of TabsList padding:

              label           row    320    360    375    390    414
              Notifications   341   +74    +37    +23     +9    fits
              Reminders       324   +57    +20     +6   fits    fits
              Alerts          290   +23   fits    fits   fits    fits

            (The dialog's content box is `11/12 * viewport - 26px`: 267 at 320,
            304 at 360, 318 at 375, 332 at 390, 354 at 414.)

            "REMINDERS" WOULD HAVE BEEN THE MORE ACCURATE WORD — everything in
            the panel is about the daily board-entry reminder — AND IT WAS
            REJECTED ON THE NUMBERS. It clears 390 by 8px and leaves 375 and 360
            still overflowing; 8px is inside the error bars of a real device,
            and the owner has already measured this strip behaving differently
            on an iPhone than headless Chromium predicts. "Alerts" clears 390 by
            42px and fixes 375 and 360 as well — and those two were ALREADY
            broken before Security was added, so this is the first label that
            leaves the strip correct rather than merely un-regressed.

            320 STILL OVERFLOWS, BY 23px, AND IS NOT FIXED HERE. The THREE-tab
            row was 39px over at 320 long before this feature; that is a
            pre-existing bug about a viewport no phone in the matrix has.

            THE WORD IS NOT A LIE. Both delivery channels the panel offers are
            alerts (Email and Push), and the panel's own heading — "Notification
            Settings" — names the thing in full the moment you land on it. The
            label only has to identify the tab; the panel describes it.

            IT COULD ONLY BE SHORTENED ONCE THE MENU STOPPED MIRRORING IT
            (wordle-teams-mwu0). Until then this string was also a menu item and
            an e2e-asserted product name, which made renaming it a product
            decision rather than a layout fix.
          */}
          <TabsTrigger value="notifications">Alerts</TabsTrigger>
          {/*
            AFTER ALERTS, BEFORE INSTALL. The strip runs from the tab a
            visitor is most likely to have come for to the one they are least
            likely to — Install is static copy read once — and Security is a
            thing you do rather than a thing you read, so it belongs on the
            acting side of that line.
          */}
          <TabsTrigger value="security">Security</TabsTrigger>
          {/*
            "Install", NOT "Install Guide", AND THE REASON IS MEASURED WIDTH
            RATHER THAN TASTE (wordle-teams-wty4.1.7.7). Adding a fourth trigger
            pushed the row from 306px to 387px, and the dialog's content box is
            only 332px at a 390px viewport — so a strip that fitted every phone
            from 390 up stopped fitting any of them. Dropping the second word
            took 46px back, to 341px, which undid the regression at 414 and up
            and left 390 nine pixels over. The "Alerts" rename above is what
            closed the remaining gap; the two triggers are measured together in
            the table there.

            Profile 70, Alerts 64, Security 81, Install 67, plus 8px of TabsList
            padding — 290. The label still names the tab; the panel's own
            heading reads "Installation".
          */}
          <TabsTrigger value="install">Install</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="install">
          <InstallGuideTab />
        </TabsContent>
      </Tabs>
    </DialogContent>
  )
}
