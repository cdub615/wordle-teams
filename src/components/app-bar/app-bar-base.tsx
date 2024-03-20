'use client'

import { Separator } from '@/components/ui/separator'
import { User } from '@/lib/types'
import Script from 'next/script'
import { useEffect } from 'react'
import UserDropdown from './user-dropdown'

type AppBarBaseProps = {
  user?: User
}

export default function AppBarBase({ user }: AppBarBaseProps) {
  useEffect(() => {
    window.createLemonSqueezy()
  }, [])
  return (
    <header>
      <Script src='https://app.lemonsqueezy.com/js/lemon.js' strategy='beforeInteractive'></Script>
      <div className='flex justify-between px-4 py-2 md:py-6 md:px-12'>
        <div className='flex justify-center items-center'>
          <h1 className='text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
            Wordle Teams
          </h1>
        </div>
        <div className='flex justify-end items-center space-x-2 md:space-x-4'>
          {user && <UserDropdown user={user} />}
        </div>
      </div>
      <Separator />
    </header>
  )
}
