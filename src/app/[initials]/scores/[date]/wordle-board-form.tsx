'use client'

import DatePicker from '@/components/date-picker'
import { Label } from '@/components/ui/label'
import { daily_scores } from '@/lib/types'
import { cn, padArray } from '@/lib/utils'
import { format, isSameDay, parseISO } from 'date-fns'
import { useRouter } from 'next/navigation'
import { FormEventHandler, KeyboardEventHandler, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { upsertBoard } from './actions'
import { boardIsValid, updateAnswer } from './utils'
import WordleBoard from './wordle-board'

type BoardProps = {
  initials: string
  scoreDate: string
  scores: daily_scores[]
}

export default function WordleBoardForm({ initials, scoreDate, scores }: BoardProps) {
  const date = parseISO(scoreDate)
  const currentScore = scores.find((s) => isSameDay(date, parseISO(s.date)))
  const router = useRouter()
  const [scoreId, setScoreId] = useState(-1)
  const [answer, setAnswer] = useState('')
  const [guesses, setGuesses] = useState(['', '', '', '', '', ''])
  const [submitDisabled, setSubmitDisabled] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // TODO can scrape current days wordle answer from https://www.nytimes.com/2023/10/23/crosswords/wordle-review.html

  useEffect(() => {
    if (currentScore) {
      setAnswer(currentScore.answer!)
      setGuesses(padArray(currentScore.guesses, 6))
      setScoreId(currentScore.id)
    }
  }, [currentScore])

  useEffect(() => {
    if (answer && guesses) {
      setSubmitDisabled(!boardIsValid(answer, guesses))
    }
  }, [answer, guesses])

  const cancel = (e: any) => {
    e.preventDefault()
    router.push(`/${initials}`)
  }

  const setDate = (newDate: Date | undefined) => {
    if (newDate) router.push(`/${initials}/scores/${format(newDate!, 'yyyyMMdd')}`)
  }

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    setSubmitting(true)
    e.preventDefault()
    const formData: FormData = new FormData(e.currentTarget)
    const result = await upsertBoard(formData)
    if (result.success) {
      toast.success(result.message)
      router.push(`/${initials}`)
    } else {
      toast.error(result.message)
    }
    setSubmitting(false)
  }

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (e) => updateAnswer(e.key, answer, setAnswer)

  return (
    <form onSubmit={handleSubmit} className={cn(submitting ? 'animate-pulse' : '')}>
      <input hidden readOnly aria-readonly name='initials' value={initials} />
      <input hidden readOnly aria-readonly name='scoreId' value={scoreId} />
      <input hidden readOnly aria-readonly name='scoreDate' value={date.toISOString()} />
      <input hidden readOnly aria-readonly name='guesses' value={guesses} />
      <div className='flex flex-col space-y-4 md:space-y-0 md:flex-row md:space-x-4 w-full px-4'>
        <div className='flex flex-col space-y-2 w-full'>
          <Label htmlFor='date'>Wordle Date</Label>
          <DatePicker date={date} setDate={setDate} noDateText='Pick a date' tabIndex={1} />
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
              className={cn('absolute right-0 top-0 mr-2 mt-2 text-gray-500 hover:text-gray-700 focus:outline-none', answer.length === 0 ? 'hidden' : '')}
            >
              <svg xmlns='http://www.w3.org/2000/svg' className='h-5 w-5' viewBox='0 0 20 20' fill='currentColor'>
                <path
                  fill-rule='evenodd'
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
        cancel={cancel}
        submitting={submitting}
        submitDisabled={submitDisabled}
      />
    </form>
  )
}
