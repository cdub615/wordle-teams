import { Team } from '@/lib/types'
import { ColumnDef, VisibilityState } from '@tanstack/react-table'
import {
  addMonths,
  differenceInMonths,
  format,
  getDaysInMonth,
  isSameMonth,
  isWeekend,
  startOfMonth,
} from 'date-fns'
import { MonthScoresRow } from './scores-table-types'

const getData = (team: Team, month: Date): MonthScoresRow[] => {
  const data: MonthScoresRow[] = []

  team.players.map((player) => {
    const scores = player.scores.filter((s) => isSameMonth(month, s.date))
    const row = {
      playerName: player.name,
      monthTotal: player.aggregateScoreByMonth(month, team.playWeekends, team.scoringSystem),
      day1: scores[0]?.attempts ?? 8,
      day2: scores[1]?.attempts ?? 8,
      day3: scores[2]?.attempts ?? 8,
      day4: scores[3]?.attempts ?? 8,
      day5: scores[4]?.attempts ?? 8,
      day6: scores[5]?.attempts ?? 8,
      day7: scores[6]?.attempts ?? 8,
      day8: scores[7]?.attempts ?? 8,
      day9: scores[8]?.attempts ?? 8,
      day10: scores[9]?.attempts ?? 8,
      day11: scores[10]?.attempts ?? 8,
      day12: scores[11]?.attempts ?? 8,
      day13: scores[12]?.attempts ?? 8,
      day14: scores[13]?.attempts ?? 8,
      day15: scores[14]?.attempts ?? 8,
      day16: scores[15]?.attempts ?? 8,
      day17: scores[16]?.attempts ?? 8,
      day18: scores[17]?.attempts ?? 8,
      day19: scores[18]?.attempts ?? 8,
      day20: scores[19]?.attempts ?? 8,
      day21: scores[20]?.attempts ?? 8,
      day22: scores[21]?.attempts ?? 8,
      day23: scores[22]?.attempts ?? 8,
      day24: scores[23]?.attempts ?? 8,
      day25: scores[24]?.attempts ?? 8,
      day26: scores[25]?.attempts ?? 8,
      day27: scores[26]?.attempts ?? 8,
      day28: scores[27]?.attempts ?? 8,
      day29: scores[28]?.attempts ?? 8,
      day30: scores[29]?.attempts ?? 8,
      day31: scores[30]?.attempts ?? 8,
    } satisfies MonthScoresRow
    data.push(row)
  })

  return data
}

const getColumns = (month: Date, playWeekends: boolean) => {
  const days = new Array(31).fill(1)
  const dayColumns: ColumnDef<MonthScoresRow>[] = days.map((_, i) => {
    const dayNum = i + 1
    const day = new Date(month.getFullYear(), month.getMonth(), dayNum)
    return {
      accessorKey: `day${dayNum}`,
      header: () => <div>{format(day, 'EE do')}</div>,
      cell: ({ row }) =>
        isWeekend(day) && !playWeekends ? (
          <div className='text-muted-foreground text-xs'>N/A</div>
        ) : (
          <div>{row.getValue(`day${dayNum}`)}</div>
        ),
    }
  })

  const columns: ColumnDef<MonthScoresRow>[] = [
    {
      accessorKey: 'playerName',
      header: 'Player',
      cell: ({ row }) => <div>{row.getValue('playerName')}</div>,
    },
    ...dayColumns,
    {
      accessorKey: 'monthTotal',
      header: () => <div className='font-bold text-right'>Total Score</div>,
      cell: ({ row }) => <div className='font-bold text-right'>{row.getValue('monthTotal')}</div>,
    },
  ]

  return columns
}

const getDayVisibility = (month: Date): VisibilityState => {
  const numDays = getDaysInMonth(month)
  const dayVisibility: VisibilityState = {}
  for (let i = 29; i <= 31; i++) {
    if (i > numDays) dayVisibility[`day${i}`] = false
  }
  return dayVisibility
}

const getMonths = (team: Team): Date[] => {
  const earliest = team.players
    .map((player) => player.scores[0]?.date ?? new Date())
    .sort((a: Date, b: Date) => (a < b ? -1 : a == b ? 0 : 1))[0]

  const monthsToCurrent = differenceInMonths(new Date(), earliest)
  let monthOption = startOfMonth(earliest)
  let options: Date[] = []
  for (let i = 0; i <= monthsToCurrent; i++) {
    options.push(monthOption)
    monthOption = startOfMonth(addMonths(monthOption, 1))
  }
  return options
}

const playerNameHeaderClass = 'sticky left-0 rounded-tl-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'
const playerNameRowClass = 'sticky left-0 rounded-bl-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'
const monthTotalHeaderClass = 'sticky right-0 rounded-tr-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'
const monthTotalRowClass = 'sticky right-0 rounded-br-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'

const getHeaderClass = (id: string) => {
  if (id === 'playerName') return playerNameHeaderClass
  if (id === 'monthTotal') return monthTotalHeaderClass
  return ''
}
const getRowClass = (id: string) => {
  if (id.includes('playerName')) return playerNameRowClass
  if (id.includes('monthTotal')) return monthTotalRowClass
  return ''
}

export { getColumns, getData, getDayVisibility, getHeaderClass, getMonths, getRowClass }
