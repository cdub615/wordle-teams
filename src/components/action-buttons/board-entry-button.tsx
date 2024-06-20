'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTrigger } from '@/components/ui/sheet'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { DialogClose } from '@radix-ui/react-dialog'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import WordleBoardForm from './board-entry/form'

export function BoardEntryButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant={'secondary'}>
            Board Entry
            <Plus size={20} className='ml-2' />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader className='pb-4'>
            <DialogTitle>Add or Update Board</DialogTitle>
            <DialogDescription>Enter the day&apos;s answer and then your guesses</DialogDescription>
          </DialogHeader>
          <WordleBoardForm userId={userId} />
          <DialogFooter>
            <DialogClose id='close-board-entry' />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className='text-xs' variant={'secondary'}>
          <Plus size={20} />
        </Button>
      </SheetTrigger>
      <SheetContent side={'top'}>
        <SheetHeader className='mt-4 mb-4 -ml-4'>
          <SheetDescription>Enter the day&apos;s answer and then your guesses</SheetDescription>
        </SheetHeader>
        <WordleBoardForm userId={userId} />
      </SheetContent>
    </Sheet>
  )
}
