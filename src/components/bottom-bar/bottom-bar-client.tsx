'use client'

import ModeToggle from '@/components/mode-toggle'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { createClient } from '@/lib/supabase/client'
import { User } from '@/lib/types'
import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'

const BottomBarClientComponent = ({ user }: { user: User | undefined }) => {
  const router = useRouter()
  const supabase = createClient()

  const logout = async () => {
    await supabase.auth.signOut()
    router.refresh()
  }

  return (
    <footer className='@md:invisible @md:h-0'>
      <Separator />
      <div className='grid grid-cols-[1fr_auto_1fr] p-6'>
        <div className='col-start-2 flex justify-center items-center'>
          <h1 className='text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
            Wordle Teams
          </h1>
        </div>
        <div className='flex justify-end items-center space-x-4'>
          {user && (
            <Avatar>
              {/* <AvatarImage src='' alt='@username' /> */}
              <AvatarFallback>{`${user.firstName[0]}${user.lastName[0]}`}</AvatarFallback>
            </Avatar>
          )}
          <ModeToggle />
          <Button size={'icon'} variant={'outline'} onClick={logout}>
            <LogOut size={18} />
          </Button>
        </div>
      </div>
    </footer>
  )
}

export default BottomBarClientComponent
