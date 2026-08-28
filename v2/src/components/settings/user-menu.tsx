import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { Download, Mails, Menu, User as UserIcon } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar.tsx'
import { Badge } from '#/components/ui/badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Dialog } from '#/components/ui/dialog.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { initialsFor } from '#/lib/initials.ts'
import { SettingsDialog } from './settings-dialog.tsx'
import type { SettingsTab } from './settings-dialog.tsx'

/**
 * The settings surface's entry point (Phase 6, Task 6): a non-interactive
 * avatar for identity, and a hamburger button beside it that is the actual
 * menu trigger.
 *
 * v1 MAKES THE BARE AVATAR ITSELF THE TRIGGER (user-dropdown.tsx:117-123),
 * ringed by an animated spinning gradient meant to draw the eye toward it —
 * and by the owner's own account it didn't: an animated halo reads as a
 * badge, not a control, and users were not finding it. This is the deliberate
 * departure: a real button carrying a `Menu` icon and its own `aria-label`,
 * with the avatar demoted to decoration that happens to also carry identity
 * for a screen reader. No spinning ring is ported.
 *
 * THE AVATAR IS NOT A BUTTON. No `role="button"`, no `cursor-pointer`, no
 * click handler — clicking it does nothing, which is the point. It still
 * carries identity: `AvatarImage`'s `alt` and the `AvatarFallback`'s letters
 * are real content a screen reader announces, just not as something
 * interactive.
 *
 * INITIALS COME FROM THE PLAYERS ROW (api.players.myName), NOT FROM
 * `getCurrentUser`'s `name`. See initials.ts's doc comment for why those are
 * two different, unrelated strings — Better Auth's `name` is whatever the
 * OAuth provider (or nothing, for OTP) handed back at sign-up.
 *
 * DOES NOT GATE ITS OWN QUERIES ON isAuthenticated. Header.tsx only mounts
 * this component inside its own `isAuthenticated &&` block, so by the time
 * this exists in the tree a session is already live — see Header.tsx's own
 * note on why `'skip'` matters for a query that CAN mount while signed out;
 * none of these three can.
 */
export function UserMenu() {
  const { data: user } = useQuery(convexQuery(api.auth.getCurrentUser, {}))
  const { data: name } = useQuery(convexQuery(api.players.myName, {}))
  const { data: isPro } = useQuery(convexQuery(api.teams.amIPro, {}))

  const [dialogOpen, setDialogOpen] = useState(false)
  const [defaultTab, setDefaultTab] = useState<SettingsTab>('notifications')

  const openTab = (tab: SettingsTab) => {
    setDefaultTab(tab)
    setDialogOpen(true)
  }

  // Prefers the players row's own name; falls to Better Auth's `name`, then
  // the email, so the label is never blank even for a brand-new account
  // caught between sign-up and completing onboarding.
  const fullName = [name?.firstName, name?.lastName].filter((part) => part && part.length > 0).join(' ')
  const displayName = fullName || user?.name || user?.email || 'Account'

  const initials = initialsFor(name?.firstName ?? '', name?.lastName ?? '', user?.email)

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <div className="flex items-center gap-1.5">
        <Avatar className="h-8 w-8">
          {user?.image && <AvatarImage src={user.image} alt={displayName} />}
          <AvatarFallback>
            {initials ?? <UserIcon className="h-4 w-4" aria-hidden="true" />}
          </AvatarFallback>
        </Avatar>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/*
              "Account menu", not just "Menu" — the header already has a
              Billing button and a theme toggle sharing this same row, and a
              screen-reader user tabbing across all three deserves more than
              one of them being ambiguously named "Menu".
            */}
            <Button variant="ghost" size="sm" aria-label="Account menu" className="px-2">
              <Menu className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex items-center justify-between gap-2">
              <span className="truncate">{displayName}</span>
              {/*
                Rendered only once amIPro has actually answered.
                `isPro ? 'Pro' : 'Free'` on an `undefined` in-flight value
                would show "Free" to a paying player for however long the
                query takes — Header.tsx:95-99 names this exact rule
                (`isPro === false`, never the loose `!isPro`) for the same
                badge's sibling copy, the pending-invites count.
              */}
              {isPro !== undefined && (
                <Badge variant={isPro ? 'success' : 'secondary'}>{isPro ? 'Pro' : 'Free'}</Badge>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openTab('notifications')}>
              <Mails className="mr-2 h-4 w-4" aria-hidden="true" />
              <span>Notifications</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openTab('install')}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              <span>Install Guide</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <SettingsDialog defaultTab={defaultTab} />
    </Dialog>
  )
}

export default UserMenu
