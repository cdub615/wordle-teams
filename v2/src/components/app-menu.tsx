import { Link, useRouter } from '@tanstack/react-router'
import { convexQuery, useConvexAction, useConvexAuth } from '@convex-dev/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CreditCard,
  Download,
  Home as HomeIcon,
  Info,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Mails,
  Menu,
  MessagesSquare,
  MoonStar,
  Sun,
  SunMoon,
  User as UserIcon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../convex/_generated/api'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar.tsx'
import { Badge } from '#/components/ui/badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Dialog } from '#/components/ui/dialog.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { SettingsDialog } from '#/components/settings/settings-dialog.tsx'
import type { SettingsTab } from '#/components/settings/settings-dialog.tsx'
import { authClient } from '#/lib/auth-client.ts'
import { portalOutcome } from '#/lib/billing-copy.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { STORAGE_KEY as SELECTED_TEAM_KEY } from '#/lib/dashboard-search.ts'
import { initialsFor } from '#/lib/initials.ts'
import { cn } from '#/lib/utils.ts'
import { useReducedMotion } from '#/lib/use-reduced-motion.ts'
import { useThemeMode, type ThemeMode } from '#/lib/theme.ts'

/**
 * The one menu in the app bar (wordle-teams-lyab). Replaces the old
 * settings/user-menu.tsx, and absorbs three things that used to sit beside it
 * in the bar as separate controls: the Home/About nav row, the Billing button
 * and the "Auto" theme pill.
 *
 * WHY: on a phone the bar carried five controls plus a nav row that wrapped
 * onto its own line. The wordmark, an Upgrade CTA and one menu is the whole
 * bar now; everything else is one tap away instead of zero, which for
 * navigation and a colour preference is the right trade.
 *
 * IT RENDERS FOR A SIGNED-OUT VISITOR, WHICH ITS PREDECESSOR DID NOT, and that
 * is the load-bearing change rather than a nicety. Header.tsx mounted UserMenu
 * inside `isAuthenticated &&`; if the nav and the theme control moved into a
 * menu that kept that gate, a signed-out visitor on /login or /about would
 * have no navigation and no way to change theme at all. So the gate is gone
 * from the mount and lives per-item instead — see `isAuthenticated` below.
 *
 * WHICH MEANS THE QUERIES NEED 'skip' NOW. The old component's doc comment
 * said it did not have to gate its own three queries because Header only
 * mounted it for an authenticated session. That sentence stopped being true
 * the moment this rendered signed-out, and the queries would have started
 * failing on /login. Header.tsx's own note explains why it must be `'skip'`
 * and not `enabled: false`: measured on this project, `enabled: false` still
 * opens the websocket watch, the server still refuses, and the refusal is
 * swallowed into query state where nobody sees it.
 */
