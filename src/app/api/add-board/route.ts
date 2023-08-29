import { Database } from '@/lib/database.types'
import { DailyScore } from '@/lib/types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const POST = async (req: NextRequest) => {
  const supabase = createRouteHandlerClient<Database>({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, date, answer, guesses } = await req.json()

  let dailyScore

  if (!!id) {
    const { data: newScore, error } = await supabase
      .from('daily_scores')
      .update({ answer, guesses })
      .eq('id', id)
      .select('*')
      .single()

    if (error) return NextResponse.json({ error }, { status: 500 })
    dailyScore = newScore
  } else {
    const { data: newScore, error } = await supabase
      .from('daily_scores')
      .insert({ id, answer, date, guesses, player_id: session.user.id })
      .select('*')
      .single()

    if (error) return NextResponse.json({ error }, { status: 500 })
    dailyScore = newScore
  }

  revalidatePath('/')

  return NextResponse.json(DailyScore.prototype.fromDbDailyScore(dailyScore))
}

export { POST }
