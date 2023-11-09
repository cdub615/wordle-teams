'use client'

import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { daily_scores } from '@/lib/types'
import { log } from 'next-axiom'
import { KeyboardEventHandler } from 'react'

type EditGuessesFormProps = {
  todaysScore: daily_scores
}
// TODO can scrape current days wordle answer from https://www.nytimes.com/2023/10/23/crosswords/wordle-review.html
export default function EditGuessesForm({ todaysScore }: EditGuessesFormProps) {
  const { answer, guesses } = todaysScore
  // const letterClasses = (letter: string, letterIndex: number) => {
  //   const hasLetter = letter?.length === 1
  //   let conditionalClasses = hasLetter ? 'bg-muted' : ''
  //   if (answer![letterIndex] === letter) conditionalClasses = 'bg-green-600 dark:bg-green-700'
  //   else if (answer!.includes(letter)) conditionalClasses = 'bg-yellow-400 dark:bg-yellow-500'
  //   return cn('border h-16 flex justify-center items-center text-4xl uppercase', conditionalClasses)
  // }
  const letterClasses = 'border h-16 flex justify-center items-center text-4xl uppercase'
  const getPrevLetter = (word: string, letter: string): HTMLElement | null => {
    const wordNum = Number.parseInt(word)
    const letterNum = Number.parseInt(letter)
    if (wordNum === 1 && letterNum === 1) return null

    const prevWordNum = letterNum === 1 ? wordNum - 1 : wordNum
    const prevLetterNum = letterNum === 1 ? 5 : letterNum - 1
    return document.getElementById(`${prevWordNum}-${prevLetterNum}`)
  }
  const getNextLetter = (word: string, letter: string): HTMLElement | null => {
    const wordNum = Number.parseInt(word)
    const letterNum = Number.parseInt(letter)
    if (wordNum === 6 && letterNum === 5) return null

    const nextWordNum = letterNum === 5 ? wordNum + 1 : wordNum
    const nextLetterNum = letterNum === 5 ? 1 : letterNum + 1
    return document.getElementById(`${nextWordNum}-${nextLetterNum}`)
  }
  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (e) => {
    const [word, letter] = e.currentTarget.id.split('-')
    if (e.key == 'Backspace' && e.currentTarget.value == '') getPrevLetter(word, letter)?.focus()
  }
  const handleKeyUp: KeyboardEventHandler<HTMLInputElement> = (e) => {
    const [word, letter] = e.currentTarget.id.split('-')
    if (/^[a-zA-Z]+$/.test(e.key) && e.key.length === 1) {
      // TODO add background classes based on letter entered vs answer
      getNextLetter(word, letter)?.focus()
    }
  }

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Today's Board</AlertDialogTitle>
        <AlertDialogDescription>View and/or update your guesses</AlertDialogDescription>
      </AlertDialogHeader>
      <form>
        <div className='grid gap-1 w-80 mx-auto'>
          {[1, 2, 3, 4, 5, 6].map((num) => (
            <div key={`${num}-1`} className='grid grid-cols-5 gap-1'>
              <Input
                id={`${num}-1`}
                name={`${num}-1`}
                type='text'
                pattern='[A-Za-z]'
                minLength={1}
                maxLength={1}
                className={letterClasses}
                onKeyUp={handleKeyUp}
                onKeyDown={handleKeyDown}
              />
              <Input
                id={`${num}-2`}
                name={`${num}-2`}
                type='text'
                pattern='[A-Za-z]'
                minLength={1}
                maxLength={1}
                className={letterClasses}
                onKeyUp={handleKeyUp}
                onKeyDown={handleKeyDown}
              />
              <Input
                id={`${num}-3`}
                name={`${num}-3`}
                type='text'
                pattern='[A-Za-z]'
                minLength={1}
                maxLength={1}
                className={letterClasses}
                onKeyUp={handleKeyUp}
                onKeyDown={handleKeyDown}
              />
              <Input
                id={`${num}-4`}
                name={`${num}-4`}
                type='text'
                pattern='[A-Za-z]'
                minLength={1}
                maxLength={1}
                className={letterClasses}
                onKeyUp={handleKeyUp}
                onKeyDown={handleKeyDown}
              />
              <Input
                id={`${num}-5`}
                name={`${num}-5`}
                type='text'
                pattern='[A-Za-z]'
                minLength={1}
                maxLength={1}
                className={letterClasses}
                onKeyUp={handleKeyUp}
                onKeyDown={handleKeyDown}
              />
            </div>
          ))}
        </div>
      </form>
    </AlertDialogContent>
  )
}
