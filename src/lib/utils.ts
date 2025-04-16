import { Player, Team, User, UserToken, member_status, player_with_customer, teams } from '@/lib/types'
import { Novu } from '@novu/node'
import { AuthApiError, Provider, Session, User as SupabaseUser, type SupabaseClient } from '@supabase/supabase-js'
import { clsx, type ClassValue } from 'clsx'
import { addMonths, differenceInMinutes, differenceInMonths, parseISO, startOfMonth } from 'date-fns'
import { jwtDecode } from 'jwt-decode'
import { LogSnag } from 'logsnag'
import { log } from 'next-axiom'
import { twMerge } from 'tailwind-merge'
import { Database } from './database.types'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export const passwordRegex = `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*.?#^)(-_=+|}{':;~\`&])[A-Za-z\d@$!.%*?#^)(-_=+|}{':;~\`&]{6,20}$`

export const logsnagClient = () => new LogSnag({ token: process.env.LOGSNAG_TOKEN!, project: 'wordle-teams' })

export const getMonthsFromScoreDate = (startingMonth: Date): Date[] => {
  const monthsToCurrent = differenceInMonths(new Date(), startingMonth)
  let monthOption = startOfMonth(startingMonth)
  let options: Date[] = [monthOption]
  for (let i = 0; i < monthsToCurrent; i++) {
    monthOption = startOfMonth(addMonths(monthOption, 1))
    options.push(monthOption)
  }

  if (options[options.length - 1].getMonth() !== new Date().getMonth()) options.push(startOfMonth(new Date()))

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

export const getUser = async (supabase: SupabaseClient<Database>) => {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error instanceof AuthApiError && error.message.includes('Refresh Token Not Found')) {
    const { data, error: refreshError } = await supabase.auth.refreshSession()

    if (refreshError) {
      log.warn(`Session refresh error, logging out: ${refreshError.message}`)
      await supabase.auth.signOut()
      return null
    }
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user
  }
  return user
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

export const getUserFromSession = async (supabase: SupabaseClient<Database>) => {
  const session = await getSession(supabase)
  if (!session) return {} as User
  const { data: player, error } = await supabase
    .from('players')
    .select('*, player_customer(*)')
    .eq('id', session.user.id)
    .returns<player_with_customer>()
  if (error) {
    log.warn(`Failed to fetch user data: ${error.message}`)
  }
  let memberStatus: member_status = 'new'
  let memberVariant: number = 0
  let customerId: number | null = null

  if (player?.player_customer && player?.player_customer?.length > 0) {
    memberStatus = player?.player_customer[0]?.membership_status ?? 'new'
    memberVariant = player?.player_customer[0]?.membership_variant ?? 0
    customerId = player?.player_customer[0]?.customer_id ?? null
  }

  const token = jwtDecode<UserToken>(session.access_token)
  let avatarUrl = token.user_metadata?.avatar_url

  const firstName = token.user_first_name ?? ''
  const lastName = token.user_last_name ?? ''
  const initials =
    token.user_first_name && token.user_last_name ? `${token.user_first_name[0]}${token.user_last_name[0]}` : 'WT'
  const user: User = {
    id: session.user.id,
    email: session.user.email!,
    firstName,
    lastName,
    initials,
    memberStatus,
    memberVariant,
    customerId,
    invitesPendingUpgrade: session.user?.app_metadata?.invites_pending_upgrade ?? 0,
    avatarUrl,
    hasPwa: player?.has_pwa ?? false,
    reminderDeliveryMethods: player?.reminder_delivery_methods ?? [],
    reminderDeliveryTime: player?.reminder_delivery_time ?? '10:00:00',
    timeZone: player?.time_zone ?? null,
  }

  return user
}

export const padArray = (arr: string[], length: number) => {
  while (arr.length < length) {
    arr.push('')
  }
  return arr
}

export const hasName = async (supabase: SupabaseClient<Database>) => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      log.error('Failed to get session to check if user has name')
      return false
    }
    const user = await getUserFromSession(supabase)
    return user.firstName.length > 1 && user.lastName.length > 1
  } catch (error) {
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

export const clearCookie = (name: string) => {
  if (typeof window !== 'undefined') {
    const cookies = document.cookie.split(';')

    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i]
      const eqPos = cookie.indexOf('=')
      const cookieName = eqPos > -1 ? cookie.substring(0, eqPos) : cookie
      if (cookieName.trim() === name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
      }
    }
  }
}

