'use client'

import DatePicker from '@/components/date-picker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import { useTeams } from '@/lib/contexts/teams-context'
import { cn } from '@/lib/utils'
import { isSameDay } from 'date-fns'
import { useState } from 'react'
import WordleBoard from '../wordle-board'

export default function TeamBoards({ classes }: { classes?: string }) {
  const { teams, teamId, user } = useTeams()
  const team = teams.find((t) => t.id === teamId)!
  const [date, setDate] = useState<Date | undefined>(new Date())
  const boards = team.players.map((p) => p.scores.filter((s) => isSameDay(new Date(s.date), date!))).flat()
  return (
    <Card className={cn('w-full max-w-md', classes)}>
      <CardHeader>
        <CardTitle>Wordle Boards</CardTitle>
        <div className='w-full max-w-md'>
          <DatePicker date={date} setDate={setDate} playWeekends={team.playWeekends} />
        </div>
      </CardHeader>
      <CardContent>
        <Carousel className='w-full'>
          <CarouselContent>
            {boards.map((b) => (
              <CarouselItem key={b.id}>
                <WordleBoard answer={b.answer} guesses={b.guesses} />
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </CardContent>
    </Card>
  )
}
