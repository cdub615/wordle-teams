'use client'

import { HeroHighlight } from '@/components/ui/aceternity/hero-highlight'
import { BorderBeam } from '@/components/ui/magicui/border-beam'
import { motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'

export default function DashboardPreview() {
  return (
    <HeroHighlight>
      <motion.h1
        initial={{
          opacity: 0,
          y: 20,
        }}
        animate={{
          opacity: 1,
          y: [20, -5, 0],
        }}
        transition={{
          duration: 0.5,
          ease: [0.4, 0.0, 0.2, 1],
        }}
        className='text-2xl px-4 md:text-4xl lg:text-5xl font-bold text-neutral-700 dark:text-white max-w-4xl leading-relaxed lg:leading-snug text-center mx-auto '
      >
        <div className='relative md:h-[695px] md:w-[1000px] rounded-xl mx-auto'>
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
        <div className='flex justify-center'>
          <Link href='/login' className='text-center mt-4 md:mt-8'>
            <button className='p-[2px] relative text-base'>
              <div className='absolute inset-0 bg-gradient-to-r from-green-600 to-yellow-400 rounded-lg' />
              <div className='px-8 py-2 bg-black rounded-[6px]  relative group transition duration-200 text-white hover:bg-transparent hover:text-gray-900'>
                Sign In
              </div>
            </button>
          </Link>
        </div>
      </motion.h1>
    </HeroHighlight>
  )
}