export function AppMenu() {
  const { isAuthenticated } = useConvexAuth()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: user } = useQuery(
    convexQuery(api.auth.getCurrentUser, isAuthenticated ? {} : 'skip'),
  )
  const { data: name } = useQuery(
    convexQuery(api.players.myName, isAuthenticated ? {} : 'skip'),
  )
  const { data: isPro } = useQuery(
    convexQuery(api.teams.amIPro, isAuthenticated ? {} : 'skip'),
  )

  const { mode, selectMode } = useThemeMode()

  const openPortal = useConvexAction(api.polar.getCustomerPortalUrl)
  const [portalPending, setPortalPending] = useState(false)
  const [signOutPending, setSignOutPending] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [defaultTab, setDefaultTab] = useState<SettingsTab>('notifications')

  const openTab = (tab: SettingsTab) => {
    setDefaultTab(tab)
    setDialogOpen(true)
  }

  // Prefers the players row's own name; falls to Better Auth's `name`, then
  // the email, so the label is never blank even for a brand-new account
  // caught between sign-up and completing onboarding.
  const fullName = [name?.firstName, name?.lastName]
    .filter((part) => part && part.length > 0)
    .join(' ')
  const displayName = fullName || user?.name || user?.email || 'Account'

  const initials = initialsFor(name?.firstName ?? '', name?.lastName ?? '', user?.email)

  /**
   * All four PortalResult branches, moved here verbatim from Header.tsx when
   * Billing became a menu item. The mapping itself is billing-copy.ts's, so it
   * stays testable without a DOM; what is here is a call, a navigation and a
   * toast.
   *
   * A THROW IS ANOTHER OUTCOME AND NOT ONE OF THOSE FOUR.
   * getCustomerPortalUrl turns a Polar failure into `reason: 'error'` itself,
   * so reaching this catch means the action never got that far — an unset
   * SITE_URL, or the transport. mutationErrorMessage gives a typed ConvexError
   * its own copy and everything else this fallback.
   */
  const manageBilling = async () => {
    setPortalPending(true)
    try {
      const outcome = portalOutcome(await openPortal({}))
      if (outcome.action === 'navigate') {
        window.location.href = outcome.url
        return
      }
      // level is 'info' or 'error', and sonner has a method for each. Indexing
      // rather than branching keeps the two-way choice in billing-copy.ts.
      toast[outcome.level](outcome.message)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not open the billing portal.'))
    } finally {
      setPortalPending(false)
    }
  }

  /**
   * Sign out — WHICH v2 HAD NO WAY TO DO AT ALL BEFORE THIS. Nothing in src/
   * called `signOut`; v1's user-dropdown.tsx has always had the item. This is
   * a parity gap being closed, not new polish.
   *
   * IT CLEARS `selectedTeam` AND DELIBERATELY LEAVES `theme` ALONE. v1 ran a
   * blanket `localStorage.clear()` here, which in v2 would throw away the
   * user's colour preference on every sign-out — the two keys are not the same
   * kind of thing. `selectedTeam` is ACCOUNT state: leaving it would hand the
   * next account to sign in on this device a `?team=` default belonging to
   * someone else, and app.tsx would then fail to resolve it. `theme` is DEVICE
   * state and survives, exactly as it survives a session expiring.
   *
   * THE QUERY CACHE IS CLEARED TOO. react-query keeps the previous account's
   * resolved data keyed by query, and without this a sign-in as a different
   * account on the same tab paints the old account's name and teams until each
   * watch re-resolves.
   *
   * NAVIGATES TO `/` RATHER THAN `/login`. Signing out is not the start of
   * signing in; the marketing landing is where a departing user belongs, and
   * it is also what v1 does (`router.push('/')`).
   */
  const signOut = async () => {
    setSignOutPending(true)
    try {
      await authClient.signOut()
      try {
        window.localStorage.removeItem(SELECTED_TEAM_KEY)
      } catch {
        /* storage refused; the server session is already gone, which is the part that matters */
      }
      queryClient.clear()
      await router.navigate({ to: '/' })
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not sign out. Please try again.'))
    } finally {
      setSignOutPending(false)
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/*
              "Main menu", not "Account menu" as the old trigger said. It is no
              longer only about the account: for a signed-out visitor it holds
              nothing but navigation and a theme control, and it is now the
              ONLY menu in the bar, so the narrower name would be wrong in one
              state and redundant in the other.
            */}
            <Button variant="ghost" size="sm" aria-label="Main menu" className="px-2">
              <Menu className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {isAuthenticated && (
              <>
                <DropdownMenuLabel className="flex items-center justify-between gap-2">
                  <span className="truncate">{displayName}</span>
                  {/*
                    Rendered only once amIPro has actually answered.
                    `isPro ? 'Pro' : 'Free'` on an `undefined` in-flight value
                    would show "Free" to a paying player for however long the
                    query takes — Header.tsx names this exact rule
                    (`isPro === false`, never the loose `!isPro`) for the
                    Upgrade button.
                  */}
                  {isPro !== undefined && (
                    <Badge variant={isPro ? 'success' : 'secondary'}>
                      {isPro ? 'Pro' : 'Free'}
                    </Badge>
                  )}
                </DropdownMenuLabel>
                {/*
                  WHICH ACCOUNT THIS IS, AND IT IS NOT DECORATION (wordle-teams-7jpo).
                  convex/access.ts resolves a session to a player PURELY BY EMAIL
                  (playerForEmail, :111) — so the address IS the account identity
                  here. With four social providers and OTP against the same
                  address, a provider that returns a DIFFERENT address silently
                  creates a DIFFERENT account with an empty dashboard, and until
                  this line existed the player had nothing to compare against.
                  That is sharpest at cutover, when every migrated player signs
                  in on the new stack for the first time.

                  AN ADDITION, NOT PARITY. v1 shows the address nowhere at all —
                  its user-dropdown.tsx renders the name and a Pro/Free badge and
                  that is all — so this is a deliberate divergence and earns a
                  §7a row. The issue that filed it claimed the opposite; the
                  claim was checked and is wrong.

                  SUPPRESSED WHEN IT WOULD REPEAT ITSELF. displayName already
                  falls back to the email for an account with no name at all, and
                  printing it twice tells that player nothing while looking like
                  a bug.

                  `select-text` because the entire point is that it can be read
                  and compared; a menu label is not selectable by default.

                  text-muted, NOT text-subtle, and styles.css is explicit about
                  why: text-subtle is the documented sub-AA exception and is for
                  large or decorative text, while "anything normal-sized that
                  must be legible" takes text-muted. An address whose whole
                  purpose is being read and compared character by character is
                  the clearest possible case of the latter.
                */}
                {user?.email && user.email !== displayName && (
                  <DropdownMenuLabel className="-mt-1 pt-0 text-xs font-normal text-muted">
                    <span className="block select-text truncate">{user.email}</span>
                  </DropdownMenuLabel>
                )}
                <DropdownMenuSeparator />
                {/*
                  `/app`, NOT `/me`. v1's item pointed at /me because that was
                  v1's dashboard; in v2 /me is a compatibility route that does
                  nothing but redirect to /app (see its doc comment — it exists
                  for the installed PWA's burned-in start_url). Linking here
                  would advertise the redirect rather than the page.
                */}
                <DropdownMenuItem asChild>
                  <Link to="/app">
                    <LayoutDashboard className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>Dashboard</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openTab('notifications')}>
                  <Mails className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span>Notifications</span>
                </DropdownMenuItem>
              </>
            )}

            <ThemeSubmenu mode={mode} onSelect={selectMode} />

            {isAuthenticated && (
              /*
                NO CONDITION OF ITS OWN — every authenticated player gets this,
                including the lapsed subscriber v1 built `hasBillingAccount`
                for, and the comped player who never checked out at all. It is
                the only place in v2 that reaches the customer portal. See
                Header.tsx's surviving note on `showUpgrade` for the full
                reasoning, and wordle-teams-kzfi for the no-customer case.

                `onSelect` IS PREVENTED SO THE MENU STAYS OPEN. A Radix menu
                item closes the menu on select by default, which would unmount
                the spinner the instant it appeared and leave the player with
                no feedback at all during a network round trip they cannot see
                the end of. Keeping it open also makes `disabled` meaningful:
                it is what stops a second click firing a second portal session.
              */
              <DropdownMenuItem
                disabled={portalPending}
                onSelect={(event) => {
                  event.preventDefault()
                  void manageBilling()
                }}
              >
                <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
                <span>Billing</span>
                {portalPending && (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />
            {/*
              THE NAV LINKS THAT USED TO BE A ROW IN THE BAR. `/` and not
              /home: the two render the identical component, `/` is the
              canonical apex, and /home exists only to catch v1's inbound
              links. Header.tsx's wordmark carries the long-form note.
            */}
            <DropdownMenuItem asChild>
              <Link to="/">
                <HomeIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                <span>Home</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/about">
                <Info className="mr-2 h-4 w-4" aria-hidden="true" />
                <span>About</span>
              </Link>
            </DropdownMenuItem>
            {/*
              The same destination Footer.tsx already links, rather than v1's
              bare apex — one spelling of the feedback board per app.
            */}
            <DropdownMenuItem asChild>
              <a href="https://feedback.wordleteams.com/feedback">
                <MessagesSquare className="mr-2 h-4 w-4" aria-hidden="true" />
                <span>Feedback</span>
              </a>
            </DropdownMenuItem>

            {isAuthenticated && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => openTab('install')}>
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span>Install Guide</span>
                </DropdownMenuItem>
                {/* Menu held open for the round trip, as Billing is above. */}
                <DropdownMenuItem
                  disabled={signOutPending}
                  onSelect={(event) => {
                    event.preventDefault()
                    void signOut()
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span>Log out</span>
                  {signOutPending && (
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                </DropdownMenuItem>
              </>
            )}

            {!isAuthenticated && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/login">
                    <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>Log in</span>
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {isAuthenticated && <RingedAvatar image={user?.image} name={displayName} initials={initials} />}
      </div>
      {/*
        Only for a session. DialogContent renders through a Portal that Radix
        mounts on open, so an unauthenticated visitor never runs the settings
        tabs' queries either way — but nothing should be able to open a
        settings dialog that has no settings behind it.
      */}
      {isAuthenticated && <SettingsDialog defaultTab={defaultTab} email={user?.email} />}
    </Dialog>
  )
}

/**
 * The avatar, ringed (wordle-teams-x3m9).
 *
 * SITS TO THE RIGHT OF THE MENU TRIGGER, which is the owner's call and reads
 * correctly either way — what matters is that identity and control are not
 * interleaved with the bar's other content.
 *
 * IT IS NOT A BUTTON, AND THAT IS THE POINT RATHER THAN AN OMISSION. No
 * `role="button"`, no `cursor-pointer`, no click handler — clicking it does
 * nothing. v1 makes the ringed avatar ITSELF the dropdown trigger
 * (user-dropdown.tsx:117-123) and by the owner's own account users were not
 * finding it: an animated halo reads as a badge, not a control. v2 split the
 * two in Phase 6 and this keeps that split — the hamburger beside it is the
 * control, so the ring is free to be what it always looked like, decoration.
 * It still carries identity for a screen reader through AvatarImage's `alt`
 * and the fallback's letters.
 *
 * ONLY FOR A SIGNED-IN PLAYER, WHICH IS A FIX AND NOT PART OF THE PORT. Its
 * caller renders for signed-out visitors now (wordle-teams-lyab), and the
 * avatar came along with it — so /login and /about were showing a stranger an
 * empty grey circle with a generic person icon in it, since `initialsFor`
 * answers null with no name and no email. An avatar is identity; a visitor
 * with no account has none, and putting a spinning brand halo around that
 * would have made it louder rather than better.
 */
function RingedAvatar({
  image,
  name,
  initials,
}: {
  image?: string | null
  name: string
  initials: string | null
}) {
  const reducedMotion = useReducedMotion()

  return (
    <div className="relative flex-shrink-0">
      {/*
        THE RING IS A SIBLING BEHIND THE AVATAR, NOT A BORDER ON IT, because a
        border cannot hold a gradient. `-inset-0.5` makes it 2px larger on every
        side than the 32px avatar in front of it, so exactly that 2px shows as a
        ring. Avatar's own root class is already `relative` (ui/avatar.tsx), and
        it comes second in the DOM, so it paints on top with no z-index needed.

        `aria-hidden` — it is a decorative gradient, and the avatar beside it
        already carries the accessible name.
      */}
      <div
        aria-hidden="true"
        data-slot="avatar-ring"
        className={cn(
          'absolute -inset-0.5 rounded-full bg-gradient-to-r from-brand-from via-brand-via to-brand-to',
          // THE RING STAYS, ONLY THE ROTATION GOES. That is the opposite of
          // what ConfettiBurst does — it renders no pieces at all — and the
          // difference is that confetti IS motion, whereas this is a coloured
          // ring that happens to turn. Removing it entirely for a
          // reduced-motion viewer would take away a visual, not a movement.
          !reducedMotion && 'avatar-ring-spin',
        )}
      />
      <Avatar className="relative h-8 w-8">
        {image && <AvatarImage src={image} alt={name} />}
        {/*
          `text-xs`, NOT THE INHERITED SIZE. AvatarFallback sets no font size of
          its own, so the initials took the ambient 16px inside a 32px circle
          and touched its edge on both sides (wordle-teams-3hch).
        */}
        <AvatarFallback className="text-xs font-medium">
          {initials ?? <UserIcon className="h-4 w-4" aria-hidden="true" />}
        </AvatarFallback>
      </Avatar>
    </div>
  )
}

/**
 * Light / Dark / System, as a submenu — v1's shape
 * (user-dropdown.tsx:143-166), replacing v2's cycling "Auto" pill.
 *
 * A THREE-WAY CHOICE SHOULD NOT BE A ONE-BUTTON CYCLE. The pill showed the
 * CURRENT mode and its label gave no clue what the next click would produce,
 * so reaching "dark" from "auto" meant clicking twice and reading the button
 * in between. Three items show all three states and what picking one does.
 *
 * THE VALUE SHOWN IS THE MODE, NOT THE RESOLVED THEME: "System" stays selected
 * while the OS is dark, rather than the row silently reading "Dark". That
 * distinction is the whole reason `data-theme` is absent for 'auto'.
 */
function ThemeSubmenu({
  mode,
  onSelect,
}: {
  mode: ThemeMode
  onSelect: (mode: ThemeMode) => void
}) {
  const items: ReadonlyArray<{ value: ThemeMode; label: string; Icon: typeof Sun }> = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'dark', label: 'Dark', Icon: MoonStar },
    { value: 'auto', label: 'System', Icon: SunMoon },
  ]

  const active = items.find((item) => item.value === mode) ?? items[2]

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <active.Icon className="mr-2 h-4 w-4" aria-hidden="true" />
        <span>Theme</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          {items.map(({ value, label, Icon }) => (
            <DropdownMenuItem
              key={value}
              onClick={() => onSelect(value)}
              // The submenu is a menu, so the current choice is announced
              // rather than merely tinted. Radix's plain Item has no selected
              // state of its own; this is the same thing a RadioItem would
              // give, without swapping in its indicator column.
              aria-current={mode === value ? 'true' : undefined}
              className={mode === value ? 'font-semibold' : undefined}
            >
              <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
              <span>{label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}

export default AppMenu
