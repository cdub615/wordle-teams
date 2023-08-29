'use client'

import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { teams } from '@/lib/types'
import { useRouter } from 'next/navigation'

type TeamsDropdownRadioGroupProps = {
  teamId: number
  month: string
  teams: teams[]
}

export default function TeamsDropdownRadioGroup({ teamId, month, teams }: TeamsDropdownRadioGroupProps) {
  const router = useRouter()
  const handleTeamChange = async (t: string) => {
    const newTeamId = Number.parseInt(t)
    await fetch('/api/set-team', {
      method: 'POST',
      body: JSON.stringify({ teamId: newTeamId }),
      headers: {
        'Content-Type': 'application/json',
      },
    })
    router.replace(`/${newTeamId}/${month}`)
  }

  return (
    <DropdownMenuRadioGroup value={`${teamId}`} onValueChange={handleTeamChange}>
      {teams.map((option) => (
        <DropdownMenuRadioItem key={option.id} value={`${option.id}`}>
          {option.name}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}
