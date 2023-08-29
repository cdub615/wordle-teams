import { Database } from '@/lib/database.types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { format } from 'date-fns'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const GET = async () => {
  const supabase = createRouteHandlerClient<Database>({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: teams } = await supabase.from('teams').select('*')

  let teamId: number | undefined = undefined

  teamId = teams?.shift()?.id
  let month = format(new Date(), 'yyyyMM')
  const cookieStore = cookies()
  const teamIdCookie = cookieStore.get('teamId')
  if (
    teamIdCookie &&
    teamIdCookie.value.length > 0 &&
    teams?.some((t) => t.id === Number.parseInt(teamIdCookie.value))
  ) {
    teamId = Number.parseInt(teamIdCookie.value)
  }
  const monthCookie = cookieStore.get('month')
  if (monthCookie && monthCookie.value.length > 0) {
    month = monthCookie.value
  }

  return NextResponse.json({ teamId, month })
}

export { GET }
