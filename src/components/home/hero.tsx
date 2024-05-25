'use client'

import { HeroHighlight, Highlight } from '@/components/ui/aceternity/hero-highlight'
import { Button } from '@/components/ui/button'
import { ArrowRightIcon } from '@radix-ui/react-icons'
import { motion } from 'framer-motion'
import Link from 'next/link'

export default function Hero() {
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
        {/* <p className='mb-4'>Create teams, enter daily Wordle boards, and track your scores.</p> */}
        Wordle Teams is{' '}
        <Highlight className='text-black dark:text-white'>the ultimate app for Wordle enthusiasts.</Highlight>{' '}
        <div className='flex justify-center'>
          <Link href='/login' className='text-center mt-4 group/get-started'>
            <Button>
              <span>Get Started</span>
              <ArrowRightIcon className='ml-2 transition-transform duration-300 ease-in-out group-hover/get-started:translate-x-0.5' />
            </Button>
          </Link>
        </div>
      </motion.h1>
    </HeroHighlight>
  )
}
