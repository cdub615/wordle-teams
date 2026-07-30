'use client'

import { Team, User, team_with_players } from '@/lib/types'
import { isSameMonth } from 'date-fns'
import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '../supabase/client'
import { clearCookie, isBrowser } from '../utils'

type TeamsContext = {
  teams: Team[]
  setTeams: Dispatch<SetStateAction<Team[]>>
  teamId: number
  setTeamId: Dispatch<SetStateAction<number>>
  month: Date
  setMonth: Dispatch<SetStateAction<Date>>
  user: User
  setUser: Dispatch<SetStateAction<User>>
}

const TeamsContext = createContext<TeamsContext | undefined>(undefined)

type TeamsProviderProps = {
  initialTeams: team_with_players[]
  _user: User
  children: ReactNode
}

export function TeamsProvider({ initialTeams, _user, children }: TeamsProviderProps) {
  const supabase = createClient()
  supabase.auth.onAuthStateChange((event, session) => {
    if (session && session.provider_token) {
      window.localStorage.setItem('oauth_provider_token', session.provider_token)
    }

    if (session && session.provider_refresh_token) {
      window.localStorage.setItem('oauth_provider_refresh_token', session.provider_refresh_token)
    }

    if (event === 'SIGNED_OUT') {
      window.localStorage.removeItem('oauth_provider_token')
      window.localStorage.removeItem('oauth_provider_refresh_token')
    }
  })

  const _teams = initialTeams?.map((t: team_with_players) => Team.prototype.fromDbTeam(t, t.players)) ?? []
  const [teams, setTeams] = useState(_teams)
  // These MUST NOT read localStorage. A useState initializer runs during render,
  // including on the server, so an isBrowser() guard does not avoid the problem —
  // it guarantees it: the server renders team #1 / the current month while the
  // client renders whatever the user last selected. For anyone who has ever
  // switched teams or months that is a whole-subtree hydration mismatch on every
  // single load, which is what produced the 'Hydration Error' and the
  // '$RS ... b.parentNode is null' streaming crash on /me (wordle-teams-uc5).
  // Start from the server-safe value; the stored preference is applied on mount.
  const [month, setMonth] = useState(() => new Date())
  const [teamId, setTeamId] = useState(_teams[0]?.id ?? -1)
  const [user, setUser] = useState<User>(_user)
  // Guards the persistence effects below so they cannot write the defaults over
  // the user's stored selection in the window before it has been read back.
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)

  // Declared before the persistence effects on purpose: effects run in
  // declaration order, so this restores the stored values first.
  useEffect(() => {
    const storedMonth = localStorage.getItem('selectedMonth')
    if (storedMonth) {
      const parsed = new Date(storedMonth)
      if (!Number.isNaN(parsed.getTime())) setMonth(parsed)
    }

    const storedTeam = localStorage.getItem('selectedTeam')
    if (storedTeam) {
      const parsed = Number.parseInt(storedTeam)
      if (!Number.isNaN(parsed)) setTeamId(parsed)
    }

    setPreferencesLoaded(true)
  }, [])

  useEffect(() => {
    if (!preferencesLoaded) return
    localStorage.setItem('selectedMonth', month.toISOString())
  }, [month, preferencesLoaded])

  useEffect(() => {
    if (!preferencesLoaded) return
    localStorage.setItem('selectedTeam', teamId.toString())
  }, [teamId, preferencesLoaded])

  useEffect(() => {
    clearCookie('awaitingVerification')

    const today = new Date()
    const selectedMonth = localStorage.getItem('selectedMonth') ?? today.toISOString()
    const adjustedMonthFor = localStorage.getItem('adjustedMonthFor') ?? new Date(1900, 0, 1).toISOString()
    if (!isSameMonth(new Date(adjustedMonthFor), today) && !isSameMonth(new Date(selectedMonth), today)) {
      setMonth(today)
      localStorage.setItem('adjustedMonthFor', today.toISOString())
    }
  }, [])

  return (
    <TeamsContext.Provider
      value={{
        teams,
        setTeams,
        teamId,
        setTeamId,
        month,
        setMonth,
        user,
        setUser,
      }}
    >
      {children}
    </TeamsContext.Provider>
  )
}

export function useTeams() {
  const context = useContext(TeamsContext)
  if (context === undefined) {
    throw new Error('useTeams must be used within a TeamsProvider')
  }
  return context
}
