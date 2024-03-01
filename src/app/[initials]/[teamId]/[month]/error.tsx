'use client'

import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function Error() {
  return (
    <div className='flex w-full justify-center'>
      <div className='flex flex-col max-w-lg items-center text-center pt-10 space-y-4'>
        <p className='text-xl'>Ruh roh, something went wrong!</p>
        <p className='text-muted-foreground'>
          Please try again. We are monitoring recurring issues so if your issue persists, we hope to have it
          resolved soon.
        </p>
        <Link href={'/'}>
          <Button>Back to safety</Button>
        </Link>
      </div>
    </div>
  )
}
