import { Player, Team } from '@/lib/types'
import { ColumnDef, VisibilityState } from '@tanstack/react-table'
import { format, getDaysInMonth, isSameMonth, isWeekend } from 'date-fns'
import { MonthScoresRow } from './scores-table-types'

const getData = (team: Team, month: Date): MonthScoresRow[] => {
  const data: MonthScoresRow[] = []

  team.players.map((player: Player) => {
    const scores = player.scores?.filter((s) => isSameMonth(month, new Date(s.date)))
    const row = {
      playerName: `${player.firstName}____${player.lastName}`,
      monthTotal: player.aggregateScoreByMonth(month.toISOString(), team.playWeekends, team.scoringSystem),
      day1: scores[0]?.attempts ?? '',
      day2: scores[1]?.attempts ?? '',
      day3: scores[2]?.attempts ?? '',
      day4: scores[3]?.attempts ?? '',
      day5: scores[4]?.attempts ?? '',
      day6: scores[5]?.attempts ?? '',
      day7: scores[6]?.attempts ?? '',
      day8: scores[7]?.attempts ?? '',
      day9: scores[8]?.attempts ?? '',
      day10: scores[9]?.attempts ?? '',
      day11: scores[10]?.attempts ?? '',
      day12: scores[11]?.attempts ?? '',
      day13: scores[12]?.attempts ?? '',
      day14: scores[13]?.attempts ?? '',
      day15: scores[14]?.attempts ?? '',
      day16: scores[15]?.attempts ?? '',
      day17: scores[16]?.attempts ?? '',
      day18: scores[17]?.attempts ?? '',
      day19: scores[18]?.attempts ?? '',
      day20: scores[19]?.attempts ?? '',
      day21: scores[20]?.attempts ?? '',
      day22: scores[21]?.attempts ?? '',
      day23: scores[22]?.attempts ?? '',
      day24: scores[23]?.attempts ?? '',
      day25: scores[24]?.attempts ?? '',
      day26: scores[25]?.attempts ?? '',
      day27: scores[26]?.attempts ?? '',
      day28: scores[27]?.attempts ?? '',
      day29: scores[28]?.attempts ?? '',
      day30: scores[29]?.attempts ?? '',
      day31: scores[30]?.attempts ?? '',
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
      header: () => <div className='text-xs @md:text-sm'>{format(day, 'EE do')}</div>,
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
      header: () => <div className='text-xs @md:text-sm'>Player</div>,
      cell: ({ row }) => {
        const name = `${row.getValue('playerName')}`
        const first = name.split('____')[0]
        const last = name.split('____')[1]
        const initials = `${first[0]}${last[0]}`
        return (
          <>
            <div className='invisible h-0 w-0 @md:visible @md:h-fit @md:w-fit'>{first}</div>
            <div className='text-xs @md:text-sm @md:invisible @md:h-0 @md:w-0'>{initials}</div>
          </>
        )
      },
    },
    ...dayColumns,
    {
      accessorKey: 'monthTotal',
      header: () => {
        return (
          <>
            <div className='font-bold text-right invisible h-0 w-0 @md:visible @md:h-fit @md:w-fit'>
              Total Score
            </div>
            <div className='font-bold text-right text-xs @md:invisible @md:h-0 @md:w-0'>Total</div>
          </>
        )
      },
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

const playerNameHeaderClass =
  'sticky left-0 px-2 @md:px-4 rounded-tl-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'
const playerNameRowClass = 'sticky left-0 rounded-bl-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'
const monthTotalHeaderClass =
  'sticky right-0 px-2 @md:px-4 rounded-tr-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'
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

export { getColumns, getData, getDayVisibility, getHeaderClass, getRowClass }
