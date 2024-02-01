import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/server'
import { ChevronDown } from 'lucide-react'
import { cookies } from 'next/headers'
import TeamsDropdownRadioGroup from './teams-dropdown-radio-group'

const getTeams = async () => {
  const supabase = createClient(cookies())
  const { data: teams } = await supabase.from('teams').select('*')
  if (!teams) throw new Error('No teams found')
  return teams
}

export default async function TeamsDropdown({ teamId, month }: { teamId: number; month: string }) {
  const teams = await getTeams()
  const selectedTeam = teams.find((t) => t.id === teamId)

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
          <TeamsDropdownRadioGroup teamId={teamId} teams={teams} month={month} />
        </DropdownMenuContent>
      </DropdownMenu>
    )
}
