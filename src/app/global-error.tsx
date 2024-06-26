'use client'
import AppBar from '@/components/app-bar/app-bar-base'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <AppBar />
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
