import ModeToggle from '@/components/mode-toggle'
import SubmitButton from '@/components/submit-button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { createClient } from '@/lib/supabase/server'
import { User } from '@/lib/types'
import { getUser } from '@/lib/utils'
import { LogOut } from 'lucide-react'
import { cookies } from 'next/headers'
import logout from '../actions'

export default async function TopBar() {
  const supabase = createClient(cookies())
  const dbUser = await getUser(supabase)

  let user: User | undefined = undefined

  if (dbUser) {
    const firstName = dbUser.user_metadata.firstName
    const lastName = dbUser.user_metadata.lastName
    const email = dbUser.email
    user = { firstName, lastName, email }
  }

  return (
    <header className='h-0 invisible @md:h-fit @md:visible'>
      <div className='grid grid-cols-[1fr_auto_1fr] p-6'>
        <div className='col-start-2 flex justify-center items-center'>
          <h1 className='text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
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
              <SubmitButton>
                <LogOut size={18} />
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
      <Separator />
    </header>
  )
}
