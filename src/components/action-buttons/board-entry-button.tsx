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
import WordleBoardForm from './board-entry/form'

export function BoardEntryButton({ userId }: { userId: string }) {
  const isDesktop = useMediaQuery('(min-width: 768px)')

  if (isDesktop) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button>
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
    <Drawer>
      <DrawerTrigger asChild>
        <Button className='text-xs px-2'>
          Board Entry
          <Plus size={20} className='ml-2' />
        </Button>
      </DrawerTrigger>
      <DrawerContent onPointerDown={(e) => e.stopPropagation()}>
        <WordleBoardForm userId={userId} />
      </DrawerContent>
    </Drawer>
  )
}
