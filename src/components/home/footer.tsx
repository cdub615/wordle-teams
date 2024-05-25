import Link from 'next/link'

export default function Footer() {
  return (
    <span className='text-muted-foreground text-xs md:text-sm fixed bottom-4 text-center w-full leading-loose'>
      Built by{' '}
      <Link href='https://github.com/cdub615' className='underline underline-offset-4'>
        Christian White
      </Link>
      . Follow us on{' '}
      <Link href='https://twitter.com/wordleteams' className='underline underline-offset-4'>
        X
      </Link>
      . View source code in{' '}
      <Link href='https://github.com/cdub615/wordle-teams' className='underline underline-offset-4'>
        GitHub
      </Link>
      .
      <Link href={'/privacy'} className='ml-6'>
        Privacy Policy
      </Link>
      <Link href={'/terms'} className='ml-6'>
        Terms
      </Link>
    </span>
  )
}
