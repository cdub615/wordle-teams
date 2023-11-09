import { AlertDialog } from '@/components/ui/alert-dialog'
import { Database } from '@/lib/database.types'
import { daily_scores } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { SupabaseClient, createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { isToday, parseISO } from 'date-fns'
import type { Metadata } from 'next'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import AddBoardForm from './add-board-form'
import EditGuessesForm from './edit-guesses-form'

export const metadata: Metadata = {
  title: 'Add Board',
}

const getPlayerScores = async (supabase: SupabaseClient<Database>, userId: string): Promise<daily_scores[]> => {
  const { data: scores } = await supabase.from('daily_scores').select('*').eq('player_id', userId)
  return scores ?? []
}

export default async function Page() {
  const supabase = createServerComponentClient<Database>({ cookies })
  const session = await getSession(supabase)
  if (!session) redirect('/login')
  const scores = await getPlayerScores(supabase, session.user.id)
  const todaysScore = scores.find((s) => isToday(parseISO(s.date)))
  const teamId = cookies().get('teamId')?.value as string
  const month = cookies().get('month')?.value as string
  return (
    <AlertDialog open={true}>
      {todaysScore ? <EditGuessesForm todaysScore={todaysScore} /> : <AddBoardForm dailyScores={scores} teamId={teamId} month={month} />}
    </AlertDialog>
  )
}
