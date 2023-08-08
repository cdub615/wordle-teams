import { isDate, isSameMonth, isWeekend, parseISO } from 'date-fns'
import { Dispatch, SetStateAction } from 'react'
import { v4 as uuid, validate } from 'uuid'

export class DailyScore {
  date: Date
  attempts: number = 0

  constructor(score: any) {
    if (score.date && isDate(score.date)) this.date = score.date
    else if (score.date && typeof score.date === 'string') this.date = parseISO(score.date)
    else throw new Error('Valid date is required for DailyScore')

    this.attempts = score.attempts ?? 0
  }

  public getScore = (system: number[][]): number => {
    const entry = system.find((x) => x[0] === this.attempts)
    if (!entry) throw new Error(`No score value found for number of attempts: ${this.attempts}`)
    return entry[1]
  }
}

export const defaultSystem: number[][] = [
  [1, 5],
  [2, 3],
  [3, 2],
  [4, 1],
  [5, 0],
  [6, -1],
  [7, -3],
  [8, 0],
]

export class Player {
  id: string
  name: string
  private _scores: DailyScore[] = []

  constructor(player: any) {
    this.id = player.id && validate(player.id) ? player.id : uuid()
    this.name = player.name
    if (player._scores) this._scores = player._scores.map((score: any) => new DailyScore(score))
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
      this._scores.push(new DailyScore({ date, attempts }))
      return this._scores
    }
    throw new Error(`No score found for date: ${date.toDateString()}`)
  }

  public aggregateScoreByMonth(date: Date, playWeekends: boolean, scoringSystem: number[][]) {
    const scoresForMonth = this._scores.filter(
      (s) => isSameMonth(s.date, date) && (playWeekends || !isWeekend(s.date))
    )
    return scoresForMonth.map((s) => s.getScore(scoringSystem)).reduce((prev, curr) => prev + curr)
  }
}

export class Team {
  id: string
  name: string
  playWeekends: boolean
  private _scoringSystem: number[][] = defaultSystem
  private _players: Player[] = []

  constructor(team: any) {
    this.id = team.id && validate(team.id) ? team.id : uuid()
    this.name = team.name
    this.playWeekends = team.playWeekends ?? false

    if (team._players) this._players = team._players.map((player: any) => new Player(player))
  }

  public get players() {
    return this._players
  }

  public addPlayer(player: Player): Player[] {
    this._players.push(player)
    return this._players
  }

  public deletePlayer(id: string): Player[] {
    const indexToDelete = this._players.findIndex((s) => s.id === id)
    this._players.splice(indexToDelete, 1)
    return this._players
  }

  public get scoringSystem() {
    return this._scoringSystem
  }

  public setScoringSystem(system: number[][]) {
    this._scoringSystem = system
    return this._scoringSystem
  }
}
