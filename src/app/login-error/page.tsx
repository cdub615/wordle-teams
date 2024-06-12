'use client'

import { Button } from '@/components/ui/button'
import { clearAllCookies } from '@/lib/utils'
import Link from 'next/link'
import { useEffect } from 'react'

export default function Page() {
  useEffect(() => {
    clearAllCookies()
  }, [])

  return (
    <div className='flex justify-center my-12'>
      <div className='max-w-sm'>
        <div className='text-3xl md:text-4xl text-center font-semibold leading-loose mb-6'>
          Sign In Failed
        </div>
        <div className='text-muted-foreground text-center mb-4'>Please try again</div>
        <div className='text-xs text-muted-foreground text-center mb-4'>
          <b>*</b> sometimes the first login with a sign in provider fails when redirecting to Wordle Teams.
        </div>
        <div className='text-xs text-muted-foreground text-center'>
          <b>*</b> a One Time Passcode &#40;OTP&#41; will expire after 1 hour. If your email has been delayed you may need to try again.
        </div>
        <div className='flex justify-center'>
          <Link href='/login' className='text-center mt-6'>
            <Button>Head to Sign In</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
