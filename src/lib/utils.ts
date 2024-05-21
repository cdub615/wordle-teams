import { Player, Team, User, UserToken, teams } from '@/lib/types'
import * as Sentry from '@sentry/nextjs'
import { AuthApiError, Provider, Session, type SupabaseClient } from '@supabase/supabase-js'
import { clsx, type ClassValue } from 'clsx'
import { addMonths, differenceInMonths, startOfMonth } from 'date-fns'
import { jwtDecode } from 'jwt-decode'
import { LogSnag } from 'logsnag'
import { log } from 'next-axiom'
import { twMerge } from 'tailwind-merge'
import { Database } from './database.types'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export const passwordRegex = `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*.?#^)(-_=+|}{':;~\`&])[A-Za-z\d@$!.%*?#^)(-_=+|}{':;~\`&]{6,20}$`

export const logsnagClient = () => new LogSnag({ token: process.env.LOGSNAG_TOKEN!, project: 'wordle-teams' })

export const getMonthsFromScoreDate = (scoreDate: Date): Date[] => {
  const monthsToCurrent = differenceInMonths(new Date(), scoreDate)
  let monthOption = startOfMonth(scoreDate)
  let options: Date[] = [monthOption]
  for (let i = 0; i < monthsToCurrent; i++) {
    monthOption = startOfMonth(addMonths(monthOption, 1))
    options.push(monthOption)
  }
  return options
}

export const fromNewTeamResult = (result: any): Team => {
  const { newTeam, currentPlayer } = result

  const team = Team.prototype.fromDbTeam(newTeam)
  const player = Player.prototype.fromDbPlayer(currentPlayer, currentPlayer.daily_scores)
  team.addPlayer(player)
  return team
}

export const monthAsDate = (month: string) =>
  new Date(Number.parseInt(month.substring(0, 4)), Number.parseInt(month.substring(4, 6)) - 1)

export const playerIdsFromTeams = (teams: teams[]): string[] => {
  const player_ids = teams?.map((t) => t.player_ids)
  return !!player_ids && player_ids.length > 0
    ? player_ids.reduce((prev, current) => {
        return [...prev, ...current]
      })
    : []
}

export const getSession = async (supabase: SupabaseClient<Database>) => {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()
  if (error) log.warn(`failed to get session, trying session refresh: ${error.message}`)
  if (error instanceof AuthApiError && error.message.includes('Refresh Token Not Found')) {
    const { data, error: refreshError } = await supabase.auth.refreshSession()

    if (refreshError) {
      log.warn(`Session refresh error, logging out: ${refreshError.message}`)
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) {
        log.warn(`Failed to logout failed, might already be logged out: ${signOutError.message}`)
      }
      return null
    }
    return data.session
  }
  return session
}

export const getUserFromSession = (session: Session) => {
  const token = jwtDecode<UserToken>(session.access_token)
  const firstName = token.user_first_name ?? ''
  const lastName = token.user_last_name ?? ''
  const initials =
    token.user_first_name && token.user_last_name ? `${token.user_first_name[0]}${token.user_last_name[0]}` : 'WT'
  const identities = session.user?.identities ?? []
  const user: User = {
    id: session.user.id,
    email: session.user.email!,
    firstName,
    lastName,
    initials,
    memberStatus: token.user_member_status,
    memberVariant: token.user_member_variant,
    customerId: token.user_customer_id,
    invitesPendingUpgrade: session.user?.app_metadata?.invites_pending_upgrade ?? 0,
    avatarUrl: identities[0].identity_data?.avatar_url,
  }

  return user
}

export const padArray = (arr: string[], length: number) => {
  while (arr.length < length) {
    arr.push('')
  }
  return arr
}

export const hasName = (session: Session) => {
  try {
    const user = getUserFromSession(session)
    return user.firstName.length > 1 && user.lastName.length > 1
  } catch (error) {
    Sentry.captureException(error)
    log.error('Failed to check if user has name', { error })
    throw error
  }
}

export const isBrowser = () => typeof window !== 'undefined'

export const clearAllCookies = () => {
  if (typeof window !== 'undefined') {
    const cookies = document.cookie.split(';')

    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i]
      const eqPos = cookie.indexOf('=')
      const name = eqPos > -1 ? cookie.substring(0, eqPos) : cookie
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
    }
  }
}

export const clearAwaitingVerification = () => {
  if (typeof window !== 'undefined') {
    const cookies = document.cookie.split(';')

    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i]
      const eqPos = cookie.indexOf('=')
      const name = eqPos > -1 ? cookie.substring(0, eqPos) : cookie
      if (name.trim() === 'awaitingVerification') {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
      }
    }
  }
}

export const getAwaitingVerification = () => {
  const name = 'awaitingVerification'
  if (typeof window !== 'undefined') {
    const cookies = document.cookie.split(';')

    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim()
      if (cookie.startsWith(name + '=')) {
        return cookie.substring(name.length + 1) === 'true'
      }
    }
    return false
  }
  return false
}

export const getOAuthProviderName = (provider: Provider | string) => {
  switch (provider) {
    case 'github':
      return 'GitHub'
    case 'google':
      return 'Google'
    case 'facebook':
      return 'Facebook'
    case 'azure':
      return 'Microsoft'
    case 'slack':
      return 'Slack'
    case 'workos':
      return 'WorkOS'
    case 'apple':
      return 'Apple'
    case 'twitter':
      return 'X'
    case 'discord':
      return 'Discord'
    default:
      return provider
  }
}
