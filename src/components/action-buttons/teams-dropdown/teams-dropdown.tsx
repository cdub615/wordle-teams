'use client'

import CreateTeam from './create-team'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTeams } from '@/lib/contexts/teams-context'
import { ChevronDown, Plus } from 'lucide-react'

export default function TeamsDropdown() {
  const { teams, teamId, setTeamId } = useTeams()
  const selectedTeam = teams.find((t) => t.id === teamId)
  const handleTeamChange = (t: string) => setTeamId(Number.parseInt(t))

  if (teams)
    return (
      <Dialog>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='outline' className='text-xs px-2 md:text-sm md:px-4'>
              {selectedTeam?.name} <ChevronDown className='ml-1 md:ml-2 h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuLabel>Change Team</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={`${teamId}`} onValueChange={handleTeamChange}>
              {teams.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={`${option.id}`}>
                  {option.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DialogTrigger className='w-full'>
              <DropdownMenuItem>
                <div className='flex items-center w-full space-x-2'>
                  <Plus size={18} />
                  <span>New Team</span>
                </div>
              </DropdownMenuItem>
            </DialogTrigger>
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateTeam />
      </Dialog>
    )
}
