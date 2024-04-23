'use client'

import DatePicker from '@/components/date-picker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import WordleBoard from '@/components/wordle-board'
import { useTeams } from '@/lib/contexts/teams-context'
import { cn } from '@/lib/utils'
import { isSameDay, isToday, isWeekend } from 'date-fns'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function TeamBoards({ classes }: { classes?: string }) {
  const { teams, teamId, user } = useTeams()
  const team = teams.find((t) => t.id === teamId)!
  const [date, setDate] = useState<Date | undefined>(new Date())
  const getBoardsForDate = (selectedDate: Date) => {
    const boards = team.players.map((p) => {
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
  const shouldShowBoards = (selectedDate: Date) =>
    !isToday(selectedDate) ||
    (team.players.find((p) => p.id === user?.id)?.scores.some((s) => isToday(new Date(s.date))) ?? false)
  const setPrevDay = () => {
    const prevDay = new Date(date!)
    prevDay.setDate(date!.getDate() - 1)
    if (!team.playWeekends) {
      while (isWeekend(prevDay)) {
        prevDay.setDate(prevDay.getDate() - 1)
      }
    }
    setDate(prevDay)
  }
  const setNextDay = () => {
    const nextDay = new Date(date!)
    nextDay.setDate(date!.getDate() + 1)
    if (!team.playWeekends) {
      while (isWeekend(nextDay)) {
        nextDay.setDate(nextDay.getDate() + 1)
      }
    }
    setDate(nextDay)
  }

  const [boards, setBoards] = useState(getBoardsForDate(date!))
  const [showBoards, setShowBoards] = useState(shouldShowBoards(date!))

  useEffect(() => {
    if (date) {
      setBoards(getBoardsForDate(date!))
      setShowBoards(shouldShowBoards(date!))
    }
  }, [date])

  return (
    <Card className={cn('w-full max-w-md', classes)}>
      <CardHeader>
        <CardTitle>Team Boards</CardTitle>
        {/* <div className='pt-2 flex'>
          <Button className='text-sm font-normal' variant='outline' onClick={setPrevDay}>
            <ArrowLeft className='h-4 w-4' />
            <span className='sr-only'>Previous day</span>
          </Button>
          <div className='mx-auto'>
            <DatePicker date={date} setDate={setDate} playWeekends={team.playWeekends} className='w-52 md:w-56' />
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
        </div> */}
      </CardHeader>
      <CardContent>
        <Carousel className='w-full'>
          <CarouselContent>
            {boards.map((b) => (
              <CarouselItem key={b.id} className='h-[450px]'>
                <div className='font-semibold text-center mb-2 h-[24px]'>{b.playerName}</div>
                {showBoards && b.exists && <WordleBoard answer={b.answer} guesses={b.guesses} />}
                {showBoards && !b.exists && (
                  <div className='flex h-full justify-center'>
                    <p className='pt-[156px] w-auto text-center text-muted-foreground'>No board for player on this date</p>
                  </div>
                )}
                {!showBoards && (
                  <div className='flex h-full justify-center'>
                    <p className='pt-[156px] w-auto text-center text-muted-foreground'>Visible after today&apos;s submission</p>
                  </div>
                )}
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className='-left-5 md:-left-4 rounded-md' />
          <CarouselNext className='-right-5 md:-right-4 rounded-md' />
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
