'use client'

import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import Link from 'next/link'

export default function WordleBoardLink() {
  return (
    <Link href={`/me/scores/${format(new Date(), 'yyyyMMdd')}`}>
      <Button>
        Board Entry
        <Plus size={20} className='ml-2' />
      </Button>
    </Link>
  )
}
