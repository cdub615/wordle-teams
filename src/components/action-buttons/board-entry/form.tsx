'use client'

import { upsertBoard } from '@/app/me/actions'
import DatePicker from '@/components/date-picker'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SheetClose, SheetFooter } from '@/components/ui/sheet'
import { useTeams } from '@/lib/contexts/teams-context'
import { DailyScore, Team } from '@/lib/types'
import { cn, padArray } from '@/lib/utils'
import { isLastDayOfMonth, isSameDay, isSameMonth, isWeekend, parseISO } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { FormEventHandler, KeyboardEventHandler, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { boardIsValid, updateAnswer } from './utils'
import WordleBoardInput from './wordle-board-input'
import { createClient } from '../../../lib/supabase/client'
import { log } from 'next-axiom'

export default function WordleBoardForm({ userId }: { userId: string }) {
  const { teams, teamId, setTeams, month } = useTeams()
  const team = teams.find((t) => t.id === teamId)
  const scores = team?.players.find((p) => p.id === userId)?.scores ?? []

  const getDate = () => {
    if (isSameMonth(new Date(), month)) return new Date()

    let nextDate = new Date(month)
    const thisMonthScores = scores.filter((s) => isSameMonth(new Date(s.date), month))

    while (
      thisMonthScores.some((s) => isSameDay(new Date(s.date), nextDate)) ||
      (!team?.playWeekends && isWeekend(nextDate))
    ) {
      nextDate = new Date(nextDate.setDate(nextDate.getDate() + 1))
      if (nextDate.getMonth() !== month.getMonth()) return new Date(nextDate.setDate(nextDate.getDate() - 1))
    }
    return nextDate
  }

  const [date, setDate] = useState<Date | undefined>(getDate())
  const [scoreId, setScoreId] = useState(-1)
  const [answer, setAnswer] = useState('')
  const [guesses, setGuesses] = useState(['', '', '', '', '', ''])
  const [submitDisabled, setSubmitDisabled] = useState(!boardIsValid(answer, guesses, scoreId))
  const [submitting, setSubmitting] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const score = scores.find((s) => isSameDay(date!, parseISO(s.date)))
    const guesses = score?.guesses ?? []
    setAnswer(score?.answer ?? '')
    setGuesses(padArray(guesses, 6))
    setScoreId(score?.id ?? -1)
  }, [date])

  useEffect(() => {
    setSubmitDisabled(!boardIsValid(answer, guesses, scoreId))
  }, [answer, guesses])

  useEffect(() => {
    if (answerRef.current) answerRef.current.focus()
  }, [])

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    setSubmitting(true)
    e.preventDefault()
    const formData: FormData = new FormData(e.currentTarget)
    const result = await upsertBoard(formData)

    if (result.success) {
      const scoreDate = result.dailyScore ? new Date(result.dailyScore.date).toISOString() : month.toISOString()

      if (result.action !== 'delete' && result.dailyScore) {
        const newScore = DailyScore.prototype.fromDbDailyScore(result.dailyScore)
        const newTeams = Team.prototype.updatePlayerScore(teams, userId, newScore)
        setTeams(newTeams)
      }
      if (result.action === 'delete') {
        setTeams(Team.prototype.removePlayerScore(teams, userId, formData.get('scoreDate') as string))
      }

      // Calculate winners for each team
      const winners = teams.map(team => ({
        team_id: team.id,
        winner_id: team.thisMonthsCurrentWinner(scoreDate) || null,
        year: parseInt(scoreDate.slice(0, 4)),
        month: parseInt(scoreDate.slice(5, 7))
      }))

      // Update winners table via RPC
      const supabase = createClient() as any
      const { error } = await supabase.rpc('update_monthly_winners', {
        winners_data: winners  // Passing the array directly
      })

      if (error) {
        log.error('Failed to update winners table', { error })
      }

      toast.success(result.message)
    } else {
      toast.error(result.message)
    }
    setSubmitting(false)

    document.getElementById('close-board-entry')?.click()
  }

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (e) => {
    const key = e.key
    if (key !== 'Tab') {
      e.preventDefault()
      updateAnswer(key, answer, setAnswer)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn(submitting ? 'animate-pulse' : '')}>
      <input hidden readOnly aria-readonly name="scoreId" value={scoreId} />
      <input hidden readOnly aria-readonly name="scoreDate" value={date?.toISOString()} />
      <input hidden readOnly aria-readonly name="guesses" value={guesses} />
      <input hidden readOnly aria-readonly name="answer" value={answer} />
      <div className="flex items-center space-x-4 md:space-x-4 w-full md:px-4 ml-2">
        <div id="wordle-board-date" className="flex flex-col w-[54%] md:w-full">
          <Label htmlFor="wordle-board-date" className="mb-2 text-xs sm:text-sm">
            Wordle Date
          </Label>
          <DatePicker
            date={date}
            setDate={setDate}
            noDateText="Pick a date"
            tabIndex={1}
            playWeekends={team?.playWeekends}
          />
        </div>
        <div className="flex flex-col space-y-2 w-[30%] md:w-full">
          <Label htmlFor="answer" className="text-xs sm:text-sm">
            Wordle Answer
          </Label>
          <div className="relative">
            <div
              id="answer"
              ref={answerRef}
              className="caret-transparent uppercase flex h-10 w-full rounded-md border border-input bg-background px-2 md:px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 focus:ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              tabIndex={2}
              onKeyDown={handleKeyDown}
              contentEditable={true}
              onChange={(e) => e.preventDefault()}
              onInput={(e) => e.preventDefault()}
            >
              {answer}
            </div>
            <button
              id="clearButton"
              type="reset"
              onClick={() => setAnswer('')}
              className={cn(
                'absolute right-0 top-0 mr-2 mt-2 text-gray-500 hover:text-gray-700 focus:outline-none',
                answer.length === 0 ? 'hidden' : ''
              )}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 8.586l4.293-4.293 1.414 1.414L11.414 10l4.293 4.293-1.414 1.414L10 11.414l-4.293 4.293-1.414-1.414L8.586 10 4.293 5.707l1.414-1.414L10 8.586z"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <WordleBoardInput
        guesses={guesses}
        setGuesses={setGuesses}
        answer={answer}
        tabIndex={3}
        submitting={submitting}
        submitDisabled={submitDisabled}
        scoreId={scoreId}
      />
      <SheetFooter className="pt-2 flex flex-row space-x-2 w-full md:invisible md:h-0 md:p-0">
        <SheetClose asChild>
          <Button variant="outline" className="w-full" id="close-board-entry">
            Cancel
          </Button>
        </SheetClose>
        <Button
          disabled={submitting || submitDisabled}
          aria-disabled={submitting || submitDisabled}
          type="submit"
          className="w-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-transparent"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit
        </Button>
      </SheetFooter>
    </form>
  )
}
