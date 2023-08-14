import { Team } from '@/lib/types'
import { clsx, type ClassValue } from 'clsx'
import {addMinutes, addMonths, differenceInMonths, parseISO, startOfMonth} from 'date-fns'
import {utcToZonedTime} from 'date-fns-tz'
import { twMerge } from 'tailwind-merge'

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

const baseUrl = (host: string | null) => `${process?.env.NODE_ENV === 'development' ? 'http' : 'https'}://${host}`

const passwordRegex = `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*.?#^)(-_=+|}{':;~\`&])[A-Za-z\d@$!.%*?#^)(-_=+|}{':;~\`&]{6,20}$`

const getMonthsFromEarliestScore = (team: Team): Date[] => {
  const earliest = team.players
    .map((player) => player.scores[0]?.date ?? new Date().toISOString())
    .sort((a: string, b: string) => (new Date(a) < new Date(b) ? -1 : a == b ? 0 : 1))[0]

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

export { baseUrl, cn, getMonthsFromEarliestScore, passwordRegex }
