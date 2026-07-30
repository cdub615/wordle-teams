'use client'

import ModeToggle from '@/components/mode-toggle'
import { Separator } from '@/components/ui/separator'
import { createClient } from '@/lib/supabase/client'
import { User } from '@/lib/types'
import { getUserFromSession } from '@/lib/utils'
import { log } from 'next-axiom'
// import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { useEffect, useState } from 'react'
import UserDropdown from './user-dropdown'

// Mapping of JS time zones to PostgreSQL time zones
const timeZoneMapping: { [key: string]: string } = {
  'Asia/Kolkata': 'Asia/Calcutta',
  'Asia/Kathmandu': 'Asia/Katmandu',
  'Asia/Yangon': 'Asia/Rangoon',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  // Add more mappings as needed
}

type AppBarBaseProps = {
  userFromServer?: User
}

export default function AppBarBase({ userFromServer }: AppBarBaseProps) {
  const [user, setUser] = useState<User | undefined>(userFromServer)
  const router = useRouter()
  const supabase = createClient() as any

  // Runs from the <Script> onReady below, so it only fires once lemon.js has
  // actually executed. Still guarded: if the script is blocked (ad blockers and
  // corporate/school DNS filters routinely block lemonsqueezy.com) these globals
  // are undefined, and throwing here would take down whatever page the app bar
  // is rendered in. Checkout is a nice-to-have; signing in is not.
  const setupLemonSqueezy = () => {
    if (typeof window.createLemonSqueezy !== 'function') {
      log.warn('LemonSqueezy script unavailable; checkout events will not be handled')
      return
    }
    window.createLemonSqueezy()
    window.LemonSqueezy?.Setup({
      eventHandler: async (data) => {
        if (data.event == 'Checkout.Success') {
          // revalidatePath('/me', 'layout')
          const { data, error } = await supabase.auth.refreshSession()
          if (error) {
            log.error(error.message)
          }
          if (data?.session) {
            setUser(await getUserFromSession(supabase))
          }
          router.refresh()
        }
      },
    })
  }

  useEffect(() => {
    if (window) {
      const isStandalone =
        (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches
      if (isStandalone && user && !user.hasPwa) {
        const userId = user.id
        supabase
          .from('players')
          .update({ has_pwa: true })
          .eq('id', userId)
          .then(({ error }: { error: any }) => {
            if (error) log.error(`Failed to set has_pwa for player ${userId}`, { error })
          })

        setUser({ ...user, hasPwa: true })
      }
    }

    const defaultTzIfMissing = async () => {
      if (user) {
        if (!user.timeZone || user.timeZone.length === 0) {
          const jsTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
          const mappedTimeZone = timeZoneMapping[jsTimeZone] || jsTimeZone

          user.timeZone = mappedTimeZone
          const { error: updateError } = await supabase
            .from('players')
            .update({ time_zone: mappedTimeZone })
            .eq('id', user.id)

          if (updateError) log.error(`Failed to set time_zone for player ${user.id}`, { updateError })

          setUser({ ...user, timeZone: mappedTimeZone })
        }
      }
    }
    defaultTzIfMissing()
  }, [])
  return (
    <header>
      {/*
        onReady (not onLoad) so setup also runs on remount when the script is
        already cached. strategy is afterInteractive because beforeInteractive is
        only honoured in the root layout — here it silently degraded, which is how
        the effect ended up racing an unloaded script.
      */}
      <Script
        src='https://app.lemonsqueezy.com/js/lemon.js'
        strategy='afterInteractive'
        onReady={setupLemonSqueezy}
        onError={() => log.warn('LemonSqueezy script failed to load; checkout events will not be handled')}
      />
      <div className='flex justify-between px-4 py-2 md:py-6 md:px-12'>
        <div className='flex justify-center items-center'>
          <Link href='/home'>
            <h1 className='drop-shadow-lg dark:drop-shadow-none text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
              Wordle Teams
            </h1>
          </Link>
        </div>
        <div className='flex justify-end items-center space-x-2 md:space-x-4'>
          {user && <UserDropdown userFromAppBar={user} />}
          {!user && <ModeToggle variant='ghost' />}
        </div>
      </div>
      <Separator />
    </header>
  )
}
