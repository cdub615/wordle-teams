import { Dispatch, SetStateAction, createContext } from 'react'
import { Team } from './types'

interface GlobalContext {
  teams: Team[]
  selectedTeam: Team
  setSelectedTeam: Dispatch<SetStateAction<Team>>
  selectedMonth: Date
  setSelectedMonth: Dispatch<SetStateAction<Date>>
}

const AppContext = createContext<GlobalContext | null>(null)
export const AppContextProvider = AppContext.Provider
export default AppContext
