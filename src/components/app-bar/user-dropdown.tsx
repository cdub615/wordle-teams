import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
import { CreditCard, Loader2, LogOut, MoonStar, Sparkles, Sun, SunMoon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { redirect } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getCheckoutUrl, logout } from './actions'

export default function UserDropdown({ user }: { user: User }) {
  const { setTheme } = useTheme()
  const [pending, setPending] = useState(false)
  const [checkoutUrl, setCheckoutUrl] = useState<string | undefined>(undefined)
  const [checkoutError, setCheckoutError] = useState<string | undefined>(undefined)
  const handleLogout = async () => {
    setPending(true)
    await logout()
    setPending(false)
  }
  const memberStatus = user.memberStatus === 'pro' ? 'Pro' : 'Free'
  useEffect(() => {
    const customCheckoutUrl = async () => {
      const { checkoutUrl, error } = await getCheckoutUrl(user)
      if (error) setCheckoutError(error)
      if (checkoutUrl) setCheckoutUrl(checkoutUrl)
    }
    if (!checkoutUrl && user.memberStatus !== 'pro') customCheckoutUrl()
  }, [checkoutUrl])
  const handleUpgrade = () => {
    if (checkoutError) toast.error(checkoutError)
    if (checkoutUrl) window.LemonSqueezy.Url.Open(checkoutUrl)
  }
  const sendToBillingPortal = () => {
    if (user.billingPortalUrl) redirect(user.billingPortalUrl)
    else toast.error('Failed to send to billing portal, please try again later.')
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar className='cursor-pointer p-0.5 bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
          {/* <AvatarImage src='' alt='@username' /> */}
          <AvatarFallback className='bg-background p-2'>{`${user.initials}`}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-56'>
        <DropdownMenuLabel className='flex justify-between'>
          <span>
            {user.firstName} {user.lastName}
          </span>
          <Badge variant={memberStatus === 'Pro' ? 'success' : 'default'}>{memberStatus}</Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* <DropdownMenuItem>
            <UserIcon className='mr-2 h-4 w-4' />
            <span>Profile</span>
          </DropdownMenuItem> */}
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
          {/* <DropdownMenuItem>
            <Plus className='mr-2 h-4 w-4' />
            <span>New Team</span>
          </DropdownMenuItem> */}
        </DropdownMenuGroup>
        {user.memberStatus === 'pro' ? (
          <DropdownMenuItem onClick={sendToBillingPortal}>
            <CreditCard className='mr-2 h-4 w-4' />
            <span>Billing</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={handleUpgrade}>
            <Sparkles className='mr-2 h-4 w-4' />
            <span>Upgrade</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleLogout()} aria-disabled={pending} disabled={pending}>
          <LogOut className='mr-2 h-4 w-4' />
          <span>Log out</span>
          {pending && <Loader2 className='ml-2 h-4 w-4 animate-spin' />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
