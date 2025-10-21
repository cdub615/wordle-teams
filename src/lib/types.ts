import { UserMetadata } from '@supabase/supabase-js'
import { eachDayOfInterval, startOfMonth, endOfMonth, isSameDay, isWeekend, isFuture, isBefore, startOfToday } from 'date-fns'
import { JwtPayload } from 'jwt-decode'
import { Enums, Tables } from './database.types'
export type players = Tables<'players'>
export type player_customer = Tables<'player_customer'>
export type daily_scores = Tables<'daily_scores'>
export type teams = Tables<'teams'>
export type webhook_events = Tables<'webhook_events'>
export type member_status = Enums<'member_status'>

export type player_with_scores = players & {
  daily_scores: daily_scores[]
}

export type player_with_customer = players & {
  player_customer: player_customer[]
}

export type team_with_players = teams & {
  players: player_with_scores[]
}

export type User = {
  id: string
  firstName: string
  lastName: string
  initials: string
  email: string
  memberStatus: member_status
  memberVariant: number | null
  customerId: number | null
  invitesPendingUpgrade: number
  avatarUrl?: string
  hasPwa: boolean
  reminderDeliveryMethods: string[]
  reminderDeliveryTime: string
  timeZone: string | null
}

type AuthenticationMethod = {
  method: string
  timestamp: number
}

// TODO need to move this stuff
export type UserToken = JwtPayload & {
  user_member_status: member_status
  user_member_variant: number | null
  user_first_name: string
  user_last_name: string
  user_customer_id: number | null
  user_metadata: UserMetadata
  amr: AuthenticationMethod[]
}

export class WebhookEvent {
  playerId: string
  eventName: string
  webhookId: string
  body: any

  constructor(playerId: string, eventName: string, webhookId: string, body: any) {
    this.playerId = playerId
    this.eventName = eventName
    this.webhookId = webhookId
    this.body = body
  }
}

export class DailyScore {
  id: number
  date: string
  answer: string
  guesses: string[]

  constructor(id: number, date: string, answer: string, guesses: string[]) {
    this.id = id
    this.date = date
    this.answer = answer
    this.guesses = guesses.filter((g) => g !== '')
  }

  public trimEmptyGuesses() {
    this.guesses = this.guesses.filter((g) => g !== '')
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
    if (this.guesses && this.guesses.length >= 6 && this.guesses[5] !== this.answer) return 7
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
    if (!firstName) throw new Error('First name required for Players')
    if (!lastName) throw new Error('Last name required for Players')
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
    score.trimEmptyGuesses()
    const existingScore = this._scores.find((s) => s.id === score.id)
    if (existingScore) {
      this._scores.splice(this._scores.indexOf(existingScore), 1, score)
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
    const targetDate = new Date(date)

    // Get all days in the month
    const daysInMonth = eachDayOfInterval({
      start: startOfMonth(targetDate),
      end: endOfMonth(targetDate),
    })

    const totalScore = daysInMonth.reduce((total, day) => {
      // Skip weekends if needed
      if (!playWeekends && isWeekend(day)) {
        return total
      }

      // Find the score for this day (if it exists)
      const scoreForDay = this._scores.find((s) => isSameDay(new Date(s.date), day))

      if (scoreForDay) {
        // Day was played — use its calculated score
        return total + scoreForDay.getScore(scoringSystem)
      } else if (isBefore(day, startOfToday())) {
        // No score for this day and it's before today — use the "0 attempts" score
        return total + scoringSystem[0][1]
      }

      // Future day — no score added
      return total
    }, 0)

    return totalScore
  }
}

export class Team {
  id: number
  name: string
  creator: string | null
  playWeekends: boolean
  showLetters: boolean
  invited: string[]
  private _scoringSystem: number[][] = defaultSystem
  private _players: Player[] = []

  constructor(
    id: number,
    name: string,
    creator: string | null,
    playWeekends: boolean,
    showLetters: boolean,
    invited: string[],
    scoringSystem?: number[][],
    players?: Player[]
  ) {
    this.id = id
    this.name = name
    this.creator = creator
    this.playWeekends = playWeekends
    this.showLetters = showLetters
    this.invited = invited

    if (scoringSystem) this._scoringSystem = scoringSystem
    if (players) this._players = players
  }

  public fromDbTeam(team: teams, dbPlayers?: player_with_scores[]) {
    const {
      id,
      name,
      creator,
      play_weekends: playWeekends,
      show_letters: showLetters,
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

    return new Team(id, name, creator, playWeekends, showLetters, invited, scoringSystem, players)
  }

  public hydrate(team: Team): Team {
    const { id, name, creator, playWeekends, showLetters, invited, scoringSystem, _players } = team
    return new Team(
      id,
      name,
      creator,
      playWeekends,
      showLetters,
      invited,
      scoringSystem,
      _players.map((p) => Player.prototype.hydrate(p))
    )
  }

  public get players() {
    return this._players
  }

  private set players(players: Player[]) {
    this._players = players
  }

  public get earliestScore() {
    return this._players
      .map((p) => p.scores)
      .flat()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]
  }

  public addPlayer(player: Player): Player[] {
    this._players.push(player)
    return this._players
  }

  public removePlayer(id: string): Player[] {
    const indexToRemove = this._players.findIndex((s) => s.id === id)
    this._players.splice(indexToRemove, 1)
    return this._players
  }

  public get scoringSystem() {
    return this._scoringSystem
  }

  public setScoringSystem(system: number[][]) {
    this._scoringSystem = system
    return this._scoringSystem
  }

  public updatePlayerScore(teams: Team[], userId: string, score: DailyScore) {
    return teams.map((t) => {
      t.players = t.players.map((p) => {
        if (p.id === userId) p.addOrUpdateScore(score)
        return p
      })
      return t
    })
  }

  public removePlayerScore(teams: Team[], userId: string, scoreDate: string) {
    return teams.map((t) => {
      t.players = t.players.map((p) => {
        if (p.id === userId) p.deleteScore(scoreDate)
        return p
      })
      return t
    })
  }

  public updateTeamName(name: string) {
    this.name = name
    return this
  }

  public updatePlayWeekends(playWeekends: boolean) {
    this.playWeekends = playWeekends
    return this
  }

  public updateShowLetters(showLetters: boolean) {
    this.showLetters = showLetters
    return this
  }

  public thisMonthsCurrentWinner(thisMonth: string) {
    const scoreMap = new Map<string, number>()
    for (const player of this._players) {
      const score = player.aggregateScoreByMonth(thisMonth, this.playWeekends, this.scoringSystem)
      scoreMap.set(player.id, score)
    }
    let maxScore = -Infinity
    let winnerId = ''
    scoreMap.forEach((score, id) => {
      if (score > maxScore) {
        maxScore = score
        winnerId = id
      }
    })
    return winnerId
  }
}

export type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<{ platform: string; outcome: 'accepted' | 'dismissed' }>
}
