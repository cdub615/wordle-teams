'use client'

import AddBoard from '@/components/add-board'
import CreateTeam from '@/components/create-team'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import AppContext from '@/lib/app-context'
import { cn } from '@/lib/utils'
import { ListPlus, Plus } from 'lucide-react'
import { useContext, useState } from 'react'
import MonthDropdown from './month-dropdown'
import TeamsDropdown from './teams-dropdown'

const ActionButtons = ({ classes }: { classes?: string }) => {
  const { teams, setTeams } = useContext(AppContext)
  const [createTeamOpen, setCreateTeamOpen] = useState(false)
  const [addBoardOpen, setAddBoardOpen] = useState(false)
  // TODO allow user to change the date so they can update an existing board as well
  return (
    <div className={cn('flex items-center space-x-2 @md:space-x-4', classes)}>
      <MonthDropdown />
      <TeamsDropdown />
      <div className='flex-grow'>
        <Dialog open={createTeamOpen} onOpenChange={setCreateTeamOpen}>
          <DialogTrigger asChild>
            <Button variant={'outline'} size={'icon'}>
              <ListPlus size={24} />
            </Button>
          </DialogTrigger>
          <CreateTeam setCreateTeamOpen={setCreateTeamOpen} teams={teams} setTeams={setTeams} />
        </Dialog>
      </div>
      <Dialog open={addBoardOpen} onOpenChange={setAddBoardOpen}>
        <DialogTrigger asChild>
          <Button size={'icon'}>
            <Plus size={24} />
          </Button>
        </DialogTrigger>
        <AddBoard setAddBoardOpen={setAddBoardOpen} />
      </Dialog>
    </div>
  )
}

export default ActionButtons
