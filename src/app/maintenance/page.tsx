import ModeToggle from '@/components/mode-toggle'
import { Separator } from '@/components/ui/separator'
import { GeistSans } from 'geist/font/sans'

export default async function Page() {
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
          </div>
        </div>
        <Separator />
      </header>
      <svg viewBox='0 0 0 0' width='0' height='0' className='absolute' aria-hidden='true' focusable='false'>
        <linearGradient id='svg-gradient'>
          <stop offset='0%' stopColor='hsl(var(--color-stop-1))' />
          <stop offset='50%' stopColor='hsl(var(--color-stop-2))' />
          <stop offset='100%' stopColor='hsl(var(--color-stop-3))' />
        </linearGradient>
      </svg>
      <div className='flex flex-col pt-[10%]'>
        <div className='flex w-full justify-center'>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='currentColor'
            className='icon-gradient w-[10rem] h-[10rem] bg-foreground dark:bg-transparent rounded-full p-4'
          >
            <path d='M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z' />
          </svg>
        </div>
        <h1 className={`${GeistSans.className} pt-4 pb-2 text-center text-3xl md:text-6xl`}>Coming Soon</h1>
        <span className='text-muted-foreground text-lg text-center md:leading-loose'>
          Site is under construction
        </span>
      </div>
    </div>
  )
}
