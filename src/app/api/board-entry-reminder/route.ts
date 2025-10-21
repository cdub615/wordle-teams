import { createAdminClient } from '@/lib/supabase/server'
import { Client } from '@upstash/qstash'
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const destinationUrl =
  process.env.VERCEL_ENV === 'production'
    ? 'https://wordleteams.com/api/process-board-entry-reminder'
    : 'https://dev.wordleteams.com/api/process-board-entry-reminder'
const qstash = new Client({ token: process.env.QSTASH_TOKEN! })

async function handler(request: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createAdminClient(cookieStore)

  const { data, error } = await supabase.rpc('get_players_for_reminder')

  if (error) {
    log.error('Error querying users:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }

  log.info(`Users to send board entry reminders to: ${data['length']}`)

  for (const user of data as any) {
    try {
      await qstash.publishJSON({ url: destinationUrl, body: { userId: user.id } })
    } catch (error) {
      log.error('Error queuing notification:', { error })
      return NextResponse.json({ error: 'Failed to queue notification' }, { status: 500 })
    }
  }

  return NextResponse.json({ message: 'Notifications queued' }, { status: 200 })
}

export const POST = verifySignatureAppRouter(handler)
