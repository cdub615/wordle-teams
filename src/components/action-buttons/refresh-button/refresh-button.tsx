'use client'

import { Button } from '@/components/ui/button'
import { useTeams } from '@/lib/contexts/teams-context'
import { Team, team_with_players } from '@/lib/types'
import { cn } from '@/lib/utils'
import { RefreshCw } from 'lucide-react'
import { log } from 'next-axiom'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { refreshScores } from './actions'

export default function RefreshButton() {
  const { setTeams } = useTeams()
  const [pending, setPending] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    if (window) {
      const standalone =
        (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches
      setIsStandalone(standalone)
    }
  }, [])

  const handleRefresh = async () => {
    setPending(true)
    try {
      const result = await refreshScores()
      if (result.success && result.teams && result.teams.length > 0) {
        const newTeams = result.teams.map((team: team_with_players) =>
          Team.prototype.fromDbTeam(team, team.players)
        )
        setTeams(newTeams)
      } else toast.error(result.message)
    } catch (error) {
      log.error('Unexpected error occurred in handleRefresh', { error })
      toast.error('Failed to refresh scores, please try again')
    }
    setPending(false)
  }

  return isStandalone ? (
    <Button
      variant={'outline'}
      onClick={handleRefresh}
      aria-disabled={pending}
      disabled={pending}
      className='text-xs md:text-sm '
    >
      <RefreshCw size={18} className={cn({ 'animate-spin': pending })} />
    </Button>
  ) : null
}
