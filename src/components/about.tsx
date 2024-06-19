'use client'

import boardEntry from '@/public/board-entry.png'
import changelogPage from '@/public/changelog-page.png'
import createTeam from '@/public/create-team.png'
import feedbackPage from '@/public/feedback-page.png'
import githubRepo from '@/public/github-repo.png'
import installButton from '@/public/install-button.png'
import twitterAcct from '@/public/twitter-acct.png'
import upgradeButton from '@/public/upgrade-button.png'
import Image from 'next/image'
import Link from 'next/link'
import { Fragment, ReactNode } from 'react'
import { InfiniteMovingCards } from './ui/aceternity/infinite-moving-cards'

type AboutProps = {
  title: ReactNode
  actionButton: ReactNode
}

export default function About({ title, actionButton }: AboutProps) {
  return (
    <div className='flex flex-col py-12 md:py-20 space-y-8 md:space-y-16 mb-12'>
      <Fragment>{title}</Fragment>
      <div className='w-full flex flex-col items-center justify-center'>
        <div className='container px-4 md:px-6 lg:px-8 flex flex-col items-center text-center space-y-24'>
          <div className='flex flex-col md:flex-row justify-center items-center gap-8'>
            <article className='max-w-xl text-lg md:text-xl text-gray-600 dark:text-gray-400 text-center flex flex-col gap-2'>
              <p>Wordle Teams is designed as a companion app to the New York Times Wordle game.*</p>
              <p>
                Play Wordle as you normally would in the official app or website, then come here to enter the
                day&apos;s answer and your guesses and see how you stack up against your friends.
              </p>
            </article>
            <Image
              src={boardEntry}
              alt='board entry screenshot'
              height={400}
              placeholder='blur'
              className='outline outline-4 outline-offset-2 outline-green-600 rounded-xl md:rotate-3'
            />
          </div>
          <div className='flex flex-col-reverse md:flex-row justify-center items-center gap-8'>
            <Image
              src={installButton}
              alt='install button screenshot'
              placeholder='blur'
              className='outline outline-4 outline-offset-2 outline-green-600 rounded-xl md:-rotate-6'
            />
            <p className='max-w-xl text-lg md:text-xl text-gray-600 dark:text-gray-400'>
              For a more app-like experience, you can install Wordle Teams to your home screen or desktop using the
              instructions from the Install button in your user dropdown at the top right.
            </p>
          </div>
          <div className='flex flex-col md:flex-row justify-center items-center gap-8'>
            <p className='max-w-xl text-lg md:text-xl text-gray-600 dark:text-gray-400'>
              To get started, you&apos;ll need to either create a team (button below), or ask for an invite to an
              existing team if you heard about us from a friend. They&apos;ll just need the email you used to sign
              in.
            </p>
            <Image
              src={createTeam}
              alt='create team screenshot'
              placeholder='blur'
              className='outline outline-4 outline-offset-2 outline-green-600 rounded-xl md:rotate-3'
            />
          </div>
          <div className='flex flex-col-reverse md:flex-row justify-center items-center gap-8'>
            <Image
              src={upgradeButton}
              alt='upgrade button screenshot'
              placeholder='blur'
              className='outline outline-4 outline-offset-2 outline-green-600 rounded-xl md:-rotate-6'
            />
            <p className='max-w-xl text-lg md:text-xl text-gray-600 dark:text-gray-400'>
              Upgrade to unlock unlimited teams, access to all of your previous months&apos; scores, scoring system
              customization for your teams, and more.
            </p>
          </div>
          <div className='flex flex-col justify-center items-center gap-8'>
            <article className='max-w-xl text-lg md:text-xl text-gray-600 dark:text-gray-400'>
              <p>
                For any suggestions or issues, please see our{' '}
                <Link href='https://feedback.wordleteams.com/feedback' className='font-semibold text-green-600'>
                  Feedback
                </Link>
                &nbsp;page. You can also follow us on{' '}
                <Link href='https://x.com/wordleteams' className='font-semibold text-green-600'>
                  X (Twitter)
                </Link>{' '}
                and check out our{' '}
                <Link href='https://feedback.wordleteams.com/changelog' className='font-semibold text-green-600'>
                  Changelog
                </Link>{' '}
                to learn about new features as they&apos;re released.
              </p>
              <p>
                For those interested, this is an open source project on{' '}
                <Link href='https://github.com/cdub615/wordle-teams' className='font-semibold text-green-600'>
                  GitHub
                </Link>{'. '}
                 Contributions are welcome.
              </p>
            </article>
            <InfiniteMovingCards
              speed='slow'
              className='max-w-[90vw] md:max-w-4xl'
              items={[
                <Image
                  src={feedbackPage}
                  alt='feedback screenshot'
                  key='feedback screenshot'
                  height={400}
                  loading='lazy'
                  placeholder='blur'
                  className='rounded-xl'
                />,
                <Image
                  src={changelogPage}
                  alt='changelog screenshot'
                  key='changelog screenshot'
                  height={400}
                  loading='lazy'
                  placeholder='blur'
                  className='rounded-xl'
                />,
                <Image
                  src={twitterAcct}
                  alt='twitter account screenshot'
                  key='twitter account screenshot'
                  height={400}
                  loading='lazy'
                  placeholder='blur'
                  className='rounded-xl'
                />,
                <Image
                  src={githubRepo}
                  alt='github repo screenshot'
                  key='github repo screenshot'
                  height={400}
                  loading='lazy'
                  placeholder='blur'
                  className='rounded-xl'
                />,
              ]}
            />
          </div>
        </div>
      </div>
      <Fragment>{actionButton}</Fragment>
      <p className='mx-2 text-center my-4 text-xs text-gray-600 dark:text-gray-400 leading-4'>
        * Wordle Teams is not affiliated with New York Times or the official Wordle game
      </p>
    </div>
  )
}
