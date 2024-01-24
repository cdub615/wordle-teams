import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Database } from '@/lib/database.types'
import { daily_scores } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { SupabaseClient, createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { parseISO } from 'date-fns'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Board from './board'

export const metadata: Metadata = {
  title: 'Wordle Board',
}

const getPlayerScores = async (supabase: SupabaseClient<Database>, userId: string): Promise<daily_scores[]> => {
  const { data: scores } = await supabase.from('daily_scores').select('*').eq('player_id', userId)
  return scores ?? []
}

export default async function Page({params}: {params: {date: string}}) {
  const date = parseISO(params.date)
  const supabase = createServerComponentClient<Database>({ cookies })
  const session = await getSession(supabase)
  if (!session) redirect('/login')
  const scores = await getPlayerScores(supabase, session.user.id)
  const teamId = cookies().get('teamId')?.value as string
  const month = cookies().get('month')?.value as string
  return (
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Add or Update Board</AlertDialogTitle>
          <AlertDialogDescription>Enter the day&apos;s answer and your guesses</AlertDialogDescription>
        </AlertDialogHeader>
        <Board dailyScores={scores} date={date} teamId={teamId} month={month} />
      </AlertDialogContent>
    </AlertDialog>
  )
}
