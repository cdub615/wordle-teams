'use client'

import { useTeams } from '@/lib/contexts/teams-context'
import { cn, padArray } from '@/lib/utils'
import {useEffect, useState} from 'react'

type WordleBoardProps = {
  guesses: string[]
  answer: string
  boardEntry: boolean
}

export default function WordleBoard({ guesses, answer, boardEntry }: WordleBoardProps) {
  const guessList = guesses.length === 6 ? guesses : padArray(guesses, 6)

  return (
    <div className='pt-1'>
      {guessList.map(
        (guess, index) => index < 6 && <Guess key={index} guess={guess} wordIndex={index} answer={answer} boardEntry={boardEntry} />
      )}
    </div>
  )
}

type GuessProps = {
  guess: string
  wordIndex: number
  answer: string
  boardEntry: boolean
}

function Guess({ guess, wordIndex, answer, boardEntry }: GuessProps) {
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

    // adjust any yellows if a green has come later, ensuring the greens plus yellows for a letter don't exceed the count in the answer
    if (letterMap.size > 0) {
      for (let i = 0; i < letterColors.length; i++) {
        if (letterColors[i].includes('bg-yellow')) {
          const letter = guess[i]
          const letterCount = letterMap.get(letter) ?? 0
          const countInAnswer = countLetters(answer, letter)

          // Check if there's a subsequent green letter for the same character
          const hasSubsequentGreen = letterColors
            .slice(i + 1)
            .some((color, index) => color.includes('bg-green') && guess[i + 1 + index] === letter)

          if (letterCount > countInAnswer && hasSubsequentGreen) {
            letterColors[i] = 'bg-muted'
          }
        }
      }
    }

    return letterColors
  }

  const letterColors = guess && guess.length > 0 ? getLetterColorsForWord(answer, guess) : ['', '', '', '', '', '']
  return (
    <div id={`word-${wordIndex}`} key={`word-${wordIndex}`} className='flex justify-center'>
      <div className='grid grid-cols-5 gap-1 mb-1 w-72 md:w-80'>
        <LetterBox letter={guess[0]} letterNum={1} wordNum={wordIndex + 1} letterColor={letterColors[0]} boardEntry={boardEntry} />
        <LetterBox letter={guess[1]} letterNum={2} wordNum={wordIndex + 1} letterColor={letterColors[1]} boardEntry={boardEntry} />
        <LetterBox letter={guess[2]} letterNum={3} wordNum={wordIndex + 1} letterColor={letterColors[2]} boardEntry={boardEntry} />
        <LetterBox letter={guess[3]} letterNum={4} wordNum={wordIndex + 1} letterColor={letterColors[3]} boardEntry={boardEntry} />
        <LetterBox letter={guess[4]} letterNum={5} wordNum={wordIndex + 1} letterColor={letterColors[4]} boardEntry={boardEntry} />
      </div>
    </div>
  )
}

type LetterBoxProps = {
  letter: string
  letterNum: number
  wordNum: number
  letterColor: string
  boardEntry: boolean
}

function LetterBox({ letter, letterNum, wordNum, letterColor, boardEntry }: LetterBoxProps) {
  const { teams, teamId } = useTeams()
  const [showLetters, setShowLetters] = useState(teams.find((t) => t.id === teamId)?.showLetters ?? true)
  useEffect(() => {
    setShowLetters(teams.find((t) => t.id === teamId)?.showLetters ?? true)
  }, [teams, teamId])
  return (
    <div
      className={cn(
        'border h-14 md:h-16 text-3xl md:text-4xl uppercase caret-transparent flex justify-center items-center',
        letterColor
      )}
      id={`${wordNum}-${letterNum}`}
    >
      {!showLetters && !boardEntry ? '' : letter}
    </div>
  )
}
