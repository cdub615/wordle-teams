'use client'

import { Button } from '@/components/ui/button'
import { Share } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function Page() {
  const router = useRouter()
  return (
    <>
      <div className='flex flex-col justify-center items-center my-2'>
        <Link href='/home'>
          <div className='text-4xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400'>
            Wordle Teams
          </div>
        </Link>
        <div className='flex flex-col space-y-4 my-4'>
          <div className='text-lg pt-2'>To Install Wordle Teams as an app</div>
          <ul className='leading-loose list-decimal  pb-4 text-sm md:text-base ml-2'>
            <li>
              Tap the three-dot menu icon <Ellipsis /> or the Share icon <Share className='inline-flex' size={18} />
            </li>
            <li>Select &quot;Add to Home Screen&quot; or &quot;Install app&quot;</li>
            <li>Confirm by tapping &quot;Install&quot; or &quot;Add&quot;</li>
          </ul>
          <Button variant={'outline'} className='w-32 mt-4' onClick={() => router.back()}>
            Back
          </Button>
        </div>
      </div>
    </>
  )
}

function Ellipsis() {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      className='lucide lucide-ellipsis inline-flex'
    >
      <circle cx='12' cy='12' r='1' />
      <circle cx='19' cy='12' r='1' />
      <circle cx='5' cy='12' r='1' />
    </svg>
  )
}
