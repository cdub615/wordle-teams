'use client'

import { Dispatch, KeyboardEvent, KeyboardEventHandler, SetStateAction, useRef } from 'react'
import Keyboard from './keyboard'
import LetterInput from './letter-input'
import { handleKey } from './utils'

type WordleBoardProps = {
  guesses: string[]
  setGuesses: Dispatch<SetStateAction<string[]>>
  answer: string
  tabIndex?: number
}

export default function WordleBoard({ guesses, setGuesses, answer, tabIndex }: WordleBoardProps) {
  const keyboardRef = useRef(undefined)

  const handleBoardKeyDown: KeyboardEventHandler = (e: KeyboardEvent<HTMLDivElement>) =>
    handleKey(e.key, answer, guesses, setGuesses)
  const handleKeyboardButton = (key: string) => handleKey(key, answer, guesses, setGuesses)

  return (
    <>
      <div
        onKeyDown={handleBoardKeyDown}
        className='flex w-full h-fit justify-center my-6 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background'
        role='region'
        aria-label='Wordle Board'
        tabIndex={tabIndex}
      >
        <div className='w-full pt-1'>
          {guesses.map((guess, index) => (
            <div id={`word-${index}`} key={`word-${index}`} className='flex justify-center'>
              <div className='grid grid-cols-5 gap-1 mb-1 w-80'>
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
      <Keyboard keyboardRef={keyboardRef} onKeyPress={handleKeyboardButton} />
    </>
  )
}
