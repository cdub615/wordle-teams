import AppBar from '@/components/app-bar/app-bar-base'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function NotFound() {
  return (
    <>
      <AppBar />
      <div className='flex w-full h-full items-center justify-center'>
        <div className='flex flex-col max-w-lg items-center text-center pt-10 space-y-8'>
          <p className='text-2xl'>Page Not Found</p>
          <p className='text-muted-foreground'>
            <Link href='/'>
              <Button>Head back</Button>
            </Link>
          </p>
        </div>
      </div>
    </>
  )
}
