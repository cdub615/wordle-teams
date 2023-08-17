'use client'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import AppContext from '@/lib/app-context'
import { DailyScore, Team } from '@/lib/types'
import { cn } from '@/lib/utils'
import { randomUUID } from 'crypto'
import { FormEventHandler, KeyboardEvent, KeyboardEventHandler, useContext, useEffect, useState } from 'react'

type AddBoardProps = {
  setAddBoardOpen: (open: boolean) => void
}

const AddBoard = ({ setAddBoardOpen }: AddBoardProps) => {
  const { selectedTeam, teams, setTeams, userId } = useContext(AppContext)
  const [answer, setAnswer] = useState('')
  const [answerError, setAnswerError] = useState<string | undefined>(undefined)
  const [answerTouched, setAnswerTouched] = useState(false)
  const [guesses, setGuesses] = useState(['', '', '', '', '', ''])
  const [guessesError, setGuessesError] = useState<string | undefined>(undefined)
  const [guessesTouched, setGuessesTouched] = useState(false)
  const [submitDisabled, setSubmitDisabled] = useState(true)

  const boardCn = 'flex w-full justify-center py-6'
  const boardHidden = 'invisible h-0 w-0'
  const boardVisible = 'visible w-full h-fit'

  useEffect(() => {
    if (hasValidAnswer() && hasGuesses() && hasCompleteGuesses() && lastGuessIsAnswer()) setSubmitDisabled(false)
    else if (answerTouched && guessesTouched) setSubmitDisabled(true)
  }, [answer, guesses])

  const handleBoardKeyDown: KeyboardEventHandler = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!guessesTouched) setGuessesTouched(true)
    if (answer.length === 5) {
      const isLetter = /[a-zA-Z]/.test(e.key) && e.key.length === 1
      const isBackspace = e.key === 'Backspace'
      let newGuesses = [...guesses]
      if (isLetter && guesses[5].length < 5) {
        const currentGuess = guesses.filter((guess) => guess.length < 5).shift() ?? ''
        newGuesses[guesses.indexOf(currentGuess)] += e.key
        setGuesses(newGuesses)
      } else if (isBackspace) {
        // TODO refactor this backspace bit

        // const currentGuess = gu1esses.filter(guess => guess.length > 0).pop() ?? ''
        // newGuesses[guesses.indexOf(currentGuess)] = newGuesses[guesses.indexOf(currentGuess)].slice(0, newGuesses[guesses.indexOf(currentGuess)].length - 1)
        // setGuesses(newGuesses)
        if (guesses[5].length > 0) {
          newGuesses[5] = newGuesses[5].slice(0, newGuesses[5].length - 1)
          setGuesses(newGuesses)
        } else if (guesses[4].length > 0) {
          newGuesses[4] = newGuesses[4].slice(0, newGuesses[4].length - 1)
          setGuesses(newGuesses)
        } else if (guesses[3].length > 0) {
          newGuesses[3] = newGuesses[3].slice(0, newGuesses[3].length - 1)
          setGuesses(newGuesses)
        } else if (guesses[2].length > 0) {
          newGuesses[2] = newGuesses[2].slice(0, newGuesses[2].length - 1)
          setGuesses(newGuesses)
        } else if (guesses[1].length > 0) {
          newGuesses[1] = newGuesses[1].slice(0, newGuesses[1].length - 1)
          setGuesses(newGuesses)
        } else if (guesses[0].length > 0) {
          newGuesses[0] = newGuesses[0].slice(0, newGuesses[0].length - 1)
          setGuesses(newGuesses)
        }
      }
    }
  }
  const hasValidAnswer = () => answer.length === 5
  const showAnswerError = () => setAnswerError('Answer must be 5 characters')
  const hasGuesses = () => guesses[0].length === 5
  const showNoGuessesError = () => setGuessesError('A completed board takes at least one guess')
  const hasCompleteGuesses = () => guesses.every((guess) => guess.length === 0 || guess.length === 5)
  const showIncompleteGuessesError = () => setGuessesError('Every submitted guess must be 5 characters')
  const lastGuessIsAnswer = () =>
    guesses[5].length === 5 || guesses.filter((guess) => guess.length > 0).pop() === answer
  const showLastGuessNotAnswerError = () => setGuessesError('Last guess must match answer unless board is full')
  const validateForSubmit = (): boolean => {
    if (!hasValidAnswer()) showAnswerError()
    if (!hasGuesses()) showNoGuessesError()
    if (!hasCompleteGuesses()) showIncompleteGuessesError()
    if (!lastGuessIsAnswer()) showLastGuessNotAnswerError()
    return !answerError && !guessesError
  }
  const clearState = () => {
    setAnswer('')
    setAnswerError(undefined)
    setAnswerTouched(false)
    setGuesses(['', '', '', '', '', ''])
    setGuessesError(undefined)
    setGuessesTouched(false)
    setSubmitDisabled(true)
  }
  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault()
    // TODO allow update of existing board, fetching the existing DailyScore from context
    const dailyScore: DailyScore = new DailyScore(
      randomUUID(),
      new Date().toISOString(),
      answer,
      guesses.filter((g) => g.length > 0)
    )
    if (validateForSubmit()) {
      const { id, date, answer, guesses } = dailyScore
      const response = await fetch(`/api/add-board`, {
        method: 'POST',
        body: JSON.stringify({
          id,
          date,
          answer,
          guesses,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      })
      if (response.ok) {
        const updatedTeams = Team.prototype.updatePlayerScore(teams, selectedTeam.id, userId, dailyScore)
        setTeams(updatedTeams)
        toast({
          title: 'Successfully added or updated board',
        })
        clearState()
        setAddBoardOpen(false)
      } else {
        console.log(`An unexpected error occurred while adding board: ${response.statusText}`)
        toast({
          title: 'Failed to add board. Please try again.',
        })
      }
    } else
      toast({
        title: 'Form invalid',
        description: (
          <div className='flex flex-col'>
            <div>Answer Error: {answerError}</div>
            <div>Guesses Error: {guessesError}</div>
          </div>
        ),
      })
  }
  const letterClasses = (letter: string, letterIndex: number) => {
    const hasLetter = letter?.length === 1
    let conditionalClasses = hasLetter ? 'bg-muted' : ''
    if (answer[letterIndex] === letter) conditionalClasses = 'bg-green-600 dark:bg-green-700'
    else if (answer.includes(letter)) conditionalClasses = 'bg-yellow-400 dark:bg-yellow-500'
    return cn('border h-16 flex justify-center items-center text-4xl uppercase', conditionalClasses)
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add Board</DialogTitle>
        <DialogDescription>Enter the day&apos;s answer and your guesses</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit}>
        <div className='flex items-center space-x-4'>
          <Label htmlFor='answer'>Today&apos;s Answer</Label>
          <Input
            name='answer'
            className='uppercase w-48'
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onBlur={(e) => setAnswerTouched(true)}
            maxLength={5}
            tabIndex={1}
          />
        </div>
        {answerError && <div className='text-sm text-destructive py-1'>{answerError}</div>}
        <div
          onKeyDown={handleBoardKeyDown}
          tabIndex={2}
          className={cn(boardCn, answer.length >= 5 ? boardVisible : boardHidden)}
        >
          <div className='grid grid-cols-5 gap-1 w-80'>
            {guesses.map((guess) => (
              <>
                <div className={letterClasses(guess[0], 0)}>{guess[0]}</div>
                <div className={letterClasses(guess[1], 1)}>{guess[1]}</div>
                <div className={letterClasses(guess[2], 2)}>{guess[2]}</div>
                <div className={letterClasses(guess[3], 3)}>{guess[3]}</div>
                <div className={letterClasses(guess[4], 4)}>{guess[4]}</div>
              </>
            ))}
          </div>
        </div>
        {guessesError && <div className='text-sm text-destructive py-1'>{guessesError}</div>}
        <div className='flex justify-end space-x-4'>
          <Button tabIndex={3} disabled={submitDisabled}>
            Submit
          </Button>
        </div>
      </form>
    </DialogContent>
  )
}

export default AddBoard
