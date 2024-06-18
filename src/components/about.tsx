'use client'

import Image from 'next/image'

export default function About() {
  // screenshots, verbiage refinement, then fix the board bug
  return (
    <div className='w-full flex flex-col items-center justify-center'>
      <div className='container px-4 md:px-6 lg:px-8 flex flex-col items-center text-center space-y-12 md:space-y-24'>
        <div className='flex flex-col md:flex-row justify-center items-center gap-4 md:gap-8'>
          <p className='max-w-xl text-lg md:text-xl text-gray-600 dark:text-gray-400'>
            Wordle Teams is a companion app to the New York Times Wordle game. Enter your daily Wordle guesses and
            the day&apos;s answer to share with your friends and teammates. Not connected or affiliated
          </p>
          <Image src='/board-entry.png' alt='board entry screenshot' width={300} height={300}  className='outline outline-4 outline-offset-2 outline-green-600 rounded-xl md:rotate-3' />
        </div>
        <div className='flex flex-col-reverse md:flex-row justify-center items-center gap-4 md:gap-8'>
          <Image src='/install-button.png' alt='install button screenshot' width={200} height={200}  className='outline outline-4 outline-offset-2 outline-green-600 rounded-xl md:-rotate-6' />
          <p className='max-w-xl text-lg md:text-xl text-gray-600 dark:text-gray-400'>
            You can install Wordle Teams to your home screen or desktop using the instructions below. You can access
            these instructions anytime from the Install button in your user dropdown.
          </p>
        </div>
        <div className='flex flex-col md:flex-row justify-center items-center gap-4 md:gap-8'>
          <p className='max-w-xl text-lg md:text-xl text-gray-600 dark:text-gray-400'>
            To get started, you'll need to either create a team, or ask a friend for an invite to their team if you
            heard about the app from a friend.
          </p>
          <Image src='/create-team.png' alt='create team screenshot' width={400} height={300}  className='outline outline-4 outline-offset-2 outline-green-600 rounded-xl md:rotate-3' />
        </div>
        <div className='flex flex-col-reverse md:flex-row justify-center items-center gap-4 md:gap-8'>
          <Image src='/upgrade-button.png' alt='upgrade button screenshot' width={200} height={200}  className='outline outline-4 outline-offset-2 outline-green-600 rounded-xl md:-rotate-6' />
          <p className='max-w-xl text-lg md:text-xl text-gray-600 dark:text-gray-400'>
            Upgrade to unlock unlimited teams, access all of your previous months&apos; scores, customize the scoring
            system for your teams, and more.
          </p>
        </div>
        <div className='flex flex-col md:flex-row justify-center items-center gap-4 md:gap-8'>
          <p className='max-w-xl text-lg md:text-xl text-gray-600 dark:text-gray-400'>
            Feedback and changelog, GitHub repo and Twitter account.
          </p>
        </div>
      </div>
    </div>
  )
}