export const getCookie = (name: string) => {
  if (typeof window !== 'undefined') {
    const cookies = document.cookie.split(';')

    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim()
      if (cookie.startsWith(name + '=')) {
        return cookie.substring(name.length + 1)
      }
    }
    return null
  }
  return null
}

export const setCookie = (name: string, value: any) => {
  if (typeof window !== 'undefined') {
    document.cookie = `${name}=${value};path=/`
  }
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
    case 'slack_oidc':
      return 'Slack'
    case 'twitter':
      return 'X'
    case 'discord':
      return 'Discord'
    default:
      return provider
  }
}

export const finishSignIn = async (user: SupabaseUser, session: Session, supabase: SupabaseClient<Database>) => {
  const { data, error } = await supabase.from('players').select('*').eq('id', user.id).single()
  if (error) {
    log.error('Failed to fetch user data', { error })
  }
  const { first_name, last_name } = data ?? { first_name: '', last_name: '' }
  const { full_name } = user.user_metadata
  let firstName = first_name ?? ''
  let lastName = last_name ?? ''

  if (
    (!first_name || !last_name || first_name.length === 0 || last_name.length === 0) &&
    full_name &&
    full_name.length > 0 &&
    full_name.includes(' ')
  ) {
    const { first, last } = await setNames(user.id, full_name, supabase)
    firstName = first
    lastName = last
  }

  await handleLogsnagEvent(user, firstName, lastName)
  await createNovuSubscriber(user, firstName, lastName)

  return await handleInvite(user, supabase)
}

const createNovuSubscriber = async (user: SupabaseUser, firstName: string, lastName: string) => {
  const { id, email, last_sign_in_at, created_at } = user
  if (!last_sign_in_at || isFirstSignIn(created_at, last_sign_in_at)) {
    const novu = new Novu(process.env.NOVU_API_KEY!)
    try {
      await novu.subscribers.identify(id, {
        email,
        firstName,
        lastName,
      })
    } catch (error) {
      log.error('Failed to create novu subscriber', { error })
    }
  }
}

export const setNames = async (id: string, full_name: string, supabase: SupabaseClient<Database>) => {
  const nameParts = full_name.trim().split(' ')
  const first = nameParts[0]
  const last = nameParts.slice(1).join(' ')
  const { error } = await supabase
    .from('players')
    .update({ first_name: first, last_name: last })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    log.error('Failed to update player name', { error })
  }

  const { error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError) {
    log.error('Failed to refresh session after updating player name', { error })
  }

  return { first, last }
}

const isFirstSignIn = (created_at: string, last_sign_in_at: string) => {
  const created = parseISO(created_at)
  const last = parseISO(last_sign_in_at)
  const diff = Math.abs(differenceInMinutes(last, created))
  return diff <= 60
}

export const handleLogsnagEvent = async (user: SupabaseUser, firstName: string, lastName: string) => {
  const { email, last_sign_in_at, created_at } = user
  const { invited } = user.user_metadata

  const { provider } = user.app_metadata
  const providerName = getOAuthProviderName(provider ?? '')

  let event = null
  if (!last_sign_in_at || isFirstSignIn(created_at, last_sign_in_at)) event = 'User Signup'
  if (invited === true) event = 'Invited User Signup'

  if (event) {
    const logsnag = logsnagClient()
    await logsnag.track({
      channel: 'users',
      event,
      user_id: email,
      icon: '🧑‍💻',
      notify: true,
      tags: {
        email: email!,
        firstname: firstName,
        lastname: lastName,
        env: process.env.ENVIRONMENT!,
        provider: providerName.length > 0 ? providerName : 'Email',
      },
    })
  }
}

const handleInvite = async (user: SupabaseUser, supabase: SupabaseClient<Database>) => {
  const { invited } = user.user_metadata

  if (invited === true) {
    const { email, id } = user
    const { error } = await supabase.rpc('handle_invited_signup', {
      invited_email: email ?? '',
      invited_id: id ?? '',
    })
    if (error) {
      log.error('Failed to handle invited signup', error)
      return false
    }
  }
  return true
}
