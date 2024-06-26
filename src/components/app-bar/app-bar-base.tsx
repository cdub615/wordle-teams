'use client'

import ModeToggle from '@/components/mode-toggle'
import { Separator } from '@/components/ui/separator'
import { createClient } from '@/lib/supabase/client'
import { User } from '@/lib/types'
import { getUserFromSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { useEffect } from 'react'
import UserDropdown from './user-dropdown'

type AppBarBaseProps = {
  user?: User
}

export default function AppBarBase({ user }: AppBarBaseProps) {
  const router = useRouter()
  const supabase = createClient()
  useEffect(() => {
    window.createLemonSqueezy()
    window.LemonSqueezy.Setup({
      eventHandler: async (data) => {
        if (data.event == 'Checkout.Success') {
          revalidatePath('/me', 'layout')
          const { data, error } = await supabase.auth.refreshSession()
          if (error) {
            log.error(error.message)
          }
          if (data?.session) {
            user = getUserFromSession(data.session)
          }
          router.refresh()
        }
      },
    })
  }, [])
  return (
    <header>
      <Script src='https://app.lemonsqueezy.com/js/lemon.js' strategy='beforeInteractive'></Script>
      <div className='flex justify-between px-4 py-2 md:py-6 md:px-12'>
        <div className='flex justify-center items-center'>
          <Link href='/home'>
            <h1 className='drop-shadow-lg dark:drop-shadow-none text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
              Wordle Teams
            </h1>
          </Link>
        </div>
        <div className='flex justify-end items-center space-x-2 md:space-x-4'>
          {user && <UserDropdown user={user} />}
          {!user && <ModeToggle variant='ghost' />}
        </div>
      </div>
      <Separator />
    </header>
  )
}
