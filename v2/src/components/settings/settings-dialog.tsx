import { VisuallyHidden } from 'radix-ui'
import { DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs.tsx'
import InstallGuideTab from './install-guide-tab.tsx'
import NotificationsTab from './notifications-tab.tsx'

export type SettingsTab = 'notifications' | 'install'

/**
 * The settings dialog's body — two tabs, ported from user-dialog.tsx. The
 * `<Dialog>` root and its `open`/`onOpenChange` state live in app-menu.tsx,
 * one level up, because that is also where the two menu items that decide
 * `defaultTab` live: clicking "Notifications" opens here on that tab,
 * clicking "Install Guide" on the other, exactly like v1's
 * handleNotificationsClick / handleInstallClick pair.
 *
 * `defaultTab`, NOT a controlled `value` — v1 does the same
 * (user-dialog.tsx:117). Once open, which tab is showing is this dialog's own
 * business; the caller only gets to pick where it STARTS.
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
  defaultTab,
  email,
  displayName,
}: {
  defaultTab: SettingsTab
  email?: string | null
  displayName?: string | null
}) {
  /*
   * `rounded-lg` IS NOT OPTIONAL ONCE `w-11/12` IS SET, and this dialog shipped
   * without it. ui/dialog.tsx rounds at `sm:` and above only, which is stock
   * shadcn and correct for a dialog that is FULL WIDTH on a phone: a full-bleed
   * sheet with square corners against the screen edge is the intended look, and
   * board-entry/button.tsx and monthly-winner-celebration.tsx both rely on it.
   * Narrowing to 11/12 pulls the panel off the edges, and square corners on an
   * inset panel just look broken.
   *
   * The other four inset dialogs already pair them — scoring-system-editor,
   * create-team, invite-player and update-team all pass `w-11/12 rounded-lg`.
   * This one was the single exception. styles-utilities.test.ts pins the
   * pairing, because nothing else can see it: it type-checks, lints and builds
   * either way.
   */
  return (
    <DialogContent className="w-11/12 rounded-lg px-3 py-4 md:p-6">
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
        tab, and burying it under "Notifications" would make the answer to
        "which account am I?" depend on which tab happened to be open. There is
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
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="install">Install Guide</TabsTrigger>
        </TabsList>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="install">
          <InstallGuideTab />
        </TabsContent>
      </Tabs>
    </DialogContent>
  )
}
