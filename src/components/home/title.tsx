import { Highlight } from '@/components/ui/aceternity/hero-highlight'
import { Button } from '@/components/ui/button'
import { ArrowRightIcon } from '@radix-ui/react-icons'
import { GeistSans } from 'geist/font/sans'
import Image from 'next/image'
import Link from 'next/link'

export default function Title() {
  return (
    <div className='flex flex-col space-y-4 items-center my-12 md:my-24'>
      <div className='h-20 w-20 md:h-36 md:w-36 relative'>
        <Image src='/wt-icon-144x144.png' alt='Wordle Teams Logo' fill={true} />
      </div>
      <h1 className={`${GeistSans.className} text-center text-3xl md:text-6xl`}>Compete with friends</h1>
      <p
        className={`${GeistSans.className} text-center text-lg md:text-3xl max-w-2xl px-2 text-muted-foreground !md:leading-10`}
      >
        Keep score to establish bragging rights in the{' '}
        <Highlight className='text-black dark:text-white rounded font-bold'>
          ultimate app for Wordle enthusiasts
        </Highlight>
      </p>
      <div className='flex justify-center'>
        <Link href='/login' className='text-center mt-4 md:mt-8 group/get-started'>
          <Button>
            <span>Get Started</span>
            <ArrowRightIcon className='ml-2 transition-transform duration-300 ease-in-out group-hover/get-started:translate-x-0.5' />
          </Button>
        </Link>
      </div>
    </div>
  )
}
