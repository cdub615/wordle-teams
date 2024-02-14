import ModeToggle from '@/components/mode-toggle'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import logout from '@/lib/shared-actions'
import { LogOut } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Complete Profile',
}

export default function Layout({ children }: { children: React.ReactNode }) {
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
            <form action={logout}>
              <Button size={'icon'} variant={'outline'}>
                <LogOut size={18} />
              </Button>
            </form>
          </div>
        </div>
        <Separator />
      </header>
      {children}
    </div>
  )
}
