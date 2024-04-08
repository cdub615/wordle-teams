'use client'

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
import { getCustomerPortalUrl } from '@/lib/lemonsqueezy'
import { createClient } from '@/lib/supabase/client'
import { User } from '@/lib/types'
import { cn } from '@/lib/utils'
import { kv } from '@vercel/kv'
import { CreditCard, Loader2, LogOut, MoonStar, Sparkles, Sun, SunMoon } from 'lucide-react'
import { log } from 'next-axiom'
import { useTheme } from 'next-themes'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getCheckoutUrl, logout } from './actions'

export default function UserDropdown({ user }: { user: User }) {
  const supabase = createClient()
  const { setTheme } = useTheme()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [proMember, setProMember] = useState(user.memberStatus === 'pro')
  const handleLogout = async () => {
    setPending(true)
    await logout()
    setPending(false)
  }

  useEffect(() => {
    const checkKv = async () => {
      const refresh = await kv.getdel<boolean>(`${process.env.ENVIRONMENT}_${user.id}`)
      if (refresh !== null && refresh) {
        const { error } = await supabase.auth.refreshSession()
        if (error) log.error(error.message)
        router.refresh()
      }
    }

    checkKv()
  }, [])

  // useEffect(() => {
  //   const getPlayerCustomer = async () => {
  //     const { data, error } = await supabase
  //       .from('player_customer')
  //       .select('*')
  //       .eq('player_id', user.id)
  //       .maybeSingle()
  //     if (error) log.error(error.message)
  //     if (data && data.membership_status !== user.memberStatus) setProMember(data.membership_status === 'pro')
  //   }
  //   getPlayerCustomer()
  // }, [supabase])

  const handleUpgrade = async () => {
    setLoading(true)
    const { checkoutUrl, error } = await getCheckoutUrl(user)
    if (error) toast.error(error)
    else if (checkoutUrl) window.LemonSqueezy.Url.Open(checkoutUrl)
    setLoading(false)
  }

  /*  TODO

    configure custom auth hook in prod

    score customization

    invite logic for free members

    prevent authapi error due to refresh token expiration

    update og and store images

    teams boards card with date picker and carousel

  */

  const sendToBillingPortal = async () => {
    setLoading(true)
    if (!user.customerId) {
      log.warn(`Billing link showed but no customer id for user ${user.id}`)
      toast.error('Failed to send to billing portal, please try again later.')
    } else {
      const url = await getCustomerPortalUrl(user.customerId)
      if (url) window.LemonSqueezy.Url.Open(url)
      else toast.error('Failed to send to billing portal, please try again later.')
    }
    setLoading(false)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar
          className={cn(
            loading && 'animate-pulse',
            'cursor-pointer p-0.5 bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'
          )}
        >
          {/* <AvatarImage src='' alt='@username' /> */}
          <AvatarFallback className='bg-background p-2'>{`${user.initials}`}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-56'>
        <DropdownMenuLabel className='flex justify-between'>
          <span>
            {user.firstName} {user.lastName}
          </span>
          <Badge variant={proMember ? 'success' : 'default'}>{proMember ? 'Pro' : 'Free'}</Badge>
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
        {proMember ? (
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
        <DropdownMenuItem onClick={handleLogout} aria-disabled={pending} disabled={pending}>
          <LogOut className='mr-2 h-4 w-4' />
          <span>Log out</span>
          {pending && <Loader2 className='ml-2 h-4 w-4 animate-spin' />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
