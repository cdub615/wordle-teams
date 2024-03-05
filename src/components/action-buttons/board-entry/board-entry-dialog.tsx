'use client'

import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import WordleBoardForm from './form'

export default function BoardEntryDialog({ userId }: { userId: string }) {
  return (
    <DialogContent className='min-h-screen md:h-fit'>
      <DialogHeader className='invisible h-0 p-0 md:visible md:h-fit md:p-2'>
        <DialogTitle>Add or Update Board</DialogTitle>
        <DialogDescription>Enter the day&apos;s answer and your guesses</DialogDescription>
      </DialogHeader>
      <WordleBoardForm userId={userId} />
    </DialogContent>
  )
}
