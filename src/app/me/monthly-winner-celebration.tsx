"use client"

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

      if (error) return
      if (!data) return
      if (cancelled) return

      // @ts-ignore
      const isCurrentUserWinner = data.player_id === user.id
      // @ts-ignore
      const hasSeen = data.has_seen_celebration

      if (isCurrentUserWinner && !hasSeen) {
        setOpen(true)
        const response = await (supabase as any)
          .from('monthly_winners')
          .update({ has_seen_celebration: true })
          .eq('team_id', teamId)
          .eq('year', previousYear)
          .eq('month', previousMonth)
          .select()
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
          <DialogTitle>Congratulations {user.firstName}!</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col items-center justify-center h-full'>
          {open && <ConfettiExplosion zIndex={1000} />}
        </div>
        You won last month for {teamName}. Nice work! 🎉
      </DialogContent>
    </Dialog>
  )
}
