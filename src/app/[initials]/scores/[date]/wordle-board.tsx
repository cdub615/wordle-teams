'use client'

import { Button } from '@/components/ui/button'
import { Dispatch, KeyboardEvent, KeyboardEventHandler, SetStateAction, useRef } from 'react'
import Keyboard from './keyboard'
import LetterInput from './letter-input'
import { handleKey, updateAnswer } from './utils'

type WordleBoardProps = {
  guesses: string[]
  setGuesses: Dispatch<SetStateAction<string[]>>
  answer: string
  setAnswer: Dispatch<SetStateAction<string>>
  tabIndex?: number
  cancel: (e: any) => void
  submitting: boolean
  submitDisabled: boolean
}

export default function WordleBoard({
  guesses,
  setGuesses,
  answer,
  setAnswer,
  tabIndex,
  cancel,
  submitting,
  submitDisabled,
}: WordleBoardProps) {
  const keyboardRef = useRef(undefined)

  const handleBoardKeyDown: KeyboardEventHandler = (e: KeyboardEvent<HTMLDivElement>) =>
    handleKey(e.key, answer, guesses, setGuesses)
  const handleKeyboardButton = (key: string) => answer?.length < 5 ? updateAnswer(key, answer, setAnswer) : handleKey(key, answer, guesses, setGuesses)

  return (
    <>
      <div
        onKeyDown={handleBoardKeyDown}
        className='flex w-full h-fit justify-center mt-2 md:my-6 rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 focus:ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background'
        role='region'
        aria-label='Wordle Board'
        tabIndex={tabIndex}
      >
        <div className='w-full pt-1'>
          {guesses.map((guess, index) => (
            <div id={`word-${index}`} key={`word-${index}`} className='flex justify-center'>
              <div className='grid grid-cols-5 gap-1 mb-1 w-72 md:w-80'>
                <LetterInput answer={answer} letter={guess[0]} letterIndex={0} wordNum={index + 1} />
                <LetterInput answer={answer} letter={guess[1]} letterIndex={1} wordNum={index + 1} />
                <LetterInput answer={answer} letter={guess[2]} letterIndex={2} wordNum={index + 1} />
                <LetterInput answer={answer} letter={guess[3]} letterIndex={3} wordNum={index + 1} />
                <LetterInput answer={answer} letter={guess[4]} letterIndex={4} wordNum={index + 1} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className='flex justify-end space-x-4 mt-2 md:mt-4 invisible h-0 md:visible md:h-fit'>
        <Button id='board-cancel' onClick={cancel} variant={'secondary'} type='button' tabIndex={4}>
          Cancel
        </Button>
        <Button
          disabled={submitting || submitDisabled}
          aria-disabled={submitting || submitDisabled}
          type='submit'
          id='board-submit'
          tabIndex={5}
          className='focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-transparent'
        >
          {submitting && (
            <svg className='animate-spin h-5 w-5 mr-3' viewBox='0 0 24 24'>
              <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
              <path
                className='opacity-75'
                fill='currentColor'
                d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
              />
            </svg>
          )}
          Submit
        </Button>
      </div>
      <Keyboard keyboardRef={keyboardRef} onKeyPress={handleKeyboardButton} />
    </>
  )
}
