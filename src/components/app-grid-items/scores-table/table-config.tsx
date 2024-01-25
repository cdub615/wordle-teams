import { Player, Team } from '@/lib/types'
import { ColumnDef, VisibilityState } from '@tanstack/react-table'
import { format, getDaysInMonth, getMonth, getYear, isSameDay, isSameMonth, isWeekend } from 'date-fns'
import { MonthScoresRow } from './scores-table-types'

const getData = (team: Team, month: Date): MonthScoresRow[] => {
  const data: MonthScoresRow[] = []

  team.players.map((player: Player) => {
    const scores = player.scores?.filter((s) => isSameMonth(month, new Date(s.date)))
    const dailyAttempts = []
    for (let i = 1; i <= 31; i++) {
      const attempts =
        scores.find((s) => isSameDay(new Date(s.date), new Date(getYear(month), getMonth(month), i)))?.attempts ??
        ''
      dailyAttempts.push(attempts)
    }

    const row = {
      playerName: `${player.firstName}____${player.lastName}`,
      monthTotal: player.aggregateScoreByMonth(month.toISOString(), team.playWeekends, team.scoringSystem),
      day1: dailyAttempts[0],
      day2: dailyAttempts[1],
      day3: dailyAttempts[2],
      day4: dailyAttempts[3],
      day5: dailyAttempts[4],
      day6: dailyAttempts[5],
      day7: dailyAttempts[6],
      day8: dailyAttempts[7],
      day9: dailyAttempts[8],
      day10: dailyAttempts[9],
      day11: dailyAttempts[10],
      day12: dailyAttempts[11],
      day13: dailyAttempts[12],
      day14: dailyAttempts[13],
      day15: dailyAttempts[14],
      day16: dailyAttempts[15],
      day17: dailyAttempts[16],
      day18: dailyAttempts[17],
      day19: dailyAttempts[18],
      day20: dailyAttempts[19],
      day21: dailyAttempts[20],
      day22: dailyAttempts[21],
      day23: dailyAttempts[22],
      day24: dailyAttempts[23],
      day25: dailyAttempts[24],
      day26: dailyAttempts[25],
      day27: dailyAttempts[26],
      day28: dailyAttempts[27],
      day29: dailyAttempts[28],
      day30: dailyAttempts[29],
      day31: dailyAttempts[30],
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
