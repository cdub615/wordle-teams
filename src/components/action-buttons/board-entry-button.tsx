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
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
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
            <DialogDescription>Enter the day&apos;s answer and your guesses</DialogDescription>
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
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button className='text-xs px-2' variant={'secondary'}>
          Board Entry
          <Plus size={20} className='ml-2' />
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <WordleBoardForm userId={userId} />
        <div className='h-32'></div>
      </DrawerContent>
    </Drawer>
  )
}
