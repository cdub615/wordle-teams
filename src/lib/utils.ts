import { Player, Team, teams } from '@/lib/types'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { clsx, type ClassValue } from 'clsx'
import { addMonths, differenceInMonths, startOfMonth } from 'date-fns'
import { LogSnag } from 'logsnag'
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

export const getImage = (supabase: SupabaseClient<Database>, imageName: string) => {
  const {
    data: { publicUrl: userImage },
  } = supabase.storage.from('images').getPublicUrl(imageName)
  if (process.env.LOCAL! == 'true')
    return userImage.replace('http://localhost:54321', process.env.DEV_SUPABASE_URL!)
  return userImage
}

export const getSession = async (supabase: SupabaseClient<Database>) => {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session
}

export const getUser = async (supabase: SupabaseClient<Database>) => {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export const padArray = (arr: string[], length: number) => {
  while (arr.length < length) {
    arr.push('')
  }
  return arr
}

export const hasName = (user: User) => !!user.user_metadata.firstName && !!user.user_metadata.lastName

