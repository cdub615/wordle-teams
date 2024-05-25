import { BorderBeam } from '@/components/ui/magicui/border-beam'
import Image from 'next/image'

export default function DashboardPreview() {
  return (
    <div className='w-full bg-black py-6'>
      <div className='relative md:h-[695px] md:w-[1000px] rounded-xl my-8 mx-auto'>
        <Image
          src='/welcome-screenshot.png'
          alt='Wordle Teams Dashboard'
          width={1000}
          height={695}
          className='rounded-xl'
          priority
        />
        <BorderBeam />
      </div>
    </div>
  )
}
