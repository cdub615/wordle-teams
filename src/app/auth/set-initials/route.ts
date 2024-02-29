import { createClient } from '@/lib/supabase/actions'
import { getSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const { initials } = await request.json()

  const supabase = createClient(cookieStore)
  const session = await getSession(supabase)
  if (!session) return NextResponse.json({ success: true })

  if (!initials || initials.length !== 2) {
    log.warn('Invalid initials passed to /set-initials', { initials })
    return NextResponse.json({ success: true })
  }

  cookieStore.set('initials', initials)
  return NextResponse.json({ success: true })
}
