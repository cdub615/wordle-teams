'use client'

import DatePicker from '@/components/date-picker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import WordleBoard from '@/components/wordle-board'
import { useTeams } from '@/lib/contexts/teams-context'
import { cn } from '@/lib/utils'
import { isSameDay, isToday } from 'date-fns'
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
        <div className='w-full max-w-md pt-2'>
          <DatePicker date={date} setDate={setDate} playWeekends={team.playWeekends} />
        </div>
      </CardHeader>
      <CardContent>
        <Carousel className='w-full'>
          <CarouselContent>
            {boards.map((b) => (
              <CarouselItem key={b.id} className='h-[400px]'>
                <div className='font-semibold text-center pb-2 h-[24px]'>{b.playerName}</div>
                {showBoards && b.exists && <WordleBoard answer={b.answer} guesses={b.guesses} />}
                {showBoards && !b.exists && (
                  <div className='flex h-full justify-center'>
                    <p className='pt-[164px] text-muted-foreground'>No board for player on this date</p>
                  </div>
                )}
                {!showBoards && (
                  <div className='flex h-full justify-center'>
                    <p className='pt-[164px] text-muted-foreground'>Today's board not yet submitted</p>
                  </div>
                )}
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className='-left-5 md:-left-4' />
          <CarouselNext className='-right-5 md:-right-4' />
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
