'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTeams } from '@/lib/contexts/teams-context'
import { ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type TeamsDropdownProps = {
  initials: string
  month: string
}

export default function TeamsDropdown({ initials, month }: TeamsDropdownProps) {
  const router = useRouter()
  const { teams, teamId } = useTeams()
  const [value, setValue] = useState(`${teamId}`)
  const selectedTeam = teams.find((t) => t.id === teamId)

  useEffect(() => {
    const updateTeam = async (id: number) => {
      router.push(`/${initials}/${id}/${month}`)
    }
    updateTeam(Number.parseInt(value))
  }, [value])

  if (teams)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline'>
            {selectedTeam?.name} <ChevronDown className='ml-2 h-4 w-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuLabel>Change Team</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
            {teams.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={`${option.id}`}>
                {option.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
}
