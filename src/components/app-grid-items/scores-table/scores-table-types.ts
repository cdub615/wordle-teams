import { Team } from '@/lib/types'
import { Dispatch } from 'react'

export type ScoresTableProps = {
  teams: Team[]
  team: Team
  setTeam: Dispatch<any>
  month: Date
  setMonth: Dispatch<any>
  classes?: string
}

export type MonthScoresRow = {
  playerName: string
  monthTotal: number
  day1: number | string
  day2: number | string
  day3: number | string
  day4: number | string
  day5: number | string
  day6: number | string
  day7: number | string
  day8: number | string
  day9: number | string
  day10: number | string
  day11: number | string
  day12: number | string
  day13: number | string
  day14: number | string
  day15: number | string
  day16: number | string
  day17: number | string
  day18: number | string
  day19: number | string
  day20: number | string
  day21: number | string
  day22: number | string
  day23: number | string
  day24: number | string
  day25: number | string
  day26: number | string
  day27: number | string
  day28: number | string
  day29: number | string
  day30: number | string
  day31: number | string
}
