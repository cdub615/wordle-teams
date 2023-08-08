import { Dispatch, SetStateAction, createContext } from 'react'
import { Team } from './types'

interface GlobalContext {
  teams: Team[]
  selectedTeam: Team
  setSelectedTeam: Dispatch<SetStateAction<Team>>
  selectedMonth: Date
  setSelectedMonth: Dispatch<SetStateAction<Date>>
}

const teams: Team[] = []
const setSelectedTeam: Dispatch<SetStateAction<Team>> = () => {}
const setSelectedMonth: Dispatch<SetStateAction<Date>> = () => {}

const defaultContext: GlobalContext = {
  teams,
  selectedTeam: teams[0],
  setSelectedTeam,
  selectedMonth: new Date(),
  setSelectedMonth,
}

const AppContext = createContext<GlobalContext>(defaultContext)
export const AppContextProvider = AppContext.Provider
export default AppContext
