'use client'

import DatePicker from '@/components/date-picker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import WordleBoard from '@/components/wordle-board'
import { useTeams } from '@/lib/contexts/teams-context'
import { cn } from '@/lib/utils'
import { isSameDay, isSameMonth, isToday, isWeekend, lastDayOfMonth } from 'date-fns'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function TeamBoards({ classes }: { classes?: string }) {
  const {teams, teamId, user, month} = useTeams()

  const getDate = () => {
    if (isSameMonth(new Date(), month)) return new Date()

    let lastDay = lastDayOfMonth(month)
    const playWeekends = teams.find((t) => t.id === teamId)?.playWeekends
    while (!playWeekends && isWeekend(lastDay)) {
      lastDay = new Date(lastDay.setDate(lastDay.getDate() - 1))
    }
    return lastDay
  }
  const [date, setDate] = useState<Date | undefined>(getDate())

  const getBoardsForDate = (selectedDate: Date, selectedTeam: number) => {
    const team = teams.find((t) => t.id === selectedTeam)
    const boards = team?.players.map((p) => {
      const score = p.scores.find((s) => isSameDay(new Date(s.date), selectedDate))
      const board: Board = {
        id: score ? score.id.toString() : p.id,
        exists: !!score,
        playerId: p.id,
        playerName: `${p.firstName} ${p.lastName}`,
        date: new Date(score?.date ?? ''),
        answer: score?.answer ?? '',
        guesses: score?.guesses ?? [],
      }
      return board
    })
    return boards
  }
  const currentPlayerCompletedToday = () =>
    teams.find((t) => t.id === teamId)?.players.find((p) => p.id === user?.id)?.scores.some((s) => isToday(new Date(s.date))) ?? false
  const shouldHide = (selectedDate: Date) => isToday(selectedDate) && !currentPlayerCompletedToday()
  const setPrevDay = () => {
    const prevDay = new Date(date!)
    prevDay.setDate(date!.getDate() - 1)
    if (!teams.find((t) => t.id === teamId)?.playWeekends) {
      while (isWeekend(prevDay)) {
        prevDay.setDate(prevDay.getDate() - 1)
      }
    }
    setDate(prevDay)
  }
  const setNextDay = () => {
    const nextDay = new Date(date!)
    nextDay.setDate(date!.getDate() + 1)
    if (!teams.find((t) => t.id === teamId)?.playWeekends) {
      while (isWeekend(nextDay)) {
        nextDay.setDate(nextDay.getDate() + 1)
      }
    }
    setDate(nextDay)
  }

  const [boards, setBoards] = useState(getBoardsForDate(date!, teamId))
  const [hide, setHide] = useState(shouldHide(date!))
  const [message, setMessage] = useState(
    hide ? `Visible after today's submission` : 'No board for player on this date'
  )

  useEffect(() => {
    if (date) {
      setBoards(getBoardsForDate(date!, teamId))
      const hideBoards = shouldHide(date!)
      setHide(hideBoards)
      setMessage(hideBoards ? `Visible after today's submission` : 'No board for player on this date')
    }
  }, [date])

  useEffect(() => {
    setDate(getDate())
  }, [month])

  useEffect(() => {
    setBoards(getBoardsForDate(date!, teamId))
  }, [teams, teamId])

  return (
    <Card className={cn('w-full max-w-[96vw] h-fit', classes)}>
      <CardHeader>
        <CardTitle>Team Boards</CardTitle>
        <div className='pt-2 flex'>
          <Button className='text-sm font-normal' variant='outline' onClick={setPrevDay}>
            <ArrowLeft className='h-4 w-4' />
            <span className='sr-only'>Previous day</span>
          </Button>
          <div className='mx-auto'>
            <DatePicker date={date} setDate={setDate} playWeekends={teams.find((t) => t.id === teamId)?.playWeekends} className='w-52 md:w-56' />
          </div>
          <Button
            className='text-sm font-normal'
            variant='outline'
            onClick={setNextDay}
            disabled={isToday(date!)}
            aria-disabled={isToday(date!)}
          >
            <ArrowRight className='h-4 w-4' />
            <span className='sr-only'>Next day</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Carousel>
          <CarouselContent>
            {boards?.map((b) => (
              <CarouselItem key={b.id} className='h-[450px]'>
                <div className='font-semibold text-center mb-2 h-[24px]'>{b.playerName}</div>
                <div className='flex h-full justify-center'>
                  {hide || !b.exists ? (
                    <p className='pt-[180px] w-auto text-center text-muted-foreground'>{message}</p>
                  ) : (
                    <WordleBoard answer={b.answer} guesses={b.guesses} />
                  )}
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className='-left-3 md:-left-4 rounded-md' />
          <CarouselNext className='-right-3 md:-right-4 rounded-md' />
        </Carousel>
      </CardContent>
    </Card>
  )
}

type Board = {
  id: string
  exists: boolean
  playerId: string
  playerName: string
  date: Date
  guesses: string[]
  answer: string
}
