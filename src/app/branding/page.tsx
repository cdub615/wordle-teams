import Image from 'next/image'
import { RedirectType, redirect } from 'next/navigation'

export default function Branding() {
  if (process.env.LOCAL !== 'true') return redirect('/not-found', RedirectType.replace)
  return (
    <div className='flex flex-col items-center space-y-24 pt-24'>
      {/* <div className='py-24 text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400 dark:from-green-600 dark:via-green-300 dark:to-yellow-400'>
        Wordle Teams
      </div> */}
      {/* <Welcome /> */}
      <svg viewBox='0 0 0 0' width='0' height='0' className='absolute' aria-hidden='true' focusable='false'>
        <linearGradient id='svg-gradient'>
          <stop offset='0%' stopColor='hsl(var(--color-stop-1))' />
          <stop offset='50%' stopColor='hsl(var(--color-stop-2))' />
          <stop offset='100%' stopColor='hsl(var(--color-stop-3))' />
        </linearGradient>
      </svg>
      <div className='z-50 border border-red-500 h-[635px] w-[1205px] flex justify-center items-center'>
        <div className='absolute left-[300px] top-56 z-20 shadow-2xl'>
            <Image src='/board-entry.png' alt='Board Entry' height={500} width={300} />
        </div>
        <div className='absolute left-[660px] top-72 z-20 shadow-2xl'>
          <Image src='/team-boards.png' alt='Board Entry' height={500} width={275} />
        </div>
        <div className='absolute left-[1000px] top-56 z-20 shadow-2xl'>
          <Image src='/scoring-system.png' alt='Board Entry' height={500} width={275} />
        </div>
        <div className='fixed bg-background rounded-full p-2 top-56 left-44 z-10'>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='currentColor'
            className='icon-gradient w-[50px] h-[50px]'
          >
            <path d='M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z' />
          </svg>
        </div>
        <div className='relative top-56'>
          <div className="relative">
            <Image src='/scores-table.png' alt='Scores Table' height={630} width={1200} />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent via-[70%]"></div>
          </div>
        </div>
      </div>
      {/*
      <svg
        xmlns='http://www.w3.org/2000/svg'
        viewBox='0 0 24 24'
        fill='currentColor'
        className='text-[#e6e6e6] w-[250px] h-[250px]'
      >
        <path
          fillRule='evenodd'
          d='M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z'
          clipRule='evenodd'
        />
      </svg>
      */}
    </div>
  )
}
