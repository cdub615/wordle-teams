import About from '@/components/about'
import { TeamsProvider } from '@/lib/contexts/teams-context'

import { Button } from '@/components/ui/button'
import AnimatedGradientText from '@/components/ui/magicui/animated-gradient-text'
import { createClient } from '@/lib/supabase/server'
import { User } from '@/lib/types'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTeams } from '../me/utils'

const title = (
  <AnimatedGradientText>
    <h1 className='text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-center leading-tight md:leading-tight lg:leading-snug animate-gradient bg-gradient-to-r from-green-600 via-yellow-300 to-green-600 bg-[length:var(--bg-size)_100%] bg-clip-text text-transparent'>
      Wordle Teams
    </h1>
  </AnimatedGradientText>
)

const actionButton = (
  <div className='flex w-full justify-center'>
    <Link href='/me' className='group/dashboard-button'>
      <Button className='w-full' variant={'secondary'}>
        Go to Dashboard &nbsp;{' '}
        <span className='transition-transform duration-300 ease-in-out group-hover/dashboard-button:translate-x-0.5'>
          &rarr;
        </span>
      </Button>
    </Link>
  </div>
)

export default async function Page() {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  const { _user, teams, hasSession } = await getTeams(supabase)
  if (!hasSession) redirect('/login')

  let user: User = _user!
  return (
    <TeamsProvider initialTeams={teams} _user={user}>
      <About title={title} actionButton={actionButton} />
    </TeamsProvider>
  )
}
