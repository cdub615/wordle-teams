import ModeToggle from '@/components/mode-toggle'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { createClient } from '@/lib/supabase/server'
import { User } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { LogOut } from 'lucide-react'
import { cookies } from 'next/headers'
import logout from '../actions'

export default async function BottomBar() {
  const supabase = createClient(cookies())
  const session = await getSession(supabase)

  let user: User | undefined = undefined

  if (session) {
    const firstName = session?.user.user_metadata.firstName
    const lastName = session?.user.user_metadata.lastName
    const email = session?.user.email
    user = { firstName, lastName, email }
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
          {user && (
            <form action={logout}>
              <Button size={'icon'} variant={'outline'}>
                <LogOut size={18} />
              </Button>
            </form>
          )}
        </div>
      </div>
    </footer>
  )
}
