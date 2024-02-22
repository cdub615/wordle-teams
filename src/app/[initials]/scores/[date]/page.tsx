import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Database } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/server'
import { daily_scores } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { SupabaseClient } from '@supabase/supabase-js'
import { isSameDay, parseISO } from 'date-fns'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import WordleBoardForm from './wordle-board-form'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const metadata: Metadata = {
  title: 'Wordle Board',
}

const getPlayerScores = async (supabase: SupabaseClient<Database>, userId: string): Promise<daily_scores[]> => {
  const { data: scores } = await supabase.from('daily_scores').select('*').eq('player_id', userId)
  return scores ?? []
}

export default async function Page({ params }: { params: { initials: string; date: string } }) {
  const supabase = createClient(cookies())
  const { initials } = params
  const date = parseISO(params.date)
  const session = await getSession(supabase)
  if (!session) redirect('/login')
  const scores = await getPlayerScores(supabase, session.user.id)
  const currentScore = scores.find((s) => isSameDay(date, parseISO(s.date)))
  return (
    <div className="flex justify-center items-center">
      <Card className='max-w-2xl mt-2 mb-2 md:mt-16'>
        <CardHeader>
          <CardTitle>Add or Update Board</CardTitle>
          <CardDescription>Enter the day&apos;s answer and your guesses</CardDescription>
        </CardHeader>
        <CardContent>
          <WordleBoardForm initials={initials} currentScore={currentScore} date={date} />
        </CardContent>
      </Card>
    </div>
  )
}
