'use server'

import InviteEmail from '@/components/emails/invite-email'
import { createClient } from '@/lib/supabase/actions'
import { getImage, getSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const logoImageName = 'wordle-teams-title.png'
const userImageName = 'new-user.png'
const teamImageName = 'wt-icon.png'

export default async function invitePlayer(formData: FormData) {
  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (!session) throw new Error('Unauthorized')

  const teamId = formData.get('teamId') as string
  const teamName = formData.get('teamName') as string
  const playerIds = formData.getAll('playerIds') as string[]
  const invited = formData.getAll('invited') as string[]
  const email = formData.get('email') as string

  const { data: players, error } = await supabase.from('players').select('*').eq('email', email)
  log.debug(`player by email: ${JSON.stringify(players)}`)
  if (players && players[0]) {
    if (!playerIds.includes(players[0].id)) {
      const newPlayerIds = [...playerIds, players[0].id]
      const { error } = await supabase
        .from('teams')
        .update({ player_ids: newPlayerIds })
        .eq('id', teamId)
        .select('*')
      if (error) {
        log.error(`Failed to fetch team ${teamId}`, { error })
        throw error
      }
    } else log.info(`Player with email ${email} already on team ${teamId}`)
  } else {
    try {
      const logo = getImage(supabase, logoImageName)
      const userImage = getImage(supabase, userImageName)
      const teamImage = getImage(supabase, teamImageName)
      const invitedByUsername = `${session.user.user_metadata.firstName} ${session.user.user_metadata.lastName}`
      const invitedByEmail = session.user.email!

      await resend.emails.send({
        from: 'Wordle Teams <team@wordleteams.com>',
        to: [email],
        subject: `${invitedByUsername} has invited you`,
        react: InviteEmail({
          email,
          invitedByUsername,
          invitedByEmail,
          teamName,
          logo,
          userImage,
          teamImage,
        }),
        text: '',
      })
    } catch (error) {
      log.error('Failed to send invite email', { error })
      throw error
    }
    const newInvited = [...invited, email]
    const { error } = await supabase.from('teams').update({ invited: newInvited }).eq('id', teamId).select('*')
    if (error) {
      log.error('team update error', { error })
      throw error
    }
  }

  if (error) {
    log.error('An unexpected error occurred while trying to invite player', { error })
    throw error
  }

  revalidatePath('/[teamId]')
  redirect('/')
}
