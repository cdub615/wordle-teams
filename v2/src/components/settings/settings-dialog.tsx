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
 */
export function SettingsDialog({ defaultTab }: { defaultTab: SettingsTab }) {
  return (
    <DialogContent className="w-11/12 px-3 py-4 md:p-6">
      <VisuallyHidden.Root>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
      </VisuallyHidden.Root>
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
