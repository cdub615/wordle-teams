import { createClient } from '@/lib/supabase/server'
import { players } from '@/lib/types'
import { Novu } from '@novu/node'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function POST(request: Request) {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const { data, error } = await supabase
    .from('players')
    .select('*')
    .filter('reminder_delivery_time', 'lte', `(CURRENT_TIMESTAMP AT TIME ZONE time_zone)::time`)
    .filter(
      'reminder_delivery_time',
      'gte',
      `((CURRENT_TIMESTAMP - INTERVAL '1 hour') AT TIME ZONE time_zone)::time`
    )
    .filter('last_board_entry_reminder', 'lt', `DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE time_zone)`)
    .order('last_board_entry_reminder', { ascending: true })
    .returns<players[]>()

  if (error) {
    log.error('Error querying users:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }

  // Process the matching users
  log.info(`Users to notify: ${data.length}`)

  for (const user of data) {
    try {
      // Send notification to user
      try {
        await sendNotification(user)
      } catch (error) {
        log.error('Error sending notification:', { error })
        return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 })
      }

      // Update last_reminder_sent
      const { error: updateError } = await supabase
        .from('players')
        .update({ last_board_entry_reminder: `CURRENT_TIMESTAMP AT TIME ZONE '${user.time_zone}'` })
        .eq('id', user.id)

      if (updateError) {
        log.error(`Error updating last_board_entry_reminder for user ${user.id}:`, updateError)
      }
    } catch (err) {
      log.error(`Error processing notification for user ${user.id}:`, { error: err })
    }
  }

  return NextResponse.json({ message: 'Notifications processed' }, { status: 200 })
}

async function sendNotification(player: players) {
  log.info(`Sending notification to user ${player.id}`)
  const novu = new Novu(process.env.NOVU_API_KEY!)

  if (player.reminder_delivery_methods?.includes('email')) {
    try {
      await novu.trigger('board-entry-reminder-email', {
        to: {
          subscriberId: player.id,
        },
        payload: {
          email: player.email,
          firstName: player.first_name ?? player.email,
        },
      })
    } catch (error) {
      log.error('Error sending email:', { error })
    }
  }

  if (player.reminder_delivery_methods?.includes('push')) {
    try {
      await novu.trigger('board-entry-reminder-push', {
        to: {
          subscriberId: player.id,
        },
        payload: {
          email: player.email,
          firstName: player.first_name ?? player.email,
        },
      })
    } catch (error) {
      log.error('Error sending push:', { error })
    }
  }
}
