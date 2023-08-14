'use client'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Database } from '@/lib/database.types'
import { User } from '@/lib/types'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import ModeToggle from '@/components/mode-toggle'

const BottomBarClientComponent = ({ user }: { user: User | undefined }) => {
  const router = useRouter()
  const supabase = createClientComponentClient<Database>()

  const logout = async () => {
    await supabase.auth.signOut()
    router.refresh()
  }

  return (
    <footer className='@md:invisible @md:h-0'>
      <Separator />
      <div className='flex justify-end items-center p-6 space-x-4'>
        <h1 className='text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
          Wordle Teams
        </h1>
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
    </footer>
  )
}

export default BottomBarClientComponent
