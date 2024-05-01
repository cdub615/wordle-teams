'use server'

import { createNewCheckout, getFreeVariantId } from '@/lib/lemonsqueezy'
import { createAdminClient, createClient } from '@/lib/supabase/actions'
import { webhookHasData, webhookHasMeta } from '@/lib/typeguards'
import type { User, WebhookEvent, daily_scores, member_status, player_with_scores } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

export async function createTeam(formData: FormData) {
  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (!session) throw new Error('Unauthorized')

  const name = formData.get('name') as string
  const playWeekends = (formData.get('playWeekends') as string) === 'on'
  const creator = session.user.id

  const { data, error } = await supabase
    .from('teams')
    .insert({ name, play_weekends: playWeekends, creator, player_ids: [creator] })
    .select('*')
    .single()

  if (error) {
    log.error('Failed to insert team', { error })
    return { success: false, message: 'Team creation failed, please try again' }
  }

  const { data: player } = await supabase
    .from('players')
    .select('*, daily_scores ( id, created_at, player_id, date, answer, guesses )')
    .eq('id', creator)
    .returns<player_with_scores[]>()
    .single()

  revalidatePath('/me', 'page')
  return { success: true, message: 'Successfully created team', newTeam: data, player }
}

export async function deleteTeam(teamId: string) {
  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (!session) throw new Error('Unauthorized')

  const { error } = await supabase.from('teams').delete().eq('id', teamId)

  if (error) {
    log.error('Failed to delete team', { error })
    return { success: false, message: 'Team deletion failed, please try again' }
  }

  revalidatePath('/me', 'page')
  return { success: true, message: 'Successfully deleted team' }
}

export async function invitePlayer(formData: FormData) {
  const supabase = createAdminClient(cookies())
  const session = await getSession(supabase)
  if (!session) throw new Error('Unauthorized')

  const teamId = Number.parseInt(formData.get('teamId') as string)
  const playerIds = (formData.get('playerIds') as string).split(',')
  const invited = formData.getAll('invited') as string[]
  const email = formData.get('email') as string

  const { data: player, error } = await supabase
    .from('players')
    .select('*, daily_scores ( id, created_at, player_id, date, answer, guesses )')
    .eq('email', email)
    .maybeSingle()
  let invitedPlayer: player_with_scores | undefined

  if (player) {
    if (playerIds.includes(player.id)) log.info(`Player with email ${email} already on team ${teamId}`)
    else if (invited.includes(email)) {
      log.info(`Player with email ${email} already invited to team ${teamId}`)
      return { success: true, message: 'Player already invited to this team' }
    } else {
      const { error } = await supabase.rpc('handle_add_player_to_team', {
        player_id_input: player.id,
        team_id_input: teamId,
      })

      if (error) {
        log.error(`Failed to fetch team ${teamId}`, { error })
        return { success: false, message: 'Player invite failed' }
      }

      if (player.first_name !== null) invitedPlayer = player
    }
  } else {
    const { error } = await supabase.auth.admin.inviteUserByEmail(email)
    if (error) {
      log.error('Failed to send invite email', { error })
      return { success: false, message: 'Player invite failed' }
    }
    const newInvited = [...invited, email]
    const { error: teamUpdateError } = await supabase
      .from('teams')
      .update({ invited: newInvited })
      .eq('id', teamId)
      .select('*')
    if (teamUpdateError) {
      log.error('team update error', { teamUpdateError })
      return { success: false, message: 'Player invite failed' }
    }
  }

  if (error) {
    log.error('An unexpected error occurred while trying to invite player', { error })
    return { success: false, message: 'Player invite failed' }
  }

  revalidatePath('/me', 'page')
  return { success: true, message: 'Successfully invited player', invitedPlayer }
}

export async function upsertBoard(formData: FormData) {
  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (!session) throw new Error('Unauthorized')

  const scoreId = formData.get('scoreId') as string
  const scoreDate = formData.get('scoreDate') as string
  const answer = formData.get('answer') as string
  const guessesInput = formData.getAll('guesses') as string[]
  const guesses = guessesInput[0].split(',').filter((g) => g !== '')

  if (guesses.length === 6 && guesses[5] != answer) guesses.push('')

  let dailyScore: daily_scores | undefined
  let message
  let action: 'create' | 'update' | 'delete' = 'create'

  if (!!scoreId && scoreId !== '-1') {
    if (answer.length === 0 && guesses.every((guess) => guess.length === 0)) {
      action = 'delete'
      const { error } = await supabase.from('daily_scores').delete().eq('id', scoreId)

      if (error) {
        log.error('Failed to delete board', { error })
        return { success: false, message: 'Failed to delete board' }
      }

      dailyScore = undefined
      message = 'Successfully deleted board'
    } else {
      action = 'update'
      const { data: newScore, error } = await supabase
        .from('daily_scores')
        .update({ answer, guesses })
        .eq('id', scoreId)
        .select('*')
        .returns<daily_scores[]>()
        .single()

      if (error) {
        log.error('Failed to add or update board', { error })
        return { success: false, message: 'Failed to add or update board' }
      }
      dailyScore = newScore
      message = 'Successfully updated board'
    }
  } else {
    action = 'create'
    const { data: newScore, error } = await supabase
      .from('daily_scores')
      .insert({ answer, date: scoreDate, guesses, player_id: session.user.id })
      .select('*')
      .returns<daily_scores[]>()
      .single()

    if (error) {
      log.error('Failed to add or update board', { error })
      return { success: false, message: 'Failed to add or update board' }
    }
    dailyScore = newScore
    message = 'Successfully added board'
  }

  revalidatePath('/')

  return { success: true, message, action, dailyScore }
}

