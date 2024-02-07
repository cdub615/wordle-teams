'use client'
import ModeToggle from '@/components/mode-toggle'
import { Separator } from '@/components/ui/separator'

// Error components must be Client Components

export default function Error() {
  return (
    <>
      <header className='h-0 invisible @md:h-fit @md:visible'>
        <div className='grid grid-cols-[1fr_auto_1fr] p-6'>
          <div className='col-start-2 flex justify-center items-center'>
            <h1 className='text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
              Wordle Teams
            </h1>
          </div>
          <div className='flex justify-end items-center space-x-4'>
            <ModeToggle />
          </div>
        </div>
        <Separator />
      </header>
      <div className='flex w-full justify-center'>
        <div className='flex flex-col max-w-lg items-center text-center pt-10 space-y-4'>
          <p className='text-xl'>Ruh roh, something went wrong!</p>
          <p className='text-muted-foreground'>
            Please try again. We are monitoring recurring issues so if your issue persists, we hope to have it
            resolved soon.
          </p>
        </div>
      </div>
      <footer className='@md:invisible @md:h-0'>
        <Separator />
        <div className='grid grid-cols-[1fr_auto_1fr] p-6'>
          <div className='col-start-2 flex justify-center items-center'>
            <h1 className='text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
              Wordle Teams
            </h1>
          </div>
          <div className='flex justify-end items-center space-x-4'>
            <ModeToggle />
          </div>
        </div>
      </footer>
    </>
  )
}
