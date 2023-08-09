'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ListPlus, Plus } from 'lucide-react'
import { useState } from 'react'
import AddBoard from './add-board'
import CreateTeam from './create-team'
import MonthDropdown from './month-dropdown'
import TeamsDropdown from './teams-dropdown'

const ScoresTableHeader = ({ classes }: { classes?: string }) => {
  const [createTeamOpen, setCreateTeamOpen] = useState(false)
  const [addBoardOpen, setAddBoardOpen] = useState(false)

  return (
    <div className={cn('flex items-center py-2 space-x-2 @md:py-4 @md:space-x-4', classes)}>
      <MonthDropdown />
      <TeamsDropdown />
      <div className='flex-grow'>
        <Dialog open={createTeamOpen} onOpenChange={setCreateTeamOpen}>
          <DialogTrigger asChild>
            <Button variant={'outline'} size={'icon'}>
              <ListPlus size={24} />
            </Button>
          </DialogTrigger>
          <CreateTeam setCreateTeamOpen={setCreateTeamOpen} />
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

export default ScoresTableHeader
