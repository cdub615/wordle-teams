import InviteEmail from '@/components/invite-email'
import { Database } from '@/lib/database.types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const resend = new Resend(process.env.RESEND_API_KEY)

const sendInviteEmail = async (email: string) =>
  await resend.emails.send({
    from: 'Wordle Teams <onboarding@resend.dev>',
    to: [email],
    subject: 'Wordle Teams Invite',
    react: InviteEmail({ firstName: 'John' }),
    text: '',
  })

const POST = async (req: NextRequest) => {
  const supabase = createRouteHandlerClient<Database>({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { teamId, playerIds, invited, email } = await req.json()

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
      const { id } = await sendInviteEmail(email)
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
