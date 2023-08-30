'use client'

import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { teams } from '@/lib/types'
import { setTeam } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type TeamsDropdownRadioGroupProps = {
  teamId: number
  month: string
  teams: teams[]
}

export default function TeamsDropdownRadioGroup({ teamId, month, teams }: TeamsDropdownRadioGroupProps) {
  const router = useRouter()
  const [value, setValue] = useState(`${teamId}`)

  useEffect(() => {
    const setTeamCookie = async (id: number) => {
      await setTeam(id)
      router.replace(`/${id}/${month}`)
    }
    setTeamCookie(Number.parseInt(value))
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
