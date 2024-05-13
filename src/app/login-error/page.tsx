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
      <div className='max-w-lg'>
        <div className='text-3xl md:text-4xl text-center font-semibold leading-loose mb-6'>
          Login / Signup Failed
        </div>
        <div className='text-muted-foreground text-center mb-4'>Please try again</div>
        <div className='text-xs text-muted-foreground text-center mb-4'>
          <b>*</b> some email clients open a preview window when you copy the link which makes it expire. If
          possible, click the button in the email.
        </div>
        <div className='text-xs text-muted-foreground text-center'>
          <b>*</b> if you came from an invite, you can proceed with Signup and the team's creator can add you.
        </div>
        <div className='flex justify-center'>
          <Link href='/login' className='text-center mt-6'>
            <Button>Head to Login / Signup</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
