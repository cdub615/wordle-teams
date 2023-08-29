import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Database } from '@/lib/database.types'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { ChevronDown } from 'lucide-react'
import { cookies } from 'next/headers'
import TeamsDropdownRadioGroup from './teams-dropdown-radio-group'

const getTeams = async () => {
  const supabase = createServerComponentClient<Database>({ cookies })
  const { data: teams } = await supabase.from('teams').select('*')
  if (!teams) throw new Error('No teams found')
  return teams
}

export default async function TeamsDropdown({ teamId, month }: { teamId: number; month: string }) {
  const teams = await getTeams()
  const selectedTeam = teams.find((t) => t.id === teamId)

  if (!teams) return <p>Loading teams...</p>

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
