'use client'

import {Button} from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import AppContext from '@/lib/app-context'
import { ChevronDown } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'

const TeamsDropdown = () => {
  const appContext = useContext(AppContext)
  const { selectedTeam, setSelectedTeam, teams } = appContext
  const [team, setTeam] = useState(selectedTeam)
  useEffect(() => setSelectedTeam(team), [setSelectedTeam, team])

  const handleTeamChange = (teamId: string) => {
    const newTeam = teams.find((t) => t.id === teamId)
    if (newTeam) setTeam(newTeam)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline'>
          {team.name} <ChevronDown className='ml-2 h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuLabel>Change Team</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={team.id} onValueChange={handleTeamChange}>
          {teams.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              {option.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default TeamsDropdown
