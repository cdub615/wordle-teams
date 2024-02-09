'use client'

import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { teams } from '@/lib/types'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type TeamsDropdownRadioGroupProps = {
  initials: string
  teamId: number
  month: string
  teams: teams[]
}

export default function TeamsDropdownRadioGroup({ initials, teamId, month, teams }: TeamsDropdownRadioGroupProps) {
  const router = useRouter()
  const [value, setValue] = useState(`${teamId}`)

  useEffect(() => {
    const updateTeam = async (id: number) => {
      router.push(`/${initials}/${id}/${month}`)
    }
    updateTeam(Number.parseInt(value))
  }, [value])

  return (
    <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
      {teams.map((option) => (
        <DropdownMenuRadioItem key={option.id} value={`${option.id}`}>
          {option.name}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}
