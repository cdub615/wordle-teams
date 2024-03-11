import { Dispatch, SetStateAction } from 'react'
import { toast } from 'sonner'

export const updateAnswer = (key: string, answer: string, setAnswer: Dispatch<SetStateAction<string>>) => {
  const isBackspace = key === 'Backspace' || key === '{backspace}'
  if (isBackspace && answer.length > 0) setAnswer(answer.slice(0, answer.length - 1))

  const isLetter = /[a-zA-Z]/.test(key) && key.length === 1
  if (isLetter && answer.length < 5) setAnswer(answer + key.toUpperCase())
}

export const handleLetter = (
  key: string,
  answer: string,
  guesses: string[],
  setGuesses: Dispatch<SetStateAction<string[]>>
) => {
  let newGuesses = [...guesses]
  const currentGuess = guesses.filter((guess) => guess.length < 5).shift() ?? ''
  if (currentGuess === answer) return

  newGuesses[guesses.indexOf(currentGuess)] += key.toUpperCase()
  setGuesses(newGuesses)
}

export const handleBackspace = (guesses: string[], setGuesses: Dispatch<SetStateAction<string[]>>) => {
  const lastNonEmptyGuessIndex = guesses.findLastIndex((guess) => guess.length > 0)
  if (lastNonEmptyGuessIndex >= 0) {
    const lastNonEmptyGuess = guesses[lastNonEmptyGuessIndex]
    const updatedGuess = lastNonEmptyGuess.slice(0, lastNonEmptyGuess.length - 1)
    const updatedGuesses = [...guesses]
    updatedGuesses[lastNonEmptyGuessIndex] = updatedGuess
    setGuesses(updatedGuesses)
  }
}

export const handleKey = (
  key: string,
  answer: string,
  guesses: string[],
  setGuesses: Dispatch<SetStateAction<string[]>>
) => {
  const isBackspace = key === 'Backspace' || key === '{backspace}'
  if (isBackspace) handleBackspace(guesses, setGuesses)

  if (key === 'Enter') {
    if (boardIsValid(answer, guesses)) document.getElementById('board-submit')?.click()
    else toast.warning('Board must be complete to submit')
  }

  const isLetter = /[a-zA-Z]/.test(key) && key.length === 1
  if (isLetter && !boardIsValid(answer, guesses) && guesses[5].length < 5)
    handleLetter(key, answer, guesses, setGuesses)
}

const hasValidAnswer = (answer: string) => answer.length === 5
const hasGuesses = (guesses: string[]) => guesses[0].length === 5
const hasCompleteGuesses = (guesses: string[]) =>
  guesses.every((guess) => guess.length === 0 || guess.length === 5)
const lastGuessIsAnswer = (answer: string, guesses: string[]) =>
  guesses[5]?.length === 5 || guesses.filter((guess) => guess.length > 0).pop() === answer

export const boardIsValid = (answer: string, guesses: string[]) =>
  hasValidAnswer(answer) &&
  hasGuesses(guesses) &&
  hasCompleteGuesses(guesses) &&
  lastGuessIsAnswer(answer, guesses)
