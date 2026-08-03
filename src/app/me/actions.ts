'use server'

import { authCallbackUrl } from '@/lib/auth-urls'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import type { User, daily_scores, player_with_scores, teams } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

export async function createTeam(formData: FormData) {
  try {
    const supabase = createClient(await cookies())
    const session = await getSession(supabase)
    if (!session) throw new Error('Unauthorized')

    const name = formData.get('name') as string
    const playWeekends = (formData.get('playWeekends') as string) === 'on'
    const showLetters = (formData.get('showLetters') as string) === 'on'
    const creator = session.user.id

    const { data, error } = await supabase
      .from('teams')
      .insert({ name, play_weekends: playWeekends, show_letters: showLetters, creator, player_ids: [creator] })
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
  } catch (error) {
    log.error('Unexpected error occurred in createTeam', { error })
    return { success: false, message: 'Team creation failed, please try again' }
  }
}

export async function updateTeam(formData: FormData) {
  try {
    const supabase = createClient(await cookies())
    const session = await getSession(supabase)
    if (!session) throw new Error('Unauthorized')

    const teamId = formData.get('teamId') as string
    const name = formData.get('name') as string
    const playWeekends = (formData.get('playWeekends') as string) === 'on'
    const showLetters = (formData.get('showLetters') as string) === 'on'

    const { error } = await supabase
      .from('teams')
      .update({ name, play_weekends: playWeekends, show_letters: showLetters })
      .eq('id', Number.parseInt(teamId))

    if (error) {
      log.error('Failed to update team', { error })
      return { success: false, message: 'Team update failed, please try again' }
    }

    revalidatePath('/me', 'page')
    return { success: true, message: 'Successfully updated team' }
  } catch (error) {
    log.error('Unexpected error occurred in createTeam', { error })
    return { success: false, message: 'Team creation failed, please try again' }
  }
}

export async function deleteTeam(teamId: string) {
  try {
    const supabase = createClient(await cookies())
    const session = await getSession(supabase)
    if (!session) throw new Error('Unauthorized')

    const { error } = await supabase.from('teams').delete().eq('id', Number.parseInt(teamId))

    if (error) {
      log.error('Failed to delete team', { error })
      return { success: false, message: 'Team deletion failed, please try again' }
    }

    revalidatePath('/me', 'page')
    return { success: true, message: 'Successfully deleted team' }
  } catch (error) {
    log.error('Unexpected error occurred in deleteTeam', { error })
    return { success: false, message: 'Team deletion failed, please try again' }
  }
}

export async function invitePlayer(formData: FormData) {
  try {
    const supabase = createAdminClient(await cookies())
    const session = await getSession(supabase)
    if (!session) throw new Error('Unauthorized')

    const teamId = Number.parseInt(formData.get('teamId') as string)
    const playerIds = (formData.get('playerIds') as string).split(',')
    // Normalize emails to lowercase: auth/players emails are always lowercase, so storing a
    // mixed-case address in teams.invited[] makes handle_invited_signup's case-sensitive match
    // fail and the invitee silently never joins. See wordle-teams-5no.
    const invited = (formData.get('invited') as string)
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x !== '')
    const email = (formData.get('email') as string).trim().toLowerCase()

    const { data: player, error } = await supabase
      .from('players')
      .select('*, daily_scores ( id, created_at, player_id, date, answer, guesses )')
      .eq('email', email)
      .maybeSingle()
    let invitedPlayer: player_with_scores | undefined

    if (player) {
      if (playerIds.includes(player.id)) log.info(`Player with email ${email} already on team ${teamId}`)
      else if (invited.includes(email)) {
        const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
          data: {
            invited: true,
          },
          redirectTo: authCallbackUrl('/me'),
        })
        if (error) {
          log.error('Failed to send additional invite email', { error })
          return { success: false, message: 'Player invite failed' }
        }
        log.info(`Player with email ${email} already invited to team ${teamId}, sending new invite.`)
        return { success: true, message: 'Successfully invited player' }
      } else {
        const { error } = await supabase.rpc('handle_add_player_to_team', {
          player_id_input: player.id,
          team_id_input: teamId,
        })

        if (error) {
          log.error(`Failed to add player to team ${teamId}`, { error })
          return { success: false, message: 'Player invite failed' }
        }

        if (player.first_name !== null) invitedPlayer = player
      }
    } else {
      const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
        data: {
          invited: true,
        },
        redirectTo: authCallbackUrl('/me'),
      })
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
  } catch (error) {
    log.error('Unexpected error occurred in invitePlayer', { error })
    return { success: false, message: 'Player invite failed' }
  }
}

export async function upsertBoard(formData: FormData) {
  let action: 'create' | 'update' | 'delete' = 'create'

  try {
    const supabase = createClient(await cookies())
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

    if (!!scoreId && scoreId !== '-1') {
      if (answer.length === 0 && guesses.every((guess) => guess.length === 0)) {
        action = 'delete'
        const { error } = await supabase.from('daily_scores').delete().eq('id', Number.parseInt(scoreId))

        if (error) {
          log.error('Failed to delete board', { error })
          return { success: false, action, message: 'Failed to delete board' }
        }

        dailyScore = undefined
        message = 'Successfully deleted board'
      } else {
        action = 'update'
        const { data, error } = await supabase
          .from('daily_scores')
          .update({ answer, guesses })
          .eq('id', Number.parseInt(scoreId))
          .select('*')
          .single()
        const newScore: daily_scores | null = data

        if (!newScore || error) {
          log.error('Failed to add or update board', { error })
          return { success: false, action, message: 'Failed to add or update board' }
        }
        dailyScore = newScore
        message = 'Successfully updated board'
      }
    } else {
      action = 'create'
      const { data, error } = await supabase
        .from('daily_scores')
        .insert({ answer, date: scoreDate, guesses, player_id: session.user.id })
        .select('*')
        .single()

      const newScore: daily_scores | null = data

      if (!newScore || error) {
        log.error('Failed to add or update board', { error })
        return { success: false, action, message: 'Failed to add or update board' }
      }
      dailyScore = newScore
      message = 'Successfully added board'
    }

    revalidatePath('/')

    return { success: true, message, action, dailyScore }
  } catch (error) {
    log.error('Unexpected error occurred in upsertBoard', { error })
    return { success: false, action, message: 'Failed to add or update board' }
  }
}

export async function removePlayer(formData: FormData) {
  try {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)

    const playerIds = (formData.get('playerIds') as string).split(',')
    const playerId = formData.get('playerId') as string
    const teamId = formData.get('teamId') as string

    const newPlayerIds = playerIds.filter((id) => id !== playerId)
    const { error } = await supabase
      .from('teams')
      .update({ player_ids: newPlayerIds })
      .eq('id', Number.parseInt(teamId))
      .select('*')
    if (error) {
      log.error(`Failed to remove player ${playerId} from team ${teamId}`, { error })
      return { success: false, message: 'Failed to remove player' }
    }

    revalidatePath('/me', 'page')

    return { success: true, message: 'Successfully removed player' }
  } catch (error) {
    log.error('Unexpected error occurred in removePlayer', { error })
    return { success: false, message: 'Failed to remove player' }
  }
}


