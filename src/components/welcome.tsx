import AppBar from '@/components/app-bar/app-bar-base'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/utils'
import { GeistSans } from 'geist/font/sans'
import { cookies } from 'next/headers'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function Welcome({ autoRedirect = true }: { autoRedirect?: boolean }) {
  if (autoRedirect) {
    const cookieStore = cookies()
    const supabase = createClient(cookieStore)
    const session = await getSession(supabase)
    if (session) redirect('/me')
  }

  return (
    <div className='flex flex-col w-full'>
      <AppBar />
      <h1 className={`${GeistSans.className} pt-8 md:pt-16 pb-2 text-center text-3xl md:text-6xl`}>
        Compete with friends
      </h1>
      <span className='text-muted-foreground text-lg text-center md:leading-loose'>
        Keep score among friends to establish Wordle bragging rights
      </span>
      <div className='flex justify-center'>
        <Link href='/login' className='text-center mt-4'>
          <Button>Get Started</Button>
        </Link>
      </div>
      <Image
        src='/welcome-screenshot.png'
        alt='Wordle Teams Dashboard'
        width={1000}
        height={800}
        className='my-8 mx-auto rounded-lg'
        priority
      />
      <span className='text-muted-foreground text-xs md:text-sm fixed bottom-4 text-center w-full leading-loose'>
        Built by{' '}
        <Link href='https://github.com/cdub615' className='underline underline-offset-4'>
          Christian White
        </Link>
        . Follow us on{' '}
        <Link href='https://twitter.com/wordleteams' className='underline underline-offset-4'>
          X
        </Link>
        . View source code in{' '}
        <Link href='https://github.com/cdub615/wordle-teams' className='underline underline-offset-4'>
          GitHub
        </Link>
        .
        <Link href={'/privacy'} className='ml-6'>
          Privacy Policy
        </Link>
        <Link href={'/terms'} className='ml-6'>
          Terms
        </Link>
      </span>
    </div>
  )
}
