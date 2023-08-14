import { Database } from '@/lib/database.types'
import { Team } from '@/lib/types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const POST = async (req: NextRequest) => {
  const supabase = createRouteHandlerClient<Database>({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, playWeekends } = await req.json()
  const creator = session.user.id

  const { data: newTeam, error } = await supabase
    .from('teams')
    .insert({ id: randomUUID(), name, playWeekends, creator, player_ids: [creator] })
    .select('*')

  if (error) return NextResponse.json({ error }, { status: 500 })

  revalidatePath('/')

  return NextResponse.json(Team.prototype.fromDbTeam(newTeam[0]))
}

export { POST }
