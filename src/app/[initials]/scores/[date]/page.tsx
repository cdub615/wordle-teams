import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Database } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/server'
import { daily_scores } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { SupabaseClient } from '@supabase/supabase-js'
import { X } from 'lucide-react'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import WordleBoardForm from './wordle-board-form'

export const metadata: Metadata = {
  title: 'Wordle Board',
}

const getPlayerScores = async (supabase: SupabaseClient<Database>, userId: string): Promise<daily_scores[]> => {
  const { data: scores } = await supabase.from('daily_scores').select('*').eq('player_id', userId)
  return scores ?? []
}

export default async function Page({ params }: { params: { initials: string; date: string } }) {
  const supabase = createClient(cookies())
  const { initials, date } = params
  const session = await getSession(supabase)
  if (!session) redirect('/login')
  const scores = await getPlayerScores(supabase, session.user.id)
  return (
    <div className='flex justify-center items-center'>
      <Card className='w-full mx-2 md:max-w-xl mt-2 mb-2 md:mt-16'>
        <CardHeader className='invisible h-0 p-0 md:visible md:h-fit md:p-6'>
          <CardTitle>Add or Update Board</CardTitle>
          <CardDescription>Enter the day&apos;s answer and your guesses</CardDescription>
        </CardHeader>
        <div className='flex justify-end md:invisible md:h-0'>
          <Link href={`/${initials}`}>
            <Button size={'icon'} variant={'ghost'}>
              <X />
            </Button>
          </Link>
        </div>
        <CardContent className='p-2 pt-0 -mt-4 md:px-6 md:pb-6'>
          <WordleBoardForm initials={initials} scores={scores} scoreDate={date} />
        </CardContent>
      </Card>
    </div>
  )
}
