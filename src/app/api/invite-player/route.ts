import InviteEmail from '@/components/invite-email'
import { Database } from '@/lib/database.types'
import { SupabaseClient, createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const resend = new Resend(process.env.RESEND_API_KEY)

const getLogo = (supabase: SupabaseClient<Database>) => {
  const {
    data: { publicUrl: logo },
  } = supabase.storage.from('images').getPublicUrl('wordle-teams-title.png')
  if ((process.env.LOCAL! = 'true')) return logo.replace('http://localhost:54321', process.env.DEV_SUPABASE_URL!)
  return logo
}

const getUserImage = (supabase: SupabaseClient<Database>) => {
  const {
    data: { publicUrl: userImage },
  } = supabase.storage.from('images').getPublicUrl('new-user.png')
  if ((process.env.LOCAL! = 'true'))
    return userImage.replace('http://localhost:54321', process.env.DEV_SUPABASE_URL!)
  return userImage
}

const getTeamImage = (supabase: SupabaseClient<Database>) => {
  const {
    data: { publicUrl: teamImage },
  } = supabase.storage.from('images').getPublicUrl('wt-icon.png')
  if ((process.env.LOCAL! = 'true'))
    return teamImage.replace('http://localhost:54321', process.env.DEV_SUPABASE_URL!)
  return teamImage
}

const POST = async (req: NextRequest) => {
  console.log('ip', req.ip)
  console.log('geo', req.geo)
  const supabase = createRouteHandlerClient<Database>({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { teamId, teamName, playerIds, invited, email } = await req.json()

  const { data: players, error } = await supabase.from('players').select('*').eq('email', email)
  console.log('player by email', players)
  if (players && players[0]) {
    if (!playerIds.includes(players[0].id)) {
      const newPlayerIds = [...playerIds, players[0].id]
      const { error } = await supabase
        .from('teams')
        .update({ player_ids: newPlayerIds })
        .eq('id', teamId)
        .select('*')
      if (error) return NextResponse.json({ error }, { status: 500 })
    } else console.log(`Player with email ${email} already on team ${teamId}`)
  } else {
    try {
      const logo = getLogo(supabase)
      const userImage = getUserImage(supabase)
      const teamImage = getTeamImage(supabase)
      const invitedByUsername = `${session.user.user_metadata.firstName} ${session.user.user_metadata.lastName}`
      const invitedByEmail = session.user.email!

      const { id } = await resend.emails.send({
        from: 'Wordle Teams <onboarding@resend.dev>',
        to: ['christianbwhite@gmail.com'], // TODO replace this with email
        subject: `${invitedByUsername} has invited you`,
        react: InviteEmail({
          email,
          invitedByUsername,
          invitedByEmail,
          teamName,
          logo,
          userImage,
          teamImage,
          inviteFromIp: req.ip,
          inviteFromCity: req.geo?.city,
          inviteFromCountry: req.geo?.country,
          inviteFromRegion: req.geo?.region,
        }),
        text: '',
      })
      console.log('invite email id: ', id)
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 })
    }
    const newInvited = [...invited, email]
    const { error } = await supabase.from('teams').update({ invited: newInvited }).eq('id', teamId).select('*')
    console.log('team update error', error)
    if (error) return NextResponse.json({ error }, { status: 500 })
  }

  if (error) return NextResponse.json({ error }, { status: 500 })

  revalidatePath('/')

  return NextResponse.json(true)
}

export { POST }
