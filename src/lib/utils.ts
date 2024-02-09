import { Player, Team, teams } from '@/lib/types'
import type { SupabaseClient, UserMetadata } from '@supabase/supabase-js'
import { clsx, type ClassValue } from 'clsx'
import { addMinutes, addMonths, differenceInMonths, startOfMonth } from 'date-fns'
import { LogSnag } from 'logsnag'
import { twMerge } from 'tailwind-merge'
import { Database } from './database.types'

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

const baseUrl = (host: string | null) => `${process?.env.NODE_ENV === 'development' ? 'http' : 'https'}://${host}`

const passwordRegex = `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*.?#^)(-_=+|}{':;~\`&])[A-Za-z\d@$!.%*?#^)(-_=+|}{':;~\`&]{6,20}$`

const logsnagClient = () => new LogSnag({ token: process.env.LOGSNAG_TOKEN!, project: 'wordle-teams' })

const getMonthsFromEarliestScore = (earliest: string): Date[] => {
  const adjustedStartMonth = addMinutes(new Date(earliest), new Date(earliest).getTimezoneOffset())
  const monthsToCurrent = differenceInMonths(new Date(), adjustedStartMonth)
  let monthOption = startOfMonth(adjustedStartMonth)
  let options: Date[] = []
  for (let i = 0; i <= monthsToCurrent; i++) {
    options.push(monthOption)
    monthOption = startOfMonth(addMonths(monthOption, 1))
  }
  return options
}

const fromNewTeamResult = (result: any): Team => {
  const { newTeam, currentPlayer } = result

  const team = Team.prototype.fromDbTeam(newTeam)
  const player = Player.prototype.fromDbPlayer(currentPlayer, currentPlayer.daily_scores)
  team.addPlayer(player)
  return team
}

const monthAsDate = (month: string) =>
  new Date(Number.parseInt(month.substring(0, 4)), Number.parseInt(month.substring(4, 6)) - 1)

const playerIdsFromTeams = (teams: teams[]): string[] => {
  const player_ids = teams?.map((t) => t.player_ids)
  return !!player_ids && player_ids.length > 0
    ? player_ids.reduce((prev, current) => {
        return [...prev, ...current]
      })
    : []
}

const getImage = (supabase: SupabaseClient<Database>, imageName: string) => {
  const {
    data: { publicUrl: userImage },
  } = supabase.storage.from('images').getPublicUrl(imageName)
  if (process.env.LOCAL! == 'true')
    return userImage.replace('http://localhost:54321', process.env.DEV_SUPABASE_URL!)
  return userImage
}

const getSession = async (supabase: SupabaseClient<Database>) => {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session
}

const padArray = (arr: string[], length: number) => {
  while (arr.length < length) {
    arr.push('')
  }
  return arr
}

const extractInitials = (user_metadata: UserMetadata) => {
  const first = user_metadata.firstName
  const last = user_metadata.lastName
  const initials = `${first[0].toLocaleLowerCase()}${last[0].toLocaleLowerCase()}`
  return initials
}

export {
  baseUrl,
  cn,
  extractInitials,
  fromNewTeamResult,
  getImage,
  getMonthsFromEarliestScore,
  getSession,
  logsnagClient,
  monthAsDate,
  padArray,
  passwordRegex,
  playerIdsFromTeams,
}
