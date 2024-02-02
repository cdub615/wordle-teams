import ModeToggle from '@/components/mode-toggle'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/utils'
import { GeistSans } from 'geist/font/sans'
import { cookies } from 'next/headers'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function Welcome() {
  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (session?.user) {
    const { data } = await supabase.from('profiles').select('first_name, last_name').single()
    if (data && data.first_name && data.last_name) {
      const initials = `${data.first_name[0]}${data.last_name[0]}`
      redirect(`/${initials}`)
    }
  }
  return (
    <div className='flex flex-col w-full'>
      <header>
        <div className='grid grid-cols-[auto_1fr] p-4 md:py-4 md:px-6'>
          <div className='flex justify-center items-center'>
            <h1 className='text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
              Wordle Teams
            </h1>
          </div>
          <div className='flex justify-end items-center space-x-4'>
            <ModeToggle />
          </div>
        </div>
        <Separator />
      </header>
      <h1 className={`${GeistSans.className} pt-8 md:pt-16 pb-2 text-center text-3xl md:text-6xl`}>
        Compete with your friends
      </h1>
      <span className='text-muted-foreground text-lg text-center md:leading-loose'>
        Keep score among friends to establish Wordle bragging rights
      </span>
      <div className='flex justify-center'>
        <Link href='/login' className='text-center mt-4'>
          <Button>Login / Signup</Button>
        </Link>
      </div>
      <Image
        src='/wt-home-dark-lg.png'
        alt='Wordle Teams Dashboard'
        width={1000}
        height={800}
        className='my-8 mx-auto'
        priority
      />
      <span className='text-muted-foreground text-xs md:text-sm fixed bottom-4 text-center w-full'>
        Built by{' '}
        <Link href='https://twitter.com/cwhitedev' className='underline underline-offset-4'>
          cwhitedev
        </Link>
        . View source code on{' '}
        <Link href='https://github.com/cdub615/wordle-teams' className='underline underline-offset-4'>
          GitHub
        </Link>
        .
      </span>
    </div>
  )
}
