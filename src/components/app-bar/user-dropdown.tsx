'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
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
import { getCustomerPortalUrl } from '@/lib/lemonsqueezy'
import { User } from '@/lib/types'
import { clearAllCookies } from '@/lib/utils'
import { DotsHorizontalIcon } from '@radix-ui/react-icons'
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
  Share,
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
import { getCheckoutUrl, logout } from './actions'

export default function UserDropdown({ user }: { user: User }) {
  const { setTheme } = useTheme()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showInstallButton, setShowInstallButton] = useState(false)
  const proMember = user.memberStatus === 'pro'

  useEffect(() => {
    if (window) {
      const isStandalone =
        (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches
      setShowInstallButton(!isStandalone)
    }
  }, [])

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
    const { checkoutUrl, error } = await getCheckoutUrl(user)
    if (error) toast.error(error)
    else if (checkoutUrl) window.LemonSqueezy.Url.Open(checkoutUrl)
    setLoading(false)
  }

  const sendToBillingPortal = async () => {
    setLoading(true)
    if (!user.customerId) {
      log.warn(`Billing link showed but no customer id for user ${user.id}`)
      toast.error('Failed to send to billing portal, please try again later.')
    } else {
      const url = await getCustomerPortalUrl(user.customerId)
      if (url) router.push(url)
      else toast.error('Failed to send to billing portal, please try again later.')
    }
    setLoading(false)
  }
  return (
    <Dialog>
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
          {/* <DialogTrigger asChild>
            <DropdownMenuItem>
              <Mails className='mr-2 h-4 w-4' />
              <span>Notifications</span>
            </DropdownMenuItem>
          </DialogTrigger> */}
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
          {proMember ? (
            <DropdownMenuItem onClick={sendToBillingPortal}>
              <CreditCard className='mr-2 h-4 w-4' />
              <span>Billing</span>
              {loading && <Loader2 className='ml-2 h-4 w-4 animate-spin' />}
            </DropdownMenuItem>
          ) : (
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
            <DialogTrigger asChild>
              <DropdownMenuItem>
                <Download className='mr-2 h-4 w-4' />
                <span>Install</span>
              </DropdownMenuItem>
            </DialogTrigger>
          )}
          <DropdownMenuItem onClick={handleLogout} aria-disabled={pending} disabled={pending}>
            <LogOut className='mr-2 h-4 w-4' />
            <span>Log out</span>
            {pending && <Loader2 className='ml-2 h-4 w-4 animate-spin' />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DialogContent className='w-11/12 px-2 py-4 md:p-6'>
        <DialogHeader>
          <DialogTitle>
            {user.firstName} {user.lastName}
          </DialogTitle>
        </DialogHeader>
        <div className='flex flex-col space-y-1.5 px-2 py-6 md:p-6'>
          <h3 className='text-2xl font-semibold leading-none tracking-tight'>Installation</h3>
          <p className='text-sm text-muted-foreground'>To install Wordle Teams as an app</p>
        </div>
        <div className='px-2 py-6 md:px-6 md:pb-6 pt-0'>
          <ul className='list-decimal text-sm md:text-base ml-4'>
            <li className='mb-2'>
              Tap the three-dot menu icon{' '}
              <span className='inline-flex'>
                <DotsHorizontalIcon />
              </span>{' '}
              or the Share icon <Share className='inline-flex' size={18} />
            </li>
            <li className='mb-2'>Select &quot;Add to Home Screen&quot; or &quot;Install app&quot;</li>
            <li>Confirm by tapping &quot;Install&quot; or &quot;Add&quot;</li>
          </ul>
        </div>
        {/* <Tabs defaultValue='notifications'>
          <TabsList>
            <TabsTrigger value='notifications'>Notifications</TabsTrigger>
            <TabsTrigger value='settings'>Settings</TabsTrigger>
            <TabsTrigger value='install'>Install Guide</TabsTrigger>
          </TabsList>
          <TabsContent value='notifications'>
            <div className='flex flex-col space-y-1.5 px-2 py-6 md:p-6'>
              <h3 className='text-2xl font-semibold leading-none tracking-tight'>Your Notifications</h3>
              <p className='text-sm text-muted-foreground'>Review and manage your notifications</p>
            </div>
            <div className='px-2 py-6 md:px-6 md:pb-6 pt-0'>content</div>
          </TabsContent>
          <TabsContent value='settings'>
            <div className='flex flex-col space-y-1.5 px-2 py-6 md:p-6'>
              <h3 className='text-2xl font-semibold leading-none tracking-tight'>Settings</h3>
              <p className='text-sm text-muted-foreground'>Manage your settings here</p>
            </div>
            <div className='px-2 py-6 md:px-6 md:pb-6 pt-0'>content</div>
          </TabsContent>
          <TabsContent value='install'>
            <div className='flex flex-col space-y-1.5 px-2 py-6 md:p-6'>
              <h3 className='text-2xl font-semibold leading-none tracking-tight'>Installation</h3>
              <p className='text-sm text-muted-foreground'>To install Wordle Teams as an app</p>
            </div>
            <div className='px-2 py-6 md:px-6 md:pb-6 pt-0'>
              <ul className='list-decimal text-sm md:text-base ml-4'>
                <li className='mb-2'>
                  Tap the three-dot menu icon{' '}
                  <span className='inline-flex'>
                    <DotsHorizontalIcon />
                  </span>{' '}
                  or the Share icon <Share className='inline-flex' size={18} />
                </li>
                <li className='mb-2'>Select &quot;Add to Home Screen&quot; or &quot;Install app&quot;</li>
                <li>Confirm by tapping &quot;Install&quot; or &quot;Add&quot;</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs> */}
      </DialogContent>
    </Dialog>
  )
}
