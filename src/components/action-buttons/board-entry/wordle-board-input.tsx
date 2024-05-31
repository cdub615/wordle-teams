'use client'

import { Button } from '@/components/ui/button'
import WordleBoard from '@/components/wordle-board'
import { Loader2 } from 'lucide-react'
import { Dispatch, KeyboardEvent, KeyboardEventHandler, SetStateAction, useEffect, useRef } from 'react'
import { handleKey } from './utils'

type WordleBoardProps = {
  guesses: string[]
  setGuesses: Dispatch<SetStateAction<string[]>>
  answer: string
  tabIndex?: number
  submitting: boolean
  submitDisabled: boolean
  scoreId: number
}

export default function WordleBoardInput({
  guesses,
  setGuesses,
  answer,
  tabIndex,
  submitting,
  submitDisabled,
  scoreId,
}: WordleBoardProps) {
  const handleBoardKeyDown: KeyboardEventHandler = (e: KeyboardEvent<HTMLDivElement>) => {
    const key = e.key
    if (key !== 'Tab') {
      e.preventDefault()
      handleKey(key, answer, guesses, setGuesses, scoreId)
    }
  }
  const formRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1 || window.innerWidth - e.touches[0].pageX <= 20) {
        e.preventDefault()
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault()
    }

    const div = formRef.current
    if (div) {
      div.addEventListener('touchstart', handleTouchStart, { passive: false })
      div.addEventListener('touchmove', handleTouchMove, { passive: false })
    }

    return () => {
      if (div) {
        div.removeEventListener('touchstart', handleTouchStart)
        div.removeEventListener('touchmove', handleTouchMove)
      }
    }
  }, [])

  return (
    <>
      <div
        ref={formRef}
        contentEditable={true}
        onKeyDown={handleBoardKeyDown}
        onChange={(e) => e.preventDefault()}
        onInput={(e) => e.preventDefault()}
        className='flex w-full h-fit justify-center mt-4 md:my-6 rounded-lg select-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 focus:ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background'
        role='region'
        aria-label='Wordle Board'
        tabIndex={tabIndex}
      >
        <WordleBoard guesses={guesses} answer={answer} />
      </div>
      <div className='flex justify-end space-x-4 mt-2 md:mt-4 invisible h-0 md:visible md:h-fit'>
        <Button
          disabled={submitting || submitDisabled}
          aria-disabled={submitting || submitDisabled}
          type='submit'
          id='board-submit'
          tabIndex={5}
          className='focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-transparent'
        >
          {submitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          Submit
        </Button>
      </div>
    </>
  )
}
