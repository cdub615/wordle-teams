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
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { DialogClose } from '@radix-ui/react-dialog'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import WordleBoardForm from './board-entry/form'
import {createClient} from '../../lib/supabase/client'
import {log} from 'next-axiom'

export function BoardEntryButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const supabase = createClient()
  const updateToken = async () => {
    log.info('updating token')
    const { error, data } = await supabase.auth.refreshSession()
    if (error) log.error(error?.message)
    else log.info(data?.session?.refresh_token || 'no data')
  }

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
        <Button variant={'secondary'} onClick={updateToken}>Update Token</Button>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className='text-xs px-2' variant={'secondary'}>
          Board Entry
          <Plus size={20} className='ml-2' />
        </Button>
      </SheetTrigger>
      <SheetContent side={'top'}>
        <WordleBoardForm userId={userId} />
      </SheetContent>
    </Sheet>
  )
}
