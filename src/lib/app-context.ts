import { Dispatch, SetStateAction, createContext } from 'react'
import { Team } from './types'

interface GlobalContext {
  teams: Team[]
  setTeams: Dispatch<SetStateAction<Team[]>>
  selectedTeam: Team
  setSelectedTeam: Dispatch<SetStateAction<Team>>
  selectedMonth: Date
  setSelectedMonth: Dispatch<SetStateAction<Date>>
  userId: string
  setUserId: Dispatch<SetStateAction<string>>
}

const teams: Team[] = []
const setTeams: Dispatch<SetStateAction<Team[]>> = () => {}
const setSelectedTeam: Dispatch<SetStateAction<Team>> = () => {}
const setSelectedMonth: Dispatch<SetStateAction<Date>> = () => {}
const setUserId: Dispatch<SetStateAction<string>> = () => {}

const defaultContext: GlobalContext = {
  teams,
  setTeams,
  selectedTeam: teams[0],
  setSelectedTeam,
  selectedMonth: new Date(),
  setSelectedMonth,
  userId: '',
  setUserId,
}

const AppContext = createContext<GlobalContext>(defaultContext)
export const AppContextProvider = AppContext.Provider
export default AppContext
