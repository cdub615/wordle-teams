import { getDaysInMonth, isSameMonth, isWeekend } from 'date-fns'

export class DailyScore {
  date: Date
  attempts: number = 0
  score: number = 0

  constructor(date: Date, attempts: number, system: ScoringSystem | undefined = undefined) {
    this.date = date
    this.attempts = attempts
    this.score = this.getScore(attempts, system ?? defaultSystem)
  }

  private getScore = (attempts: number, system: ScoringSystem): number => system.map.get(attempts) ?? 0
}

export type ScoringSystem = {
  map: Map<number, number>
}

const defaultSystem: ScoringSystem = {
  map: new Map<number, number>([
    [1, 5],
    [2, 3],
    [3, 2],
    [4, 1],
    [5, 0],
    [6, -1],
    [7, -3],
    [8, 0],
  ]),
}

export class Player {
  private _scores: DailyScore[] = []
  name: string

  constructor(name: string) {
    this.name = name
  }

  public get scores() {
    return this._scores
  }

  public addScore(score: DailyScore): DailyScore[] {
    this._scores.push(score)
    return this._scores
  }

  public deleteScore(date: Date): DailyScore[] {
    const indexToDelete = this._scores.findIndex((s) => s.date === date)
    this._scores.splice(indexToDelete, 1)
    return this._scores
  }

  public updateScoreAttempts(date: Date, attempts: number): DailyScore[] {
    const score = this._scores.find((s) => s.date === date)
    if (score) {
      this._scores.splice(this._scores.indexOf(score), 1)
      this._scores.push(new DailyScore(date, attempts))
      return this._scores
    }
    throw new Error(`No score found for date: ${date.toDateString()}`)
  }

  public aggregateScoreByMonth(date: Date) {
    const scoresForMonth = this._scores.filter((s) => isSameMonth(s.date, date))
    return scoresForMonth.map((s) => s.score).reduce((prev, curr) => prev + curr)
  }
}

export class Team {
  name: string
  playWeekends: boolean
  players: Player[] = []

  constructor(name: string, playWeekends: boolean) {
    this.name = name
    this.playWeekends = playWeekends
  }
}

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
        let dailyScore = new DailyScore(day, getRandomInt(7))
        if (isWeekend(day) && !team.playWeekends) dailyScore = new DailyScore(day, 8)
        player.addScore(dailyScore)
      }
    }
  })

  return team
}

const elon = new Player('Elon Musk')
const mark = new Player('Mark Zuckerburg')
const jeff = new Player('Jeff Bezos')

const players: Player[] = [elon, mark, jeff]
let techGurus: Team = { name: 'Tech Gurus', playWeekends: false, players }

techGurus = buildDailyScoresForMonth(techGurus, 2023, 1)
techGurus = buildDailyScoresForMonth(techGurus, 2023, 2)
techGurus = buildDailyScoresForMonth(techGurus, 2023, 3)
techGurus = buildDailyScoresForMonth(techGurus, 2023, 4)
techGurus = buildDailyScoresForMonth(techGurus, 2023, 5)
techGurus = buildDailyScoresForMonth(techGurus, 2023, 6)
techGurus = buildDailyScoresForMonth(techGurus, 2023, 7)
techGurus = buildDailyScoresForMonth(techGurus, 2023, 8)

const teams = [techGurus]

export { defaultSystem, players, teams }
