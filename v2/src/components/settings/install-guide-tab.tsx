import { MoreHorizontal, Share } from 'lucide-react'

/**
 * The three-step Add-to-Home-Screen guide, ported from
 * user-dialog.tsx:158-176. `MoreHorizontal` + `Share` replace v1's
 * `DotsHorizontalIcon` (`@radix-ui/react-icons`), a dependency v2 does not
 * carry — both lucide icons read the same to a user scanning for "the menu
 * with three dots" or "the share icon".
 *
 * NOT DECORATION. iOS Safari grants push permission only to a PWA that has
 * already been added to the home screen — there is no in-browser prompt to
 * fall back to — so on an iPhone this tab is the ONLY route to the feature
 * the Notifications tab's Email switch previews (and Push will join, once
 * the spike behind it lands).
 */
export default function InstallGuideTab() {
  return (
    <div className="flex flex-col space-y-6 py-4">
      <div className="flex flex-col space-y-1.5">
        <h3 className="text-lg font-semibold leading-none tracking-tight">Installation</h3>
        <p className="text-sm text-muted-foreground">To install Wordle Teams as an app</p>
      </div>
      <ol className="ml-4 list-decimal space-y-2 text-sm md:text-base">
        <li>
          Tap the three-dot menu icon <MoreHorizontal className="inline-flex" size={18} aria-hidden="true" /> or
          the Share icon <Share className="inline-flex" size={18} aria-hidden="true" />
        </li>
        <li>Select &quot;Add to Home Screen&quot; or &quot;Install app&quot;</li>
        <li>Confirm by tapping &quot;Install&quot; or &quot;Add&quot;</li>
      </ol>
    </div>
  )
}
