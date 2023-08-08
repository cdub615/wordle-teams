'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ListPlus, Plus } from 'lucide-react'
import { useState } from 'react'
import AddScore from './add-score'
import CreateTeam from './create-team'
import MonthDropdown from './month-dropdown'
import TeamsDropdown from './teams-dropdown'

const ScoresTableHeader = ({ classes }: { classes?: string }) => {
  const [createTeamOpen, setCreateTeamOpen] = useState(false)
  const [addScoreOpen, setAddScoreOpen] = useState(false)
  return (
    <div className={cn('flex items-center py-4 space-x-4', classes)}>
      <MonthDropdown />
      <TeamsDropdown />
      <div className='flex-grow'>
        <Dialog open={createTeamOpen} onOpenChange={setCreateTeamOpen}>
          <DialogTrigger>
            <Button variant={'outline'} size={'icon'}>
              <ListPlus size={24} />
            </Button>
          </DialogTrigger>
          <CreateTeam setCreateTeamOpen={setCreateTeamOpen} />
        </Dialog>
      </div>
      <Dialog open={addScoreOpen} onOpenChange={setAddScoreOpen}>
        <DialogTrigger>
          <Button size={'icon'}>
            <Plus size={24} />
          </Button>
        </DialogTrigger>
        <AddScore setAddScoreOpen={setAddScoreOpen} />
      </Dialog>
    </div>
  )
}

export default ScoresTableHeader
