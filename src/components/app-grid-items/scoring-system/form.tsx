'use client'

import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SheetClose, SheetFooter } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTeams } from '@/lib/contexts/teams-context'
import { cn } from '@/lib/utils'
import { DialogClose } from '@radix-ui/react-dialog'
import { Loader2 } from 'lucide-react'
import { ChangeEvent, FormEventHandler, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { save } from './actions'
import { Score } from './scoring-system'
import { PointsInput } from './points-input'

type FormProps = {
  scores: Score[]
  isDesktop: boolean
}

export default function ScoringSystemForm({ scores, isDesktop }: FormProps) {
  const { teams, teamId, setTeams } = useTeams()
  const [submitDisabled, setSubmitDisabled] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [points, setPoints] = useState<number[]>(scores.map((s) => s.points))

  useEffect(() => {
    if (scores.length !== 8 || scores.some((s) => s.points === null || s.points === undefined))
      setSubmitDisabled(true)
    else setSubmitDisabled(false)
  }, [scores])

  const handleChange = (e: ChangeEvent<HTMLInputElement>, index: number) => {
    const { value } = e.target
    const newPoints = [...points]
    newPoints[index] = Number(value)
    setPoints(newPoints)
  }

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    setSubmitting(true)
    e.preventDefault()
    const formData: FormData = new FormData(e.currentTarget)
    const result = await save(formData)
    if (result.success) {
      const system: number[][] = [
        [0, points[0]],
        [1, points[1]],
        [2, points[2]],
        [3, points[3]],
        [4, points[4]],
        [5, points[5]],
        [6, points[6]],
        [7, points[7]],
      ]

      const team = teams.find((t) => t.id === teamId)
      if (team) {
        team.setScoringSystem(system)
        const newTeams = teams.map((t) => (t.id === teamId ? team : t))
        setTeams(newTeams)
      }
      toast.success(result.message)
    } else {
      toast.error(result.message)
    }
    setSubmitting(false)

    document.getElementById('close-board-entry')?.click()
  }

  return (
    <form onSubmit={handleSubmit} className={cn(submitting ? 'animate-pulse' : '')}>
      <input hidden id='teamId' name='teamId' value={teamId} />
      <Table>
        <ScrollArea className='h-[70vh]'>
          <TableHeader>
            <TableRow>
              <TableHead className='w-1/2'>Attempts</TableHead>
              <TableHead>Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scores.map((score: Score, index: number) => (
              <TableRow key={score.attempts}>
                <TableCell>{score.attempts === 7 ? 'X' : score.attempts}</TableCell>
                <TableCell>
                  <PointsInput
                    points={points}
                    setPoints={setPoints}
                    index={index}
                    initialValue={`${points[index]}`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ScrollArea>
      </Table>
      {isDesktop ? (
        <DialogFooter>
          <DialogClose id='close-score-customization' asChild>
            <Button variant='outline' className='w-full' id='close-board-entry'>
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={submitting || submitDisabled}
            aria-disabled={submitting || submitDisabled}
            type='submit'
            className='w-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-transparent'
          >
            {submitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Submit
          </Button>
        </DialogFooter>
      ) : (
        <SheetFooter className='pt-2 flex flex-row space-x-2 w-full md:invisible md:h-0 md:p-0'>
          <SheetClose asChild>
            <Button variant='outline' className='w-full' id='close-board-entry'>
              Cancel
            </Button>
          </SheetClose>
          <Button
            disabled={submitting || submitDisabled}
            aria-disabled={submitting || submitDisabled}
            type='submit'
            className='w-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-transparent'
          >
            {submitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Submit
          </Button>
        </SheetFooter>
      )}
    </form>
  )
}
