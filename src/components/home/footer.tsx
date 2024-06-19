import Image from 'next/image'
import Link from 'next/link'

export default function Footer() {
  return (
    <div className='flex flex-col w-full pt-12 px-4 md:px-12'>
      <div className='flex flex-col space-y-2'>
        <Image src='/wt-icon-144x144.png' width={42} height={42} alt='Wordle Teams Logo' />
      </div>
      <div className='flex space-x-24 md:space-x-48 w-full py-12 text-sm'>
        <div className='flex flex-col space-y-2'>
          <Link href='https://feedback.wordleteams.com/feedback'>Feedback</Link>
          <Link href='https://feedback.wordleteams.com/changelog'>Changelog</Link>
          <Link href='mailto:support@wordleteams.com'>Support</Link>
        </div>
        <div className='flex flex-col space-y-2'>
          <Link href='/about'>About</Link>
          <Link href='https://github.com/cdub615/wordleteams'>Source Code</Link>
          <Link href='https://twitter.com/wordleteams'>X</Link>
        </div>
      </div>
      <div className='flex justify-between text-xs md:text-sm text-muted-foreground py-4'>
        <span>Wordle Teams</span>
        <div>
          <Link href={'/privacy'}>Privacy Policy</Link>
          <Link href={'/terms'} className='ml-6'>
            Terms
          </Link>
        </div>
      </div>
    </div>
  )
}
