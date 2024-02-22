'use client'

import DatePicker from '@/components/date-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { daily_scores } from '@/lib/types'
import { padArray } from '@/lib/utils'
import { format } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { upsertBoard } from './actions'
import { boardIsValid } from './utils'
import WordleBoard from './wordle-board'

type BoardProps = {
  initials: string
  date: Date
  currentScore: daily_scores | undefined
}

export default function WordleBoardForm({ initials, date, currentScore }: BoardProps) {
  const router = useRouter()
  const [scoreId, setScoreId] = useState(-1)
  const [answer, setAnswer] = useState('')
  const [guesses, setGuesses] = useState(['', '', '', '', '', ''])
  const [submitDisabled, setSubmitDisabled] = useState(true)

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

  return (
    <form action={upsertBoard}>
      <input hidden readOnly aria-readonly name='initials' value={initials} />
      <input hidden readOnly aria-readonly name='scoreId' value={scoreId} />
      <input hidden readOnly aria-readonly name='scoreDate' value={date.toISOString()} />
      <input hidden readOnly aria-readonly name='guesses' value={guesses} />
      <div className='flex flex-col space-y-4 md:space-y-0 md:flex-row md:space-x-4 w-full'>
        <div className='flex flex-col space-y-2'>
          <Label htmlFor='date'>Wordle Date</Label>
          <DatePicker date={date} setDate={setDate} noDateText='Pick a date' tabIndex={1} />
        </div>
        <div className='flex flex-col space-y-2 w-full'>
          <Label htmlFor='answer'>Wordle Answer</Label>
          <Input
            name='answer'
            className='uppercase'
            value={answer}
            onChange={(e) => setAnswer(e.target.value.toUpperCase())}
            maxLength={5}
            tabIndex={2}
          />
        </div>
      </div>
      <WordleBoard guesses={guesses} setGuesses={setGuesses} answer={answer} tabIndex={3} />
      <div className='flex justify-end space-x-4 mt-4'>
        <Button onClick={cancel} variant={'secondary'} type='button' tabIndex={4}>
          Cancel
        </Button>
        <Button
          disabled={submitDisabled}
          type='submit'
          id='board-submit'
          tabIndex={5}
          className='focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-transparent'
        >
          Submit
        </Button>
      </div>
    </form>
  )
}
