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
import AppContext from '@/lib/app-context'
import { cn } from '@/lib/utils'
import { format, formatISO, parseISO } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'
import { getMonths } from './table-config'

const ScoresTableHeader = ({ classes }: { classes?: string }) => {
  const appContext = useContext(AppContext)
  const { selectedMonth, setSelectedMonth, selectedTeam, setSelectedTeam, teams } = appContext
  const [month, setMonth] = useState(selectedMonth)
  const [team, setTeam] = useState(selectedTeam)
  useEffect(() => setSelectedMonth(month), [setSelectedMonth, month])
  useEffect(() => setSelectedTeam(team), [team])
  const monthOptions: Date[] = getMonths(selectedTeam)

  const handleMonthChange = (m: string) => {
    const newMonth = parseISO(m)
    setMonth(newMonth)
  }
  const handleTeamChange = (teamId: string) => {
    const newTeam = teams.find((t) => t.id === teamId)
    if (newTeam) setTeam(newTeam)
  }

  return (
    <div className={cn('flex items-center py-4 space-x-4', classes)}>
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline'>
            {format(month, 'MMMM')} <ChevronDown className='ml-2 h-4 w-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuLabel>Change Month</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={formatISO(month)} onValueChange={handleMonthChange}>
            {monthOptions.map((option) => (
              <DropdownMenuRadioItem key={formatISO(option)} value={formatISO(option)}>
                {format(option, 'MMMM')}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button>Create Team</Button>
      <Button>Add Player</Button>
      <Button>Add Today's Board</Button>
    </div>
  )
}

export default ScoresTableHeader
