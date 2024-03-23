'use server'

import { createNewCheckout, getFreeVariantId } from '@/lib/lemonsqueezy'
import { createAdminClient, createClient } from '@/lib/supabase/actions'
import { webhookHasData, webhookHasMeta } from '@/lib/typeguards'
import type {
  User,
  WebhookEvent,
  daily_scores,
  member_status,
  player_customer,
  player_with_scores,
} from '@/lib/types'
import { getSession } from '@/lib/utils'
import { randomUUID } from 'crypto'
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

  const teamId = formData.get('teamId') as string
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
    else {
      const newPlayerIds = playerIds.length > 0 ? [...playerIds, player.id] : [player.id]
      const { error } = await supabase
        .from('teams')
        .update({ player_ids: newPlayerIds })
        .eq('id', teamId)
        .select('*')
      if (error) {
        log.error(`Failed to fetch team ${teamId}`, { error })
        return { success: false, message: 'Player invite failed' }
      }
      invitedPlayer = player
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

  let dailyScore: daily_scores
  let message

  if (!!scoreId && scoreId !== '-1') {
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
  } else {
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

  return { success: true, message, dailyScore }
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

export async function processWebhookEvent(webhookId: string) {
  const supabase = createAdminClient(cookies())

  const { data, error } = await supabase.from('webhook_events').select().eq('webhook_id', webhookId).maybeSingle()

  if (error || !data) {
    throw new Error(`Failed to get webhook event #${webhookId} not found in the database.`)
  }

  let processingError = ''
  const eventBody = data.body

  if (!webhookHasMeta(eventBody)) {
    processingError = "Event body is missing the 'meta' property."
  } else if (webhookHasData(eventBody) && data.event_name.startsWith('subscription_')) {
    /**
      subscription_created
      subscription_updated
      subscription_resumed

      subscription_cancelled
      subscription_expired
     */
    const attributes = eventBody.data.attributes
    let variantId = attributes.variant_id as number | null
    const freeVariantId = await getFreeVariantId()
    let membershipStatus = variantId === freeVariantId ? ('free' as member_status) : ('pro' as member_status)
    if (data.event_name.includes('cancelled')) {
      membershipStatus = 'cancelled' as member_status
      variantId = null
    }
    if (data.event_name.includes('expired')) {
      membershipStatus = 'expired' as member_status
      variantId = null
    }

    const playerCustomer: player_customer = {
      customer_id: attributes.customer_id as number,
      customer_portal_url: attributes.urls.customer_portal as string,
      id: randomUUID() as string,
      membership_status: membershipStatus,
      membership_variant: variantId,
      player_id: eventBody.meta.custom_data.user_id as string,
    }

    const { error } = await supabase.from('player_customer').upsert(playerCustomer, { onConflict: 'customer_id' })

    if (error) {
      processingError = error.message
      log.error('Failed to update player_customer', { error })
      throw new Error('Failed to update player_customer')
    }
  }

  await supabase
    .from('webhook_events')
    .update({ processed: true, processing_error: processingError })
    .eq('webhook_id', webhookId)
}

export async function storeWebhookEvent(eventName: string, body: WebhookEvent['body']) {
  const supabase = createAdminClient(cookies())
  const { data } = await supabase
    .from('webhook_events')
    .insert({
      event_name: eventName,
      body,
      player_id: body.meta.custom_data.user_id,
      webhook_id: body.meta.webhook_id,
    })
    .select()
    .single()

  return data?.id
}

export async function getCheckoutUrl(user: User) {
  const checkout = await createNewCheckout(`${user.firstName} ${user.lastName}`, user.email, user.id)
  if (checkout?.data?.attributes?.url) return { checkoutUrl: checkout?.data?.attributes?.url }
  else return { error: 'Failed to create checkout, please try again later.' }
}
