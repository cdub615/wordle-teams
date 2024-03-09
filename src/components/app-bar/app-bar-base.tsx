'use client'

import ModeToggle from '@/components/mode-toggle'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { User } from '@/lib/types'
import { Loader2, LogOut } from 'lucide-react'
import { useState } from 'react'
import logout from './actions'

type AppBarBaseProps = {
  user?: User
}

export default function AppBarBase({ user }: AppBarBaseProps) {
  const [pending, setPending] = useState(false)
  const handleLogout = async () => {
    setPending(true)
    await logout()
    setPending(false)
  }
  return (
    <header>
      <div className='flex justify-between px-4 py-2 md:p-6'>
        <div className='flex justify-center items-center'>
          <h1 className='text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
            Wordle Teams
          </h1>
        </div>
        <div className='flex justify-end items-center space-x-2 md:space-x-4'>
          {user && (
            <Avatar>
              {/* <AvatarImage src='' alt='@username' /> */}
              <AvatarFallback>{`${user.firstName[0]}${user.lastName[0]}`}</AvatarFallback>
            </Avatar>
          )}
          <ModeToggle />
          {user && (
            <Popover>
              <PopoverTrigger>
                <Button variant='outline' size='icon' type='button'>
                  <LogOut size={18} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-auto'>
                <div className='flex flex-col space-y-4'>
                  <div>Are you sure you want to log out?</div>
                  <Button
                    type='submit'
                    variant={'secondary'}
                    aria-disabled={pending}
                    disabled={pending}
                    onClick={handleLogout}
                  >
                    {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                    Log Out
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
      <Separator />
    </header>
  )
}
