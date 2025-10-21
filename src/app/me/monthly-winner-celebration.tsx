"use client"

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import ConfettiExplosion from 'react-confetti-explosion'
import { useTeams } from '@/lib/contexts/teams-context'
import { createClient } from '@/lib/supabase/client'
import { log } from 'next-axiom'

export default function MonthlyWinnerCelebration() {
  const { teamId, user, teams } = useTeams()
  const [open, setOpen] = useState(false)
  const [isCurrentUserWinner, setIsCurrentUserWinner] = useState(false)
  const teamName = teams.find((t) => t.id === teamId)?.name

  useEffect(() => {
    if (!teamId || !user?.id) return

    const supabase = createClient()

    const now = new Date()
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const previousMonth = previous.getMonth() + 1 // JS Date months are 0-based
    const previousYear = previous.getFullYear()

    let cancelled = false

    const executeCelebration = async () => {
      const { data, error } = await supabase
        .from('monthly_winners')
        .select('*')
        .eq('team_id', teamId)
        .eq('year', previousYear)
        .eq('month', previousMonth)
        .maybeSingle()

      if (error) {
        log.error('Failed to get monthly winner', { error })
        return
      }
      if (!data) return
      if (cancelled) return

      const monthWinner = data as any
      setIsCurrentUserWinner(monthWinner.player_id === user.id)

      const hasSeen = monthWinner.has_seen_celebration.includes(user.id)

      if (!hasSeen) {
        setOpen(true)
        const playerIds = [...monthWinner.has_seen_celebration, user.id]
        const { error: updateError } = await (supabase as any)
          .from('monthly_winners')
          .update({ has_seen_celebration: playerIds })
          .eq('team_id', teamId)
          .eq('year', previousYear)
          .eq('month', previousMonth)
          .select()

        if (updateError) log.error('Failed to update monthly winner', { updateError })
      }
    }

    executeCelebration()

    return () => {
      cancelled = true
    }
  }, [teamId, user?.id])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          {isCurrentUserWinner && <DialogTitle>Congratulations {user.firstName}!</DialogTitle>}
          {!isCurrentUserWinner && <DialogTitle>{user.firstName} {user.lastName} won!</DialogTitle>}
        </DialogHeader>
        <div className='flex flex-col items-center justify-center h-full'>
          {open && isCurrentUserWinner && <ConfettiExplosion zIndex={1000} />}
        </div>
        {isCurrentUserWinner && <span>You won last month for {teamName}. Nice work! 🎉</span>}
        {!isCurrentUserWinner && <span>{user.firstName} {user.lastName} won last month for {teamName}. Better luck next time!</span>}
      </DialogContent>
    </Dialog>
  )
}
