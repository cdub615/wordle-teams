'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { Settings2 } from 'lucide-react'
import { useState } from 'react'
import ScoringSystemForm from './form'
import { Score } from './scoring-system'

export function CustomizeButton({ scores }: { scores: Score[] }) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size={'icon'} variant={'outline'}>
            <Settings2 size={24} />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader className='pb-4'>
            <DialogTitle className='text-2xl'>Scoring System</DialogTitle>
            <DialogDescription>Points awarded by number of attempts</DialogDescription>
          </DialogHeader>
          <ScoringSystemForm scores={scores} isDesktop={true} />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size={'icon'} variant={'outline'}>
          <Settings2 size={24} />
        </Button>
      </SheetTrigger>
      <SheetContent side={'top'}>
        <SheetHeader>
          <SheetTitle className='text-2xl'>Scoring System</SheetTitle>
          <SheetDescription>Points awarded by number of attempts</SheetDescription>
        </SheetHeader>
        <ScoringSystemForm scores={scores} isDesktop={false} />
      </SheetContent>
    </Sheet>
  )
}
