import { Player, Team, User, UserToken, teams } from '@/lib/types'
import { AuthApiError, Session, type SupabaseClient } from '@supabase/supabase-js'
import { clsx, type ClassValue } from 'clsx'
import { addMonths, differenceInMonths, startOfMonth } from 'date-fns'
import { jwtDecode } from 'jwt-decode'
import { LogSnag } from 'logsnag'
import { log } from 'next-axiom'
import { twMerge } from 'tailwind-merge'
import { Database } from './database.types'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export const baseUrl = (host: string | null) =>
  `${process?.env.NODE_ENV === 'development' ? 'http' : 'https'}://${host}`

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
  const user: User = {
    id: session.user.id,
    email: session.user.email!,
    firstName: token.user_first_name,
    lastName: token.user_last_name,
    initials: `${token.user_first_name[0]}${token.user_last_name[0]}`,
    memberStatus: token.user_member_status,
    memberVariant: token.user_member_variant,
    billingPortalUrl: token.user_customer_portal_url,
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
  const user = getUserFromSession(session)
  return user.firstName.length > 1 && user.lastName.length > 1
}
