'use client'

import { createClient } from '@/lib/supabase/client'
import { Team, User, player_customer, team_with_players } from '@/lib/types'
import { getUserFromSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useEffect, useState } from 'react'

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
  const _teams = initialTeams?.map((t: team_with_players) => Team.prototype.fromDbTeam(t, t.players)) ?? []
  const [teams, setTeams] = useState(_teams)
  const [month, setMonth] = useState(new Date())
  const [teamId, setTeamId] = useState(_teams[0]?.id ?? -1)
  const [user, setUser] = useState<User>(_user)

  const supabase = createClient()

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const user = getUserFromSession(session)
        setUser(user)
      }
    })
    return subscription.unsubscribe()
  }, [supabase])

  useEffect(() => {
    const channel = supabase
      .channel('player membership')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'player_customer' /*, filter: `player_id=eq.${user.id}`*/ },
        (payload) => {
          log.info('player membership update, processing in teams-context', payload)
          const updated = payload.new as player_customer
          if (updated.player_id === user.id)
            setUser({
              ...user,
              memberStatus: updated.membership_status,
              memberVariant: updated.membership_variant,
            })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  useEffect(() => {
    const getStuff = async () => {
      const { data, error } = await supabase.from('player_customer').select('*').eq('player_id', user.id).single()
      if (error) log.error(error.message)
      log.info('player_customer', {data})
    }
    getStuff()
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