export async function removePlayer(formData: FormData) {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const playerIds = (formData.get('playerIds') as string).split(',')
  const playerId = formData.get('playerId') as string
  const teamId = formData.get('teamId') as string

  const newPlayerIds = playerIds.filter((id) => id !== playerId)
  const { error } = await supabase.from('teams').update({ player_ids: newPlayerIds }).eq('id', teamId).select('*')
  if (error) {
    log.error(`Failed to remove player ${playerId} from team ${teamId}`, { error })
    return { success: false, message: 'Failed to remove player' }
  }

  revalidatePath('/me', 'page')

  return { success: true, message: 'Successfully removed player' }
}

const relevantEvents = new Set([
  'subscription_created',
  'subscription_resumed',
  'subscription_cancelled',
  'subscription_expired',
])

export async function processWebhookEvent(webhookId: string) {
  const supabase = createAdminClient(cookies())

  const { data, error } = await supabase.from('webhook_events').select().eq('webhook_id', webhookId)

  if (error || !data) {
    if (error) log.error('Failed to get webhook event', { error: error?.message })
    throw new Error(`Failed to get webhook event #${webhookId} not found in the database.`)
  }

  let processingError = ''
  const eventBody = data[0].body
  const eventName = data[0].event_name
  const playerId = data[0].player_id

  if (!webhookHasMeta(eventBody)) {
    processingError = "Event body is missing the 'meta' property."
  } else if (webhookHasData(eventBody) && relevantEvents.has(eventName)) {
    const attributes = eventBody.data.attributes
    let variantId = attributes.variant_id as number | null
    const freeVariantId = await getFreeVariantId()
    let membershipStatus = variantId === freeVariantId ? ('free' as member_status) : ('pro' as member_status)
    if (eventName.includes('cancelled')) {
      membershipStatus = 'cancelled' as member_status
      variantId = null
    }
    if (eventName.includes('expired')) {
      membershipStatus = 'expired' as member_status
      variantId = null
    }

    const { error } = await supabase
      .from('player_customer')
      .update({
        customer_id: attributes.customer_id as number,
        membership_status: membershipStatus,
        membership_variant: variantId,
      })
      .eq('player_id', playerId)

    if (error) {
      processingError = error.message
      log.error('Failed to update player_customer', { error })

      return { success: false, message: 'Failed to update player_customer' }
    }

    if (eventName.includes('created') || eventName.includes('resumed')) {
      const { error } = await supabase.rpc('handle_upgrade_team_invites', {
        player_id_input: playerId,
      })
      if (error) {
        processingError = error.message
        log.error('Failure in handle_upgrade_team_invites', { error })
        return { success: false, message: 'Failure in handle_upgrade_team_invites' }
      }
    }
    if (eventName.includes('cancelled') || eventName.includes('expired')) {
      const { error } = await supabase.rpc('handle_downgrade_team_removal', {
        player_id_input: playerId,
      })
      if (error) {
        processingError = error.message
        log.error('Failure in handle_downgrade_team_removal', { error })
        return { success: false, message: 'Failure in handle_downgrade_team_removal' }
      }
    }
  }

  const { error: updateError } = await supabase
    .from('webhook_events')
    .update({ processed: true, processing_error: processingError })
    .eq('webhook_id', webhookId)

  if (updateError) {
    log.error('Failed to update webhook event', { error: updateError?.message })
    return { success: false, message: 'Failed to process webhook event' }
  }

  return { success: true, message: 'Successfully processed webhook event' }
}

export async function storeWebhookEvent(webhookEvent: WebhookEvent) {
  const { body, eventName, playerId, webhookId } = webhookEvent
  const supabase = createAdminClient(cookies())
  const { data, error } = await supabase
    .from('webhook_events')
    .insert({
      event_name: eventName,
      body,
      player_id: playerId,
      webhook_id: webhookId,
    })
    .select()
    .single()

  if (error) log.error('Failed to store webhook event', { error: error?.message })

  return data?.id
}

export async function getCheckoutUrl(user: User) {
  const checkout = await createNewCheckout(`${user.firstName} ${user.lastName}`, user.email, user.id)
  if (checkout?.data?.attributes?.url) return { checkoutUrl: checkout?.data?.attributes?.url }
  else return { error: 'Failed to create checkout, please try again later.' }
}
