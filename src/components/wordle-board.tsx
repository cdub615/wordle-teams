'use client'

import { cn, padArray } from '@/lib/utils'

type WordleBoardProps = {
  guessesProp: string[]
  answer: string
}

export default function WordleBoard({ guessesProp, answer }: WordleBoardProps) {
  const guesses = guessesProp.length === 6 ? guessesProp : padArray(guessesProp, 6)
  return (
    <div className='pt-1'>
      {guesses.map(
        (guess, index) =>
          index < 6 && (
            <div id={`word-${index}`} key={`word-${index}`} className='flex justify-center'>
              <div className='grid grid-cols-5 gap-1 mb-1 w-72 md:w-80'>
                <LetterBox answer={answer} letter={guess[0]} letterIndex={0} wordNum={index + 1} />
                <LetterBox answer={answer} letter={guess[1]} letterIndex={1} wordNum={index + 1} />
                <LetterBox answer={answer} letter={guess[2]} letterIndex={2} wordNum={index + 1} />
                <LetterBox answer={answer} letter={guess[3]} letterIndex={3} wordNum={index + 1} />
                <LetterBox answer={answer} letter={guess[4]} letterIndex={4} wordNum={index + 1} />
              </div>
            </div>
          )
      )}
    </div>
  )
}

type LetterBoxProps = {
  answer: string
  letter: string
  letterIndex: number
  wordNum: number
}

function LetterBox({ answer, letter, letterIndex, wordNum }: LetterBoxProps) {
  const getConditionalClasses = () => {
    if (!letter) return ''
    if (!answer.includes(letter)) return 'bg-muted'
    if (answer[letterIndex] === letter) return 'bg-green-600 dark:bg-green-700'
    if (answer.includes(letter)) return 'bg-yellow-400 dark:bg-yellow-500'
    // TODO handle duplicate letter scenarios for making the letter yellow vs not
    return ''
  }
  const letterNum = letterIndex + 1

  return (
    <div
      className={cn(
        'border h-14 md:h-16 text-3xl md:text-4xl uppercase caret-transparent flex justify-center items-center',
        getConditionalClasses()
      )}
      id={`${wordNum}-${letterNum}`}
    >
      {letter}
    </div>
  )
}
