import { DailyScore, Player, Team, defaultSystem } from '@/lib/types'
import { getDaysInMonth, isWeekend } from 'date-fns'
import { NextResponse } from 'next/server'

const getRandomInt = (max: number) => {
  const number = Math.floor(Math.random() * max)
  return number == 0 ? 5 : number
}

const buildDailyScoresForMonth = (team: Team, year: number, month: number): Team => {
  const date = new Date(year, month - 1)
  const numDays = getDaysInMonth(date)
  team.players.forEach((player) => {
    for (let i = 1; i <= numDays; i++) {
      const day = new Date(year, month - 1, i)
      if (day <= new Date()) {
        let dailyScore = new DailyScore({ date: day, attempts: getRandomInt(7) })
        if (isWeekend(day) && !team.playWeekends) dailyScore = new DailyScore({ date: day, attempts: 8 })
        player.addScore(dailyScore)
      }
    }
  })

  return team
}

const elon = new Player({ name: 'Elon Musk' })
const mark = new Player({ name: 'Mark Zuckerburg' })
const steve = new Player({ name: 'Steve Jobs' })
const bill = new Player({ name: 'Bill Gates' })

const players: Player[] = [elon, mark, steve, bill]
let techGiants: Team = new Team({
  name: 'Tech Giants',
  playWeekends: false,
  _players: players,
  _scoringSystem: defaultSystem,
})

techGiants = buildDailyScoresForMonth(techGiants, 2023, 1)
techGiants = buildDailyScoresForMonth(techGiants, 2023, 2)
techGiants = buildDailyScoresForMonth(techGiants, 2023, 3)
techGiants = buildDailyScoresForMonth(techGiants, 2023, 4)
techGiants = buildDailyScoresForMonth(techGiants, 2023, 5)
techGiants = buildDailyScoresForMonth(techGiants, 2023, 6)
techGiants = buildDailyScoresForMonth(techGiants, 2023, 7)
techGiants = buildDailyScoresForMonth(techGiants, 2023, 8)

const teams = [techGiants]

const GET = () => NextResponse.json(teams)

export { GET }
