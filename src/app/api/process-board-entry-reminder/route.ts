import { createAdminClient } from '@/lib/supabase/server'
import { Novu } from '@novu/node'
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const novu = new Novu(process.env.NOVU_API_KEY!)

interface ReminderRequest {
  userId: string
}

async function handler(request: NextRequest) {
  const { userId }: ReminderRequest = await request.json()
  const supabase = createAdminClient(await cookies())
  const { data, error } = await supabase.from('players').select('*').eq('id', userId).maybeSingle()
  const player = data as any

  if (error) {
    log.error('Error querying player:', error)
  }

  if (!player) {
    log.error(`Player not found: ${userId}`)
    return NextResponse.json({ message: 'Player not found' }, { status: 500 })
  }

  if (player.reminder_delivery_methods?.includes('email')) {
    try {
      await novu.trigger('board-entry-reminder-email', {
        to: {
          subscriberId: player.id,
        },
        payload: {
          email: player.email,
          firstName: player.first_name ?? player.email,
          lastName: player.last_name ?? player.email,
        },
      })
      log.info(`Sent reminder email to ${player.email}`)
    } catch (error) {
      log.error('Error sending email:', { error })
      return NextResponse.json({ message: 'Error sending email' }, { status: 500 })
    }
  }

  // Update last_reminder_sent
  const { error: updateError } = await supabase.rpc('update_last_board_entry_reminder', {
    player_id_param: player.id,
  } as any)

  if (updateError) {
    log.error(`Error updating last_board_entry_reminder for user ${player.id}:`, updateError)
  }

  return NextResponse.json({ message: 'Notification processed' }, { status: 200 })
}

export const POST = verifySignatureAppRouter(handler)
