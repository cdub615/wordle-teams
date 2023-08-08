import { Team } from '@/lib/types'
import { Dispatch } from 'react'

export type ScoresTableHeaderProps = {
  teams: Team[]
  team: Team
  setTeam: Dispatch<any>
  month: Date
  setMonth: Dispatch<any>
  // monthOptions: Date[]
  classes?: string
}

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
  day1: number
  day2: number
  day3: number
  day4: number
  day5: number
  day6: number
  day7: number
  day8: number
  day9: number
  day10: number
  day11: number
  day12: number
  day13: number
  day14: number
  day15: number
  day16: number
  day17: number
  day18: number
  day19: number
  day20: number
  day21: number
  day22: number
  day23: number
  day24: number
  day25: number
  day26: number
  day27: number
  day28: number
  day29?: number
  day30?: number
  day31?: number
}
