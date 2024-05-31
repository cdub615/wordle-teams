'use client'

import { cn, padArray } from '@/lib/utils'

type WordleBoardProps = {
  guesses: string[]
  answer: string
}

export default function WordleBoard({ guesses, answer }: WordleBoardProps) {
  const guessList = guesses.length === 6 ? guesses : padArray(guesses, 6)

  return (
    <div className='pt-1'>
      {guessList.map(
        (guess, index) => index < 6 && <Guess key={index} guess={guess} wordIndex={index} answer={answer} />
      )}
    </div>
  )
}

type GuessProps = {
  guess: string
  wordIndex: number
  answer: string
}

function Guess({ guess, wordIndex, answer }: GuessProps) {
  const countLetters = (str: string, letter: string) =>
    str?.split('')?.filter((char) => char === letter)?.length ?? 0
  const letterMap = new Map<string, number>()
  const getLetterColorsForWord = (answer: string, guess: string): string[] => {
    let letterColors = ['', '', '', '', '', '']
    if (answer && answer.length === 5) {
      letterColors = letterColors.map((_char, index) => {
        if (guess[index] === answer[index]) {
          letterMap.set(guess[index], (letterMap.get(guess[index]) ?? 0) + 1)
          return 'bg-green-600 dark:bg-green-700'
        }
        if (answer.includes(guess[index])) {
          letterMap.set(guess[index], (letterMap.get(guess[index]) ?? 0) + 1)
          const countInAnswer = countLetters(answer, guess[index])
          const letterCount = letterMap.get(guess[index]) ?? 0
          return letterCount <= countInAnswer ? 'bg-yellow-400 dark:bg-yellow-500' : 'bg-muted'
        }
        return guess[index]?.length > 0 ? 'bg-muted' : ''
      })
    }

    return letterColors
  }

  const letterColors = guess && guess.length > 0 ? getLetterColorsForWord(answer, guess) : ['', '', '', '', '', '']
  return (
    <div id={`word-${wordIndex}`} key={`word-${wordIndex}`} className='flex justify-center'>
      <div className='grid grid-cols-5 gap-1 mb-1 w-72 md:w-80'>
        <LetterBox letter={guess[0]} letterNum={1} wordNum={wordIndex + 1} letterColor={letterColors[0]} />
        <LetterBox letter={guess[1]} letterNum={2} wordNum={wordIndex + 1} letterColor={letterColors[1]} />
        <LetterBox letter={guess[2]} letterNum={3} wordNum={wordIndex + 1} letterColor={letterColors[2]} />
        <LetterBox letter={guess[3]} letterNum={4} wordNum={wordIndex + 1} letterColor={letterColors[3]} />
        <LetterBox letter={guess[4]} letterNum={5} wordNum={wordIndex + 1} letterColor={letterColors[4]} />
      </div>
    </div>
  )
}

type LetterBoxProps = {
  letter: string
  letterNum: number
  wordNum: number
  letterColor: string
}

function LetterBox({ letter, letterNum, wordNum, letterColor }: LetterBoxProps) {
  return (
    <div
      className={cn(
        'border h-14 md:h-16 text-3xl md:text-4xl uppercase caret-transparent flex justify-center items-center',
        letterColor
      )}
      id={`${wordNum}-${letterNum}`}
    >
      {letter}
    </div>
  )
}
