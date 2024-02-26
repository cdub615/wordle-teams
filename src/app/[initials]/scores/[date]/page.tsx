import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Database } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/server'
import { daily_scores } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { SupabaseClient } from '@supabase/supabase-js'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
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
        <CardHeader className='invisible h-0 pt-0 md:visible md:h-fit md:pt-6'>
          <CardTitle>Add or Update Board</CardTitle>
          <CardDescription>Enter the day&apos;s answer and your guesses</CardDescription>
        </CardHeader>
        <CardContent className='p-2 md:p-6 pt-0'>
          <WordleBoardForm initials={initials} scores={scores} scoreDate={date} />
        </CardContent>
      </Card>
    </div>
  )
}
