import { Database } from '@/lib/database.types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { randomUUID } from 'crypto'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const POST = async (req: NextRequest) => {
  try {
    const supabase = createRouteHandlerClient<Database>({ cookies })
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { name, playWeekends } = await req.json()
    const creator = session.user.id

    const { data: newTeam, error } = await supabase
      .from('teams')
      .insert({ name, play_weekends: playWeekends, creator, player_ids: [creator] })
      .select('*')
      .single()

    if (error) return NextResponse.json({ error }, { status: 500 })

    const { data: currentPlayer, error: getPlayerError } = await supabase
      .from('players')
      .select('*, daily_scores ( id, created_at, player_id, date, answer, guesses )')
      .eq('id', creator)
      .single()

    if (getPlayerError) return NextResponse.json({ getPlayerError }, { status: 500 })

    revalidatePath('/')

    return NextResponse.json({
      newTeam,
      currentPlayer,
    })
  } catch (error) {
    log.error('An unexpected error occurred while creating team', { error })
    return NextResponse.error()
  }
}

export { POST }
