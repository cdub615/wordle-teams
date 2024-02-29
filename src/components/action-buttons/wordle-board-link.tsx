'use client'

import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import Link from 'next/link'

type WordleBoardLinkProps = {
  initials: string
}

export default function WordleBoardLink({ initials }: WordleBoardLinkProps) {
  return (
    <Link href={`/${initials}/scores/${format(new Date(), 'yyyyMMdd')}`}>
      <Button size={'icon'}>
        <Plus size={24} />
      </Button>
    </Link>
  )
}
