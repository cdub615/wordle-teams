'use client'

import { getCheckoutUrl } from '@/app/me/actions'
import { createClient } from '@/lib/supabase/client'
import { Team, User, team_with_players } from '@/lib/types'
import { getUserFromSession } from '@/lib/utils'
import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useEffect, useState } from 'react'

type TeamsContext = {
  teams: Team[]
  setTeams: Dispatch<SetStateAction<Team[]>>
  teamId: number
  setTeamId: Dispatch<SetStateAction<number>>
  month: Date
  setMonth: Dispatch<SetStateAction<Date>>
  proMember: boolean
  setProMember: Dispatch<SetStateAction<boolean>>
  checkoutUrl: string | undefined
  setCheckoutUrl: Dispatch<SetStateAction<string | undefined>>
  checkoutError: string | undefined
  setCheckoutError: Dispatch<SetStateAction<string | undefined>>
}

const TeamsContext = createContext<TeamsContext | undefined>(undefined)

type TeamsProviderProps = {
  initialTeams: team_with_players[]
  user: User
  children: ReactNode
}

export function TeamsProvider({ initialTeams, user, children }: TeamsProviderProps) {
  const _teams = initialTeams?.map((t: team_with_players) => Team.prototype.fromDbTeam(t, t.players)) ?? []
  const [teams, setTeams] = useState(_teams)
  const [month, setMonth] = useState(new Date())
  const [teamId, setTeamId] = useState(_teams[0]?.id ?? -1)
  const [proMember, setProMember] = useState(user.memberStatus === 'pro')
  const [checkoutUrl, setCheckoutUrl] = useState<string | undefined>(undefined)
  const [checkoutError, setCheckoutError] = useState<string | undefined>(undefined)

  const supabase = createClient()

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const user = getUserFromSession(session)
        if (user.memberStatus === 'pro' && !proMember) {
          setProMember(true)
        } else if (user.memberStatus !== 'pro' && proMember) {
          setProMember(false)
        }
      }
    })
    return subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const customCheckoutUrl = async () => {
      const { checkoutUrl, error } = await getCheckoutUrl(user)
      if (error) setCheckoutError(error)
      if (checkoutUrl) setCheckoutUrl(checkoutUrl)
    }
    if (!checkoutUrl) customCheckoutUrl()
  }, [checkoutUrl, user])

  return (
    <TeamsContext.Provider
      value={{
        teams,
        setTeams,
        teamId,
        setTeamId,
        month,
        setMonth,
        proMember,
        setProMember,
        checkoutUrl,
        setCheckoutUrl,
        checkoutError,
        setCheckoutError,
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
