'use client'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import Error from 'next/error'

// Deliberately renders no app chrome. This boundary previously rendered
// <AppBar />, which is itself a common source of the errors it was catching —
// the fallback re-threw on every render and spun the page into an infinite
// loop that pegged the main thread. An error fallback must not depend on
// anything that can fail.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])
  return (
    <>
      <header className='flex px-4 py-2 md:py-6 md:px-12'>
        <Link href='/home'>
          <h1 className='text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400'>
            Wordle Teams
          </h1>
        </Link>
      </header>
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
    </>
  )
}
