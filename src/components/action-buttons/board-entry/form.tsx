'use client'

import { upsertBoard } from '@/app/me/actions'
import DatePicker from '@/components/date-picker'
import { Button } from '@/components/ui/button'
import { DrawerClose, DrawerFooter } from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import { useTeams } from '@/lib/contexts/teams-context'
import { cn, padArray } from '@/lib/utils'
import { isSameDay, parseISO } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { FormEventHandler, KeyboardEventHandler, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { boardIsValid, updateAnswer } from './utils'
import WordleBoard from './wordle-board'

export default function WordleBoardForm({ userId }: { userId: string }) {
  const { teams, teamId } = useTeams()
  const scores = teams.find((t) => t.id === teamId)?.players.find((p) => p.id === userId)?.scores ?? []

  const [date, setDate] = useState(new Date())
  const currentScore = scores.find((s) => isSameDay(date, parseISO(s.date)))
  const [scoreId, setScoreId] = useState(-1)
  const [answer, setAnswer] = useState('')
  const [guesses, setGuesses] = useState(['', '', '', '', '', ''])
  const [submitDisabled, setSubmitDisabled] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // TODO can scrape current days wordle answer from https://www.nytimes.com/2023/10/23/crosswords/wordle-review.html

  useEffect(() => {
    if (currentScore) {
      setAnswer(currentScore.answer ?? '')
      setGuesses(padArray(currentScore.guesses, 6))
      setScoreId(currentScore.id)
    }
  }, [currentScore])

  useEffect(() => {
    if (answer && guesses) {
      setSubmitDisabled(!boardIsValid(answer, guesses))
    }
  }, [answer, guesses])

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    setSubmitting(true)
    e.preventDefault()
    const formData: FormData = new FormData(e.currentTarget)
    const result = await upsertBoard(formData)
    if (result.success) {
      toast.success(result.message)
    } else {
      toast.error(result.message)
    }
    setSubmitting(false)

    document.getElementById('close-board-entry')?.click()
  }

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (e) => updateAnswer(e.key, answer, setAnswer)
  const handleDateChange = (newDate: Date | undefined) => {
    if (newDate) setDate(newDate)
  }

  return (
    <form onSubmit={handleSubmit} className={cn(submitting ? 'animate-pulse' : '')}>
      <input hidden readOnly aria-readonly name='scoreId' value={scoreId} />
      <input hidden readOnly aria-readonly name='scoreDate' value={date.toISOString()} />
      <input hidden readOnly aria-readonly name='guesses' value={guesses} />
      <input hidden readOnly aria-readonly name='answer' value={answer} />
      <div className='flex flex-col space-y-4 md:space-y-0 md:flex-row md:space-x-4 w-full px-4'>
        <div className='flex flex-col space-y-2 w-full'>
          <Label htmlFor='date'>Wordle Date</Label>
          <DatePicker date={date} setDate={handleDateChange} noDateText='Pick a date' tabIndex={1} />
        </div>
        <div className='flex flex-col space-y-2 w-full'>
          <Label htmlFor='answer'>Wordle Answer</Label>
          <div className='relative'>
            <div
              id='answer'
              className='uppercase flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 focus:ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
              tabIndex={2}
              onKeyDown={handleKeyDown}
            >
              {answer}
            </div>
            <button
              id='clearButton'
              type='reset'
              onClick={() => setAnswer('')}
              className={cn(
                'absolute right-0 top-0 mr-2 mt-2 text-gray-500 hover:text-gray-700 focus:outline-none',
                answer.length === 0 ? 'hidden' : ''
              )}
            >
              <svg xmlns='http://www.w3.org/2000/svg' className='h-5 w-5' viewBox='0 0 20 20' fill='currentColor'>
                <path
                  fillRule='evenodd'
                  d='M10 8.586l4.293-4.293 1.414 1.414L11.414 10l4.293 4.293-1.414 1.414L10 11.414l-4.293 4.293-1.414-1.414L8.586 10 4.293 5.707l1.414-1.414L10 8.586z'
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <WordleBoard
        guesses={guesses}
        setGuesses={setGuesses}
        answer={answer}
        setAnswer={setAnswer}
        tabIndex={3}
        submitting={submitting}
        submitDisabled={submitDisabled}
      />
      <DrawerFooter className='pt-2 flex flex-row w-full md:invisible md:h-0'>
        <DrawerClose asChild>
          <Button variant='outline' className='w-full' id='close-board-entry'>Cancel</Button>
        </DrawerClose>
        <Button
          disabled={submitting || submitDisabled}
          aria-disabled={submitting || submitDisabled}
          type='submit'
          className='w-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-transparent'
        >
          {submitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          Submit
        </Button>
      </DrawerFooter>
    </form>
  )
}
