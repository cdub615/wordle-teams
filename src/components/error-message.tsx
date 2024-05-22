'use client'

import { Button } from '@/components/ui/button'
import { log } from 'next-axiom'
import Link from 'next/link'
import { useEffect } from 'react'

type ErrorMessageProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorMessage({ error, reset }: ErrorMessageProps) {
  useEffect(() => {
    log.error(error.message, { error })
  }, [error])

  return (
    <div className='flex w-full justify-center'>
      <div className='flex flex-col max-w-lg items-center text-center pt-10 space-y-4'>
        <p className='text-xl'>Ruh roh, something went wrong!</p>
        <p className='text-muted-foreground'>
          Please try again. If the issue persists, let us know at{' '}
          <Link href='https://feedback.wordleteams.com'>feedback.wordleteams.com</Link>
        </p>
        <Button onClick={() => reset()}>Try again</Button>
      </div>
    </div>
  )
}
