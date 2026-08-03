'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { User } from '@/lib/types'
import { clearAllCookies } from '@/lib/utils'
import {
  CreditCard,
  Download,
  Info,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mails,
  MessagesSquare,
  MoonStar,
  Sparkles,
  Sun,
  SunMoon,
} from 'lucide-react'
import { log } from 'next-axiom'
import { useTheme } from 'next-themes'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MouseEventHandler, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getBillingPortalUrl, getCheckoutUrl } from '@/lib/polar/actions'
import { logout } from './actions'
import UserDialog from './user-dialog'

export default function UserDropdown({ userFromAppBar }: { userFromAppBar: User }) {
  const { setTheme } = useTheme()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showInstallButton, setShowInstallButton] = useState(false)
  const [user, setUser] = useState<User>(userFromAppBar)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [defaultTab, setDefaultTab] = useState<'notifications' | 'install'>('notifications')

  const proMember = user.memberStatus === 'pro'
  // Anyone who has ever subscribed has a Polar customer record worth linking to, even once the
  // subscription has lapsed. A lapsed player sees both entries: Billing to manage past invoices
  // or payment details, Upgrade to start again.
  const hasBillingAccount = ['pro', 'cancelled', 'expired'].includes(user.memberStatus)

  useEffect(() => {
    if (window) {
      const isStandalone =
        (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches
      setShowInstallButton(!isStandalone)
    }
  }, [])

  useEffect(() => {
    setUser(userFromAppBar)
  }, [userFromAppBar])

  const handleLogout: MouseEventHandler<HTMLDivElement> = async (e) => {
    e.preventDefault()
    setPending(true)
    await logout()
    localStorage.clear()
    clearAllCookies()
    router.push('/')
  }

  const handleUpgrade = async () => {
    setLoading(true)
    const { checkoutUrl, error } = await getCheckoutUrl()
    if (error) toast.error(error)
    // Full navigation rather than an overlay: no third-party script is loaded, and the customer
    // picks monthly or annual on Polar's own page.
    else if (checkoutUrl) window.location.href = checkoutUrl
    setLoading(false)
  }

  const sendToBillingPortal = async () => {
    setLoading(true)
    // No customerId guard any more — the column is gone, and the action resolves the Polar
    // customer from the session. It reports the "never checked out" case as its own message
    // rather than telling the player to retry something that can never succeed.
    const { url, error } = await getBillingPortalUrl()
    if (url) window.location.href = url
    else toast.error(error ?? 'Failed to open the billing portal, please try again later.')
    setLoading(false)
  }

  const handleNotificationsClick = () => {
    setDefaultTab('notifications')
    setDialogOpen(true)
  }

  const handleInstallClick = () => {
    setDefaultTab('install')
    setDialogOpen(true)
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className='relative' role='button' aria-label='User dropdown menu'>
            <div className='absolute -inset-0.5 rounded-full animate-spin-super-slow bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'></div>
            <Avatar className='relative cursor-pointer'>
              <AvatarImage src={user.avatarUrl} alt='Avatar' />
              <AvatarFallback>{`${user.initials}`}</AvatarFallback>
            </Avatar>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-56'>
          <DropdownMenuLabel className='flex justify-between'>
            <span>
              {user.firstName} {user.lastName}
            </span>
            <Badge variant={proMember ? 'success' : 'default'}>{proMember ? 'Pro' : 'Free'}</Badge>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <Link href='/me'>
            <DropdownMenuItem>
              <LayoutDashboard className='mr-2 h-4 w-4' />
              <span>Dashboard</span>
            </DropdownMenuItem>
          </Link>
          <DropdownMenuItem onClick={handleNotificationsClick}>
            <Mails className='mr-2 h-4 w-4' />
            <span>Notifications</span>
          </DropdownMenuItem>
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Sun className='h-4 w-4 mr-2 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0' />
                <MoonStar className='absolute h-4 w-4 mr-2 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100' />
                <span>Theme</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => setTheme('light')}>
                    <Sun className='mr-2 h-4 w-4' />
                    <span>Light</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme('dark')}>
                    <MoonStar className='mr-2 h-4 w-4' />
                    <span>Dark</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme('system')}>
                    <SunMoon className='mr-2 h-4 w-4' />
                    <span>System</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          {hasBillingAccount && (
            <DropdownMenuItem onClick={sendToBillingPortal}>
              <CreditCard className='mr-2 h-4 w-4' />
              <span>Billing</span>
              {loading && <Loader2 className='ml-2 h-4 w-4 animate-spin' />}
            </DropdownMenuItem>
          )}
          {!proMember && (
            <DropdownMenuItem onClick={handleUpgrade}>
              <Sparkles className='mr-2 h-4 w-4' />
              <span>Upgrade</span>
              {loading && <Loader2 className='ml-2 h-4 w-4 animate-spin' />}
            </DropdownMenuItem>
          )}
          {!proMember && user.invitesPendingUpgrade > 0 && (
            <DropdownMenuItem className='focus:bg-transparent'>
              <Mails className='mr-2 h-4 w-4' />
              <span>
                {user.invitesPendingUpgrade} Invite{user.invitesPendingUpgrade === 1 ? '' : 's'} Pending
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <Link href='https://feedback.wordleteams.com'>
            <DropdownMenuItem>
              <MessagesSquare className='mr-2 h-4 w-4' />
              <span>Feedback</span>
            </DropdownMenuItem>
          </Link>
          <Link href='/about'>
            <DropdownMenuItem>
              <Info className='mr-2 h-4 w-4' />
              <span>About</span>
            </DropdownMenuItem>
          </Link>
          <DropdownMenuSeparator />
          {showInstallButton && (
            <DropdownMenuItem onClick={handleInstallClick}>
              <Download className='mr-2 h-4 w-4' />
              <span>Install</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleLogout} aria-disabled={pending} disabled={pending}>
            <LogOut className='mr-2 h-4 w-4' />
            <span>Log out</span>
            {pending && <Loader2 className='ml-2 h-4 w-4 animate-spin' />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <UserDialog user={user} setUser={setUser} defaultTab={defaultTab} />
    </Dialog>
  )
}
