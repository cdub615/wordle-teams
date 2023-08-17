import { isSameMonth, isWeekend } from 'date-fns'
import { Database } from './database.types'
export type players = Database['public']['Tables']['players']['Row']
export type daily_scores = Database['public']['Tables']['daily_scores']['Row']
export type teams = Database['public']['Tables']['teams']['Row']
export type profiles = Database['public']['Tables']['profiles']['Row']

export type User = {
  firstName: string
  lastName: string
  email: string | undefined
}

export class DailyScore {
  id: string
  date: string
  answer: string
  guesses: string[]

  constructor(id: string, date: string, answer: string, guesses: string[]) {
    this.id = id
    this.date = date
    this.answer = answer
    this.guesses = guesses
  }

  public fromDbDailyScore(daily_scores: daily_scores) {
    const { id, date, answer, guesses } = daily_scores
    return new DailyScore(id, date, answer ?? '', guesses)
  }

  public hydrate(score: DailyScore): DailyScore {
    const { id, date, answer, guesses } = score
    return new DailyScore(id, date, answer, guesses)
  }

  public get attempts(): number {
    return this.guesses?.length ?? 0
  }

  public getScore = (system: number[][]): number => {
    const entry = system.find((x) => x[0] === this.attempts)
    if (!entry) throw new Error(`No score value found for number of attempts: ${this.attempts}`)
    return entry[1]
  }
}

export const defaultSystem: number[][] = [
  [0, 0],
  [1, 5],
  [2, 3],
  [3, 2],
  [4, 1],
  [5, 0],
  [6, -1],
  [7, -3],
]

export class Player {
  id: string
  firstName: string
  lastName: string
  email: string
  private _scores: DailyScore[] = []

  constructor(id: string, firstName: string, lastName: string, email: string, scores?: DailyScore[]) {
    this.id = id
    this.firstName = firstName
    this.lastName = lastName
    this.email = email
    if (scores) this._scores = scores
  }

  public fromDbPlayer(player: players, daily_scores?: daily_scores[]) {
    const { id, first_name: firstName, last_name: lastName, email } = player
    const scores = daily_scores?.map((s) => DailyScore.prototype.fromDbDailyScore(s))
    return new Player(id, firstName, lastName, email, scores)
  }

  public hydrate(player: Player): Player {
    const { id, firstName, lastName, email, _scores } = player
    return new Player(
      id,
      firstName,
      lastName,
      email,
      _scores.map((s) => DailyScore.prototype.hydrate(s))
    )
  }

  public get scores() {
    return this._scores
  }

  public get fullName() {
    return `${this.firstName} ${this.lastName}`
  }

  public addOrUpdateScore(score: DailyScore): DailyScore[] {
    const existingScore = this._scores.find((s) => s.id === score.id)
    if (existingScore) {
      const { id, date, answer, guesses } = score
      this._scores.splice(this._scores.indexOf(existingScore), 1)
      this._scores.push(new DailyScore(id, date, answer, guesses))
      return this._scores
    } else {
      this._scores.push(score)
      return this._scores
    }
  }

  public deleteScore(date: string): DailyScore[] {
    const indexToDelete = this._scores.findIndex((s) => s.date === date)
    this._scores.splice(indexToDelete, 1)
    return this._scores
  }

  public aggregateScoreByMonth(date: string, playWeekends: boolean, scoringSystem: number[][]) {
    const scoresForMonth = this._scores.filter(
      (s) => isSameMonth(new Date(s.date), new Date(date)) && (playWeekends || !isWeekend(new Date(s.date)))
    )
    const scores = scoresForMonth.map((s) => s.getScore(scoringSystem))
    return scores.length > 0 ? scores.reduce((prev, curr) => prev + curr) : 0
  }
}

export class Team {
  id: string
  name: string
  creator: string
  playWeekends: boolean
  invited: string[]
  private _scoringSystem: number[][] = defaultSystem
  private _players: Player[] = []

  constructor(
    id: string,
    name: string,
    creator: string,
    playWeekends: boolean,
    invited: string[],
    scoringSystem?: number[][],
    players?: Player[]
  ) {
    this.id = id
    this.name = name
    this.creator = creator
    this.playWeekends = playWeekends
    this.invited = invited

    if (scoringSystem) this._scoringSystem = scoringSystem
    if (players) this._players = players
  }

  public fromDbTeam(team: teams, dbPlayers?: any[]) {
    const {
      id,
      name,
      creator,
      play_weekends: playWeekends,
      n_a,
      one_guess,
      two_guesses,
      three_guesses,
      four_guesses,
      five_guesses,
      six_guesses,
      failed,
      invited,
    } = team
    const scoringSystem: number[][] = [
      [0, n_a],
      [1, one_guess],
      [2, two_guesses],
      [3, three_guesses],
      [4, four_guesses],
      [5, five_guesses],
      [6, six_guesses],
      [7, failed],
    ]

    const players = dbPlayers?.map((p) => Player.prototype.fromDbPlayer(p, p.daily_scores))

    return new Team(id, name, creator, playWeekends, invited, scoringSystem, players)
  }

  public hydrate(team: Team): Team {
    const { id, name, creator, playWeekends, invited, scoringSystem, _players } = team
    return new Team(
      id,
      name,
      creator,
      playWeekends,
      invited,
      scoringSystem,
      _players.map((p) => Player.prototype.hydrate(p))
    )
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

  public updatePlayerScore(teams: Team[], selectedTeamId: string, userId: string, score: DailyScore) {
    return teams.map((t) => {
      if (t.id === selectedTeamId) {
        t.players.map((p) => {
          if (p.id === userId) p.addOrUpdateScore(score)
          return p
        })
      }
      return t
    })
  }
}
