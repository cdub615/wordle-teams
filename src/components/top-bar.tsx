import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { LogOut } from 'lucide-react'
import { ModeToggle } from './mode-toggle'

const TopBar = () => {
  return (
    <header className='h-0 invisible @md/root:h-fit @md/root:visible'>
      <div className='flex justify-end items-center p-6 space-x-4'>
        <div className='flex-grow flex justify-center'>
          <h1 className='text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
            Wordle Teams
          </h1>
        </div>
        <Avatar>
          <AvatarImage src='' alt='@username' />
          <AvatarFallback>CW</AvatarFallback>
        </Avatar>
        <ModeToggle />
        <Button size={'icon'} variant={'outline'}>
          <LogOut size={18} />
        </Button>
      </div>
      <Separator />
    </header>
  )
}

export default TopBar
