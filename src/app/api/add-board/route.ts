import { Database } from '@/lib/database.types'
import { DailyScore } from '@/lib/types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { randomUUID } from 'crypto'
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

  const { id: _id, date, answer, guesses } = await req.json()
  const id = _id.length > 0 ? _id : randomUUID()

  const { data: newScore, error } = await supabase
    .from('daily_scores')
    .upsert({ id, answer, date, guesses, player_id: session.user.id })
    .select('*')

  if (error) return NextResponse.json({ error }, { status: 500 })

  revalidatePath('/')

  return NextResponse.json(DailyScore.prototype.fromDbDailyScore(newScore[0]))
}

export { POST }
