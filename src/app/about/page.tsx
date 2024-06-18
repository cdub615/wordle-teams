import About from '@/components/about'
import { TeamsProvider } from '@/lib/contexts/teams-context'

import { Button } from '@/components/ui/button'
import { User } from '@/lib/types'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTeams } from '../me/utils'

export default async function Page() {
  const { _user, teams, hasSession } = await getTeams()
  if (!hasSession) redirect('/login')

  let user: User = _user!
  return (
    <TeamsProvider initialTeams={teams} _user={user}>
      <div className='flex flex-col py-12 md:py-20 space-y-8 md:space-y-16'>
        <h1 className='text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-center leading-tight md:leading-tight lg:leading-snug'>
          Wordle Teams
        </h1>
        <About />
        <div className='flex w-full justify-center'>
          <Link href='/me' className='group/dashboard-button'>
            <Button className='w-full' variant={'secondary'}>Go to Dashboard &nbsp; <span className='transition-transform duration-300 ease-in-out group-hover/dashboard-button:translate-x-0.5'>&rarr;</span></Button>
          </Link>
        </div>
      </div>
    </TeamsProvider>
  )
}
